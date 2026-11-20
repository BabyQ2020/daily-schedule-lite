// 日程轻量版 · 启动器
// 双击后：启动（或复用）本机静态服务，然后用默认浏览器打开页面。
// 目标框架：.NET Framework 4.x 自带的 csc 编译，无需安装任何运行时，无需管理员权限。
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

internal static class Launcher
{
    private const string AppTitle = "日程轻量版";
    private const int ReadinessSeconds = 30;

    private static readonly string BaseDir = AppDomain.CurrentDomain.BaseDirectory;
    private static readonly string StateDir = ResolveStateDir();

    private static string PidFile
    {
        get { return Path.Combine(StateDir, "server.json"); }
    }

    private static string LogFile
    {
        get { return Path.Combine(StateDir, "server.log"); }
    }

    /// <summary>状态目录：优先放在程序目录（真便携），不可写时退回 %LOCALAPPDATA%，再退回临时目录。</summary>
    private static string ResolveStateDir()
    {
        string[] candidates = new string[]
        {
            Path.Combine(BaseDir, "state"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DailyScheduleLite"
            ),
            Path.Combine(Path.GetTempPath(), "DailyScheduleLite"),
        };

        foreach (string candidate in candidates)
        {
            try
            {
                Directory.CreateDirectory(candidate);
                string probe = Path.Combine(candidate, ".write-probe");
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
                return candidate;
            }
            catch
            {
                // 试下一个位置
            }
        }

        return Path.GetTempPath();
    }

    [STAThread]
    private static int Main()
    {
        Trace("启动器开始");
        try
        {
            string serverExe = Path.Combine(BaseDir, "ScheduleServer.exe");
            string nodeExe = Path.Combine(BaseDir, "runtime", "node.exe");
            string startScript = Path.Combine(BaseDir, "runtime", "start.cmd");
            string serverScript = Path.Combine(BaseDir, "server.mjs");

            bool dotnetMode = File.Exists(serverExe);
            bool legacyMode = File.Exists(nodeExe) && File.Exists(startScript) && File.Exists(serverScript);
            if (!dotnetMode && !legacyMode)
            {
                Fail(
                    "便携包不完整：缺少 ScheduleServer.exe（或旧版的 runtime\\node.exe、start.cmd、server.mjs）。\n\n"
                        + "请解压整个文件夹后再双击 exe，不要只把 exe 单独复制出来。"
                );
                return 1;
            }

            Trace(
                "便携包文件齐全（" + (dotnetMode ? "内置服务" : "Node 运行时") + "）；状态目录：" + StateDir
            );

            Startup existing = ReadStartup();
            if (existing != null && ProcessAlive(existing.Pid))
            {
                Trace("服务已在运行：端口 " + existing.Port);
                OpenBrowser(UrlOf(existing.Port));
                return 0;
            }

            TrimLog();
            TryDelete(PidFile);
            StartServer(dotnetMode, serverExe, startScript);
            Trace("已启动本地服务进程");

            Startup ready = WaitForReady(ReadinessSeconds);
            if (ready == null)
            {
                Trace("等待服务超时");
                Fail(
                    "服务没能启动起来。\n\n"
                        + "如果下面日志里写着「端口 4180 已被其他程序占用」，请先关闭占用该端口的程序，"
                        + "或双击「停止服务.exe」清理残留后再试。\n\n"
                        + "日志文件：" + LogFile + "\n\n"
                        + Tail(LogFile, 12)
                );
                return 2;
            }

            Trace("服务就绪：端口 " + ready.Port);
            OpenBrowser(UrlOf(ready.Port));
            return 0;
        }
        catch (Exception error)
        {
            Trace("异常：" + error);
            Fail("启动时出错：" + error.Message);
            return 3;
        }
    }

    private sealed class Startup
    {
        private int _pid;
        private int _port;

        public Startup(int pid, int port)
        {
            _pid = pid;
            _port = port;
        }

        public int Pid
        {
            get { return _pid; }
        }

        public int Port
        {
            get { return _port; }
        }
    }

