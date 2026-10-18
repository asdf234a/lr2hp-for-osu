// Learns which key plays which lane from the key helper's presses and tosu's
// hitErrors, so the key layout doesn't have to be typed in.
//
// A hitErrors entry's offset says where the judged note was relative to the press
// that hit it. When the keys that went down around an entry land it on one row of
// notes (one key on one note, or k keys on a k-note chord), each of those keys
// played one of that row's lanes. Keys already settled explain their own note and
// are taken out of the row first. Two readings of that evidence:
//  - votes: the key gives 1/k to each lane left in the row; its own lane piles up
//    because chord partners keep changing (strong on 6K/7K)
//  - exclusions: every lane outside the row is ruled out for the key; its own lane
//    almost never is (strong on 4K, where chords cover most lanes)
// A key is settled when either reading is sure and they don't disagree. Evidence
// is kept per key count and fades slowly, so a changed keybind in osu! takes over.

const ENTRY_AFTER = 60; // an entry may come this long after its press
const ENTRY_BEFORE = 30; // ... or this long before it (helper lag)
const SETTLE = 70; // ms to wait before looking at an entry, so late presses show up
const CALIB_SAMPLES = 15;
const DECAY = 0.97; // old evidence fades with every new event for the same key
const MIN_VOTES = 3; // votes: the winning lane needs this many (faded) votes
const DOMINANCE = 2; // ... and this many times the runner-up's
const MIN_EVENTS = 4; // exclusions: (faded) events needed
const NOISE = 0.25; // ... share of events that may wrongly rule out the key's own lane
const CLEAR = 0.3; // ... share of events that must have ruled out every other lane

function median(values) {
    const s = [...values].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// votes: { [vk]: { n, in, out } } per key count (n = events, in[lane] = votes,
// out[lane] = events that ruled the lane out), shared across charts and saved by the caller
export class KeyLearner {
    constructor(chart, { songTime, votes, mirror = false }) {
        this.keys = chart.keys;
        this.notes = chart.notes.map((n) => ({ time: n.time, lane: mirror ? chart.keys - 1 - n.column : n.column }));
        this.notes.sort((a, b) => a.time - b.time);
        this.songTime = songTime;
        this.votes = votes;
        this.presses = []; // { vk, wall }
        this.entries = []; // { offset, wall }
        this.residuals = [];
        this.calibration = 0;
        this.changed = false;
    }

    get calibrated() {
        return this.residuals.length >= 5;
    }

    time(wall) {
        return this.songTime(wall) + this.calibration;
    }

    press(vk, wall) {
        this.presses.push({ vk, wall });
    }

    hitErrors(offsets, wall) {
        for (const offset of offsets) this.entries.push({ offset, wall });
    }

    // Notes within `tol` ms of `t`, any lane
    notesNear(t, tol) {
        let lo = 0;
        let hi = this.notes.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.notes[mid].time < t - tol) lo = mid + 1;
            else hi = mid;
        }
        const out = [];
        for (let i = lo; i < this.notes.length && this.notes[i].time <= t + tol; i++) out.push(this.notes[i]);
        return out;
    }

    // Looks at entries old enough that every press that could own them has arrived.
    // Returns true when the votes changed.
    flush(now) {
        this.changed = false;
        while (this.entries.length && now - this.entries[0].wall > SETTLE) {
            const e = this.entries.shift();
            const near = this.presses.filter((p) => e.wall - p.wall <= ENTRY_AFTER && e.wall - p.wall >= -ENTRY_BEFORE);
            if (!near.length) continue;

            // Keep the clock honest without knowing lanes: whichever nearby press puts
            // the judged note closest to a real note (any lane) gives the residual
            let fit = null;
            for (const p of near) {
                const implied = this.time(p.wall) - e.offset;
                for (const n of this.notesNear(implied, this.calibrated ? 20 : 60)) {
                    const d = n.time - implied;
                    if (!fit || Math.abs(d) < Math.abs(fit)) fit = d;
                }
            }
            if (fit !== null) {
                this.residuals.push(this.calibration + fit);
                if (this.residuals.length > CALIB_SAMPLES) this.residuals.shift();
                this.calibration = median(this.residuals);
            }
            if (!this.calibrated) continue;

            // Vote only when exactly one press lands the entry on a note, in exactly one lane
            const matches = [];
            for (const p of near) {
                const lanes = new Set(this.notesNear(this.time(p.wall) - e.offset, 12).map((n) => n.lane));
                if (lanes.size) matches.push({ p, lanes });
            }
            if (!matches.length) continue;
            const row = matches[0].lanes;
            const sameRow = matches.every((m) => m.lanes.size === row.size && [...m.lanes].every((l) => row.has(l)));
            if (!sameRow || matches.length > row.size) continue;
            // Keys whose lane is already settled explain their own note; the rest
            // share what's left of the row (one key, one lane left: a full vote)
            const known = learnedLayout(this.votes, this.keys);
            const keys = [...new Set(matches.map((m) => m.p.vk))];
            const lanesLeft = new Set(row);
            const open = [];
            for (const vk of keys) {
                const lane = known.get(vk);
                if (lane !== undefined && lanesLeft.has(lane)) lanesLeft.delete(lane);
                else open.push(vk);
            }
            if (!open.length || !lanesLeft.size || open.length > lanesLeft.size) continue;
            for (const vk of open) this.observe(vk, lanesLeft);
        }
        const oldest = (this.entries[0]?.wall ?? now) - ENTRY_AFTER - SETTLE;
        this.presses = this.presses.filter((p) => p.wall >= oldest);
        return this.changed;
    }

    // Key vk played one of `lanes`
    observe(vk, lanes) {
        let v = this.votes[vk];
        const ok = (a) => Array.isArray(a) && a.length === this.keys;
        if (!v || !ok(v.in) || !ok(v.out)) v = this.votes[vk] = { n: 0, in: new Array(this.keys).fill(0), out: new Array(this.keys).fill(0) };
        v.n = v.n * DECAY + 1;
        const fade = DECAY ** (1 / lanes.size);
        for (let lane = 0; lane < this.keys; lane++) {
            v.in[lane] = v.in[lane] * fade + (lanes.has(lane) ? 1 / lanes.size : 0);
            v.out[lane] = v.out[lane] * DECAY + (lanes.has(lane) ? 0 : 1);
        }
        this.changed = true;
    }
}

