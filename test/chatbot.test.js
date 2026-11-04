'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaims-chatbot-test-'));
process.env.DB_PATH = path.join(tmpDir, 'chatbot.db');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-for-chatbot-routes';
process.env.GROQ_API_KEY = '';
process.env.GROQ_MODEL = '';
process.env.CHATBOT_MAX_MESSAGES_PER_HOUR = '100';

const db = require('../src/db');
const { app } = require('../server');

let server;
let baseUrl;
let agentId;
let applicantOneId;
let applicantTwoId;

function sessionCookie(response) {
  const cookie = response.headers.get('set-cookie');
  return cookie ? cookie.split(';', 1)[0] : undefined;
}

async function getCsrf(endpoint, cookie) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  return { token: payload.data.token, cookie: sessionCookie(response) || cookie };
}

async function postJson(endpoint, body, csrf) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      Cookie: csrf.cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf.token,
    },
    body: JSON.stringify(body || {}),
  });
  return { response, payload: await response.json() };
}

async function applicantSession(email) {
  const csrf = await getCsrf('/api/auth/csrf');
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      Cookie: csrf.cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf.token,
    },
    body: JSON.stringify({ identifier: email, password: 'Applicant-password-123' }),
  });
  assert.equal(response.status, 200);
  const cookie = sessionCookie(response);
  assert.ok(cookie);
  return getCsrf('/api/chat/csrf', cookie);
}

