import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyLearner, learnedLayout, mergeLayouts } from '../lr2hp/js/keylearn.js';
import { parseLayout } from '../lr2hp/js/notes.js';
import { rng, chordstream, play, referenceJudge } from './sim.js';

// The player's real layout, which the learner never sees
const SECRET = parseLayout("S D F Space L ; '");
const LANE_VK = [...SECRET].sort((a, b) => a[1] - b[1]).map(([vk]) => vk);

// Plays a chart and feeds the learner presses (as keys) and hitErrors entries
function learnFrom(chart, rand, votes, { skew = 0, mistakes = {}, laneVk = LANE_VK } = {}) {
    const presses = play(chart, rand, mistakes);
    const truth = referenceJudge(chart, presses);
    const learner = new KeyLearner(chart, { songTime: (w) => w + skew, votes });
    const entries = presses
        .map((p, k) => ({ wall: p.t + 1 + Math.floor(rand() * 19), off: truth[k].off, kind: truth[k].kind }))
        .filter((e) => e.kind === 'hit')
        .sort((a, b) => a.wall - b.wall);
    const end = Math.max(...presses.map((p) => p.t)) + 1000;
    for (let w = 0, pi = 0, ei = 0; w < end; w += 15) {
        while (pi < presses.length && presses[pi].t <= w) {
            const p = presses[pi++];
            learner.press(laneVk[p.lane], p.t);
        }
        const batch = [];
        while (ei < entries.length && entries[ei].wall <= w) batch.push(entries[ei++].off);
        if (batch.length) learner.hitErrors(batch, w);
        learner.flush(w);
    }
    return learnedLayout(votes, chart.keys);
}

test('learns a 7K layout from one chordstream play', () => {
    for (const seed of [1, 2, 3]) {
        const votes = {};
        const layout = learnFrom(chordstream(rng(seed), { bpm: 170, rows: 300 }), rng(seed + 100), votes, { skew: 30 });
        assert.deepEqual([...layout].sort((a, b) => a[1] - b[1]), [...SECRET].sort((a, b) => a[1] - b[1]), `seed ${seed}`);
    }
});

test('ghost taps, extra keys and chatter do not teach it wrong keys', () => {
    const votes = {};
    const layout = learnFrom(chordstream(rng(7), { bpm: 200, rows: 400 }), rng(8), votes, {
        skew: -35,
        mistakes: { extraKey: 0.2, chatter: 0.08, ghost: 300, spread: 40 },
    });
    for (const [vk, lane] of layout) assert.equal(SECRET.get(vk), lane, `key ${vk} -> lane ${lane}`);
    assert.ok(layout.size >= 6, `learned only ${layout.size} keys`);
});

test('a changed keybind takes over after a few plays', () => {
    const votes = {};
    learnFrom(chordstream(rng(11), { rows: 300 }), rng(12), votes);
    // lane 3 moves from Space to J
    const moved = [...LANE_VK];
    moved[3] = 'J'.charCodeAt(0);
    let layout;
    for (const seed of [13, 14, 15]) layout = learnFrom(chordstream(rng(seed), { rows: 300 }), rng(seed + 50), votes, { laneVk: moved });
    assert.equal(layout.get('J'.charCodeAt(0)), 3);
    assert.notEqual(layout.get(0x20), 3);
});

test('learned keys override the typed layout, which fills the rest', () => {
    const learned = new Map([[0x41, 0], [0x42, 1]]);
    const manual = parseLayout('S D F');
    const merged = mergeLayouts(learned, manual);
    assert.deepEqual([...merged].sort((a, b) => a[1] - b[1]), [[0x41, 0], [0x42, 1], [0x46, 2]]);
});

test('needs enough agreeing evidence before trusting a key', () => {
    const ev = (n, inV, out) => ({ n, in: inV, out });
    assert.equal(learnedLayout({ 65: ev(2, [2, 0, 0], [0, 2, 2]) }, 3).size, 0); // too little
    assert.equal(learnedLayout({ 65: ev(6, [3, 3, 0], [0, 0, 6]) }, 3).size, 0); // lanes 0 and 1 tie
    assert.equal(learnedLayout({ 65: ev(6, [5, 1, 0], [0, 4, 6]) }, 3).get(65), 0);
    // the two readings pointing at different lanes: not trusted
    assert.equal(learnedLayout({ 65: ev(8, [6, 1, 1], [5, 0, 8]) }, 3).size, 0);
});
