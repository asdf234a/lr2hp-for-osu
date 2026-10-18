// Follows a play through tosu: judgements, the chart, key presses and empty POOR.
// Shared by the gauge overlay and the dashboard overlay.

import { parseOsuMania, judgementCount, parseLayout, maniaWindows, vkName } from './notes.js';
import { PressClassifier } from './presses.js';
import { KeyLearner, learnedLayout, mergeLayouts } from './keylearn.js';
import { PlaySession } from './session.js';
import { SongClock } from './clock.js';
import { connect } from './socket.js';

export const GAMEPLAY_DEFAULTS = {
    startGauge: 'EX-HARD',
    bottomGauge: 'EASY',
    totalMode: 'standard',
    totalValue: 300,
    hideOutsidePlay: true,
    emptyPoor: true,
    emptyPoorMode: 'lr2oraja',
    earlyMissAsBad: true,
    learnKeys: true,
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

export function gaugeKey(name, fallback) {
    return GAUGE_KEY[String(name).toUpperCase()] || fallback;
}

const VOTES_KEY = 'lr2hp.keyvotes';

// Learned key votes live in the browser profile, shared by every overlay on this origin
function loadVotes() {
    try {
        const v = JSON.parse(localStorage.getItem(VOTES_KEY) || '{}');
        return v && typeof v === 'object' ? v : {};
    } catch {
        return {};
    }
}

function saveVotes(votes) {
    try {
        localStorage.setItem(VOTES_KEY, JSON.stringify(votes));
    } catch {
        // storage unavailable: learning still works for this session
    }
}

const STATE_PLAY = 2;
const STATE_RESULTS = 7;
const MODE_MANIA = 3;

// Settings defaults, overridden by URL parameters (e.g. ?scale=0.8)
export function settingsFromUrl(defaults, params) {
    const settings = { ...defaults };
    for (const [k, v] of params) {
        if (!(k in defaults)) continue;
        const d = defaults[k];
        settings[k] = typeof d === 'number' ? Number(v) : typeof d === 'boolean' ? v !== 'false' && v !== '0' : v;
    }
    return settings;
}

// Subscribes to an overlay's tosu settings; calls back on load and on every save
export function watchSettings(host, name, onSettings) {
    const path = encodeURI(name);
    return connect(`ws://${host}/websocket/commands?l=${path}`, {
        onOpen: (ws) => ws.send(`getSettings:${path}`),
        onMessage: (msg) => {
            if (msg.command === 'getSettings' && msg.message && typeof msg.message === 'object') {
                onSettings(msg.message);
            }
        },
    });
}

// Mod acronyms of the current play. Lazer sends [{acronym, settings}], stable [{acronym}] or a name like "HDDT".
export function modsOf(data) {
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

export class PlayTracker {
    constructor({ host, settings, debug = false }) {
        this.host = host;
        this.settings = settings;
        this.debug = debug;
        this.clock = new SongClock();
        this.session = null;
        this.classifier = null;
        this.windows = null;
        this.chart = null;
        this.chartChecksum = null;
        this.layout = new Map();
        this.playKey = null;
        this.lastState = -1;
        this.lastLive = 0;
        this.isLazer = false;
        this.inResults = false;
        this.visible = false;
        this.helperConnected = false;
        this.tosuKeyCounts = null;
        this.hitErrorCount = 0;
        this.helperOffset = null;
        this.lastData = null;
        this.helper = null;
        this.helperPort = null;
        this.debugPresses = [];
        this.listeners = { emptyPoor: [] };
        this.votes = loadVotes(); // { [keyCount]: { [vk]: votes per lane } }
        this.learner = null;
        this.learnedKeys = 0;
        this.votesSavedAt = 0;
    }

    // Events: 'emptyPoor' (fast) fires the moment an empty POOR is counted
    on(name, fn) {
        this.listeners[name]?.push(fn);
    }

    emit(name, ...args) {
        for (const fn of this.listeners[name] || []) fn(...args);
    }

    start() {
        connect(`ws://${this.host}/websocket/v2`, { onMessage: (d) => this.onTosu(d) });
        connect(`ws://${this.host}/websocket/v2/precise`, {
            onOpen: (ws) => ws.send(`applyFilters:${JSON.stringify(['hitErrors', 'keys'])}`),
            onMessage: (d) => this.onTosuPrecise(d),
        });
        // Keep settling presses while the overlay is hidden (rAF may be throttled)
        setInterval(() => this.settlePresses(performance.now()), 20);
        this.applySettings();
    }

    // Call after settings change
    applySettings() {
        const s = this.settings;
        if (this.session) this.session.setRange(gaugeKey(s.startGauge, 'exhard'), gaugeKey(s.bottomGauge, 'easy'));
        if (this.chart) this.updateLayout();
        this.connectHelper();
    }

    newSession(notes) {
        const s = this.settings;
        return new PlaySession({
            notes,
            totalMode: s.totalMode,
            totalValue: Number(s.totalValue),
            start: gaugeKey(s.startGauge, 'exhard'),
            bottom: gaugeKey(s.bottomGauge, 'easy'),
        });
    }

    // ------------------------------------------------------------ chart / play lifecycle

    // Fallback note count from tosu's object counts (exact for native mania charts)
    notesFromStats(data) {
        const o = data?.beatmap?.stats?.objects || {};
        const holds = Number(o.holds) || 0;
        const total = Number(o.total) || (Number(o.circles) || 0) + holds;
        return total + (this.isLazer ? holds : 0);
    }

    async fetchChart(checksum) {
        if (this.chartChecksum === checksum) return this.chart;
        this.chartChecksum = checksum;
        this.chart = null;
        try {
            const res = await fetch(`http://${this.host}/files/beatmap/file?${encodeURIComponent(checksum)}`);
            if (res.ok) this.chart = parseOsuMania(await res.text());
        } catch (e) {
            console.warn('chart fetch failed', e);
        }
        return this.chart;
    }

    // Converted charts: ask tosu's rosu-pp for the mania object count
    async fetchConvertNotes() {
        try {
            const res = await fetch(`http://${this.host}/api/calculate/pp?mode=3`);
            if (!res.ok) return 0;
            const json = await res.json();
            const d = json.difficulty || json;
            const n = Number(d.nObjects) || 0;
            return n + (this.isLazer ? Number(d.nHoldNotes) || 0 : 0);
        } catch {
            return 0;
        }
    }

    startPlay(data) {
        this.isLazer = data.client === 'lazer';
        this.session = this.newSession(this.notesFromStats(data));
        this.classifier = null;
        this.inResults = false;
        this.clock.reset();
        this.tosuKeyCounts = null;
        this.unmapped = new Map(); // helper keys pressed that aren't in the layout: vk -> count
        this.learner = null;
        const current = this.session;
        const mods = modsOf(data);
        const od = Number(data?.beatmap?.stats?.od?.original);
        this.windows = maniaWindows(Number.isFinite(od) ? od : 5, mods);

        if (data.beatmap?.isConvert) {
            this.chart = null;
            this.fetchConvertNotes().then((n) => {
                if (this.session === current && n > 0) this.session.setNotes(n);
            });
            return;
        }
        this.fetchChart(data.beatmap?.checksum || '').then((c) => {
            if (this.session !== current || !c) return;
            this.session.setNotes(judgementCount(c, this.isLazer));
            const shuffled = mods.has('RD') || mods.has('DS') || mods.has('CO');
            if (this.settings.learnKeys && !shuffled) {
                this.learner = new KeyLearner(c, {
                    songTime: (wall) => this.clock.now(wall),
                    votes: this.votes[c.keys] || (this.votes[c.keys] = {}),
                    mirror: mods.has('MR'),
                });
            }
            this.updateLayout();
            this.classifier = new PressClassifier(c, {
                early: this.windows.miss,
                late: this.windows.meh,
                songTime: (wall) => this.clock.now(wall) + (Number(this.settings.inputOffset) || 0),
                mirror: mods.has('MR'),
                // Shuffled lanes: match the press against every lane
                anyColumn: mods.has('RD') || mods.has('DS') || mods.has('CO'),
                mode: this.settings.emptyPoorMode,
            });
        });
    }

    onPress(column, wall) {
        if (this.debug) {
            this.debugPresses.push({ column, wall: Math.round(wall), ok: !!(this.session && this.classifier && this.clock.valid) });
            if (this.debugPresses.length > 500) this.debugPresses.shift();
        }
        if (!this.session || !this.classifier || this.inResults || !this.settings.emptyPoor || !this.clock.valid) return;
        this.classifier.press(column, wall);
    }

    // Typed-in layout for this key count, overridden by whatever the learner is sure of
    updateLayout() {
        const keys = this.chart?.keys;
        if (!keys) return;
        const manual = parseLayout(this.settings[`keys${keys}`]);
        const learned = this.settings.learnKeys ? learnedLayout(this.votes[keys], keys) : new Map();
        this.learnedKeys = learned.size;
        this.layout = mergeLayouts(learned, manual);
    }

    // Presses that got no hitErrors entry are settled a moment later
    settlePresses(now) {
        if (this.learner && this.learner.flush(now)) {
            this.updateLayout();
            if (now - this.votesSavedAt > 2000) {
                this.votesSavedAt = now;
                saveVotes(this.votes);
            }
        }
        if (!this.session || !this.classifier) return;
        for (const r of this.classifier.tick(now)) {
            if (r.result === 'empty') {
                this.session.addEmptyPoor(r.fast, now);
                this.emit('emptyPoor', r.fast);
            } else if (r.result === 'earlyMiss') {
                this.session.earlyMiss(now, !!this.settings.earlyMissAsBad && r.early);
            }
        }
    }

    // ------------------------------------------------------------ tosu data

    onTosu(data) {
        if (data.error) return;
        this.lastData = data;
        const now = performance.now();
        const state = data.state?.number;
        const mania = data.play?.mode?.number === MODE_MANIA;
        const live = Number(data.beatmap?.time?.live) || 0;

        if (state === STATE_PLAY && mania) {
            const key = `${data.beatmap?.checksum}:${[...modsOf(data)].sort().join('')}`;
            const restarted = live < this.lastLive - 1000;
            if (this.lastState !== STATE_PLAY || key !== this.playKey || !this.session || restarted) {
                this.playKey = key;
                this.startPlay(data);
            }
            if (!this.session.applyHits(data.play.hits, now)) {
                this.startPlay(data);
                this.session.applyHits(data.play.hits, now);
            }
            this.clock.sample(live, now, rateOf(data), !!data.game?.paused);
            this.lastLive = live;
            this.visible = true;
        } else if (state === STATE_RESULTS && this.session) {
            // Pick up judgements that landed after the last gameplay update
            const hits = data.resultsScreen?.hits;
            if (hits && !this.inResults) this.session.applyHits(hits, now);
            this.inResults = true;
            this.visible = true;
        } else {
            // Keep the last play around so it can stay on screen when hiding is off
            this.visible = !this.settings.hideOutsidePlay && !!this.session;
            this.lastLive = 0;
        }
        this.lastState = state;
    }

    onTosuPrecise(data) {
        if (data.error) return;
        const now = performance.now();

        // Up to 4K tosu's own key counters stand in for the helper
        const chart = this.chart;
        if (!this.helperConnected && this.isLazer && chart && chart.keys <= 4 && data.keys) {
            const counts = ['k1', 'k2', 'm1', 'm2'].map((k) => Number(data.keys[k]?.count) || 0);
            if (this.tosuKeyCounts) {
                for (let col = 0; col < chart.keys; col++) {
                    for (let n = counts[col] - this.tosuKeyCounts[col]; n > 0; n--) this.onPress(col, now);
                }
            }
            this.tosuKeyCounts = counts;
        }

        // New hitErrors entries confirm the presses osu! used on notes
        const errors = Array.isArray(data.hitErrors) ? data.hitErrors : null;
        if (!errors) return;
        if (errors.length < this.hitErrorCount) this.hitErrorCount = 0; // cleared on retry / song select
        if (errors.length > this.hitErrorCount) {
            const added = errors.slice(this.hitErrorCount);
            this.hitErrorCount = errors.length;
            if (this.classifier) this.classifier.hitErrors(added, now);
            if (this.learner && this.helperConnected && !this.inResults) this.learner.hitErrors(added, now);
            if (this.session && this.windows && !this.inResults) this.session.addHitOffsets(added, this.windows);
        }
    }

    // ------------------------------------------------------------ key helper

    connectHelper() {
        const port = Number(this.settings.keyHelperPort) || 24055;
        if (!this.settings.emptyPoor) {
            this.helper?.close();
            this.helper = null;
            this.helperPort = null;
            this.helperConnected = false;
            return;
        }
        if (this.helper && this.helperPort === port) return;
        this.helper?.close();
        this.helperPort = port;
        this.helper = connect(`ws://127.0.0.1:${port}/`, {
            onOpen: () => {
                this.helperConnected = true;
                this.helperOffset = null;
            },
            onClose: () => {
                this.helperConnected = false;
            },
            onMessage: (msg) => {
                if (msg.d !== 1 || !this.chart) return;
                // Map the helper's own timestamp onto performance.now(); the smallest
                // receive delay seen is the closest to the true offset
                const now = performance.now();
                const t = Number(msg.t);
                let wall = now;
                if (Number.isFinite(t)) {
                    if (this.helperOffset === null || now - t < this.helperOffset) this.helperOffset = now - t;
                    wall = t + this.helperOffset;
                }
                const playing = this.session && !this.inResults;
                if (playing && this.learner) this.learner.press(msg.vk, wall);
                const column = this.layout.get(msg.vk);
                if (column === undefined) {
                    if (playing && this.unmapped) this.unmapped.set(msg.vk, (this.unmapped.get(msg.vk) || 0) + 1);
                    return;
                }
                this.onPress(column, wall);
            },
        });
    }

    // Short note when empty POOR can't be counted, or the debug readout
    emptyPoorStatus(showStats) {
        if (!this.settings.emptyPoor) return '';
        if (this.lastData?.beatmap?.isConvert) return '空POOR: convert';
        if (!this.helperConnected && !(this.isLazer && this.chart && this.chart.keys <= 4)) return '空POOR: off';
        if (showStats && this.classifier) {
            const s = this.classifier.stats;
            const c = this.classifier.calibration;
            let text = `hit ${s.hit} · early ${s.earlyMiss} · 空POOR ${s.empty} · sync ${c >= 0 ? '+' : ''}${c.toFixed(1)}ms`;
            if (this.helperConnected && this.settings.learnKeys && this.chart) {
                const lanes = [...Array(this.chart.keys)].map((_, lane) => {
                    const vk = [...this.layout].find(([, l]) => l === lane)?.[0];
                    return vk === undefined ? '?' : vkName(vk);
                });
                text += ` · keys ${this.learnedKeys}/${this.chart.keys} learned [${lanes.join(' ')}]`;
            }
            // Keys pressed during play that the layout doesn't know: a likely layout mismatch
            const unmapped = [...(this.unmapped || new Map())].filter(([, n]) => n >= 3);
            if (unmapped.length) text += ` · unmapped ${unmapped.map(([vk, n]) => `${vkName(vk)}×${n}`).join(' ')}`;
            return text;
        }
        return '';
    }
}
