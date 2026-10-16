'use strict';

const db = require('../db');
const { COUNTRY_CODES, validDate, validName } = require('../validation');
const programCatalog = require('./program-catalog');

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_APPLICATION_DOCUMENT_BYTES = 10 * 1024 * 1024;
const APPLICATION_DOCUMENT_CATEGORIES = ['transcript', 'identity', 'additional'];
const APPLICATION_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const TRAINING_ARRANGEMENTS = ['Weekday', 'Weekend', 'Online', 'By Correspondence'];
const TRAINING_ARRANGEMENTS_BY_LEVEL = {
  'Short courses': 'Online',
  Certificate: 'Weekday',
  Diploma: 'Weekend',
};
const EMPLOYMENT_HISTORY_LIMIT = 4;
const COURSE_REASON_MAX_LENGTH = 4000;
const APPLICATION_STATUSES = ['submitted', 'in_review', 'approved', 'admitted'];
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
  trainingArrangements: 'training_arrangements',
  employmentHistory: 'employment_history',
  courseReason: 'course_reason',
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

function normalizeProfileField(field, value) {
  if (field === 'trainingArrangements') {
    if (!Array.isArray(value) || value.length > TRAINING_ARRANGEMENTS.length
      || value.some((item) => typeof item !== 'string')) {
      return { error: 'Choose valid training arrangements.' };
    }
    const selected = value.map(clean);
    if (new Set(selected).size !== selected.length
      || selected.some((item) => !TRAINING_ARRANGEMENTS.includes(item))) {
      return { error: 'Choose valid training arrangements.' };
    }
    return {
      value: JSON.stringify(TRAINING_ARRANGEMENTS.filter((item) => selected.includes(item))),
      error: '',
    };
  }

  if (field === 'employmentHistory') {
    if (!Array.isArray(value) || value.length > EMPLOYMENT_HISTORY_LIMIT) {
      return { error: `Enter no more than ${EMPLOYMENT_HISTORY_LIMIT} employment records.` };
    }
    const records = [];
    const allowedKeys = ['position', 'organization', 'fromYear', 'toYear'];
    const currentYear = new Date().getFullYear();
    const validYear = (year) => /^\d{4}$/.test(year)
      && Number(year) >= 1900
      && Number(year) <= currentYear;

    for (const record of value) {
      if (!record || typeof record !== 'object' || Array.isArray(record)
        || Object.keys(record).some((key) => !allowedKeys.includes(key))) {
        return { error: 'Enter valid employment records.' };
      }
      const normalized = {};
      for (const key of allowedKeys) {
        const entry = record[key] == null ? '' : record[key];
        if (typeof entry !== 'string') return { error: 'Enter valid employment records.' };
        normalized[key] = clean(entry);
      }

      if (Object.values(normalized).every((entry) => !entry)) continue;
      if (normalized.position.length > 120 || normalized.organization.length > 160) {
        return { error: 'Employment position or organization is too long.' };
      }
      if ((normalized.fromYear && !validYear(normalized.fromYear))
        || (normalized.toYear && !validYear(normalized.toYear))) {
        return { error: `Enter employment years between 1900 and ${currentYear}.` };
      }
      if (normalized.fromYear && normalized.toYear && Number(normalized.toYear) < Number(normalized.fromYear)) {
        return { error: 'An employment end year cannot be earlier than its start year.' };
      }
      records.push(normalized);
    }
    return { value: JSON.stringify(records), error: '' };
  }

  if (field === 'courseReason') {
    if (typeof value !== 'string') return { error: 'Enter a valid course reason.' };
    const normalized = value.replace(/\r\n?/g, '\n').trim();
    return normalized.length <= COURSE_REASON_MAX_LENGTH
      ? { value: normalized, error: '' }
      : { error: `Keep your response to ${COURSE_REASON_MAX_LENGTH} characters or fewer.` };
  }

  const normalized = clean(value);
  return { value: normalized, error: validateField(field, normalized) };
}

async function getApplicationProfile(applicantId) {
  return db.get(
    `SELECT first_name, last_name, id_number, country_of_birth, date_of_birth, gender,
          physical_address, next_of_kin_name, next_of_kin_contact,
          training_arrangements, employment_history, course_reason,
          passport_photo_mime, updated_at,
            CASE WHEN passport_photo IS NULL THEN 0 ELSE 1 END AS has_passport_photo
     FROM application_profiles WHERE applicant_id = ?`,
    [applicantId],
  );
}

async function getApplicationSubmission(applicantId) {
  return db.get(
    `SELECT submission.status, submission.submitted_at AS submittedAt,
            applicant.application_number AS applicationNumber
     FROM application_submissions AS submission
     JOIN applicants AS applicant ON applicant.id = submission.applicant_id
     WHERE submission.applicant_id = ?`,
    [applicantId],
  );
}

