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
  devOtpDelivery: nodeEnv === 'development' && process.env.DEV_OTP_DELIVERY === 'true',
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
};

if (nodeEnv === 'production' && config.sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters in production');
}

module.exports = config;
