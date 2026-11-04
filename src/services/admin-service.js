'use strict';

const validator = require('validator');
const db = require('../db');
const applicationService = require('./application-service');

const ROLES = ['superadmin', 'admin', 'reviewer'];
const STATUSES = ['submitted', 'in_review', 'approved', 'admitted'];

class AdminError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function clean(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function slug(value) {
  return clean(value, 120).toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function validateDate(value, field) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new AdminError(400, 'INVALID_DATE', `Enter a valid ${field}.`);
  }
  return value;
}

async function audit(adminId, action, entityType, entityId, details = {}) {
  await db.run(
    `INSERT INTO admin_audit_logs (admin_id, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?)`,
    [adminId, action, entityType, entityId == null ? null : String(entityId), JSON.stringify(details)],
  );
}

async function dashboard() {
  const [registrations, verified, submissions, incomplete, failedAttempts, openIntakes, activePrograms, demand] = await Promise.all([
    db.get('SELECT COUNT(*) AS count FROM applicants'),
    db.get('SELECT COUNT(*) AS count FROM applicants WHERE is_verified = 1'),
    db.get('SELECT COUNT(*) AS count FROM application_submissions'),
    db.get(
      `SELECT COUNT(*) AS count
       FROM applicants AS applicant
       LEFT JOIN application_profiles AS profile ON profile.applicant_id = applicant.id
       LEFT JOIN application_program_selections AS selection ON selection.applicant_id = applicant.id
       LEFT JOIN application_submissions AS submission ON submission.applicant_id = applicant.id
       WHERE submission.applicant_id IS NULL
         AND (profile.applicant_id IS NULL
           OR COALESCE(NULLIF(trim(profile.first_name), ''), NULLIF(trim(applicant.other_names), '')) IS NULL
           OR COALESCE(NULLIF(trim(profile.last_name), ''), NULLIF(trim(applicant.surname), '')) IS NULL
           OR trim(COALESCE(profile.id_number, '')) = ''
           OR trim(COALESCE(profile.country_of_birth, '')) = ''
           OR COALESCE(NULLIF(trim(profile.date_of_birth), ''), NULLIF(trim(applicant.date_of_birth), '')) IS NULL
           OR COALESCE(NULLIF(trim(profile.gender), ''), NULLIF(trim(applicant.sex), '')) IS NULL
           OR trim(COALESCE(profile.physical_address, '')) = ''
           OR trim(COALESCE(profile.next_of_kin_name, '')) = ''
           OR trim(COALESCE(profile.next_of_kin_contact, '')) = ''
           OR profile.passport_photo IS NULL
           OR trim(profile.training_arrangements) = '' OR trim(profile.training_arrangements) = '[]'
           OR selection.applicant_id IS NULL
           OR trim(COALESCE(selection.program_id, '')) = '' OR trim(COALESCE(selection.intake, '')) = ''
           OR NOT EXISTS (SELECT 1 FROM application_documents d
             WHERE d.applicant_id = applicant.id AND d.category = 'transcript')
           OR NOT EXISTS (SELECT 1 FROM application_documents d
             WHERE d.applicant_id = applicant.id AND d.category = 'identity'))`,
    ),
    db.get('SELECT COUNT(*) AS count FROM application_submission_failures'),
    db.get(
      `SELECT COUNT(*) AS count FROM intakes
       WHERE is_open = 1
         AND (opening_date IS NULL OR date(opening_date) <= date('now'))
         AND (closing_date IS NULL OR date(closing_date) >= date('now'))`,
    ),
    db.get('SELECT COUNT(*) AS count FROM programs WHERE is_active = 1'),
    db.all(
      `SELECT program.id, program.name, COUNT(selection.applicant_id) AS selections,
              SUM(CASE WHEN submission.applicant_id IS NOT NULL THEN 1 ELSE 0 END) AS submissions
       FROM programs AS program
       LEFT JOIN application_program_selections AS selection ON selection.program_id = program.id
       LEFT JOIN application_submissions AS submission ON submission.applicant_id = selection.applicant_id
       GROUP BY program.id
       ORDER BY selections DESC, program.name COLLATE NOCASE
       LIMIT 10`,
    ),
  ]);
  const statusRows = await db.all(
    'SELECT status, COUNT(*) AS count FROM application_submissions GROUP BY status',
  );
  return {
    registrations: registrations.count,
    verifiedApplicants: verified.count,
    submittedApplications: submissions.count,
    incompleteApplications: incomplete.count,
    failedSubmissionAttempts: failedAttempts.count,
    openIntakes: openIntakes.count,
    activePrograms: activePrograms.count,
    applicationStatuses: Object.fromEntries(statusRows.map((row) => [row.status, row.count])),
    programmeDemand: demand,
  };
}

