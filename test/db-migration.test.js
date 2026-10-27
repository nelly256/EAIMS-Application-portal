'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sqlite3 = require('sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaims-db-migration-test-'));
process.env.DB_PATH = path.join(tmpDir, 'legacy.db');
process.env.NODE_ENV = 'test';

let db;

function createLegacyDatabase() {
  return new Promise((resolve, reject) => {
    const legacyDb = new sqlite3.Database(process.env.DB_PATH);
    legacyDb.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE applicants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        surname TEXT NOT NULL,
        other_names TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        password_hash TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE programs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        qualification_level TEXT NOT NULL,
        campus TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE intakes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        intake_date TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        applicant_id INTEGER NOT NULL,
        programme_id INTEGER,
        intake_id INTEGER,
        FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE,
        FOREIGN KEY (programme_id) REFERENCES programs(id),
        FOREIGN KEY (intake_id) REFERENCES intakes(id)
      );
      CREATE TABLE program_intakes (
        program_id TEXT NOT NULL,
        intake_name TEXT NOT NULL,
        is_available INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (program_id, intake_name),
        FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
        FOREIGN KEY (intake_name) REFERENCES intakes(name) ON DELETE CASCADE
      );
      INSERT INTO applicants (surname, other_names, password_hash)
      VALUES ('Legacy', 'Applicant', 'unused-test-hash');
      INSERT INTO programs (code, name, qualification_level)
      VALUES ('LEGACY-01', 'Legacy programme', 'Diploma');
      INSERT INTO intakes (name, intake_date)
      VALUES ('Legacy intake', '2025-03-01');
      INSERT INTO applications (applicant_id, programme_id, intake_id)
      VALUES (1, 1, 1);
    `, (error) => {
      legacyDb.close((closeError) => {
        if (error) reject(error);
        else if (closeError) reject(closeError);
        else resolve();
      });
    });
  });
}

before(async () => {
  await createLegacyDatabase();
});

after(async () => {
  if (db) await db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('provisions the first admin after archiving incompatible catalogues and preserves historical applications', async () => {
  const provision = spawnSync(process.execPath, ['scripts/create-admin.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      ADMIN_EMAIL: 'first-admin@example.test',
      ADMIN_PASSWORD: 'Test-only-admin-password-123',
    },
    encoding: 'utf8',
  });
  assert.equal(provision.status, 0, `${provision.stdout}\n${provision.stderr}`);
  assert.match(provision.stdout, /Initial superadministrator account created/);
  db = require('../src/db');

  const legacyProgram = await db.get(
    "SELECT name FROM programs_legacy WHERE code = 'LEGACY-01'",
  );
  const legacyIntake = await db.get(
    "SELECT name FROM intakes_legacy WHERE name = 'Legacy intake'",
  );
  assert.equal(legacyProgram.name, 'Legacy programme');
  assert.equal(legacyIntake.name, 'Legacy intake');

  const legacyApplication = await db.get(`
    SELECT application.id, program.name AS program_name, intake.name AS intake_name
    FROM applications AS application
    JOIN programs_legacy AS program ON program.id = application.programme_id
    JOIN intakes_legacy AS intake ON intake.id = application.intake_id
    WHERE application.id = 1
  `);
  assert.deepEqual(legacyApplication, {
    id: 1,
    program_name: 'Legacy programme',
    intake_name: 'Legacy intake',
  });

  const programCount = await db.get('SELECT COUNT(*) AS count FROM programs');
  const intakeCount = await db.get('SELECT COUNT(*) AS count FROM intakes');
  const availabilityCount = await db.get('SELECT COUNT(*) AS count FROM program_intakes');
  assert.equal(programCount.count, 32);
  assert.equal(intakeCount.count, 2);
  assert.equal(availabilityCount.count, 64);
  const admin = await db.get(
    'SELECT email, role FROM admin_users WHERE email = ?',
    ['first-admin@example.test'],
  );
  assert.deepEqual(admin, { email: 'first-admin@example.test', role: 'superadmin' });

  await db.migrate();
  const repeatedMigrationCount = await db.get('SELECT COUNT(*) AS count FROM programs');
  assert.equal(repeatedMigrationCount.count, 32);
});
