# Key input helper for the LR2 HP overlay.
# tosu can't read osu!mania key presses, so this polls the keyboard state and
# streams key down/up events to the overlay over a local websocket.
# Events are only sent while the osu! window is in the foreground.

param(
    [int]$Port = 24055,
    [string]$Process = "osu!"
)

$source = @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

public static class Lr2hpKeys
{
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);

    static readonly List<NetworkStream> clients = new List<NetworkStream>();
    static readonly object gate = new object();

    public static void Run(int port, string processName)
    {
        var listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
        Console.WriteLine("LR2 HP key helper listening on ws://127.0.0.1:" + port + "/");
        Console.WriteLine("Sending keys only while '" + processName + "' is focused. Close this window to stop.");
        new Thread(() => AcceptLoop(listener)) { IsBackground = true }.Start();
        PollLoop(processName);
    }

    static void AcceptLoop(TcpListener listener)
    {
        while (true)
        {
            TcpClient client = listener.AcceptTcpClient();
            new Thread(() => Handshake(client)) { IsBackground = true }.Start();
        }
    }

    static void Handshake(TcpClient client)
    {
        try
        {
            client.NoDelay = true;
            NetworkStream stream = client.GetStream();
            var buffer = new byte[4096];
            var request = new StringBuilder();
            while (!request.ToString().Contains("\r\n\r\n"))
            {
                int n = stream.Read(buffer, 0, buffer.Length);
                if (n <= 0) { client.Close(); return; }
                request.Append(Encoding.ASCII.GetString(buffer, 0, n));
            }
            Match m = Regex.Match(request.ToString(), "Sec-WebSocket-Key:\\s*(\\S+)", RegexOptions.IgnoreCase);
            if (!m.Success)
            {
                byte[] body = Encoding.ASCII.GetBytes("LR2 HP key helper is running.");
                byte[] head = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: " + body.Length + "\r\nConnection: close\r\n\r\n");
                stream.Write(head, 0, head.Length);
                stream.Write(body, 0, body.Length);
                client.Close();
                return;
            }
            string accept;
            using (var sha1 = SHA1.Create())
            {
                accept = Convert.ToBase64String(sha1.ComputeHash(Encoding.ASCII.GetBytes(m.Groups[1].Value + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
            }
            byte[] response = Encoding.ASCII.GetBytes("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
            stream.Write(response, 0, response.Length);
            lock (gate) clients.Add(stream);
            Console.WriteLine("Overlay connected (" + clients.Count + ")");

            // Drain whatever the browser sends; a read of 0 or a close frame ends the session
            while (true)
            {
                int n = stream.Read(buffer, 0, buffer.Length);
                if (n <= 0 || (buffer[0] & 0x0F) == 0x8) break;
            }
        }
        catch (Exception) { }
        Drop(client);
    }

    static void Drop(TcpClient client)
    {
        lock (gate)
        {
            try { clients.Remove(client.GetStream()); } catch (Exception) { }
        }
        try { client.Close(); } catch (Exception) { }
    }

    static void Broadcast(string text)
    {
        byte[] payload = Encoding.UTF8.GetBytes(text);
        byte[] frame = new byte[payload.Length + 2];
        frame[0] = 0x81;
        frame[1] = (byte)payload.Length; // messages are always shorter than 126 bytes
        Buffer.BlockCopy(payload, 0, frame, 2, payload.Length);
        lock (gate)
        {
            for (int i = clients.Count - 1; i >= 0; i--)
            {
                try { clients[i].Write(frame, 0, frame.Length); }
                catch (Exception) { clients.RemoveAt(i); }
            }
        }
    }

    static bool IsTargetFocused(string processName)
    {
        try
        {
            uint pid;
            GetWindowThreadProcessId(GetForegroundWindow(), out pid);
            if (pid == 0) return false;
            return string.Equals(Process.GetProcessById((int)pid).ProcessName, processName, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception) { return false; }
    }

    static void PollLoop(string processName)
    {
        timeBeginPeriod(1);
        // Skip mouse buttons and the generic shift/ctrl/alt codes (their left/right codes are polled instead)
        var vks = new List<int>();
        for (int vk = 0x08; vk <= 0xFE; vk++)
        {
            if (vk == 0x10 || vk == 0x11 || vk == 0x12) continue;
            vks.Add(vk);
        }
        var down = new bool[256];
        var clock = Stopwatch.StartNew();
        long nextFocusCheck = 0;
        bool focused = false;

        while (true)
        {
            long now = clock.ElapsedMilliseconds;
            if (now >= nextFocusCheck)
            {
                bool f = IsTargetFocused(processName);
                if (f != focused)
                {
                    focused = f;
                    Broadcast("{\"focus\":" + (f ? 1 : 0) + "}");
                }
                nextFocusCheck = now + 100;
            }

            foreach (int vk in vks)
            {
                bool d = (GetAsyncKeyState(vk) & 0x8000) != 0;
                if (d == down[vk]) continue;
                down[vk] = d;
                // Releases always go out so the overlay never sees a stuck key
                if (focused || !d)
                {
                    Broadcast("{\"vk\":" + vk + ",\"d\":" + (d ? 1 : 0) + ",\"t\":" + clock.ElapsedMilliseconds + "}");
                }
            }
            Thread.Sleep(1);
        }
    }
}
"@

Add-Type -TypeDefinition $source -Language CSharp
[Lr2hpKeys]::Run($Port, $Process)
