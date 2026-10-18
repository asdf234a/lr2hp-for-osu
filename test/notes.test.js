import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOsuMania, judgementCount, parseLayout, keyNameToVk } from '../lr2hp-for-osu/js/notes.js';
import { PlaySession, hitsToCounts } from '../lr2hp-for-osu/js/session.js';
import { SongClock } from '../lr2hp-for-osu/js/clock.js';

const OSU = `osu file format v14

[General]
Mode: 3

[Difficulty]
HPDrainRate:8
CircleSize:4
OverallDifficulty:8

[HitObjects]
64,192,1000,1,0,0:0:0:0:
192,192,1000,1,0,0:0:0:0:
320,192,1500,128,0,2500:0:0:0:0:
448,192,2000,1,0,0:0:0:0:
`;

test('parses mania notes, columns and holds', () => {
    const chart = parseOsuMania(OSU);
    assert.equal(chart.keys, 4);
    assert.deepEqual(chart.notes.map((n) => n.column), [0, 1, 2, 3]);
    assert.equal(chart.notes[2].hold, true);
    assert.equal(chart.notes[2].end, 2500);
    assert.equal(judgementCount(chart, false), 4);
    assert.equal(judgementCount(chart, true), 5);
});

test('non-mania charts are rejected', () => {
    assert.equal(parseOsuMania(OSU.replace('Mode: 3', 'Mode: 0')), null);
});

test('key layouts map to virtual-key codes', () => {
    assert.equal(keyNameToVk('Space'), 0x20);
    assert.equal(keyNameToVk('d'), 0x44);
    assert.equal(keyNameToVk(';'), 0xba);
    assert.equal(keyNameToVk('LShift'), 0xa0);
    const map = parseLayout('S D F Space J K L');
    assert.equal(map.get(0x20), 3);
    assert.equal(map.get(0x4c), 6);
});

test('session maps osu! judgements onto LR2 ones', () => {
    assert.deepEqual(hitsToCounts({ geki: 5, 300: 4, katu: 3, 100: 2, 50: 1, 0: 7 }), [5, 4, 5, 1, 7]);
    const s = new PlaySession({ notes: 1000, totalMode: 'custom', totalValue: 300, start: 'exhard', bottom: 'easy' });
    assert.equal(s.applyHits({ geki: 10 }), true);
    assert.ok(Math.abs(s.gauges.gauges.groove.value - 23) < 1e-9);
    s.addEmptyPoor();
    assert.ok(Math.abs(s.gauges.gauges.groove.value - 21) < 1e-9);
    assert.equal(s.applyHits({ geki: 3 }), false); // counters went down: restart
});

test('changing the note count replays the play so far', () => {
    const s = new PlaySession({ notes: 500, totalMode: 'custom', totalValue: 300 });
    s.applyHits({ geki: 10 });
    s.setNotes(1000);
    assert.ok(Math.abs(s.gauges.gauges.groove.value - 23) < 1e-9);
});

test('song clock trusts the freshest sample and interpolates', () => {
    const c = new SongClock();
    c.sample(1000, 0);
    const near = (a, b) => assert.ok(Math.abs(a - b) < 1, `${a} != ${b}`);
    c.sample(1100, 150); // 50 ms stale
    near(c.now(150), 1150);
    c.sample(1400, 300); // fresher than before
    near(c.now(400), 1500);
    c.sample(0, 500); // retry jumps back
    near(c.now(600), 100);
    c.sample(50, 700, 1.5);
    near(c.now(800), 200);
});
