const { BASE_PATH } = require('../config');

function requireAuth(req, res, next) {
  // X-Session-Id: Tauri desktop client workaround — SameSite=Lax cookies are
  // blocked in cross-site iframes (tauri://localhost shell + http:// app frame).
  const tokenSid = req.headers['x-session-id'];
  if (tokenSid) {
    req.sessionStore.get(tokenSid, (err, sessionData) => {
      if (err) {
        console.error('[auth] X-Session-Id store error for', tokenSid.slice(0, 8), err.message);
        return res.status(401).json({ error: 'Not authenticated' });
      }
      if (!sessionData || !sessionData.userId) {
        console.warn('[auth] X-Session-Id not found or missing userId:', tokenSid.slice(0, 8),
          sessionData ? '(no userId)' : '(not in store)', req.method, req.path);
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const db = require('../database');
      const user = db.prepare('SELECT active, role FROM users WHERE id = ?').get(sessionData.userId);
      if (!user || !user.active) {
        console.warn('[auth] X-Session-Id user inactive or missing, userId:', sessionData.userId);
        return res.status(401).json({ error: 'Account inactive' });
      }
      req.session.userId = sessionData.userId;
      req.session.username = sessionData.username;
      req.session.role = user.role;
      return next();
    });
    return;
  }

  if (req.session && req.session.userId) {
    // Reject inactive users on every request
    const db = require('../database');
    const user = db.prepare('SELECT active, role FROM users WHERE id = ?').get(req.session.userId);
    if (!user || !user.active) {
      req.session.destroy(() => {});
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ error: 'Account inactive' });
      }
      return res.redirect(`${BASE_PATH}/login`);
    }
    req.session.role = user.role;
    return next();
  }
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect(`${BASE_PATH}/login`);
}

function requireAdmin(req, res, next) {
  if (req.session?.role === 'admin') return next();
  res.status(403).json({ error: 'Admin access required' });
}

// Viewers get 403 on any write operation
function requireEditor(req, res, next) {
  if (req.session?.role === 'admin' || req.session?.role === 'editor') return next();
  res.status(403).json({ error: 'Read-only access — contact your administrator' });
}

module.exports = { requireAuth, requireAdmin, requireEditor };
