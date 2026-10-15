const path = require('path');
const fs = require('fs');
const Database = require('sqlite3').Database;

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'eaims.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.run('PRAGMA foreign_keys = ON');
db.run('PRAGMA journal_mode = WAL');

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) return reject(err);
    resolve({ id: this.lastID, changes: this.changes });
  });
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});

const exec = (sql) => new Promise((resolve, reject) => {
  db.exec(sql, (err) => (err ? reject(err) : resolve()));
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS applicants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surname TEXT NOT NULL,
  other_names TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  phone_country_code TEXT DEFAULT '+256',
  nationality TEXT,
  date_of_birth TEXT,
  sex TEXT,
  password_hash TEXT NOT NULL,
  is_verified INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(email),
  UNIQUE(phone)
);

CREATE INDEX IF NOT EXISTS idx_applicants_email ON applicants(email);
CREATE INDEX IF NOT EXISTS idx_applicants_phone ON applicants(phone);
CREATE UNIQUE INDEX IF NOT EXISTS idx_applicants_email_normalized ON applicants(lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_applicants_phone_normalized ON applicants(phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  used INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_otps_applicant ON otps(applicant_id);
CREATE INDEX IF NOT EXISTS idx_otps_code ON otps(code);
CREATE INDEX IF NOT EXISTS idx_otps_purpose ON otps(applicant_id, purpose, used, expires_at);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
CREATE INDEX IF NOT EXISTS idx_password_resets_applicant ON password_resets(applicant_id, used, expires_at);

CREATE TABLE IF NOT EXISTS application_profiles (
  applicant_id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  id_number TEXT NOT NULL DEFAULT '',
  country_of_birth TEXT NOT NULL DEFAULT '',
  date_of_birth TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  physical_address TEXT NOT NULL DEFAULT '',
  next_of_kin_name TEXT NOT NULL DEFAULT '',
  next_of_kin_contact TEXT NOT NULL DEFAULT '',
  passport_photo BLOB,
  passport_photo_mime TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS application_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('transcript', 'identity', 'additional')),
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_data BLOB NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_application_documents_applicant
  ON application_documents(applicant_id, category, created_at);

CREATE TABLE IF NOT EXISTS application_program_selections (
  applicant_id INTEGER PRIMARY KEY,
  program_id TEXT NOT NULL,
  intake TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
`;

async function migrate() {
  await exec(SCHEMA);
  const profileColumns = await all('PRAGMA table_info(application_profiles)');
  if (!profileColumns.some((column) => column.name === 'next_of_kin_name')) {
    await exec("ALTER TABLE application_profiles ADD COLUMN next_of_kin_name TEXT NOT NULL DEFAULT ''");
  }
  if (!profileColumns.some((column) => column.name === 'next_of_kin_contact')) {
    await exec("ALTER TABLE application_profiles ADD COLUMN next_of_kin_contact TEXT NOT NULL DEFAULT ''");
  }
  const programSelectionColumns = await all('PRAGMA table_info(application_program_selections)');
  if (!programSelectionColumns.some((column) => column.name === 'intake')) {
    await exec("ALTER TABLE application_program_selections ADD COLUMN intake TEXT NOT NULL DEFAULT ''");
  }
}

async function transaction(work) {
  await exec('BEGIN IMMEDIATE');
  try {
    const result = await work();
    await exec('COMMIT');
    return result;
  } catch (error) {
    await exec('ROLLBACK');
    throw error;
  }
}

async function close() {
  await new Promise((resolve) => db.close(resolve));
}

if (require.main === module && process.argv[2] === 'migrate') {
  migrate()
    .then(() => console.log('Database migration complete.'))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await close();
    });
}

module.exports = { run, get, all, exec, migrate, transaction, close, db };
