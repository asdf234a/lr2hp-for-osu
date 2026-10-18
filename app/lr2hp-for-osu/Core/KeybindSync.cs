using System.Text.RegularExpressions;
using Microsoft.Win32;
using Realms;

namespace LR2HP.Core;

/// <summary>Mania key layouts per key count ("7" -> "S D F Space L ; '") for each client.</summary>
public sealed class KeybindSet
{
    public DateTime Updated { get; set; }
    public Dictionary<string, string> Lazer { get; set; } = new();
    public Dictionary<string, string> Stable { get; set; } = new();
    public string? LazerSource { get; set; }
    public string? StableSource { get; set; }
}

/// <summary>
/// Reads osu!mania key bindings from osu!lazer (client.realm, from a temporary copy so the
/// game's own file is never opened) and osu!stable (osu!.&lt;user&gt;.cfg).
/// </summary>
public static partial class KeybindSync
{
    public static KeybindSet Run(TosuSnapshot? tosu)
    {
        var set = new KeybindSet { Updated = DateTime.Now };

        var lazerDir = tosu is { Client: "lazer", SongsFolder.Length: > 0 } ? Path.GetDirectoryName(tosu.SongsFolder) : null;
        lazerDir ??= LazerFromStorageIni();
        if (Directory.Exists(lazerDir))
        {
            try
            {
                (set.Lazer, set.LazerSource) = ReadLazer(lazerDir);
            }
            catch (Exception e)
            {
                Log.Write($"lazer keybinds: {e.Message}");
            }
        }

        var stableDir = tosu is { Client: "stable", GameFolder.Length: > 0 } ? tosu.GameFolder : null;
        stableDir ??= StableFromRegistry();
        if (Directory.Exists(stableDir))
        {
            try
            {
                (set.Stable, set.StableSource) = ReadStable(stableDir);
            }
            catch (Exception e)
            {
                Log.Write($"stable keybinds: {e.Message}");
            }
        }
        return set;
    }

    private static string? LazerFromStorageIni()
    {
        var baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "osu");
        try
        {
            var ini = Path.Combine(baseDir, "storage.ini");
            if (File.Exists(ini))
            {
                var m = FullPathLine().Match(File.ReadAllText(ini));
                if (m.Success && Directory.Exists(m.Groups[1].Value.Trim())) return m.Groups[1].Value.Trim();
            }
        }
        catch
        {
            // no custom storage location
        }
        return Directory.Exists(baseDir) ? baseDir : null;
    }

    private static string? StableFromRegistry()
    {
        if (OperatingSystem.IsWindows())
        {
            foreach (var key in new[] { @"osu\shell\open\command", @"osustable.File.osz\shell\open\command" })
            {
                try
                {
                    using var k = Registry.ClassesRoot.OpenSubKey(key);
                    var m = QuotedExe().Match(k?.GetValue(null) as string ?? "");
                    if (m.Success && File.Exists(m.Groups[1].Value)) return Path.GetDirectoryName(m.Groups[1].Value);
                }
                catch
                {
                    // key missing
                }
            }
        }
        var local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "osu!");
        return File.Exists(Path.Combine(local, "osu!.exe")) ? local : null;
    }

    private static (Dictionary<string, string>, string?) ReadLazer(string dir)
    {
        var file = Path.Combine(dir, "client.realm");
        if (!File.Exists(file)) return (new(), null);

        var copy = Path.Combine(Path.GetTempPath(), $"lr2hp-client-{Environment.ProcessId}.realm");
        File.Copy(file, copy, true);
        try
        {
            var lanes = new Dictionary<int, string?[]>();
            using (var realm = Realm.GetInstance(new RealmConfiguration(copy) { IsDynamic = true, IsReadOnly = true }))
            {
                foreach (var obj in realm.DynamicApi.All("KeyBinding"))
                {
                    if (obj.DynamicApi.Get<string?>("RulesetName") != "mania") continue;
                    // Variants 1..18 are single stages (the key count); 1000+ are co-op stages
                    var keys = obj.DynamicApi.Get<int?>("Variant") ?? 0;
                    if (keys is < 1 or > 18) continue;
                    var lane = obj.DynamicApi.Get<int>("Action");
                    if (lane < 0 || lane >= keys) continue;
                    var row = lanes.TryGetValue(keys, out var r) ? r : lanes[keys] = new string?[keys];
                    // Each lane has a primary and a secondary binding; the first usable one wins
                    row[lane] ??= KeyNames.FromLazerCombination(obj.DynamicApi.Get<string?>("KeyCombination"));
                }
            }
            return (lanes.Where(p => p.Value.Any(n => n != null)).ToDictionary(p => p.Key.ToString(), p => KeyNames.Layout(p.Value)), file);
        }
        finally
        {
            foreach (var f in new[] { copy, copy + ".lock", copy + ".note" })
            {
                try { File.Delete(f); } catch { /* best effort */ }
            }
            try { Directory.Delete(copy + ".management", true); } catch { /* best effort */ }
        }
    }

    private static (Dictionary<string, string>, string?) ReadStable(string dir)
    {
        // osu! names the file after the Windows user; fall back to the newest one
        var file = Path.Combine(dir, $"osu!.{Environment.UserName}.cfg");
        if (!File.Exists(file))
        {
            file = Directory.EnumerateFiles(dir, "osu!.*.cfg")
                .Where(f => !Path.GetFileName(f).Equals("osu!.cfg", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(File.GetLastWriteTime)
                .FirstOrDefault() ?? "";
        }
        if (!File.Exists(file)) return (new(), null);
        return (ParseStableConfig(File.ReadAllText(file)), file);
    }

    /// <summary>
    /// "ManiaLayoutsNK" lines may hold several layouts separated by "|"; "ManiaLayoutSelectedNK" picks one.
    /// Dual-stage "10KSplit" style lines and layouts whose key count doesn't match are skipped.
    /// </summary>
    public static Dictionary<string, string> ParseStableConfig(string text)
    {
        var layouts = new Dictionary<string, string>();
        var selected = new Dictionary<string, int>();
        foreach (var line in text.Split('\n'))
        {
            var m = StableLayoutLine().Match(line.TrimEnd('\r'));
            if (!m.Success) continue;
            if (m.Groups[1].Value == "s") layouts[m.Groups[2].Value] = m.Groups[3].Value;
            else selected[m.Groups[2].Value] = int.TryParse(m.Groups[3].Value, out var i) ? i : 0;
        }
        var result = new Dictionary<string, string>();
        foreach (var (keys, value) in layouts)
        {
            var options = value.Split('|');
            var pick = selected.GetValueOrDefault(keys);
            var chosen = (pick < options.Length ? options[pick] : options[0]).Trim();
            var names = chosen.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(KeyNames.FromXna).ToArray();
            if (names.Length.ToString() == keys) result[keys] = KeyNames.Layout(names);
        }
        return result;
    }

    [GeneratedRegex(@"^\s*FullPath\s*=\s*(.+)$", RegexOptions.Multiline)]
    private static partial Regex FullPathLine();

    [GeneratedRegex("\"([^\"]+osu!\\.exe)\"", RegexOptions.IgnoreCase)]
    private static partial Regex QuotedExe();

    [GeneratedRegex(@"^\s*ManiaLayout(s|Selected)(\d+)K\s*=\s*(.*)$")]
    private static partial Regex StableLayoutLine();
}
