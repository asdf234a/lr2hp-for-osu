using Avalonia;

namespace LR2HP;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        // One instance: a second one couldn't open the overlay port anyway
        using var mutex = new Mutex(true, @"Local\lr2hp-for-osu", out var first);
        if (!first) return;
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>()
        .UsePlatformDetect()
        .WithInterFont()
        .LogToTrace();
}
