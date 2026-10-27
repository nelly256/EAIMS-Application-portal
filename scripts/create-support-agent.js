'use strict';

const validator = require('validator');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const db = require('../src/db');

async function main() {
  const email = (process.env.SUPPORT_AGENT_EMAIL || '').trim().toLowerCase();
  const password = process.env.SUPPORT_AGENT_PASSWORD || '';
  if (!validator.isEmail(email) || email.length > 254) {
    throw new Error('Set SUPPORT_AGENT_EMAIL to a valid email address.');
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error('Set SUPPORT_AGENT_PASSWORD to a password between 12 and 128 characters.');
  }

  await db.migrate();
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  await db.run(
    `INSERT INTO support_agents (email, password_hash)
     VALUES (?, ?)
     ON CONFLICT(email) DO UPDATE SET
       password_hash = excluded.password_hash,
       is_active = 1`,
    [email, passwordHash],
  );
  console.log(`Support agent account is ready for ${email}.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
