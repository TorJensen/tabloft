// TabMind tray app: starts the local TabMind server (tabmind-server.exe) hidden,
// shows a tray icon, and offers Open library / browser setup / start at login / quit.
// Compiled with the C# compiler that ships with Windows (.NET Framework 4) - see build/build.ps1.
//
//   TabMind.exe                     start (if needed) and open the library
//   TabMind.exe --background        start without opening the library (used at login)
//   TabMind.exe --setup-extension   open each browser's Extensions page to add TabMind

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("TabMind")]
[assembly: System.Reflection.AssemblyProduct("TabMind")]
[assembly: System.Reflection.AssemblyVersion("0.2.0.0")]

static class TabMindTray
{
    const string Url = "http://127.0.0.1:7878";
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    static readonly string AppDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    static readonly string DataDir = Environment.GetEnvironmentVariable("TABMIND_DATA") ??
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TabMind");

    static NotifyIcon tray;
    static Process server;
    static bool quitting;
    static int restarts;

    [STAThread]
    static void Main(string[] args)
    {
        bool background = args.Contains("--background");
        if (args.Contains("--setup-extension")) { SetupExtension(); return; }

        bool first;
        using (var mutex = new Mutex(true, "TabMind.Tray.SingleInstance", out first))
        {
            if (!first)
            {
                // Already running in the tray: just open the library.
                if (!background) OpenLibrary();
                return;
            }
            Application.EnableVisualStyles();
            BuildTray();
            if (!IsServerUp()) StartServer();
            if (!background)
            {
                WaitForServer(10000);
                OpenLibrary();
            }
            Application.Run();
            tray.Visible = false;
        }
    }

    // ---------------------------------------------------------------- tray
    static void BuildTray()
    {
        var menu = new ContextMenuStrip();
        var open = new ToolStripMenuItem("Open TabMind library", null, delegate { OpenLibrary(); });
        open.Font = new Font(open.Font, FontStyle.Bold);
        var autostart = new ToolStripMenuItem("Start TabMind when I log in") { CheckOnClick = true, Checked = IsAutostart() };
        autostart.CheckedChanged += delegate { SetAutostart(autostart.Checked); };

        menu.Items.Add(open);
        menu.Items.Add("Add TabMind to my browsers...", null, delegate { SetupExtension(); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(autostart);
        menu.Items.Add("Show library folder", null, delegate { Process.Start("explorer.exe", "\"" + DataDir + "\""); });
        menu.Items.Add("Restart TabMind", null, delegate { StopServer(); restarts = 0; StartServer(); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit TabMind", null, delegate { Quit(); });

        tray = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath),
            Text = "TabMind - your saved tabs",
            ContextMenuStrip = menu,
            Visible = true,
        };
        tray.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) OpenLibrary(); };
    }

    static void Quit()
    {
        quitting = true;
        StopServer();
        tray.Visible = false;
        Application.Exit();
    }

