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

test('non-production config does not require production settings', () => {
  assert.doesNotThrow(() => validateProductionConfig({ nodeEnv: 'development' }));
});
