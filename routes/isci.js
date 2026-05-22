const express = require('express');
const router = express.Router();
const db = require('../database');

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
  let c = db.prepare('SELECT id, code, parent_id FROM clients WHERE id = ?').get(clientId);
  while (c && c.parent_id) {
    c = db.prepare('SELECT id, code, parent_id FROM clients WHERE id = ?').get(c.parent_id);
  }
  return c;
}

// Build the ISCI prefix for a client:
// - If the client's root ancestor matches the agency code, prefix = agencyCode + client.isci_code
// - Otherwise the client's own isci_code IS the full prefix (standalone client)
function getIsciPrefix(client) {
  const agencyCode = db.prepare("SELECT value FROM settings WHERE key = 'agency_code'").get()?.value || 'SA';
  const root = getRootClient(client.id);
  if (root && root.isci_code === agencyCode) {
    // Client IS the root agency — isci_code is already the full prefix
    if (root.id === client.id) return agencyCode;
    return agencyCode + client.isci_code;
  }
  // Standalone client — their isci_code IS the full prefix
  return client.isci_code;
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
  if (client_id) { sql += ' AND i.client_id = ?'; params.push(client_id); }
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
  const { client_id, job_id, media_type, description, notes, year } = req.body;
  if (!client_id || !media_type) return res.status(400).json({ error: 'client_id and media_type are required' });
  if (!['H', 'R'].includes(media_type)) return res.status(400).json({ error: 'media_type must be H or R' });

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(400).json({ error: 'Client not found' });

  const prefix = getIsciPrefix(client);
  const currentYear = year || String(new Date().getFullYear()).slice(-2);
  const serial = getNextIsciSerial(client_id, currentYear, media_type);
  const code = buildCode(prefix, currentYear, serial, media_type);

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
  const { description, notes, job_id } = req.body;
  db.prepare('UPDATE isci_codes SET description=?, notes=?, job_id=? WHERE id=?')
    .run(description || null, notes || null, job_id || null, req.params.id);
  res.json(db.prepare(`
    SELECT i.*, c.name as client_name, j.job_number
    FROM isci_codes i JOIN clients c ON i.client_id = c.id
    LEFT JOIN jobs j ON i.job_id = j.id WHERE i.id = ?
  `).get(req.params.id));
});

module.exports = router;
