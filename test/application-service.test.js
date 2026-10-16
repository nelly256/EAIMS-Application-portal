'use strict';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaims-application-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test-application.db');
process.env.NODE_ENV = 'test';

const db = require('../src/db');
const { getIntakes } = require('../src/services/program-catalog');
const {
  ApplicationError,
  MAX_PHOTO_BYTES,
  MAX_APPLICATION_DOCUMENT_BYTES,
  getApplicationProfile,
  saveApplicationProfile,
  savePassportPhoto,
  getPassportPhoto,
  listApplicationDocuments,
  saveApplicationDocument,
  getApplicationDocument,
  deleteApplicationDocument,
  getPrograms,
  getProgramSelection,
  saveProgramSelection,
} = require('../src/services/application-service');

let applicantId;

describe('application profile service', () => {
  before(async () => {
    await db.exec(`
      CREATE TABLE application_profiles (
        applicant_id INTEGER PRIMARY KEY,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        id_number TEXT NOT NULL DEFAULT '',
        country_of_birth TEXT NOT NULL DEFAULT '',
        date_of_birth TEXT NOT NULL DEFAULT '',
        gender TEXT NOT NULL DEFAULT '',
        physical_address TEXT NOT NULL DEFAULT '',
        passport_photo BLOB,
        passport_photo_mime TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
      )
    `);
    await db.exec(`
      CREATE TABLE application_program_selections (
        applicant_id INTEGER PRIMARY KEY,
        program_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
      )
    `);
    await db.migrate();
    const columns = await db.all('PRAGMA table_info(application_program_selections)');
    assert.ok(columns.some((column) => column.name === 'intake'));
    const profileColumns = await db.all('PRAGMA table_info(application_profiles)');
    assert.ok(profileColumns.some((column) => column.name === 'next_of_kin_name'));
    assert.ok(profileColumns.some((column) => column.name === 'next_of_kin_contact'));
    assert.ok(profileColumns.some((column) => column.name === 'training_arrangements'));
    assert.ok(profileColumns.some((column) => column.name === 'employment_history'));
    assert.ok(profileColumns.some((column) => column.name === 'course_reason'));
    await db.migrate();
  });

  after(async () => {
    await db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await db.run('DELETE FROM application_profiles');
    await db.run('DELETE FROM application_program_selections');
    await db.run('DELETE FROM application_documents');
    await db.run('DELETE FROM applicants');
    const result = await db.run(
      `INSERT INTO applicants (surname, other_names, email, phone, password_hash)
       VALUES ('Matsiko', 'Nelson', 'nelson@example.com', '+256700000000', 'test-hash')`,
    );
    applicantId = result.id;
  });

  test('saves partial profile updates and retrieves the persisted values', async () => {
    await saveApplicationProfile(applicantId, { firstName: 'Nelson' });
    const profile = await saveApplicationProfile(applicantId, {
      lastName: 'Matsiko',
      countryOfBirth: 'Uganda',
      gender: 'MALE',
      physicalAddress: 'Kampala, Uganda',
      nextOfKinName: 'Mary Matsiko',
      nextOfKinContact: '+256 700 111 222',
    });
    assert.equal(profile.first_name, 'Nelson');
    assert.equal(profile.last_name, 'Matsiko');
    assert.equal(profile.country_of_birth, 'Uganda');
    assert.equal(profile.gender, 'MALE');
    assert.equal(profile.physical_address, 'Kampala, Uganda');
    assert.equal(profile.next_of_kin_name, 'Mary Matsiko');
    assert.equal(profile.next_of_kin_contact, '+256 700 111 222');
  });

  test('rejects invalid profile fields without saving them', async () => {
    await assert.rejects(
      saveApplicationProfile(applicantId, { countryOfBirth: 'Atlantis' }),
      (error) => error instanceof ApplicationError && Boolean(error.fields.countryOfBirth),
    );
    assert.equal(await getApplicationProfile(applicantId), undefined);
  });

  test('requires valid next-of-kin name and contact fields', async () => {
    await assert.rejects(
      saveApplicationProfile(applicantId, { nextOfKinName: '1Invalid', nextOfKinContact: 'not a phone' }),
      (error) => error instanceof ApplicationError
        && Boolean(error.fields.nextOfKinName)
        && Boolean(error.fields.nextOfKinContact),
    );
    assert.equal(await getApplicationProfile(applicantId), undefined);
  });

  test('saves and retrieves training arrangements, employment history, and course reason', async () => {
    const updates = {
      trainingArrangements: ['Weekend', 'Day'],
      employmentHistory: [
        {
          position: 'Program Officer',
          organization: 'EAIMS',
          fromYear: '2021',
          toYear: '',
        },
        {
          position: 'Assistant',
          organization: 'Community Center',
          fromYear: '2018',
          toYear: '2020',
        },
        {
          position: 'Volunteer',
          organization: '',
          fromYear: '',
          toYear: '',
        },
      ],
      courseReason: 'Build skills for my current role.\nPrepare for future leadership.',
    };

    const saved = await saveApplicationProfile(applicantId, updates);
    assert.deepEqual(JSON.parse(saved.training_arrangements), ['Day', 'Weekend']);
    assert.deepEqual(JSON.parse(saved.employment_history), updates.employmentHistory);
    assert.equal(saved.course_reason, updates.courseReason);
  });

  test('rejects unsupported arrangements, invalid employment years, and oversized course reasons', async () => {
    await assert.rejects(
      saveApplicationProfile(applicantId, { trainingArrangements: ['Day', 'Unknown'] }),
      (error) => error instanceof ApplicationError && Boolean(error.fields.trainingArrangements),
    );
    await assert.rejects(
      saveApplicationProfile(applicantId, {
        employmentHistory: [{ position: 'Coordinator', organization: 'EAIMS', fromYear: '2022', toYear: '2021' }],
      }),
      (error) => error instanceof ApplicationError && Boolean(error.fields.employmentHistory),
    );
    await assert.rejects(
      saveApplicationProfile(applicantId, {
        employmentHistory: Array.from({ length: 5 }, () => ({})),
      }),
      (error) => error instanceof ApplicationError && Boolean(error.fields.employmentHistory),
    );
    await assert.rejects(
      saveApplicationProfile(applicantId, { courseReason: 'x'.repeat(4001) }),
      (error) => error instanceof ApplicationError && Boolean(error.fields.courseReason),
    );
    assert.equal(await getApplicationProfile(applicantId), undefined);
  });

  test('stores a valid JPEG photo and returns it with its MIME type', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
    await savePassportPhoto(applicantId, jpeg, 'image/jpeg');
    const photo = await getPassportPhoto(applicantId);
    assert.equal(photo.passport_photo_mime, 'image/jpeg');
    assert.deepEqual(photo.passport_photo, jpeg);
  });

  test('stores multiple transcripts and optional documents and replaces the identity document', async () => {
    const firstTranscript = Buffer.from('%PDF-1.7 transcript one');
    const secondTranscript = Buffer.from('%PDF-1.7 transcript two');
    const identity = Buffer.from('%PDF-1.7 national id');
    const replacementIdentity = Buffer.from('%PDF-1.7 passport');

    const first = await saveApplicationDocument(
      applicantId,
      'transcript',
      firstTranscript,
      'application/pdf',
      'C:\\fakepath\\transcript-one.pdf',
    );
    await saveApplicationDocument(applicantId, 'transcript', secondTranscript, 'application/pdf', 'transcript-two.pdf');
    await saveApplicationDocument(applicantId, 'identity', identity, 'application/pdf', 'national-id.pdf');
    await saveApplicationDocument(applicantId, 'identity', replacementIdentity, 'application/pdf', 'passport.pdf');
    await saveApplicationDocument(applicantId, 'additional', Buffer.from('%PDF-1.7 optional'), 'application/pdf', 'optional.pdf');

    const documents = await listApplicationDocuments(applicantId);
    assert.equal(documents.filter((document) => document.category === 'transcript').length, 2);
    assert.equal(documents.filter((document) => document.category === 'identity').length, 1);
    assert.equal(documents.filter((document) => document.category === 'additional').length, 1);
    assert.equal(first.original_name, 'transcript-one.pdf');
    assert.equal(await getApplicationDocument(applicantId + 1, first.id), undefined);
    assert.equal(await deleteApplicationDocument(applicantId + 1, first.id), false);

    const stored = await getApplicationDocument(applicantId, documents.find((document) => document.category === 'identity').id);
    assert.equal(stored.original_name, 'passport.pdf');
    assert.deepEqual(stored.file_data, replacementIdentity);
    assert.equal(await deleteApplicationDocument(applicantId, first.id), true);
    assert.equal(await deleteApplicationDocument(applicantId, first.id), false);
    assert.equal((await listApplicationDocuments(applicantId)).filter((document) => document.category === 'transcript').length, 1);
  });

  test('rejects unsupported document categories, invalid signatures, and oversized files', async () => {
    await assert.rejects(
      saveApplicationDocument(applicantId, 'unknown', Buffer.from('%PDF-1.7'), 'application/pdf', 'file.pdf'),
      (error) => error instanceof ApplicationError && error.code === 'INVALID_DOCUMENT',
    );
    await assert.rejects(
      saveApplicationDocument(applicantId, 'transcript', Buffer.from('not a pdf'), 'application/pdf', 'file.pdf'),
      (error) => error instanceof ApplicationError && error.code === 'INVALID_DOCUMENT',
    );
    await assert.rejects(
      saveApplicationDocument(
        applicantId,
        'transcript',
        Buffer.alloc(MAX_APPLICATION_DOCUMENT_BYTES + 1),
        'application/pdf',
        'large.pdf',
      ),
      (error) => error instanceof ApplicationError && error.code === 'INVALID_DOCUMENT',
    );
  });

  test('rejects photos with invalid signatures and files over 5 MB', async () => {
    await assert.rejects(
      savePassportPhoto(applicantId, Buffer.from('not an image'), 'image/jpeg'),
      (error) => error instanceof ApplicationError && error.code === 'INVALID_PHOTO',
    );
    await assert.rejects(
      savePassportPhoto(applicantId, Buffer.alloc(MAX_PHOTO_BYTES + 1), 'image/png'),
      (error) => error instanceof ApplicationError && error.code === 'INVALID_PHOTO',
    );
  });

  test('migrates documents from the legacy generic document schema', async () => {
    const pdf = Buffer.from('%PDF-1.7 legacy document');
    await db.run('DROP TABLE application_documents');
    await db.exec(`
      CREATE TABLE application_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        applicant_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
      )
    `);
    const inserted = await db.run(
      `INSERT INTO application_documents (applicant_id, filename, mime_type, data)
       VALUES (?, ?, ?, ?)`,
      [applicantId, 'legacy-transcript.pdf', 'application/pdf', pdf],
    );

    await db.migrate();

    const migrated = await getApplicationDocument(applicantId, inserted.id);
    assert.equal(migrated.category, 'additional');
    assert.equal(migrated.original_name, 'legacy-transcript.pdf');
    assert.equal(migrated.file_size, pdf.length);
    assert.deepEqual(migrated.file_data, pdf);
  });

  test('provides the listed programs and saves one selection per applicant', async () => {
    const programs = getPrograms();
    assert.ok(programs.length > 0);
    assert.ok(programs.some((program) => program.level === 'Diploma'));
    assert.ok(programs.some((program) => program.level === 'Certificate'));
    const shortCourses = programs.filter((program) => program.level === 'Short courses');
    assert.equal(shortCourses.length, 11);
    assert.ok(shortCourses.every((program) => program.duration === '2 months' && program.tuition === '—'));
    assert.deepEqual(shortCourses.map((program) => program.name), [
      'Fundraising & Project Proposal Writing',
      'Strategic Plan Development',
      'Business Plan Writing',
      'Communication Skills, Report Writing & Presentation Skills',
      'Customer Care Skills',
      'Marketing & Sales',
      'Financial Management',
      'Leadership & Management',
      'Basic Monitoring & Evaluation',
      'Computerized Accounting (Quickbooks)',
      'Basic Hotel & Catering',
    ]);
    assert.deepEqual(getIntakes(), ['March', 'August']);

    await saveApplicationProfile(applicantId, {
      firstName: 'Nelson',
      lastName: 'Matsiko',
      idNumber: 'CM123456',
      countryOfBirth: 'Uganda',
      dateOfBirth: '2000-01-01',
      gender: 'MALE',
      physicalAddress: 'Kampala, Uganda',
      nextOfKinName: 'Mary Matsiko',
      nextOfKinContact: '+256 700 111 222',
    });
    const saved = await saveProgramSelection(applicantId, { programId: programs[0].id, intake: 'March' });
    assert.equal(saved.id, programs[0].id);
    assert.equal(saved.name, programs[0].name);
    assert.equal(saved.intake, 'March');
    assert.equal((await getProgramSelection(applicantId)).id, programs[0].id);

    const replacement = await saveProgramSelection(applicantId, { programId: programs[1].id, intake: 'August' });
    assert.equal(replacement.id, programs[1].id);
    assert.equal(replacement.intake, 'August');
    const row = await db.get(
      'SELECT COUNT(*) AS count FROM application_program_selections WHERE applicant_id = ?',
      [applicantId],
    );
    assert.equal(row.count, 1);
  });

  test('rejects unknown or multiple program choices without saving', async () => {
    await assert.rejects(
      saveProgramSelection(applicantId, { programId: 'not-a-program', intake: 'March' }),
      (error) => error instanceof ApplicationError && Boolean(error.fields.programId),
    );
    await assert.rejects(
      saveProgramSelection(applicantId, {
        programId: 'diploma-business-administration',
        secondProgramId: 'national-certificate-business-administration',
        intake: 'March',
      }),
      (error) => error instanceof ApplicationError && Boolean(error.fields.programId),
    );
    await assert.rejects(
      saveProgramSelection(applicantId, { programId: 'diploma-business-administration', intake: 'October' }),
      (error) => error instanceof ApplicationError && Boolean(error.fields.intake),
    );
    assert.equal(await getProgramSelection(applicantId), undefined);
  });

  test('requires completed personal and next-of-kin details before saving a program choice', async () => {
    await saveApplicationProfile(applicantId, {
      firstName: 'Nelson',
      lastName: 'Matsiko',
      idNumber: 'CM123456',
      countryOfBirth: 'Uganda',
      dateOfBirth: '2000-01-01',
      gender: 'MALE',
      physicalAddress: 'Kampala, Uganda',
    });
    await assert.rejects(
      saveProgramSelection(applicantId, { programId: 'diploma-business-administration', intake: 'March' }),
      (error) => error instanceof ApplicationError
        && error.code === 'APPLICATION_PROFILE_INCOMPLETE'
        && Boolean(error.fields.nextOfKinName)
        && Boolean(error.fields.nextOfKinContact),
    );
  });
});
