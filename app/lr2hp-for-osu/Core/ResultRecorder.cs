using System.Diagnostics;
using System.Text.Json;

namespace LR2HP.Core;

/// <summary>
/// Decides which results screens become records, from tosu alone: a results screen right after
/// a play, not a watched replay, not a score opened from the leaderboard after a quit play, and
/// each play once. Only then it asks the gauge overlays for their part (gauges, lamp, empty POOR)
/// and keeps the first answer that fits osu!'s own judge counts, so however many overlays are
/// open, or old ones, one play is one record.
/// </summary>
public sealed class ResultRecorder
{
    private const int StatePlay = 2;
    private const int StateResults = 7;
    /// <summary>tosu's StreamCompanion status while a replay is watched</summary>
    private const int ScWatching = 8;
    /// <summary>How long (ms) another screen may show between a play and its results screen</summary>
    private const long LeftPlayAfter = 1000;
    /// <summary>How long (ms) a results screen may show osu!'s counters as all zero before the play's own are used</summary>
    private const long ResultHitsWait = 1000;
    /// <summary>How long (ms) the overlays have to answer</summary>
    private const int ReplyTimeout = 2000;

    private sealed class Play
    {
        public required string Checksum { get; init; }
        public required string Client { get; init; }
        public required double Rate { get; init; }
        public required string Mods { get; init; }
        public required int Keys { get; init; }
        public double LastLive { get; set; }
        public int[] Hits { get; set; } = [];
        public bool Replay { get; set; }
        /// <summary>Recorded, asked for, or given up on: nothing more to do for it</summary>
        public bool Done { get; set; }
        public long LeftAt { get; set; } = -1;
        public long ResultsAt { get; set; } = -1;
    }

    private sealed class Request
    {
        public required int Id { get; init; }
        public required Play Play { get; init; }
        public required int[] Hits { get; init; }
        public required int Asked { get; init; }
        public List<string> Refusals { get; } = new();
    }

    private readonly TosuClient tosu;
    private readonly OverlayServer server;
    private readonly ClearStore clears;
    private readonly object gate = new();
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private Play? play;
    private Request? pending;
    private int lastState = -1;
    private int nextId;

    public ResultRecorder(TosuClient tosu, OverlayServer server, ClearStore clears)
    {
        this.tosu = tosu;
        this.server = server;
        this.clears = clears;
    }

    public void OnUpdate(TosuUpdate u)
    {
        lock (gate)
        {
            var now = clock.ElapsedMilliseconds;
            if (u.State == StatePlay && u.IsMania && u.Checksum.Length > 0)
            {
                var retried = play != null && u.Live < play.LastLive - 1000;
                if (play == null || lastState != StatePlay || retried || play.Checksum != u.Checksum || play.Mods != u.Mods)
                {
                    play = new Play { Checksum = u.Checksum, Client = u.Client, Rate = u.Rate, Mods = u.Mods, Keys = u.Keys };
                }
                play.LastLive = u.Live;
                play.Hits = u.PlayHits;
                play.LeftAt = -1;
                if (tosu.ScStatus == ScWatching) play.Replay = true;
            }
            else if (u.State == StateResults && play is { Done: false } p && (lastState == StatePlay || lastState == StateResults || p.LeftAt >= 0))
            {
                if (p.LeftAt >= 0 && now - p.LeftAt > LeftPlayAfter)
                {
                    p.Done = true;
                }
                else
                {
                    if (p.ResultsAt < 0) p.ResultsAt = now;
                    // lazer can show the results screen an update before tosu reads its counters
                    var hits = u.ResultHits.Sum() > 0 ? u.ResultHits : null;
                    if (hits != null || now - p.ResultsAt > ResultHitsWait) Finish(p, hits ?? p.Hits);
                }
            }
            else if (play is { Done: false } left)
            {
                // Quit, failed in osu!, or a screen in between: a results screen may still follow
                if (left.LeftAt < 0) left.LeftAt = now;
                else if (now - left.LeftAt > LeftPlayAfter) left.Done = true;
            }
            lastState = u.State;
        }
    }

    private void Finish(Play p, int[] hits)
    {
        p.Done = true;
        if (p.Replay) return;
        if (hits.Sum() == 0) return;

        var targets = server.Clients.Where(c => c.AnswersResults).ToArray();
        if (targets.Length == 0)
        {
            Log.Write("not recorded: no gauge overlay that can report results is connected (update the overlays?)");
            return;
        }
        var request = new Request { Id = ++nextId, Play = p, Hits = hits, Asked = targets.Length };
        pending = request;
        var message = JsonSerializer.Serialize(new
        {
            type = "resultRequest",
            id = request.Id,
            checksum = p.Checksum,
            hits = new Dictionary<string, int>
            {
                ["geki"] = hits[0], ["300"] = hits[1], ["katu"] = hits[2], ["100"] = hits[3], ["50"] = hits[4], ["0"] = hits[5],
            },
        });
        foreach (var c in targets) server.Send(c, message);
        _ = Task.Delay(ReplyTimeout).ContinueWith(_ => GiveUp(request));
    }

    public void OnReply(OverlayServer.Client client, JsonElement m)
    {
        lock (gate)
        {
            if (pending == null || !m.TryGetProperty("id", out var id) || !id.TryGetInt32(out var n) || n != pending.Id) return;
            var request = pending;
            var refusal = Check(m, request);
            if (refusal == null && ClearStore.RecordFrom(m) is { } record)
            {
                pending = null;
                record.Client = request.Play.Client;
                record.Mods = request.Play.Mods;
                clears.Add(request.Play.Checksum, request.Play.Rate, request.Play.Keys, record);
                return;
            }
            request.Refusals.Add($"{client.Name}: {refusal ?? "unknown lamp"}");
            if (request.Refusals.Count >= request.Asked) GiveUp(request);
        }
    }

    /// <summary>Why the answer doesn't belong to this play, or null when it does.</summary>
    private static string? Check(JsonElement m, Request request)
    {
        if (!m.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True)
            return m.TryGetProperty("reason", out var why) ? why.GetString() : "refused";
        if (!m.TryGetProperty("checksum", out var cs) || cs.GetString() != request.Play.Checksum) return "another map";
        if (!m.TryGetProperty("fromStart", out var fs) || fs.ValueKind != JsonValueKind.True) return "opened after the play had started";
        var counts = m.TryGetProperty("counts", out var c) && c.ValueKind == JsonValueKind.Array
            ? c.EnumerateArray().Select(x => x.TryGetInt32(out var i) ? i : -1).ToArray()
            : [];
        var h = request.Hits;
        // LR2 judges: PG = MAX, GR = 300, GD = 200 + 100, BD + POOR = 50 + MISS (early MISSes may count as BD)
        if (counts.Length < 5 || counts[0] != h[0] || counts[1] != h[1] || counts[2] != h[2] + h[3] || counts[3] + counts[4] != h[4] + h[5])
            return "judge counts don't match osu!'s";
        return null;
    }

    private void GiveUp(Request request)
    {
        lock (gate)
        {
            if (pending != request) return;
            pending = null;
            var why = request.Refusals.Count > 0 ? string.Join("; ", request.Refusals) : "no answer";
            Log.Write($"not recorded ({request.Play.Checksum}): {why}");
        }
    }
}
