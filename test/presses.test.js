import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOsuMania } from '../lr2hp/js/notes.js';
import { PressClassifier } from '../lr2hp/js/presses.js';

// 4K chart: lane 0 at 1000 and 3000, lane 1 at 1000, lane 3 at 2000
const OSU = `[General]
Mode: 3
[Difficulty]
CircleSize:4
[HitObjects]
64,192,1000,1,0,0:0:0:0:
192,192,1000,1,0,0:0:0:0:
448,192,2000,1,0,0:0:0:0:
64,192,3000,1,0,0:0:0:0:
`;

const empties = (results) => results.filter((r) => r.result === 'empty').length;

// Wall time == song time, shifted by `skew` (the clock's error)
function make(skew = 0, opts = {}) {
    return new PressClassifier(parseOsuMania(OSU), {
        early: 164,
        late: 127,
        songTime: (wall) => wall + skew,
        mode: 'all',
        ...opts,
    });
}

test('a press followed by a hitErrors entry is a hit', () => {
    const c = make();
    c.press(0, 1010);
    c.hitErrors([10], 1012);
    assert.equal(empties(c.tick(2000)), 0);
    assert.equal(c.stats.hit, 1);
});

test('a press with no entry and no note nearby is an empty POOR', () => {
    const c = make();
    c.press(2, 1500);
    assert.equal(empties(c.tick(1550)), 0); // still waiting for a possible entry
    assert.equal(empties(c.tick(1600)), 1);
    assert.equal(c.stats.empty, 1);
});

test('a press in the miss window with no entry is an early MISS, not empty', () => {
    const c = make();
    c.press(3, 1850); // 150 ms early: past the 50 window, inside the miss window
    assert.equal(empties(c.tick(2000)), 0);
    assert.equal(c.stats.earlyMiss, 1);
    c.press(3, 1990); // the note is used up now
    assert.equal(empties(c.tick(2100)), 1);
});

test('a second press on an already hit note is an empty POOR', () => {
    const c = make();
    c.press(0, 1000);
    c.hitErrors([0], 1002);
    c.press(0, 1030);
    assert.equal(empties(c.tick(1200)), 1);
});

test('an entry that beats its press still matches it', () => {
    const c = make();
    c.hitErrors([-5], 995);
    c.press(1, 997);
    assert.equal(empties(c.tick(1200)), 0);
    assert.equal(c.stats.hit, 1);
});

test('the clock calibrates itself from hit offsets', () => {
    // Our clock runs 70 ms behind the real song
    const c = make(-70);
    for (const [lane, t] of [[0, 1000], [1, 1000], [3, 2000]]) {
        c.press(lane, t + 5);
        c.hitErrors([5], t + 7);
        c.tick(t + 100); // pairs become final after the confirm wait
    }
    assert.ok(Math.abs(c.calibration - 70) < 1, `calibration ${c.calibration}`);
    // Uncorrected, this press would look 270 ms early (empty); corrected it is 200 ms early
    // -> still outside the miss window, so empty
    c.press(0, 2800);
    assert.equal(empties(c.tick(3000)), 1);
    // 150 ms early in real time = early miss once calibrated (would be 220 ms / empty without it)
    const d = make(-70);
    d.calibration = 70;
    d.press(0, 2850);
    assert.equal(empties(d.tick(3000)), 0);
    assert.equal(d.stats.earlyMiss, 1);
});

test('presses outside the chart are ignored in all mode, far presses ignored in near mode', () => {
    const c = make();
    c.press(0, 100);
    c.press(0, 9000);
    assert.equal(empties(c.tick(10000)), 0);
    const n = make(0, { mode: 'near' });
    n.press(3, 1200); // 800 ms before the lane-3 note
    n.press(3, 1600); // 400 ms before
    assert.equal(empties(n.tick(1700)), 1);
});

test('stray presses are FAST before a note and SLOW after one', () => {
    const c = make();
    c.press(0, 1300); // 300 ms after the 1000 note, 1700 before the 3000 note
    c.press(3, 1700); // 300 ms before the 2000 note, nothing before it
    const r = c.tick(1500);
    assert.deepEqual(r.map((x) => [x.result, x.fast]), [['empty', false]]);
    assert.deepEqual(c.tick(1800).map((x) => [x.result, x.fast]), [['empty', true]]);
});

test('mirror flips lanes', () => {
    const c = make(0, { mirror: true });
    c.press(0, 1850); // physical lane 1 = chart lane 4, early miss on the 2000 note
    assert.equal(empties(c.tick(2000)), 0);
    assert.equal(c.stats.earlyMiss, 1);
});

test('lr2oraja mode: empty POOR only up to 1 s before the lane\'s next note', () => {
    const c = make(0, { mode: 'lr2oraja' });
    c.press(3, 700); // 1300 ms before the lane's 2000 note: too far
    c.press(3, 1100); // 900 ms before it
    assert.deepEqual(c.tick(1300).map((x) => x.result), ['ignored', 'empty']);
    const d = make(0, { mode: 'lr2oraja' });
    d.press(0, 1300); // after lane 0's 1000 note, 1700 before its 3000 note
    d.press(0, 2200); // 800 ms before the 3000 note
    assert.deepEqual(d.tick(2400).map((x) => x.result), ['ignored', 'empty']);
});

test('early-press MISS is flagged as early only before the 50 window', () => {
    const c = make(0);
    c.press(3, 1850); // 150 ms early: inside the miss window, before the 50 window
    const [r] = c.tick(2000);
    assert.equal(r.result, 'earlyMiss');
    assert.equal(r.early, true);
});
