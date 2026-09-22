'use strict';

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaims-otp-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test-otp.db');
process.env.NODE_ENV = 'test';

const db = require('../src/db');
const { createOtp, verifyOtp, createPasswordReset, consumePasswordReset } = require('../src/services/otp');

let testApplicantId;

describe('OTP service', () => {
  before(async () => {
    await db.migrate();
  });

  after(async () => {
    await db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await db.run('DELETE FROM otps');
    await db.run('DELETE FROM password_resets');
    await db.run('DELETE FROM applicants');
    const result = await db.run(
      `INSERT INTO applicants
        (surname, other_names, email, phone, phone_country_code, nationality, date_of_birth, sex, password_hash, is_verified, is_active)
       VALUES ('Test', 'User', 'test@example.com', '+256700000000', '+256', 'Kenyan', '1990-01-01', 'MALE', 'hash', 0, 1)`,
    );
    testApplicantId = result.id;
  });

  afterEach(async () => {
    await db.run('DELETE FROM otps');
    await db.run('DELETE FROM password_resets');
    await db.run('DELETE FROM applicants');
  });

  test('createOtp generates a numeric code of configured length', async () => {
    const code = await createOtp(testApplicantId, 'account_verification');
    assert.match(code, /^\d{6}$/);
  });

  test('createOtp invalidates previous unused codes for the same purpose', async () => {
    await createOtp(testApplicantId, 'account_verification');
    await createOtp(testApplicantId, 'account_verification');
    const active = await db.get(
      'SELECT COUNT(*) AS count FROM otps WHERE applicant_id = ? AND purpose = ? AND used = 0',
      [testApplicantId, 'account_verification'],
    );
    assert.equal(active.count, 1);
  });

  test('createOtp keeps separate purposes independent', async () => {
    await createOtp(testApplicantId, 'account_verification');
    await createOtp(testApplicantId, 'password_reset');
    const verification = await db.get(
      'SELECT COUNT(*) AS count FROM otps WHERE applicant_id = ? AND purpose = ? AND used = 0',
      [testApplicantId, 'account_verification'],
    );
    const reset = await db.get(
      'SELECT COUNT(*) AS count FROM otps WHERE applicant_id = ? AND purpose = ? AND used = 0',
      [testApplicantId, 'password_reset'],
    );
    assert.equal(verification.count, 1);
    assert.equal(reset.count, 1);
  });

  test('verifyOtp accepts a valid code and marks it used', async () => {
    const code = await createOtp(testApplicantId, 'account_verification');
    const result = await verifyOtp(testApplicantId, code, 'account_verification');
    assert.equal(result.valid, true);

    const active = await db.get(
      'SELECT COUNT(*) AS count FROM otps WHERE applicant_id = ? AND purpose = ? AND used = 0',
      [testApplicantId, 'account_verification'],
    );
    assert.equal(active.count, 0);
  });

  test('verifyOtp rejects an invalid code', async () => {
    await createOtp(testApplicantId, 'account_verification');
    const result = await verifyOtp(testApplicantId, '000000', 'account_verification');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'INVALID_CODE');
  });

  test('verifyOtp rejects an expired code', async () => {
    const code = await createOtp(testApplicantId, 'account_verification');
    await db.run(
      'UPDATE otps SET expires_at = ? WHERE applicant_id = ? AND purpose = ? AND used = 0',
      [new Date(Date.now() - 60000).toISOString(), testApplicantId, 'account_verification'],
    );
    const result = await verifyOtp(testApplicantId, code, 'account_verification');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'EXPIRED');
  });

  test('verifyOtp rejects when no code exists', async () => {
    const result = await verifyOtp(testApplicantId, '123456', 'account_verification');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'NO_CODE');
  });

  test('verifyOtp does not double-use a consumed code', async () => {
    const code = await createOtp(testApplicantId, 'account_verification');
    await verifyOtp(testApplicantId, code, 'account_verification');
    const secondAttempt = await verifyOtp(testApplicantId, code, 'account_verification');
    assert.equal(secondAttempt.valid, false);
    assert.equal(secondAttempt.reason, 'NO_CODE');
  });

  test('createPasswordReset generates a non-empty token', async () => {
    const token = await createPasswordReset(testApplicantId);
    assert.ok(token.length > 0);
  });

  test('consumePasswordReset accepts a valid token', async () => {
    const token = await createPasswordReset(testApplicantId);
    const consumedId = await consumePasswordReset(token);
    assert.equal(consumedId, testApplicantId);
  });

  test('consumePasswordReset invalidates the token after use', async () => {
    const token = await createPasswordReset(testApplicantId);
    await consumePasswordReset(token);
    const second = await consumePasswordReset(token);
    assert.equal(second, null);
  });

  test('consumePasswordReset rejects an invalid token', async () => {
    const result = await consumePasswordReset('invalid-token-that-does-not-exist');
    assert.equal(result, null);
  });

  test('consumePasswordReset rejects an expired token', async () => {
    const token = await createPasswordReset(testApplicantId);
    await db.run(
      'UPDATE password_resets SET expires_at = ? WHERE token LIKE ?',
      [new Date(Date.now() - 60000).toISOString(), '%'],
    );
    const result = await consumePasswordReset(token);
    assert.equal(result, null);
  });
});