async function listPrograms() {
  const rows = await db.all(
    `SELECT program.id, program.level, program.name, program.duration, program.tuition,
            program.eligibility, program.is_active AS isActive, program.updated_at AS updatedAt
     FROM programs AS program
     ORDER BY program.sort_order, program.level, program.name COLLATE NOCASE`,
  );
  const availability = await db.all(
    `SELECT program_id, intake_name, is_available
     FROM program_intakes
     ORDER BY intake_name COLLATE NOCASE`,
  );
  for (const program of rows) {
    program.isActive = Boolean(program.isActive);
    program.intakes = availability
      .filter((item) => item.program_id === program.id)
      .map((item) => ({ name: item.intake_name, available: Boolean(item.is_available) }));
  }
  return rows;
}

function normalizeProgram(input, current = {}) {
  const level = clean(input.level == null ? current.level : input.level);
  const name = clean(input.name == null ? current.name : input.name);
  const duration = clean(input.duration == null ? current.duration : input.duration);
  const tuition = clean(input.tuition == null ? current.tuition : input.tuition);
  const eligibility = typeof input.eligibility === 'string'
    ? input.eligibility.trim()
    : current.eligibility || '';
  if (!['Short courses', 'Diploma', 'Certificate'].includes(level) || !name || name.length > 180
    || !duration || duration.length > 80 || tuition.length > 80 || eligibility.length > 2000) {
    throw new AdminError(400, 'INVALID_PROGRAM', 'Provide a valid programme level, name, and duration.');
  }
  return { level, name, duration, tuition, eligibility };
}

async function saveProgram(admin, input, programId) {
  const current = programId ? await db.get('SELECT * FROM programs WHERE id = ?', [programId]) : null;
  if (programId && !current) throw new AdminError(404, 'PROGRAM_NOT_FOUND', 'The programme was not found.');
  const program = normalizeProgram(input || {}, current || {});
  const id = programId || slug(input.id || program.name);
  if (!id || !/^[a-z0-9][a-z0-9-]{1,119}$/.test(id)) {
    throw new AdminError(400, 'INVALID_PROGRAM_ID', 'Programme IDs must be URL-safe letters, numbers, and hyphens.');
  }
  const active = input.isActive == null ? (current ? current.is_active : 1) : input.isActive === true ? 1 : input.isActive === false ? 0 : -1;
  if (active < 0) throw new AdminError(400, 'INVALID_PROGRAM', 'Choose a valid programme status.');
  const intakeNames = input.intakes == null
    ? (current ? (await db.all('SELECT intake_name FROM program_intakes WHERE program_id = ? AND is_available = 1', [id])).map((row) => row.intake_name) : [])
    : input.intakes;
  if (!Array.isArray(intakeNames) || intakeNames.some((name) => typeof name !== 'string') || new Set(intakeNames).size !== intakeNames.length) {
    throw new AdminError(400, 'INVALID_PROGRAM_INTAKES', 'Choose valid, non-duplicate intake availability values.');
  }
  const knownIntakes = await db.all('SELECT name FROM intakes');
  const knownNames = new Set(knownIntakes.map((item) => item.name));
  if (intakeNames.some((name) => !knownNames.has(name))) {
    throw new AdminError(400, 'INVALID_PROGRAM_INTAKES', 'Choose intake periods that exist in the portal.');
  }

  await db.transaction(async () => {
    await db.run(
      `INSERT INTO programs (id, level, name, duration, tuition, eligibility, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, 10000)
       ON CONFLICT(id) DO UPDATE SET
         level = excluded.level, name = excluded.name, duration = excluded.duration,
         tuition = excluded.tuition, eligibility = excluded.eligibility,
         is_active = excluded.is_active, updated_at = datetime('now')`,
      [id, program.level, program.name, program.duration, program.tuition, program.eligibility, active],
    );
    await db.run('DELETE FROM program_intakes WHERE program_id = ?', [id]);
    for (const intakeName of intakeNames) {
      await db.run(
        'INSERT INTO program_intakes (program_id, intake_name, is_available) VALUES (?, ?, 1)',
        [id, intakeName],
      );
    }
  });
  await audit(admin.id, current ? 'program.updated' : 'program.created', 'program', id, { name: program.name });
  return db.get(
    'SELECT id, level, name, duration, tuition, eligibility, is_active AS isActive FROM programs WHERE id = ?',
    [id],
  );
}

