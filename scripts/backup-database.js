'use strict';

require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const sqlite3 = require('sqlite3');

function openDatabase(filename, mode) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filename, mode, (error) => {
      if (error) return reject(error);
      return resolve(database);
    });
  });
}

function closeDatabase(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => (error ? reject(error) : resolve()));
  });
}

function runBackup(database, destination) {
  return new Promise((resolve, reject) => {
    const backup = database.backup(destination);
    const finish = (stepError) => {
      backup.finish(() => (stepError ? reject(stepError) : resolve()));
    };
    const step = () => {
      backup.step(-1, (error, completed) => {
        if (error) return finish(error);
        if (completed) return finish();
        return setImmediate(step);
      });
    };
    step();
  });
}

async function assertDatabaseIntegrity(filename) {
  const database = await openDatabase(filename, sqlite3.OPEN_READONLY);
  try {
    const result = await new Promise((resolve, reject) => {
      database.get('PRAGMA integrity_check', (error, row) => (error ? reject(error) : resolve(row)));
    });
    if (!result || result.integrity_check !== 'ok') {
      throw new Error(`SQLite integrity check failed for ${filename}.`);
    }
  } finally {
    await closeDatabase(database);
  }
}

async function main() {
  const databasePath = path.resolve(
    process.env.DB_PATH || path.join(__dirname, '..', 'data', 'eaims.db'),
  );
  const backupDirectory = path.resolve(
    process.env.DB_BACKUP_DIR || path.join(path.dirname(databasePath), 'backups'),
  );

  let sourceStats;
  try {
    sourceStats = await fs.stat(databasePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Database file does not exist: ${databasePath}`);
    }
    throw error;
  }
  if (!sourceStats.isFile()) throw new Error(`Database path is not a file: ${databasePath}`);

  await fs.mkdir(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDirectory, `eaims-${timestamp}-${process.pid}.sqlite`);
  const source = await openDatabase(databasePath, sqlite3.OPEN_READONLY);

  try {
    await runBackup(source, backupPath);
  } catch (error) {
    try {
      await fs.rm(backupPath, { force: true });
    } catch (cleanupError) {
      console.error(`Unable to remove incomplete backup ${backupPath}: ${cleanupError.message}`);
    }
    throw error;
  } finally {
    await closeDatabase(source);
  }

  await assertDatabaseIntegrity(backupPath);
  console.log(`Verified database backup created: ${backupPath}`);
}

main().catch((error) => {
  console.error(`Database backup failed: ${error.message}`);
  process.exitCode = 1;
});
