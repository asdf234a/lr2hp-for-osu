using System.Text.Json;

namespace LR2HP.Core;

/// <summary>Everything the app keeps lives next to the exe, so the folder can be moved or copied as is.</summary>
public static class Paths
{
    public static string Root { get; } = Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;

    public static string KeybindsFile => Path.Combine(Root, "keybinds.json");
    public static string ClearsFile => Path.Combine(Root, "clears.json");
    public static string SettingsFile => Path.Combine(Root, "settings.json");
}

public static class JsonFile
{
    public static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static T Load<T>(string path) where T : new()
    {
        try
        {
            if (File.Exists(path))
                return JsonSerializer.Deserialize<T>(File.ReadAllText(path), Options) ?? new T();
        }
        catch (Exception e)
        {
            Log.Write($"could not read {path}: {e.Message}");
        }
        return new T();
    }

    /// <summary>Writes to a temporary file first, so a crash never leaves half a file behind.</summary>
    public static void Save<T>(string path, T value)
    {
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(value, Options));
        File.Move(tmp, path, true);
    }
}

public static class Log
{
    public static event Action<string>? Written;

    public static void Write(string message)
    {
        System.Diagnostics.Debug.WriteLine(message);
        Written?.Invoke(message);
    }
}
