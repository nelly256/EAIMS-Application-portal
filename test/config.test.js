'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { validateProductionConfig } = require('../src/config');

function productionSettings(overrides = {}) {
  return {
    nodeEnv: 'production',
    sessionSecret: 'a-secure-session-secret-with-more-than-32-characters',
    appBaseUrl: 'https://portal.eaims.ac.ug',
    chatbot: {
      groqApiKey: '',
      groqModel: '',
    },
    ...overrides,
  };
}

test('production config accepts a secure secret, HTTPS URL, and optional local chatbot', () => {
  assert.doesNotThrow(() => validateProductionConfig(productionSettings()));
});

test('production config rejects short or example session secrets', () => {
  assert.throws(
    () => validateProductionConfig(productionSettings({ sessionSecret: 'too-short' })),
    /SESSION_SECRET/,
  );
  assert.throws(
    () => validateProductionConfig(productionSettings({
      sessionSecret: 'change-this-to-a-long-random-secret-in-production',
    })),
    /SESSION_SECRET/,
  );
});

test('production config requires a public HTTPS application URL', () => {
  assert.throws(
    () => validateProductionConfig(productionSettings({ appBaseUrl: 'http://localhost:3000' })),
    /APP_BASE_URL/,
  );
  assert.throws(
    () => validateProductionConfig(productionSettings({ appBaseUrl: 'not-a-url' })),
    /APP_BASE_URL/,
  );
});

test('production config requires the Groq key and model to be configured together', () => {
  assert.throws(
    () => validateProductionConfig(productionSettings({
      chatbot: { groqApiKey: 'configured-key', groqModel: '' },
    })),
    /GROQ_API_KEY and GROQ_MODEL/,
  );
});

test('production config validates the optional ACMIS integration and requires HTTPS', () => {
  assert.throws(
    () => validateProductionConfig(productionSettings({
      acmis: { apiBaseUrl: 'https://acmis.eaims.ac.ug', portalToken: '' },
    })),
    /ACMIS_API_BASE_URL and ACMIS_PORTAL_TOKEN/,
  );
  assert.throws(
    () => validateProductionConfig(productionSettings({
      acmis: {
        apiBaseUrl: 'http://acmis.internal',
        portalToken: 'shared-secret-that-is-long-enough-1234',
      },
    })),
    /ACMIS_API_BASE_URL must use HTTPS/,
  );
  assert.throws(
    () => validateProductionConfig(productionSettings({
      acmis: { apiBaseUrl: 'https://acmis.eaims.ac.ug', portalToken: 'too-short' },
    })),
    /32 to 4096 characters/,
  );
  assert.doesNotThrow(() => validateProductionConfig(productionSettings({
    acmis: { apiBaseUrl: 'https://acmis.eaims.ac.ug/api', portalToken: 'shared-secret-that-is-long-enough-1234' },
  })));
});

test('non-production config does not require production settings', () => {
  assert.doesNotThrow(() => validateProductionConfig({ nodeEnv: 'development' }));
});
