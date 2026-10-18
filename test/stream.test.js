// Dense-stream check: replays a 7K chart with stray taps through a reference
// osu!mania judge and makes sure the classifier finds every empty POOR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PressClassifier } from '../lr2hp/js/presses.js';

const EARLY = 164; // miss window, OD8
const LATE = 127; // 50 window, OD8

// Small deterministic PRNG so failures are reproducible
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

function makeChart(rand, keys = 7, count = 600) {
    const notes = [];
    let t = 1000;
    for (let i = 0; i < count; i++) {
        t += 40 + Math.floor(rand() * 80);
        notes.push({ time: t, end: t, hold: false, column: Math.floor(rand() * keys) });
    }
    return { keys, notes };
}

// osu!mania rules: a press goes to the oldest unjudged note in its lane that is
// still hittable; inside the 50 window it's a hit (hitErrors entry), earlier
// inside the miss window it's an early MISS, otherwise nothing (empty POOR).
function referenceJudge(chart, presses) {
    const lanes = Array.from({ length: chart.keys }, () => []);
    chart.notes.forEach((n) => lanes[n.column].push(n));
    const next = new Array(chart.keys).fill(0);
    const out = [];
    for (const p of presses) {
        const list = lanes[p.lane];
        let i = next[p.lane];
        while (i < list.length && list[i].time + LATE < p.t) i++;
        next[p.lane] = i;
        const note = list[i];
        if (note && note.time - EARLY <= p.t) {
            next[p.lane] = i + 1;
            const off = p.t - note.time;
            out.push(Math.abs(off) <= LATE ? { kind: 'hit', off } : { kind: 'earlyMiss' });
        } else {
            out.push({ kind: 'empty' });
        }
    }
    return out;
}

function run(seed, { skew, strayEvery }) {
    const rand = rng(seed);
    const chart = makeChart(rand);
    const presses = chart.notes
        .filter(() => rand() > 0.03) // a few notes left to pass
        .map((n) => ({ t: n.time + Math.round((rand() * 2 - 1) * 35), lane: n.column }));
    // Stray taps scattered through the chart, any lane
    const last = chart.notes[chart.notes.length - 1].time;
    for (let t = 1100; t < last; t += strayEvery * (0.5 + rand())) {
        presses.push({ t: Math.round(t), lane: Math.floor(rand() * chart.keys) });
    }
    presses.sort((a, b) => a.t - b.t);
    const truth = referenceJudge(chart, presses);

    // Wall clock == song time; our song clock is off by `skew` until calibrated
    const c = new PressClassifier(chart, { early: EARLY, late: LATE, songTime: (w) => w + skew });
    // tosu delivers hitErrors in batches (~15 ms timer granularity on Windows)
    const entries = presses
        .map((p, k) => ({ wall: p.t + 2, off: truth[k].off, kind: truth[k].kind }))
        .filter((e) => e.kind === 'hit');
    let ei = 0;
    let empties = 0;
    const settle = (w) => {
        empties += c.tick(w).filter((r) => r.result === 'empty').length;
    };
    for (let w = 0, pi = 0; w < last + 1000; w += 15) {
        while (pi < presses.length && presses[pi].t <= w) c.press(presses[pi].lane, presses[pi++].t);
        const batch = [];
        while (ei < entries.length && entries[ei].wall <= w) batch.push(entries[ei++].off);
        if (batch.length) c.hitErrors(batch, w);
        settle(w);
    }
    const expected = truth.filter((r) => r.kind === 'empty').length;
    return { expected, empties, hits: c.stats.hit, truthHits: entries.length };
}

test('every empty POOR is found in a dense 7K stream', () => {
    for (const seed of [1, 2, 3]) {
        const r = run(seed, { skew: 0, strayEvery: 300 });
        assert.equal(r.empties, r.expected, `seed ${seed}: ${JSON.stringify(r)}`);
        assert.equal(r.hits, r.truthHits, `seed ${seed}: ${JSON.stringify(r)}`);
    }
});

