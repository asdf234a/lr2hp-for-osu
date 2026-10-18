// Sorts key presses into "osu! used it on a note" and empty POOR.
//
// osu!lazer appends a timing offset to tosu's hitErrors for every note it judges
// PERFECT..MEH, the moment the press lands. So a press followed by a new hitErrors
// entry within a few ms is certainly a note hit, and that entry's offset tells us
// exactly where the song was at the press, which keeps the song clock calibrated.
// A press with no entry is either an early MISS (pressed inside the miss window
// but before the 50 window, which still uses up the note) or an empty POOR; the
// calibrated clock decides between the two.

const CONFIRM_WAIT = 60; // ms to wait for a hitErrors entry after a press
const ORPHAN_KEEP = 30; // ms an unmatched entry may wait for its press
const CALIB_SAMPLES = 15;

function median(values) {
    const s = [...values].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class PressClassifier {
    // songTime(wall): uncalibrated song position for a performance.now() timestamp
    constructor(chart, { early, late, songTime, mirror = false, anyColumn = false, mode = 'all', nearWindow = 500 }) {
        this.keys = chart.keys;
        this.early = early;
        this.late = late;
        this.songTime = songTime;
        this.mirror = mirror;
        this.anyColumn = anyColumn;
        this.mode = mode;
        this.nearWindow = nearWindow;
        this.columns = Array.from({ length: chart.keys }, () => []);
        for (const n of chart.notes) this.columns[n.column].push(n);
        this.next = new Array(chart.keys).fill(0);
        this.first = chart.notes.length ? chart.notes[0].time : 0;
        this.last = chart.notes.reduce((m, n) => Math.max(m, n.end), 0);

        this.pending = []; // presses waiting for a hitErrors entry
        this.orphans = []; // entries that arrived before their press
        this.residuals = [];
        this.calibration = 0;
        this.stats = { hit: 0, earlyMiss: 0, empty: 0, ignored: 0 };
        this.log = []; // recent decisions, for the debug view
    }

    record(p, result, extra) {
        this.log.push({ column: p.column, wall: Math.round(p.wall), song: Math.round(this.time(p.wall)), result, ...extra });
        if (this.log.length > 200) this.log.shift();
    }

    // Calibrated song position
    time(wall) {
        return this.songTime(wall) + this.calibration;
    }

    lane(inputColumn) {
        return this.mirror ? this.keys - 1 - inputColumn : inputColumn;
    }

    skipExpired(col, time) {
        const list = this.columns[col];
        let i = this.next[col];
        while (i < list.length && list[i].time + this.late < time) i++;
        this.next[col] = i;
        return i;
    }

    press(inputColumn, wall) {
        if (inputColumn < 0 || inputColumn >= this.keys) return;
        const p = { column: this.lane(inputColumn), wall };
        const orphan = this.orphans.findIndex((o) => wall - o.wall <= 5 && o.wall - wall <= ORPHAN_KEEP);
        if (orphan >= 0) {
            const [o] = this.orphans.splice(orphan, 1);
            this.confirm(p, o.offset);
            return;
        }
        this.pending.push(p);
    }

    // New hitErrors entries (offset = press time - note time, in ms)
    hitErrors(offsets, wall) {
        for (const offset of offsets) {
            const i = this.pending.findIndex((p) => wall - p.wall <= CONFIRM_WAIT && wall >= p.wall - 5);
            if (i >= 0) {
                const [p] = this.pending.splice(i, 1);
                this.confirm(p, offset);
            } else {
                this.orphans.push({ offset, wall });
            }
        }
    }

    // Returns the empty POOR presses that timed out without a hitErrors entry
    tick(wall) {
        this.orphans = this.orphans.filter((o) => wall - o.wall <= ORPHAN_KEEP);
        const results = [];
        while (this.pending.length && wall - this.pending[0].wall > CONFIRM_WAIT) {
            const p = this.pending.shift();
            const r = this.resolveUnconfirmed(p);
            this.stats[r]++;
            this.record(p, r);
            if (r === 'empty') results.push(p);
        }
        return results.length;
    }

    confirm(p, offset) {
        this.stats.hit++;
        this.record(p, 'hit', { offset });
        const est = this.time(p.wall);
        const cols = this.anyColumn ? [...this.columns.keys()] : [p.column];
        // The judged note sits at (press time - offset)
        let best = null;
        for (const c of cols) {
            const list = this.columns[c];
            for (let i = this.next[c]; i < list.length; i++) {
                const d = list[i].time - (est - offset);
                if (d > 200) break;
                if (!best || Math.abs(d) < Math.abs(best.d)) best = { c, i, d };
            }
        }
        if (!best) return;
        this.next[best.c] = best.i + 1;
        // Residual between where the clock says we were and where osu! says we were
        const limit = this.residuals.length >= 3 ? 40 : 120;
        if (Math.abs(best.d) <= limit) {
            this.residuals.push(this.calibration + best.d);
            if (this.residuals.length > CALIB_SAMPLES) this.residuals.shift();
            this.calibration = median(this.residuals);
        }
    }

    resolveUnconfirmed(p) {
        const t = this.time(p.wall);
        const cols = this.anyColumn ? [...this.columns.keys()] : [p.column];
        let nearest = Infinity;
        for (const c of cols) {
            const i = this.skipExpired(c, t);
            const note = this.columns[c][i];
            if (!note) continue;
            nearest = Math.min(nearest, note.time - t);
            // Inside the miss window: osu! scored an early MISS on this note
            if (note.time - this.early <= t) {
                this.next[c] = i + 1;
                return 'earlyMiss';
            }
        }
        if (this.mode === 'near') return nearest <= this.nearWindow ? 'empty' : 'ignored';
        if (t < this.first - this.early || t > this.last + this.late) return 'ignored';
        return 'empty';
    }
}
