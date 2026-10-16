'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaims-auth-route-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test-auth-routes.db');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-for-auth-routes';

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

before(async () => {
  await db.migrate();
  const passwordHash = await bcrypt.hash('Applicant-password-123', 4);
  await db.run(
    `INSERT INTO applicants
      (surname, other_names, email, phone, password_hash, is_verified)
     VALUES ('Test', 'Applicant', 'logout@example.com', '+256700000000', ?, 1)`,
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

test('logout destroys the authenticated session and returns the applicant to login', async () => {
  const initialCsrf = await getCsrfToken();
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      Cookie: initialCsrf.cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': initialCsrf.token,
    },
    body: JSON.stringify({ identifier: 'logout@example.com', password: 'Applicant-password-123' }),
  });
  assert.equal(loginResponse.status, 200);
  let cookie = sessionCookie(loginResponse);
  assert.ok(cookie);

  const dashboardResponse = await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: cookie } });
  assert.equal(dashboardResponse.status, 200);

  const logoutCsrf = await getCsrfToken(cookie);
  cookie = logoutCsrf.cookie;
  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookie, 'X-CSRF-Token': logoutCsrf.token },
  });
  assert.equal(logoutResponse.status, 200);
  assert.equal((await readPayload(logoutResponse)).data.redirect, '/login.html');

  const protectedResponse = await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: cookie } });
  assert.equal(protectedResponse.status, 401);
});
