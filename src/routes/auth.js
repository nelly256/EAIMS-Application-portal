const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { csrfProtection, ensureCsrfToken } = require('../middleware/csrf');
const {
  AppError,
  registerApplicant,
  loginApplicant,
  verifyApplicant,
  requestPasswordReset,
  resetPassword,
  getApplicant,
} = require('../services/auth-service');
const { createOtp, verifyOtp } = require('../services/otp');
const { sendVerification } = require('../services/notifications');
const {
  COUNTRY_CODES,
  NATIONALITIES,
  validateRegistration,
  validateLogin,
  validateOtp,
  validatePasswordReset,
  normalizeIdentifier,
} = require('../validation');
const { publicApplicant } = require('../security');

const router = express.Router();
const authLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.authRateLimitMaxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } },
});

router.use(authLimiter);

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function validationError(res, result) {
  return res.status(400).json({
    ok: false,
    error: { code: 'VALIDATION_ERROR', message: 'Check the highlighted fields and try again.', fields: result.errors },
  });
}

router.get('/options', (req, res) => {
  res.json({ ok: true, data: { countries: COUNTRY_CODES, nationalities: NATIONALITIES } });
});

router.post('/register', csrfProtection, asyncRoute(async (req, res) => {
  const result = validateRegistration(req.body || {});
  if (!result.valid) return validationError(res, result);
  const registration = await registerApplicant(result.data);
  req.session.pendingApplicantId = registration.applicantId;
  await new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
  const response = {
    ok: true,
    data: {
      message: 'Account created. Verify your account to continue.',
      redirect: '/verify.html',
      deliveryAvailable: registration.deliveryAvailable,
      delivery: registration.delivery,
    },
  };
  return res.status(201).json(response);
}));

router.post('/verify', csrfProtection, asyncRoute(async (req, res) => {
  const result = validateOtp(req.body || {});
  if (!result.valid) return validationError(res, result);
  const applicantId = req.session.pendingApplicantId;
  if (!applicantId) throw new AppError(400, 'VERIFICATION_SESSION_MISSING', 'Start registration again before verifying your account.');
  const verification = await verifyOtp(applicantId, result.data.code, 'account_verification');
  if (!verification.valid) {
    const message = verification.reason === 'EXPIRED'
      ? 'The verification code has expired. Request a new code.'
      : 'The verification code is incorrect. Check the message and try again.';
    throw new AppError(400, 'OTP_INVALID', message);
  }
  await verifyApplicant(applicantId);
  delete req.session.pendingApplicantId;
  await new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
  return res.json({ ok: true, data: { message: 'Account verified. You can now log in.', redirect: '/login.html?verified=1' } });
}));

router.post('/resend-verification', csrfProtection, asyncRoute(async (req, res) => {
  const applicantId = req.session.pendingApplicantId;
  if (!applicantId) throw new AppError(400, 'VERIFICATION_SESSION_MISSING', 'Start registration again before requesting a new code.');
  const applicant = await getApplicant(applicantId);
  if (!applicant) throw new AppError(404, 'APPLICANT_NOT_FOUND', 'Applicant account was not found.');
  const code = await createOtp(applicantId, 'account_verification');
  const delivery = await sendVerification(applicant, code);
  return res.json({
    ok: true,
    data: {
      message: 'A new verification code has been sent.',
      deliveryAvailable: Boolean(delivery.email.sent || delivery.sms.sent),
      delivery,
    },
  });
}));

router.post('/login', csrfProtection, asyncRoute(async (req, res) => {
  const result = validateLogin(req.body || {});
  if (!result.valid) return validationError(res, result);
  const applicant = await loginApplicant(result.data.identifier.value, result.data.password);
  if (!applicant.is_verified) {
    req.session.pendingApplicantId = applicant.id;
    await new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
    throw new AppError(403, 'VERIFICATION_REQUIRED', 'Verify your account before logging in.');
  }
  await new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
  req.session.userId = applicant.id;
  await new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
  return res.json({ ok: true, data: { message: 'Login successful.', redirect: '/dashboard' } });
}));

router.post('/logout', csrfProtection, asyncRoute(async (req, res) => {
  await new Promise((resolve) => req.session.destroy(resolve));
  res.clearCookie('eaims.sid', {
    path: '/',
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
  });
  return res.json({ ok: true, data: { redirect: '/login.html' } });
}));

router.post('/forgot-password', csrfProtection, asyncRoute(async (req, res) => {
  const identifier = normalizeIdentifier(req.body && (req.body.identifier || req.body.email || req.body.phone));
  if (!identifier.value) {
    return res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email address or phone number.', fields: { identifier: 'Enter a valid email address or phone number.' } },
    });
  }
  const recovery = await requestPasswordReset(identifier.value);
  const message = recovery.sent
    ? 'If an account matches those details, password reset instructions have been sent.'
    : 'If an account matches those details, password reset instructions will be sent once email or SMS delivery is configured.';
  return res.json({
    ok: true,
    data: {
      message,
      deliveryAvailable: recovery.sent,
    },
  });
}));

router.post('/reset-password', csrfProtection, asyncRoute(async (req, res) => {
  const result = validatePasswordReset(req.body || {});
  if (!result.valid) return validationError(res, result);
  const token = String(req.body.token || '').trim();
  if (!token) throw new AppError(400, 'RESET_TOKEN_MISSING', 'A password reset token is required.');
  await resetPassword(token, result.data.password);
  return res.json({ ok: true, data: { message: 'Password updated. You can now log in.', redirect: '/login.html?reset=1' } });
}));

router.get('/session', async (req, res, next) => {
  if (!req.session.userId) return res.json({ ok: true, data: { authenticated: false } });
  try {
    const applicant = await getApplicant(req.session.userId);
    return res.json({ ok: true, data: { authenticated: true, applicant: publicApplicant(applicant) } });
  } catch (error) {
    req.session.destroy(() => {});
    return next(error);
  }
});

router.get('/csrf', ensureCsrfToken, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, data: { token: req.session.csrfToken } });
});

module.exports = router;
