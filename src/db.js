const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('sqlite3').Database;

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'eaims.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
const initialized = new Promise((resolve, reject) => {
  db.run('PRAGMA foreign_keys = ON', (foreignKeysError) => {
    if (foreignKeysError) {
      reject(foreignKeysError);
      return;
    }
    db.run('PRAGMA journal_mode = WAL', (journalModeError) => {
      if (journalModeError) reject(journalModeError);
      else resolve();
    });
  });
});

const run = (sql, params = []) => initialized.then(() => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) return reject(err);
    resolve({ id: this.lastID, changes: this.changes });
  });
}));

const get = (sql, params = []) => initialized.then(() => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
}));

const all = (sql, params = []) => initialized.then(() => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
}));

const exec = (sql) => initialized.then(() => new Promise((resolve, reject) => {
  db.exec(sql, (err) => (err ? reject(err) : resolve()));
}));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS applicants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_number TEXT,
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
  training_arrangements TEXT NOT NULL DEFAULT '[]',
  employment_history TEXT NOT NULL DEFAULT '[]',
  course_reason TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS application_program_selections (
  applicant_id INTEGER PRIMARY KEY,
  program_id TEXT NOT NULL,
  intake TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS application_submissions (
  applicant_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'in_review', 'approved', 'admitted')),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  source_application_id TEXT,
  FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS acmis_application_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL UNIQUE,
  source_application_id TEXT NOT NULL UNIQUE,
  payload_json TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sending', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  lease_until TEXT,
  last_error_code TEXT,
  acmis_application_id TEXT,
  delivered_at TEXT,
  next_request_sync_at TEXT,
  request_sync_attempts INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_acmis_application_outbox_delivery
