using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LR2HP.Core;

/// <summary>One clear, as the gauge overlay reported it at the results screen.</summary>
public sealed class ClearRecord
{
    /// <summary>"failed", "easy", "groove", "hard", "exhard", "fc", "perfect" or "max"</summary>
    public string Lamp { get; set; } = "";
    public DateTime Date { get; set; }
    /// <summary>The overlay's TOTAL option: "standard", "lr2", "beatoraja" or "custom"</summary>
    public string TotalMode { get; set; } = "standard";
    /// <summary>The TOTAL that was used (the custom value itself for "custom")</summary>
    public double Total { get; set; }
    public string Client { get; set; } = "";
    public string Mods { get; set; } = "";
    public int Notes { get; set; }
    public int ExScore { get; set; }
    public double ScoreRate { get; set; }
    /// <summary>PG, GR, GD, BD, POOR</summary>
    public int[] Counts { get; set; } = [];
    public int EmptyPoor { get; set; }
    public int MaxCombo { get; set; }
    /// <summary>Every gauge's final value</summary>
    public Dictionary<string, double> Gauges { get; set; } = new();

    /// <summary>"v2" (osu!lazer, or osu!stable with ScoreV2) or "v1" (osu!stable)</summary>
    [JsonIgnore]
    public string Scoring => ClearStore.ScoringOf(Client, Mods);
}

/// <summary>One difficulty, found by its MD5 (tosu gives the selected map's); names come from tosu, not from here.</summary>
public sealed class MapRecord
{
    public int Keys { get; set; }
    /// <summary>Rate ("1.0", "1.2", ...) -> clears at that rate, oldest first</summary>
    public Dictionary<string, List<ClearRecord>> Rates { get; set; } = new();
}

public sealed class ClearDatabase
{
    public int Version { get; set; } = 1;
    /// <summary>Beatmap MD5 (one difficulty) -> its clears</summary>
    public Dictionary<string, MapRecord> Maps { get; set; } = new();
}

/// <summary>Clear lamps per difficulty and rate, kept in clears.json next to the exe.</summary>
public sealed class ClearStore
{
    private readonly object gate = new();
    private ClearDatabase db = JsonFile.Load<ClearDatabase>(Paths.ClearsFile);

    /// <summary>Results taken while clears.json couldn't be opened; merged into it once it can be.</summary>
    private readonly List<(string Checksum, string Rate, int Keys, ClearRecord Record)> unsaved = new();

    public event Action<string>? Changed;

    /// <summary>Why records aren't being saved right now (clears.json can't be opened), or null.</summary>
    public string? Problem { get; private set; }

    public ClearStore()
    {
        if (JsonFile.IsBlocked(Paths.ClearsFile, out _))
        {
            Problem = BlockedText();
            return;
        }
        // Records saved before the combo lamps existed get them from their judge counts
        var upgraded = false;
        foreach (var record in db.Maps.Values.SelectMany(m => m.Rates.Values).SelectMany(l => l))
            upgraded |= UpgradeLamp(record);
        if (upgraded) Persist();
    }

    /// <summary>
    /// Writes clears.json. While it couldn't be opened, it is read again first; if that works the
    /// results kept meanwhile are merged into what was on disk, otherwise nothing is written.
    /// Call inside the lock.
    /// </summary>
    private void Persist()
    {
        if (!Reopen()) return;
        try
        {
            JsonFile.Save(Paths.ClearsFile, db);
            Problem = null;
        }
        catch (Exception e)
        {
            // Still in memory: the next save writes it
            Problem = $"clears.json could not be saved ({e.Message})";
            Log.Write(Problem);
        }
    }

    /// <summary>
    /// When clears.json couldn't be opened, reads it again and merges the results kept meanwhile into
    /// what was on disk. False while it still can't be opened. Call inside the lock.
    /// </summary>
    private bool Reopen()
    {
        if (!JsonFile.IsBlocked(Paths.ClearsFile, out _)) return true;
        var disk = JsonFile.Load<ClearDatabase>(Paths.ClearsFile);
        if (JsonFile.IsBlocked(Paths.ClearsFile, out _))
        {
            Problem = BlockedText();
            return false;
        }
        db = disk;
        foreach (var (checksum, rate, keys, record) in unsaved) Insert(checksum, rate, keys, record);
        Log.Write($"clears.json can be read again; merged {unsaved.Count} kept result(s)");
        unsaved.Clear();
        Problem = null;
        return true;
    }

