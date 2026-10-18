using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using LR2HP.Core;

namespace LR2HP.UI;

public sealed class RateChip
{
    public string Text { get; init; } = "";
    public IBrush Brush { get; init; } = Brushes.Gray;
    public string Tip { get; init; } = "";
}

/// <summary>What the compact window shows, rebuilt from the controller whenever something changes.</summary>
public sealed class MainViewModel : INotifyPropertyChanged
{
    private readonly AppController app;
    private readonly Window window;
    private string backgroundFor = "";

    public MainViewModel(AppController app, Window window)
    {
        this.app = app;
        this.window = window;
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }

    private bool allConnected;
    public bool AllConnected { get => allConnected; private set => Set(ref allConnected, value); }

    private string connectionText = "";
    public string ConnectionText { get => connectionText; private set => Set(ref connectionText, value); }

    private string connectionDetails = "";
    public string ConnectionDetails { get => connectionDetails; private set => Set(ref connectionDetails, value); }

    private string beatmapTitle = "No map selected";
    public string BeatmapTitle { get => beatmapTitle; private set => Set(ref beatmapTitle, value); }

    private string beatmapSubtitle = "";
    public string BeatmapSubtitle { get => beatmapSubtitle; private set => Set(ref beatmapSubtitle, value); }

    private Bitmap? backgroundImage;
    public Bitmap? BackgroundImage { get => backgroundImage; private set => Set(ref backgroundImage, value); }

    private bool hasBest;
    public bool HasBest { get => hasBest; private set => Set(ref hasBest, value); }

    private string bestHeader = "";
    public string BestHeader { get => bestHeader; private set => Set(ref bestHeader, value); }

    private string bestLamp = "";
    public string BestLamp { get => bestLamp; private set => Set(ref bestLamp, value); }

    private IBrush bestBrush = Brushes.Gray;
    public IBrush BestBrush { get => bestBrush; private set => Set(ref bestBrush, value); }

    private string bestDetail = "";
    public string BestDetail { get => bestDetail; private set => Set(ref bestDetail, value); }

    private string bestTip = "";
    public string BestTip { get => bestTip; private set => Set(ref bestTip, value); }

    private string rankText = "";
    public string RankText { get => rankText; private set => Set(ref rankText, value); }

    private string rankDiff = "";
    public string RankDiff { get => rankDiff; private set => Set(ref rankDiff, value); }

    private IBrush rankBrush = Brushes.White;
    public IBrush RankBrush { get => rankBrush; private set => Set(ref rankBrush, value); }

    // Blinking lamps, as in the m_select skin: EX-HARD swaps to its second colour every 50 ms
    // (100 ms cycle), FAILED every 25 ms (50 ms cycle). The others stay still.
    private IBrush bestFlashBrush = Brushes.Transparent;
    public IBrush BestFlashBrush { get => bestFlashBrush; private set => Set(ref bestFlashBrush, value); }

    private bool lampFlashSlow;
    public bool LampFlashSlow { get => lampFlashSlow; private set => Set(ref lampFlashSlow, value); }

    private bool lampFlashFast;
    public bool LampFlashFast { get => lampFlashFast; private set => Set(ref lampFlashFast, value); }

    /// <summary>The "soft" blink setting: a slow fade instead of the skin's flicker</summary>
    private bool lampFlashSoft;
    public bool LampFlashSoft { get => lampFlashSoft; private set => Set(ref lampFlashSoft, value); }

    private string noBestText = "";
    public string NoBestText { get => noBestText; private set => Set(ref noBestText, value); }

    private IReadOnlyList<RateChip> otherRates = [];
    public IReadOnlyList<RateChip> OtherRates { get => otherRates; private set => Set(ref otherRates, value); }

    private bool hasOtherRates;
    public bool HasOtherRates { get => hasOtherRates; private set => Set(ref hasOtherRates, value); }


    private string keysDetails = "";
    public string KeysDetails { get => keysDetails; private set => Set(ref keysDetails, value); }

    private string errorText = "";
    public string ErrorText { get => errorText; private set => Set(ref errorText, value); }

    private bool hasError;
    public bool HasError { get => hasError; private set => Set(ref hasError, value); }

    private IBrush LampBrush(string lamp) => ThemeService.Brush(window, lamp switch
    {
        "exhard" => "LampExHardBrush",
        "hard" => "LampHardBrush",
        "groove" => "LampGrooveBrush",
        "easy" => "LampEasyBrush",
        "failed" => "LampFailedBrush",
        _ => "LampNoneBrush",
    });

    private static string Short(string lamp) => lamp switch
    {
        "exhard" => "EXH",
        "hard" => "HARD",
        "groove" => "CLEAR",
        "easy" => "EASY",
        "failed" => "FAIL",
        _ => "-",
    };

