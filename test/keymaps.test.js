import test from 'node:test';
import assert from 'node:assert/strict';
import { inputKeyName, lazerCombinationName, xnaKeyName, parseStableConfig, lazerLayouts } from '../keyhook/keymaps.mjs';
import { parseLayout } from '../lr2hp/js/notes.js';

test('lazer InputKey codes map to layout key names', () => {
    // A real 7K binding from client.realm: S D F Space L ; '
    assert.deepEqual([101, 86, 88, 51, 94, 124, 125].map(inputKeyName), ['S', 'D', 'F', 'Space', 'L', ';', "'"]);
    assert.equal(inputKeyName(109), '0');
    assert.equal(inputKeyName(67), 'num0');
    assert.equal(inputKeyName(10), 'F1');
    assert.equal(inputKeyName(263), 'LShift');
    assert.equal(inputKeyName(268), 'RAlt');
    assert.equal(lazerCombinationName('1,83'), 'A'); // modifier + key
    assert.equal(lazerCombinationName('0'), null);
});

test('lazer KeyBinding rows become one layout per key count', () => {
    const rows = [
        [0, '101'], [0, '0'], [1, '86'], [1, '0'], [2, '124'], [2, '0'], [3, '125'], [3, '0'],
    ].map(([Action, KeyCombination]) => ({ Variant: 4, Action, KeyCombination }));
    rows.push({ Variant: 1002, Action: 0, KeyCombination: '104' }); // co-op stage: skipped
    rows.push({ Variant: 2, Action: 0, KeyCombination: '0' }, { Variant: 2, Action: 1, KeyCombination: '92' });
    assert.deepEqual(lazerLayouts(rows), { 4: "S D ; '", 2: '? J' });
});

test('stable osu!.<user>.cfg layouts are read with the selected option', () => {
    const cfg = [
        'ManiaLayouts4K = S D OemSemicolon OemQuotes',
        'ManiaLayoutSelected4K = 0',
        'ManiaLayouts7K = S D F Space L OemSemicolon OemQuotes',
        'ManiaLayouts10KSplit = D F Space J K E R RightAlt U I',
        'ManiaLayouts10K = D1 Q W E Space OemPeriod P OemOpenBrackets OemCloseBrackets OemPipe',
        'ManiaLayouts8K = S D F Space K L OemSemicolon OemQuotes LeftControl',
        'ManiaLayouts5K = D F Space J K|S D Space L OemSemicolon',
        'ManiaLayoutSelected5K = 1',
    ].join('\r\n');
    const out = parseStableConfig(cfg);
    assert.equal(out[4], "S D ; '");
    assert.equal(out[7], "S D F Space L ; '");
    assert.equal(out[10], '1 Q W E Space . P [ ] \\');
    assert.equal(out[5], 'S D Space L ;');
    assert.equal(out[8], undefined); // 9 keys for 8K: not a plain layout
    assert.equal(xnaKeyName('LeftShift'), 'LShift');
    assert.equal(xnaKeyName('NumPad3'), 'num3');
});

test('synced layouts parse into the overlay key map', () => {
    const map = parseLayout("S D F Space L ; '");
    assert.deepEqual([...map].sort((a, b) => a[1] - b[1]).map(([vk]) => vk), [0x53, 0x44, 0x46, 0x20, 0x4c, 0xba, 0xde]);
    // "?" keeps the lane position without a key
    const gap = parseLayout('? J');
    assert.equal(gap.get(0x4a), 1);
    assert.equal(gap.size, 1);
});
