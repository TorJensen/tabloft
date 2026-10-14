// TabMind tray app: starts the local TabMind server (tabmind-server.exe) hidden,
// shows a tray icon, and offers Open library / browser setup / start at login / updates / quit.
// Updates: checks GitHub Releases of TorJensen/tabmind and installs a newer TabMind-Setup-*.exe.
// Compiled with the C# compiler that ships with Windows (.NET Framework 4) - see build/build.ps1.
//
//   TabMind.exe                     start (if needed) and open the library
//   TabMind.exe --background        start without opening the library (used at login)
//   TabMind.exe --setup-extension   open each browser's Extensions page to add TabMind
//   TabMind.exe --update            check now and install a newer version without asking

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Web.Script.Serialization;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("TabMind")]
[assembly: System.Reflection.AssemblyProduct("TabMind")]
[assembly: System.Reflection.AssemblyVersion("0.3.1.0")]

static class TabMindTray
{
    const string Url = "http://127.0.0.1:7878";
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string SettingsKey = @"Software\TabMind";
    const string ReleasesApi = "https://api.github.com/repos/TorJensen/tabmind/releases/latest";
    static readonly Version AppVersion = typeof(TabMindTray).Assembly.GetName().Version;

    static readonly string AppDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    static readonly string DataDir = Environment.GetEnvironmentVariable("TABMIND_DATA") ??
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TabMind");

    static NotifyIcon tray;
    static Process server;
    static bool quitting;
    static int restarts;
    static Control ui;                       // marshals background work back to the UI thread
    static ToolStripMenuItem updateItem;
    static Release available;                // newer release found by the update check
    static bool updating;
    static bool autoInstall;                 // --update: install a newer version without asking

