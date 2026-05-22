const { exec } = require('child_process');
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
    const startPath = defaultPath && fs.existsSync(defaultPath) ? defaultPath : null;
    const setStart = startPath ? `$d.SelectedPath = '${startPath.replace(/'/g, "''")}'` : '';
    const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '${label.replace(/'/g, "''")}'
$d.ShowNewFolderButton = $true
${setStart}
if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }
`;

    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { timeout: 60000 },
      (err, stdout) => resolve(stdout ? stdout.trim() : null)
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
