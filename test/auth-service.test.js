'use strict';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaims-auth-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test-auth.db');
process.env.NODE_ENV = 'test';
process.env.BCRYPT_ROUNDS = '4';

const db = require('../src/db');
const { createPasswordReset } = require('../src/services/otp');
const { resetPassword, AppError } = require('../src/services/auth-service');

let testApplicantId;

describe('auth service password reset', () => {
  before(async () => {
    await db.migrate();
  });

  after(async () => {
    await db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await db.run('DELETE FROM password_resets');
    await db.run('DELETE FROM applicants');
    const oldPasswordHash = await bcrypt.hash('Old-password-123', 4);
    const result = await db.run(
      `INSERT INTO applicants
        (surname, other_names, email, phone, phone_country_code, nationality, date_of_birth, sex, password_hash, failed_login_attempts, locked_until)
       VALUES ('Test', 'User', 'test@example.com', '+256700000000', '+256', 'Kenyan', '1990-01-01', 'MALE', ?, 5, '2099-01-01T00:00:00.000Z')`,
      [oldPasswordHash],
    );
    testApplicantId = result.id;
  });

  test('updates the password, clears login lock state, and consumes the reset token', async () => {
    const token = await createPasswordReset(testApplicantId);

    await resetPassword(token, 'New-password-456');

    const applicant = await db.get('SELECT password_hash, failed_login_attempts, locked_until FROM applicants WHERE id = ?', [testApplicantId]);
    assert.equal(await bcrypt.compare('New-password-456', applicant.password_hash), true);
    assert.equal(await bcrypt.compare('Old-password-123', applicant.password_hash), false);
    assert.equal(applicant.failed_login_attempts, 0);
    assert.equal(applicant.locked_until, null);
    await assert.rejects(
      resetPassword(token, 'Another-password-789'),
      (error) => error instanceof AppError && error.code === 'INVALID_RESET_TOKEN',
    );
  });
});
