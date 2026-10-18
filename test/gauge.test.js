import test from 'node:test';
import assert from 'node:assert/strict';
import { Gauge, GaugeSet, computeTotal, PG, GR, GD, BD, PR, MS } from '../lr2hp-for-osu/js/gauge.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('standard TOTAL formula', () => {
    close(computeTotal(1000), 7.605 * 1000 / (10 + 6.5));
    close(computeTotal(1000, 'lr2'), 160 + (1000 + 200) * 0.16);
    close(computeTotal(300, 'lr2'), 160 + 300 * 0.16);
    assert.equal(computeTotal(100, 'beatoraja'), 260);
    assert.equal(computeTotal(100, 'custom', 400), 400);
});

test('groove: TOTAL/N recovery, LR2 damage, 2% floor', () => {
    const g = new Gauge('groove', 1000, 300);
    assert.equal(g.value, 20);
    g.update(PG);
    close(g.value, 20 + 300 / 1000);
    g.update(GD);
    close(g.value, 20 + 0.3 + 0.15);
    g.update(BD);
    close(g.value, 20.45 - 4);
    for (let i = 0; i < 10; i++) g.update(PR);
    assert.equal(g.value, 2);
    g.update(MS);
    assert.equal(g.value, 2);
});

test('easy uses 1.2x recovery and 0.8x damage', () => {
    const g = new Gauge('easy', 1000, 300);
    g.update(GR);
    close(g.value, 20 + 1.2 * 0.3);
    g.update(MS);
    close(g.value, 20.36 - 1.6);
});

test('hard: fixed recovery, guts below 32%, dies below 2% for good', () => {
    // TOTAL >= 240 and N >= 1000 keep the damage modifier at 1
    const g = new Gauge('hard', 1000, 300);
    g.update(PR);
    close(g.value, 90);
    g.value = 33;
    g.update(PR);
    close(g.value, 23);
    g.value = 31;
    g.update(PR);
    close(g.value, 31 - 6);
    g.value = 3;
    g.update(MS); // 3 - 2 * 0.6 = 1.8, under 2%
    assert.equal(g.value, 0);
    g.update(PG);
    assert.equal(g.value, 0);
    assert.equal(g.isQualified(), false);
});

test('hard damage grows with low TOTAL (LR2oraja MODIFY_DAMAGE)', () => {
    close(new Gauge('hard', 1000, 240).inc[PR], -10);
    close(new Gauge('hard', 1000, 200).inc[PR], -10 * 10 / 7); // floor(200/16) - 5 = 7
    close(new Gauge('hard', 1000, 160).inc[PR], -20);
    close(new Gauge('hard', 1000, 100).inc[PR], -100);
    close(new Gauge('hard', 1000, 200).inc[PG], 0.1);
});

test('ex-hard dies once it falls under 2%', () => {
    const g = new Gauge('exhard', 1000, 300);
    for (let i = 0; i < 4; i++) g.update(PR);
    close(g.value, 20);
    g.update(BD); // 20 - 12 = 8
    close(g.value, 8);
    g.update(MS);
    g.update(MS);
    g.update(MS); // 2
    close(g.value, 2);
    g.update(PG); // still alive at exactly 2
    g.update(MS); // 0.1 left -> under 2 -> dead
    assert.equal(g.value, 0);
});

test('hard damage grows on short charts (LR2: x2 at 500, x3 at 250)', () => {
    close(new Gauge('hard', 500, 300).inc[PR], -20);
    close(new Gauge('hard', 250, 300).inc[PR], -30);
    close(new Gauge('exhard', 300, 300).inc[BD], -12 * 2.8);
    close(new Gauge('hard', 100, 300).inc[PR], -10 * (4 + 25 / 65));
    close(new Gauge('hard', 20, 300).inc[PR], -100);
    close(new Gauge('hard', 1000, 300).inc[PR], -10);
    // recovery is untouched
    close(new Gauge('hard', 250, 300).inc[PG], 0.1);
});

test('GAS shows the strictest qualified gauge and falls back to bottom', () => {
    const set = new GaugeSet({ notes: 1000, total: 300, start: 'exhard', bottom: 'easy' });
    assert.equal(set.current.type, 'exhard');
    for (let i = 0; i < 5; i++) set.update(PR); // exhard 100 -> 0
    assert.equal(set.gauges.exhard.value, 0);
    assert.equal(set.current.type, 'hard');
    while (set.gauges.hard.value > 0) set.update(PR);
    // groove/easy both below 80 -> bottom gauge
    assert.equal(set.current.type, 'easy');
    assert.equal(set.clearType(), null);
    for (let i = 0; i < 1000; i++) set.update(PG);
    assert.equal(set.current.type, 'groove');
    assert.equal(set.clearType(), 'groove');
});

test('GAS range can stop at groove', () => {
    const set = new GaugeSet({ notes: 1000, total: 300, start: 'hard', bottom: 'groove' });
    assert.deepEqual(set.range, ['hard', 'groove']);
    while (set.gauges.hard.value > 0) set.update(PR);
    assert.equal(set.current.type, 'groove');
});
