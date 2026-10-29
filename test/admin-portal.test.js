'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaims-admin-test-'));
process.env.DB_PATH = path.join(tmpDir, 'admin.db');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-for-admin-portal';
process.env.ACMIS_API_BASE_URL = 'https://acmis.example.test';
process.env.ACMIS_PORTAL_TOKEN = 'test-only-acmis-token-with-more-than-32-characters';

const db = require('../src/db');
const { app } = require('../server');

let server;
let baseUrl;
let applicantId;
let portalSourceApplicationId;
let originalDocumentId;

function cookieFrom(response) {
  const cookie = response.headers.get('set-cookie');
  return cookie ? cookie.split(';', 1)[0] : undefined;
}

async function csrf(endpoint, cookie) {
  const response = await fetch(`${baseUrl}${endpoint}`, { headers: cookie ? { Cookie: cookie } : {} });
  assert.equal(response.status, 200);
  const payload = await response.json();
  return { cookie: cookieFrom(response) || cookie, token: payload.data.token };
}

async function loginAdmin(email = 'admin@example.test', password = 'Administrator-password-123') {
  const initial = await csrf('/api/admin/csrf');
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: {
      Cookie: initial.cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': initial.token,
    },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const cookie = cookieFrom(response);
  assert.ok(cookie && cookie.startsWith('eaims.admin.sid='));
  return { cookie, token: payload.data.csrfToken, admin: payload.data.admin };
}

async function loginApplicant() {
  const initial = await csrf('/api/auth/csrf');
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      Cookie: initial.cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': initial.token,
    },
    body: JSON.stringify({ identifier: 'applicant@example.test', password: 'Applicant-password-123' }),
  });
  assert.equal(response.status, 200);
  const cookie = cookieFrom(response);
  return { cookie, token: (await csrf('/api/auth/csrf', cookie)).token };
}

async function adminRequest(session, endpoint, options = {}) {
  const headers = { Cookie: session.cookie, ...(options.headers || {}) };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = options.noCsrf ? '' : session.token;
  }
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { response, payload: response.headers.get('content-type')?.includes('application/json') ? await response.json() : null };
}

