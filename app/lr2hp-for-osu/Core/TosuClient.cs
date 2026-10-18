using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace LR2HP.Core;

/// <summary>What the app needs from tosu: the client, the selected/playing map and its rate.</summary>
public sealed record TosuSnapshot(
    string Client,
    int State,
    string Checksum,
    string Title,
    string Artist,
    string Version,
    string Mapper,
    int Keys,
    double Rate,
    string Mods,
    string SongsFolder,
    string GameFolder)
{
    public static readonly TosuSnapshot Empty = new("", -1, "", "", "", "", "", 0, 1, "", "", "");

    /// <summary>The fields the UI shows; the rest of tosu's stream changes all the time.</summary>
    public string Key => $"{Client}|{Checksum}|{Rate:0.###}|{Mods}|{State}";
}

public sealed class TosuClient : IDisposable
{
    private readonly CancellationTokenSource cts = new();
    private string lastKey = "";

    public string Host { get; set; } = "127.0.0.1:24050";
    public bool Connected { get; private set; }
    public TosuSnapshot Current { get; private set; } = TosuSnapshot.Empty;

    public event Action<bool>? ConnectionChanged;
    public event Action<TosuSnapshot>? SnapshotChanged;

    public void Start() => _ = Task.Run(Loop);

    private async Task Loop()
    {
        var buffer = new byte[1 << 16];
        while (!cts.IsCancellationRequested)
        {
            using var ws = new ClientWebSocket();
            try
            {
                await ws.ConnectAsync(new Uri($"ws://{Host}/websocket/v2"), cts.Token);
                SetConnected(true);
                var message = new MemoryStream();
                while (ws.State == WebSocketState.Open && !cts.IsCancellationRequested)
                {
                    var r = await ws.ReceiveAsync(buffer, cts.Token);
                    if (r.MessageType == WebSocketMessageType.Close) break;
                    message.Write(buffer, 0, r.Count);
                    if (!r.EndOfMessage) continue;
                    Handle(message.ToArray());
                    message.SetLength(0);
                }
            }
            catch
            {
                // tosu not running or restarted
            }
            SetConnected(false);
            try { await Task.Delay(2000, cts.Token); } catch { return; }
        }
    }

    private void SetConnected(bool value)
    {
        if (Connected == value) return;
        Connected = value;
        ConnectionChanged?.Invoke(value);
    }

    private void Handle(byte[] json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.TryGetProperty("error", out _)) return;

            string Str(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
            JsonElement Obj(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) ? v : default;
            double Num(JsonElement e, string name, double fallback) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : fallback;

            var beatmap = Obj(root, "beatmap");
            var play = Obj(root, "play");
            var mods = Obj(play, "mods");
            var folders = Obj(root, "folders");
            var state = (int)Num(Obj(root, "state"), "number", -1);
            var isMania = Num(Obj(play, "mode"), "number", -1) == 3 || Num(Obj(beatmap, "mode"), "number", -1) == 3;
            var cs = Num(Obj(Obj(beatmap, "stats"), "cs"), "original", 0);

            var title = Str(beatmap, "titleUnicode");
            if (title.Length == 0) title = Str(beatmap, "title");
            var artist = Str(beatmap, "artistUnicode");
            if (artist.Length == 0) artist = Str(beatmap, "artist");

            var snapshot = new TosuSnapshot(
                Str(root, "client"),
                state,
                Str(beatmap, "checksum"),
                title,
                artist,
                Str(beatmap, "version"),
                Str(beatmap, "mapper"),
                isMania ? (int)Math.Round(cs) : 0,
                Num(mods, "rate", 1) is > 0 and var rate ? rate : 1,
                Str(mods, "name"),
                Str(folders, "songs"),
                Str(folders, "game"));

            Current = snapshot;
            if (snapshot.Key == lastKey) return;
            lastKey = snapshot.Key;
            SnapshotChanged?.Invoke(snapshot);
        }
        catch
        {
            // a message we can't read
        }
    }

    /// <summary>The current map's background, through tosu's file route.</summary>
    public async Task<byte[]?> GetBackgroundAsync()
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            return await http.GetByteArrayAsync($"http://{Host}/files/beatmap/background");
        }
        catch
        {
            return null;
        }
    }

    public void Dispose() => cts.Cancel();
}
