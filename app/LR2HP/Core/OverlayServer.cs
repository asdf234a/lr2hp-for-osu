using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace LR2HP.Core;

/// <summary>
/// The local websocket the overlays connect to (ws://127.0.0.1:24055/). It sends key
/// presses and key layouts to them and receives clear results from them. A small
/// hand-rolled server over TcpListener, so no URL reservation or admin rights are needed.
/// </summary>
public sealed class OverlayServer : IDisposable
{
    public sealed class Client
    {
        internal Client(TcpClient tcp)
        {
            Tcp = tcp;
            Stream = tcp.GetStream();
        }

        internal TcpClient Tcp { get; }
        internal NetworkStream Stream { get; }
        internal readonly object WriteLock = new();
        public string Name { get; set; } = "overlay";
    }

    private readonly List<Client> clients = new();
    private TcpListener? listener;
    private volatile bool running;

    public int Port { get; private set; }

    public event Action<Client>? Connected;
    public event Action<Client, string>? MessageReceived;
    public event Action? ClientsChanged;

    public int Count
    {
        get
        {
            lock (clients) return clients.Count;
        }
    }

    public void Start(int port)
    {
        Port = port;
        listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
        running = true;
        new Thread(AcceptLoop) { IsBackground = true, Name = "OverlayServer" }.Start();
    }

    private void AcceptLoop()
    {
        while (running)
        {
            try
            {
                var tcp = listener!.AcceptTcpClient();
                new Thread(() => Serve(tcp)) { IsBackground = true }.Start();
            }
            catch
            {
                if (!running) return;
            }
        }
    }

    private void Serve(TcpClient tcp)
    {
        Client? client = null;
        try
        {
            tcp.NoDelay = true;
            var stream = tcp.GetStream();
            var request = ReadRequest(stream);
            var key = request.Split("\r\n").Select(l => l.Split(':', 2)).FirstOrDefault(p => p.Length == 2 && p[0].Trim().Equals("Sec-WebSocket-Key", StringComparison.OrdinalIgnoreCase))?[1].Trim();
            if (key == null)
            {
                var body = Encoding.ASCII.GetBytes("LR2 HP is running.");
                var head = Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {body.Length}\r\nConnection: close\r\n\r\n");
                stream.Write(head);
                stream.Write(body);
                tcp.Close();
                return;
            }
            var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
            stream.Write(Encoding.ASCII.GetBytes($"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"));

            client = new Client(tcp);
            lock (clients) clients.Add(client);
            ClientsChanged?.Invoke();
            Connected?.Invoke(client);
            ReadFrames(client);
        }
        catch
        {
            // connection dropped
        }
        finally
        {
            if (client != null)
            {
                lock (clients) clients.Remove(client);
                ClientsChanged?.Invoke();
            }
            try { tcp.Close(); } catch { /* already closed */ }
        }
    }

    private static string ReadRequest(NetworkStream stream)
    {
        var sb = new StringBuilder();
        var buf = new byte[4096];
        while (!sb.ToString().Contains("\r\n\r\n"))
        {
            var n = stream.Read(buf, 0, buf.Length);
            if (n <= 0) throw new IOException("closed");
            sb.Append(Encoding.ASCII.GetString(buf, 0, n));
            if (sb.Length > 16384) throw new IOException("request too large");
        }
        return sb.ToString();
    }

    private static void ReadExactly(Stream s, byte[] buf, int count)
    {
        var read = 0;
        while (read < count)
        {
            var n = s.Read(buf, read, count - read);
            if (n <= 0) throw new IOException("closed");
            read += n;
        }
    }

    private void ReadFrames(Client client)
    {
        var s = client.Stream;
        var head = new byte[8];
        var message = new MemoryStream();
        while (running)
        {
            ReadExactly(s, head, 2);
            var fin = (head[0] & 0x80) != 0;
            var opcode = head[0] & 0x0F;
            var masked = (head[1] & 0x80) != 0;
            long len = head[1] & 0x7F;
            if (len == 126)
            {
                ReadExactly(s, head, 2);
                len = (head[0] << 8) | head[1];
            }
            else if (len == 127)
            {
                ReadExactly(s, head, 8);
                len = 0;
                for (var i = 0; i < 8; i++) len = (len << 8) | head[i];
            }
            if (len > 1 << 20) throw new IOException("frame too large");
            var mask = new byte[4];
            if (masked) ReadExactly(s, mask, 4);
            var payload = new byte[len];
            ReadExactly(s, payload, (int)len);
            if (masked)
                for (var i = 0; i < payload.Length; i++) payload[i] ^= mask[i % 4];

            switch (opcode)
            {
                case 0x8: // close
                    return;
                case 0x9: // ping
                    Send(client, payload, 0xA);
                    break;
                case 0x1: // text
                case 0x0: // continuation
                    message.Write(payload);
                    if (fin)
                    {
                        var text = Encoding.UTF8.GetString(message.ToArray());
                        message.SetLength(0);
                        try { MessageReceived?.Invoke(client, text); } catch (Exception e) { Log.Write($"overlay message: {e.Message}"); }
                    }
                    break;
            }
        }
    }

    private static void Send(Client client, byte[] payload, int opcode)
    {
        var header = new List<byte> { (byte)(0x80 | opcode) };
        if (payload.Length < 126)
        {
            header.Add((byte)payload.Length);
        }
        else if (payload.Length < 65536)
        {
            header.Add(126);
            header.Add((byte)(payload.Length >> 8));
            header.Add((byte)payload.Length);
        }
        else
        {
            header.Add(127);
            for (var i = 7; i >= 0; i--) header.Add((byte)((long)payload.Length >> (8 * i)));
        }
        lock (client.WriteLock)
        {
            client.Stream.Write(header.ToArray());
            client.Stream.Write(payload);
        }
    }

    public void Send(Client client, string text)
    {
        try
        {
            Send(client, Encoding.UTF8.GetBytes(text), 0x1);
        }
        catch
        {
            // the reader thread drops it
        }
    }

    public void Broadcast(string text)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        Client[] targets;
        lock (clients) targets = clients.ToArray();
        foreach (var c in targets)
        {
            try { Send(c, bytes, 0x1); } catch { /* the reader thread drops it */ }
        }
    }

    public void Dispose()
    {
        running = false;
        try { listener?.Stop(); } catch { /* stopping */ }
        lock (clients)
        {
            foreach (var c in clients)
            {
                try { c.Tcp.Close(); } catch { /* closing */ }
            }
        }
    }
}
