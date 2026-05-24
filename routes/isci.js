const express = require('express');
const router = express.Router();
const db = require('../database');
const { getDescendantClientIds } = require('../lib/jobs-repository');

function getNextIsciSerial(client_id, year, media_type) {
  const row = db.prepare(
    "SELECT MAX(serial) as max_serial FROM isci_codes WHERE client_id = ? AND year = ? AND media_type = ?"
  ).get(client_id, year, media_type);
  return (row.max_serial || 0) + 1;
}

function buildCode(prefix, year, serial, media_type) {
  const paddedSerial = String(serial).padStart(3, '0');
  return `${prefix}${year}${paddedSerial}${media_type}`;
}

// Walk up parent chain; return root client
function getRootClient(clientId) {
  const seen = new Set();
  let c = db.prepare('SELECT id, code, parent_id FROM clients WHERE id = ?').get(clientId);
  while (c && c.parent_id) {
    if (seen.has(c.id)) break;
    seen.add(c.id);
    c = db.prepare('SELECT id, code, parent_id FROM clients WHERE id = ?').get(c.parent_id);
  }
  return c;
}

// Build the ISCI prefix from the client hierarchy:
// - Root (top-level) client: use their own isci_code as the full prefix
// - Child client: root's isci_code + client's own isci_code
// e.g. KMK (child of Sena Advertising, SA) → prefix = 'SA' + 'KMK' = 'SAKMK'
// e.g. SDCCU (root, isci_code 'DC') → prefix = 'DC'
function getIsciPrefix(client) {
  const root = getRootClient(client.id);
  if (!root || root.id === client.id) return client.isci_code;
  return root.isci_code + client.isci_code;
}

router.get('/', (req, res) => {
  const { search, status, client_id, job_id, created_by_id } = req.query;
  let sql = `
    SELECT i.*, c.name as client_name, c.code as client_code, j.job_number,
           u.username as created_by_username
    FROM isci_codes i
    JOIN clients c ON i.client_id = c.id
    LEFT JOIN jobs j ON i.job_id = j.id
    LEFT JOIN users u ON i.created_by_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (status === 'active') { sql += ' AND i.status = ?'; params.push('active'); }
  else if (status === 'voided') { sql += ' AND i.status = ?'; params.push('voided'); }
  if (client_id) {
    // Include ISCIs for the selected client AND all its descendants
    const ids = getDescendantClientIds(db, client_id);
    const ph = ids.map(() => '?').join(', ');
    sql += ` AND i.client_id IN (${ph})`;
    params.push(...ids);
  }
  if (job_id) { sql += ' AND i.job_id = ?'; params.push(job_id); }
  if (created_by_id) { sql += ' AND i.created_by_id = ?'; params.push(created_by_id); }
  if (search) {
    sql += ' AND (i.code LIKE ? OR i.description LIKE ? OR i.notes LIKE ? OR j.job_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY i.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const { client_id, job_id, media_type, description, notes, year, code_override } = req.body;
  if (!client_id || !media_type) return res.status(400).json({ error: 'client_id and media_type are required' });
  if (!['H', 'R', 'D'].includes(media_type)) return res.status(400).json({ error: 'media_type must be H, R, or D' });

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Client not found' });

  const currentYear = year || String(new Date().getFullYear()).slice(-2);

  let code, serial;
  if (code_override) {
    // Use user-supplied code — check it's not already taken
    const existing = db.prepare('SELECT id FROM isci_codes WHERE code = ?').get(code_override);
    if (existing) return res.status(400).json({ error: `ISCI code "${code_override}" already exists` });
    code = code_override;
    serial = getNextIsciSerial(client_id, currentYear, media_type); // still bump serial counter
  } else {
    const prefix = getIsciPrefix(client);
    serial = getNextIsciSerial(client_id, currentYear, media_type);
    code = buildCode(prefix, currentYear, serial, media_type);
  }

  const created_by_id = req.session?.userId || null;
  const result = db.prepare(
    'INSERT INTO isci_codes (code, client_id, job_id, year, serial, media_type, description, notes, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(code, client_id, job_id || null, currentYear, serial, media_type, description || null, notes || null, created_by_id);

  res.json(db.prepare(`
    SELECT i.*, c.name as client_name, c.code as client_code, j.job_number
    FROM isci_codes i
    JOIN clients c ON i.client_id = c.id
    LEFT JOIN jobs j ON i.job_id = j.id
    WHERE i.id = ?
  `).get(result.lastInsertRowid));
});

router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'voided'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE isci_codes SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

router.patch('/:id', (req, res) => {
  const { description, notes, job_id, media_type } = req.body;
  if (media_type && !['H', 'R', 'D'].includes(media_type)) {
    return res.status(400).json({ error: 'media_type must be H, R, or D' });
  }
  const current = db.prepare('SELECT * FROM isci_codes WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Not found' });

  // Rebuild the ISCI code if media_type changes (last character of code)
  let newCode = current.code;
  const newType = media_type || current.media_type;
  if (media_type && media_type !== current.media_type) {
    newCode = current.code.slice(0, -1) + media_type;
  }

  db.prepare('UPDATE isci_codes SET description=?, notes=?, job_id=?, media_type=?, code=? WHERE id=?')
    .run(description ?? current.description, notes ?? current.notes,
         job_id !== undefined ? (job_id || null) : current.job_id,
         newType, newCode, req.params.id);

  res.json(db.prepare(`
    SELECT i.*, c.name as client_name, j.job_number
    FROM isci_codes i JOIN clients c ON i.client_id = c.id
    LEFT JOIN jobs j ON i.job_id = j.id WHERE i.id = ?
  `).get(req.params.id));
});

module.exports = router;