async function deactivateProgram(admin, programId) {
  const result = await db.run(
    "UPDATE programs SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND is_active = 1",
    [programId],
  );
  if (!result.changes) throw new AdminError(404, 'PROGRAM_NOT_FOUND', 'The active programme was not found.');
  await audit(admin.id, 'program.deactivated', 'program', programId);
}

async function listIntakes() {
  return db.all(
    `SELECT intake.name, intake.opening_date AS openingDate, intake.closing_date AS closingDate,
            intake.is_open AS isOpen, intake.updated_at AS updatedAt,
            COUNT(DISTINCT availability.program_id) AS availablePrograms
     FROM intakes AS intake
     LEFT JOIN program_intakes AS availability
       ON availability.intake_name = intake.name AND availability.is_available = 1
     GROUP BY intake.name
     ORDER BY intake.name COLLATE NOCASE`,
  ).then((rows) => rows.map((item) => ({ ...item, isOpen: Boolean(item.isOpen) })));
}

async function saveIntake(admin, input, currentName) {
  const current = currentName ? await db.get('SELECT * FROM intakes WHERE name = ?', [currentName]) : null;
  if (currentName && !current) throw new AdminError(404, 'INTAKE_NOT_FOUND', 'The intake was not found.');
  const name = clean(input.name == null ? currentName : input.name);
  if (!name || name.length > 80 || !/^[A-Za-z0-9][A-Za-z0-9 .&()'-]*$/.test(name)) {
    throw new AdminError(400, 'INVALID_INTAKE', 'Enter an intake name using letters, numbers, spaces, and common punctuation.');
  }
  if (current && currentName !== name) {
    throw new AdminError(400, 'INTAKE_RENAME_UNSUPPORTED', 'Intake names cannot be changed after they have been created.');
  }
  const openingDate = validateDate(input.openingDate == null ? current?.opening_date : input.openingDate, 'opening date');
  const closingDate = validateDate(input.closingDate == null ? current?.closing_date : input.closingDate, 'closing date');
  if (openingDate && closingDate && openingDate > closingDate) {
    throw new AdminError(400, 'INVALID_INTAKE_DATES', 'The closing date must be on or after the opening date.');
  }
  const isOpen = input.isOpen == null ? (current ? current.is_open : 0)
    : input.isOpen === true ? 1 : input.isOpen === false ? 0 : -1;
  if (isOpen < 0) throw new AdminError(400, 'INVALID_INTAKE', 'Choose a valid intake status.');
  await db.run(
    `INSERT INTO intakes (name, opening_date, closing_date, is_open)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       opening_date = excluded.opening_date, closing_date = excluded.closing_date,
       is_open = excluded.is_open, updated_at = datetime('now')`,
    [name, openingDate, closingDate, isOpen],
  );
  if (!current) {
    const programs = await db.all('SELECT id FROM programs WHERE is_active = 1');
    await db.transaction(async () => {
      for (const program of programs) {
        await db.run(
          'INSERT OR IGNORE INTO program_intakes (program_id, intake_name, is_available) VALUES (?, ?, 0)',
          [program.id, name],
        );
      }
    });
  }
  await audit(admin.id, current ? 'intake.updated' : 'intake.created', 'intake', name, {
    isOpen: Boolean(isOpen), openingDate, closingDate,
  });
  return db.get(
    'SELECT name, opening_date AS openingDate, closing_date AS closingDate, is_open AS isOpen FROM intakes WHERE name = ?',
    [name],
  ).then((item) => ({ ...item, isOpen: Boolean(item.isOpen) }));
}

function applicantCompleteness(row) {
  const missing = [];
  if (!(row.first_name || row.otherNames) || !(row.last_name || row.surname) || !row.id_number
    || !row.country_of_birth || !(row.date_of_birth || row.applicantDateOfBirth)
    || !(row.gender || row.applicantSex)
    || !row.physical_address || !row.next_of_kin_name || !row.next_of_kin_contact) {
    missing.push('profile');
  }
  if (!row.training_arrangements || row.training_arrangements === '[]') missing.push('training arrangement');
  if (!row.has_passport_photo) missing.push('passport photo');
  if (!row.has_transcript) missing.push('transcript');
  if (!row.has_identity) missing.push('identity document');
  if (!row.program_id || !row.intake) missing.push('programme and intake');
  return missing;
}

async function listApplicants(options = {}) {
  const search = clean(options.search);
  const status = clean(options.status);
  if (search.length > 160) throw new AdminError(400, 'INVALID_SEARCH', 'Keep the search phrase to 160 characters or fewer.');
  const where = [];
  const params = [];
  if (options.applicantId != null) {
    where.push('applicant.id = ?');
    params.push(options.applicantId);
  }
  if (search) {
    where.push(`(applicant.application_number LIKE ? OR applicant.email LIKE ? OR applicant.phone LIKE ?
      OR applicant.surname LIKE ? OR applicant.other_names LIKE ?
      OR profile.first_name LIKE ? OR profile.last_name LIKE ?)`);
    const term = `%${search}%`;
    params.push(term, term, term, term, term, term, term);
  }
  if (status === 'verified') where.push('applicant.is_verified = 1');
  if (status === 'unverified') where.push('applicant.is_verified = 0');
  if (status === 'inactive') where.push('applicant.is_active = 0');
  if (status === 'failed') {
    where.push(`submission.applicant_id IS NULL AND EXISTS (
      SELECT 1 FROM application_submission_failures failure WHERE failure.applicant_id = applicant.id
    )`);
  }
  if (status && STATUSES.includes(status)) {
    where.push('submission.status = ?');
    params.push(status);
  }
  const query = `SELECT applicant.id, applicant.application_number AS applicationNumber,
      applicant.surname, applicant.other_names AS otherNames, applicant.email, applicant.phone,
      applicant.date_of_birth AS applicantDateOfBirth, applicant.sex AS applicantSex,
      applicant.is_verified AS isVerified, applicant.is_active AS isActive,
      applicant.created_at AS registeredAt, profile.first_name, profile.last_name,
      profile.id_number, profile.country_of_birth, profile.date_of_birth, profile.gender,
      profile.physical_address, profile.next_of_kin_name, profile.next_of_kin_contact,
      profile.training_arrangements,
      CASE WHEN profile.passport_photo IS NULL THEN 0 ELSE 1 END AS has_passport_photo,
      selection.program_id, selection.intake, program.name AS programName,
      submission.status AS applicationStatus, submission.submitted_at AS submittedAt,
      EXISTS (SELECT 1 FROM application_documents d
        WHERE d.applicant_id = applicant.id AND d.category = 'transcript') AS has_transcript,
      EXISTS (SELECT 1 FROM application_documents d
        WHERE d.applicant_id = applicant.id AND d.category = 'identity') AS has_identity,
      (SELECT COUNT(*) FROM application_submission_failures failure
         WHERE failure.applicant_id = applicant.id) AS failedSubmissionAttempts,
      (SELECT failure.created_at FROM application_submission_failures failure
         WHERE failure.applicant_id = applicant.id ORDER BY failure.id DESC LIMIT 1) AS lastSubmissionFailureAt
    FROM applicants AS applicant
    LEFT JOIN application_profiles AS profile ON profile.applicant_id = applicant.id
    LEFT JOIN application_program_selections AS selection ON selection.applicant_id = applicant.id
    LEFT JOIN programs AS program ON program.id = selection.program_id
    LEFT JOIN application_submissions AS submission ON submission.applicant_id = applicant.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY applicant.created_at DESC, applicant.id DESC LIMIT 200`;
  const rows = await db.all(query, params);
  return rows.map((row) => {
    const missingItems = applicantCompleteness(row);
    return {
      ...row,
      isVerified: Boolean(row.isVerified),
      isActive: Boolean(row.isActive),
      isIncomplete: !row.applicationStatus && missingItems.length > 0,
      isFailed: !row.applicationStatus && row.failedSubmissionAttempts > 0,
      missingItems,
      hasPassportPhoto: Boolean(row.has_passport_photo),
      hasTranscript: Boolean(row.has_transcript),
      hasIdentity: Boolean(row.has_identity),
    };
  });
}

async function getApplicant(applicantId) {
  const [summary] = await listApplicants({ applicantId });
  if (!summary) return undefined;
  const [applicant, profile, documents, submission, selection] = await Promise.all([
    db.get(
      `SELECT id, application_number AS applicationNumber, surname, other_names AS otherNames,
              email, phone, nationality, date_of_birth AS dateOfBirth, sex,
              is_verified AS isVerified, is_active AS isActive, created_at AS registeredAt
       FROM applicants WHERE id = ?`,
      [applicantId],
    ),
    applicationService.getApplicationProfile(applicantId),
    applicationService.listApplicationDocuments(applicantId),
    applicationService.getApplicationSubmission(applicantId),
    applicationService.getProgramSelection(applicantId),
  ]);
  return {
    applicant: { ...applicant, isVerified: Boolean(applicant.isVerified), isActive: Boolean(applicant.isActive) },
    profile: profile || null,
    documents,
    submission: submission || null,
    programSelection: selection || null,
    isIncomplete: summary.isIncomplete,
    missingItems: summary.missingItems,
    failedSubmissionAttempts: summary.failedSubmissionAttempts,
    lastSubmissionFailureAt: summary.lastSubmissionFailureAt,
  };
}

async function setApplicantActive(admin, applicantId, isActive) {
  const result = await db.run(
    'UPDATE applicants SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?',
    [isActive ? 1 : 0, applicantId],
  );
  if (!result.changes) throw new AdminError(404, 'APPLICANT_NOT_FOUND', 'The applicant was not found.');
  await audit(admin.id, isActive ? 'applicant.activated' : 'applicant.deactivated', 'applicant', applicantId);
}

async function listAnnouncements(publishedOnly = false) {
  return db.all(
    `SELECT announcement.id, announcement.title, announcement.body,
            announcement.is_published AS isPublished, announcement.created_at AS createdAt,
            announcement.updated_at AS updatedAt, admin.email AS author
     FROM announcements AS announcement
     JOIN admin_users AS admin ON admin.id = announcement.created_by
     ${publishedOnly ? 'WHERE announcement.is_published = 1' : ''}
     ORDER BY announcement.created_at DESC, announcement.id DESC LIMIT 100`,
  ).then((rows) => rows.map((row) => ({ ...row, isPublished: Boolean(row.isPublished) })));
}

async function createAnnouncement(admin, input) {
  const title = clean(input.title);
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!title || title.length > 180 || !body || body.length > 5000) {
    throw new AdminError(400, 'INVALID_ANNOUNCEMENT', 'Enter a title of up to 180 characters and a message of up to 5000 characters.');
  }
  const result = await db.run(
    'INSERT INTO announcements (title, body, created_by) VALUES (?, ?, ?)',
    [title, body, admin.id],
  );
  await audit(admin.id, 'announcement.published', 'announcement', result.id, { title });
  return db.get(
    'SELECT id, title, body, is_published AS isPublished, created_at AS createdAt FROM announcements WHERE id = ?',
    [result.id],
  );
}

