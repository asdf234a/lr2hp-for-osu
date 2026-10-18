using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LR2HP.Core;

/// <summary>One clear, as the gauge overlay reported it at the results screen.</summary>
public sealed class ClearRecord
{
    /// <summary>"failed", "easy", "groove", "hard" or "exhard"</summary>
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
    private readonly ClearDatabase db = JsonFile.Load<ClearDatabase>(Paths.ClearsFile);

    public event Action<string>? Changed;

    public static readonly string[] Lamps = ["failed", "easy", "groove", "hard", "exhard"];

    public static int Rank(string lamp) => Array.IndexOf(Lamps, lamp);

    public static string Label(string lamp) => lamp switch
    {
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

    public static string RateKey(double rate) => Math.Round(rate, 2).ToString("0.0#", CultureInfo.InvariantCulture);

    public static string TotalLabel(ClearRecord r) => r.TotalMode == "custom"
        ? $"TOTAL custom {r.Total:0.##}"
        : $"TOTAL {r.TotalMode} {r.Total:0.#}";

    /// <summary>
    /// Takes a {type:"result"} message from the gauge overlay. Returns false when it was a repeat.
    /// play: the rate and mods the app itself saw during that play, which win over the overlay's
    /// (an overlay page opened before an update can still send rate 1 for a DT play).
    /// </summary>
    public bool AddFromOverlay(JsonElement m, (double Rate, string Mods)? play = null)
    {
        string Str(string name) => m.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
        double Num(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;

        var checksum = Str("checksum");
        var lamp = Str("lamp");
        if (checksum.Length == 0 || Rank(lamp) < 0) return false;

        var total = m.TryGetProperty("total", out var t) ? t : default;
        var record = new ClearRecord
        {
            Lamp = lamp,
            Date = DateTime.Now,
            TotalMode = total.ValueKind == JsonValueKind.Object && total.TryGetProperty("mode", out var tm) ? tm.GetString() ?? "standard" : "standard",
            Total = Num(total, "value"),
            Client = Str("client"),
            Mods = play?.Mods ?? Str("mods"),
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
        var rate = RateKey(play?.Rate ?? (Num(m, "rate") is > 0 and var r ? r : 1));

        lock (gate)
        {
            if (!db.Maps.TryGetValue(checksum, out var map)) db.Maps[checksum] = map = new MapRecord();
            if (Num(m, "keys") is > 0 and var k) map.Keys = (int)k;

            if (!map.Rates.TryGetValue(rate, out var list)) map.Rates[rate] = list = new List<ClearRecord>();
            // The overlay can report the same results screen twice (reconnects, several overlays)
            if (list.Any(x => x.Scoring == record.Scoring && x.Lamp == record.Lamp && x.ExScore == record.ExScore && (record.Date - x.Date).TotalMinutes < 2)) return false;
            list.Add(record);
            JsonFile.Save(Paths.ClearsFile, db);
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

    public int MapCount
    {
        get
        {
            lock (gate) return db.Maps.Count;
        }
    }
}
