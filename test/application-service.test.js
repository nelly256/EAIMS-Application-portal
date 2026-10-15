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
const {
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
} = require('../src/services/application-service');

let applicantId;

describe('application profile service', () => {
  before(async () => {
    await db.migrate();
  });

  after(async () => {
    await db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await db.run('DELETE FROM application_profiles');
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
    });
    assert.equal(profile.first_name, 'Nelson');
    assert.equal(profile.last_name, 'Matsiko');
    assert.equal(profile.country_of_birth, 'Uganda');
    assert.equal(profile.gender, 'MALE');
    assert.equal(profile.physical_address, 'Kampala, Uganda');
  });

  test('rejects invalid profile fields without saving them', async () => {
    await assert.rejects(
      saveApplicationProfile(applicantId, { countryOfBirth: 'Atlantis' }),
      (error) => error instanceof ApplicationError && Boolean(error.fields.countryOfBirth),
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

  test('stores, lists, retrieves, and deletes an applicant document', async () => {
    const pdf = Buffer.from('%PDF-1.7 test document');
    const saved = await saveApplicationDocument(applicantId, 'C:\\fakepath\\transcript.pdf', pdf, 'application/pdf');

    assert.equal(saved.filename, 'transcript.pdf');
    assert.equal(saved.mime_type, 'application/pdf');
    assert.equal(saved.size, pdf.length);
    assert.deepEqual(await listApplicationDocuments(applicantId), [saved]);
    assert.deepEqual((await getApplicationDocument(applicantId, saved.id)).data, pdf);
    assert.equal(await getApplicationDocument(applicantId + 1, saved.id), undefined);
    assert.equal(await deleteApplicationDocument(applicantId + 1, saved.id), false);
    assert.equal(await deleteApplicationDocument(applicantId, saved.id), true);
    assert.deepEqual(await listApplicationDocuments(applicantId), []);
  });

  test('rejects invalid documents and files over 10 MB', async () => {
    await assert.rejects(
      saveApplicationDocument(applicantId, 'fake.pdf', Buffer.from('not a PDF'), 'application/pdf'),
      (error) => error instanceof ApplicationError && error.code === 'INVALID_DOCUMENT',
    );
    await assert.rejects(
      saveApplicationDocument(applicantId, 'large.pdf', Buffer.alloc(MAX_DOCUMENT_BYTES + 1), 'application/pdf'),
      (error) => error instanceof ApplicationError && error.code === 'INVALID_DOCUMENT',
    );
  });
});
