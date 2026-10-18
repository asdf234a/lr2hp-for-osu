// Sorts key presses into "osu! used it on a note" and empty POOR.
//
// osu!lazer appends a timing offset to tosu's hitErrors for every note it judges
// PERFECT..MEH, the moment the press lands. So a press followed by a new hitErrors
// entry within a few ms is certainly a note hit, and that entry's offset tells us
// exactly where the song was at the press, which keeps the song clock calibrated.
//
// Entries carry no lane. Each one belongs to the press whose lane has a note
// where the entry's offset puts the judged note; in chords one entry can fit two
// keys equally well, and its partner may arrive a batch later. So entries and
// presses are paired tentatively (min total misfit over everything still open)
// and re-paired whenever either side changes; a pair only becomes final once its
// press is CONFIRM_WAIT old.
//
// A press left without an entry is either an early MISS (pressed inside the miss
// window but before the 50 window, which still uses up the note) or an empty
// POOR; the calibrated clock decides between the two.

const CONFIRM_WAIT = 60; // ms a press waits for its hitErrors entry
const ENTRY_EARLY = 30; // an entry may arrive this long before its press (helper lag)
const CALIB_SAMPLES = 15;
const DROP = 200; // cost of leaving an entry unpaired (fits only reach +-200 ms)

// Min-cost assignment (Hungarian method) for an n x m cost matrix, n <= m.
// Returns the column picked for each row.
function assign(cost) {
    const n = cost.length;
    const m = cost[0].length;
    const u = new Array(n + 1).fill(0);
    const v = new Array(m + 1).fill(0);
    const p = new Array(m + 1).fill(0);
    const way = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
        p[0] = i;
        let j0 = 0;
        const minv = new Array(m + 1).fill(Infinity);
        const done = new Array(m + 1).fill(false);
        do {
            done[j0] = true;
            const i0 = p[j0];
            let delta = Infinity;
            let j1 = 0;
            for (let j = 1; j <= m; j++) {
                if (done[j]) continue;
                const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                if (cur < minv[j]) {
                    minv[j] = cur;
                    way[j] = j0;
                }
                if (minv[j] < delta) {
                    delta = minv[j];
                    j1 = j;
                }
            }
            for (let j = 0; j <= m; j++) {
                if (done[j]) {
                    u[p[j]] += delta;
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }
            j0 = j1;
        } while (p[j0] !== 0);
        do {
            const j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
        } while (j0);
    }
    const rows = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j]) rows[p[j] - 1] = j - 1;
    return rows;
}

