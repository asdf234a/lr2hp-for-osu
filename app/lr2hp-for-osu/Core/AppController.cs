using System.Text.Json;

namespace LR2HP.Core;

public sealed class AppSettings
{
    public int Port { get; set; } = 24055;
    public string TosuHost { get; set; } = "127.0.0.1:24050";
    public string ProcessName { get; set; } = "osu!";
    /// <summary>"Dark", "Light" or "System"</summary>
    public string Theme { get; set; } = "Dark";
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
        Server.ClientsChanged += () => Changed?.Invoke();
        Server.MessageReceived += OnOverlayMessage;

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
            case "clear":
            case "result":
                Clears.AddFromOverlay(root);
                break;
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
                JsonFile.Save(Paths.KeybindsFile, set);
                Server.Broadcast(KeybindsMessage());
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
