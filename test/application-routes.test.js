'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaims-application-route-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test-application-routes.db');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-for-application-routes';

const db = require('../src/db');
const { app } = require('../server');

let server;
let baseUrl;

async function readPayload(response) {
  return response.json();
}

function sessionCookie(response) {
  const cookie = response.headers.get('set-cookie');
  return cookie ? cookie.split(';', 1)[0] : undefined;
}

async function getCsrfToken(cookie) {
  const response = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  assert.equal(response.status, 200);
  const payload = await readPayload(response);
  return { token: payload.data.token, cookie: sessionCookie(response) || cookie };
}

async function login() {
  const initialCsrf = await getCsrfToken();
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      Cookie: initialCsrf.cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': initialCsrf.token,
    },
    body: JSON.stringify({ identifier: 'application@example.com', password: 'Applicant-password-123' }),
  });
  assert.equal(response.status, 200);
  const cookie = sessionCookie(response);
  assert.ok(cookie);
  return getCsrfToken(cookie);
}

before(async () => {
  await db.migrate();
  const passwordHash = await bcrypt.hash('Applicant-password-123', 4);
  await db.run(
    `INSERT INTO applicants
      (surname, other_names, email, phone, password_hash, is_verified)
     VALUES ('Applicant', 'Test', 'application@example.com', '+256700000000', ?, 1)`,
    [passwordHash],
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

test('application profile API saves, validates, and returns the new study details', async () => {
  const csrf = await login();
  const details = {
    trainingArrangements: ['Weekday', 'By Correspondence', 'Weekend'],
    employmentHistory: [
      { position: 'Program Officer', organization: 'EAIMS', fromYear: '2022', toYear: '' },
    ],
    courseReason: 'I want to grow in my field and prepare for leadership.',
  };
  const saveResponse = await fetch(`${baseUrl}/api/application/profile`, {
    method: 'PATCH',
    headers: {
      Cookie: csrf.cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf.token,
    },
    body: JSON.stringify(details),
  });
  assert.equal(saveResponse.status, 200);

  const profileResponse = await fetch(`${baseUrl}/api/application/profile`, {
    headers: { Cookie: csrf.cookie },
  });
  assert.equal(profileResponse.status, 200);
  const profile = (await readPayload(profileResponse)).data.profile;
  assert.deepEqual(profile.trainingArrangements, ['Weekday', 'Weekend', 'By Correspondence']);
  assert.deepEqual(profile.employmentHistory, details.employmentHistory);
  assert.equal(profile.courseReason, details.courseReason);

  const invalidResponse = await fetch(`${baseUrl}/api/application/profile`, {
    method: 'PATCH',
    headers: {
      Cookie: csrf.cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf.token,
    },
    body: JSON.stringify({ trainingArrangements: ['Not a valid arrangement'] }),
  });
  assert.equal(invalidResponse.status, 400);
  const invalidPayload = await readPayload(invalidResponse);
  assert.ok(invalidPayload.error.fields.trainingArrangements);

  const submissionResponse = await fetch(`${baseUrl}/api/application/submit`, {
    method: 'POST',
    headers: {
      Cookie: csrf.cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf.token,
    },
    body: JSON.stringify({}),
  });
  assert.equal(submissionResponse.status, 400);
  const submissionPayload = await readPayload(submissionResponse);
  assert.equal(submissionPayload.error.code, 'APPLICATION_INCOMPLETE');
  assert.ok(submissionPayload.error.fields.programSelection);

  const dashboardResponse = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { Cookie: csrf.cookie },
  });
  assert.equal(dashboardResponse.status, 200);
  assert.deepEqual((await readPayload(dashboardResponse)).data.notifications, { items: [], unreadCount: 0 });

  const markReadResponse = await fetch(`${baseUrl}/api/application/notifications/read`, {
    method: 'POST',
    headers: {
      Cookie: csrf.cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf.token,
    },
    body: JSON.stringify({}),
  });
  assert.equal(markReadResponse.status, 200);
  assert.deepEqual((await readPayload(markReadResponse)).data, { updatedCount: 0 });
});
