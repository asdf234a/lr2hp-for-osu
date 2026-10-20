using System.Text.Json;
using Avalonia;
using LR2HP.Core;

namespace LR2HP;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        // Release packaging: the default settings and key layout files that ship next to the exe
        if (args is ["--write-defaults", var dir])
        {
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, "settings.json"), JsonSerializer.Serialize(new AppSettings(), JsonFile.Options));
            File.WriteAllText(Path.Combine(dir, "keybinds.json"), JsonSerializer.Serialize(new KeybindSet(), JsonFile.Options));
            return;
        }

        // One instance: a second one couldn't open the overlay port anyway
        using var mutex = new Mutex(true, @"Local\lr2hp-for-osu", out var first);
        if (!first) return;

        Paths.TidyUp();
        Log.Write($"lr2hp-for-osu {typeof(Program).Assembly.GetName().Version?.ToString(3)} started in {Paths.Root}");
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Write($"crash: {e.ExceptionObject}");
        TaskScheduler.UnobservedTaskException += (_, e) => Log.Write($"unobserved task error: {e.Exception}");
        try
        {
            BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
        }
        catch (Exception e)
        {
            Log.Write($"crash: {e}");
            throw;
        }
    }

    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>()
        .UsePlatformDetect()
        .WithInterFont()
        .LogToTrace();
}