async function getApplicationStatusNotifications(applicantId) {
  const items = await db.all(
    `SELECT id, status, created_at AS createdAt, read_at AS readAt
     FROM application_status_notifications
     WHERE applicant_id = ? AND status IN ('submitted', 'admitted')
     ORDER BY created_at DESC, id DESC`,
    [applicantId],
  );
  return {
    items,
    unreadCount: items.reduce((count, item) => count + (item.readAt ? 0 : 1), 0),
  };
}

async function markApplicationStatusNotificationsRead(applicantId) {
  const result = await db.run(
    `UPDATE application_status_notifications
     SET read_at = datetime('now')
     WHERE applicant_id = ? AND read_at IS NULL AND status IN ('submitted', 'admitted')`,
    [applicantId],
  );
  return { updatedCount: result.changes };
}

async function updateApplicationStatus(applicantId, status) {
  if (!APPLICATION_STATUSES.includes(status)) {
    throw new ApplicationError(400, 'INVALID_APPLICATION_STATUS', 'Choose a valid application status.');
  }
  return db.transaction(async () => {
    const submission = await getApplicationSubmission(applicantId);
    if (!submission) {
      throw new ApplicationError(404, 'APPLICATION_NOT_FOUND', 'No submitted application was found.');
    }
    const previousStatusIndex = APPLICATION_STATUSES.indexOf(submission.status);
    const nextStatusIndex = APPLICATION_STATUSES.indexOf(status);
    if (nextStatusIndex < previousStatusIndex) {
      throw new ApplicationError(409, 'APPLICATION_STATUS_REGRESSION', 'Application status cannot move backwards.');
    }
    if (status === submission.status) return submission;

    await db.run('UPDATE application_submissions SET status = ? WHERE applicant_id = ?', [status, applicantId]);
    if (status === 'admitted') {
      await db.run(
        `INSERT INTO application_status_notifications (applicant_id, status)
         VALUES (?, ?)`,
        [applicantId, status],
      );
    }
    return getApplicationSubmission(applicantId);
  });
}

async function assertApplicationDraft(applicantId) {
  if (await getApplicationSubmission(applicantId)) {
    throw new ApplicationError(
      409,
      'APPLICATION_ALREADY_SUBMITTED',
      'This application has been submitted and can no longer be edited.',
    );
  }
}

async function saveApplicationProfile(applicantId, updates) {
  const fields = Object.keys(updates || {});
  if (!fields.length || fields.some((field) => !Object.hasOwn(FIELD_COLUMNS, field))) {
    throw new ApplicationError(400, 'INVALID_PROFILE_FIELD', 'Choose a profile field to save.');
  }

  const values = {};
  const errors = {};
  for (const field of fields) {
    const normalized = normalizeProfileField(field, updates[field]);
    if (normalized.value !== undefined) values[field] = normalized.value;
    if (normalized.error) errors[field] = normalized.error;
  }
  if (Object.keys(errors).length) {
    throw new ApplicationError(400, 'VALIDATION_ERROR', 'Check the highlighted fields and try again.', errors);
  }

  await db.transaction(async () => {
    await assertApplicationDraft(applicantId);
    await db.run('INSERT INTO application_profiles (applicant_id) VALUES (?) ON CONFLICT(applicant_id) DO NOTHING', [applicantId]);
    for (const field of fields) {
      await db.run(
        `UPDATE application_profiles SET ${FIELD_COLUMNS[field]} = ?, updated_at = datetime('now') WHERE applicant_id = ?`,
        [values[field], applicantId],
      );
    }
  });
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

  await db.transaction(async () => {
    await assertApplicationDraft(applicantId);
    await db.run('INSERT INTO application_profiles (applicant_id) VALUES (?) ON CONFLICT(applicant_id) DO NOTHING', [applicantId]);
    await db.run(
      `UPDATE application_profiles
       SET passport_photo = ?, passport_photo_mime = ?, updated_at = datetime('now')
       WHERE applicant_id = ?`,
      [buffer, mimeType, applicantId],
    );
  });
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
    await assertApplicationDraft(applicantId);
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
  return db.transaction(async () => {
    await assertApplicationDraft(applicantId);
    const result = await db.run(
      'DELETE FROM application_documents WHERE id = ? AND applicant_id = ?',
      [documentId, applicantId],
    );
    return result.changes > 0;
  });
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

  return db.transaction(async () => {
    await assertApplicationDraft(applicantId);
    const [profile, applicant] = await Promise.all([
      getApplicationProfile(applicantId),
      db.get('SELECT other_names, surname, date_of_birth, sex FROM applicants WHERE id = ?', [applicantId]),
    ]);
    const requiredProfileFields = {
      first_name: ['firstName', applicant && applicant.other_names],
      last_name: ['lastName', applicant && applicant.surname],
      id_number: ['idNumber', ''],
      country_of_birth: ['countryOfBirth', ''],
      date_of_birth: ['dateOfBirth', applicant && applicant.date_of_birth],
      gender: ['gender', applicant && applicant.sex],
      physical_address: ['physicalAddress', ''],
      next_of_kin_name: ['nextOfKinName', ''],
      next_of_kin_contact: ['nextOfKinContact', ''],
    };
    const incompleteFields = Object.entries(requiredProfileFields)
      .filter(([column, [, fallback]]) => !String((profile && profile[column]) || fallback || '').trim())
      .map(([, [field]]) => field);
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
    const existingArrangements = JSON.parse((profile && profile.training_arrangements) || '[]');
    const trainingArrangement = TRAINING_ARRANGEMENTS_BY_LEVEL[program.level];
    const arrangements = [trainingArrangement];
    if (existingArrangements.includes('By Correspondence')) arrangements.push('By Correspondence');
    await db.run(
      `UPDATE application_profiles
       SET training_arrangements = ?, updated_at = datetime('now')
       WHERE applicant_id = ?`,
      [JSON.stringify(arrangements), applicantId],
    );
    return getProgramSelection(applicantId);
  });
}

