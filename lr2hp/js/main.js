import { GAUGE_LABEL, CLEAR_LABEL, GAUGE_ORDER, isSurvivalGauge } from './gauge.js';
import { parseOsuMania, judgementCount, parseLayout } from './notes.js';
import { PressClassifier } from './presses.js';
import { PlaySession } from './session.js';
import { SongClock } from './clock.js';
import { GaugeRenderer } from './render.js';
import { connect } from './socket.js';

const DEFAULTS = {
    startGauge: 'EX-HARD',
    bottomGauge: 'EASY',
    totalMode: 'standard',
    totalValue: 300,
    parts: 50,
    skin: 'simple2',
    scale: 1,
    showLabel: true,
    showAllGauges: false,
    showEmptyPoorStatus: true,
    showPressStats: false,
    hideOutsidePlay: true,
    emptyPoor: true,
    emptyPoorMode: 'all',
    keyHelperPort: 24055,
    inputOffset: 0,
    keys1: 'Space',
    keys2: 'F J',
    keys3: 'F Space J',
    keys4: 'D F J K',
    keys5: 'D F Space J K',
    keys6: 'S D F J K L',
    keys7: 'S D F Space J K L',
    keys8: 'A S D F J K L ;',
    keys9: 'A S D F Space J K L ;',
    keys10: 'A S D F V N J K L ;',
};

const GAUGE_KEY = { 'EX-HARD': 'exhard', HARD: 'hard', GROOVE: 'groove', EASY: 'easy' };
const SHORT = { exhard: 'EXH', hard: 'HRD', groove: 'GRV', easy: 'EZ' };

const STATE_PLAY = 2;
const STATE_RESULTS = 7;
const MODE_MANIA = 3;


const params = new URLSearchParams(location.search);
const host = params.get('host') || location.host || '127.0.0.1:24050';
const demo = params.has('demo');

// Any setting can also be given in the URL, e.g. ?startGauge=HARD&scale=0.8
const settings = { ...DEFAULTS };
for (const [k, v] of params) {
    if (!(k in DEFAULTS)) continue;
    const d = DEFAULTS[k];
    settings[k] = typeof d === 'number' ? Number(v) : typeof d === 'boolean' ? v !== 'false' && v !== '0' : v;
}
const els = {
    root: document.getElementById('root'),
    canvas: document.getElementById('gauge'),
    label: document.getElementById('label'),
    all: document.getElementById('all'),
    status: document.getElementById('status'),
};
const renderer = new GaugeRenderer(els.canvas);
const clock = new SongClock();

let session = null;
let classifier = null;
let chart = null;
let chartChecksum = null;
let layout = new Map();
let playKey = null;
let lastState = -1;
let lastLive = 0;
let isLazer = false;
let inResults = false;
let visible = false;
let helperConnected = false;
let tosuKeyCounts = null;
let hitErrorCount = 0;
let helperOffset = null;
let lastData = null;

// ---------------------------------------------------------------- settings

function gaugeKey(name, fallback) {
    return GAUGE_KEY[String(name).toUpperCase()] || fallback;
}

async function applySettings(next = {}) {
    Object.assign(settings, next);
    document.documentElement.style.setProperty('--scale', Number(settings.scale) || 1);
    renderer.setParts(Number(settings.parts) || 50);
    try {
        await renderer.setSkin(settings.skin || 'simple2');
    } catch (e) {
        console.warn(e);
        await renderer.setSkin('simple2');
    }
    els.root.style.width = `${renderer.barWidth}px`;
    if (session) session.setRange(gaugeKey(settings.startGauge, 'exhard'), gaugeKey(settings.bottomGauge, 'easy'));
    if (chart) layout = parseLayout(settings[`keys${chart.keys}`]);
    if (!demo) connectHelper();
}

// ---------------------------------------------------------------- chart / play lifecycle

