const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const db = require('../database');
const fs = require('fs');
const path = require('path');

// Fallback flat list if no template folder is configured
const SUBFOLDERS_FALLBACK = ['3D', 'After_Effects', 'Audio', 'documents', 'Edit', 'Elements', 'Graphics', 'Renders', 'Scout', 'web_QT'];

// Recursively collect all subdirectory relative paths from a template folder
function getTemplateStructure(templatePath) {
  const result = [];
  function walk(dir, rel) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === '.DS_Store') continue;
      const relPath = rel ? path.join(rel, e.name) : e.name;
      result.push(relPath);
      walk(path.join(dir, e.name), relPath);
    }
  }
  walk(templatePath, '');
  return result;
}

function getNextSerial() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'next_job_serial'").get();
  return parseInt(row.value, 10);
}

function bumpSerial(serial) {
  db.prepare("UPDATE settings SET value = ? WHERE key = 'next_job_serial'").run(String(serial + 1));
}

function slugify(str) {
  return str
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_')  // replace non-safe chars with _
    .replace(/_+/g, '_')                // collapse multiple underscores
    .replace(/^_|_$/g, '');             // strip leading/trailing underscores
}

function makeJobFolderName(serial, clientCode, description) {
  const descSlug = slugify(description);
  return `${serial}${clientCode}${descSlug ? '_' + descSlug : ''}`;
}

function getSubfolders() {
  const templatePath = db.prepare("SELECT value FROM settings WHERE key = 'template_folder'").get()?.value;

  if (templatePath && fs.existsSync(templatePath)) {
    const subs = getTemplateStructure(templatePath);
    if (subs.length > 0) {
      // Cache the structure for offline/unavailable fallback
      db.prepare("UPDATE settings SET value = ? WHERE key = 'template_structure'")
        .run(JSON.stringify(subs));
      return subs;
    }
  }

  // Try the cached structure
  const cached = db.prepare("SELECT value FROM settings WHERE key = 'template_structure'").get()?.value;
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }

  // Last resort: hardcoded flat list
  return SUBFOLDERS_FALLBACK;
}

function createFolderAtPath(parentPath, folderName) {
  const folder_path = path.join(parentPath, folderName);
  fs.mkdirSync(folder_path, { recursive: true });
  for (const sub of getSubfolders()) {
    fs.mkdirSync(path.join(folder_path, sub), { recursive: true });
  }
  return folder_path;
}

