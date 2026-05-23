'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, execFile } = require('child_process');

const PORT = 3700;
const HOST = '127.0.0.1';
const VERSION = '1.0.0';

// When packaged with pkg, __dirname is a virtual path — use process.execPath for the real location
const CONFIG_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const APP_URL = (() => {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'sena-helper.json'), 'utf8'));
    if (cfg.url) return cfg.url;
  } catch {}
  return 'http://10.0.7.62:3000';
})();

// ── Folder picker ──────────────────────────────────────────────────────────
function pickFolder(label, defaultPath) {
  return new Promise(resolve => {
    const startPath = defaultPath && fs.existsSync(defaultPath) ? defaultPath : '';
    const safeLabel = label.replace(/'/g, "''");
    const safeStart = startPath.replace(/'/g, "''");
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr hwnd);
    void SetFileTypes(uint n, IntPtr p);
    void SetFileTypeIndex(uint i);
    void GetFileTypeIndex(out uint i);
    void Advise(IntPtr p, out uint dw);
    void Unadvise(uint dw);
    void SetOptions(uint fos);
    void GetOptions(out uint fos);
    void SetDefaultFolder([MarshalAs(UnmanagedType.Interface)] IShellItem psi);
    void SetFolder([MarshalAs(UnmanagedType.Interface)] IShellItem psi);
    void GetFolder([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
    void GetCurrentSelection([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string n);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string n);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string t);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string l);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string l);
    void GetResult([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
    void AddPlace([MarshalAs(UnmanagedType.Interface)] IShellItem psi, int fdap);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string ext);
    void Close(int hr);
    void SetClientGuid(ref Guid g);
    void ClearClientData();
    void SetFilter(IntPtr pf);
    void GetResults(out IntPtr pe);
    void GetSelectedItems(out IntPtr ps);
}
[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
    void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
    void GetAttributes(uint mask, out uint attribs);
    void Compare([MarshalAs(UnmanagedType.Interface)] IShellItem psi, uint hint, out int order);
}
[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7"), ClassInterface(ClassInterfaceType.None)]
class FileOpenDialogClass {}
public static class FolderPicker {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(
        [MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr pbc,
        [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    public static string Pick(string title, string initialPath, IntPtr owner) {
        var fg = GetForegroundWindow();
        if (fg != IntPtr.Zero && fg != owner) {
            var fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero);
            var myThread = GetCurrentThreadId();
            AttachThreadInput(myThread, fgThread, true);
            SetForegroundWindow(owner);
            BringWindowToTop(owner);
            AttachThreadInput(myThread, fgThread, false);
        }
        var dialog = (IFileOpenDialog)new FileOpenDialogClass();
        dialog.SetOptions(0x68);
        dialog.SetTitle(title);
        if (!string.IsNullOrEmpty(initialPath)) {
            try {
                var iid = typeof(IShellItem).GUID;
                IShellItem folder;
                SHCreateItemFromParsingName(initialPath, IntPtr.Zero, iid, out folder);
                dialog.SetFolder(folder);
            } catch {}
        }
        int hr = dialog.Show(owner);
        if (hr != 0) return null;
        IShellItem result;
        dialog.GetResult(out result);
        string path;
        result.GetDisplayName(0x80058000, out path);
        return path;
    }
}
"@
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0.01
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Show()
[FolderPicker]::Pick('${safeLabel}', '${safeStart}', $owner.Handle)
$owner.Dispose()
`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-Sta', '-EncodedCommand', encoded],
      { timeout: 65000 },
      (err, stdout) => {
        if (err) console.error('[pick]', err.message);
        resolve(stdout ? stdout.trim() : null);
      }
    );
  });
}

// ── Folder creator ─────────────────────────────────────────────────────────
function createFolder(parentPath, folderName, subfolders) {
  const target = path.join(parentPath, folderName);
  fs.mkdirSync(target, { recursive: true });
  for (const sub of (subfolders || [])) {
    fs.mkdirSync(path.join(target, sub), { recursive: true });
  }
  return target;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ── HTTP server ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/ping') {
    return json(res, 200, { ok: true, version: VERSION });
  }

  if (req.method === 'GET' && url.pathname === '/pick-folder') {
    const label = url.searchParams.get('label') || 'Select Folder';
    const defaultPath = url.searchParams.get('default') || '';
    console.log(`[pick] "${label}"`);
    const selected = await pickFolder(label, defaultPath);
    console.log(`[pick] => ${selected || '(cancelled)'}`);
    return json(res, 200, { path: selected || null });
  }

  if (req.method === 'POST' && url.pathname === '/create-folder') {
    try {
      const { parentPath, folderName, subfolders } = await readBody(req);
      if (!parentPath || !folderName) {
        return json(res, 400, { error: 'parentPath and folderName are required' });
      }
      console.log(`[create] ${parentPath}\\${folderName}`);
      const created = createFolder(parentPath, folderName, subfolders);
      console.log(`[create] => ${created}`);
      return json(res, 200, { ok: true, path: created });
    } catch (err) {
      console.error('[create]', err.message);
      return json(res, 500, { error: err.message });
    }
  }

  json(res, 404, { error: 'Not found' });
});

// ── System tray ────────────────────────────────────────────────────────────
let trayProcess = null;

function launchTray() {
  const pid = process.pid;
  const safeUrl = APP_URL.replace(/'/g, "''");
  const exePath = (process.pkg ? process.execPath : __filename).replace(/'/g, "''");

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Use the helper exe's own icon; fall back to the system application icon
try {
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon('${exePath}')
} catch {
  $icon = [System.Drawing.SystemIcons]::Application
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $icon
$tray.Text = 'Sena Folder Helper v${VERSION}'
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = New-Object System.Windows.Forms.ToolStripMenuItem('Open Job Tracker')
$openItem.Font = New-Object System.Drawing.Font($openItem.Font.Name, $openItem.Font.Size, [System.Drawing.FontStyle]::Bold)
$openItem.add_Click({ Start-Process '${safeUrl}' })
$menu.Items.Add($openItem) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$quitItem = New-Object System.Windows.Forms.ToolStripMenuItem('Quit')
$quitItem.add_Click({
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$menu.Items.Add($quitItem) | Out-Null

$tray.ContextMenuStrip = $menu
$tray.add_DoubleClick({ Start-Process '${safeUrl}' })

# Balloon tip on startup
$tray.BalloonTipTitle = 'Sena Folder Helper'
$tray.BalloonTipText  = 'Running — right-click to open or quit'
$tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Info
$tray.ShowBalloonTip(4000)

# Watch parent Node process; exit if it dies
$parentPid = ${pid}
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({
  if (-not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) {
    $tray.Visible = $false
    [System.Windows.Forms.Application]::Exit()
  }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
`.trimStart();

  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  trayProcess = execFile(
    'powershell.exe',
    ['-NoProfile', '-Sta', '-EncodedCommand', encoded],
    { stdio: 'ignore' }
  );

  // User clicked Quit in the tray → shut down the server too
  trayProcess.on('exit', () => process.exit(0));
}

// Ensure tray icon disappears if Node exits for any reason
process.on('exit', () => {
  try { if (trayProcess) trayProcess.kill(); } catch {}
});

// ── Server lifecycle ────────────────────────────────────────────────────────
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    // Already running — just open a new browser tab and exit
    exec(`start "" "${APP_URL}"`);
    setTimeout(() => process.exit(0), 300);
  } else {
    // Show an error dialog since there's no console in the packaged app
    execFile('powershell.exe', [
      '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; ` +
      `[System.Windows.Forms.MessageBox]::Show('${err.message.replace(/'/g, "''")}', ` +
      `'Sena Folder Helper', 'OK', 'Error') | Out-Null`,
    ]);
    setTimeout(() => process.exit(1), 3000);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Sena Folder Helper v${VERSION}`);
  console.log(`Job Tracker: ${APP_URL}`);
  console.log(`Helper:      http://${HOST}:${PORT}`);
  exec(`start "" "${APP_URL}"`);
  launchTray();
});
