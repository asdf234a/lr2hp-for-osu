using System.Diagnostics;
using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Markup.Xaml;
using Avalonia.Threading;
using LR2HP.Core;

namespace LR2HP.UI;

/// <summary>Small always-on-top window, laid out like Lazer Replay Compare's compact view.</summary>
public sealed partial class MainWindow : Window
{
    private readonly AppController app = new();
    private readonly MainViewModel viewModel;
    private bool refreshQueued;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    public MainWindow()
    {
        AvaloniaXamlLoader.Load(this);
        ThemeService.Apply(this, app.Settings.Theme);
        viewModel = new MainViewModel(app, this);
        DataContext = viewModel;

        Topmost = app.Settings.AlwaysOnTop;
        this.FindControl<ToggleButton>("PinButton")!.IsChecked = Topmost;
        UpdatePinTip();

        if (app.Settings.WindowX is { } x && app.Settings.WindowY is { } y)
        {
            WindowStartupLocation = WindowStartupLocation.Manual;
            Position = new PixelPoint(x, y);
        }

        Opened += (_, _) =>
        {
            RoundCorners();
            app.Changed += QueueRefresh;
            app.Start();
            viewModel.Refresh();
        };
        Closing += (_, _) =>
        {
            app.Settings.WindowX = Position.X;
            app.Settings.WindowY = Position.Y;
            app.SaveSettings();
            app.Dispose();
        };
    }

    // Many events can fire at once (key layouts, tosu, overlays); redraw once per UI tick
    private void QueueRefresh()
    {
        if (refreshQueued) return;
        refreshQueued = true;
        Dispatcher.UIThread.Post(() =>
        {
            refreshQueued = false;
            viewModel.Refresh();
        }, DispatcherPriority.Background);
    }

    private void RoundCorners()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000) || TryGetPlatformHandle()?.Handle is not { } handle) return;
        try
        {
            var round = 2; // DWMWCP_ROUND
            DwmSetWindowAttribute(handle, 33, ref round, sizeof(int));
        }
        catch
        {
            // older Windows: square corners
        }
    }

    private void SyncKeys(object? sender, RoutedEventArgs e)
    {
        app.SyncKeybinds();
        viewModel.Refresh();
        if (this.FindControl<TextBlock>("KeysInfo") is { } info) info.Text = "Reading…";
    }

    private void TogglePin(object? sender, RoutedEventArgs e)
    {
        Topmost = this.FindControl<ToggleButton>("PinButton")!.IsChecked == true;
        app.Settings.AlwaysOnTop = Topmost;
        app.SaveSettings();
        UpdatePinTip();
    }

    private void UpdatePinTip() =>
        ToolTip.SetTip(this.FindControl<ToggleButton>("PinButton")!, Topmost ? "Always on top (click to turn off)" : "Not on top (click to keep on top)");

    // Fill the settings flyout with the current values each time it opens
    private bool fillingSettings;

    private void SettingsOpening(object? sender, EventArgs e)
    {
        fillingSettings = true;
        var english = app.Settings.TitleLanguage == "english";
        if (this.FindControl<RadioButton>("TitlesOriginal") is { } original) original.IsChecked = !english;
        if (this.FindControl<RadioButton>("TitlesEnglish") is { } eng) eng.IsChecked = english;
        if (this.FindControl<RadioButton>("Theme" + (app.Settings.Theme is "Light" or "System" ? app.Settings.Theme : "Dark")) is { } theme) theme.IsChecked = true;
        if (this.FindControl<RadioButton>(app.Settings.LampBlink switch { "skin" => "BlinkSkin", "off" => "BlinkOff", _ => "BlinkSoft" }) is { } blink) blink.IsChecked = true;
        fillingSettings = false;
        if (this.FindControl<TextBlock>("KeysInfo") is { } keys) keys.Text = viewModel.KeysDetails;
        if (this.FindControl<TextBlock>("FolderInfo") is { } folder) folder.Text = Paths.Root;
    }

    private void TitlesChanged(object? sender, RoutedEventArgs e)
    {
        if (fillingSettings || sender is not RadioButton { IsChecked: true } radio) return;
        app.Settings.TitleLanguage = radio.Name == "TitlesEnglish" ? "english" : "original";
        app.SaveSettings();
        viewModel.Refresh();
    }

    private void ThemeChanged(object? sender, RoutedEventArgs e)
    {
        if (fillingSettings || sender is not RadioButton { IsChecked: true, Name: { } name }) return;
        app.Settings.Theme = name["Theme".Length..];
        app.SaveSettings();
        ThemeService.Apply(this, app.Settings.Theme);
        viewModel.Refresh(); // the lamp and rank brushes come from the palette
    }

    private void BlinkChanged(object? sender, RoutedEventArgs e)
    {
        if (fillingSettings || sender is not RadioButton { IsChecked: true, Name: { } name }) return;
        app.Settings.LampBlink = name["Blink".Length..].ToLowerInvariant();
        app.SaveSettings();
        viewModel.Refresh();
    }

    private void OpenFolder(object? sender, RoutedEventArgs e)
    {
        try
        {
            Process.Start(new ProcessStartInfo { FileName = Paths.Root, UseShellExecute = true });
        }
        catch
        {
            // no shell
        }
    }

    private void CloseApp(object? sender, RoutedEventArgs e) => Close();

    /// <summary>No title bar, so dragging any empty part of the window moves it.</summary>
    private void DragWindow(object? sender, PointerPressedEventArgs e)
    {
        if (e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) BeginMoveDrag(e);
    }
}
