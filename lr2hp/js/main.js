import { GAUGE_LABEL, CLEAR_LABEL, GAUGE_ORDER, isSurvivalGauge } from './gauge.js';
import { GaugeRenderer } from './render.js';
import { PlayTracker, GAMEPLAY_DEFAULTS, settingsFromUrl, watchSettings } from './tracker.js';

const DEFAULTS = {
    ...GAMEPLAY_DEFAULTS,
    parts: 50,
    length: 0,
    skin: 'simple2',
    scale: 1,
    showLabel: true,
    showAllGauges: false,
    showEmptyPoorStatus: true,
    showPressStats: false,
};

const SHORT = { exhard: 'EXH', hard: 'HRD', groove: 'GRV', easy: 'EZ' };

const params = new URLSearchParams(location.search);
const host = params.get('host') || location.host || '127.0.0.1:24050';
const demo = params.has('demo');

// Any setting can also be given in the URL, e.g. ?startGauge=HARD&scale=0.8
const settings = settingsFromUrl(DEFAULTS, params);
const els = {
    root: document.getElementById('root'),
    canvas: document.getElementById('gauge'),
    label: document.getElementById('label'),
    all: document.getElementById('all'),
    status: document.getElementById('status'),
    top: document.querySelector('.top'),
};
const renderer = new GaugeRenderer(els.canvas);
const tracker = new PlayTracker({ host, settings, debug: params.has('debug') });

async function applySettings(next = {}) {
    Object.assign(settings, next);
    document.documentElement.style.setProperty('--scale', Number(settings.scale) || 1);
    renderer.setLayout(Number(settings.parts) || 50, Number(settings.length) || 0);
    try {
        await renderer.setSkin(settings.skin || 'simple2');
    } catch (e) {
        console.warn(e);
        await renderer.setSkin('simple2');
    }
    els.root.style.width = `${renderer.width}px`;
    if (!demo) tracker.applySettings();
}

function frame(now) {
    tracker.settlePresses(now);
    const session = tracker.session;
    const shown = tracker.visible && session;
    els.root.classList.toggle('hidden', !shown);
    if (shown) {
        const g = session.gauges.current;
        renderer.draw(g, now);

        let label = GAUGE_LABEL[g.type];
        let cls = g.type;
        if (tracker.inResults) {
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
        const status = demo ? '' : tracker.emptyPoorStatus(settings.showPressStats);
        els.status.textContent = settings.showEmptyPoorStatus || settings.showPressStats ? status : '';
        els.top.classList.toggle('empty', !els.label.textContent && !els.all.textContent && !els.status.textContent);
    }
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- demo (no tosu)

function runDemo() {
    const notes = 1200;
    let hits = { geki: 0, 300: 0, katu: 0, 100: 0, 50: 0, 0: 0 };
    const reset = () => {
        hits = { geki: 0, 300: 0, katu: 0, 100: 0, 50: 0, 0: 0 };
        tracker.session = tracker.newSession(notes);
        tracker.inResults = false;
        tracker.visible = true;
    };
    reset();
    let phase = 0;
    setInterval(() => {
        if (tracker.inResults) return;
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
        tracker.session.applyHits(hits);
        if (Math.random() < 0.05) tracker.session.addEmptyPoor();
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
    if (window.COUNTER_PATH) watchSettings(host, window.COUNTER_PATH, applySettings);
}

boot();