function openFolderPicker(label, defaultPath) {
  return new Promise((resolve) => {
    // Start in jobs_root if set, otherwise MyComputer
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

router.get('/', (req, res) => {
  const { search, status, client_id, group_id, created_by_id } = req.query;
  let sql = `
    SELECT j.*, c.name as client_name, c.code as client_code,
           c.parent_id, p.name as group_name, p.code as group_code,
           u.username as created_by_username
    FROM jobs j
    JOIN clients c ON j.client_id = c.id
    LEFT JOIN clients p ON c.parent_id = p.id
    LEFT JOIN users u ON j.created_by_id = u.id
    WHERE 1=1
  `;
  const params = [];
  // Never show archived in the main list — archived jobs are accessed via the archive modal only
  if (status === 'active') { sql += ' AND j.status = ?'; params.push('active'); }
  else if (status === 'voided') { sql += ' AND j.status = ?'; params.push('voided'); }
  else { sql += ' AND j.status != ?'; params.push('archived'); }

  if (group_id) {
    // Include jobs belonging directly to the group OR any of its children
    sql += ' AND (c.id = ? OR c.parent_id = ?)';
    params.push(group_id, group_id);
  } else if (client_id) {
    sql += ' AND j.client_id = ?';
    params.push(client_id);
  }

  if (created_by_id) { sql += ' AND j.created_by_id = ?'; params.push(created_by_id); }
  if (search) {
    sql += ' AND (j.job_number LIKE ? OR j.description LIKE ? OR j.notes LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY j.serial DESC';
  res.json(db.prepare(sql).all(...params));
});

// ── Archive / Export / Restore (must be before /:id) ──────────────────────
router.get('/archive-preview', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates required' });
  const jobs = getArchiveRange(from, to);
  const isciCount = jobs.reduce((n, j) => {
    return n + db.prepare("SELECT COUNT(*) as c FROM isci_codes WHERE job_id = ? AND status != 'archived'").get(j.id).c;
  }, 0);
  res.json({ jobs: jobs.length, isci: isciCount });
});

router.get('/export-csv', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates required' });
  const jobs = getArchiveRange(from, to);
  const escape = v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = ['Job Number','Client','Description','Folder','Created','Status','Notes','Created By'];
  const rows = jobs.map(j => [
    j.job_number, j.client_name, j.description,
    j.folder_path || '', j.created_at || '', j.status,
    (j.notes || '').replace(/\n/g, ' '), j.created_by_username || ''
  ].map(escape).join(','));
  const isciHeaders = ['','ISCI Code','Client','Type','Description','Linked Job','Created','Status'];
  const isciRows = [];
  jobs.forEach(j => {
    db.prepare(`SELECT i.*, c.name as client_name FROM isci_codes i JOIN clients c ON i.client_id = c.id WHERE i.job_id = ? AND i.status != 'archived'`).all(j.id)
      .forEach(i => isciRows.push(['', i.code, i.client_name, i.media_type === 'H' ? 'HD Video' : 'Radio', i.description || '', j.job_number, i.created_at || '', i.status].map(escape).join(',')));
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="sena-jobs-${from}-to-${to}.csv"`);
  res.send([headers.join(','), ...rows, '', 'ISCI CODES', isciHeaders.join(','), ...isciRows].join('\r\n'));
});

router.post('/archive', (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates required' });
  const jobs = getArchiveRange(from, to);
  if (jobs.length === 0) return res.json({ archived_jobs: 0, archived_isci: 0 });
  let archivedIsci = 0;
  db.transaction(() => {
    jobs.forEach(j => {
      db.prepare("UPDATE jobs SET status = 'archived' WHERE id = ?").run(j.id);
      archivedIsci += db.prepare("UPDATE isci_codes SET status = 'archived' WHERE job_id = ? AND status != 'archived'").run(j.id).changes;
    });
  })();
  res.json({ archived_jobs: jobs.length, archived_isci: archivedIsci });
});

// Preview count of archived records in a date range
router.get('/restore-preview', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates required' });
  const jobs = db.prepare(`
    SELECT id FROM jobs
    WHERE status = 'archived'
      AND date(created_at) >= date(?) AND date(created_at) <= date(?)
  `).all(from, to);
  const isciCount = jobs.reduce((n, j) => {
    return n + db.prepare("SELECT COUNT(*) as c FROM isci_codes WHERE job_id = ? AND status = 'archived'").get(j.id).c;
  }, 0);
  res.json({ jobs: jobs.length, isci: isciCount });
});

// Restore archived jobs (and their ISCIs) in a date range back to active
router.post('/restore', (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates required' });
  const jobs = db.prepare(`
    SELECT id FROM jobs
    WHERE status = 'archived'
      AND date(created_at) >= date(?) AND date(created_at) <= date(?)
  `).all(from, to);
  if (jobs.length === 0) return res.json({ restored_jobs: 0, restored_isci: 0 });
  let restoredIsci = 0;
  db.transaction(() => {
    jobs.forEach(j => {
      db.prepare("UPDATE jobs SET status = 'active' WHERE id = ?").run(j.id);
      restoredIsci += db.prepare("UPDATE isci_codes SET status = 'active' WHERE job_id = ? AND status = 'archived'").run(j.id).changes;
    });
  })();
  res.json({ restored_jobs: jobs.length, restored_isci: restoredIsci });
});

router.get('/:id', (req, res) => {
  const job = db.prepare(`
    SELECT j.*, c.name as client_name, c.code as client_code
    FROM jobs j JOIN clients c ON j.client_id = c.id WHERE j.id = ?
  `).get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  job.isci_codes = db.prepare('SELECT * FROM isci_codes WHERE job_id = ? ORDER BY serial').all(job.id);
  res.json(job);
});

router.post('/', (req, res) => {
  const { client_id, description, notes } = req.body;
  if (!client_id || !description) return res.status(400).json({ error: 'client_id and description are required' });
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Client not found' });

  const serial = getNextSerial();
  const folderName = makeJobFolderName(serial, client.code, description);
  const job_number = folderName; // job_number IS the folder name

  // Auto-create folder using global root if set
  const jobsRoot = db.prepare("SELECT value FROM settings WHERE key = 'jobs_root'").get()?.value || '';
  let folder_path = '', folder_created = 0;
  if (jobsRoot) {
    try {
      folder_path = createFolderAtPath(jobsRoot, folderName);
      folder_created = 1;
    } catch (e) {
      folder_path = path.join(jobsRoot, folderName);
    }
  }

  const created_by_id = req.session?.userId || null;
  const result = db.prepare(
    'INSERT INTO jobs (serial, job_number, client_id, description, folder_path, folder_created, notes, created_by_id) VALUES (?,?,?,?,?,?,?,?)'
  ).run(serial, job_number, client_id, description, folder_path, folder_created, notes || null, created_by_id);

  bumpSerial(serial);
  res.json(db.prepare('SELECT j.*, c.name as client_name, c.code as client_code FROM jobs j JOIN clients c ON j.client_id = c.id WHERE j.id = ?').get(result.lastInsertRowid));
});

router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'voided'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

router.patch('/:id/notes', (req, res) => {
  db.prepare('UPDATE jobs SET notes = ? WHERE id = ?').run(req.body.notes, req.params.id);
  res.json({ ok: true });
});

// Pick a parent folder via native dialog, then create the job folder inside it
router.post('/:id/pick-and-create', async (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });

  const defaultRoot = db.prepare("SELECT value FROM settings WHERE key = 'jobs_root'").get()?.value || '';
  const parentPath = await openFolderPicker(`Select parent folder for: ${job.job_number}`, defaultRoot);

  if (!parentPath) return res.json({ cancelled: true });

  try {
    const folder_path = createFolderAtPath(parentPath, job.job_number);
    db.prepare('UPDATE jobs SET folder_path = ?, folder_created = 1 WHERE id = ?').run(folder_path, job.id);
    res.json({ ok: true, folder_path, folder_name: job.job_number });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Recreate the folder and all subfolders at the already-saved path
router.post('/:id/recreate-folder', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  if (!job.folder_path) return res.status(400).json({ error: 'No folder path saved for this job' });

  try {
    fs.mkdirSync(job.folder_path, { recursive: true });
    for (const sub of SUBFOLDERS) {
      fs.mkdirSync(path.join(job.folder_path, sub), { recursive: true });
    }
    db.prepare('UPDATE jobs SET folder_created = 1 WHERE id = ?').run(job.id);
    res.json({ ok: true, folder_path: job.folder_path });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function getArchiveRange(from, to) {
  return db.prepare(`
    SELECT j.*, c.name as client_name, c.code as client_code,
           u.username as created_by_username
    FROM jobs j
    JOIN clients c ON j.client_id = c.id
    LEFT JOIN users u ON j.created_by_id = u.id
    WHERE j.status != 'archived'
      AND date(j.created_at) >= date(?)
      AND date(j.created_at) <= date(?)
    ORDER BY j.serial ASC
  `).all(from, to);
}

module.exports = router;
