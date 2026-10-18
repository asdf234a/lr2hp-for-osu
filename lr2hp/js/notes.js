// osu!mania chart parsing and press-to-note matching for empty POOR detection.

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

// Number of judgements the chart produces. Stable judges a hold note once,
// lazer judges head and tail separately.
export function judgementCount(chart, lazer) {
    const holds = chart.notes.filter((n) => n.hold).length;
    return chart.notes.length + (lazer ? holds : 0);
}

// Decides, for each key press, whether osu! would have used it on a note.
// A press consumes the oldest note in its column that is still hittable:
// osu! accepts a press up to `early` ms before a note (an early miss) and
// up to `late` ms after it. Anything else is an empty POOR.
export class PressMatcher {
    constructor(chart, { early, late, mirror = false, anyColumn = false, mode = 'all', nearWindow = 500 }) {
        this.keys = chart.keys;
        this.early = early;
        this.late = late;
        this.mirror = mirror;
        this.anyColumn = anyColumn;
        this.mode = mode;
        this.nearWindow = nearWindow;
        this.columns = Array.from({ length: chart.keys }, () => []);
        for (const n of chart.notes) this.columns[n.column].push(n);
        this.next = new Array(chart.keys).fill(0);
        this.first = chart.notes.length ? chart.notes[0].time : 0;
        this.last = chart.notes.reduce((m, n) => Math.max(m, n.end), 0);
    }

    // Skip notes osu! has already given up on
    skipExpired(col, time) {
        const list = this.columns[col];
        let i = this.next[col];
        while (i < list.length && list[i].time + this.late < time) i++;
        this.next[col] = i;
        return list[i];
    }

    // Returns 'hit' (press went to a note), 'empty' (empty POOR) or 'ignored'.
    press(inputColumn, time) {
        if (inputColumn < 0 || inputColumn >= this.keys) return 'ignored';
        const col = this.mirror ? this.keys - 1 - inputColumn : inputColumn;

        const candidates = this.anyColumn ? [...this.columns.keys()] : [col];
        let best = -1;
        let bestNote = null;
        let nearest = Infinity;
        for (const c of candidates) {
            const note = this.skipExpired(c, time);
            if (!note) continue;
            nearest = Math.min(nearest, note.time - time);
            if (note.time - this.early <= time && (!bestNote || note.time < bestNote.time)) {
                best = c;
                bestNote = note;
            }
        }
        if (bestNote) {
            this.next[best]++;
            return 'hit';
        }

        if (this.mode === 'near') {
            return nearest <= this.nearWindow ? 'empty' : 'ignored';
        }
        // 'all': any stray press while the chart is running
        if (time < this.first - this.early || time > this.last + this.late) return 'ignored';
        return 'empty';
    }
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
