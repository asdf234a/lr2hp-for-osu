// Play simulator for checking empty POOR detection against osu!mania's rules.
import { PressClassifier } from '../lr2hp-for-osu/js/presses.js';

export const EARLY = 164; // miss window, OD8
export const LATE = 127; // 50 window, OD8

// Small deterministic PRNG so failures are reproducible
export function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

// 7K chordstream: 16ths at `bpm`, rows of 1-4 notes, mostly no jacks
export function chordstream(rand, { keys = 7, bpm = 180, rows = 400 } = {}) {
    const step = 60000 / bpm / 4;
    const notes = [];
    let prev = new Set();
    for (let r = 0; r < rows; r++) {
        const t = Math.round(1000 + r * step);
        const size = [1, 2, 2, 2, 3, 3, 4][Math.floor(rand() * 7)];
        const lanes = new Set();
        while (lanes.size < size) {
            const lane = Math.floor(rand() * keys);
            if (prev.has(lane) && rand() > 0.15) continue; // the odd jack/anchor
            lanes.add(lane);
        }
        for (const lane of lanes) notes.push({ time: t, end: t, hold: false, column: lane });
        prev = lanes;
    }
    return { keys, notes };
}

// A human-ish play: rolled chords, timing spread, and the usual mistakes
export function play(chart, rand, m = {}) {
    const { spread = 30, roll = 20, miss = 0.03, extraKey = 0.08, chatter = 0.03, early = 0.02, ghost = 0 } = m;
    const presses = [];
    const rows = new Map();
    for (const n of chart.notes) {
        if (!rows.has(n.time)) rows.set(n.time, []);
        rows.get(n.time).push(n);
    }
    for (const [time, row] of rows) {
        const base = time + Math.round((rand() * 2 - 1) * spread);
        for (const n of row) {
            if (rand() < miss) continue;
            let t = base + Math.round(rand() * roll);
            if (rand() < early) t = time - LATE - 5 - Math.floor(rand() * (EARLY - LATE - 10));
            presses.push({ t, lane: n.column });
            if (rand() < chatter) presses.push({ t: t + 15 + Math.floor(rand() * 40), lane: n.column });
        }
        if (rand() < extraKey) {
            // Neighbour of a chord key pressed along with it
            const n = row[Math.floor(rand() * row.length)];
            const lane = n.column + (rand() < 0.5 ? -1 : 1);
            if (lane >= 0 && lane < chart.keys) presses.push({ t: base + Math.round(rand() * roll), lane });
        }
    }
    if (ghost > 0) {
        const last = chart.notes[chart.notes.length - 1].time;
        for (let t = 1100; t < last; t += ghost * (0.5 + rand())) presses.push({ t: Math.round(t), lane: Math.floor(rand() * chart.keys) });
    }
    presses.sort((a, b) => a.t - b.t);
    return presses;
}

// osu!mania: a press goes to the oldest unjudged note in its lane that is still
// hittable; inside the 50 window it's a hit (hitErrors entry), earlier inside the
// miss window an early MISS, otherwise nothing (an empty POOR)
export function referenceJudge(chart, presses) {
    const lanes = Array.from({ length: chart.keys }, () => []);
    chart.notes.forEach((n) => lanes[n.column].push(n));
    const next = new Array(chart.keys).fill(0);
    const held = new Array(chart.keys).fill(-Infinity); // hold notes keep the lane busy
    return presses.map((p) => {
        const list = lanes[p.lane];
        let i = next[p.lane];
        while (i < list.length && list[i].time + LATE < p.t) i++;
        next[p.lane] = i;
        const note = list[i];
        if (note && note.time - EARLY <= p.t) {
            next[p.lane] = i + 1;
            if (note.hold) held[p.lane] = note.end;
            const off = p.t - note.time;
            return Math.abs(off) <= LATE ? { kind: 'hit', off } : { kind: 'earlyMiss' };
        }
        return { kind: 'empty' };
    });
}

// Feeds a play through the classifier the way the overlay sees it: presses as
// they happen, hitErrors in ~15 ms batches after a variable delay, and a song
// clock that is off by `skew` with some jitter
export function runClassifier(chart, presses, truth, rand, { skew = 0, jitter = 0, delay = [1, 20] } = {}) {
    const c = new PressClassifier(chart, {
        early: EARLY,
        late: LATE,
        songTime: (w) => w + skew + Math.sin(w / 37) * jitter,
        mode: 'all', // the reference judge counts every stray press
    });
    const entries = presses
        .map((p, k) => ({ wall: p.t + delay[0] + Math.floor(rand() * (delay[1] - delay[0])), off: truth[k].off, kind: truth[k].kind }))
        .filter((e) => e.kind === 'hit')
        .sort((a, b) => a.wall - b.wall);
    const end = Math.max(...presses.map((p) => p.t)) + 1000;
    let empties = 0;
    for (let w = 0, pi = 0, ei = 0; w < end; w += 15) {
        while (pi < presses.length && presses[pi].t <= w) c.press(presses[pi].lane, presses[pi++].t);
        const batch = [];
        while (ei < entries.length && entries[ei].wall <= w) batch.push(entries[ei++].off);
        if (batch.length) c.hitErrors(batch, w);
        empties += c.tick(w).filter((r) => r.result === 'empty').length;
    }
    return {
        expected: truth.filter((r) => r.kind === 'empty').length,
        empties,
        hits: c.stats.hit,
        truthHits: entries.length,
        calibration: c.calibration,
    };
}