    // Short enough for the window; the log has the full reason
    private string BlockedText() =>
        $"clears.json can't be opened (another program may be holding it). Records are not saved; {unsaved.Count} new result{(unsaved.Count == 1 ? " is" : "s are")} kept until it can be read.";

    /// <summary>Adds a record unless the same results screen was already reported. Call inside the lock.</summary>
    private bool Insert(string checksum, string rate, int keys, ClearRecord record)
    {
        if (!db.Maps.TryGetValue(checksum, out var map)) db.Maps[checksum] = map = new MapRecord();
        if (keys > 0) map.Keys = keys;
        if (!map.Rates.TryGetValue(rate, out var list)) map.Rates[rate] = list = new List<ClearRecord>();
        // A safety net: one play is one record even if it comes twice. Its judge counts are osu!'s
        // own, so they match whichever overlay worked out the gauges
        if (list.Any(x => x.Scoring == record.Scoring && x.ExScore == record.ExScore && SameJudges(x, record) && Math.Abs((record.Date - x.Date).TotalMinutes) < 2)) return false;
        list.Add(record);
        return true;
    }

    private static bool SameJudges(ClearRecord a, ClearRecord b) =>
        a.Counts.Length >= 3 && b.Counts.Length >= 3 && a.Counts.Take(3).SequenceEqual(b.Counts.Take(3));

    /// <summary>beatoraja's clear types, lowest first</summary>
    public static readonly string[] Lamps = ["failed", "easy", "groove", "hard", "exhard", "fc", "perfect", "max"];

    public static int Rank(string lamp) => Array.IndexOf(Lamps, lamp);

    public static string Label(string lamp) => lamp switch
    {
        "max" => "MAX",
        "perfect" => "PERFECT",
        "fc" => "FULL COMBO",
        "exhard" => "EX-HARD CLEAR",
        "hard" => "HARD CLEAR",
        "groove" => "CLEAR",
        "easy" => "EASY CLEAR",
        "failed" => "FAILED",
        _ => "NO PLAY",
    };

    /// <summary>
    /// Records are kept apart by judging: osu!lazer and osu!stable with ScoreV2 judge mania alike
    /// (LN tails, 320s), plain osu!stable (ScoreV1) does not.
    /// </summary>
    public static string ScoringOf(string client, string mods) =>
        client != "stable" || mods.Contains("V2", StringComparison.OrdinalIgnoreCase) ? "v2" : "v1";

    /// <summary>
    /// The combo lamps, as beatoraja gives them: FULL COMBO with no BAD or POOR (empty POOR doesn't
    /// break combo), PERFECT with no GOOD either, MAX with every note a PGREAT.
    /// Counts are PG, GR, GD, BD, POOR. Returns whether the lamp went up.
    /// </summary>
    public static bool UpgradeLamp(ClearRecord r)
    {
        var c = r.Counts;
        if (c.Length < 5 || r.Notes <= 0 || c[3] + c[4] > 0 || c.Take(3).Sum() < r.Notes) return false;
        var lamp = c[1] + c[2] == 0 ? "max" : c[2] == 0 ? "perfect" : "fc";
        if (Rank(lamp) <= Rank(r.Lamp)) return false;
        r.Lamp = lamp;
        return true;
    }

    public static string RateKey(double rate) => Math.Round(rate, 2).ToString("0.0#", CultureInfo.InvariantCulture);

    public static string TotalLabel(ClearRecord r) => r.TotalMode == "custom"
        ? $"TOTAL custom {r.Total:0.##}"
        : $"TOTAL {r.TotalMode} {r.Total:0.#}";

