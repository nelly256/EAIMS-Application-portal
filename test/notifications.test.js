'use strict';

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.SMTP_HOST = 'localhost';
process.env.SMTP_PORT = '587';
process.env.SMTP_FROM = 'noreply@test.com';
process.env.SMS_API_KEY = 'test-key';
process.env.SMS_API_URL = 'http://localhost:9999/sms';
process.env.SMS_FROM = '';
process.env.SMS_PROVIDER = 'default';
process.env.SMS_USERNAME = '';
process.env.SMS_TIMEOUT_MS = '5000';
process.env.OTP_EXPIRY_MINUTES = '10';

const nodemailerPath = require.resolve('nodemailer');
const sentEmails = [];
const mockTransporter = {
  sendMail(mail) {
    sentEmails.push(mail);
    return Promise.resolve({ messageId: 'test-msg-id' });
  },
};
require.cache[nodemailerPath] = {
  id: nodemailerPath,
  filename: nodemailerPath,
  loaded: true,
  exports: { createTransport: () => mockTransporter },
};

const fetchCalls = [];
let fetchResponse = { ok: true, status: 200 };
let fetchImplementation = async () => fetchResponse;
global.fetch = async (url, options) => {
  const result = await fetchImplementation(url, options);
  fetchCalls.push({ url, options, response: result });
  return result;
};

const { sendEmail, sendSms, sendVerification } = require('../src/services/notifications');

describe('sendEmail', () => {
  beforeEach(() => {
    sentEmails.length = 0;
  });

  test('sends email with correct fields when SMTP is configured', async () => {
    const result = await sendEmail({
      to: 'user@example.com',
      subject: 'Test Subject',
      text: 'Test body',
      html: '<p>Test body</p>',
    });
    assert.equal(result.sent, true);
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].from, 'noreply@test.com');
    assert.equal(sentEmails[0].to, 'user@example.com');
    assert.equal(sentEmails[0].subject, 'Test Subject');
    assert.equal(sentEmails[0].text, 'Test body');
    assert.equal(sentEmails[0].html, '<p>Test body</p>');
  });

  test('returns SMTP_ERROR reason when sendMail throws', async () => {
    const originalSend = mockTransporter.sendMail;
    mockTransporter.sendMail = () => Promise.reject(new Error('Connection refused'));
    const result = await sendEmail({ to: 'user@example.com', subject: 'Test', text: 'Test' });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'SMTP_ERROR');
    assert.equal(result.error, 'Connection refused');
    mockTransporter.sendMail = originalSend;
  });
});

describe('sendSms', () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    fetchResponse = { ok: true, status: 200 };
    fetchImplementation = async () => fetchResponse;
  });

  test('sends SMS to the configured API URL with Bearer auth', async () => {
    const result = await sendSms({ to: '+256700000000', message: 'Hello OTP' });
    assert.equal(result.sent, true);
    assert.equal(result.status, 200);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'http://localhost:9999/sms');
    const body = JSON.parse(fetchCalls[0].options.body);
    assert.equal(body.to, '+256700000000');
    assert.equal(body.message, 'Hello OTP');
    assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer test-key');
    assert.equal(fetchCalls[0].options.headers['Content-Type'], 'application/json');
  });

  test('includes sender ID when configured', async () => {
    const configPath = require.resolve('../src/config');
    const notificationsPath = require.resolve('../src/services/notifications');
    const originalFrom = process.env.SMS_FROM;
    process.env.SMS_FROM = 'EAIMS';
    delete require.cache[configPath];
    delete require.cache[notificationsPath];
    const { sendSms: sendSmsWithFrom } = require(notificationsPath);
    const result = await sendSmsWithFrom({ to: '+256700000000', message: 'Hello' });
    assert.equal(result.sent, true);
    const body = JSON.parse(fetchCalls[fetchCalls.length - 1].options.body);
    assert.equal(body.from, 'EAIMS');
    process.env.SMS_FROM = originalFrom;
    delete require.cache[configPath];
    delete require.cache[notificationsPath];
  });

  test('returns SMS_TIMEOUT when API does not respond', async () => {
    const configPath = require.resolve('../src/config');
    const notificationsPath = require.resolve('../src/services/notifications');
    const originalTimeout = process.env.SMS_TIMEOUT_MS;
    process.env.SMS_TIMEOUT_MS = '200';
    fetchImplementation = async () => new Promise(() => {});
    delete require.cache[configPath];
    delete require.cache[notificationsPath];
    const { sendSms: sendSmsFastTimeout } = require(notificationsPath);
    const result = await sendSmsFastTimeout({ to: '+256700000000', message: 'Hello' });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'SMS_TIMEOUT');
    fetchImplementation = async () => fetchResponse;
    process.env.SMS_TIMEOUT_MS = originalTimeout;
    delete require.cache[configPath];
    delete require.cache[notificationsPath];
  });

  test('returns SMS_API_ERROR on non-2xx response', async () => {
    fetchResponse = { ok: false, status: 401, text: () => Promise.resolve('{"error":"invalid api key"}') };
    const result = await sendSms({ to: '+256700000000', message: 'Hello' });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'SMS_API_ERROR');
    assert.equal(result.status, 401);
    assert.ok(result.error.includes('invalid api key'));
  });

  test('returns SMS_NETWORK_ERROR when fetch throws', async () => {
    fetchImplementation = async () => { throw new Error('ECONNREFUSED'); };
    const result = await sendSms({ to: '+256700000000', message: 'Hello' });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'SMS_NETWORK_ERROR');
    assert.equal(result.error, 'ECONNREFUSED');
  });
});

