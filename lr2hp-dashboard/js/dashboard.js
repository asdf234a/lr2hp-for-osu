// BMS-style score dashboard: rank, EX score, score rate, judge counts with
// FAST/SLOW and max combo, drawn with the beatoraja simple-play counter images.
// Play tracking is shared with the LR2HP for osu gauge overlay (../lr2hp).

import { PlayTracker, GAMEPLAY_DEFAULTS, settingsFromUrl, watchSettings } from '../../lr2hp/js/tracker.js';
import { rankIndex } from '../../lr2hp/js/session.js';
import { PG, GR, GD, BD, PR, MS } from '../../lr2hp/js/gauge.js';

const LOOK_DEFAULTS = {
    gaugeOverlay: 'lr2hp',
    counter: 'default',
    rank: 'noto',
    showRank: true,
    showScore: true,
    showRate: true,
    judgeCount: 'ON+FAST/SLOW',
    showMaxCombo: true,
    scale: 1,
    hideOutsidePlay: true,
};

const params = new URLSearchParams(location.search);
const host = params.get('host') || location.host || '127.0.0.1:24050';
const demo = params.has('demo');

// Gameplay settings (key layout, empty POOR, ...) come from the gauge overlay;
// this overlay's own settings only cover the look.
// URL parameters can override both (e.g. ?keyHelperPort=24056&scale=0.8).
const urlGameplay = settingsFromUrl(GAMEPLAY_DEFAULTS, params);
let gameplay = {};
let look = settingsFromUrl(LOOK_DEFAULTS, params);
const settings = { ...urlGameplay, ...look };
const tracker = new PlayTracker({ host, settings, debug: params.has('debug'), name: 'dashboard' });

const canvas = document.getElementById('dash');
const root = document.getElementById('root');
const ctx = canvas.getContext('2d');
const images = { counter: null, rank: null };

// ---------------------------------------------------------------- counter image layout (simple-play counter.lua)

const DIGIT_W = 13;
const DIGIT_H = 17;
const ROW_WHITE = 0;
const ROW_FAST = 17;
const ROW_SLOW = 34;
const ROW_PLAIN = 51; // index 10 is a normal 0 here, used for zero-padded decimals
const LABEL = {
    judge: [156, 0, 39, 131],
    rate: [156, 171, 65, 17],
    rateDot: [225, 183, 5, 5],
    score: [156, 190, 78, 17],
    maxCombo: [156, 209, 78, 17],
};
const RANK_W = 120;
const RANK_H = 48;
const ROW_STEP = 19;

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`failed to load ${src}`));
        img.src = src;
    });
}

async function loadSkins() {
    const counter = encodeURIComponent(settings.counter || 'default');
    const rank = encodeURIComponent(settings.rank || 'noto');
    try {
        images.counter = await loadImage(`skins/counter/${counter}.png`);
    } catch {
        images.counter = await loadImage('skins/counter/default.png');
    }
    try {
        images.rank = await loadImage(`skins/rank/${rank}.png`);
    } catch {
        images.rank = await loadImage('skins/rank/noto.png');
    }
}

function blit(src, x, y) {
    const [sx, sy, sw, sh] = src;
    ctx.drawImage(images.counter, sx, sy, sw, sh, x, y, sw, sh);
}

// beatoraja SkinNumber: `digits` cells; with 11 glyphs per row the 11th fills
// leading positions (a dim 0 on the white row), with `blank` they stay empty
// and the number is left-aligned.
function number(value, digits, x, y, row, { pad = true } = {}) {
    const v = Math.max(0, Math.floor(value)) % 10 ** digits;
    const s = String(v);
    if (pad) {
        const text = s.padStart(digits, ' ');
        for (let i = 0; i < digits; i++) {
            const g = text[i] === ' ' ? 10 : Number(text[i]);
            ctx.drawImage(images.counter, g * DIGIT_W, row, DIGIT_W, DIGIT_H, x + i * DIGIT_W, y, DIGIT_W, DIGIT_H);
        }
    } else {
        for (let i = 0; i < s.length; i++) {
            ctx.drawImage(images.counter, Number(s[i]) * DIGIT_W, row, DIGIT_W, DIGIT_H, x + i * DIGIT_W, y, DIGIT_W, DIGIT_H);
        }
    }
}

// Top-down layout: rank, SCORE, RATE, judge counts, MAX.C
function layout() {
    const fs = settings.judgeCount === 'ON+FAST/SLOW';
    const judge = settings.judgeCount !== 'OFF';
    const rows = [];
    let y = 0;
    if (settings.showRank) {
        rows.push(['rank', y]);
        y += RANK_H + 6;
    }
    if (settings.showScore) {
        rows.push(['score', y]);
        y += ROW_STEP;
    }
    if (settings.showRate) {
        rows.push(['rate', y]);
        y += ROW_STEP;
    }
    if (judge) {
        y += rows.length ? 5 : 0;
        rows.push(['judge', y]);
        y += 131 + 5;
    }
    if (settings.showMaxCombo) {
        rows.push(['maxCombo', y]);
        y += DIGIT_H;
    }
    const width = Math.max(RANK_W, settings.showScore ? 78 + 7 * DIGIT_W : 0, judge ? (fs ? 169 + 4 * DIGIT_W : 39 + 4 * DIGIT_W) : 0, 78 + 4 * DIGIT_W);
    return { rows, width, height: Math.max(1, y), fs };
}

