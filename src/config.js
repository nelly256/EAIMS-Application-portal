require('dotenv').config();

const crypto = require('crypto');
const path = require('path');

const nodeEnv = process.env.NODE_ENV || 'development';

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'eaims.db'),
  sessionSecret: process.env.SESSION_SECRET || (nodeEnv === 'production' ? '' : crypto.randomBytes(32).toString('hex')),
  sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 86400000,
  cookieSecure: nodeEnv === 'production',
  otpLength: parseInt(process.env.OTP_LENGTH, 10) || 6,
  otpExpiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 10,
  otpMaxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 5,
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  authRateLimitMaxRequests: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 10) || 20,
  chatbot: {
    groqApiKey: process.env.GROQ_API_KEY || '',
    groqModel: process.env.GROQ_MODEL || '',
    requestTimeoutMs: parseInt(process.env.CHATBOT_TIMEOUT_MS, 10) || 15000,
    maxMessagesPerHour: parseInt(process.env.CHATBOT_MAX_MESSAGES_PER_HOUR, 10) || 30,
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'EAIMS Portal <noreply@eaims.ac.ug>',
  },
  sms: {
    apiKey: process.env.SMS_API_KEY || '',
    apiUrl: process.env.SMS_API_URL || '',
    from: process.env.SMS_FROM || '',
    username: process.env.SMS_USERNAME || '',
    provider: process.env.SMS_PROVIDER || 'default',
    timeoutMs: parseInt(process.env.SMS_TIMEOUT_MS, 10) || 10000,
  },
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  acmis: {
    apiBaseUrl: process.env.ACMIS_API_BASE_URL || '',
    portalToken: process.env.ACMIS_PORTAL_TOKEN || '',
    requestTimeoutMs: parseInt(process.env.ACMIS_REQUEST_TIMEOUT_MS, 10) || 10000,
    syncIntervalMs: parseInt(process.env.ACMIS_SYNC_INTERVAL_MS, 10) || 30000,
  },
};

function validateProductionConfig(settings = config) {
  const acmisSettings = settings.acmis || {};
  const acmisUrl = String(acmisSettings.apiBaseUrl || '').trim();
  const acmisToken = String(acmisSettings.portalToken || '').trim();
  const acmisTimeoutMs = Number(acmisSettings.requestTimeoutMs || 10000);
  const acmisSyncIntervalMs = Number(acmisSettings.syncIntervalMs || 30000);
  let parsedAcmisUrl;
  if (!Number.isInteger(acmisTimeoutMs) || acmisTimeoutMs < 1000 || acmisTimeoutMs > 120000) {
    throw new Error('ACMIS_REQUEST_TIMEOUT_MS must be between 1000 and 120000.');
  }
  if (!Number.isInteger(acmisSyncIntervalMs) || acmisSyncIntervalMs < 5000 || acmisSyncIntervalMs > 3600000) {
    throw new Error('ACMIS_SYNC_INTERVAL_MS must be between 5000 and 3600000.');
  }
  if (Boolean(acmisUrl) !== Boolean(acmisToken)) {
    throw new Error('Set both ACMIS_API_BASE_URL and ACMIS_PORTAL_TOKEN, or leave both empty.');
  }
  if (acmisUrl) {
    try {
      parsedAcmisUrl = new URL(acmisUrl);
    } catch {
      throw new Error('Set ACMIS_API_BASE_URL to a valid URL.');
    }
    if (!['http:', 'https:'].includes(parsedAcmisUrl.protocol)
      || parsedAcmisUrl.username
      || parsedAcmisUrl.password
      || parsedAcmisUrl.search
      || parsedAcmisUrl.hash) {
      throw new Error('ACMIS_API_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment.');
    }
    if (acmisToken.length < 32 || acmisToken.length > 4096) {
      throw new Error('Set ACMIS_PORTAL_TOKEN to an integration token of 32 to 4096 characters.');
    }
  }

  if (settings.nodeEnv !== 'production') return;

  const sessionSecret = settings.sessionSecret.trim();
  if (sessionSecret.length < 32 || /^change[-_ ]?this/i.test(sessionSecret)) {
    throw new Error('Set SESSION_SECRET to a unique value of at least 32 characters in production.');
  }

  let appUrl;
  try {
    appUrl = new URL(settings.appBaseUrl);
  } catch {
    throw new Error('Set APP_BASE_URL to a valid HTTPS URL in production.');
  }
  if (appUrl.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname)) {
    throw new Error('APP_BASE_URL must use HTTPS and a public hostname in production.');
  }
  if (acmisUrl && parsedAcmisUrl.protocol !== 'https:') {
    throw new Error('ACMIS_API_BASE_URL must use HTTPS in production.');
  }

  const hasGroqKey = Boolean(settings.chatbot.groqApiKey);
  const hasGroqModel = Boolean(settings.chatbot.groqModel);
  if (hasGroqKey !== hasGroqModel) {
    throw new Error('Set both GROQ_API_KEY and GROQ_MODEL, or leave both empty.');
  }
}

validateProductionConfig();

module.exports = config;
module.exports.validateProductionConfig = validateProductionConfig;
