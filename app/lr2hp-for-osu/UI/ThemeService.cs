using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Styling;

namespace LR2HP.UI;

/// <summary>Colours, following Lazer Replay Compare's palette (dark, light) so the two apps sit together.</summary>
public static class ThemeService
{
    private static readonly Dictionary<string, (string Dark, string Light)> palette = new()
    {
        ["PageBrush"] = ("#0E1014", "#F4F5F7"),
        ["TextBrush"] = ("#E8EAEE", "#14171D"),
        ["TextSecondaryBrush"] = ("#B8BFCC", "#4A5261"),
        ["TextMutedBrush"] = ("#9AA3B2", "#5F6776"),
        ["ButtonBrush"] = ("#1E2330", "#EEF0F4"),
        ["ButtonHoverBrush"] = ("#272D3B", "#E3E6EC"),
        ["ButtonBorderBrush"] = ("#2E3441", "#D3D8E0"),
        ["ChipBrush"] = ("#262131", "#EEF0F4"),
        ["ChipTextBrush"] = ("#D6DBE4", "#3A4250"),
        ["TargetRowBrush"] = ("#221A27", "#FDEEF5"),
        ["TargetLabelBrush"] = ("#FF9CC8", "#B3326E"),
        ["TargetAccentBrush"] = ("#FF66AA", "#D63C82"),
        ["GoodBackgroundBrush"] = ("#14301F", "#E3F7EA"),
        ["GoodTextBrush"] = ("#8FEDB6", "#1B7A43"),
        ["ErrorBackgroundBrush"] = ("#3A1A1C", "#FDE7E7"),
        ["ErrorTextBrush"] = ("#FFC2C2", "#B42323"),
        ["PositiveTextBrush"] = ("#6EE7A0", "#1B7A43"),
        ["NegativeTextBrush"] = ("#FF8A8A", "#C02626"),
        ["HoverCardBrush"] = ("#1E2330", "#FFFFFF"),
        ["HoverCardBorderBrush"] = ("#2E3441", "#D3D8E0"),

        // Clear lamps, from the m_select skin's clearlamp.png (the second colour is the blink frame).
        // Light mode darkens them so HARD's white and EASY's green stay readable.
        ["LampExHardBrush"] = ("#FF9900", "#E68A00"),
        ["LampExHardFlashBrush"] = ("#FF0000", "#E00000"),
        ["LampHardBrush"] = ("#FFFFFF", "#7A8291"),
        ["LampGrooveBrush"] = ("#00BAFF", "#0095D9"),
        ["LampEasyBrush"] = ("#00FF00", "#00A800"),
        ["LampFailedBrush"] = ("#FF0000", "#E00000"),
        ["LampFailedFlashBrush"] = ("#993300", "#993300"),
        ["LampNoneBrush"] = ("#5F6776", "#9AA3B2"),
        ["RankAaaBrush"] = ("#F5C451", "#A86B00"),
    };

    public static bool IsLight { get; private set; }

    /// <summary>theme: "Dark" (default), "Light" or "System"</summary>
    public static void Apply(Window target, string theme)
    {
        target.RequestedThemeVariant = theme switch
        {
            "Light" => ThemeVariant.Light,
            "System" => ThemeVariant.Default,
            _ => ThemeVariant.Dark,
        };
        IsLight = target.ActualThemeVariant == ThemeVariant.Light;
        foreach (var (key, colors) in palette)
            target.Resources[key] = new SolidColorBrush(Color.Parse(IsLight ? colors.Light : colors.Dark));

        // Scrims over the beatmap background, in the page colour
        var page = Color.Parse(IsLight ? palette["PageBrush"].Light : palette["PageBrush"].Dark);
        foreach (var alpha in new[] { 35, 62, 80, 92 })
            target.Resources[$"BannerScrim{alpha}Color"] = Color.FromArgb((byte)Math.Round(alpha * 2.55), page.R, page.G, page.B);
    }

    public static IBrush Brush(Window window, string key) =>
        window.Resources.TryGetValue(key, out var v) && v is IBrush b ? b : Brushes.Gray;
}