async function setAnnouncementPublished(admin, announcementId, isPublished) {
  const result = await db.run(
    "UPDATE announcements SET is_published = ?, updated_at = datetime('now') WHERE id = ?",
    [isPublished ? 1 : 0, announcementId],
  );
  if (!result.changes) throw new AdminError(404, 'ANNOUNCEMENT_NOT_FOUND', 'The announcement was not found.');
  await audit(admin.id, isPublished ? 'announcement.published' : 'announcement.unpublished', 'announcement', announcementId);
}

async function listStaff() {
  return db.all(
    `SELECT id, email, role, is_active AS isActive, created_at AS createdAt, last_login_at AS lastLoginAt
     FROM admin_users ORDER BY created_at, id`,
  ).then((rows) => rows.map((row) => ({ ...row, isActive: Boolean(row.isActive) })));
}

async function createStaff(admin, input, bcrypt, bcryptRounds) {
  const email = clean(input.email).toLowerCase();
  const password = typeof input.password === 'string' ? input.password : '';
  const role = clean(input.role, 20);
  if (!validator.isEmail(email) || email.length > 254 || !ROLES.includes(role) || password.length < 12 || password.length > 128) {
    throw new AdminError(400, 'INVALID_STAFF', 'Enter a valid email, role, and password of 12 to 128 characters.');
  }
  const passwordHash = await bcrypt.hash(password, bcryptRounds);
  try {
    const result = await db.run(
      'INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, ?)',
      [email, passwordHash, role],
    );
    await audit(admin.id, 'staff.created', 'admin_user', result.id, { email, role });
    return db.get(
      'SELECT id, email, role, is_active AS isActive, created_at AS createdAt FROM admin_users WHERE id = ?',
      [result.id],
    );
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      throw new AdminError(409, 'STAFF_EMAIL_EXISTS', 'An administrator account already uses that email.');
    }
    throw error;
  }
}

