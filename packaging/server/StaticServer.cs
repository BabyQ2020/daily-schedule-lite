// 日程轻量版 · 内置静态服务器
// 目标框架：.NET Framework 4.x（Windows 自带），由 csc 直接编译，无需安装 Node 或任何 SDK。
// 职责：只监听 127.0.0.1，把 runtime\web 以 HTTP 提供出去；提供 /__health 供启动器探测。
// 与 Node 版 server.mjs 的对外行为保持一致：缓存头、SPA 回退、404/403、仅 GET/HEAD。
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

internal static class StaticServer
{
    private const string AppName = "日程轻量版";
    private const int MaxHeaderBytes = 32768;

    private static readonly Dictionary<string, string> MimeMap =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".html", "text/html; charset=utf-8" },
            { ".js", "text/javascript; charset=utf-8" },
            { ".mjs", "text/javascript; charset=utf-8" },
            { ".css", "text/css; charset=utf-8" },
            { ".json", "application/json; charset=utf-8" },
            { ".webmanifest", "application/manifest+json; charset=utf-8" },
            { ".svg", "image/svg+xml" },
            { ".png", "image/png" },
            { ".jpg", "image/jpeg" },
            { ".ico", "image/x-icon" },
            { ".woff", "font/woff" },
            { ".woff2", "font/woff2" },
            { ".txt", "text/plain; charset=utf-8" },
            { ".md", "text/plain; charset=utf-8" },
            { ".map", "application/json; charset=utf-8" },
        };

    private static string _root;
    private static string _pidFile;
    private static string _logFile;
    private static readonly object LogLock = new object();

    private static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;

        _root = Path.GetFullPath(Arg(args, "--root", Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "runtime", "web")));
        int port = ParseInt(Arg(args, "--port", "4180"), 4180);
        _pidFile = Arg(args, "--pid-file", null);
        _logFile = Arg(args, "--log-file", null);

        if (!Directory.Exists(_root))
        {
            Log("✗ 找不到站点目录：" + _root);
            return 2;
        }

        var listener = new TcpListener(IPAddress.Loopback, port);
        try
        {
            listener.Start();
        }
        catch (SocketException error)
        {
            if (error.SocketErrorCode == SocketError.AddressAlreadyInUse)
            {
                Log("✗ 端口 " + port + " 已被其他程序占用。请关闭占用该端口的程序（或双击「停止服务.exe」）后重试。");
            }
            else
            {
                Log("✗ 无法监听 127.0.0.1:" + port + " —— " + error.Message);
            }
            return 2;
        }

        WritePidFile(port);
        AppDomain.CurrentDomain.ProcessExit += delegate { TryDeletePidFile(); };
        Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs eventArgs)
        {
            eventArgs.Cancel = false;
            TryDeletePidFile();
        };

        Log(AppName + "服务已启动：http://127.0.0.1:" + port + "/");
        Log("站点目录：" + _root);
        Console.Out.Flush();

        while (true)
        {
            TcpClient client;
            try
            {
                client = listener.AcceptTcpClient();
            }
            catch (Exception)
            {
                break;
            }
            ThreadPool.QueueUserWorkItem(delegate(object state) { Handle((TcpClient)state); }, client);
        }

        TryDeletePidFile();
        return 0;
    }

    private static void Handle(TcpClient client)
    {
        using (client)
        {
            try
            {
                client.ReceiveTimeout = 10000;
                client.SendTimeout = 10000;
                NetworkStream stream = client.GetStream();

                string requestHead = ReadHead(stream);
                if (requestHead == null) return;

                string[] lines = requestHead.Split(new[] { "\r\n" }, StringSplitOptions.None);
                string[] parts = lines[0].Split(' ');
                if (parts.Length < 2) return;

                string method = parts[0].ToUpperInvariant();
                string target = parts[1];

                if (method != "GET" && method != "HEAD")
                {
                    WriteText(stream, "405 Method Not Allowed", method == "HEAD", "Method Not Allowed");
                    return;
                }

                string urlPath = target;
                int queryIndex = urlPath.IndexOf('?');
                if (queryIndex >= 0) urlPath = urlPath.Substring(0, queryIndex);
                try
                {
                    urlPath = Uri.UnescapeDataString(urlPath);
                }
                catch (UriFormatException)
                {
                    WriteText(stream, "400 Bad Request", method == "HEAD", "Bad Request");
                    return;
                }

                if (urlPath == "/__health")
                {
                    byte[] json = Encoding.UTF8.GetBytes("{\"ok\":true,\"root\":\"" + EscapeJson(_root) + "\"}");
                    WriteBytes(stream, "200 OK", "application/json; charset=utf-8", "no-store", json, method == "HEAD");
                    Log("200 /__health");
                    return;
                }

                bool head = method == "HEAD";
                string full = ResolveFile(urlPath);
                if (full == null)
                {
                    WriteText(stream, "403 Forbidden", head, "Forbidden");
                    Log("403 " + urlPath);
                    return;
                }
                if (!File.Exists(full))
                {
                    WriteText(stream, "404 Not Found", head, "Not Found");
                    Log("404 " + urlPath);
                    return;
                }

                byte[] body = File.ReadAllBytes(full);
                string contentType;
                if (!MimeMap.TryGetValue(Path.GetExtension(full), out contentType))
                {
                    contentType = "application/octet-stream";
                }
                string cache = urlPath.StartsWith("/assets/", StringComparison.OrdinalIgnoreCase)
                    ? "public, max-age=31536000, immutable"
                    : "no-cache";

                WriteBytes(stream, "200 OK", contentType, cache, body, head);
                Log("200 " + urlPath + " " + body.Length + "B");
            }
            catch (Exception)
            {
                // 客户端提前断开属正常现象，不记录、不重试。
            }
        }
    }

    /// <summary>把 URL 路径映射到站点内的真实文件；越界返回 null。</summary>
    private static string ResolveFile(string urlPath)
    {
        if (string.IsNullOrEmpty(urlPath) || urlPath == "/")
        {
            urlPath = "/index.html";
        }

        string relative = urlPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        string full;
        try
        {
            full = Path.GetFullPath(Path.Combine(_root, relative));
        }
        catch (Exception)
        {
            return null;
        }

        string rootWithSeparator = _root.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)
            ? _root
            : _root + Path.DirectorySeparatorChar;
        if (!full.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (Directory.Exists(full))
        {
            full = Path.Combine(full, "index.html");
        }

        if (!File.Exists(full) && Path.GetExtension(full).Length == 0)
        {
            // Hash 路由下正常不会走到这里；保留回退，与 Node 版行为一致。
            full = Path.Combine(_root, "index.html");
        }

        return full;
    }

    private static string ReadHead(NetworkStream stream)
    {
        var buffer = new byte[MaxHeaderBytes];
        int total = 0;
        while (total < buffer.Length)
        {
            int read = stream.Read(buffer, total, buffer.Length - total);
            if (read <= 0) return null;
            total += read;
            string text = Encoding.UTF8.GetString(buffer, 0, total);
            if (text.Contains("\r\n\r\n")) return text;
        }
        return null;
    }

    private static void WriteBytes(NetworkStream stream, string status, string contentType, string cache, byte[] body, bool head)
    {
        var header = new StringBuilder();
        header.Append("HTTP/1.1 ").Append(status).Append("\r\n");
        header.Append("Content-Type: ").Append(contentType).Append("\r\n");
        header.Append("Content-Length: ").Append(body.Length.ToString(CultureInfo.InvariantCulture)).Append("\r\n");
        header.Append("Cache-Control: ").Append(cache).Append("\r\n");
        header.Append("X-Content-Type-Options: nosniff\r\n");
        header.Append("Connection: close\r\n\r\n");

        byte[] headerBytes = Encoding.ASCII.GetBytes(header.ToString());
        stream.Write(headerBytes, 0, headerBytes.Length);
        if (!head) stream.Write(body, 0, body.Length);
        stream.Flush();
    }

    private static void WriteText(NetworkStream stream, string status, bool head, string message)
    {
        byte[] body = Encoding.UTF8.GetBytes(message);
        WriteBytes(stream, status, "text/plain; charset=utf-8", "no-store", body, head);
    }

    private static void WritePidFile(int port)
    {
        if (string.IsNullOrEmpty(_pidFile)) return;
        try
        {
            string full = Path.GetFullPath(_pidFile);
            string dir = Path.GetDirectoryName(full);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            string json = "{\"pid\":" + System.Diagnostics.Process.GetCurrentProcess().Id
                + ",\"port\":" + port.ToString(CultureInfo.InvariantCulture) + "}";
            File.WriteAllText(full, json, new UTF8Encoding(false));
        }
        catch (Exception error)
        {
            Log("⚠ 写状态文件失败：" + error.Message);
        }
    }

    private static void TryDeletePidFile()
    {
        if (string.IsNullOrEmpty(_pidFile)) return;
        try
        {
            if (File.Exists(_pidFile)) File.Delete(_pidFile);
        }
        catch
        {
            // 忽略
        }
    }

    private static void Log(string message)
    {
        string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message;
        lock (LogLock)
        {
            try
            {
                if (!string.IsNullOrEmpty(_logFile))
                {
                    string full = Path.GetFullPath(_logFile);
                    string dir = Path.GetDirectoryName(full);
                    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                    File.AppendAllText(full, line + "\r\n", new UTF8Encoding(false));
                }
            }
            catch
            {
                // 日志失败不影响服务
            }
            try
            {
                Console.WriteLine(line);
                Console.Out.Flush();
            }
            catch
            {
                // 无控制台时忽略
            }
        }
    }

    private static string Arg(string[] args, string name, string fallback)
    {
        for (int index = 0; index < args.Length - 1; index++)
        {
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase))
            {
                return args[index + 1];
            }
        }
        return fallback;
    }

    private static int ParseInt(string value, int fallback)
    {
        int parsed;
        return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) ? parsed : fallback;
    }

    private static string EscapeJson(string value)
    {
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }
}
