// Empty POOR detection accuracy over many simulated chordstream plays: node tools/simulate.mjs
import { rng, chordstream, play, referenceJudge, runClassifier } from '../test/sim.js';
const configs = [
    ['180 typical', 180, {}, {}],
    ['200 sloppy', 200, { spread: 45, roll: 30, extraKey: 0.2, chatter: 0.06 }, {}],
    ['220 skew-40', 220, { extraKey: 0.12 }, { skew: -40 }],
    ['220 skew-40 jit6', 220, { extraKey: 0.12 }, { skew: -40, jitter: 6 }],
    ['160 ghost skew25', 160, { ghost: 400 }, { skew: 25 }],
    ['160 ghost skew25 jit4', 160, { ghost: 400 }, { skew: 25, jitter: 4 }],
    ['240 dense extra', 240, { extraKey: 0.25, chatter: 0.05 }, { skew: 15 }],
];
for (const [name, bpm, m, clock] of configs) {
    let exp = 0, got = 0, exact = 0, runs = 0, worst = 0;
    for (let seed = 1; seed <= 30; seed++) {
        const rand = rng(seed * 7919);
        const chart = chordstream(rand, { bpm });
        const presses = play(chart, rand, m);
        const truth = referenceJudge(chart, presses);
        const r = runClassifier(chart, presses, truth, rand, clock);
        exp += r.expected; got += r.empties; runs++;
        if (r.empties === r.expected) exact++;
        worst = Math.max(worst, Math.abs(r.empties - r.expected));
    }
    console.log(`${name.padEnd(24)} empties ${got}/${exp} (${(100 * got / exp).toFixed(2)}%)  exact runs ${exact}/${runs}  worst ±${worst}`);
}