    public void Refresh()
    {
        var tosu = app.Tosu;
        var s = tosu.Current;
        var overlays = app.Server.Count;

        // Connection pill: tosu and at least one overlay
        var problems = new List<string>();
        if (!tosu.Connected) problems.Add("tosu offline");
        if (overlays == 0) problems.Add("no overlay");
        AllConnected = problems.Count == 0;
        ConnectionText = AllConnected ? "All connected" : string.Join(" · ", problems);
        ConnectionDetails = string.Join("\n",
            $"tosu: {(tosu.Connected ? $"connected ({s.Client})" : $"not reachable at {app.Settings.TosuHost}")}",
            $"overlays: {overlays} on ws://127.0.0.1:{app.Settings.Port}",
            $"osu! focused: {(app.Keys.Focused ? "yes" : "no")}",
            $"data folder: {Paths.Root}");

        HasError = app.StartError != null;
        ErrorText = app.StartError ?? "";

        // Map
        var hasMap = tosu.Connected && s.Checksum.Length > 0;
        var english = app.Settings.TitleLanguage == "english";
        BeatmapTitle = hasMap ? (english ? s.TitleEnglish : s.TitleOriginal) : "No map selected";
        BeatmapSubtitle = hasMap ? $"{(english ? s.ArtistEnglish : s.ArtistOriginal)} · {s.Mapper} [{s.Version}]" : "";
        if (hasMap && s.Checksum != backgroundFor)
        {
            backgroundFor = s.Checksum;
            _ = LoadBackground(s.Checksum);
        }
        else if (!hasMap)
        {
            backgroundFor = "";
            BackgroundImage = null;
        }

        // Best clear at the selected rate (lamp, best EX score, lowest BP), and what other rates hold
        var rateKey = ClearStore.RateKey(s.Rate);
        var scoring = ClearStore.ScoringOf(s.Client, s.Mods);
        var summaries = hasMap ? app.Clears.Summary(s.Checksum, scoring) : [];
        var here = summaries.FirstOrDefault(b => b.Rate == rateKey);
        HasBest = here != null;
        if (here != null)
        {
            var lamp = here.BestLamp;
            var score = here.BestScore;
            BestHeader = $"Best · {rateKey}×{(s.Keys > 0 ? $" · {s.Keys}K" : "")} · {ClearStore.TotalLabel(lamp)}";
            BestLamp = ClearStore.Label(lamp.Lamp);
            BestBrush = LampBrush(lamp.Lamp);
            var blink = app.Settings.LampBlink;
            LampFlashSlow = blink != "off" && lamp.Lamp == "exhard";
            LampFlashFast = blink != "off" && lamp.Lamp == "failed";
            LampFlashSoft = blink == "soft";
            BestFlashBrush = lamp.Lamp switch
            {
                "exhard" => ThemeService.Brush(window, "LampExHardFlashBrush"),
                "failed" => ThemeService.Brush(window, "LampFailedFlashBrush"),
                _ => Brushes.Transparent,
            };
            BestDetail = $"EX {score.ExScore:N0} · {score.ScoreRate * 100:0.00}% · BP {here.BestBp}";
            (RankText, RankDiff) = ClearStore.RankOf(score.ExScore, score.Notes);
            RankBrush = ThemeService.Brush(window, RankText switch
            {
                "AAA" => "RankAaaBrush",
                "AA" or "A" => "TextBrush",
                _ => "TextMutedBrush",
            });
            BestTip = $"{ClearStore.Label(lamp.Lamp)} on {lamp.Date:yyyy-MM-dd HH:mm} ({ClearStore.TotalLabel(lamp)})\n"
                + $"best EX {score.ExScore:N0} on {score.Date:yyyy-MM-dd} · lowest BP {here.BestBp}\n"
                + $"{here.Count} record{(here.Count > 1 ? "s" : "")} at {rateKey}×";
        }
        NoBestText = hasMap ? $"No record at {rateKey}× yet" : "Select a map in osu!";
        OtherRates = summaries.Where(b => b.Rate != rateKey).Select(b => new RateChip
        {
            Text = $"{b.Rate}×  {Short(b.BestLamp.Lamp)}",
            Brush = LampBrush(b.BestLamp.Lamp),
            Tip = $"{ClearStore.Label(b.BestLamp.Lamp)} · {ClearStore.RankOf(b.BestScore.ExScore, b.BestScore.Notes).Rank} · BP {b.BestBp} · {ClearStore.TotalLabel(b.BestLamp)}",
        }).ToList();
        HasOtherRates = OtherRates.Count > 0;

        // Key bindings, shown in the settings flyout: the layout for this map, then where they came from
        var kb = app.Keybinds;
        var client = s.Client == "stable" ? "stable" : "lazer";
        var layouts = client == "stable" ? kb.Stable : kb.Lazer;
        var current = s.Keys > 0 && layouts.TryGetValue(s.Keys.ToString(CultureInfo.InvariantCulture), out var layout)
            ? $"{client} {s.Keys}K: {layout}\n"
            : "";
        KeysDetails = $"{current}lazer: {kb.LazerSource ?? "not found"}\nstable: {kb.StableSource ?? "not found"}\nread {kb.Updated:yyyy-MM-dd HH:mm}";
    }

    private async Task LoadBackground(string checksum)
    {
        var bytes = await app.Tosu.GetBackgroundAsync();
        if (checksum != backgroundFor) return;
        try
        {
            BackgroundImage = bytes is { Length: > 0 } ? new Bitmap(new MemoryStream(bytes)) : null;
        }
        catch
        {
            BackgroundImage = null;
        }
    }
}
