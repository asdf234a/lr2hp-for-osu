namespace LR2HP.Core;

/// <summary>
/// osu!'s own key names turned into the names the overlay's key layouts use
/// (letters, digits, Space, LShift, ; ' [ ] and so on; see lr2hp-for-osu/js/notes.js).
/// </summary>
public static class KeyNames
{
    // osu!lazer: osu.Framework.Input.Bindings.InputKey values
    private static readonly Dictionary<int, string> input_key = new()
    {
        [1] = "LShift", [3] = "LCtrl", [5] = "LAlt",
        [45] = "Up", [46] = "Down", [47] = "Left", [48] = "Right",
        [49] = "Enter", [51] = "Space", [52] = "Tab", [53] = "Backspace",
        [54] = "Insert", [55] = "Delete", [56] = "PageUp", [57] = "PageDown", [58] = "Home", [59] = "End", [60] = "CapsLock",
        [77] = "num/", [78] = "num*", [79] = "num-", [80] = "num+", [81] = "num.",
        [119] = "`", [120] = "-", [121] = "=", [122] = "[", [123] = "]", [124] = ";", [125] = "'",
        [126] = ",", [127] = ".", [128] = "/", [129] = "\\", [130] = "\\",
        [263] = "LShift", [264] = "RShift", [265] = "LCtrl", [266] = "RCtrl", [267] = "LAlt", [268] = "RAlt",
    };

    public static string? FromInputKey(int k)
    {
        if (k is >= 83 and <= 108) return ((char)('A' + k - 83)).ToString();
        if (k is >= 109 and <= 118) return (k - 109).ToString();
        if (k is >= 67 and <= 76) return $"num{k - 67}";
        if (k is >= 10 and <= 33) return $"F{k - 9}";
        return input_key.GetValueOrDefault(k);
    }

    /// <summary>A lazer KeyCombination ("124", or "1,83" with a modifier): the last key is the one.</summary>
    public static string? FromLazerCombination(string? combo)
    {
        var parts = (combo ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(p => p != "0").ToArray();
        return parts.Length > 0 && int.TryParse(parts[^1], out var k) ? FromInputKey(k) : null;
    }

    // osu!stable: XNA / WinForms Keys names as written in osu!.<user>.cfg
    private static readonly Dictionary<string, string> xna_key = new()
    {
        ["Space"] = "Space", ["Enter"] = "Enter", ["Tab"] = "Tab", ["Back"] = "Backspace", ["CapsLock"] = "CapsLock",
        ["Up"] = "Up", ["Down"] = "Down", ["Left"] = "Left", ["Right"] = "Right",
        ["Insert"] = "Insert", ["Delete"] = "Delete", ["Home"] = "Home", ["End"] = "End", ["PageUp"] = "PageUp", ["PageDown"] = "PageDown",
        ["LeftShift"] = "LShift", ["RightShift"] = "RShift", ["LeftControl"] = "LCtrl", ["RightControl"] = "RCtrl", ["LeftAlt"] = "LAlt", ["RightAlt"] = "RAlt",
        ["OemSemicolon"] = ";", ["OemQuotes"] = "'", ["OemComma"] = ",", ["OemPeriod"] = ".", ["OemQuestion"] = "/",
        ["OemPipe"] = "\\", ["OemBackslash"] = "\\", ["OemOpenBrackets"] = "[", ["OemCloseBrackets"] = "]",
        ["OemMinus"] = "-", ["OemPlus"] = "=", ["OemTilde"] = "`",
        ["Multiply"] = "num*", ["Add"] = "num+", ["Subtract"] = "num-", ["Decimal"] = "num.", ["Divide"] = "num/",
    };

    public static string? FromXna(string name)
    {
        var k = name.Trim();
        if (k.Length == 1 && k[0] is >= 'A' and <= 'Z') return k;
        if (k.Length == 2 && k[0] == 'D' && char.IsDigit(k[1])) return k[1].ToString();
        if (k.StartsWith("NumPad", StringComparison.Ordinal) && k.Length == 7 && char.IsDigit(k[6])) return $"num{k[6]}";
        if (k.Length is 2 or 3 && k[0] == 'F' && int.TryParse(k[1..], out var f) && f is >= 1 and <= 24) return k;
        return xna_key.GetValueOrDefault(k);
    }

    /// <summary>Lanes left to right; lanes without a usable key become "?" so positions stay put.</summary>
    public static string Layout(IEnumerable<string?> names) => string.Join(' ', names.Select(n => n ?? "?"));
}