// The lane a key's votes settle on, or -1
function byVotes(v, keys) {
    let lane = 0;
    for (let i = 1; i < keys; i++) if (v.in[i] > v.in[lane]) lane = i;
    const runnerUp = Math.max(0, ...v.in.filter((_, i) => i !== lane));
    return v.in[lane] >= MIN_VOTES && v.in[lane] >= runnerUp * DOMINANCE ? lane : -1;
}

// The lane a key's exclusions settle on, or -1
function byExclusions(v, keys) {
    if (v.n < MIN_EVENTS) return -1;
    const [lane, second] = [...Array(keys).keys()].sort((a, b) => v.out[a] - v.out[b]);
    return v.out[lane] <= v.n * NOISE && v.out[second] >= v.n * CLEAR ? lane : -1;
}

// Confident key -> lane picks. Each lane goes to the key with the most evidence.
export function learnedLayout(votes, keys) {
    const picks = [];
    for (const [vk, v] of Object.entries(votes || {})) {
        const ok = (a) => Array.isArray(a) && a.length === keys;
        if (!v || !ok(v.in) || !ok(v.out)) continue;
        const a = byVotes(v, keys);
        const b = byExclusions(v, keys);
        if (a >= 0 && b >= 0 && a !== b) continue; // the two readings disagree
        const lane = a >= 0 ? a : b;
        if (lane >= 0) picks.push({ vk: Number(vk), lane, weight: v.n });
    }
    picks.sort((a, b) => b.weight - a.weight);
    const layout = new Map();
    const taken = new Set();
    for (const { vk, lane } of picks) {
        if (taken.has(lane)) continue;
        taken.add(lane);
        layout.set(vk, lane);
    }
    return layout;
}

// Learned picks first; the typed-in layout fills lanes and keys the learner hasn't settled
export function mergeLayouts(learned, manual) {
    const layout = new Map(learned);
    const lanes = new Set(learned.values());
    for (const [vk, lane] of manual) {
        if (!layout.has(vk) && !lanes.has(lane)) layout.set(vk, lane);
    }
    return layout;
}
