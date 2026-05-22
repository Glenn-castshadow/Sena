const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const db = require('../database');

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

router.post('/', (req, res) => {
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const updateMany = db.transaction((pairs) => {
    for (const [key, value] of Object.entries(pairs)) {
      update.run(key, value);
    }
  });
  updateMany(req.body);
  res.json({ ok: true });
});

function pickFolder(label, defaultPath) {
  return new Promise(resolve => {
    const setStart = defaultPath && require('fs').existsSync(defaultPath)
      ? `$d.SelectedPath = '${defaultPath.replace(/'/g, "''")}'` : '';
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
    require('child_process').exec(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { timeout: 60000 },
      (err, stdout) => resolve(stdout ? stdout.trim() : null)
    );
  });
}

// Opens a native Windows folder picker on the server machine.
router.get('/pick-folder', async (req, res) => {
  const current = db.prepare("SELECT value FROM settings WHERE key = 'jobs_root'").get()?.value || '';
  const selected = await pickFolder('Select Jobs Root Folder', current);
  res.json({ path: selected || null });
});

router.get('/pick-template', async (req, res) => {
  const current = db.prepare("SELECT value FROM settings WHERE key = 'template_folder'").get()?.value || '';
  const selected = await pickFolder('Select Job Template Folder', current);
  res.json({ path: selected || null });
});

module.exports = router;
