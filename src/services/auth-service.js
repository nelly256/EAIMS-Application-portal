const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../db');
const { normalizeIdentifier } = require('../validation');
const { createOtp, createPasswordReset, consumePasswordReset } = require('./otp');
const { sendVerification, sendPasswordReset } = require('./notifications');

class AppError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

async function registerApplicant(input) {
  const existing = await db.get(
    'SELECT email, phone FROM applicants WHERE lower(email) = ? OR phone = ?',
    [input.email, input.phone],
  );
  if (existing) {
    const fields = {};
    if (existing.email && existing.email.toLowerCase() === input.email) fields.email = 'An account already exists for this email address.';
    if (existing.phone === input.phone) fields.phoneNumber = 'An account already exists for this phone number.';
    throw new AppError(409, 'ACCOUNT_EXISTS', 'An account already exists with the provided details.', fields);
  }

  const passwordHash = await bcrypt.hash(input.password, config.bcryptRounds);
  let result;
  try {
    result = await db.run(
      `INSERT INTO applicants
        (surname, other_names, email, phone, phone_country_code, nationality, date_of_birth, sex, password_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.surname,
        input.otherNames,
        input.email,
        input.phone,
        input.phoneCountryCode,
        input.nationality,
        input.dateOfBirth,
        input.sex,
        passwordHash,
      ],
    );
  } catch (error) {
    if (String(error.code).includes('SQLITE_CONSTRAINT')) {
      throw new AppError(409, 'ACCOUNT_EXISTS', 'An account already exists with the provided details.');
    }
    throw error;
  }

  const code = await createOtp(result.id, 'account_verification');
  const delivery = await sendVerification({ email: input.email, phone: input.phone, surname: input.surname, otherNames: input.otherNames }, code);
  return {
    applicantId: result.id,
    delivery,
    deliveryAvailable: Boolean(delivery.email.sent || delivery.sms.sent),
  };
}

async function findApplicant(identifier) {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized.value) return null;
  if (normalized.type === 'email') {
    return db.get('SELECT * FROM applicants WHERE lower(email) = ?', [normalized.value]);
  }
  return db.get('SELECT * FROM applicants WHERE phone = ?', [normalized.value]);
}

async function loginApplicant(identifier, password) {
  const applicant = await findApplicant(identifier);
  const now = Date.now();
  if (!applicant || !applicant.is_active) throw new AppError(401, 'INVALID_CREDENTIALS', 'The email/phone or password is incorrect.');
  if (applicant.locked_until && new Date(applicant.locked_until).getTime() > now) {
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.');
  }
  const matches = await bcrypt.compare(password, applicant.password_hash);
  if (!matches) {
    const attempts = applicant.failed_login_attempts + 1;
    const lockedUntil = attempts >= 5 ? new Date(now + 15 * 60 * 1000).toISOString() : null;
    await db.run(
      'UPDATE applicants SET failed_login_attempts = ?, locked_until = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [attempts, lockedUntil, applicant.id],
    );
    throw new AppError(401, 'INVALID_CREDENTIALS', 'The email/phone or password is incorrect.');
  }
  await db.run(
    'UPDATE applicants SET failed_login_attempts = 0, locked_until = NULL, updated_at = datetime(\'now\') WHERE id = ?',
    [applicant.id],
  );
  return applicant;
}

async function verifyApplicant(applicantId) {
  const applicant = await db.get('SELECT id FROM applicants WHERE id = ? AND is_active = 1', [applicantId]);
  if (!applicant) throw new AppError(404, 'APPLICANT_NOT_FOUND', 'Applicant account was not found.');
  await db.run('UPDATE applicants SET is_verified = 1, updated_at = datetime(\'now\') WHERE id = ?', [applicantId]);
}

async function requestPasswordReset(identifier) {
  const applicant = await findApplicant(identifier);
  if (!applicant || !applicant.is_active) return { sent: false };
  const token = await createPasswordReset(applicant.id);
  const resetUrl = `${config.appBaseUrl}/reset-password.html?token=${encodeURIComponent(token)}`;
  const delivery = await sendPasswordReset(applicant, resetUrl);
  return { sent: Boolean(delivery.email.sent || delivery.sms.sent), delivery, resetUrl };
}

async function resetPassword(token, password) {
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  const applicantId = await consumePasswordReset(token);
  if (!applicantId) throw new AppError(400, 'INVALID_RESET_TOKEN', 'This password reset link is invalid or has expired.');
  await db.run(
    'UPDATE applicants SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = datetime(\'now\') WHERE id = ?',
    [passwordHash, applicantId],
  );
}

async function getApplicant(applicantId) {
  return db.get('SELECT * FROM applicants WHERE id = ? AND is_active = 1', [applicantId]);
}

module.exports = {
  AppError,
  registerApplicant,
  findApplicant,
  loginApplicant,
  verifyApplicant,
  requestPasswordReset,
  resetPassword,
  getApplicant,
};
