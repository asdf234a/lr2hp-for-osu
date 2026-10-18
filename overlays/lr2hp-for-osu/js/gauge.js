// LR2 gauge rules, ported from LR2oraja Endless Dream 0.4.0 (GaugeProperty.LR2 / GrooveGauge).
// Judge indices follow beatoraja: PG, GR, GD, BD, POOR (missed note), MISS (empty POOR).

export const PG = 0, GR = 1, GD = 2, BD = 3, PR = 4, MS = 5;

// Ordered from the strictest gauge down; GAS walks this list.
export const GAUGE_ORDER = ['exhard', 'hard', 'groove', 'easy'];

export const GAUGE_LABEL = {
    exhard: 'EX-HARD',
    hard: 'HARD',
    groove: 'GROOVE',
    easy: 'EASY',
};

export const CLEAR_LABEL = {
    exhard: 'EX-HARD CLEAR',
    hard: 'HARD CLEAR',
    groove: 'CLEAR',
    easy: 'EASY CLEAR',
};

// death: the gauge drops straight to 0 (failed) once it falls below this
const LR2_GAUGES = {
    easy:   { modifier: 'total',        min: 2, max: 100, init: 20,  border: 80, death: 0, value: [1.2, 1.2, 0.6, -3.2, -4.8, -1.6], guts: [] },
    groove: { modifier: 'total',        min: 2, max: 100, init: 20,  border: 80, death: 0, value: [1.0, 1.0, 0.5, -4.0, -6.0, -2.0], guts: [] },
    hard:   { modifier: 'modifyDamage', min: 0, max: 100, init: 100, border: 0,  death: 2, value: [0.1, 0.1, 0.05, -6.0, -10.0, -2.0], guts: [[32, 0.6]] },
    exhard: { modifier: 'modifyDamage', min: 0, max: 100, init: 100, border: 0,  death: 2, value: [0.1, 0.1, 0.05, -12.0, -20.0, -2.0], guts: [] },
};

export function isSurvivalGauge(type) {
    return type === 'hard' || type === 'exhard';
}

// TOTAL used when the chart has none. osu! charts never do, so this is always the source.
export function computeTotal(notes, mode = 'standard', custom = 300) {
    const n = Math.max(1, notes);
    switch (mode) {
        case 'lr2':
            // LR2's fallback when #TOTAL is missing
            return 160 + (n + Math.min(Math.max(n - 400, 0), 200)) * 0.16;
        case 'beatoraja':
            return Math.max(260, 7.605 * n / (0.01 * n + 6.5));
        case 'custom':
            return Number(custom) > 0 ? Number(custom) : 300;
        case 'standard':
        default:
            // IIDX-style standard TOTAL
            return 7.605 * n / (0.01 * n + 6.5);
    }
}

const MODIFIERS = {
    // Recovery scales with TOTAL / notes
    total(f, total, notes) {
        return f > 0 ? f * total / notes : f;
    },
    // Damage grows for TOTAL under 240 or charts under 1000 notes (LR2oraja MODIFY_DAMAGE)
    modifyDamage(f, total, notes) {
        if (f >= 0) return f;
        const fix1 = 10 / Math.min(10, Math.max(1, Math.floor(total / 16) - 5));
        let fix2 = 1;
        if (notes <= 20) fix2 = 10;
        else if (notes < 30) fix2 = 8 + 0.2 * (30 - notes);
        else if (notes < 60) fix2 = 5 + 0.2 * (60 - notes) / 3;
        else if (notes < 125) fix2 = 4 + (125 - notes) / 65;
        else if (notes < 250) fix2 = 3 + 0.008 * (250 - notes);
        else if (notes < 500) fix2 = 2 + 0.004 * (500 - notes);
        else if (notes < 1000) fix2 = 1 + 0.002 * (1000 - notes);
        return f * Math.max(fix1, fix2);
    },
};

export class Gauge {
    constructor(type, notes, total) {
        const prop = LR2_GAUGES[type];
        this.type = type;
        this.prop = prop;
        this.value = prop.init;
        const modify = MODIFIERS[prop.modifier];
        this.inc = prop.value.map((f) => modify(f, total, notes));
    }

    setValue(v) {
        // A survival gauge that hit 0 stays dead
        if (this.value > 0) {
            this.value = Math.min(Math.max(v, this.prop.min), this.prop.max);
            if (this.value < this.prop.death) this.value = 0;
        }
    }

    update(judge) {
        let inc = this.inc[judge];
        if (inc < 0) {
            for (const [below, rate] of this.prop.guts) {
                if (this.value < below) {
                    inc *= rate;
                    break;
                }
            }
        }
        this.setValue(this.value + inc);
    }

    get border() {
        return this.prop.border;
    }

    get max() {
        return this.prop.max;
    }

    isQualified() {
        return this.value > 0 && this.value >= this.prop.border;
    }
}

// All four gauges run in parallel; the shown one follows GAS (select-to-under):
// the strictest qualified gauge between `start` and `bottom`, else `bottom`.
export class GaugeSet {
    constructor({ notes, total, start = 'exhard', bottom = 'easy' }) {
        this.notes = notes;
        this.total = total;
        this.gauges = {};
        for (const type of GAUGE_ORDER) this.gauges[type] = new Gauge(type, notes, total);
        this.setRange(start, bottom);
    }

    setRange(start, bottom) {
        let s = GAUGE_ORDER.indexOf(start);
        let b = GAUGE_ORDER.indexOf(bottom);
        if (s < 0) s = 0;
        if (b < 0) b = GAUGE_ORDER.length - 1;
        if (b < s) b = s;
        this.range = GAUGE_ORDER.slice(s, b + 1);
    }

    update(judge) {
        for (const type of GAUGE_ORDER) this.gauges[type].update(judge);
    }

    get current() {
        for (const type of this.range) {
            if (this.gauges[type].isQualified()) return this.gauges[type];
        }
        return this.gauges[this.range[this.range.length - 1]];
    }

    // Clear lamp at the end of the chart, or null for FAILED
    clearType() {
        const g = this.current;
        return g.isQualified() ? g.type : null;
    }
}