test('still exact when the song clock starts 40 ms off', () => {
    for (const seed of [4, 5]) {
        const r = run(seed, { skew: -40, strayEvery: 250 });
        assert.ok(Math.abs(r.empties - r.expected) <= 1, `seed ${seed}: ${JSON.stringify(r)}`);
    }
});

test('a stray tap just before a hit in another lane stays an empty POOR', () => {
    const chart = { keys: 7, notes: [{ time: 1000, end: 1000, hold: false, column: 0 }, { time: 3000, end: 3000, hold: false, column: 2 }] };
    const c = new PressClassifier(chart, { early: EARLY, late: LATE, songTime: (w) => w });
    c.press(2, 990); // stray: lane 2's note is 2 s away
    c.press(0, 1000); // the real hit
    c.hitErrors([0], 1002);
    const r = c.tick(1200);
    assert.deepEqual(r.map((x) => x.result), ['empty']);
    assert.equal(c.stats.hit, 1);
});

// Chords: three keys go down together but only two lanes have notes
function chordCase(order, offsets, extra = []) {
    const notes = [
        { time: 1000, end: 1000, hold: false, column: 1 },
        { time: 1000, end: 1000, hold: false, column: 5 },
        ...extra,
    ].sort((a, b) => a.time - b.time);
    const c = new PressClassifier({ keys: 7, notes }, { early: EARLY, late: LATE, songTime: (w) => w });
    for (const lane of order) c.press(lane, 1003);
    c.hitErrors(offsets, 1006);
    return c.tick(1300).map((x) => x.result);
}

test('chord with an extra key: the extra key is an empty POOR whatever the press order', () => {
    for (const order of [[3, 1, 5], [1, 3, 5], [1, 5, 3], [5, 3, 1]]) {
        assert.deepEqual(chordCase(order, [3, 3]), ['empty'], `order ${order}`);
        assert.deepEqual(chordCase(order, [2, 4]), ['empty'], `order ${order}`);
    }
});

test('chord with an extra key whose lane has a note soon: early MISS, as osu! scores it', () => {
    const soon = [{ time: 1150, end: 1150, hold: false, column: 3 }];
    assert.deepEqual(chordCase([3, 1, 5], [3, 3], soon), ['earlyMiss']);
});

test('chord in a dense 7K stream with an extra key each time', () => {
    const rand = rng(9);
    const notes = [];
    const presses = [];
    let t = 1000;
    for (let i = 0; i < 200; i++) {
        t += 150 + Math.floor(rand() * 100);
        const lanes = [...Array(7).keys()].sort(() => rand() - 0.5);
        const [a, b, stray] = lanes;
        notes.push({ time: t, end: t, hold: false, column: a }, { time: t, end: t, hold: false, column: b });
        const jitter = () => Math.round((rand() * 2 - 1) * 20);
        for (const lane of [stray, a, b].sort(() => rand() - 0.5)) presses.push({ t: t + jitter(), lane });
    }
    notes.sort((x, y) => x.time - y.time);
    presses.sort((x, y) => x.t - y.t);
    const chart = { keys: 7, notes };
    const truth = referenceJudge(chart, presses);
    const c = new PressClassifier(chart, { early: EARLY, late: LATE, songTime: (w) => w });
    const entries = presses.map((p, k) => ({ wall: p.t + 2, off: truth[k].off })).filter((e, k) => truth[k].kind === 'hit');
    let empties = 0;
    for (let w = 0, pi = 0, ei = 0; w < t + 1000; w += 15) {
        while (pi < presses.length && presses[pi].t <= w) c.press(presses[pi].lane, presses[pi++].t);
        const batch = [];
        while (ei < entries.length && entries[ei].wall <= w) batch.push(entries[ei++].off);
        if (batch.length) c.hitErrors(batch, w);
        empties += c.tick(w).filter((r) => r.result === 'empty').length;
    }
    const expected = truth.filter((r) => r.kind === 'empty').length;
    assert.equal(empties, expected, JSON.stringify({ empties, expected }));
});