// Mod acronyms of the current play. Lazer sends [{acronym, settings}], stable [{acronym}] or a name like "HDDT".
function modsOf(data) {
    const mods = data?.play?.mods || {};
    if (Array.isArray(mods.array) && mods.array.length) {
        return new Set(mods.array.map((m) => (typeof m === 'string' ? m : m?.acronym)).filter(Boolean));
    }
    return new Set(String(mods.name || '').match(/[A-Z0-9]{2}/g) || []);
}

function rateOf(data) {
    const rate = Number(data?.play?.mods?.rate);
    if (rate > 0) return rate;
    const mods = modsOf(data);
    if (mods.has('DT') || mods.has('NC')) return 1.5;
    if (mods.has('HT') || mods.has('DC')) return 0.75;
    return 1;
}

// Fallback note count from tosu's object counts (exact for native mania charts)
function notesFromStats(data) {
    const o = data?.beatmap?.stats?.objects || {};
    const holds = Number(o.holds) || 0;
    const total = Number(o.total) || (Number(o.circles) || 0) + holds;
    return total + (isLazer ? holds : 0);
}

async function fetchChart(checksum) {
    if (chartChecksum === checksum) return chart;
    chartChecksum = checksum;
    chart = null;
    try {
        const res = await fetch(`http://${host}/files/beatmap/file?${encodeURIComponent(checksum)}`);
        if (res.ok) chart = parseOsuMania(await res.text());
    } catch (e) {
        console.warn('chart fetch failed', e);
    }
    return chart;
}

// Converted charts: ask tosu's rosu-pp for the mania object count
async function fetchConvertNotes() {
    try {
        const res = await fetch(`http://${host}/api/calculate/pp?mode=3`);
        if (!res.ok) return 0;
        const json = await res.json();
        const d = json.difficulty || json;
        const n = Number(d.nObjects) || 0;
        return n + (isLazer ? Number(d.nHoldNotes) || 0 : 0);
    } catch {
        return 0;
    }
}

function hitWindows(data) {
    const od = Number(data?.beatmap?.stats?.od?.original) || 5;
    const mods = modsOf(data);
    let scale = 1;
    if (mods.has('HR')) scale /= 1.4;
    if (mods.has('EZ')) scale *= 1.4;
    // osu!mania: 50 window 151 - 3*OD, miss window 188 - 3*OD
    return { late: (151 - 3 * od) * scale, early: (188 - 3 * od) * scale };
}

function startPlay(data) {
    isLazer = data.client === 'lazer';
    session = new PlaySession({
        notes: notesFromStats(data),
        totalMode: settings.totalMode,
        totalValue: Number(settings.totalValue),
        start: gaugeKey(settings.startGauge, 'exhard'),
        bottom: gaugeKey(settings.bottomGauge, 'easy'),
    });
    classifier = null;
    inResults = false;
    clock.reset();
    tosuKeyCounts = null;
    const current = session;
    const checksum = data.beatmap?.checksum || '';
    const mods = modsOf(data);

    if (data.beatmap?.isConvert) {
        fetchConvertNotes().then((n) => {
            if (session === current && n > 0) session.setNotes(n);
        });
        chart = null;
        return;
    }
    fetchChart(checksum).then((c) => {
        if (session !== current || !c) return;
        session.setNotes(judgementCount(c, isLazer));
        layout = parseLayout(settings[`keys${c.keys}`]);
        classifier = new PressClassifier(c, {
            ...hitWindows(data),
            songTime: (wall) => clock.now(wall) + (Number(settings.inputOffset) || 0),
            mirror: mods.has('MR'),
            // Shuffled lanes: match the press against every lane
            anyColumn: mods.has('RD') || mods.has('DS') || mods.has('CO'),
            mode: settings.emptyPoorMode,
        });
    });
}

const debugPresses = [];

function onPress(column, wall) {
    if (params.has('debug')) {
        debugPresses.push({ column, wall: Math.round(wall), ok: !!(session && classifier && clock.valid) });
        if (debugPresses.length > 500) debugPresses.shift();
    }
    if (!session || !classifier || inResults || !settings.emptyPoor || !clock.valid) return;
    classifier.press(column, wall);
}

