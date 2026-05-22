require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

require('./database');
const SQLiteStore = require('./session-store');
const { requireAuth, requireAdmin, requireEditor } = require('./middleware/auth');

const app = express();
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, ''); // e.g. '/jobtrack'

app.set('trust proxy', 1);

app.use(cors({ origin: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new SQLiteStore(),
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
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

// ── Public routes ──────────────────────────────────────────────────────────
app.use('/auth', require('./routes/auth'));

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect(BASE_PATH + '/');
  serveHtml('login.html')(req, res);
});

// Static assets needed by login page (no auth)
app.use('/login.css', express.static(path.join(__dirname, 'public', 'login.css')));

// ── Protected API ──────────────────────────────────────────────────────────
app.use('/api', requireAuth);

function guardWrites(req, res, next) {
  if (req.method === 'GET') return next();
  return requireEditor(req, res, next);
}

app.use('/api/settings', guardWrites, require('./routes/settings'));
app.use('/api/clients',  guardWrites, require('./routes/clients'));
app.use('/api/jobs',     guardWrites, require('./routes/jobs'));
app.use('/api/isci',     guardWrites, require('./routes/isci'));
app.use('/api/users',    requireAdmin, require('./routes/users'));

// ── Main app — serve index.html with BASE_PATH injected ───────────────────
app.use(requireAuth, express.static(path.join(__dirname, 'public')));
app.get('/{*splat}', requireAuth, serveHtml('index.html'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sena Job Tracker running at http://localhost:${PORT}${BASE_PATH || '/'}`);
});