before(async () => {
  await db.migrate();
  const adminHash = await bcrypt.hash('Administrator-password-123', 4);
  const reviewerHash = await bcrypt.hash('Reviewer-password-123', 4);
  await db.run(
    'INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, ?)',
    ['admin@example.test', adminHash, 'superadmin'],
  );
  await db.run(
    'INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, ?)',
    ['reviewer@example.test', reviewerHash, 'reviewer'],
  );
  const applicantHash = await bcrypt.hash('Applicant-password-123', 4);
  const result = await db.run(
    `INSERT INTO applicants
      (application_number, surname, other_names, email, phone, password_hash, is_verified)
     VALUES ('EAIMS-2026-000001', 'Applicant', 'Test', 'applicant@example.test', '+256700100100', ?, 1)`,
    [applicantHash],
  );
  applicantId = result.id;
  await db.run(
    `INSERT INTO application_profiles
      (applicant_id, first_name, last_name, id_number, country_of_birth, date_of_birth,
       gender, physical_address, next_of_kin_name, next_of_kin_contact)
     VALUES (?, 'Test', 'Applicant', 'ID12345', 'Uganda', '1990-01-01',
       'FEMALE', 'Kampala', 'Kin Name', '+256700100101')`,
    [applicantId],
  );
  await db.run(
    `INSERT INTO application_program_selections (applicant_id, program_id, intake)
     VALUES (?, 'diploma-business-administration', 'March')`,
    [applicantId],
  );
  await db.run(
    `INSERT INTO application_submissions (applicant_id, status, source_application_id)
     VALUES (?, 'submitted', ?)`,
    [applicantId, (portalSourceApplicationId = crypto.randomUUID())],
  );
  originalDocumentId = (await db.run(
    `INSERT INTO application_documents
      (applicant_id, category, original_name, mime_type, file_size, file_data)
     VALUES (?, 'identity', 'identity.pdf', 'application/pdf', 9, ?)`,
    [applicantId, Buffer.from('%PDF-test')],
  )).id;
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('admin sessions are isolated from applicant sessions and require CSRF for writes', async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/admin/dashboard`);
  assert.equal(unauthenticated.status, 401);

  const applicant = await loginApplicant();
  const applicantAdminAccess = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: applicant.cookie },
  });
  assert.equal(applicantAdminAccess.status, 401);

  const admin = await loginAdmin();
  const applicantAreaAccess = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { Cookie: admin.cookie },
  });
  assert.equal(applicantAreaAccess.status, 401);

  const noCsrf = await adminRequest(admin, '/api/admin/announcements', {
    method: 'POST',
    body: { title: 'Test', body: 'Message' },
    noCsrf: true,
  });
  assert.equal(noCsrf.response.status, 403);
});

test('applicants can view and submit only their own ACMIS information requests', async () => {
  const applicant = await loginApplicant();
  const requestId = crypto.randomUUID();
  await db.run(
    `INSERT INTO acmis_information_requests
     (applicant_id, source_application_id, acmis_request_id, requested_items_json,
      applicant_message, due_at, created_at)
     VALUES (?, 'portal-app-1', ?, ?, 'Confirm your current address.', NULL, ?)`,
    [
      applicantId,
      requestId,
      JSON.stringify([{ type: 'field', key: 'currentAddress', label: 'Current address' }]),
      new Date().toISOString(),
    ],
  );
  const visible = await fetch(`${baseUrl}/api/application/information-requests`, {
    headers: { Cookie: applicant.cookie },
  });
  assert.equal(visible.status, 200);
  const visiblePayload = await visible.json();
  assert.equal(visiblePayload.data.requests[0].id, requestId);

  const noCsrf = await fetch(`${baseUrl}/api/application/information-requests/${requestId}/responses`, {
    method: 'POST',
    headers: { Cookie: applicant.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: { currentAddress: 'Kampala' } }),
  });
  assert.equal(noCsrf.status, 403);

  const submitted = await fetch(`${baseUrl}/api/application/information-requests/${requestId}/responses`, {
    method: 'POST',
    headers: {
      Cookie: applicant.cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': applicant.token,
    },
    body: JSON.stringify({ values: { currentAddress: 'Kampala, Uganda' } }),
  });
  assert.equal(submitted.status, 202);
  const submittedPayload = await submitted.json();
  assert.equal(submittedPayload.data.response.deliveryStatus, 'pending');

  const otherApplicantId = (await db.run(
    `INSERT INTO applicants
     (surname, other_names, email, phone, password_hash)
     VALUES ('Other', 'Applicant', 'other-portal@example.test', '+256700100101', 'hash')`,
  )).id;
  const otherRequestId = crypto.randomUUID();
  await db.run(
    `INSERT INTO acmis_information_requests
     (applicant_id, source_application_id, acmis_request_id, requested_items_json,
      applicant_message, created_at)
     VALUES (?, 'portal-app-2', ?, ?, 'Provide an address.', ?)`,
    [
      otherApplicantId,
      otherRequestId,
      JSON.stringify([{ type: 'field', key: 'address' }]),
      new Date().toISOString(),
    ],
  );
  const inaccessible = await fetch(`${baseUrl}/api/application/information-requests/${otherRequestId}/responses`, {
    method: 'POST',
    headers: {
      Cookie: applicant.cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': applicant.token,
    },
    body: JSON.stringify({ values: { address: 'Kampala' } }),
  });
  assert.equal(inaccessible.status, 404);
  await db.run('DELETE FROM applicants WHERE id = ?', [otherApplicantId]);
});

test('ACMIS can retrieve only submitted application documents through its integration token', async () => {
  const endpoint = (sourceApplicationId, sourceDocumentId) => (
    `${baseUrl}/api/integrations/acmis/applications/${encodeURIComponent(sourceApplicationId)}`
      + `/documents/${encodeURIComponent(sourceDocumentId)}`
  );
  const correlationId = crypto.randomUUID();
  const unauthorized = await fetch(endpoint(portalSourceApplicationId, `portal-document-${originalDocumentId}`));
  assert.equal(unauthorized.status, 401);

  const original = await fetch(
    endpoint(portalSourceApplicationId, `portal-document-${originalDocumentId}`),
    {
      headers: {
        Authorization: `Bearer ${process.env.ACMIS_PORTAL_TOKEN}`,
        'X-Correlation-ID': correlationId,
      },
    },
  );
  assert.equal(original.status, 200);
  assert.equal(original.headers.get('content-type'), 'application/pdf');
  assert.equal(original.headers.get('cache-control'), 'private, no-store');
  assert.equal(original.headers.get('x-content-type-options'), 'nosniff');
  assert.match(original.headers.get('content-disposition'), /identity\.pdf/);
  assert.equal(await original.text(), '%PDF-test');

  const requestId = crypto.randomUUID();
  await db.run(
    `INSERT INTO acmis_information_requests
     (applicant_id, source_application_id, acmis_request_id, requested_items_json,
      applicant_message, created_at)
     VALUES (?, ?, ?, ?, 'Upload your supporting document.', ?)`,
    [
      applicantId,
      portalSourceApplicationId,
      requestId,
      JSON.stringify([{ type: 'document', key: 'proof', label: 'Proof' }]),
      new Date().toISOString(),
    ],
  );
  const supplementalDocumentId = (await db.run(
    `INSERT INTO acmis_supplemental_documents
     (applicant_id, request_id, original_name, mime_type, file_size, file_data)
     VALUES (?, (SELECT id FROM acmis_information_requests WHERE acmis_request_id = ?),
       'proof.pdf', 'application/pdf', 13, ?)`,
    [applicantId, requestId, Buffer.from('%PDF-proof-123')],
  )).id;
  await db.run(
    `INSERT INTO acmis_information_responses
     (request_id, source_response_id, values_json, supplemental_document_ids_json, submitted_at)
     VALUES ((SELECT id FROM acmis_information_requests WHERE acmis_request_id = ?),
       ?, '{}', ?, ?)`,
    [
      requestId,
      crypto.randomUUID(),
      JSON.stringify([`portal-supplemental-document-${supplementalDocumentId}`]),
      new Date().toISOString(),
    ],
  );
  const supplemental = await fetch(
    endpoint(portalSourceApplicationId, `portal-supplemental-document-${supplementalDocumentId}`),
    { headers: { Authorization: `Bearer ${process.env.ACMIS_PORTAL_TOKEN}` } },
  );
  assert.equal(supplemental.status, 200);
  assert.equal(await supplemental.text(), '%PDF-proof-123');

  const missing = await fetch(
    endpoint(portalSourceApplicationId, 'portal-document-999999'),
    {
      headers: {
        Authorization: `Bearer ${process.env.ACMIS_PORTAL_TOKEN}`,
        'X-Correlation-ID': '12345678-1234-1234-1234-123456789012',
      },
    },
  );
  assert.equal(missing.status, 404);

  const otherApplicantId = (await db.run(
    `INSERT INTO applicants
     (surname, other_names, email, phone, password_hash)
     VALUES ('Other', 'Applicant', 'document-owner@example.test', '+256700100102', 'hash')`,
  )).id;
  const otherSourceApplicationId = crypto.randomUUID();
  await db.run(
    `INSERT INTO application_submissions (applicant_id, status, source_application_id)
     VALUES (?, 'submitted', ?)`,
    [otherApplicantId, otherSourceApplicationId],
  );
  const crossApplicationOriginal = await fetch(
    endpoint(otherSourceApplicationId, `portal-document-${originalDocumentId}`),
    { headers: { Authorization: `Bearer ${process.env.ACMIS_PORTAL_TOKEN}` } },
  );
  assert.equal(crossApplicationOriginal.status, 404);
  const crossApplicationSupplemental = await fetch(
    endpoint(otherSourceApplicationId, `portal-supplemental-document-${supplementalDocumentId}`),
    { headers: { Authorization: `Bearer ${process.env.ACMIS_PORTAL_TOKEN}` } },
  );
  assert.equal(crossApplicationSupplemental.status, 404);

  const audit = await db.all(
    `SELECT source_application_id, source_document_id, correlation_id, result_code
     FROM acmis_document_access_audit
     ORDER BY id`,
  );
  assert.deepEqual(
    audit.map((item) => item.result_code),
    ['served', 'served', 'not_found', 'not_found', 'not_found'],
  );
  assert.equal(audit[0].source_application_id, portalSourceApplicationId);
  assert.equal(audit[0].correlation_id, correlationId);
  assert.equal(audit[1].source_document_id, `portal-supplemental-document-${supplementalDocumentId}`);
  assert.match(audit[2].correlation_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(audit[4].source_application_id, otherSourceApplicationId);
  await db.run('DELETE FROM applicants WHERE id = ?', [otherApplicantId]);
});

test('admin dashboard, catalogue management, announcements, and reports work', async () => {
  const admin = await loginAdmin();
  const { response: dashboardResponse, payload: dashboard } = await adminRequest(admin, '/api/admin/dashboard');
  assert.equal(dashboardResponse.status, 200);
  assert.equal(dashboard.data.registrations, 1);
  assert.equal(dashboard.data.submittedApplications, 1);

  const { payload: catalogue } = await adminRequest(admin, '/api/admin/programs');
  assert.equal(catalogue.data.programs.length, 32);
  const { payload: existingIntakes } = await adminRequest(admin, '/api/admin/intakes');
  assert.deepEqual(existingIntakes.data.intakes.map((intake) => intake.name).sort(), ['August', 'March']);

  const newIntake = await adminRequest(admin, '/api/admin/intakes', {
    method: 'POST',
    body: { name: 'November 2026', openingDate: '', closingDate: '', isOpen: true },
  });
  assert.equal(newIntake.response.status, 201);
  const newProgram = await adminRequest(admin, '/api/admin/programs', {
    method: 'POST',
    body: {
      level: 'Certificate',
      name: 'Certificate in Test Studies',
      duration: '1 year',
      tuition: '',
      eligibility: 'Test eligibility',
      isActive: true,
      intakes: ['November 2026'],
    },
  });
  assert.equal(newProgram.response.status, 201);
  const applicant = await loginApplicant();
  const profile = await fetch(`${baseUrl}/api/application/profile`, {
    headers: { Cookie: applicant.cookie },
  });
  const profilePayload = await profile.json();
  assert.equal(profilePayload.data.intakes.includes('November 2026'), true);
  assert.equal(profilePayload.data.programs.some((program) => program.name === 'Certificate in Test Studies'), true);

  const announcement = await adminRequest(admin, '/api/admin/announcements', {
    method: 'POST',
    body: { title: 'Application update', body: 'Applications close soon.' },
  });
  assert.equal(announcement.response.status, 201);
  const applicantDashboard = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { Cookie: applicant.cookie },
  });
  assert.equal((await applicantDashboard.json()).data.announcements[0].title, 'Application update');

  const report = await fetch(`${baseUrl}/api/admin/reports/applications.csv`, {
    headers: { Cookie: admin.cookie },
  });
  assert.equal(report.status, 200);
  assert.match(report.headers.get('content-type'), /text\/csv/);
  assert.match(await report.text(), /EAIMS-2026-000001/);

  const document = await fetch(`${baseUrl}/api/admin/applicants/${applicantId}/documents/1`, {
    headers: { Cookie: admin.cookie },
  });
  assert.equal(document.status, 200);
  assert.equal(await document.text(), '%PDF-test');
});

test('application reviewers can progress application status but cannot manage staff', async () => {
  const reviewer = await loginAdmin('reviewer@example.test', 'Reviewer-password-123');
  const forbidden = await adminRequest(reviewer, '/api/admin/staff');
  assert.equal(forbidden.response.status, 403);

  const updated = await adminRequest(reviewer, `/api/admin/applications/${applicantId}/status`, {
    method: 'PATCH',
    body: { status: 'in_review' },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.payload.data.application.status, 'in_review');
  const applicant = await loginApplicant();
  const dashboard = await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: applicant.cookie } });
  const payload = await dashboard.json();
  assert.equal(payload.data.application.status, 'in_review');
  assert.equal(payload.data.notifications.items.some((item) => item.status === 'in_review'), true);
});