// Presses that got no hitErrors entry are settled a moment later
function settlePresses(now) {
    if (!session || !classifier) return;
    for (let n = classifier.tick(now); n > 0; n--) session.addEmptyPoor();
}

// ---------------------------------------------------------------- tosu data

function onTosu(data) {
    if (data.error) return;
    lastData = data;
    const now = performance.now();
    const state = data.state?.number;
    const mania = data.play?.mode?.number === MODE_MANIA;
    const live = Number(data.beatmap?.time?.live) || 0;

    if (state === STATE_PLAY && mania) {
        const key = `${data.beatmap?.checksum}:${[...modsOf(data)].sort().join('')}`;
        const restarted = live < lastLive - 1000;
        if (lastState !== STATE_PLAY || key !== playKey || !session || restarted) {
            playKey = key;
            startPlay(data);
        }
        if (!session.applyHits(data.play.hits)) {
            startPlay(data);
            session.applyHits(data.play.hits);
        }
        clock.sample(live, now, rateOf(data), !!data.game?.paused);
        lastLive = live;
        visible = true;
    } else if (state === STATE_RESULTS && session) {
        // Pick up judgements that landed after the last gameplay update
        const hits = data.resultsScreen?.hits;
        if (hits && !inResults) session.applyHits(hits);
        inResults = true;
        visible = true;
    } else {
        // Keep the last play around so it can stay on screen when hiding is off
        visible = !settings.hideOutsidePlay && !!session;
        lastLive = 0;
    }
    lastState = state;
}

function onTosuPrecise(data) {
    if (data.error) return;
    const now = performance.now();

    // Up to 4K tosu's own key counters stand in for the helper
    if (!helperConnected && isLazer && chart && chart.keys <= 4 && data.keys) {
        const counts = ['k1', 'k2', 'm1', 'm2'].map((k) => Number(data.keys[k]?.count) || 0);
        if (tosuKeyCounts) {
            for (let col = 0; col < chart.keys; col++) {
                for (let n = counts[col] - tosuKeyCounts[col]; n > 0; n--) onPress(col, now);
            }
        }
        tosuKeyCounts = counts;
    }

    // New hitErrors entries confirm the presses osu! used on notes
    const errors = Array.isArray(data.hitErrors) ? data.hitErrors : null;
    if (!errors) return;
    if (errors.length < hitErrorCount) hitErrorCount = 0; // cleared on retry / song select
    if (errors.length > hitErrorCount) {
        const added = errors.slice(hitErrorCount);
        hitErrorCount = errors.length;
        if (classifier) classifier.hitErrors(added, now);
    }
}

// ---------------------------------------------------------------- key helper

let helper = null;
let helperPort = null;

function connectHelper() {
    const port = Number(settings.keyHelperPort) || 24055;
    if (!settings.emptyPoor) {
        helper?.close();
        helper = null;
        helperPort = null;
        helperConnected = false;
        return;
    }
    if (helper && helperPort === port) return;
    helper?.close();
    helperPort = port;
    helper = connect(`ws://127.0.0.1:${port}/`, {
        onOpen: () => {
            helperConnected = true;
            helperOffset = null;
        },
        onClose: () => {
            helperConnected = false;
        },
        onMessage: (msg) => {
            if (msg.d !== 1 || !chart) return;
            const column = layout.get(msg.vk);
            if (column === undefined) return;
            // Map the helper's own timestamp onto performance.now(); the smallest
            // receive delay seen is the closest to the true offset
            const now = performance.now();
            const t = Number(msg.t);
            let wall = now;
            if (Number.isFinite(t)) {
                if (helperOffset === null || now - t < helperOffset) helperOffset = now - t;
                wall = t + helperOffset;
            }
            onPress(column, wall);
        },
    });
}

// ---------------------------------------------------------------- drawing

function emptyPoorStatus() {
    if (demo || !settings.emptyPoor) return '';
    if (lastData?.beatmap?.isConvert) return '空POOR: convert';
    if (!helperConnected && !(isLazer && chart && chart.keys <= 4)) return '空POOR: off';
    if (settings.showPressStats && classifier) {
        const s = classifier.stats;
        const c = classifier.calibration;
        return `hit ${s.hit} · early ${s.earlyMiss} · 空POOR ${s.empty} · sync ${c >= 0 ? '+' : ''}${c.toFixed(1)}ms`;
    }
    return '';
}

