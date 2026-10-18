// osu!mania chart parsing and key layout helpers.

// Parses the parts of a .osu file we need. Returns null for non-mania charts
// (converts), since their note layout can't be reproduced here.
export function parseOsuMania(text) {
    let section = '';
    let mode = 0;
    let keys = 0;
    const notes = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('//')) continue;
        if (line.startsWith('[') && line.endsWith(']')) {
            section = line.slice(1, -1);
            continue;
        }
        if (section === 'General' && line.startsWith('Mode')) {
            mode = parseInt(line.split(':')[1], 10) || 0;
        } else if (section === 'Difficulty' && line.startsWith('CircleSize')) {
            keys = Math.round(parseFloat(line.split(':')[1]));
        } else if (section === 'HitObjects') {
            const p = line.split(',');
            if (p.length < 4) continue;
            const x = parseFloat(p[0]);
            const time = parseInt(p[2], 10);
            const type = parseInt(p[3], 10);
            const hold = (type & 128) !== 0;
            const end = hold && p[5] ? parseInt(p[5].split(':')[0], 10) : time;
            notes.push({ x, time, end, hold });
        }
    }
    if (mode !== 3 || keys <= 0) return null;
    for (const n of notes) {
        n.column = Math.min(keys - 1, Math.max(0, Math.floor(n.x * keys / 512)));
    }
    notes.sort((a, b) => a.time - b.time);
    return { keys, notes };
}

// Number of judgements the chart produces. Stable (ScoreV1) judges a hold note once;
// lazer and stable with ScoreV2 judge its head and tail separately.
export function judgementCount(chart, splitHolds) {
    const holds = chart.notes.filter((n) => n.hold).length;
    return chart.notes.length + (splitHolds ? holds : 0);
}

// osu!lazer mania hit windows (ms, half-width) for an OD, like ManiaHitWindows:
// each window is interpolated between its OD 0 / 5 / 10 values. HR tightens by 1.4, EZ loosens.
const WINDOW_RANGES = {
    perfect: [22.4, 19.4, 13.9],
    great: [64, 49, 34],
    good: [97, 82, 67],
    ok: [127, 112, 97],
    meh: [151, 136, 121],
    miss: [188, 173, 158],
};

// osu!stable mania hit windows: MAX is a fixed 16 ms, the rest shrink by 3 ms per OD.
const STABLE_WINDOWS = { perfect: [16, 0], great: [64, 3], good: [97, 3], ok: [127, 3], meh: [151, 3], miss: [188, 3] };

// stable: use osu!stable's windows instead of lazer's. HR / EZ scale either by 1.4.
export function maniaWindows(od, mods = new Set(), { stable = false } = {}) {
    let scale = 1;
    if (mods.has('HR')) scale /= 1.4;
    if (mods.has('EZ')) scale *= 1.4;
    const w = {};
    if (stable) {
        for (const [name, [base, perOd]] of Object.entries(STABLE_WINDOWS)) w[name] = (base - perOd * od) * scale;
        return w;
    }
    for (const [name, [min, mid, max]] of Object.entries(WINDOW_RANGES)) {
        const v = od > 5 ? mid + (max - mid) * (od - 5) / 5 : od < 5 ? mid - (mid - min) * (5 - od) / 5 : mid;
        w[name] = v * scale;
    }
    return w;
}

// The OD a play is judged with: lazer's Difficulty Adjust can override the map's own.
export function playOd(data) {
    const mods = data?.play?.mods?.array;
    if (Array.isArray(mods)) {
        const da = mods.find((m) => m?.acronym === 'DA');
        const od = Number(da?.settings?.overall_difficulty);
        if (Number.isFinite(od)) return od;
    }
    const od = Number(data?.beatmap?.stats?.od?.original);
    return Number.isFinite(od) ? od : 5;
}

// Key names accepted in the key layout settings, mapped to Windows virtual-key codes.
const NAMED_KEYS = {
    space: 0x20, spacebar: 0x20, enter: 0x0d, tab: 0x09, backspace: 0x08,
    lshift: 0xa0, rshift: 0xa1, lctrl: 0xa2, rctrl: 0xa3, lalt: 0xa4, ralt: 0xa5,
    capslock: 0x14, caps: 0x14,
    left: 0x25, up: 0x26, right: 0x27, down: 0x28,
    insert: 0x2d, delete: 0x2e, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
    ';': 0xba, '=': 0xbb, ',': 0xbc, '-': 0xbd, '.': 0xbe, '/': 0xbf, '`': 0xc0,
    '[': 0xdb, '\\': 0xdc, ']': 0xdd, "'": 0xde,
    semicolon: 0xba, comma: 0xbc, period: 0xbe, slash: 0xbf, quote: 0xde,
    num0: 0x60, num1: 0x61, num2: 0x62, num3: 0x63, num4: 0x64,
    num5: 0x65, num6: 0x66, num7: 0x67, num8: 0x68, num9: 0x69,
    'num*': 0x6a, 'num+': 0x6b, 'num-': 0x6d, 'num.': 0x6e, 'num/': 0x6f,
};

// Readable name for a virtual-key code, for diagnostics
export function vkName(vk) {
    if ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a)) return String.fromCharCode(vk);
    for (const [name, code] of Object.entries(NAMED_KEYS)) if (code === vk) return name;
    if (vk >= 0x70 && vk <= 0x87) return `F${vk - 0x6f}`;
    return `0x${vk.toString(16)}`;
}

export function keyNameToVk(name) {
    const k = name.trim().toLowerCase();
    if (!k) return -1;
    if (k in NAMED_KEYS) return NAMED_KEYS[k];
    if (/^[a-z0-9]$/.test(k)) return k.toUpperCase().charCodeAt(0);
    const f = /^f([1-9]|1[0-9]|2[0-4])$/.exec(k);
    if (f) return 0x6f + parseInt(f[1], 10);
    const hex = /^0x([0-9a-f]{1,2})$/.exec(k);
    if (hex) return parseInt(hex[1], 16);
    return -1;
}

// "S D F Space J K L" -> Map(vk -> column)
export function parseLayout(text) {
    const map = new Map();
    String(text || '').split(/\s+/).filter(Boolean).forEach((name, column) => {
        const vk = keyNameToVk(name);
        if (vk >= 0) map.set(vk, column);
    });
    return map;
}
