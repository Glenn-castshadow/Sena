const { exec, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const SUBFOLDERS_FALLBACK = ['3D', 'After_Effects', 'Audio', 'documents', 'Edit', 'Elements', 'Graphics', 'Renders', 'Scout', 'web_QT'];

function getTemplateStructure(templatePath) {
  const result = [];

  function walk(dir, rel) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.DS_Store') continue;
      const relPath = rel ? path.join(rel, entry.name) : entry.name;
      result.push(relPath);
      walk(path.join(dir, entry.name), relPath);
    }
  }

  walk(templatePath, '');
  return result;
}

function getSetting(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
}

function getSubfolders(db) {
  const templatePath = getSetting(db, 'template_folder');

  if (templatePath && fs.existsSync(templatePath)) {
    const subfolders = getTemplateStructure(templatePath);
    if (subfolders.length > 0) {
      db.prepare('UPDATE settings SET value = ? WHERE key = ?')
        .run(JSON.stringify(subfolders), 'template_structure');
      return subfolders;
    }
  }

  const cached = getSetting(db, 'template_structure');
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {}
  }

  return SUBFOLDERS_FALLBACK;
}

function slugify(str) {
  return str
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function makeJobFolderName(serial, clientCode, description) {
  const descSlug = slugify(description);
  return `${serial}${clientCode}${descSlug ? `_${descSlug}` : ''}`;
}

function createFolderAtPath(db, parentPath, folderName) {
  const folderPath = path.join(parentPath, folderName);
  fs.mkdirSync(folderPath, { recursive: true });
  for (const subfolder of getSubfolders(db)) {
    fs.mkdirSync(path.join(folderPath, subfolder), { recursive: true });
  }
  return folderPath;
}

function recreateFolderAtPath(db, folderPath) {
  fs.mkdirSync(folderPath, { recursive: true });
  for (const subfolder of getSubfolders(db)) {
    fs.mkdirSync(path.join(folderPath, subfolder), { recursive: true });
  }
}

function openFolderPicker(label, defaultPath) {
  return new Promise((resolve) => {
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
      { timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) console.error('[FolderPicker] err:', err.message);
        if (stderr) console.error('[FolderPicker] stderr:', stderr.trim());
        console.log('[FolderPicker] stdout:', JSON.stringify(stdout?.trim()));
        resolve(stdout ? stdout.trim() : null);
      }
    );
  });
}

module.exports = {
  createFolderAtPath,
  getSetting,
  getSubfolders,
  makeJobFolderName,
  openFolderPicker,
  recreateFolderAtPath,
};