function frame(now) {
    settlePresses(now);
    const shown = visible && session;
    els.root.classList.toggle('hidden', !shown);
    if (shown) {
        const g = session.gauges.current;
        renderer.draw(g, now);

        let label = GAUGE_LABEL[g.type];
        let cls = g.type;
        if (inResults) {
            const clear = session.gauges.clearType();
            label = clear ? CLEAR_LABEL[clear] : 'FAILED';
            if (!clear) cls = 'failed';
        } else if (isSurvivalGauge(g.type) && g.value <= 0) {
            label = 'FAILED';
            cls = 'failed';
        }
        els.label.textContent = settings.showLabel ? label : '';
        els.label.className = `label ${cls}`;

        if (settings.showAllGauges) {
            els.all.textContent = GAUGE_ORDER.map((t) => `${SHORT[t]} ${session.gauges.gauges[t].value.toFixed(1)}`).join('  ');
        } else {
            els.all.textContent = '';
        }
        els.status.textContent = settings.showEmptyPoorStatus || settings.showPressStats ? emptyPoorStatus() : '';
    }
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- demo (no tosu)

function runDemo() {
    const notes = 1200;
    let hits = { geki: 0, 300: 0, katu: 0, 100: 0, 50: 0, 0: 0 };
    const reset = () => {
        hits = { geki: 0, 300: 0, katu: 0, 100: 0, 50: 0, 0: 0 };
        session = new PlaySession({
            notes,
            totalMode: settings.totalMode,
            totalValue: Number(settings.totalValue),
            start: gaugeKey(settings.startGauge, 'exhard'),
            bottom: gaugeKey(settings.bottomGauge, 'easy'),
        });
        inResults = false;
        visible = true;
    };
    reset();
    let phase = 0;
    setInterval(() => {
        if (inResults) return;
        phase += 0.004;
        const skill = 0.75 + 0.25 * Math.sin(phase * 3);
        for (let i = 0; i < 2; i++) {
            const r = Math.random();
            if (r < 0.6 * skill) hits.geki++;
            else if (r < 0.85 * skill) hits['300']++;
            else if (r < 0.9) hits.katu++;
            else if (r < 0.94) hits['100']++;
            else if (r < 0.96) hits['50']++;
            else hits['0']++;
        }
        session.applyHits(hits);
        if (Math.random() < 0.05) session.addEmptyPoor();
        if (session.judged >= notes) {
            inResults = true;
            setTimeout(reset, 3000);
        }
    }, 30);
}

// ---------------------------------------------------------------- boot

if (params.has('debug')) {
    window.lr2hp = { get session() { return session; }, get classifier() { return classifier; }, get clock() { return clock; }, get chart() { return chart; }, presses: debugPresses };
}

async function boot() {
    await applySettings();
    requestAnimationFrame(frame);
    if (demo) {
        runDemo();
        return;
    }

    connect(`ws://${host}/websocket/v2`, { onMessage: onTosu });
    connect(`ws://${host}/websocket/v2/precise`, {
        onOpen: (ws) => ws.send(`applyFilters:${JSON.stringify(['hitErrors', 'keys'])}`),
        onMessage: onTosuPrecise,
    });
    // Keep settling presses while the overlay is hidden (rAF may be throttled)
    setInterval(() => settlePresses(performance.now()), 20);

    const counterPath = window.COUNTER_PATH;
    if (counterPath) {
        const path = encodeURI(counterPath);
        connect(`ws://${host}/websocket/commands?l=${path}`, {
            onOpen: (ws) => ws.send(`getSettings:${path}`),
            onMessage: (msg) => {
                if (msg.command === 'getSettings' && msg.message && typeof msg.message === 'object') {
                    applySettings(msg.message);
                }
            },
        });
    }
}

boot();
