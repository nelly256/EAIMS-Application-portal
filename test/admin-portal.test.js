'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaims-admin-test-'));
process.env.DB_PATH = path.join(tmpDir, 'admin.db');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-for-admin-portal';

const db = require('../src/db');
const { app } = require('../server');

let server;
let baseUrl;
let applicantId;

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
    "INSERT INTO application_submissions (applicant_id, status) VALUES (?, 'submitted')",
    [applicantId],
  );
  await db.run(
    `INSERT INTO application_documents
      (applicant_id, category, original_name, mime_type, file_size, file_data)
     VALUES (?, 'identity', 'identity.pdf', 'application/pdf', 9, ?)`,
    [applicantId, Buffer.from('%PDF-test')],
  );
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
