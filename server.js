require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

require('./database');
const { BASE_PATH, sessionSecret } = require('./config');
const SQLiteStore = require('./session-store');
const { requireAuth, requireAdmin, requireEditor } = require('./middleware/auth');

// Injects window.BASE_PATH into HTML before sending
function serveHtml(file) {
  return (req, res) => {
    const html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
    const injected = html.replace(
      '</head>',
      `<script>window.BASE_PATH=${JSON.stringify(BASE_PATH)};</script></head>`
    );
    res.type('html').send(injected);
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
      secure: process.env.NODE_ENV === 'production',
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

  app.use('/api', requireAuth);
  app.use('/api/settings', guardWrites, require('./routes/settings'));
  app.use('/api/clients', guardWrites, require('./routes/clients'));
  app.use('/api/jobs', guardWrites, require('./routes/jobs'));
  app.use('/api/isci', guardWrites, require('./routes/isci'));
  app.use('/api/users', requireAdmin, require('./routes/users'));

  app.use(requireAuth, express.static(path.join(__dirname, 'public')));
  app.get('/{*splat}', requireAuth, serveHtml('index.html'));

  return app;
}

const PORT = process.env.PORT || 3000;
const app = createApp();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Sena Job Tracker running at http://localhost:${PORT}${BASE_PATH || '/'}`);
  });
}

module.exports = { app, createApp };
