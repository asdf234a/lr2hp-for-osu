import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaySession, rankIndex, RANKS } from '../lr2hp/js/session.js';
import { maniaWindows } from '../lr2hp/js/notes.js';
import { PG, GR, GD, BD, MS } from '../lr2hp/js/gauge.js';

test('BMS rank thresholds', () => {
    const r = (rate) => RANKS[rankIndex(rate)];
    assert.equal(r(1), 'AAA');
    assert.equal(r(8 / 9), 'AAA');
    assert.equal(r(8 / 9 - 0.001), 'AA');
    assert.equal(r(7 / 9), 'AA');
    assert.equal(r(6 / 9), 'A');
    assert.equal(r(5 / 9), 'B');
    assert.equal(r(4 / 9), 'C');
    assert.equal(r(3 / 9), 'D');
    assert.equal(r(2 / 9), 'E');
    assert.equal(r(0.2), 'F');
    assert.equal(r(0), 'F');
});

test('EX score, rate over judged notes, combo breaks', () => {
    const s = new PlaySession({ notes: 100 });
    s.applyHits({ geki: 6, 300: 2, katu: 1, 100: 0, 50: 1, 0: 0 });
    assert.equal(s.exScore, 14);
    assert.equal(s.judged, 10);
    assert.ok(Math.abs(s.rate - 0.7) < 1e-9);
    assert.equal(s.comboBreaks, 1);
    s.addEmptyPoor();
    assert.equal(s.exScore, 14); // empty POOR doesn't touch the score
    assert.equal(s.judged, 10);
});

test('BMS combo: BAD and POOR break it, empty POOR does not', () => {
    const s = new PlaySession({ notes: 100 });
    s.applyHits({ geki: 5 });
    s.addEmptyPoor();
    s.applyHits({ geki: 5, katu: 3 });
    assert.equal(s.combo, 8);
    s.applyHits({ geki: 5, katu: 3, 50: 1 });
    assert.equal(s.combo, 0);
    assert.equal(s.maxCombo, 8);
});

test('FAST/SLOW from hit offsets and early misses', () => {
    const s = new PlaySession({ notes: 100 });
    const w = maniaWindows(8);
    s.addHitOffsets([-5, 10, -30, 60, -120, 0], w);
    assert.equal(s.fast[PG], 1);
    assert.equal(s.slow[PG], 1);
    assert.equal(s.fast[GR], 1);
    assert.equal(s.slow[GD], 1);
    assert.equal(s.fast[BD], 1);
    s.applyHits({ 0: 3 });
    s.earlyMisses = 1;
    assert.deepEqual(s.poorFastSlow(), [1, 2]);
    s.addEmptyPoor(true);
    s.addEmptyPoor(false);
    assert.equal(s.fast[MS], 1);
    assert.equal(s.slow[MS], 1);
});

test('lazer mania hit windows', () => {
    const w = maniaWindows(8);
    assert.equal(Math.round(w.miss), 164);
    assert.equal(Math.round(w.meh), 127);
    assert.equal(Math.round(w.great), 40);
    assert.ok(Math.abs(maniaWindows(5).perfect - 19.4) < 1e-9);
    assert.ok(Math.abs(maniaWindows(8, new Set(['HR'])).miss - 164 / 1.4) < 1e-9);
});
