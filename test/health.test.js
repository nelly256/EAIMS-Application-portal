'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaims-health-test-'));
process.env.DB_PATH = path.join(tmpDir, 'health.db');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-for-health-routes';

const db = require('../src/db');
const { app, shutdown } = require('../server');

let server;
let baseUrl;
let databaseClosed = false;

before(async () => {
  await db.migrate();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server && server.listening) {
    await shutdown(server);
    databaseClosed = true;
  } else if (!databaseClosed) {
    await db.close();
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('liveness health check is public, cache-disabled, and does not create a session', async () => {
  const response = await fetch(`${baseUrl}/health/live`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), { status: 'alive' });
});

test('readiness health check verifies the database without exposing secrets', async () => {
  const response = await fetch(`${baseUrl}/health/ready`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), {
    status: 'ready',
    checks: { database: 'ok', chatbot: 'local-fallback' },
  });
});

test('graceful shutdown closes the HTTP listener and database', async () => {
  await shutdown(server);
  databaseClosed = true;
  assert.equal(server.listening, false);
});
