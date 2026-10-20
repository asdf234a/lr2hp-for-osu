using System.Text.Json;

namespace LR2HP.Core;

public sealed class AppSettings
{
    public int Port { get; set; } = 24055;
    public string TosuHost { get; set; } = "127.0.0.1:24050";
    public string ProcessName { get; set; } = "osu!";
    /// <summary>"Dark", "Light" or "System"</summary>
    public string Theme { get; set; } = "Dark";
    /// <summary>Lamp blink (FAILED, EX-HARD, FC, PERFECT, MAX): "slow" (a slow fade), "fast" (m_select's own 100 / 50 ms) or "off"</summary>
    public string LampBlink { get; set; } = "slow";
    /// <summary>Song and artist names: "original" (their own language) or "english" (romanised)</summary>
    public string TitleLanguage { get; set; } = "original";
    public bool AlwaysOnTop { get; set; } = true;
    public int? WindowX { get; set; }
    public int? WindowY { get; set; }
}

/// <summary>
/// Ties the parts together: key polling and key layouts out to the overlays, clear results
/// in from them, and tosu for the map that is selected or playing.
/// </summary>
public sealed class AppController : IDisposable
{
    public AppSettings Settings { get; } = JsonFile.Load<AppSettings>(Paths.SettingsFile);
    public KeyPoller Keys { get; } = new();
    public OverlayServer Server { get; } = new();
    public TosuClient Tosu { get; } = new();
    public ClearStore Clears { get; } = new();
    public KeybindSet Keybinds { get; private set; } = JsonFile.Load<KeybindSet>(Paths.KeybindsFile);

    public string? StartError { get; private set; }

    /// <summary>Something the UI shows changed (connections, map, clears, key layouts).</summary>
    public event Action? Changed;

    private string lastSyncedClient = "";
    private readonly object pollLock = new();
    private int syncing;

    public void Start()
    {
        Keys.ProcessName = Settings.ProcessName;
        Keys.KeyChanged += (vk, down, t) => Server.Broadcast($"{{\"vk\":{vk},\"d\":{(down ? 1 : 0)},\"t\":{t}}}");
        Keys.FocusChanged += focused =>
        {
            Server.Broadcast($"{{\"focus\":{(focused ? 1 : 0)}}}");
            Changed?.Invoke();
        };

        Server.Connected += client =>
        {
            Server.Send(client, KeybindsMessage());
            Server.Send(client, $"{{\"focus\":{(Keys.Focused ? 1 : 0)}}}");
        };
        Server.ClientsChanged += () =>
        {
            UpdatePolledKeys();
            Changed?.Invoke();
        };
        Server.MessageReceived += OnOverlayMessage;
        UpdatePolledKeys();

        Tosu.Host = Settings.TosuHost;
        Tosu.ConnectionChanged += _ => Changed?.Invoke();
        Tosu.SnapshotChanged += snapshot =>
        {
            // tosu attached to the other client: its key layouts may be new to us
            if (snapshot.Client.Length > 0 && snapshot.Client != lastSyncedClient) SyncKeybinds();
            Changed?.Invoke();
        };
        Clears.Changed += _ => Changed?.Invoke();

        try
        {
            Server.Start(Settings.Port);
        }
        catch (Exception e)
        {
            StartError = $"Port {Settings.Port} is busy ({e.Message}). Is the old key helper still running?";
            Log.Write(StartError);
        }
        Keys.Start();
        Tosu.Start();
        SyncKeybinds();
    }

    private void OnOverlayMessage(OverlayServer.Client client, string text)
    {
        using var doc = JsonDocument.Parse(text);
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var type)) return;
        switch (type.GetString())
        {
            case "hello":
                client.Name = root.TryGetProperty("overlay", out var name) ? name.GetString() ?? "overlay" : "overlay";
                Changed?.Invoke();
                break;
            case "keys":
                client.Keys = root.TryGetProperty("vks", out var vks) && vks.ValueKind == JsonValueKind.Array
                    ? vks.EnumerateArray().Where(v => v.TryGetInt32(out _)).Select(v => v.GetInt32()).ToArray()
                    : null;
                UpdatePolledKeys();
                break;
            case "clear":
            case "result":
                var checksum = root.TryGetProperty("checksum", out var c) ? c.GetString() : null;
                Clears.AddFromOverlay(root, Tosu.LastPlay is { } play && play.Checksum == checksum ? (play.Rate, play.Mods) : null);
                break;
        }
    }

    /// <summary>
    /// Polls the union of the keys the connected overlays asked for. An overlay that never sent its
    /// keys (an older version) gets every key, as before; with no overlay connected nothing is polled.
    /// </summary>
    private void UpdatePolledKeys()
    {
        // Each overlay connection runs on its own thread: without the lock a list read before a
        // change could be set after it and leave keys unpolled
        lock (pollLock)
        {
            var connected = Server.Clients;
            if (connected.Any(c => c.Keys == null)) Keys.SetKeys(KeyPoller.AllKeys);
            else Keys.SetKeys(connected.SelectMany(c => c.Keys!));
        }
    }

    private string KeybindsMessage() => JsonSerializer.Serialize(new { type = "keybinds", lazer = Keybinds.Lazer, stable = Keybinds.Stable }, JsonFile.Options);

    /// <summary>Reads both clients' key layouts in the background and sends them to the overlays.</summary>
    public void SyncKeybinds()
    {
        if (Interlocked.Exchange(ref syncing, 1) == 1) return;
        var snapshot = Tosu.Connected ? Tosu.Current : null;
        Task.Run(() =>
        {
            try
            {
                var set = KeybindSync.Run(snapshot);
                if (snapshot != null) lastSyncedClient = snapshot.Client;
                // Keep what we had for a client we couldn't read this time
                if (set.Lazer.Count == 0 && Keybinds.Lazer.Count > 0) (set.Lazer, set.LazerSource) = (Keybinds.Lazer, Keybinds.LazerSource);
                if (set.Stable.Count == 0 && Keybinds.Stable.Count > 0) (set.Stable, set.StableSource) = (Keybinds.Stable, Keybinds.StableSource);
                Keybinds = set;
                Server.Broadcast(KeybindsMessage());
                JsonFile.Save(Paths.KeybindsFile, set);
            }
            catch (Exception e)
            {
                Log.Write($"keybind sync: {e.Message}");
            }
            finally
            {
                Interlocked.Exchange(ref syncing, 0);
                Changed?.Invoke();
            }
        });
    }

    public bool Syncing => Volatile.Read(ref syncing) == 1;

    public void SaveSettings()
    {
        try { JsonFile.Save(Paths.SettingsFile, Settings); } catch (Exception e) { Log.Write($"settings: {e.Message}"); }
    }

    public void Dispose()
    {
        Keys.Dispose();
        Server.Dispose();
        Tosu.Dispose();
    }
}
