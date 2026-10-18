// Flashes the skin's POOR judge image whenever an empty POOR is counted,
// timed like beatoraja's judge display (shown for 500 ms from the judge timer).
// Play tracking is shared with the lr2hp-for-osu gauge overlay (../lr2hp).

import { PlayTracker, GAMEPLAY_DEFAULTS, settingsFromUrl, watchSettings } from '../../lr2hp-for-osu/js/tracker.js';

const LOOK_DEFAULTS = {
    gaugeOverlay: 'lr2hp-for-osu',
    judge: 'default',
    trim: true,
    scale: 1,
    duration: 500,
};

const params = new URLSearchParams(location.search);
const host = params.get('host') || location.host || '127.0.0.1:24050';
const demo = params.has('demo');

const urlGameplay = settingsFromUrl(GAMEPLAY_DEFAULTS, params);
let gameplay = {};
let look = settingsFromUrl(LOOK_DEFAULTS, params);
const settings = { ...urlGameplay, ...look };
const tracker = new PlayTracker({ host, settings, debug: params.has('debug'), name: 'emptypoor' });

const canvas = document.getElementById('judge');
const ctx = canvas.getContext('2d');
const note = document.getElementById('note');

let judges = null;
let judge = null; // { image, meta, crop: {x, y, w, h} in source pixels, frameH, ratio }
let shownAt = -Infinity;
const flashes = []; // debug: when each flash started

function flash() {
    shownAt = performance.now();
    if (params.has('debug')) flashes.push(Math.round(shownAt));
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`failed to load ${src}`));
        img.src = src;
    });
}

// Bounding box of the non-transparent pixels over all animation frames,
// so the overlay is only as big as the text itself
function opaqueBox(image, frames) {
    const frameH = Math.floor(image.height / frames);
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    const g = c.getContext('2d');
    g.drawImage(image, 0, 0);
    const { data } = g.getImageData(0, 0, image.width, image.height);
    let x0 = image.width, y0 = frameH, x1 = -1, y1 = -1;
    for (let y = 0; y < image.height; y++) {
        const fy = y % frameH;
        for (let x = 0; x < image.width; x++) {
            if (data[(y * image.width + x) * 4 + 3] > 8) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (fy < y0) y0 = fy;
                if (fy > y1) y1 = fy;
            }
        }
    }
    if (x1 < 0) return { x: 0, y: 0, w: image.width, h: frameH };
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

async function loadJudge() {
    if (!judges) {
        try {
            const res = await fetch('skins/judge/judges.json');
            judges = res.ok ? await res.json() : {};
        } catch {
            judges = {};
        }
    }
    const names = Object.keys(judges);
    if (!names.length) {
        judge = null;
        note.textContent = 'No judge images. Run tools/import_judges.py (see README).';
        return;
    }
    note.textContent = '';
    const name = names.includes(settings.judge) ? settings.judge : names.includes('default') ? 'default' : names[0];
    const meta = judges[name];
    const image = await loadImage(`skins/judge/${encodeURIComponent(name)}/F_PR.png`);
    const frames = Math.max(1, meta.frames || 1);
    const frameH = Math.floor(image.height / frames);
    const crop = settings.trim ? opaqueBox(image, frames) : { x: 0, y: 0, w: image.width, h: frameH };
    // judge.lua sizes the whole frame to JUDGEF_WIDTH x JUDGEF_HEIGHT
    const ratio = { x: meta.width / image.width, y: meta.height / frameH };
    judge = { image, meta, crop, frameH, frames, ratio };

    const grow = { w: Math.max(0, meta.scaleWidth || 0), h: Math.max(0, meta.scaleHeight || 0) };
    canvas.width = Math.ceil(crop.w * ratio.x + grow.w);
    canvas.height = Math.ceil(crop.h * ratio.y + grow.h);
}

function draw(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!judge) return;
    const t = now - shownAt;
    const duration = Number(settings.duration) || 500;
    if (t < 0 || t >= duration) return;

    const { image, meta, crop, frameH, frames, ratio } = judge;
    // beatoraja dst: starts enlarged by (scaleWidth, scaleHeight) at the start
    // opacity and settles to full size and opacity after scaleTime
    const k = meta.scaleTime > 0 ? Math.min(1, t / meta.scaleTime) : 1;
    const extraW = (meta.scaleWidth || 0) * (1 - k);
    const extraH = (meta.scaleHeight || 0) * (1 - k);
    const alpha = ((meta.opacity ?? 255) + (255 - (meta.opacity ?? 255)) * k) / 255;
    const frame = Math.floor(t / (meta.cycle || 75)) % frames;

    const w = crop.w * ratio.x + extraW;
    const h = crop.h * ratio.y + extraH;
    ctx.globalAlpha = alpha;
    ctx.drawImage(image, crop.x, frame * frameH + crop.y, crop.w, crop.h, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    ctx.globalAlpha = 1;
}

function frame(now) {
    tracker.settlePresses(now);
    draw(now);
    requestAnimationFrame(frame);
}

async function applySettings() {
    Object.assign(settings, urlGameplay, gameplay, look);
    document.documentElement.style.setProperty('--scale', Number(settings.scale) || 1);
    await loadJudge();
    if (!demo) tracker.applySettings();
}

// ---------------------------------------------------------------- boot

if (params.has('debug')) window.lr2hp = Object.assign(tracker, { flashes });
tracker.on('emptyPoor', flash);

let gaugeWatch = null;
function watchGauge(name) {
    gaugeWatch?.close();
    gaugeWatch = watchSettings(host, name, (next) => {
        gameplay = next;
        applySettings();
    });
}

async function boot() {
    await applySettings();
    requestAnimationFrame(frame);
    if (demo) {
        tracker.session = tracker.newSession(1000);
        setInterval(() => {
            tracker.session.addEmptyPoor();
            flash();
        }, 1200);
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

boot();