before(async () => {
  await db.migrate();
  const applicantHash = await bcrypt.hash('Applicant-password-123', 4);
  const first = await db.run(
    `INSERT INTO applicants
      (application_number, surname, other_names, email, phone, password_hash, is_verified)
     VALUES ('EAIMS-2026-000001', 'First', 'Applicant', 'first@example.test', '+256700000011', ?, 1)`,
    [applicantHash],
  );
  applicantOneId = first.id;
  const second = await db.run(
    `INSERT INTO applicants
      (application_number, surname, other_names, email, phone, password_hash, is_verified)
     VALUES ('EAIMS-2026-000002', 'Second', 'Applicant', 'second@example.test', '+256700000012', ?, 1)`,
    [applicantHash],
  );
  applicantTwoId = second.id;

  const agentHash = await bcrypt.hash('Support-agent-password-123', 4);
  const agent = await db.run(
    `INSERT INTO support_agents (email, password_hash)
     VALUES ('agent@example.test', ?)`,
    [agentHash],
  );
  agentId = agent.id;

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('known portal questions receive a grounded answer and unsupported questions enter human handoff', async () => {
  const csrf = await getCsrf('/api/chat/csrf');
  const known = await postJson('/api/chat/messages', { message: 'What programs are offered?' }, csrf);
  assert.equal(known.response.status, 200);
  assert.equal(known.payload.data.status, 'bot');
  assert.match(
    known.payload.data.messages.find((message) => message.sender === 'assistant').content,
    /Diploma in Business Administration/,
  );

  const unsupported = await postJson(
    '/api/chat/messages',
    { message: 'Can you tell me my horoscope for Aquarius?' },
    csrf,
  );
  assert.equal(unsupported.response.status, 200);
  assert.equal(unsupported.payload.data.status, 'pending_human');
  assert.ok(unsupported.payload.data.messages.some((message) => message.sender === 'system'));
});

test('AI-provider failures are reported and the conversation is escalated', async () => {
  const config = require('../src/config');
  const originalFetch = global.fetch;
  const originalKey = config.chatbot.groqApiKey;
  const originalModel = config.chatbot.groqModel;
  config.chatbot.groqApiKey = 'test-key';
  config.chatbot.groqModel = 'test-model';
  global.fetch = (url, options) => String(url).startsWith('https://api.groq.com/')
    ? Promise.reject(new Error('simulated provider outage'))
    : originalFetch(url, options);

  try {
    const csrf = await getCsrf('/api/chat/csrf');
    const result = await postJson(
      '/api/chat/messages',
      { message: 'What is the duration of Diploma in Business Administration?' },
      csrf,
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.data.status, 'pending_human');
    assert.ok(result.payload.data.messages.some((message) => (
      message.sender === 'assistant' && message.content.includes('could not get a reliable answer')
    )));
  } finally {
    global.fetch = originalFetch;
    config.chatbot.groqApiKey = originalKey;
    config.chatbot.groqModel = originalModel;
  }
});

test('support agents can claim and reply while applicant access remains separate', async () => {
  const guest = await getCsrf('/api/chat/csrf');
  const handoff = await postJson('/api/chat/messages', { message: 'Please connect me to a real person.' }, guest);
  assert.equal(handoff.payload.data.status, 'pending_human');
  const conversationId = handoff.payload.data.id;

  const unauthorized = await fetch(`${baseUrl}/api/support/conversations`);
  assert.equal(unauthorized.status, 401);
  const privatePage = await fetch(`${baseUrl}/support/inbox`, { redirect: 'manual' });
  assert.equal(privatePage.status, 302);
  assert.equal(privatePage.headers.get('location'), '/support/login');
  const applicantCookie = (await applicantSession('first@example.test')).cookie;
  const applicantAccess = await fetch(`${baseUrl}/api/support/conversations`, {
    headers: { Cookie: applicantCookie },
  });
  assert.equal(applicantAccess.status, 401);

  const supportCsrf = await getCsrf('/api/support/csrf');
  const login = await postJson('/api/support/login', {
    email: 'agent@example.test',
    password: 'Support-agent-password-123',
  }, supportCsrf);
  assert.equal(login.response.status, 200);
  const supportCookie = sessionCookie(login.response);
  assert.ok(supportCookie);
  const authenticatedSupport = { cookie: supportCookie, token: login.payload.data.csrfToken };

  const conversations = await fetch(`${baseUrl}/api/support/conversations`, {
    headers: { Cookie: supportCookie },
  });
  assert.equal(conversations.status, 200);
  assert.ok((await conversations.json()).data.conversations.some((item) => item.id === conversationId));

  const claim = await postJson(`/api/support/conversations/${conversationId}/claim`, {}, authenticatedSupport);
  assert.equal(claim.response.status, 200);
  const reply = await postJson(
    `/api/support/conversations/${conversationId}/replies`,
    { message: 'An admissions officer will assist you with this question.' },
    authenticatedSupport,
  );
  assert.equal(reply.response.status, 200);

  const visitorResponse = await fetch(`${baseUrl}/api/chat/conversation`, {
    headers: { Cookie: guest.cookie },
  });
  const visitorConversation = (await visitorResponse.json()).data;
  assert.equal(visitorConversation.status, 'in_progress');
  assert.ok(visitorConversation.messages.some((message) => (
    message.sender === 'support' && message.content.includes('admissions officer')
  )));

  const close = await postJson(`/api/support/conversations/${conversationId}/close`, {}, authenticatedSupport);
  assert.equal(close.response.status, 200);
  const closedResponse = await fetch(`${baseUrl}/api/chat/conversation`, {
    headers: { Cookie: guest.cookie },
  });
  assert.equal((await closedResponse.json()).data.status, 'closed');

  const newChat = await postJson('/api/chat/messages', { message: 'When are the available intakes?' }, guest);
  assert.equal(newChat.response.status, 200);
  assert.notEqual(newChat.payload.data.id, conversationId);
});

test('applicant-specific answers stay local and each applicant sees only their own chat', async () => {
  const firstSession = await applicantSession('first@example.test');
  const numberAnswer = await postJson(
    '/api/chat/messages',
    { message: 'What is my application number?' },
    firstSession,
  );
  assert.equal(numberAnswer.response.status, 200);
  assert.match(
    numberAnswer.payload.data.messages.find((message) => message.sender === 'assistant').content,
    /EAIMS-2026-000001/,
  );

  const guestSession = await getCsrf('/api/chat/csrf');
  const guestHandoff = await postJson(
    '/api/chat/messages',
    { message: 'Please connect me to a real person.' },
    guestSession,
  );
  const guestConversationId = guestHandoff.payload.data.id;
  const login = await postJson('/api/auth/login', {
    identifier: 'first@example.test',
    password: 'Applicant-password-123',
  }, guestSession);
  assert.equal(login.response.status, 200);
  const loggedInCookie = sessionCookie(login.response);
  const continuedSession = await getCsrf('/api/chat/csrf', loggedInCookie);
  const continued = await fetch(`${baseUrl}/api/chat/conversation`, {
    headers: { Cookie: continuedSession.cookie },
  });
  assert.equal((await continued.json()).data.id, guestConversationId);

  const secondSession = await applicantSession('second@example.test');
  const otherConversation = await fetch(`${baseUrl}/api/chat/conversation`, {
    headers: { Cookie: secondSession.cookie },
  });
  assert.equal((await otherConversation.json()).data, null);
  assert.notEqual(applicantOneId, applicantTwoId);
});
