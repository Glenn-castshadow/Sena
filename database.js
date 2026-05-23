const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'jobs.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    isci_code TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial INTEGER NOT NULL UNIQUE,
    job_number TEXT NOT NULL UNIQUE,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    description TEXT NOT NULL,
    folder_path TEXT,
    folder_created INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS isci_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    job_id INTEGER REFERENCES jobs(id),
    year TEXT NOT NULL,
    serial INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('H','R')),
    description TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'editor',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
`);

// Seed default settings
const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
insertSetting.run('jobs_root', '');
insertSetting.run('agency_code', 'SA');
insertSetting.run('next_job_serial', '1');
insertSetting.run('template_folder', '');
insertSetting.run('template_structure', ''); // JSON array, cached from last successful template read

// Migrations for existing databases
const userCols = db.pragma('table_info(users)').map(c => c.name);
if (!userCols.includes('active')) {
  db.exec('ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1');
  db.exec('UPDATE users SET active = 1');
}
if (!userCols.includes('role') || db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'user'").get().c > 0) {
  db.exec("UPDATE users SET role = 'admin' WHERE role = 'user'");
}
if (!userCols.includes('preferences')) {
  db.exec('ALTER TABLE users ADD COLUMN preferences TEXT');
}

const clientCols = db.pragma('table_info(clients)').map(c => c.name);
if (!clientCols.includes('parent_id')) {
  db.exec('ALTER TABLE clients ADD COLUMN parent_id INTEGER REFERENCES clients(id)');
}

const jobCols = db.pragma('table_info(jobs)').map(c => c.name);
if (!jobCols.includes('created_by_id')) {
  db.exec('ALTER TABLE jobs ADD COLUMN created_by_id INTEGER REFERENCES users(id)');
}

const isciCols = db.pragma('table_info(isci_codes)').map(c => c.name);
if (!isciCols.includes('created_by_id')) {
  db.exec('ALTER TABLE isci_codes ADD COLUMN created_by_id INTEGER REFERENCES users(id)');
}

// Seed Sena Advertising as default client
const insertClient = db.prepare(`INSERT OR IGNORE INTO clients (name, code, isci_code) VALUES (?, ?, ?)`);
insertClient.run('Sena Advertising', 'SENA', 'SA');

module.exports = db;