describe('sendVerification', () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    fetchResponse = { ok: true, status: 200 };
    fetchImplementation = async () => fetchResponse;
    sentEmails.length = 0;
  });

  test('sends both email and SMS when applicant has both', async () => {
    const delivery = await sendVerification(
      { email: 'user@example.com', phone: '+256700000000' },
      '123456',
    );
    assert.equal(delivery.email.sent, true);
    assert.equal(delivery.email.messageId, 'test-msg-id');
    assert.equal(delivery.sms.sent, true);
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, 'user@example.com');
    assert.ok(sentEmails[0].text.includes('123456'));
    assert.equal(fetchCalls.length, 1);
    const smsBody = JSON.parse(fetchCalls[0].options.body);
    assert.equal(smsBody.to, '+256700000000');
    assert.ok(smsBody.message.includes('123456'));
  });

  test('sends only email when phone is missing', async () => {
    const delivery = await sendVerification({ email: 'user@example.com' }, '123456');
    assert.equal(delivery.email.sent, true);
    assert.equal(delivery.sms.sent, false);
    assert.equal(delivery.sms.reason, 'PHONE_NOT_AVAILABLE');
    assert.equal(sentEmails.length, 1);
    assert.equal(fetchCalls.length, 0);
  });

  test('sends only SMS when email is missing', async () => {
    const delivery = await sendVerification({ phone: '+256700000000' }, '123456');
    assert.equal(delivery.email.sent, false);
    assert.equal(delivery.email.reason, 'EMAIL_NOT_AVAILABLE');
    assert.equal(delivery.sms.sent, true);
    assert.equal(sentEmails.length, 0);
    assert.equal(fetchCalls.length, 1);
  });

  test('returns not-available when applicant has neither email nor phone', async () => {
    const delivery = await sendVerification({}, '123456');
    assert.equal(delivery.email.sent, false);
    assert.equal(delivery.email.reason, 'EMAIL_NOT_AVAILABLE');
    assert.equal(delivery.sms.sent, false);
    assert.equal(delivery.sms.reason, 'PHONE_NOT_AVAILABLE');
    assert.equal(sentEmails.length, 0);
    assert.equal(fetchCalls.length, 0);
  });

  test('includes expiry minutes in the message', async () => {
    const delivery = await sendVerification(
      { email: 'user@example.com', phone: '+256700000000' },
      '123456',
    );
    assert.ok(sentEmails[0].text.includes('10 minutes'));
    const smsBody = JSON.parse(fetchCalls[0].options.body);
    assert.ok(smsBody.message.includes('10 minutes'));
  });

  test('includes applicant name in the email template', async () => {
    const delivery = await sendVerification(
      { email: 'user@example.com', phone: '+256700000000', surname: 'Kato', otherNames: 'John' },
      '123456',
    );
    assert.ok(sentEmails[0].text.includes('Kato John'), 'email text should include full name');
    assert.ok(sentEmails[0].html.includes('Kato John'), 'email html should include full name');
  });

  test('uses surname only when otherNames is missing', async () => {
    const delivery = await sendVerification(
      { email: 'user@example.com', phone: '+256700000000', surname: 'Amin' },
      '123456',
    );
    assert.ok(sentEmails[0].html.includes('Dear Amin,'), 'email should address applicant by surname');
  });

  test('normalizes Ugandan phone number before sending SMS', async () => {
    const delivery = await sendVerification(
      { email: 'user@example.com', phone: '0772123456', phoneCountryCode: '+256' },
      '123456',
    );
    assert.equal(delivery.email.sent, true);
    assert.equal(delivery.sms.sent, true);
    assert.equal(fetchCalls.length, 1);
    const smsBody = JSON.parse(fetchCalls[0].options.body);
    assert.equal(smsBody.to, '+256772123456', 'phone number should be normalized to +256 format');
  });

  test('email delivery succeeds even when SMS fails', async () => {
    fetchResponse = { ok: false, status: 401, text: () => Promise.resolve('{"error":"auth failed"}') };
    const delivery = await sendVerification(
      { email: 'user@example.com', phone: '+256700000000' },
      '123456',
    );
    assert.equal(delivery.email.sent, true, 'email should still be sent even when SMS fails');
    assert.equal(delivery.sms.sent, false);
    assert.equal(delivery.sms.reason, 'SMS_API_ERROR');
    assert.equal(sentEmails.length, 1);
  });
});

