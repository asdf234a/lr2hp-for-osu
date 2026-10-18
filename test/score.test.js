import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaySession, rankIndex, RANKS } from '../lr2hp-for-osu/js/session.js';
import { maniaWindows } from '../lr2hp-for-osu/js/notes.js';
import { PG, GR, GD, BD, MS } from '../lr2hp-for-osu/js/gauge.js';

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

test('early-press MISS turns its POOR into a BAD, whichever arrives first', () => {
    // POOR first, then the press is recognised as an early MISS
    const a = new PlaySession({ notes: 1000, totalMode: 'custom', totalValue: 300 });
    a.applyHits({ geki: 10 }, 0);
    a.applyHits({ geki: 10, 0: 1 }, 100);
    const hardBefore = a.gauges.gauges.hard.value;
    a.earlyMiss(160, true);
    assert.deepEqual(a.counts, [10, 0, 0, 1, 0]);
    assert.ok(a.gauges.gauges.hard.value > hardBefore); // -6 instead of -10
    assert.ok(Math.abs(a.gauges.gauges.hard.value - (100 - 6)) < 1e-9);
    // early MISS first, POOR a little later
    const b = new PlaySession({ notes: 1000, totalMode: 'custom', totalValue: 300 });
    b.earlyMiss(50, true);
    b.applyHits({ 0: 1 }, 120);
    assert.deepEqual(b.counts, [0, 0, 0, 1, 0]);
    assert.equal(b.fast[BD], 1);
    // a POOR far from any early MISS stays a POOR
    b.applyHits({ 0: 2 }, 5000);
    assert.deepEqual(b.counts, [0, 0, 0, 1, 1]);
    // with conversion off it stays a POOR, counted as FAST
    const c = new PlaySession({ notes: 1000 });
    c.applyHits({ 0: 1 }, 0);
    c.earlyMiss(10, false);
    assert.deepEqual(c.counts, [0, 0, 0, 0, 1]);
    assert.deepEqual(c.poorFastSlow(), [1, 0]);
});