    // ---------------------------------------------------------------- server
    static void StartServer()
    {
        string exe = Path.Combine(AppDir, "tabmind-server.exe");
        if (!File.Exists(exe))
        {
            MessageBox.Show("tabmind-server.exe is missing from " + AppDir + ".\nPlease reinstall TabMind.", "TabMind",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        Directory.CreateDirectory(DataDir);
        var log = Path.Combine(DataDir, "server.log");
        var psi = new ProcessStartInfo(exe)
        {
            WorkingDirectory = AppDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        server = new Process { StartInfo = psi, EnableRaisingEvents = true };
        var writer = new StreamWriter(log, false) { AutoFlush = true };
        server.OutputDataReceived += (s, e) => { if (e.Data != null) lock (writer) writer.WriteLine(e.Data); };
        server.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (writer) writer.WriteLine(e.Data); };
        server.Exited += (s, e) => OnServerExit(writer);
        server.Start();
        server.BeginOutputReadLine();
        server.BeginErrorReadLine();
    }

    static void OnServerExit(StreamWriter writer)
    {
        int code = -1;
        try { code = server.ExitCode; } catch { }
        try { lock (writer) writer.Dispose(); } catch { }
        if (quitting) return;
        if (code == 2) return; // port in use: another TabMind is already serving the library
        if (restarts++ < 3)
        {
            Thread.Sleep(1000);
            StartServer();
            return;
        }
        tray.ShowBalloonTip(8000, "TabMind stopped",
            "The TabMind server keeps stopping. See server.log in the library folder, then choose Restart TabMind.",
            ToolTipIcon.Error);
    }

    static void StopServer()
    {
        if (server == null) return;
        try { if (!server.HasExited) { server.Kill(); server.WaitForExit(3000); } } catch { }
        server = null;
    }

    static bool IsServerUp()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(Url + "/api/health");
            req.Timeout = 1500;
            req.Proxy = null;
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var r = new StreamReader(res.GetResponseStream()))
                return res.StatusCode == HttpStatusCode.OK && r.ReadToEnd().Contains("\"TabMind\"");
        }
        catch { return false; }
    }

    static bool WaitForServer(int ms)
    {
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < ms)
        {
            if (IsServerUp()) return true;
            Thread.Sleep(250);
        }
        return false;
    }

    static void OpenLibrary()
    {
        if (!IsServerUp() && server == null) { StartServer(); WaitForServer(10000); }
        Process.Start(Url);
    }

    // ---------------------------------------------------------------- autostart
    static bool IsAutostart()
    {
        using (var k = Registry.CurrentUser.OpenSubKey(RunKey))
            return k != null && k.GetValue("TabMind") != null;
    }

    static void SetAutostart(bool on)
    {
        using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
        {
            if (on) k.SetValue("TabMind", "\"" + Application.ExecutablePath + "\" --background");
            else k.DeleteValue("TabMind", false);
        }
    }

    // ---------------------------------------------------------------- browser extension
    static void SetupExtension()
    {
        string ext = Path.Combine(AppDir, "extension");
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var browsers = new[]
        {
            new { Name = "Google Chrome", Page = "chrome://extensions", Paths = new[] {
                pf + @"\Google\Chrome\Application\chrome.exe", pf86 + @"\Google\Chrome\Application\chrome.exe",
                local + @"\Google\Chrome\Application\chrome.exe" } },
            new { Name = "Brave", Page = "brave://extensions", Paths = new[] {
                pf + @"\BraveSoftware\Brave-Browser\Application\brave.exe", pf86 + @"\BraveSoftware\Brave-Browser\Application\brave.exe",
                local + @"\BraveSoftware\Brave-Browser\Application\brave.exe" } },
            new { Name = "Microsoft Edge", Page = "edge://extensions", Paths = new[] {
                pf86 + @"\Microsoft\Edge\Application\msedge.exe", pf + @"\Microsoft\Edge\Application\msedge.exe" } },
        };
        var found = browsers.Select(b => new { b.Name, b.Page, Exe = b.Paths.FirstOrDefault(File.Exists) })
                            .Where(b => b.Exe != null).ToList();
        if (found.Count == 0)
        {
            MessageBox.Show("No Chrome, Brave or Edge installation was found.", "TabMind", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        string steps =
            "In each browser's Extensions page that opens:\n\n" +
            "  1.  Turn on \"Developer mode\"\n" +
            "  2.  Click \"Load unpacked\"\n" +
            "  3.  Press Ctrl+V to paste the TabMind folder, then click Select Folder\n" +
            "  4.  Pin TabMind to the toolbar (puzzle-piece icon)\n\n" +
            "The folder path is already copied for you:\n" + ext + "\n\n" +
            "Already added? Click the reload arrow on the TabMind card instead.";

        foreach (var b in found)
        {
            var answer = MessageBox.Show("Add TabMind to " + b.Name + "?\n\n" + steps, "TabMind - browser setup",
                MessageBoxButtons.YesNoCancel, MessageBoxIcon.Information);
            if (answer == DialogResult.Cancel) return;
            if (answer == DialogResult.No) continue;
            try { Clipboard.SetText(ext); } catch { }
            try { Process.Start(b.Exe, b.Page); } catch { }
            MessageBox.Show("Click OK when TabMind is added to " + b.Name + ".", "TabMind - browser setup",
                MessageBoxButtons.OK, MessageBoxIcon.None);
        }
    }
}