async function updateStaff(admin, staffId, input) {
  const staff = await db.get('SELECT id, role, is_active FROM admin_users WHERE id = ?', [staffId]);
  if (!staff) throw new AdminError(404, 'STAFF_NOT_FOUND', 'The administrator account was not found.');
  const updates = {};
  if (input.role != null) {
    if (!ROLES.includes(input.role)) throw new AdminError(400, 'INVALID_STAFF_ROLE', 'Choose a valid staff role.');
    updates.role = input.role;
  }
  if (input.isActive != null) {
    if (typeof input.isActive !== 'boolean') throw new AdminError(400, 'INVALID_STAFF_STATUS', 'Choose a valid staff status.');
    updates.is_active = input.isActive ? 1 : 0;
  }
  if (Object.keys(updates).length === 0) throw new AdminError(400, 'INVALID_STAFF_UPDATE', 'Choose a staff role or status to update.');
  if (staff.id === admin.id && (updates.is_active === 0 || (updates.role && updates.role !== 'superadmin'))) {
    throw new AdminError(409, 'CANNOT_REMOVE_SELF', 'You cannot remove your own superadministrator access.');
  }
  const becomingInactiveSuperadmin = staff.role === 'superadmin'
    && (updates.is_active === 0 || (updates.role && updates.role !== 'superadmin'));
  if (becomingInactiveSuperadmin) {
    const otherAdmins = await db.get(
      `SELECT COUNT(*) AS count FROM admin_users
       WHERE role = 'superadmin' AND is_active = 1 AND id != ?`,
      [staffId],
    );
    if (!otherAdmins.count) throw new AdminError(409, 'LAST_SUPERADMIN', 'At least one active superadministrator is required.');
  }
  const assignments = Object.keys(updates).map((column) => `${column} = ?`).join(', ');
  await db.run(`UPDATE admin_users SET ${assignments} WHERE id = ?`, [...Object.values(updates), staffId]);
  await audit(admin.id, 'staff.updated', 'admin_user', staffId, updates);
  return db.get(
    'SELECT id, email, role, is_active AS isActive, created_at AS createdAt, last_login_at AS lastLoginAt FROM admin_users WHERE id = ?',
    [staffId],
  ).then((row) => ({ ...row, isActive: Boolean(row.isActive) }));
}

