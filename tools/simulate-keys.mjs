// Key layout learning accuracy over many simulated plays: node tools/simulate-keys.mjs
import { KeyLearner, learnedLayout } from '../lr2hp/js/keylearn.js';
import { rng, chordstream, play, referenceJudge } from '../test/sim.js';
function run(seed, keys, bpm, rows, mistakes, skew) {
  const laneVk = [...Array(keys)].map((_, i) => 0x41 + ((i * 5 + seed) % 26)); // arbitrary distinct keys
  const uniq = new Set(laneVk); if (uniq.size !== keys) return null;
  const rand = rng(seed * 31 + 7);
  const chart = chordstream(rng(seed), { keys, bpm, rows });
  const presses = play(chart, rand, mistakes);
  const truth = referenceJudge(chart, presses);
  const votes = {};
  const learner = new KeyLearner(chart, { songTime: (w) => w + skew, votes });
  const entries = presses.map((p, k) => ({ wall: p.t + 1 + Math.floor(rand() * 19), off: truth[k].off, kind: truth[k].kind })).filter((e) => e.kind === 'hit').sort((a, b) => a.wall - b.wall);
  const end = Math.max(...presses.map((p) => p.t)) + 1000;
  for (let w = 0, pi = 0, ei = 0; w < end; w += 15) {
    while (pi < presses.length && presses[pi].t <= w) { const p = presses[pi++]; learner.press(laneVk[p.lane], p.t); }
    const batch = []; while (ei < entries.length && entries[ei].wall <= w) batch.push(entries[ei++].off);
    if (batch.length) learner.hitErrors(batch, w);
    learner.flush(w);
  }
  const layout = learnedLayout(votes, keys);
  let wrong = 0; for (const [vk, lane] of layout) if (laneVk[lane] !== vk) wrong++;
  return { learned: layout.size, wrong };
}
const scenarios = [
  ['7K 170bpm clean', 7, 170, 300, {}, 30],
  ['7K 200bpm sloppy', 7, 200, 300, { extraKey: 0.2, chatter: 0.08, ghost: 300, spread: 40 }, -35],
  ['7K short 120 rows', 7, 180, 120, {}, 10],
  ['4K 200bpm', 4, 200, 300, { extraKey: 0.1 }, 20],
  ['6K 180bpm', 6, 180, 300, { chatter: 0.05 }, -20],
];
for (const [name, keys, bpm, rows, m, skew] of scenarios) {
  let full = 0, wrong = 0, runs = 0, learnedSum = 0;
  for (let seed = 1; seed <= 40; seed++) { const r = run(seed, keys, bpm, rows, m, skew); if (!r) continue; runs++; if (r.learned === keys) full++; wrong += r.wrong; learnedSum += r.learned; }
  console.log(`${name.padEnd(20)} full layout ${full}/${runs}  avg learned ${(learnedSum / runs).toFixed(2)}/${keys}  wrong keys ${wrong}`);
}
