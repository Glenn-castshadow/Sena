require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

require('./database');
const { BASE_PATH, port, sessionSecret } = require('./config');
const SQLiteStore = require('./session-store');
const { requireAuth, requireAdmin, requireEditor } = require('./middleware/auth');

// Injects window.BASE_PATH and a cache-busting version into HTML before sending
const BUILD_TS = Date.now(); // changes on every server restart, busts JS/CSS cache

function serveHtml(file) {
  return (req, res) => {
    let html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
    // Inject config
    html = html.replace(
      '</head>',
      `<script>window.BASE_PATH=${JSON.stringify(BASE_PATH)};</script></head>`
    );
    // Append cache-buster to local JS/CSS references
    html = html.replace(/(src|href)="(app\.js|style\.css|login\.css)"/g,
      `$1="$2?v=${BUILD_TS}"`);
    res.type('html').send(html);
  };
}

function guardWrites(req, res, next) {
  if (req.method === 'GET') return next();
  return requireEditor(req, res, next);
}

function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(cors({ origin: false }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(session({
    store: new SQLiteStore(),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: 'sena.sid',
    cookie: {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
    },
  }));

  app.use('/auth', require('./routes/auth'));

  app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect(BASE_PATH + '/');
    serveHtml('login.html')(req, res);
  });

  // Static assets needed by login page (no auth)
  app.use('/login.css', express.static(path.join(__dirname, 'public', 'login.css')));

  // Helper download — no auth required so users can grab it before logging in
  const HELPER_EXE = path.join(__dirname, 'folder-helper', 'dist', 'SenaFolderHelper.exe');
  app.get('/helper', (req, res) => {
    const built = fs.existsSync(HELPER_EXE);
    res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Sena Folder Helper</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 560px; margin: 60px auto; padding: 0 20px; color: #1a1a2e; }
  h1 { font-size: 1.4rem; margin-bottom: .25rem; }
  p { line-height: 1.6; color: #444; }
  .btn { display: inline-block; margin-top: 1rem; padding: .6rem 1.4rem; background: #2563eb; color: #fff; border-radius: 6px; text-decoration: none; font-weight: 600; }
  .btn:hover { background: #1d4ed8; }
  .warn { background: #fef9c3; border: 1px solid #fde047; border-radius: 6px; padding: .75rem 1rem; margin-top: 1rem; font-size: .9rem; }
  .note { font-size: .85rem; color: #666; margin-top: 1rem; }
</style></head><body>
<h1>Sena Folder Helper</h1>
<p>This small app runs in the background on <strong>your Windows PC</strong> and lets the Job Tracker open native folder dialogs on your screen instead of on the server.</p>
<p><strong>Run it once per session</strong> — just double-click and keep the window open while you work.</p>
${built
  ? `<a class="btn" href="${BASE_PATH}/helper/download">Download SenaFolderHelper.exe</a>
<p class="note">No installation required. Requires Windows 10/11.</p>`
  : `<div class="warn">The helper hasn't been built yet. Run <code>folder-helper/build.bat</code> on the server first.</div>`}
<p class="note"><a href="${BASE_PATH}/">← Back to Job Tracker</a></p>
</body></html>`);
  });

  app.get('/helper/download', (req, res) => {
    if (!fs.existsSync(HELPER_EXE)) {
      return res.status(404).send('Helper exe not built yet. Run folder-helper/build.bat on the server.');
    }
    res.download(HELPER_EXE, 'SenaFolderHelper.exe');
  });

  app.use('/api', requireAuth);
  app.use('/api/settings', guardWrites, require('./routes/settings'));
  app.use('/api/clients', guardWrites, require('./routes/clients'));
  app.use('/api/jobs', guardWrites, require('./routes/jobs'));
  app.use('/api/isci', guardWrites, require('./routes/isci'));
  app.use('/api/users', requireAdmin, require('./routes/users'));

  // Static files (HTML/JS/CSS) are public — all sensitive data is behind /api requireAuth.
  // This is necessary for the Tauri iframe shell, where SameSite=Lax cookies are blocked.
  // index:false forces GET / through to the serveHtml catch-all so BUILD_TS cache-busting applies.
  app.use(express.static(path.join(__dirname, 'public'), { index: false }));
  app.get('/{*splat}', serveHtml('index.html'));

  return app;
}

const app = createApp();

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Sena Job Tracker running at http://localhost:${port}${BASE_PATH || '/'}`);
  });
}

module.exports = { app, createApp };
