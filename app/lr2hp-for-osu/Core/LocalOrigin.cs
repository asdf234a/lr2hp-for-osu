namespace LR2HP.Core;

/// <summary>
/// Decides which requests the local overlay server answers. The server only listens on the loopback
/// address, but a web page open in any browser on this PC can still reach 127.0.0.1, so requests are
/// also checked by what the browser says about them:
/// <list type="bullet">
/// <item>Origin: browsers always send it on a websocket handshake. Only pages served from this PC
/// (tosu's overlays, in OBS or a browser) are let in; any other website is refused. Programs that are
/// not browsers send no Origin and are let in, since they could read the keyboard themselves anyway.</item>
/// <item>Host: must name this PC, which stops DNS rebinding (a website whose domain is pointed at
/// 127.0.0.1 after the page has loaded).</item>
/// </list>
/// </summary>
public static class LocalOrigin
{
    private static readonly string[] LoopbackHosts = { "127.0.0.1", "localhost", "[::1]", "::1" };

    /// <summary>The value of a header in a raw HTTP request, or null if it is missing.</summary>
    public static string? Header(string request, string name)
    {
        foreach (var line in request.Split("\r\n"))
        {
            var colon = line.IndexOf(':');
            if (colon <= 0) continue;
            if (line.AsSpan(0, colon).Trim().Equals(name, StringComparison.OrdinalIgnoreCase))
                return line[(colon + 1)..].Trim();
        }
        return null;
    }

    public static bool IsAllowed(string request, int port) =>
        IsAllowedHost(Header(request, "Host"), port) && IsAllowedOrigin(Header(request, "Origin"));

    /// <summary>A missing Host is let in (browsers always send one); otherwise it must be this PC on our port.</summary>
    public static bool IsAllowedHost(string? host, int port)
    {
        if (host == null) return true;
        foreach (var name in LoopbackHosts)
        {
            if (host.Equals($"{name}:{port}", StringComparison.OrdinalIgnoreCase)) return true;
            if (port == 80 && host.Equals(name, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    /// <summary>
    /// No Origin (not a browser) is let in. "null" (a file opened from disk, a sandboxed frame) and
    /// every website are refused; pages served from this PC on any port are let in.
    /// </summary>
    public static bool IsAllowedOrigin(string? origin)
    {
        if (origin == null) return true;
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme is not ("http" or "https")) return false;
        return uri.IsLoopback && uri.Host is "127.0.0.1" or "localhost" or "[::1]" or "::1";
    }
}
