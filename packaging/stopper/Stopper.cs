// 日程轻量版 · 停止服务
// 双击后：结束由「日程轻量版.exe」启动的本地服务进程（不影响其他 Node 程序）。
using System;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

internal static class Stopper
{
    private const string AppTitle = "日程轻量版";

    private static string[] StateCandidates()
    {
        return new string[]
        {
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "state"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DailyScheduleLite"
            ),
            Path.Combine(Path.GetTempPath(), "DailyScheduleLite"),
        };
    }

    /// <summary>优先找放着 server.json 的状态目录。</summary>
    private static string ResolveStateDir()
    {
        string[] candidates = StateCandidates();
        foreach (string candidate in candidates)
        {
            if (File.Exists(Path.Combine(candidate, "server.json")))
            {
                return candidate;
            }
        }
        return candidates[0];
    }

    private static readonly string StateDir = ResolveStateDir();

    private static string PidFile
    {
        get { return Path.Combine(StateDir, "server.json"); }
    }

    [STAThread]
    private static void Main()
    {
        int stopped = 0;
        StringBuilder report = new StringBuilder();

        try
        {
            int? pid = ReadPid();
            if (pid != null && KillNode(pid.Value))
            {
                stopped++;
                report.AppendLine("已停止记录在案的进程（PID " + pid.Value + "）。");
            }

            int leftovers = KillByCommandLine();
            if (leftovers > 0)
            {
                stopped += leftovers;
                report.AppendLine("已清理 " + leftovers + " 个残留服务进程。");
            }

            TryDelete(PidFile);

            if (stopped == 0)
            {
                MessageBox.Show(
                    "当前没有在运行的服务。\n\n（浏览器里已经打开的页面可能仍可查看，但刷新后会打不开。）",
                    AppTitle,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
                return;
            }

            MessageBox.Show(
                report.ToString().Trim() + "\n\n可以关闭浏览器中打开的页面了。",
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "停止时出错：" + error.Message,
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning
            );
        }
    }

    private static int? ReadPid()
    {
        try
        {
            if (!File.Exists(PidFile))
            {
                return null;
            }
            string text = File.ReadAllText(PidFile, Encoding.UTF8);
            Match match = Regex.Match(text, "\"pid\"\\s*:\\s*(\\d+)");
            int pid;
            if (match.Success && int.TryParse(match.Groups[1].Value, out pid) && pid > 0)
            {
                return pid;
            }
            return null;
        }
        catch
        {
            return null;
        }
    }

    private static bool KillNode(int pid)
    {
        try
        {
            Process process = Process.GetProcessById(pid);
            if (!string.Equals(process.ProcessName, "node", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
            process.Kill();
            process.WaitForExit(3000);
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>兜底：找出命令行里带 server.mjs 的 node 进程。</summary>
    private static int KillByCommandLine()
    {
        int killed = 0;
        try
        {
            ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'"
            );
            foreach (ManagementObject item in searcher.Get())
            {
                try
                {
                    string commandLine = Convert.ToString(item["CommandLine"]);
                    if (commandLine == null || commandLine.IndexOf("server.mjs", StringComparison.OrdinalIgnoreCase) < 0)
                    {
                        continue;
                    }

                    int pid = Convert.ToInt32(item["ProcessId"]);
                    Process process = Process.GetProcessById(pid);
                    process.Kill();
                    process.WaitForExit(3000);
                    killed++;
                }
                catch
                {
                    // 单个进程失败不影响其它
                }
            }
        }
        catch
        {
            // 没有 WMI 权限时忽略，只依赖 pid 文件
        }
        return killed;
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
            // 忽略
        }
    }
}
