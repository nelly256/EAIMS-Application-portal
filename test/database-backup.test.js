'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaims-backup-test-'));
const sourcePath = path.join(tmpDir, 'source.db');
const backupDir = path.join(tmpDir, 'backups');

function createSourceDatabase() {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(sourcePath, (openError) => {
      if (openError) return reject(openError);
      database.exec(
        'CREATE TABLE backup_sample (value TEXT); INSERT INTO backup_sample VALUES (\'intact\');',
        (schemaError) => {
          if (schemaError) return reject(schemaError);
          database.close((closeError) => (closeError ? reject(closeError) : resolve()));
        },
      );
    });
  });
}

test('database backup command creates and verifies a consistent SQLite backup', async () => {
  try {
    await createSourceDatabase();
    const env = {
      ...process.env,
      DB_PATH: sourcePath,
      DB_BACKUP_DIR: backupDir,
    };
    const output = execFileSync(
      process.execPath,
      [path.join(__dirname, '..', 'scripts', 'backup-database.js')],
      { encoding: 'utf8', env },
    );
    const match = output.match(/Verified database backup created: (.+)\r?\n/);
    assert.ok(match, output);

    const backupPath = match[1];
    assert.equal(fs.existsSync(backupPath), true);
    const verificationOutput = execFileSync(
      process.execPath,
      [path.join(__dirname, '..', 'scripts', 'verify-database-backup.js'), backupPath],
      { encoding: 'utf8', env },
    );
    assert.match(verificationOutput, /integrity check passed/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
