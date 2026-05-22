const express = require('express');
const router = express.Router();
const db = require('../database');

router.get('/', (req, res) => {
  const clients = db.prepare(`
    SELECT c.*, p.name as parent_name, p.code as parent_code
    FROM clients c
    LEFT JOIN clients p ON c.parent_id = p.id
    ORDER BY COALESCE(p.name, c.name), c.name
  `).all();
  res.json(clients);
});

router.post('/', (req, res) => {
  const { name, code, isci_code, parent_id } = req.body;
  if (!name || !code || !isci_code) return res.status(400).json({ error: 'name, code, and isci_code are required' });
  try {
    const result = db.prepare(
      'INSERT INTO clients (name, code, isci_code, parent_id) VALUES (?, ?, ?, ?)'
    ).run(name, code.toUpperCase(), isci_code.toUpperCase(), parent_id || null);
    res.json(db.prepare(`
      SELECT c.*, p.name as parent_name FROM clients c
      LEFT JOIN clients p ON c.parent_id = p.id WHERE c.id = ?
    `).get(result.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: 'Client code already exists' });
  }
});

router.put('/:id', (req, res) => {
  const { name, code, isci_code, active, parent_id } = req.body;
  // Prevent circular parenting
  if (parent_id && Number(parent_id) === Number(req.params.id)) {
    return res.status(400).json({ error: 'A client cannot be its own parent' });
  }
  try {
    db.prepare('UPDATE clients SET name=?, code=?, isci_code=?, active=?, parent_id=? WHERE id=?')
      .run(name, code.toUpperCase(), isci_code.toUpperCase(), active, parent_id || null, req.params.id);
    res.json(db.prepare(`
      SELECT c.*, p.name as parent_name FROM clients c
      LEFT JOIN clients p ON c.parent_id = p.id WHERE c.id = ?
    `).get(req.params.id));
  } catch (e) {
    res.status(400).json({ error: 'Client code already exists' });
  }
});

router.delete('/:id', (req, res) => {
  const jobCount = db.prepare('SELECT COUNT(*) as c FROM jobs WHERE client_id = ?').get(req.params.id).c;
  if (jobCount > 0) return res.status(400).json({ error: 'Cannot delete client with existing jobs' });
  const childCount = db.prepare('SELECT COUNT(*) as c FROM clients WHERE parent_id = ?').get(req.params.id).c;
  if (childCount > 0) return res.status(400).json({ error: 'Cannot delete a group that has clients under it' });
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
