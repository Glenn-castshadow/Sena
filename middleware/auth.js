const { BASE_PATH } = require('../config');

function requireAuth(req, res, next) {
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
