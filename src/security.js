const crypto = require('crypto');

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function randomOtp(length) {
  const maximum = 10 ** length;
  return String(crypto.randomInt(0, maximum)).padStart(length, '0');
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function publicApplicant(applicant) {
  if (!applicant) return null;
  return {
    surname: applicant.surname,
    otherNames: applicant.other_names,
    email: applicant.email,
    phone: applicant.phone,
    phoneCountryCode: applicant.phone_country_code,
    nationality: applicant.nationality,
    dateOfBirth: applicant.date_of_birth,
    sex: applicant.sex,
    isVerified: Boolean(applicant.is_verified),
    createdAt: applicant.created_at,
  };
}

module.exports = { randomToken, randomOtp, hashToken, safeEqual, publicApplicant };
