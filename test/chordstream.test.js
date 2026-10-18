import test from 'node:test';
import assert from 'node:assert/strict';
import { rng, chordstream, play, referenceJudge, runClassifier } from './sim.js';

// Exact cases: the song clock may be off by a constant (it calibrates), but doesn't wobble
const exact = [
    { name: '180 BPM, typical mistakes', bpm: 180, mistakes: {}, clock: {} },
    { name: '200 BPM, sloppy (wide timing, many extra keys)', bpm: 200, mistakes: { spread: 45, roll: 30, extraKey: 0.2, chatter: 0.06 }, clock: {} },
    { name: '240 BPM, dense with extra keys', bpm: 240, mistakes: { extraKey: 0.25, chatter: 0.05 }, clock: { skew: 15 } },
    { name: '160 BPM, ghost tapping, clock 25 ms off', bpm: 160, mistakes: { ghost: 400 }, clock: { skew: 25 } },
];

for (const c of exact) {
    test(`chordstream: ${c.name}`, () => {
        for (const seed of [11, 12, 13, 14, 15]) {
            const rand = rng(seed);
            const chart = chordstream(rand, { bpm: c.bpm });
            const presses = play(chart, rand, c.mistakes);
            const truth = referenceJudge(chart, presses);
            const r = runClassifier(chart, presses, truth, rand, c.clock);
            assert.equal(r.empties, r.expected, `seed ${seed}: ${JSON.stringify(r)}`);
        }
    });
}

// A clock that wobbles by a few ms can flip presses sitting right on the miss
// window's edge between early MISS and empty POOR; stay within 2%
test('chordstream: 220 BPM, clock 40 ms off and wobbling 6 ms', () => {
    let expected = 0;
    let empties = 0;
    for (const seed of [21, 22, 23, 24, 25]) {
        const rand = rng(seed);
        const chart = chordstream(rand, { bpm: 220 });
        const presses = play(chart, rand, { extraKey: 0.12 });
        const truth = referenceJudge(chart, presses);
        const r = runClassifier(chart, presses, truth, rand, { skew: -40, jitter: 6 });
        expected += r.expected;
        empties += r.empties;
    }
    assert.ok(Math.abs(empties - expected) <= expected * 0.02, `${empties} vs ${expected}`);
});