let current = null;

function resize() {
    current = layout();
    canvas.width = current.width;
    canvas.height = current.height;
}

function draw() {
    const s = tracker.session;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!s || !images.counter) return;
    ctx.imageSmoothingEnabled = false;
    const started = s.judged > 0;

    for (const [kind, y] of current.rows) {
        switch (kind) {
            case 'rank':
                if (started) {
                    const i = rankIndex(s.rate);
                    ctx.drawImage(images.rank, 0, i * RANK_H, RANK_W, RANK_H, 0, y, RANK_W, RANK_H);
                }
                break;
            case 'score':
                blit(LABEL.score, 0, y);
                number(s.exScore, 7, 78, y, ROW_WHITE, { pad: false });
                break;
            case 'rate': {
                const pct = Math.floor(s.rate * 10000); // two decimals, truncated like beatoraja
                blit(LABEL.rate, 0, y);
                number(Math.floor(pct / 100), 3, 65, y, ROW_WHITE);
                blit(LABEL.rateDot, 104, y + DIGIT_H - 5);
                number(pct % 100, 2, 109, y, ROW_PLAIN);
                break;
            }
            case 'judge': {
                blit(LABEL.judge, 0, y);
                const [prFast, prSlow] = s.poorFastSlow();
                const lines = [
                    [s.counts[PG], s.fast[PG], s.slow[PG]],
                    [s.counts[GR], s.fast[GR], s.slow[GR]],
                    [s.counts[GD], s.fast[GD], s.slow[GD]],
                    [s.counts[BD], s.fast[BD], s.slow[BD]],
                    [s.counts[PR], prFast, prSlow],
                    [s.emptyPoor, s.fast[MS], s.slow[MS]],
                    [s.comboBreaks, null, null],
                ];
                lines.forEach(([total, fast, slow], i) => {
                    const ry = y + i * ROW_STEP;
                    number(total, 4, 39, ry, ROW_WHITE);
                    if (current.fs && fast !== null) {
                        number(fast, 4, 104, ry, ROW_FAST);
                        number(slow, 4, 169, ry, ROW_SLOW);
                    }
                });
                break;
            }
            case 'maxCombo':
                blit(LABEL.maxCombo, 0, y);
                number(s.maxCombo, 4, 78, y, ROW_WHITE);
                break;
        }
    }
}

function frame(now) {
    tracker.settlePresses(now);
    const shown = tracker.visible && tracker.session;
    root.classList.toggle('hidden', !shown);
    if (shown) draw();
    requestAnimationFrame(frame);
}

async function applySettings() {
    Object.assign(settings, urlGameplay, gameplay, look);
    document.documentElement.style.setProperty('--scale', Number(settings.scale) || 1);
    await loadSkins();
    resize();
    if (!demo) tracker.applySettings();
}

// ---------------------------------------------------------------- demo (no tosu)

function runDemo() {
    const notes = 1200;
    let hits;
    const w = { perfect: 16, great: 40, good: 73, ok: 103, meh: 127 };
    const reset = () => {
        hits = { geki: 0, 300: 0, katu: 0, 100: 0, 50: 0, 0: 0 };
        tracker.session = tracker.newSession(notes);
        tracker.inResults = false;
        tracker.visible = true;
    };
    reset();
    setInterval(() => {
        if (tracker.inResults) return;
        const offsets = [];
        for (let i = 0; i < 2; i++) {
            const o = (Math.random() + Math.random() + Math.random() - 1.5) * 50;
            const a = Math.abs(o);
            if (Math.random() < 0.02) hits['0']++;
            else {
                if (a <= w.perfect) hits.geki++;
                else if (a <= w.great) hits['300']++;
                else if (a <= w.good) hits.katu++;
                else if (a <= w.ok) hits['100']++;
                else hits['50']++;
                offsets.push(o);
            }
        }
        tracker.session.applyHits(hits);
        tracker.session.addHitOffsets(offsets, w);
        if (Math.random() < 0.03) tracker.session.addEmptyPoor(Math.random() < 0.5);
        if (tracker.session.judged >= notes) {
            tracker.inResults = true;
            setTimeout(reset, 3000);
        }
    }, 30);
}

// ---------------------------------------------------------------- boot

if (params.has('debug')) window.lr2hp = tracker;

async function boot() {
    await applySettings();
    requestAnimationFrame(frame);
    if (demo) {
        runDemo();
        return;
    }
    tracker.start();
    if (window.COUNTER_PATH) {
        watchSettings(host, window.COUNTER_PATH, (next) => {
            const gaugeName = next.gaugeOverlay || look.gaugeOverlay;
            const changed = gaugeName !== look.gaugeOverlay;
            look = { ...look, ...next };
            if (changed) watchGauge(gaugeName);
            applySettings();
        });
    }
    watchGauge(look.gaugeOverlay);
}

let gaugeWatch = null;
function watchGauge(name) {
    gaugeWatch?.close();
    gaugeWatch = watchSettings(host, name, (next) => {
        gameplay = next;
        applySettings();
    });
}

boot();
