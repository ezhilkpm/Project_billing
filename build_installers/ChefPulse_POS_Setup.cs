using System;
using System.IO;
using System.Diagnostics;
using System.Windows.Forms;
using System.Drawing;
using Microsoft.Win32;

namespace ChefPulseInstaller
{
    public class SetupForm : Form
    {
        private ProgressBar progressBar;
        private Label statusLabel;
        private Button installButton;
        private Button launchButton;
        private TextBox serverUrlBox;
        private CheckBox desktopShortcutCheck;
        private CheckBox startupCheck;

        private const string AppName = "ChefPulse POS";
        private const string AppVersion = "4.0.0";
        private const string DefaultServerUrl = "http://192.168.1.2:4000";

        [STAThread]
        public static void Main(string[] args)
        {
            if (args.Length > 0 && args[0].Equals("--launch", StringComparison.OrdinalIgnoreCase))
            {
                string targetUrl = args.Length > 1 ? args[1] : DefaultServerUrl;
                LaunchDirect(targetUrl);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }

        private static void LaunchDirect(string targetUrl)
        {
            string browser = FindBrowser();
            if (!string.IsNullOrEmpty(browser))
            {
                Process.Start(browser, "--app=" + targetUrl + " --start-maximized --disable-pinch");
            }
            else
            {
                Process.Start(targetUrl);
            }
        }

        public SetupForm()
        {
            this.Text = "ChefPulse POS - Windows Desktop Client Setup v" + AppVersion;
            this.Size = new Size(540, 480);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(15, 23, 42);
            this.ForeColor = Color.White;

            BuildUI();
        }

        private void BuildUI()
        {
            Panel header = new Panel { Dock = DockStyle.Top, Height = 80, BackColor = Color.FromArgb(30, 41, 59) };
            Label title = new Label
            {
                Text = "ChefPulse Enterprise POS",
                Font = new Font("Segoe UI", 14, FontStyle.Bold),
                ForeColor = Color.FromArgb(245, 158, 11),
                Location = new Point(20, 15),
                AutoSize = true
            };
            Label subtitle = new Label
            {
                Text = "Classic Hotel Multi-Kitchen POS & Billing System for Windows",
                Font = new Font("Segoe UI", 9),
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(23, 45),
                AutoSize = true
            };
            header.Controls.Add(title);
            header.Controls.Add(subtitle);
            this.Controls.Add(header);

            Label lblUrl = new Label
            {
                Text = "Central POS Server Address:",
                Font = new Font("Segoe UI", 9, FontStyle.Bold),
                Location = new Point(25, 100),
                AutoSize = true
            };
            this.Controls.Add(lblUrl);

            serverUrlBox = new TextBox
            {
                Text = DefaultServerUrl,
                Font = new Font("Consolas", 10),
                Location = new Point(25, 125),
                Width = 470,
                BackColor = Color.FromArgb(2, 6, 23),
                ForeColor = Color.FromArgb(253, 224, 71)
            };
            this.Controls.Add(serverUrlBox);

            desktopShortcutCheck = new CheckBox
            {
                Text = "Create Desktop Shortcut (\"ChefPulse POS\")",
                Checked = true,
                Font = new Font("Segoe UI", 9),
                Location = new Point(25, 165),
                AutoSize = true
            };
            this.Controls.Add(desktopShortcutCheck);

            startupCheck = new CheckBox
            {
                Text = "Start ChefPulse POS automatically on Windows boot (Cashier Terminal)",
                Checked = false,
                Font = new Font("Segoe UI", 9),
                Location = new Point(25, 195),
                AutoSize = true
            };
            this.Controls.Add(startupCheck);

            Panel infoCard = new Panel
            {
                Location = new Point(25, 230),
                Size = new Size(470, 95),
                BackColor = Color.FromArgb(30, 41, 59),
                BorderStyle = BorderStyle.FixedSingle
            };
            Label infoText = new Label
            {
                Text = "Features & Optimizations:\n* Dedicated App Kiosk Mode: Launches with no browser address bar\n* High-Speed ESC/POS receipt printer & cash drawer kick support\n* SQLite WAL local database with zero cloud latency (<2ms)",
                Font = new Font("Segoe UI", 8.5f),
                ForeColor = Color.FromArgb(203, 213, 225),
                Dock = DockStyle.Fill,
                Padding = new Padding(8)
            };
            infoCard.Controls.Add(infoText);
            this.Controls.Add(infoCard);

            progressBar = new ProgressBar
            {
                Location = new Point(25, 340),
                Width = 470,
                Height = 16,
                Visible = false
            };
            this.Controls.Add(progressBar);

            statusLabel = new Label
            {
                Text = "Ready to install. Click 'Install Desktop Client' to proceed.",
                Font = new Font("Segoe UI", 8.5f),
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(25, 360),
                Width = 470,
                Height = 20
            };
            this.Controls.Add(statusLabel);

            installButton = new Button
            {
                Text = "Install Desktop Client",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                BackColor = Color.FromArgb(16, 185, 129),
                ForeColor = Color.Black,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(25, 390),
                Size = new Size(230, 35),
                Cursor = Cursors.Hand
            };
            installButton.Click += InstallButton_Click;
            this.Controls.Add(installButton);

            launchButton = new Button
            {
                Text = "Launch POS App Now",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                BackColor = Color.FromArgb(245, 158, 11),
                ForeColor = Color.Black,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(265, 390),
                Size = new Size(230, 35),
                Cursor = Cursors.Hand
            };
            launchButton.Click += LaunchButton_Click;
            this.Controls.Add(launchButton);
        }

        private void InstallButton_Click(object sender, EventArgs e)
        {
            try
            {
                installButton.Enabled = false;
                progressBar.Visible = true;
                progressBar.Value = 30;
                statusLabel.Text = "Creating installation files...";
                Application.DoEvents();

                string installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ChefPulsePOS");
                if (!Directory.Exists(installDir)) Directory.CreateDirectory(installDir);

                string serverUrl = serverUrlBox.Text.Trim();
                string browserPath = FindBrowser();

                string launcherBat = Path.Combine(installDir, "ChefPulse_Client.bat");
                using (StreamWriter sw = new StreamWriter(launcherBat))
                {
                    sw.WriteLine("@echo off");
                    sw.WriteLine("title ChefPulse POS Client");
                    if (!string.IsNullOrEmpty(browserPath))
                    {
                        sw.WriteLine("start \"\" \"" + browserPath + "\" --app=" + serverUrl + " --start-maximized --disable-pinch");
                    }
                    else
                    {
                        sw.WriteLine("start \"\" \"" + serverUrl + "\"");
                    }
                }

                string currentExe = Application.ExecutablePath;
                string destExe = Path.Combine(installDir, "ChefPulsePOS.exe");
                if (!currentExe.Equals(destExe, StringComparison.OrdinalIgnoreCase))
                {
                    File.Copy(currentExe, destExe, true);
                }

                progressBar.Value = 70;
                statusLabel.Text = "Creating shortcuts...";
                Application.DoEvents();

                if (desktopShortcutCheck.Checked)
                {
                    CreateShortcut(
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "ChefPulse POS.lnk"),
                        destExe,
                        "--launch \"" + serverUrl + "\"",
                        "ChefPulse POS Desktop Client"
                    );
                }

                string startMenuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "ChefPulse POS");
                if (!Directory.Exists(startMenuDir)) Directory.CreateDirectory(startMenuDir);
                CreateShortcut(
                    Path.Combine(startMenuDir, "ChefPulse POS.lnk"),
                    destExe,
                    "--launch \"" + serverUrl + "\"",
                    "ChefPulse POS Desktop Client"
                );

                if (startupCheck.Checked)
                {
                    string startupDir = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
                    CreateShortcut(
                        Path.Combine(startupDir, "ChefPulse POS.lnk"),
                        destExe,
                        "--launch \"" + serverUrl + "\"",
                        "ChefPulse POS Desktop Client"
                    );
                }

                RegisterUninstall(destExe, installDir);

                progressBar.Value = 100;
                statusLabel.ForeColor = Color.FromArgb(52, 211, 153);
                statusLabel.Text = "Installation complete! Desktop & Start Menu shortcuts ready.";
                MessageBox.Show(
                    "ChefPulse POS has been successfully installed!\n\nDesktop shortcut: 'ChefPulse POS'\nServer: " + serverUrl,
                    "Installation Complete",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
            catch (Exception ex)
            {
                statusLabel.ForeColor = Color.FromArgb(248, 113, 113);
                statusLabel.Text = "Error: " + ex.Message;
                MessageBox.Show("Installation error: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                installButton.Enabled = true;
            }
        }

        private void LaunchButton_Click(object sender, EventArgs e)
        {
            string serverUrl = serverUrlBox.Text.Trim();
            LaunchDirect(serverUrl);
        }

        private static string FindBrowser()
        {
            string[] paths = {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe")
            };
            foreach (var p in paths)
            {
                if (File.Exists(p)) return p;
            }
            return "";
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string arguments, string description)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetPath;
                shortcut.Arguments = arguments;
                shortcut.Description = description;
                shortcut.WorkingDirectory = Path.GetDirectoryName(targetPath);
                shortcut.Save();
            }
            catch {}
        }

        private static void RegisterUninstall(string exePath, string installDir)
        {
            try
            {
                string keyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ChefPulsePOS";
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(keyPath))
                {
                    if (key != null)
                    {
                        key.SetValue("DisplayName", "ChefPulse POS Desktop Client");
                        key.SetValue("DisplayVersion", AppVersion);
                        key.SetValue("Publisher", "Classic Hotel Systems");
                        key.SetValue("InstallLocation", installDir);
                        key.SetValue("DisplayIcon", exePath);
                        key.SetValue("UninstallString", "\"" + exePath + "\" --uninstall");
                        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    }
                }
            }
            catch {}
        }
    }
}