async function listAuditLogs(limit = 100) {
  return db.all(
    `SELECT log.id, log.admin_id AS adminId, admin.email AS adminEmail, log.action,
            log.entity_type AS entityType, log.entity_id AS entityId,
            log.details, log.created_at AS createdAt
     FROM admin_audit_logs AS log
     LEFT JOIN admin_users AS admin ON admin.id = log.admin_id
     ORDER BY log.created_at DESC, log.id DESC LIMIT ?`,
    [limit],
  ).then((rows) => rows.map((row) => {
    let details = {};
    try {
      details = JSON.parse(row.details);
    } catch (error) {
      throw new Error(`Invalid audit details stored for log ${row.id}.`, { cause: error });
    }
    return { ...row, details };
  }));
}

async function exportApplicants() {
  return db.all(
    `SELECT applicant.application_number AS applicationNumber,
            applicant.surname, applicant.other_names AS otherNames, applicant.email, applicant.phone,
            applicant.is_verified AS isVerified, applicant.is_active AS isActive,
            applicant.created_at AS registeredAt, submission.status AS applicationStatus,
            submission.submitted_at AS submittedAt, program.name AS programName, selection.intake
     FROM applicants AS applicant
     LEFT JOIN application_submissions AS submission ON submission.applicant_id = applicant.id
     LEFT JOIN application_program_selections AS selection ON selection.applicant_id = applicant.id
     LEFT JOIN programs AS program ON program.id = selection.program_id
     ORDER BY applicant.created_at DESC`,
  );
}