ON acmis_application_outbox(delivery_status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_acmis_application_outbox_request_sync
ON acmis_application_outbox(delivery_status, next_request_sync_at);

CREATE TABLE IF NOT EXISTS acmis_information_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL,
  source_application_id TEXT NOT NULL,
  acmis_request_id TEXT NOT NULL UNIQUE,
  requested_items_json TEXT NOT NULL,
  applicant_message TEXT NOT NULL,
  due_at TEXT,
  created_at TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(applicant_id, acmis_request_id),
  FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_acmis_information_requests_applicant
ON acmis_information_requests(applicant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS acmis_supplemental_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL,
  request_id INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE,
  FOREIGN KEY (request_id) REFERENCES acmis_information_requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_acmis_supplemental_documents_owner
ON acmis_supplemental_documents(applicant_id, request_id);

CREATE TABLE IF NOT EXISTS acmis_document_access_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_application_id TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  result_code TEXT NOT NULL CHECK (result_code IN ('served', 'not_found')),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_acmis_document_access_audit_application
ON acmis_document_access_audit(source_application_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS acmis_information_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL UNIQUE,
  source_response_id TEXT NOT NULL UNIQUE,
  values_json TEXT NOT NULL,
  supplemental_document_ids_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sending', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  lease_until TEXT,
  last_error_code TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (request_id) REFERENCES acmis_information_requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_acmis_information_responses_delivery
ON acmis_information_responses(delivery_status, next_attempt_at);

CREATE TABLE IF NOT EXISTS application_submission_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL,
  failure_code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_application_submission_failures_applicant
ON application_submission_failures(applicant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS application_status_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'in_review', 'approved', 'admitted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT,
  FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_application_status_notifications_applicant
ON application_status_notifications(applicant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS support_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_agents_email_normalized
ON support_agents(lower(email));

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'reviewer')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email_normalized
ON admin_users(lower(email));

CREATE TABLE IF NOT EXISTS programs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  name TEXT NOT NULL,
  duration TEXT NOT NULL DEFAULT '',
  tuition TEXT NOT NULL DEFAULT '',
  eligibility TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS intakes (
  name TEXT PRIMARY KEY,
  opening_date TEXT,
  closing_date TEXT,
  is_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS program_intakes (
  program_id TEXT NOT NULL,
  intake_name TEXT NOT NULL,
  is_available INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (program_id, intake_name),
  FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
  FOREIGN KEY (intake_name) REFERENCES intakes(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_published INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES admin_users(id)
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created
ON admin_audit_logs(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  visitor_key TEXT NOT NULL UNIQUE,
  applicant_id INTEGER,
  status TEXT NOT NULL DEFAULT 'bot'
    CHECK (status IN ('bot', 'pending_human', 'in_progress', 'closed')),
  handoff_reason TEXT,
  assigned_agent_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_agent_id) REFERENCES support_agents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_applicant
ON chat_conversations(applicant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_status
ON chat_conversations(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  sender_type TEXT NOT NULL
    CHECK (sender_type IN ('applicant', 'assistant', 'support', 'system')),
  sender_agent_id INTEGER,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_agent_id) REFERENCES support_agents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
ON chat_messages(conversation_id, id);
`;

async function migrate() {
  await prepareCatalogSchema();
  await exec(SCHEMA);
  const programCatalog = require('./services/program-catalog');
  await transaction(async () => {
    for (const [index, program] of programCatalog.PROGRAMS.entries()) {
      await run(
        `INSERT OR IGNORE INTO programs (id, level, name, duration, tuition, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [program.id, program.level, program.name, program.duration, program.tuition, index],
      );
    }
    for (const intake of programCatalog.INTAKES) {
      await run('INSERT OR IGNORE INTO intakes (name) VALUES (?)', [intake]);
      for (const program of programCatalog.PROGRAMS) {
        await run(
          `INSERT OR IGNORE INTO program_intakes (program_id, intake_name)
           VALUES (?, ?)`,
          [program.id, intake],
        );
      }
    }
  });
  const programColumns = await all('PRAGMA table_info(programs)');
  if (!programColumns.some((column) => column.name === 'sort_order')) {
    await exec('ALTER TABLE programs ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    const programCatalog = require('./services/program-catalog');
    for (const [index, program] of programCatalog.PROGRAMS.entries()) {
      await run('UPDATE programs SET sort_order = ? WHERE id = ?', [index, program.id]);
    }
  }
  const applicantColumns = await all('PRAGMA table_info(applicants)');
  if (!applicantColumns.some((column) => column.name === 'application_number')) {
    await exec('ALTER TABLE applicants ADD COLUMN application_number TEXT');
  }
  await exec(`
    UPDATE applicants
    SET application_number = 'EAIMS-'
      || COALESCE(strftime('%Y', created_at), strftime('%Y', 'now'))
      || '-'
      || printf('%06d', id)
    WHERE application_number IS NULL OR trim(application_number) = ''
  `);
  await exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_applicants_application_number
    ON applicants(application_number)
  `);

  const submissionSchema = await get(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'application_submissions'",
  );
  if (submissionSchema && submissionSchema.sql.includes("CHECK (status = 'submitted')")) {
    await transaction(async () => {
      await run(`
        CREATE TABLE application_submissions_migrated (
          applicant_id INTEGER PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN ('submitted', 'in_review', 'approved', 'admitted')),
          submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
        )
      `);
      await run(`
        INSERT INTO application_submissions_migrated (applicant_id, status, submitted_at)
        SELECT applicant_id, status, submitted_at FROM application_submissions
      `);
      await run('DROP TABLE application_submissions');
      await run('ALTER TABLE application_submissions_migrated RENAME TO application_submissions');
    });
  }
  const submissionColumns = await all('PRAGMA table_info(application_submissions)');
  if (!submissionColumns.some((column) => column.name === 'source_application_id')) {
    await exec('ALTER TABLE application_submissions ADD COLUMN source_application_id TEXT');
  }
  const missingSourceApplicationIds = await all(
    `SELECT applicant_id FROM application_submissions
     WHERE source_application_id IS NULL OR trim(source_application_id) = ''`,
  );
  for (const submission of missingSourceApplicationIds) {
    await run(
      'UPDATE application_submissions SET source_application_id = ? WHERE applicant_id = ?',
      [crypto.randomUUID(), submission.applicant_id],
    );
  }
  await exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_application_submissions_source_application_id
    ON application_submissions(source_application_id)
  `);
  await exec(`
    INSERT INTO application_status_notifications (applicant_id, status, created_at)
    SELECT submission.applicant_id, submission.status, submission.submitted_at
    FROM application_submissions AS submission
    WHERE submission.status IN ('submitted', 'admitted')
      AND NOT EXISTS (
      SELECT 1 FROM application_status_notifications AS notification
      WHERE notification.applicant_id = submission.applicant_id
        AND notification.status = submission.status
    )
  `);

  const profileColumns = await all('PRAGMA table_info(application_profiles)');
  if (!profileColumns.some((column) => column.name === 'next_of_kin_name')) {
    await exec("ALTER TABLE application_profiles ADD COLUMN next_of_kin_name TEXT NOT NULL DEFAULT ''");
  }
  if (!profileColumns.some((column) => column.name === 'next_of_kin_contact')) {
    await exec("ALTER TABLE application_profiles ADD COLUMN next_of_kin_contact TEXT NOT NULL DEFAULT ''");
  }
  if (!profileColumns.some((column) => column.name === 'training_arrangements')) {
    await exec("ALTER TABLE application_profiles ADD COLUMN training_arrangements TEXT NOT NULL DEFAULT '[]'");
  }
  if (!profileColumns.some((column) => column.name === 'employment_history')) {
    await exec("ALTER TABLE application_profiles ADD COLUMN employment_history TEXT NOT NULL DEFAULT '[]'");
  }
  if (!profileColumns.some((column) => column.name === 'course_reason')) {
    await exec("ALTER TABLE application_profiles ADD COLUMN course_reason TEXT NOT NULL DEFAULT ''");
  }
  const programSelectionColumns = await all('PRAGMA table_info(application_program_selections)');
  if (!programSelectionColumns.some((column) => column.name === 'intake')) {
    await exec("ALTER TABLE application_program_selections ADD COLUMN intake TEXT NOT NULL DEFAULT ''");
  }

  const documentColumns = await all('PRAGMA table_info(application_documents)');
  const documentColumnNames = new Set(documentColumns.map((column) => column.name));
  if (documentColumnNames.has('filename') && documentColumnNames.has('data')
    && !documentColumnNames.has('category')) {
    await transaction(async () => {
      await run('DROP INDEX IF EXISTS idx_application_documents_applicant');
      await run('ALTER TABLE application_documents RENAME TO application_documents_legacy');
      await exec(`
        CREATE TABLE application_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          applicant_id INTEGER NOT NULL,
          category TEXT NOT NULL CHECK (category IN ('transcript', 'identity', 'additional')),
          original_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          file_data BLOB NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
        )
      `);
      await run(`
        INSERT INTO application_documents
          (id, applicant_id, category, original_name, mime_type, file_size, file_data, created_at)
        SELECT id, applicant_id, 'additional', filename, mime_type, length(data), data, created_at
        FROM application_documents_legacy
      `);
      await run('DROP TABLE application_documents_legacy');
    });
  }
  await exec(`
    CREATE INDEX IF NOT EXISTS idx_application_documents_applicant
    ON application_documents(applicant_id, category, created_at)
  `);
}

async function prepareCatalogSchema() {
  const tableExists = async (name) => Boolean(await get(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name],
  ));
  const columnsFor = async (name) => all(`PRAGMA table_info(${name})`);
  const existingPrograms = await tableExists('programs');
  const existingIntakes = await tableExists('intakes');
  const programColumns = existingPrograms ? await columnsFor('programs') : [];
  const intakeColumns = existingIntakes ? await columnsFor('intakes') : [];
  const programColumnNames = new Set(programColumns.map((column) => column.name));
  const intakeColumnNames = new Set(intakeColumns.map((column) => column.name));
  const idColumn = programColumns.find((column) => column.name === 'id');
  const nameColumn = intakeColumns.find((column) => column.name === 'name');

  const archivePrograms = existingPrograms && (
    !idColumn
    || idColumn.type.toUpperCase() !== 'TEXT'
    || idColumn.pk !== 1
    || !['level', 'name', 'duration', 'tuition', 'eligibility']
      .every((column) => programColumnNames.has(column))
  );
  const archiveIntakes = existingIntakes && (
    !nameColumn
    || nameColumn.pk !== 1
    || !['opening_date', 'closing_date', 'is_open']
      .every((column) => intakeColumnNames.has(column))
  );

  const legacyTables = [];
  if (archivePrograms || archiveIntakes) {
    if (await tableExists('program_intakes')) {
      legacyTables.push(['program_intakes', 'program_intakes_legacy']);
    }
  }
  if (archivePrograms) legacyTables.push(['programs', 'programs_legacy']);
  if (archiveIntakes) legacyTables.push(['intakes', 'intakes_legacy']);
  if (!legacyTables.length) return;

  for (const [, archiveName] of legacyTables) {
    if (await tableExists(archiveName)) {
      throw new Error(
        `Cannot migrate the legacy admissions catalogue because ${archiveName} already exists. `
        + 'Inspect the existing archive before retrying.',
      );
    }
  }

  await transaction(async () => {
    for (const [tableName, archiveName] of legacyTables) {
      await run(`ALTER TABLE ${tableName} RENAME TO ${archiveName}`);
    }
  });
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
  await new Promise((resolve, reject) => {
    db.close((error) => (error ? reject(error) : resolve()));
  });
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
