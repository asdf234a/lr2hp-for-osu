using System.Text.Json;

namespace LR2HP.Core;

/// <summary>Everything the app keeps lives next to the exe, so the folder can be moved or copied as is.</summary>
public static class Paths
{
    public static string Root { get; } = Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;

    public static string KeybindsFile => Path.Combine(Root, "keybinds.json");
    public static string ClearsFile => Path.Combine(Root, "clears.json");
    public static string SettingsFile => Path.Combine(Root, "settings.json");
    public static string LogFile => Path.Combine(Root, "lr2hp-for-osu.log");
}

public static class JsonFile
{
    public static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>
    /// Reads a file written by <see cref="Save{T}"/>. A file that can't be read is never written over:
    /// it is moved aside as "name.corrupt-yyyyMMdd-HHmmss", and the previous version ("name.bak") is
    /// used instead when there is one.
    /// </summary>
    public static T Load<T>(string path) where T : new()
    {
        if (!File.Exists(path)) return new T();
        if (TryRead<T>(path, out var value, out var error)) return value;

        var aside = $"{path}.corrupt-{DateTime.Now:yyyyMMdd-HHmmss}";
        try
        {
            File.Move(path, aside);
            Log.Write($"could not read {Path.GetFileName(path)} ({error}); kept it as {Path.GetFileName(aside)}");
        }
        catch (Exception e)
        {
            Log.Write($"could not read {Path.GetFileName(path)} ({error}) or move it aside ({e.Message})");
        }

        var backup = path + ".bak";
        if (!File.Exists(backup)) return new T();
        if (TryRead<T>(backup, out var previous, out var backupError))
        {
            Log.Write($"restored {Path.GetFileName(path)} from {Path.GetFileName(backup)}");
            return previous;
        }
        Log.Write($"{Path.GetFileName(backup)} can't be read either ({backupError})");
        return new T();
    }

    private static bool TryRead<T>(string path, out T value, out string error) where T : new()
    {
        try
        {
            value = JsonSerializer.Deserialize<T>(File.ReadAllText(path), Options) ?? throw new JsonException("empty");
            error = "";
            return true;
        }
        catch (Exception e)
        {
            value = new T();
            error = e.Message;
            return false;
        }
    }

    /// <summary>
    /// Writes to a temporary file, flushes it to disk, then swaps it in. The version it replaces is
    /// kept as "name.bak", so a crash or power cut leaves either the old file or the new one.
    /// </summary>
    public static void Save<T>(string path, T value)
    {
        var tmp = path + ".tmp";
        using (var file = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(file, value, Options);
            file.Flush(true);
        }
        if (!File.Exists(path))
        {
            File.Move(tmp, path);
            return;
        }
        try
        {
            File.Replace(tmp, path, path + ".bak", ignoreMetadataErrors: true);
        }
        catch (IOException)
        {
            // File.Replace needs both files on one NTFS volume; otherwise copy the backup by hand
            File.Copy(path, path + ".bak", true);
            File.Move(tmp, path, true);
        }
    }
}

/// <summary>Appends to lr2hp-for-osu.log next to the exe; past 1 MB the old log becomes lr2hp-for-osu.log.1.</summary>
public static class Log
{
    private const long MaxBytes = 1024 * 1024;
    private static readonly object gate = new();

    public static event Action<string>? Written;

    public static void Write(string message)
    {
        System.Diagnostics.Debug.WriteLine(message);
        lock (gate)
        {
            try
            {
                var file = new FileInfo(Paths.LogFile);
                if (file.Exists && file.Length > MaxBytes) File.Move(file.FullName, file.FullName + ".1", true);
                File.AppendAllText(Paths.LogFile, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}{Environment.NewLine}");
            }
            catch
            {
                // a read-only folder or a full disk: logging is best effort
            }
        }
        Written?.Invoke(message);
    }
}
