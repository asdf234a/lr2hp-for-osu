// Turns osu!'s own key names into the key names the overlay's layout settings use
// (letters, digits, Space, LShift, ; ' [ ] and so on; see lr2hp/js/notes.js).

// osu!lazer: osu.Framework.Input.Bindings.InputKey values
const INPUT_KEY = {
    1: 'LShift', 3: 'LCtrl', 5: 'LAlt',
    45: 'Up', 46: 'Down', 47: 'Left', 48: 'Right',
    49: 'Enter', 51: 'Space', 52: 'Tab', 53: 'Backspace',
    54: 'Insert', 55: 'Delete', 56: 'PageUp', 57: 'PageDown', 58: 'Home', 59: 'End', 60: 'CapsLock',
    77: 'num/', 78: 'num*', 79: 'num-', 80: 'num+', 81: 'num.',
    119: '`', 120: '-', 121: '=', 122: '[', 123: ']', 124: ';', 125: "'",
    126: ',', 127: '.', 128: '/', 129: '\\', 130: '\\',
    263: 'LShift', 264: 'RShift', 265: 'LCtrl', 266: 'RCtrl', 267: 'LAlt', 268: 'RAlt',
};

export function inputKeyName(code) {
    const k = Number(code);
    if (k >= 83 && k <= 108) return String.fromCharCode(65 + k - 83); // A..Z
    if (k >= 109 && k <= 118) return String(k - 109); // Number0..9
    if (k >= 67 && k <= 76) return `num${k - 67}`; // Keypad0..9
    if (k >= 10 && k <= 33) return `F${k - 9}`; // F1..F24
    return INPUT_KEY[k] || null;
}

// A lazer KeyCombination string ("124", or "1,83" with a modifier): the last key is the one
export function lazerCombinationName(combo) {
    const parts = String(combo || '').split(',').map((s) => s.trim()).filter((s) => s && s !== '0');
    if (!parts.length) return null;
    return inputKeyName(parts[parts.length - 1]);
}

// osu!stable: XNA / WinForms Keys names as written in osu!.<user>.cfg
const XNA_KEY = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Back: 'Backspace', CapsLock: 'CapsLock',
    Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right',
    Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    LeftShift: 'LShift', RightShift: 'RShift', LeftControl: 'LCtrl', RightControl: 'RCtrl', LeftAlt: 'LAlt', RightAlt: 'RAlt',
    OemSemicolon: ';', OemQuotes: "'", OemComma: ',', OemPeriod: '.', OemQuestion: '/',
    OemPipe: '\\', OemBackslash: '\\', OemOpenBrackets: '[', OemCloseBrackets: ']',
    OemMinus: '-', OemPlus: '=', OemTilde: '`',
    Multiply: 'num*', Add: 'num+', Subtract: 'num-', Decimal: 'num.', Divide: 'num/',
};

export function xnaKeyName(name) {
    const k = String(name || '').trim();
    if (/^[A-Z]$/.test(k)) return k;
    let m = /^D([0-9])$/.exec(k);
    if (m) return m[1];
    m = /^NumPad([0-9])$/.exec(k);
    if (m) return `num${m[1]}`;
    m = /^F([0-9]{1,2})$/.exec(k);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 24) return k;
    return XNA_KEY[k] || null;
}

// Lanes left to right -> "S D F Space L ; '"; lanes osu! has no usable key for become "?"
export function layoutString(names) {
    return names.map((n) => n || '?').join(' ');
}

// osu!.<user>.cfg -> { [keyCount]: layout string }. Each "ManiaLayoutsNK" line may hold
// several layouts separated by "|"; "ManiaLayoutSelectedNK" picks one.
export function parseStableConfig(text) {
    const layouts = {};
    const selected = {};
    for (const line of String(text).split(/\r?\n/)) {
        const m = /^\s*ManiaLayout(s|Selected)(\d+)K\s*=\s*(.*)$/.exec(line);
        if (!m) continue; // "10KSplit" style dual-stage layouts don't match and are skipped
        if (m[1] === 's') layouts[m[2]] = m[3];
        else selected[m[2]] = parseInt(m[3], 10) || 0;
    }
    const out = {};
    for (const [keys, value] of Object.entries(layouts)) {
        const options = value.split('|');
        const chosen = (options[selected[keys] || 0] ?? options[0]).trim();
        const names = chosen.split(/\s+/).filter(Boolean).map(xnaKeyName);
        if (names.length === Number(keys)) out[keys] = layoutString(names);
    }
    return out;
}

// Lazer KeyBinding rows ({ Variant, Action, KeyCombination }) for the mania ruleset ->
// { [keyCount]: layout string }. Variants 1..18 are single stages; actions are lanes;
// each lane has a primary and a secondary binding, and the first usable one wins.
export function lazerLayouts(rows) {
    const byVariant = {};
    for (const r of rows) {
        const v = Number(r.Variant);
        if (!(v >= 1 && v <= 18)) continue;
        (byVariant[v] ||= []).push(r);
    }
    const out = {};
    for (const [v, list] of Object.entries(byVariant)) {
        const keys = Number(v);
        const names = new Array(keys).fill(null);
        for (const r of list) {
            const lane = Number(r.Action);
            if (lane < 0 || lane >= keys || names[lane]) continue;
            names[lane] = lazerCombinationName(r.KeyCombination);
        }
        if (names.some(Boolean)) out[v] = layoutString(names);
    }
    return out;
}
