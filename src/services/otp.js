const config = require('../config');
const db = require('../db');
const { randomOtp, randomToken, hashToken, safeEqual } = require('../security');

function nowIso() {
  return new Date().toISOString();
}

function expiresIso(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function createOtp(applicantId, purpose) {
  let code;
  await db.transaction(async () => {
    code = randomOtp(config.otpLength);
    await db.run('UPDATE otps SET used = 1 WHERE applicant_id = ? AND purpose = ? AND used = 0', [applicantId, purpose]);
    await db.run(
      'INSERT INTO otps (applicant_id, code, purpose, expires_at) VALUES (?, ?, ?, ?)',
      [applicantId, hashToken(code), purpose, expiresIso(config.otpExpiryMinutes)],
    );
  });
  return code;
}

async function verifyOtp(applicantId, code, purpose) {
  let verification;
  await db.transaction(async () => {
    const row = await db.get(
      `SELECT id, code, attempts, expires_at FROM otps
       WHERE applicant_id = ? AND purpose = ? AND used = 0
       ORDER BY id DESC LIMIT 1`,
      [applicantId, purpose],
    );
    if (!row) {
      verification = { valid: false, reason: 'NO_CODE' };
      return;
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await db.run('UPDATE otps SET used = 1 WHERE id = ?', [row.id]);
      verification = { valid: false, reason: 'EXPIRED' };
      return;
    }
    if (!safeEqual(row.code, hashToken(code))) {
      const attempts = row.attempts + 1;
      await db.run('UPDATE otps SET attempts = ? WHERE id = ?', [attempts, row.id]);
      if (attempts >= config.otpMaxAttempts) await db.run('UPDATE otps SET used = 1 WHERE id = ?', [row.id]);
      verification = { valid: false, reason: 'INVALID_CODE' };
      return;
    }
    await db.run('UPDATE otps SET used = 1 WHERE id = ? AND used = 0', [row.id]);
    verification = { valid: true };
  });
  return verification;
}

async function createPasswordReset(applicantId) {
  let token;
  await db.transaction(async () => {
    token = randomToken(32);
    await db.run('UPDATE password_resets SET used = 1 WHERE applicant_id = ? AND used = 0', [applicantId]);
    await db.run(
      'INSERT INTO password_resets (applicant_id, token, expires_at) VALUES (?, ?, ?)',
      [applicantId, hashToken(token), expiresIso(30)],
    );
  });
  return token;
}

async function consumePasswordReset(token) {
  let applicantId = null;
  await db.transaction(async () => {
    const row = await db.get(
      'SELECT id, applicant_id, expires_at FROM password_resets WHERE token = ? AND used = 0',
      [hashToken(token)],
    );
    if (!row) return;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await db.run('UPDATE password_resets SET used = 1 WHERE id = ?', [row.id]);
      return;
    }
    await db.run('UPDATE password_resets SET used = 1 WHERE id = ? AND used = 0', [row.id]);
    applicantId = row.applicant_id;
  });
  return applicantId;
}

module.exports = { createOtp, verifyOtp, createPasswordReset, consumePasswordReset };
