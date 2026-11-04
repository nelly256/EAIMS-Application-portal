'use strict';

require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const sqlite3 = require('sqlite3');

async function main() {
  const backupPath = process.argv[2];
  if (!backupPath) {
    throw new Error('Usage: npm run db:verify-backup -- <backup-file>');
  }

  const filename = path.resolve(backupPath);
  const stats = await fs.stat(filename);
  if (!stats.isFile()) throw new Error(`Backup path is not a file: ${filename}`);

  const database = await new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(filename, sqlite3.OPEN_READONLY, (error) => {
      if (error) return reject(error);
      return resolve(connection);
    });
  });

  try {
    const result = await new Promise((resolve, reject) => {
      database.get('PRAGMA integrity_check', (error, row) => (error ? reject(error) : resolve(row)));
    });
    if (!result || result.integrity_check !== 'ok') {
      throw new Error(`SQLite integrity check failed for ${filename}.`);
    }
    console.log(`Database backup integrity check passed: ${filename}`);
  } finally {
    await new Promise((resolve, reject) => {
      database.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

main().catch((error) => {
  console.error(`Database backup verification failed: ${error.message}`);
  process.exitCode = 1;
});
