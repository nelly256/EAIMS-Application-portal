'use strict';

const db = require('../db');
const { COUNTRY_CODES, validDate, validName } = require('../validation');

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const FIELD_COLUMNS = {
  firstName: 'first_name',
  lastName: 'last_name',
  idNumber: 'id_number',
  countryOfBirth: 'country_of_birth',
  dateOfBirth: 'date_of_birth',
  gender: 'gender',
  physicalAddress: 'physical_address',
};

class ApplicationError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function clean(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

function validateField(field, value) {
  const cleaned = clean(value);
  if (cleaned.length > 500) return 'This field is too long.';
  if (!cleaned) return '';

  if (field === 'firstName' || field === 'lastName') {
    return validName(cleaned) ? '' : 'Enter a valid name.';
  }
  if (field === 'idNumber') {
    return /^[a-zA-Z0-9][a-zA-Z0-9 /-]{1,38}[a-zA-Z0-9]$/.test(cleaned)
      ? ''
      : 'Enter a valid national ID or passport number.';
  }
  if (field === 'countryOfBirth') {
    return COUNTRY_CODES.some((country) => country.name === cleaned) ? '' : 'Select a country from the list.';
  }
  if (field === 'dateOfBirth') {
    return validDate(cleaned) ? '' : 'Applicants must be at least 16 years old.';
  }
  if (field === 'gender') {
    return ['MALE', 'FEMALE'].includes(cleaned.toUpperCase()) ? '' : 'Select male or female.';
  }
  if (field === 'physicalAddress') {
    return cleaned.length >= 5 ? '' : 'Enter a complete physical address.';
  }
  return 'This field cannot be saved.';
}

async function getApplicationProfile(applicantId) {
  return db.get(
    `SELECT first_name, last_name, id_number, country_of_birth, date_of_birth, gender,
          physical_address, passport_photo_mime, updated_at,
            CASE WHEN passport_photo IS NULL THEN 0 ELSE 1 END AS has_passport_photo
     FROM application_profiles WHERE applicant_id = ?`,
    [applicantId],
  );
}

async function saveApplicationProfile(applicantId, updates) {
  const fields = Object.keys(updates || {});
  if (!fields.length || fields.some((field) => !Object.hasOwn(FIELD_COLUMNS, field))) {
    throw new ApplicationError(400, 'INVALID_PROFILE_FIELD', 'Choose a profile field to save.');
  }

  const values = {};
  const errors = {};
  for (const field of fields) {
    values[field] = clean(updates[field]);
    const error = validateField(field, values[field]);
    if (error) errors[field] = error;
  }
  if (Object.keys(errors).length) {
    throw new ApplicationError(400, 'VALIDATION_ERROR', 'Check the highlighted fields and try again.', errors);
  }

  await db.run('INSERT INTO application_profiles (applicant_id) VALUES (?) ON CONFLICT(applicant_id) DO NOTHING', [applicantId]);
  for (const field of fields) {
    await db.run(
      `UPDATE application_profiles SET ${FIELD_COLUMNS[field]} = ?, updated_at = datetime('now') WHERE applicant_id = ?`,
      [values[field], applicantId],
    );
  }
  return getApplicationProfile(applicantId);
}

function photoFormatError(message) {
  return new ApplicationError(400, 'INVALID_PHOTO', message, { passportPhoto: message });
}

async function savePassportPhoto(applicantId, buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw photoFormatError('Choose a photo to upload.');
  if (buffer.length > MAX_PHOTO_BYTES) throw photoFormatError('Choose a photo smaller than 5 MB.');

  const isJpeg = mimeType === 'image/jpeg'
    && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = mimeType === 'image/png'
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isJpeg && !isPng) throw photoFormatError('Upload a valid JPEG or PNG image.');

  await db.run('INSERT INTO application_profiles (applicant_id) VALUES (?) ON CONFLICT(applicant_id) DO NOTHING', [applicantId]);
  await db.run(
    `UPDATE application_profiles
     SET passport_photo = ?, passport_photo_mime = ?, updated_at = datetime('now')
     WHERE applicant_id = ?`,
    [buffer, mimeType, applicantId],
  );
  return getApplicationProfile(applicantId);
}

async function getPassportPhoto(applicantId) {
  return db.get(
    'SELECT passport_photo, passport_photo_mime FROM application_profiles WHERE applicant_id = ? AND passport_photo IS NOT NULL',
    [applicantId],
  );
}

function documentFormatError(message) {
  return new ApplicationError(400, 'INVALID_DOCUMENT', message, { document: message });
}

function cleanDocumentFilename(filename) {
  return String(filename || '')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 180);
}

async function listApplicationDocuments(applicantId) {
  return db.all(
    `SELECT id, filename, mime_type, length(data) AS size, created_at
     FROM application_documents WHERE applicant_id = ? ORDER BY created_at DESC, id DESC`,
    [applicantId],
  );
}

async function saveApplicationDocument(applicantId, filename, buffer, mimeType) {
  const safeFilename = cleanDocumentFilename(filename);
  if (!safeFilename) throw documentFormatError('Choose a document with a valid filename.');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw documentFormatError('Choose a document to upload.');
  if (buffer.length > MAX_DOCUMENT_BYTES) throw documentFormatError('Choose a document smaller than 10 MB.');
  if (!DOCUMENT_MIME_TYPES.includes(mimeType)) {
    throw documentFormatError('Upload a PDF, JPEG, or PNG document.');
  }

  const validSignature = mimeType === 'application/pdf'
    ? buffer.subarray(0, 5).toString('ascii') === '%PDF-'
    : mimeType === 'image/jpeg'
      ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!validSignature) throw documentFormatError('The document content does not match its file type.');

  const result = await db.run(
    `INSERT INTO application_documents (applicant_id, filename, mime_type, data)
     VALUES (?, ?, ?, ?)`,
    [applicantId, safeFilename, mimeType, buffer],
  );
  return db.get(
    `SELECT id, filename, mime_type, length(data) AS size, created_at
     FROM application_documents WHERE id = ? AND applicant_id = ?`,
    [result.id, applicantId],
  );
}

async function getApplicationDocument(applicantId, documentId) {
  return db.get(
    `SELECT id, filename, mime_type, data, created_at
     FROM application_documents WHERE id = ? AND applicant_id = ?`,
    [documentId, applicantId],
  );
}

async function deleteApplicationDocument(applicantId, documentId) {
  const result = await db.run(
    'DELETE FROM application_documents WHERE id = ? AND applicant_id = ?',
    [documentId, applicantId],
  );
  return result.changes > 0;
}

module.exports = {
  ApplicationError,
  MAX_PHOTO_BYTES,
  MAX_DOCUMENT_BYTES,
  getApplicationProfile,
  saveApplicationProfile,
  savePassportPhoto,
  getPassportPhoto,
  listApplicationDocuments,
  saveApplicationDocument,
  getApplicationDocument,
  deleteApplicationDocument,
};