async function submitApplication(applicantId) {
  return db.transaction(async () => {
    await assertApplicationDraft(applicantId);
    const [profile, programSelection, documents, applicant] = await Promise.all([
      getApplicationProfile(applicantId),
      getProgramSelection(applicantId),
      listApplicationDocuments(applicantId),
      db.get(
        `SELECT application_number, created_at, other_names, surname, date_of_birth, sex
         FROM applicants WHERE id = ?`,
        [applicantId],
      ),
    ]);
    const requiredFields = {
      firstName: (profile && profile.first_name) || (applicant && applicant.other_names) || '',
      lastName: (profile && profile.last_name) || (applicant && applicant.surname) || '',
      idNumber: (profile && profile.id_number) || '',
      countryOfBirth: (profile && profile.country_of_birth) || '',
      dateOfBirth: (profile && profile.date_of_birth) || (applicant && applicant.date_of_birth) || '',
      gender: (profile && profile.gender) || (applicant && applicant.sex) || '',
      physicalAddress: (profile && profile.physical_address) || '',
      nextOfKinName: (profile && profile.next_of_kin_name) || '',
      nextOfKinContact: (profile && profile.next_of_kin_contact) || '',
    };
    const errors = {};
    for (const [field, value] of Object.entries(requiredFields)) {
      if (!String(value).trim()) {
        errors[field] = 'Complete this required field before submitting.';
      } else {
        const validationError = validateField(field, value);
        if (validationError) errors[field] = validationError;
      }
    }

    let arrangements = [];
    try {
      arrangements = JSON.parse((profile && profile.training_arrangements) || '[]');
    } catch (error) {
      errors.trainingArrangements = 'Choose at least one training time or arrangement.';
    }
    const selectedProgramArrangement = programSelection
      ? TRAINING_ARRANGEMENTS_BY_LEVEL[programSelection.level]
      : undefined;
    if (!Array.isArray(arrangements) || !selectedProgramArrangement
      || !arrangements.includes(selectedProgramArrangement)
      || arrangements.some((item) => !TRAINING_ARRANGEMENTS.includes(item)
        || (item !== selectedProgramArrangement && item !== 'By Correspondence'))) {
      errors.trainingArrangements = 'Your training arrangement must match your selected study level.';
    }
    if (!programSelection || !programSelection.intake) {
      errors.programSelection = 'Choose and save a program and intake.';
    }
    if (!profile || !profile.has_passport_photo) {
      errors.passportPhoto = 'Upload a passport photo.';
    }
    if (!documents.some((document) => document.category === 'transcript')) {
      errors.transcript = 'Upload at least one academic transcript.';
    }
    if (!documents.some((document) => document.category === 'identity')) {
      errors.identity = 'Upload a National ID or passport.';
    }
    if (Object.keys(errors).length) {
      throw new ApplicationError(
        400,
        'APPLICATION_INCOMPLETE',
        'Complete all required application details and documents before submitting.',
        errors,
      );
    }

    if (!applicant.application_number) {
      const createdYear = String(applicant.created_at || '').slice(0, 4);
      const year = /^\d{4}$/.test(createdYear) ? createdYear : String(new Date().getUTCFullYear());
      const applicationNumber = `EAIMS-${year}-${String(applicantId).padStart(6, '0')}`;
      await db.run('UPDATE applicants SET application_number = ? WHERE id = ?', [applicationNumber, applicantId]);
    }
    await db.run(
      `INSERT INTO application_submissions (applicant_id, status)
       VALUES (?, 'submitted')`,
      [applicantId],
    );
    await db.run(
      `INSERT INTO application_status_notifications (applicant_id, status)
       VALUES (?, 'submitted')`,
      [applicantId],
    );
    return getApplicationSubmission(applicantId);
  });
}

module.exports = {
  ApplicationError,
  MAX_PHOTO_BYTES,
  MAX_APPLICATION_DOCUMENT_BYTES,
  APPLICATION_DOCUMENT_CATEGORIES,
  APPLICATION_DOCUMENT_MIME_TYPES,
  getApplicationProfile,
  getApplicationSubmission,
  getApplicationStatusNotifications,
  markApplicationStatusNotificationsRead,
  updateApplicationStatus,
  assertApplicationDraft,
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
  submitApplication,
};