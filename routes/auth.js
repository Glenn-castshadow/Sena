const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');
const { BASE_PATH } = require('../config');

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect(`${BASE_PATH}/`);
  res.sendFile(require('path').join(__dirname, '../public/login.html'));
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user || !user.active) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.json({ ok: true, sessionId: req.session.id });
});

router.post('/logout', (req, res) => {
  const tokenSid = req.headers['x-session-id'];
  if (tokenSid) {
    req.sessionStore.destroy(tokenSid, () => res.json({ ok: true }));
  } else {
    req.session.destroy(() => res.json({ ok: true }));
  }
});

// Resolves userId from session cookie or X-Session-Id header (Tauri desktop)
function resolveSession(req, cb) {
  const tokenSid = req.headers['x-session-id'];
  if (tokenSid) {
    return req.sessionStore.get(tokenSid, (err, s) => cb(err, s || null));
  }
  cb(null, req.session.userId ? req.session : null);
}

router.get('/me', (req, res) => {
  resolveSession(req, (err, session) => {
    if (err || !session?.userId) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ id: session.userId, username: session.username, role: session.role });
  });
});

// First-run setup — only works when zero users exist
router.post('/setup', async (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count > 0) return res.status(403).json({ error: 'Setup already complete' });

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const hash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username.trim(), hash, 'admin');
  res.json({ ok: true });
});

// Check if setup is needed (no users exist)
router.get('/setup-needed', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  res.json({ needed: count === 0 });
});

router.get('/preferences', (req, res) => {
  resolveSession(req, (err, session) => {
    if (err || !session?.userId) return res.status(401).json({});
    const user = db.prepare('SELECT preferences FROM users WHERE id = ?').get(session.userId);
    try { res.json(JSON.parse(user?.preferences || '{}')); }
    catch { res.json({}); }
  });
});

router.patch('/preferences', (req, res) => {
  resolveSession(req, (err, session) => {
    if (err || !session?.userId) return res.status(401).json({});
    const user = db.prepare('SELECT preferences FROM users WHERE id = ?').get(session.userId);
    let current = {};
    try { current = JSON.parse(user?.preferences || '{}'); } catch {}
    const updated = { ...current, ...req.body };
    db.prepare('UPDATE users SET preferences = ? WHERE id = ?')
      .run(JSON.stringify(updated), session.userId);
    res.json(updated);
  });
});

module.exports = router;
