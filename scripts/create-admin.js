'use strict';

const validator = require('validator');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const db = require('../src/db');

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!validator.isEmail(email) || email.length > 254) {
    throw new Error('Set ADMIN_EMAIL to a valid email address.');
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error('Set ADMIN_PASSWORD to a password between 12 and 128 characters.');
  }

  await db.migrate();
  const existing = await db.get('SELECT COUNT(*) AS count FROM admin_users');
  if (existing.count) {
    throw new Error('An administrator account already exists. Provision additional staff from the admin portal.');
  }
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  await db.run(
    'INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, ?)',
    [email, passwordHash, 'superadmin'],
  );
  console.log(`Initial superadministrator account created for ${email}.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