describe('sendSms with africasTalking provider', () => {
  before(() => {
    process.env.SMS_PROVIDER = 'africasTalking';
    process.env.SMS_USERNAME = 'testatuser';
    process.env.SMS_API_KEY = 'test-at-key';
    process.env.SMS_FROM = 'EAIMS';
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/services/notifications')];
  });

  after(() => {
    process.env.SMS_PROVIDER = 'default';
    process.env.SMS_USERNAME = '';
    process.env.SMS_FROM = '';
    delete require.cache[require.resolve('../src/config')];
  });

  beforeEach(() => {
    fetchCalls.length = 0;
    fetchResponse = { ok: true, status: 200 };
    fetchImplementation = async () => fetchResponse;
    sentEmails.length = 0;
  });

  test('uses Basic auth and form data when provider is africasTalking', async () => {
    const { sendSms } = require('../src/services/notifications');
    const result = await sendSms({ to: '+256700000000', message: 'Hello AT' });
    assert.equal(result.sent, true);
    const call = fetchCalls[0];
    assert.equal(call.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(call.options.headers.Authorization, 'Basic ' + Buffer.from('testatuser:test-at-key').toString('base64'));
    assert.ok(typeof call.options.body === 'string');
    const bodyParams = new URLSearchParams(call.options.body);
    assert.equal(bodyParams.get('to'), '+256700000000');
    assert.equal(bodyParams.get('message'), 'Hello AT');
    assert.equal(bodyParams.get('username'), 'testatuser');
    assert.equal(bodyParams.get('from'), 'EAIMS');
  });
});

describe('testSmtpConnection', () => {
  const { testSmtpConnection } = require('../src/services/notifications');
  const configPath = require.resolve('../src/config');
  const notificationsPath = require.resolve('../src/services/notifications');

  test('returns configured=false when SMTP_HOST is not set', async () => {
    process.env.SMTP_HOST = '';
    delete require.cache[configPath];
    delete require.cache[notificationsPath];
    const { testSmtpConnection: testNoSmtp } = require(notificationsPath);
    const result = await testNoSmtp(null);
    assert.equal(result.configured, false);
    assert.ok(result.message.includes('not set'));
    process.env.NODE_ENV = 'test';
    process.env.SMTP_HOST = 'localhost';
    delete require.cache[configPath];
    delete require.cache[notificationsPath];
  });

  test('returns success results when SMTP is configured and transporter verifies', async () => {
    mockTransporter.verify = (callback) => callback(null);
    const result = await testSmtpConnection(null);
    assert.equal(result.configured, true);
    assert.equal(result.smtpConnection, 'SMTP connection successful');
    assert.equal(result.smtpAuth, 'SMTP authentication successful');
    assert.equal(result.smtpSend, 'Skipped (no test email provided)');
  });

  test('sends test email when email provided and SMTP succeeds', async () => {
    mockTransporter.verify = (callback) => callback(null);
    mockTransporter.sendMail = (mail) => {
      sentEmails.push(mail);
      return Promise.resolve({ messageId: 'test-send-id' });
    };
    const result = await testSmtpConnection('admin@test.com');
    assert.equal(result.configured, true);
    assert.equal(result.smtpSend, 'Test email accepted and sent');
    assert.equal(result.messageId, 'test-send-id');
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, 'admin@test.com');
  });

  test('returns failure when SMTP verification fails', async () => {
    mockTransporter.verify = (callback) => callback(new Error('Connection refused'));
    const result = await testSmtpConnection(null);
    assert.equal(result.configured, true);
    assert.equal(result.smtpConnection, 'SMTP connection failed');
    assert.equal(result.smtpAuth, 'SMTP authentication failed');
    assert.equal(result.error, 'Connection refused');
  });
});
