using System.Collections.Concurrent;
using System.Text.Json;

namespace LR2HP.Core;

/// <summary>
/// Everything the app keeps lives next to the exe, so the folder can be moved or copied as is:
/// the data files at the top, previous versions and unreadable files in backup/, the log in logs/.
/// </summary>
public static class Paths
{
    public static string Root { get; } = Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;

    public static string KeybindsFile => Path.Combine(Root, "keybinds.json");
    public static string ClearsFile => Path.Combine(Root, "clears.json");
    public static string SettingsFile => Path.Combine(Root, "settings.json");
    public static string BackupDir => Path.Combine(Root, "backup");
    public static string LogDir => Path.Combine(Root, "logs");
    public static string LogFile => Path.Combine(LogDir, "lr2hp-for-osu.log");

    /// <summary>The kept previous version of a data file: backup/name.bak</summary>
    public static string BackupOf(string path) => Path.Combine(BackupDir, Path.GetFileName(path) + ".bak");

    /// <summary>Moves backups and logs left at the top by older versions into backup/ and logs/.</summary>
    public static void TidyUp()
    {
        try
        {
            foreach (var file in Directory.EnumerateFiles(Root))
            {
                var name = Path.GetFileName(file);
                var dir = name.EndsWith(".bak", StringComparison.OrdinalIgnoreCase) || name.Contains(".corrupt-", StringComparison.OrdinalIgnoreCase)
                    ? BackupDir
                    : name.StartsWith("lr2hp-for-osu.log", StringComparison.OrdinalIgnoreCase) ? LogDir : null;
                if (dir == null) continue;
                Directory.CreateDirectory(dir);
                File.Move(file, Path.Combine(dir, name), true);
            }
        }
        catch
        {
            // a read-only folder: leave things where they are
        }
    }
}

public static class JsonFile
{
    public static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private enum ReadResult { Ok, Corrupt, Unavailable }

    /// <summary>Files that exist but couldn't be opened (locked, no permission): path -> why. Never written over.</summary>
    private static readonly ConcurrentDictionary<string, string> blocked = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>True while the last <see cref="Load{T}"/> of this file couldn't open it; <see cref="Save{T}"/> refuses it then.</summary>
    public static bool IsBlocked(string path, out string reason) => blocked.TryGetValue(path, out reason!);

    /// <summary>
    /// Reads a file written by <see cref="Save{T}"/>.
    /// <list type="bullet">
    /// <item>Not valid JSON: the file is moved to backup/ under a name of its own and the previous
    /// version (backup/name.bak) is used instead.</item>
    /// <item>Can't be opened (another program holds it, no permission), even after a few tries: the
    /// file is left alone and marked blocked, so nothing is written over it until a later Load reads it.</item>
    /// </list>
    /// </summary>
    public static T Load<T>(string path) where T : new()
    {
        var name = Path.GetFileName(path);
        if (!File.Exists(path))
        {
            blocked.TryRemove(path, out _);
            return new T();
        }
        switch (Read<T>(path, out var value, out var error))
        {
            case ReadResult.Ok:
                blocked.TryRemove(path, out _);
                return value;
            case ReadResult.Unavailable:
                return Block<T>(path, $"{name} can't be opened ({error})");
        }

        if (!MoveAside(path, out var aside))
            return Block<T>(path, $"{name} is not valid JSON ({error}) and can't be moved to backup");
        Log.Write($"{name} is not valid JSON ({error}); kept it as backup/{Path.GetFileName(aside)}");

        var backup = Paths.BackupOf(path);
        if (!File.Exists(backup))
        {
            blocked.TryRemove(path, out _);
            return new T();
        }
        switch (Read<T>(backup, out var previous, out var backupError))
        {
            case ReadResult.Ok:
                blocked.TryRemove(path, out _);
                Log.Write($"restored {name} from backup/{Path.GetFileName(backup)}");
                return previous;
            case ReadResult.Unavailable:
                // Starting empty would replace this backup on the next save
                return Block<T>(path, $"{name} was broken and backup/{Path.GetFileName(backup)} can't be opened ({backupError})");
        }
        // The backup is broken too: keep it under its own name rather than overwrite it later
        if (MoveAside(backup, out var backupAside))
            Log.Write($"backup/{Path.GetFileName(backup)} is not valid JSON either ({backupError}); kept it as backup/{Path.GetFileName(backupAside)}");
        else
            return Block<T>(path, $"{name} and its backup are not valid JSON, and the backup can't be moved");
        blocked.TryRemove(path, out _);
        return new T();
    }

    private static T Block<T>(string path, string reason) where T : new()
    {
        blocked[path] = reason;
        Log.Write($"{reason}; it will not be written over");
        return new T();
    }

    /// <summary>Reads and parses a file, trying again for a moment while another program holds it.</summary>
    private static ReadResult Read<T>(string path, out T value, out string error) where T : new()
    {
        value = new T();
        error = "";
        for (var attempt = 0; ; attempt++)
        {
            string text;
            try
            {
                text = File.ReadAllText(path);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                error = e.Message;
                if (attempt >= 4) return ReadResult.Unavailable;
                Thread.Sleep(200);
                continue;
            }
            try
            {
                value = JsonSerializer.Deserialize<T>(text, Options) ?? throw new JsonException("the file holds null");
                return ReadResult.Ok;
            }
            catch (JsonException e)
            {
                error = e.Message;
                return ReadResult.Corrupt;
            }
        }
    }

    /// <summary>Moves a file to backup/name.corrupt-yyyyMMdd-HHmmss-fff-xxxxxxxx (never the same name twice).</summary>
    private static bool MoveAside(string path, out string aside)
    {
        aside = Path.Combine(Paths.BackupDir, $"{Path.GetFileName(path)}.corrupt-{DateTime.Now:yyyyMMdd-HHmmss-fff}-{Guid.NewGuid().ToString("N")[..8]}");
        try
        {
            Directory.CreateDirectory(Paths.BackupDir);
            File.Move(path, aside);
            return true;
        }
        catch (Exception e)
        {
            Log.Write($"could not move {Path.GetFileName(path)} to backup ({e.Message})");
            return false;
        }
    }

    /// <summary>
    /// Writes to a temporary file, flushes it to disk, then swaps it in. The version it replaces is
    /// kept as backup/name.bak, so a crash or power cut leaves either the old file or the new one.
    /// Throws for a file the last <see cref="Load{T}"/> couldn't open, so it is never written over.
    /// </summary>
    public static void Save<T>(string path, T value)
    {
        if (IsBlocked(path, out var reason)) throw new IOException($"not saved: {reason}");
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
        var backup = Paths.BackupOf(path);
        Directory.CreateDirectory(Paths.BackupDir);
        try
        {
            File.Replace(tmp, path, backup, ignoreMetadataErrors: true);
        }
        catch (IOException)
        {
            // File.Replace needs both files on one NTFS volume; otherwise copy the backup by hand
            File.Copy(path, backup, true);
            File.Move(tmp, path, true);
        }
    }
}

/// <summary>Appends to logs/lr2hp-for-osu.log; past 1 MB the old log becomes lr2hp-for-osu.log.1.</summary>
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
                Directory.CreateDirectory(Paths.LogDir);
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