    /// <summary>
    /// The gauge overlay's part of a record, from its {type:"resultReply"} message: lamp, gauges,
    /// judge counts as LR2 judges, empty POOR, EX score. Null when the lamp isn't one we know.
    /// </summary>
    public static ClearRecord? RecordFrom(JsonElement m)
    {
        string Str(string name) => m.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
        double Num(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;

        var lamp = Str("lamp");
        if (Rank(lamp) < 0) return null;
        var total = m.TryGetProperty("total", out var t) ? t : default;
        return new ClearRecord
        {
            Lamp = lamp,
            Date = DateTime.Now,
            TotalMode = total.ValueKind == JsonValueKind.Object && total.TryGetProperty("mode", out var tm) ? tm.GetString() ?? "standard" : "standard",
            Total = Num(total, "value"),
            Notes = (int)Num(m, "notes"),
            ExScore = (int)Num(m, "exScore"),
            ScoreRate = Num(m, "scoreRate"),
            EmptyPoor = (int)Num(m, "emptyPoor"),
            MaxCombo = (int)Num(m, "maxCombo"),
            Counts = m.TryGetProperty("counts", out var c) && c.ValueKind == JsonValueKind.Array ? c.EnumerateArray().Select(x => x.TryGetInt32(out var i) ? i : 0).ToArray() : [],
            Gauges = m.TryGetProperty("gauges", out var g) && g.ValueKind == JsonValueKind.Object
                ? g.EnumerateObject().Where(p => p.Value.ValueKind == JsonValueKind.Number).ToDictionary(p => p.Name, p => Math.Round(p.Value.GetDouble(), 2))
                : new(),
        };
    }

    /// <summary>Saves one play's record. Returns false when it was already there.</summary>
    public bool Add(string checksum, double rate, int keys, ClearRecord record)
    {
        if (checksum.Length == 0) return false;
        UpgradeLamp(record);
        var rateKey = RateKey(rate);
        lock (gate)
        {
            if (!Insert(checksum, rateKey, keys, record)) return false;
            if (JsonFile.IsBlocked(Paths.ClearsFile, out _)) unsaved.Add((checksum, rateKey, keys, record));
            Persist();
        }
        Changed?.Invoke(checksum);
        return true;
    }

    /// <summary>BAD + POOR + empty POOR</summary>
    public static int Bp(ClearRecord r) => (r.Counts.Length > 4 ? r.Counts[3] + r.Counts[4] : 0) + r.EmptyPoor;

    public static readonly string[] Ranks = ["F", "E", "D", "C", "B", "A", "AA", "AAA"];

    /// <summary>
    /// BMS rank from the EX score (AAA from 8/9 of the max, AA from 7/9 ... E from 2/9), and the
    /// nearer rank line in LR2's style: "AAA-0006" (6 short of AAA), "AA+0012" (12 over AA) or "MAX-0004".
    /// </summary>
    public static (string Rank, string Diff) RankOf(int exScore, int notes)
    {
        var max = Math.Max(1, notes * 2);
        int Line(int k) => (int)Math.Ceiling(max * k / 9.0);
        var k = Math.Clamp((int)Math.Floor(exScore * 9.0 / max + 1e-9), 1, 8); // 8 = AAA ... 2 = E, 1 = F
        var rank = Ranks[k - 1];
        var floor = k >= 2 ? Line(k) : 0;
        var plus = exScore - floor;
        var nextName = k == 8 ? "MAX" : Ranks[k];
        var minus = (k == 8 ? max : Line(k + 1)) - exScore;
        var diff = minus <= plus || k == 1 ? $"{nextName}-{minus:0000}" : $"{rank}+{plus:0000}";
        return (rank, diff);
    }

    public sealed record RateSummary(string Rate, ClearRecord BestLamp, ClearRecord BestScore, int BestBp, int Count);

    /// <summary>Per rate: the best lamp, the best EX score and the lowest BP among one scoring's records.</summary>
    public IReadOnlyList<RateSummary> Summary(string checksum, string scoring)
    {
        lock (gate)
        {
            if (!db.Maps.TryGetValue(checksum, out var map)) return [];
            return map.Rates
                .Select(p => (Rate: p.Key, List: p.Value.Where(x => x.Scoring == scoring).ToList()))
                .Where(p => p.List.Count > 0)
                .Select(p => new RateSummary(
                    p.Rate,
                    p.List.OrderByDescending(x => Rank(x.Lamp)).ThenByDescending(x => x.Date).First(),
                    p.List.OrderByDescending(x => x.ExScore).ThenByDescending(x => x.Date).First(),
                    p.List.Min(Bp),
                    p.List.Count))
                .OrderBy(s => double.Parse(s.Rate, CultureInfo.InvariantCulture))
                .ToList();
        }
    }

    /// <summary>Forgets every record of one difficulty (all rates, lazer and stable), as if it was never played.</summary>
    public bool DeleteMap(string checksum)
    {
        lock (gate)
        {
            // Deleting from memory alone would come back when the file is merged in later
            if (!Reopen())
            {
                Log.Write("not deleting records: clears.json can't be opened");
                return false;
            }
            if (!db.Maps.Remove(checksum)) return false;
            Persist();
        }
        Changed?.Invoke(checksum);
        return true;
    }

    public int MapCount
    {
        get
        {
            lock (gate) return db.Maps.Count;
        }
    }
}