    private static void StartServer(bool dotnetMode, string serverExe, string startScript)
    {
        ProcessStartInfo info;
        if (dotnetMode)
        {
            // 直接 CreateProcess 启动控制台服务：不走 ShellExecute，避免「打开文件 - 安全警告」
            // 之类的外壳对话框，也不会把调用方的控制台句柄挂住；CreateNoWindow 保证不闪窗。
            string arguments =
                "--root \""
                + Path.Combine(BaseDir, "runtime", "web")
                + "\" --port 4180 --pid-file \""
                + PidFile
                + "\" --log-file \""
                + LogFile
                + "\"";
            info = new ProcessStartInfo(serverExe, arguments);
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
        }
        else
        {
            // Node 版仍走 ShellExecute + cmd：让子进程脱离本进程句柄，批处理窗口隐藏。
            info = new ProcessStartInfo(
                Path.Combine(Environment.SystemDirectory, "cmd.exe"),
                "/c \"\"" + startScript + "\"\""
            );
            info.UseShellExecute = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
        }
        info.WorkingDirectory = BaseDir;
        Process.Start(info);
    }

    /// <summary>
    /// 等待 server.json 出现：服务只在 listen 成功后才写这个文件，
    /// 因此它的出现即可视为「端口已就绪」，不必依赖本地 HTTP 探测。
    /// </summary>
    private static Startup WaitForReady(int seconds)
    {
        DateTime deadline = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < deadline)
        {
            Startup info = ReadStartup();
            if (info != null && ProcessAlive(info.Pid))
            {
                Thread.Sleep(150);
                return info;
            }
            Thread.Sleep(250);
        }
        return null;
    }

    private static Startup ReadStartup()
    {
        try
        {
            if (!File.Exists(PidFile))
            {
                return null;
            }

            string text = File.ReadAllText(PidFile, Encoding.UTF8);
            int pid = ReadNumber(text, "pid");
            int port = ReadNumber(text, "port");
            if (pid <= 0 || port <= 0)
            {
                return null;
            }
            return new Startup(pid, port);
        }
        catch
        {
            return null;
        }
    }

    private static int ReadNumber(string text, string key)
    {
        Match match = Regex.Match(text, "\"" + key + "\"\\s*:\\s*(\\d+)");
        int value;
        if (match.Success && int.TryParse(match.Groups[1].Value, out value))
        {
            return value;
        }
        return 0;
    }

    private static bool ProcessAlive(int pid)
    {
        try
        {
            Process process = Process.GetProcessById(pid);
            return !process.HasExited;
        }
        catch
        {
            return false;
        }
    }

    private static string UrlOf(int port)
    {
        return "http://127.0.0.1:" + port.ToString() + "/";
    }

    private static void OpenBrowser(string url)
    {
        try
        {
            ProcessStartInfo info = new ProcessStartInfo(url);
            info.UseShellExecute = true;
            Process.Start(info);
        }
        catch (Exception error)
        {
            Fail("服务已启动，但未能自动打开浏览器。\n\n请手动访问：" + url + "\n\n" + error.Message);
        }
    }

    /// <summary>日志超过 2MB 就清空，避免长期使用后无限增长。</summary>
    private static void TrimLog()
    {
        try
        {
            if (File.Exists(LogFile))
            {
                FileInfo info = new FileInfo(LogFile);
                if (info.Length > 2 * 1024 * 1024)
                {
                    File.Delete(LogFile);
                }
            }
        }
        catch
        {
            // 忽略
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
            // 忽略：删不掉也不影响启动
        }
    }

    private static void Trace(string message)
    {
        try
        {
            Directory.CreateDirectory(StateDir);
            File.AppendAllText(
                Path.Combine(StateDir, "launcher.log"),
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + "\r\n",
                Encoding.UTF8
            );
        }
        catch
        {
            // 诊断日志写不进去也不影响主流程
        }
    }

    private static string Tail(string path, int lines)
    {
        try
        {
            if (!File.Exists(path))
            {
                return "（还没有日志）";
            }
            string[] all = File.ReadAllLines(path, Encoding.UTF8);
            int from = Math.Max(0, all.Length - lines);
            StringBuilder builder = new StringBuilder();
            for (int index = from; index < all.Length; index++)
            {
                builder.AppendLine(all[index]);
            }
            return builder.ToString().Trim();
        }
        catch
        {
            return "（日志读取失败）";
        }
    }

    private static void Fail(string message)
    {
        try
        {
            MessageBox.Show(
                message,
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button1
            );
        }
        catch
        {
            // 无交互桌面时弹窗不可用，错误已写入日志
        }
    }
}
