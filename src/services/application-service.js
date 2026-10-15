'use strict';

const db = require('../db');
const { COUNTRY_CODES, validDate, validName } = require('../validation');
const programCatalog = require('./program-catalog');

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_APPLICATION_DOCUMENT_BYTES = 10 * 1024 * 1024;
const APPLICATION_DOCUMENT_CATEGORIES = ['transcript', 'identity', 'additional'];
const APPLICATION_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const FIELD_COLUMNS = {
  firstName: 'first_name',
  lastName: 'last_name',
  idNumber: 'id_number',
  countryOfBirth: 'country_of_birth',
  dateOfBirth: 'date_of_birth',
  gender: 'gender',
  physicalAddress: 'physical_address',
  nextOfKinName: 'next_of_kin_name',
  nextOfKinContact: 'next_of_kin_contact',
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
  if (field === 'nextOfKinName') {
    return validName(cleaned) ? '' : 'Enter a valid next-of-kin name.';
  }
  if (field === 'nextOfKinContact') {
    const digits = cleaned.replace(/\D/g, '');
    return /^\+?[0-9][0-9\s().-]*$/.test(cleaned) && digits.length >= 7 && digits.length <= 15
      ? ''
      : 'Enter a valid contact number with 7 to 15 digits.';
  }
  return 'This field cannot be saved.';
}

async function getApplicationProfile(applicantId) {
  return db.get(
    `SELECT first_name, last_name, id_number, country_of_birth, date_of_birth, gender,
          physical_address, next_of_kin_name, next_of_kin_contact,
          passport_photo_mime, updated_at,
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

function documentUploadError(message, field = 'document') {
  return new ApplicationError(400, 'INVALID_DOCUMENT', message, { [field]: message });
}

function hasValidDocumentSignature(buffer, mimeType) {
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }
  return false;
}

function cleanDocumentFileName(value) {
  const fileName = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!fileName || fileName.length > 255) {
    throw documentUploadError('Choose a file with a valid name.', 'file');
  }
  return fileName;
}

async function listApplicationDocuments(applicantId) {
  return db.all(
    `SELECT id, category, original_name, mime_type, file_size, created_at
     FROM application_documents
     WHERE applicant_id = ?
     ORDER BY created_at, id`,
    [applicantId],
  );
}

async function saveApplicationDocument(applicantId, category, buffer, mimeType, originalName) {
  if (!APPLICATION_DOCUMENT_CATEGORIES.includes(category)) {
    throw documentUploadError('Choose a supported document category.', 'category');
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw documentUploadError('Choose a file to upload.', 'file');
  }
  if (buffer.length > MAX_APPLICATION_DOCUMENT_BYTES) {
    throw documentUploadError('Choose a document smaller than 10 MB.', 'file');
  }
  if (!APPLICATION_DOCUMENT_MIME_TYPES.includes(mimeType) || !hasValidDocumentSignature(buffer, mimeType)) {
    throw documentUploadError('Upload a valid PDF, JPEG, or PNG document.', 'file');
  }

  const fileName = cleanDocumentFileName(originalName);
  return db.transaction(async () => {
    if (category === 'identity') {
      await db.run(
        'DELETE FROM application_documents WHERE applicant_id = ? AND category = ?',
        [applicantId, category],
      );
    }
    const result = await db.run(
      `INSERT INTO application_documents
       (applicant_id, category, original_name, mime_type, file_size, file_data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [applicantId, category, fileName, mimeType, buffer.length, buffer],
    );
    return db.get(
      `SELECT id, category, original_name, mime_type, file_size, created_at
       FROM application_documents WHERE id = ? AND applicant_id = ?`,
      [result.id, applicantId],
    );
  });
}

async function getApplicationDocument(applicantId, documentId) {
  return db.get(
    `SELECT id, category, original_name, mime_type, file_size, file_data, created_at
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

async function getProgramSelection(applicantId) {
  const selection = await db.get(
    `SELECT program_id, intake, updated_at
     FROM application_program_selections
     WHERE applicant_id = ?`,
    [applicantId],
  );
  if (!selection) return undefined;
  const program = programCatalog.getProgram(selection.program_id);
  if (!program) return undefined;
  return { ...program, intake: selection.intake || '', updatedAt: selection.updated_at };
}

async function saveProgramSelection(applicantId, updates) {
  const fields = Object.keys(updates || {});
  if (fields.length !== 2 || !fields.includes('programId') || !fields.includes('intake')) {
    throw new ApplicationError(400, 'INVALID_PROGRAM_SELECTION', 'Choose one program and one intake to save.', {
      programId: 'Choose one program from the list.',
      intake: 'Choose an intake from the list.',
    });
  }

  const programId = clean(updates.programId);
  const program = programCatalog.getProgram(programId);
  if (!program) {
    throw new ApplicationError(400, 'INVALID_PROGRAM_SELECTION', 'Choose a program from the list.', {
      programId: 'Choose a program from the list.',
    });
  }
  const intake = clean(updates.intake);
  if (!programCatalog.isIntake(intake)) {
    throw new ApplicationError(400, 'INVALID_PROGRAM_SELECTION', 'Choose an intake from the list.', {
      intake: 'Choose March or August.',
    });
  }

  const profile = await getApplicationProfile(applicantId);
  const requiredProfileFields = {
    first_name: 'firstName',
    last_name: 'lastName',
    id_number: 'idNumber',
    country_of_birth: 'countryOfBirth',
    date_of_birth: 'dateOfBirth',
    gender: 'gender',
    physical_address: 'physicalAddress',
    next_of_kin_name: 'nextOfKinName',
    next_of_kin_contact: 'nextOfKinContact',
  };
  const incompleteFields = Object.entries(requiredProfileFields)
    .filter(([column]) => !profile || !String(profile[column] || '').trim())
    .map(([, field]) => field);
  if (incompleteFields.length) {
    const errors = Object.fromEntries(incompleteFields.map((field) => [field, 'Complete this field before selecting a program.']));
    throw new ApplicationError(409, 'APPLICATION_PROFILE_INCOMPLETE', 'Complete your personal information before selecting a program.', errors);
  }

  await db.run(
    `INSERT INTO application_program_selections (applicant_id, program_id, intake)
     VALUES (?, ?, ?)
     ON CONFLICT(applicant_id) DO UPDATE SET
       program_id = excluded.program_id,
       intake = excluded.intake,
       updated_at = datetime('now')`,
    [applicantId, program.id, intake],
  );
  return getProgramSelection(applicantId);
}

module.exports = {
  ApplicationError,
  MAX_PHOTO_BYTES,
  MAX_APPLICATION_DOCUMENT_BYTES,
  APPLICATION_DOCUMENT_CATEGORIES,
  APPLICATION_DOCUMENT_MIME_TYPES,
  getApplicationProfile,
  saveApplicationProfile,
  savePassportPhoto,
  getPassportPhoto,
  listApplicationDocuments,
  saveApplicationDocument,
  getApplicationDocument,
  deleteApplicationDocument,
  getPrograms: programCatalog.getPrograms,
  getIntakes: programCatalog.getIntakes,
  getProgramSelection,
  saveProgramSelection,
};