function median(values) {
    const s = [...values].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class PressClassifier {
    // songTime(wall): uncalibrated song position for a performance.now() timestamp
    // mode: 'lr2oraja' = empty POOR only when pressed up to 1 s before the lane's
    // next note (LR2's rule), 'near' = within nearWindow of it, 'all' = any stray press
    constructor(chart, { early, late, songTime, mirror = false, anyColumn = false, mode = 'lr2oraja', nearWindow = 500 }) {
        this.keys = chart.keys;
        this.early = early;
        this.late = late;
        this.songTime = songTime;
        this.mirror = mirror;
        this.anyColumn = anyColumn;
        this.mode = mode;
        this.nearWindow = nearWindow;
        // Own copies: each note is marked used on its own, because in jacks the
        // later note's entry can be settled before the earlier one's
        this.columns = Array.from({ length: chart.keys }, () => []);
        for (const n of chart.notes) this.columns[n.column].push({ time: n.time, end: n.end, used: false });
        this.next = new Array(chart.keys).fill(0); // first note in each lane that may still be unused
        this.first = chart.notes.length ? chart.notes[0].time : 0;
        this.last = chart.notes.reduce((m, n) => Math.max(m, n.end), 0);

        this.pending = []; // presses not settled yet, oldest first
        this.entries = []; // hitErrors entries not settled yet
        this.pairs = new Map(); // tentative: press -> { entry, note }
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

    get calibrated() {
        return this.residuals.length >= 3;
    }

    lanesOf(p) {
        return this.anyColumn ? [...this.columns.keys()] : [p.column];
    }

    use(col, i) {
        const list = this.columns[col];
        list[i].used = true;
        let j = this.next[col];
        while (j < list.length && list[j].used) j++;
        this.next[col] = j;
    }

    // Where the note judged with `offset` would be if press p made it, against the
    // nearest free note in p's lane: { c, i, d } with d = note - implied, or null
    fit(p, offset, taken = null) {
        const implied = this.time(p.wall) - offset;
        let best = null;
        for (const c of this.lanesOf(p)) {
            const list = this.columns[c];
            for (let i = this.next[c]; i < list.length; i++) {
                const note = list[i];
                if (note.used || taken?.has(note)) continue;
                const d = note.time - implied;
                if (d > 200) break;
                if (d < -200) continue;
                if (!best || Math.abs(d) < Math.abs(best.d)) best = { c, i, d };
            }
        }
        return best;
    }

    press(inputColumn, wall) {
        if (inputColumn < 0 || inputColumn >= this.keys) return;
        this.pending.push({ column: this.lane(inputColumn), wall });
        if (this.entries.length) this.repair();
    }

    // New hitErrors entries (offset = press time - note time, in ms)
    hitErrors(offsets, wall) {
        if (!offsets.length) return;
        for (const offset of offsets) this.entries.push({ offset, wall });
        this.repair();
    }

    // Re-pairs every open entry with the open presses it could belong to.
    // A note can only be hit once, so when two pairs land on the same note (two
    // presses in one lane a few ms apart) the worse one is re-fitted without it.
    repair() {
        this.pairs = new Map();
        const entries = this.entries;
        const presses = this.pending;
        if (!entries.length || !presses.length) return;
        const fits = entries.map(() => new Array(presses.length).fill(null));
        const cost = entries.map((e, r) => {
            const row = presses.map((p, k) => {
                const dt = e.wall - p.wall;
                if (dt > CONFIRM_WAIT || dt < -ENTRY_EARLY) return 1e6;
                const f = this.fit(p, e.offset);
                fits[r][k] = f;
                if (f) return Math.abs(f.d);
                // Before the clock is calibrated fits can miss; then an entry
                // with no fit still prefers the earliest press to none
                return this.calibrated ? 1e6 : DROP - 10 + k * 0.01;
            });
            for (let k = 0; k < entries.length; k++) row.push(DROP);
            return row;
        });
        let cols;
        for (let round = 0; round < 8; round++) {
            cols = assign(cost);
            const owner = new Map(); // note -> row
            let conflict = false;
            for (let r = 0; r < entries.length; r++) {
                const k = cols[r];
                const f = k < presses.length && cost[r][k] < DROP ? fits[r][k] : null;
                if (!f) continue;
                const note = this.columns[f.c][f.i];
                const other = owner.get(note);
                if (other === undefined) {
                    owner.set(note, r);
                    continue;
                }
                conflict = true;
                const ko = cols[other];
                const lose = cost[r][k] > cost[other][ko] || (cost[r][k] === cost[other][ko] && presses[k].wall > presses[ko].wall) ? r : other;
                if (lose === other) owner.set(note, r);
                const kl = cols[lose];
                const alt = this.fit(presses[kl], entries[lose].offset, new Set(owner.keys()));
                fits[lose][kl] = alt;
                cost[lose][kl] = alt ? Math.abs(alt.d) : 1e6;
            }
            if (!conflict) break;
        }
        entries.forEach((e, r) => {
            const k = cols[r];
            if (k >= 0 && k < presses.length && cost[r][k] < DROP) {
                const f = fits[r][k];
                this.pairs.set(presses[k], { entry: e, note: f ? this.columns[f.c][f.i] : null });
            }
        });
    }

    // Settles presses older than CONFIRM_WAIT.
    // Returns [{ result: 'hit' | 'empty' | 'earlyMiss' | 'ignored', fast }]
    tick(wall) {
        const results = [];
        let changed = false;
        while (this.pending.length && wall - this.pending[0].wall > CONFIRM_WAIT) {
            const p = this.pending.shift();
            const pair = this.pairs.get(p);
            if (pair) {
                this.pairs.delete(p);
                this.entries.splice(this.entries.indexOf(pair.entry), 1);
                this.confirm(p, pair.entry.offset, pair.note);
                results.push({ result: 'hit', fast: pair.entry.offset < 0 });
            } else {
                // Notes the still-open pairs are about to claim aren't free for this press
                const taken = new Set();
                for (const q of this.pairs.values()) if (q.note) taken.add(q.note);
                const r = this.resolveUnconfirmed(p, taken);
                this.stats[r.result]++;
                this.record(p, r.result);
                results.push(r);
            }
            changed = true;
        }
        // Entries nobody claimed in time came from presses we never saw
        const paired = new Set([...this.pairs.values()].map((q) => q.entry));
        const before = this.entries.length;
        this.entries = this.entries.filter((e) => paired.has(e) || wall - e.wall <= CONFIRM_WAIT + ENTRY_EARLY);
        if (changed || this.entries.length !== before) this.repair();
        return results;
    }

    // Final: press p hit `note` (from the pairing) with `offset`
    confirm(p, offset, note = null) {
        let best = null;
        if (note && !note.used) {
            const c = this.lanesOf(p).find((col) => this.columns[col].includes(note));
            if (c !== undefined) best = { c, i: this.columns[c].indexOf(note), d: note.time - (this.time(p.wall) - offset) };
        }
        if (!best) best = this.fit(p, offset);
        this.stats.hit++;
        this.record(p, 'hit', { offset });
        if (!best) return;
        this.use(best.c, best.i);
        // Residual between where the clock says we were and where osu! says we were
        const limit = this.calibrated ? 40 : 120;
        if (Math.abs(best.d) <= limit) {
            this.residuals.push(this.calibration + best.d);
            if (this.residuals.length > CALIB_SAMPLES) this.residuals.shift();
            this.calibration = median(this.residuals);
        }
    }

    resolveUnconfirmed(p, taken = new Set()) {
        const t = this.time(p.wall);
        let nearest = Infinity; // ms until the next note
        let since = Infinity; // ms since the previous note
        for (const c of this.lanesOf(p)) {
            const list = this.columns[c];
            let i = this.next[c];
            while (i < list.length && (list[i].used || taken.has(list[i]) || list[i].time + this.late < t)) i++;
            for (let j = i - 1; j >= 0; j--) {
                if (list[j].time <= t) {
                    since = Math.min(since, t - list[j].time);
                    break;
                }
            }
            const note = list[i];
            if (!note) continue;
            nearest = Math.min(nearest, note.time - t);
            // Inside the miss window: osu! scored an early MISS on this note.
            // `early` says it was before the 50 window, i.e. a real early-press MISS
            if (note.time - this.early <= t) {
                this.use(c, i);
                return { result: 'earlyMiss', fast: true, early: note.time - t > this.late };
            }
        }
        // FAST when the stray press is closer to the coming note than to the last one
        const fast = nearest < since;
        if (this.mode === 'lr2oraja') return { result: nearest <= 1000 ? 'empty' : 'ignored', fast: true };
        if (this.mode === 'near') return { result: nearest <= this.nearWindow ? 'empty' : 'ignored', fast };
        if (t < this.first - this.early || t > this.last + this.late) return { result: 'ignored', fast };
        return { result: 'empty', fast };
    }
}
