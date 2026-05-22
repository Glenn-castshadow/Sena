const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');

// List all users (admins only — enforced in server.js)
router.get('/', (req, res) => {
  const users = db.prepare(
    'SELECT id, username, role, active, created_at, last_login FROM users ORDER BY username'
  ).all();
  res.json(users);
});

// Create user
router.post('/', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'username, password, and role are required' });
  }
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin, editor, or viewer' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
    ).run(username.trim(), hash, role);
    const user = db.prepare(
      'SELECT id, username, role, active, created_at, last_login FROM users WHERE id = ?'
    ).get(result.lastInsertRowid);
    res.json(user);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: e.message });
  }
});

// Update user (role, active status, username)
router.put('/:id', (req, res) => {
  const { username, role, active } = req.body;
  // Prevent admin from demoting/deactivating themselves
  if (Number(req.params.id) === req.session.userId && (role !== 'admin' || active === 0)) {
    return res.status(400).json({ error: 'You cannot demote or deactivate your own account' });
  }
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    db.prepare('UPDATE users SET username = ?, role = ?, active = ? WHERE id = ?')
      .run(username.trim(), role, active ? 1 : 0, req.params.id);
    const user = db.prepare(
      'SELECT id, username, role, active, created_at, last_login FROM users WHERE id = ?'
    ).get(req.params.id);
    res.json(user);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: e.message });
  }
});

// Reset password
router.post('/:id/password', async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const hash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