async function exportApplications() {
  return db.all(
    `SELECT applicant.application_number AS applicationNumber,
            applicant.surname, applicant.other_names AS otherNames, applicant.email, applicant.phone,
            program.name AS programName, selection.intake,
            submission.status AS applicationStatus, submission.submitted_at AS submittedAt,
            CASE WHEN profile.passport_photo IS NULL THEN 0 ELSE 1 END AS hasPassportPhoto,
            EXISTS (SELECT 1 FROM application_documents d
              WHERE d.applicant_id = applicant.id AND d.category = 'transcript') AS hasTranscript,
            EXISTS (SELECT 1 FROM application_documents d
              WHERE d.applicant_id = applicant.id AND d.category = 'identity') AS hasIdentity,
            (SELECT COUNT(*) FROM application_submission_failures failure
              WHERE failure.applicant_id = applicant.id) AS failedSubmissionAttempts
     FROM applicants AS applicant
     LEFT JOIN application_submissions AS submission ON submission.applicant_id = applicant.id
     LEFT JOIN application_profiles AS profile ON profile.applicant_id = applicant.id
     LEFT JOIN application_program_selections AS selection ON selection.applicant_id = applicant.id
     LEFT JOIN programs AS program ON program.id = selection.program_id
     ORDER BY submission.submitted_at DESC, applicant.created_at DESC`,
  );
}

async function reportData(type) {
  if (type === 'applicants') return exportApplicants();
  if (type === 'applications') return exportApplications();
  throw new AdminError(404, 'REPORT_NOT_FOUND', 'Choose an available report.');
}

module.exports = {
  AdminError,
  ROLES,
  STATUSES,
  audit,
  dashboard,
  listPrograms,
  saveProgram,
  deactivateProgram,
  listIntakes,
  saveIntake,
  listApplicants,
  getApplicant,
  setApplicantActive,
  listAnnouncements,
  createAnnouncement,
  setAnnouncementPublished,
  listStaff,
  createStaff,
  updateStaff,
  listAuditLogs,
  reportData,
};
