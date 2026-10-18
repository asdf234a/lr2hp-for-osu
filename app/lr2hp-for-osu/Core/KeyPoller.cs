using System.Diagnostics;
using System.Runtime.InteropServices;

namespace LR2HP.Core;

/// <summary>
/// Polls the keyboard state every millisecond (GetAsyncKeyState, the way key overlays do it:
/// no hooks, no injection, nothing read from osu!'s memory) and reports key changes
/// while osu! is the foreground window.
/// </summary>
public sealed partial class KeyPoller : IDisposable
{
    [LibraryImport("user32.dll")]
    private static partial short GetAsyncKeyState(int vKey);

    [LibraryImport("user32.dll")]
    private static partial IntPtr GetForegroundWindow();

    [LibraryImport("user32.dll")]
    private static partial uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    [LibraryImport("winmm.dll")]
    private static partial uint timeBeginPeriod(uint period);

    [LibraryImport("winmm.dll")]
    private static partial uint timeEndPeriod(uint period);

    private readonly Stopwatch clock = Stopwatch.StartNew();
    private volatile bool running;
    private Thread? thread;

    public string ProcessName { get; set; } = "osu!";

    /// <summary>(virtual-key code, down, ms on this app's clock)</summary>
    public event Action<int, bool, long>? KeyChanged;

    public event Action<bool>? FocusChanged;

    public bool Focused { get; private set; }

    public long Now => clock.ElapsedMilliseconds;

    public void Start()
    {
        running = true;
        thread = new Thread(Loop) { IsBackground = true, Name = "KeyPoller", Priority = ThreadPriority.AboveNormal };
        thread.Start();
    }

    private bool IsTargetFocused()
    {
        try
        {
            GetWindowThreadProcessId(GetForegroundWindow(), out var pid);
            if (pid == 0) return false;
            using var p = Process.GetProcessById((int)pid);
            return string.Equals(p.ProcessName, ProcessName, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private void Loop()
    {
        timeBeginPeriod(1);
        try
        {
            // Mouse buttons and the generic shift/ctrl/alt codes are skipped; their left/right codes are polled
            var vks = Enumerable.Range(0x08, 0xFE - 0x08 + 1).Where(vk => vk is not (0x10 or 0x11 or 0x12)).ToArray();
            var down = new bool[256];
            long nextFocusCheck = 0;
            while (running)
            {
                var now = clock.ElapsedMilliseconds;
                if (now >= nextFocusCheck)
                {
                    var f = IsTargetFocused();
                    if (f != Focused)
                    {
                        Focused = f;
                        FocusChanged?.Invoke(f);
                    }
                    nextFocusCheck = now + 100;
                }
                foreach (var vk in vks)
                {
                    var d = (GetAsyncKeyState(vk) & 0x8000) != 0;
                    if (d == down[vk]) continue;
                    down[vk] = d;
                    // Releases always go out so the overlay never sees a stuck key
                    if (Focused || !d) KeyChanged?.Invoke(vk, d, clock.ElapsedMilliseconds);
                }
                Thread.Sleep(1);
            }
        }
        finally
        {
            timeEndPeriod(1);
        }
    }

    public void Dispose() => running = false;
}