    [STAThread]
    static void Main(string[] args)
    {
        bool background = args.Contains("--background");
        autoInstall = args.Contains("--update");
        if (autoInstall) background = true;
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
            ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; // TLS 1.2 for GitHub
            ui = new Control();
            ui.CreateControl();
            BuildTray();
            AnnounceIfUpdated();
            StartUpdateChecks();
            if (autoInstall) CheckForUpdate(false);
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
        updateItem = new ToolStripMenuItem("Check for updates...", null, delegate { OnUpdateClicked(); });
        var autoUpdate = new ToolStripMenuItem("Check for updates automatically") { CheckOnClick = true, Checked = AutoCheckEnabled() };
        autoUpdate.CheckedChanged += delegate { SetSetting("AutoUpdateCheck", autoUpdate.Checked ? 1 : 0); };
        menu.Items.Add(updateItem);
        menu.Items.Add(autoUpdate);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit TabMind", null, delegate { Quit(); });

        tray = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath),
            Text = "TabMind " + Short(AppVersion) + " - your saved tabs",
            ContextMenuStrip = menu,
            Visible = true,
        };
        tray.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) OpenLibrary(); };
        tray.BalloonTipClicked += delegate { if (available != null && !updating) OnUpdateClicked(); };
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

    // ---------------------------------------------------------------- updates
    class Release { public Version Version; public string Tag, Notes, SetupUrl, SetupName, PageUrl; }

    static string Short(Version v) { return v.Major + "." + v.Minor + "." + v.Build; }

    static object GetSetting(string name)
    {
        using (var k = Registry.CurrentUser.OpenSubKey(SettingsKey)) return k == null ? null : k.GetValue(name);
    }

    static void SetSetting(string name, object value)
    {
        using (var k = Registry.CurrentUser.CreateSubKey(SettingsKey)) k.SetValue(name, value);
    }

    static bool AutoCheckEnabled() { var v = GetSetting("AutoUpdateCheck"); return v == null || (int)v != 0; }

    // After an update, say so once.
    static void AnnounceIfUpdated()
    {
        var last = GetSetting("LastRunVersion") as string;
        SetSetting("LastRunVersion", Short(AppVersion));
        if (last != null && last != Short(AppVersion))
            tray.ShowBalloonTip(6000, "TabMind updated", "TabMind is now version " + Short(AppVersion) + ".", ToolTipIcon.Info);
    }

    static void StartUpdateChecks()
    {
        var timer = new System.Windows.Forms.Timer { Interval = 30 * 1000 };   // first check shortly after start
        timer.Tick += delegate
        {
            timer.Interval = 12 * 60 * 60 * 1000;                              // then twice a day
            if (AutoCheckEnabled() && available == null) CheckForUpdate(false);
        };
        timer.Start();
    }

    // Queries GitHub off the UI thread. interactive = the user asked, so also report "up to date" and errors.
    static void CheckForUpdate(bool interactive)
    {
        ThreadPool.QueueUserWorkItem(delegate
        {
            Release r = null; string error = null;
            try { r = FetchLatestRelease(); } catch (Exception e) { error = e.Message; }
            ui.BeginInvoke((MethodInvoker)delegate
            {
                if (r != null && r.Version > AppVersion && r.SetupUrl != null)
                {
                    available = r;
                    if (autoInstall) { DownloadAndInstall(r); return; }
                    updateItem.Text = "Update to TabMind " + Short(r.Version) + "...";
                    updateItem.Font = new Font(updateItem.Font, FontStyle.Bold);
                    if (interactive) OfferUpdate(r);
                    else tray.ShowBalloonTip(15000, "TabMind " + Short(r.Version) + " is available",
                        "Click here to update. Your library is not affected.", ToolTipIcon.Info);
                }
                else if (interactive)
                {
                    if (error != null) MessageBox.Show("Could not check for updates:\n" + error, "TabMind", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    else MessageBox.Show("You have the latest version of TabMind (" + Short(AppVersion) + ").", "TabMind", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            });
        });
    }

    static Release FetchLatestRelease()
    {
        using (var wc = new WebClient())
        {
            wc.Headers[HttpRequestHeader.UserAgent] = "TabMind/" + Short(AppVersion);
            wc.Headers[HttpRequestHeader.Accept] = "application/vnd.github+json";
            wc.Encoding = System.Text.Encoding.UTF8;
            var json = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(wc.DownloadString(ReleasesApi));
            var tag = (string)json["tag_name"];
            Version v;
            if (!Version.TryParse(tag.TrimStart('v', 'V'), out v)) return null;
            var r = new Release { Version = new Version(v.Major, v.Minor, Math.Max(v.Build, 0), 0), Tag = tag,
                                  Notes = json.ContainsKey("body") ? json["body"] as string : null,
                                  PageUrl = json["html_url"] as string };
            foreach (Dictionary<string, object> a in (IEnumerable)json["assets"])
            {
                var name = (string)a["name"];
                var url = a["browser_download_url"] as string;
                if (name.StartsWith("TabMind-Setup", StringComparison.OrdinalIgnoreCase) && name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                    && IsTrustedDownload(url))
                { r.SetupUrl = url; r.SetupName = name; }
            }
            return r;
        }
    }

    // Updates are only ever downloaded over HTTPS from this repo's GitHub release assets.
    static bool IsTrustedDownload(string url)
    {
        Uri u;
        if (url == null || !Uri.TryCreate(url, UriKind.Absolute, out u)) return false;
        return u.Scheme == Uri.UriSchemeHttps && u.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase)
            && u.AbsolutePath.StartsWith("/TorJensen/tabmind/releases/download/", StringComparison.OrdinalIgnoreCase);
    }

    static void OnUpdateClicked()
    {
        if (updating) return;
        if (available != null) OfferUpdate(available); else CheckForUpdate(true);
    }

    static void OfferUpdate(Release r)
    {
        string notes = string.IsNullOrWhiteSpace(r.Notes) ? "" : "\n\nWhat's new:\n" + (r.Notes.Length > 600 ? r.Notes.Substring(0, 600) + "..." : r.Notes);
        var answer = MessageBox.Show("TabMind " + Short(r.Version) + " is available (you have " + Short(AppVersion) + ")." + notes +
            "\n\nUpdate now? TabMind restarts briefly; your library is not affected.", "TabMind update",
            MessageBoxButtons.YesNo, MessageBoxIcon.Information);
        if (answer == DialogResult.Yes) DownloadAndInstall(r);
    }

    static void DownloadAndInstall(Release r)
    {
        updating = true;
        updateItem.Text = "Downloading TabMind " + Short(r.Version) + "...";
        updateItem.Enabled = false;
        string dir = Path.Combine(Path.GetTempPath(), "TabMind-update");
        Directory.CreateDirectory(dir);
        string file = Path.Combine(dir, "TabMind-Setup-update.exe");
        var wc = new WebClient();
        wc.Headers[HttpRequestHeader.UserAgent] = "TabMind/" + Short(AppVersion);
        wc.DownloadProgressChanged += (s, e) => { updateItem.Text = "Downloading TabMind " + Short(r.Version) + "... " + e.ProgressPercentage + "%"; };
        wc.DownloadFileCompleted += (s, e) =>
        {
            wc.Dispose();
            if (e.Error != null || e.Cancelled)
            {
                updating = false;
                updateItem.Enabled = true;
                updateItem.Text = "Update to TabMind " + Short(r.Version) + "...";
                MessageBox.Show("The update could not be downloaded:\n" + (e.Error != null ? e.Error.Message : "cancelled"), "TabMind",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            // The installer replaces this program, so start it and step out of the way.
            // /SILENT shows only a progress window and keeps the options chosen at first install.
            Process.Start(new ProcessStartInfo(file, "/SILENT /SUPPRESSMSGBOXES /NORESTART") { UseShellExecute = true });
            Quit();
        };
        if (!IsTrustedDownload(r.SetupUrl)) { updating = false; updateItem.Enabled = true; return; }
        wc.DownloadFileAsync(new Uri(r.SetupUrl), file);
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
