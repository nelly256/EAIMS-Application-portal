'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
const config = require('../config');
const db = require('../db');
const { randomToken } = require('../security');
const { csrfProtection } = require('../middleware/csrf');
const { requireAdmin, requireAdminRole } = require('../middleware/admin-auth');
const applicationService = require('../services/application-service');
const adminService = require('../services/admin-service');

const router = express.Router();
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
const loginLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.authRateLimitMaxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    ok: false,
    error: { code: 'ADMIN_LOGIN_RATE_LIMITED', message: 'Too many sign-in attempts. Please try again later.' },
  },
});

function routeError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function numericId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw routeError(404, 'RECORD_NOT_FOUND', 'The requested record was not found.');
  return id;
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function sendCsv(res, name, rows, columns = Object.keys(rows[0] || {})) {
  const contents = [
    columns.map(csvCell).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\r\n');
  return res.status(200)
    .set('Cache-Control', 'no-store')
    .set('X-Content-Type-Options', 'nosniff')
    .set('Content-Type', 'text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${name}.csv"`)
    .send(contents);
}

router.get('/csrf', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, data: { token: req.session.csrfToken } });
});

router.post('/login', loginLimiter, csrfProtection, asyncRoute(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!validator.isEmail(email) || email.length > 254 || !password || password.length > 128) {
    throw routeError(400, 'INVALID_CREDENTIALS', 'Enter a valid email and password.');
  }
  const admin = await db.get(
    'SELECT id, email, password_hash, role FROM admin_users WHERE lower(email) = lower(?) AND is_active = 1',
    [email],
  );
  const matches = admin ? await bcrypt.compare(password, admin.password_hash) : false;
  if (!matches) throw routeError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

  await new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
  req.session.adminUserId = admin.id;
  req.session.csrfToken = randomToken(24);
  await db.run("UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?", [admin.id]);
  await new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
  await adminService.audit(admin.id, 'staff.logged_in', 'admin_user', admin.id);
  return res.json({
    ok: true,
    data: {
      admin: { id: admin.id, email: admin.email, role: admin.role },
      csrfToken: req.session.csrfToken,
      redirect: '/admin',
    },
  });
}));

router.use(requireAdmin);

router.get('/me', (req, res) => res.json({ ok: true, data: { admin: req.adminUser } }));

router.post('/logout', csrfProtection, asyncRoute(async (req, res) => {
  await new Promise((resolve, reject) => req.session.destroy((error) => (error ? reject(error) : resolve())));
  res.clearCookie('eaims.admin.sid', {
    path: '/',
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
  });
  return res.json({ ok: true, data: { redirect: '/admin/login' } });
}));

router.get('/dashboard', asyncRoute(async (_req, res) => {
  return res.json({ ok: true, data: await adminService.dashboard() });
}));

router.get('/programs', asyncRoute(async (_req, res) => {
  return res.json({ ok: true, data: { programs: await adminService.listPrograms() } });
}));
router.post('/programs', csrfProtection, requireAdminRole('superadmin', 'admin'), asyncRoute(async (req, res) => {
  const program = await adminService.saveProgram(req.adminUser, req.body || {});
  return res.status(201).json({ ok: true, data: { program } });
}));
router.patch('/programs/:id', csrfProtection, requireAdminRole('superadmin', 'admin'), asyncRoute(async (req, res) => {
  const program = await adminService.saveProgram(req.adminUser, req.body || {}, req.params.id);
  return res.json({ ok: true, data: { program } });
}));
router.post('/programs/:id/deactivate', csrfProtection, requireAdminRole('superadmin', 'admin'), asyncRoute(async (req, res) => {
  await adminService.deactivateProgram(req.adminUser, req.params.id);
  return res.json({ ok: true, data: { deactivated: true } });
}));

router.get('/intakes', asyncRoute(async (_req, res) => {
  return res.json({ ok: true, data: { intakes: await adminService.listIntakes() } });
}));
router.post('/intakes', csrfProtection, requireAdminRole('superadmin', 'admin'), asyncRoute(async (req, res) => {
  const intake = await adminService.saveIntake(req.adminUser, req.body || {});
  return res.status(201).json({ ok: true, data: { intake } });
}));
router.patch('/intakes/:name', csrfProtection, requireAdminRole('superadmin', 'admin'), asyncRoute(async (req, res) => {
  const intake = await adminService.saveIntake(req.adminUser, req.body || {}, req.params.name);
  return res.json({ ok: true, data: { intake } });
}));

router.get('/applicants', asyncRoute(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (status && !['verified', 'unverified', 'inactive', 'incomplete', 'failed', ...adminService.STATUSES].includes(status)) {
    throw routeError(400, 'INVALID_APPLICANT_FILTER', 'Choose a valid applicant filter.');
  }
  const applicants = await adminService.listApplicants({ search: req.query.search, status });
  const filtered = status === 'incomplete' ? applicants.filter((applicant) => applicant.isIncomplete) : applicants;
  return res.json({ ok: true, data: { applicants: filtered } });
}));
router.get('/applicants/:id', asyncRoute(async (req, res) => {
  const applicant = await adminService.getApplicant(numericId(req.params.id));
  if (!applicant) throw routeError(404, 'APPLICANT_NOT_FOUND', 'The applicant was not found.');
  return res.json({ ok: true, data: applicant });
}));
router.patch('/applicants/:id/account', csrfProtection, requireAdminRole('superadmin', 'admin'), asyncRoute(async (req, res) => {
  if (typeof req.body?.isActive !== 'boolean') {
    throw routeError(400, 'INVALID_ACCOUNT_STATUS', 'Choose whether the account should be active.');
  }
  await adminService.setApplicantActive(req.adminUser, numericId(req.params.id), req.body.isActive);
  return res.json({ ok: true, data: { updated: true } });
}));
router.get('/applicants/:id/documents/:documentId', asyncRoute(async (req, res) => {
  const applicantId = numericId(req.params.id);
  const documentId = numericId(req.params.documentId);
  const document = await applicationService.getApplicationDocument(applicantId, documentId);
  if (!document) throw routeError(404, 'DOCUMENT_NOT_FOUND', 'The requested document was not found.');
  const fallbackName = document.original_name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set(
    'Content-Disposition',
    `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(document.original_name)}`,
  );
  return res.type(document.mime_type).send(document.file_data);
}));

router.get('/applications', asyncRoute(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (status && !['incomplete', 'failed', ...adminService.STATUSES].includes(status)) {
    throw routeError(400, 'INVALID_APPLICATION_FILTER', 'Choose a valid application filter.');
  }
  let applications = await adminService.listApplicants({ search: req.query.search, status });
  if (status === 'incomplete') applications = applications.filter((item) => item.isIncomplete);
  if (status === 'failed') applications = applications.filter((item) => item.isFailed);
  return res.json({ ok: true, data: { applications } });
}));
router.patch('/applications/:applicantId/status', csrfProtection, requireAdminRole('superadmin', 'admin', 'reviewer'), asyncRoute(async (req, res) => {
  const applicantId = numericId(req.params.applicantId);
  const status = typeof req.body?.status === 'string' ? req.body.status : '';
  const result = await applicationService.updateApplicationStatus(applicantId, status);
  await adminService.audit(req.adminUser.id, 'application.status_updated', 'application', applicantId, { status });
  return res.json({ ok: true, data: { application: result } });
}));

router.get('/announcements', requireAdminRole('superadmin', 'admin'), asyncRoute(async (_req, res) => {
  return res.json({ ok: true, data: { announcements: await adminService.listAnnouncements() } });
}));
router.post('/announcements', csrfProtection, requireAdminRole('superadmin', 'admin'), asyncRoute(async (req, res) => {
  const announcement = await adminService.createAnnouncement(req.adminUser, req.body || {});
  return res.status(201).json({ ok: true, data: { announcement } });
}));
router.patch('/announcements/:id', csrfProtection, requireAdminRole('superadmin', 'admin'), asyncRoute(async (req, res) => {
  if (typeof req.body?.isPublished !== 'boolean') {
    throw routeError(400, 'INVALID_ANNOUNCEMENT_STATUS', 'Choose whether this announcement should be published.');
  }
  await adminService.setAnnouncementPublished(req.adminUser, numericId(req.params.id), req.body.isPublished);
  return res.json({ ok: true, data: { updated: true } });
}));

router.get('/reports/:type.csv', requireAdminRole('superadmin', 'admin'), asyncRoute(async (req, res) => {
  const rows = await adminService.reportData(req.params.type);
  const columns = {
    applicants: ['applicationNumber', 'surname', 'otherNames', 'email', 'phone', 'isVerified', 'isActive', 'registeredAt', 'applicationStatus', 'submittedAt', 'programName', 'intake'],
    applications: ['applicationNumber', 'surname', 'otherNames', 'email', 'phone', 'programName', 'intake', 'applicationStatus', 'submittedAt', 'hasPassportPhoto', 'hasTranscript', 'hasIdentity', 'failedSubmissionAttempts'],
  };
  return sendCsv(res, `eaims-${req.params.type}`, rows, columns[req.params.type]);
}));

router.get('/staff', requireAdminRole('superadmin'), asyncRoute(async (_req, res) => {
  return res.json({ ok: true, data: { staff: await adminService.listStaff() } });
}));
router.post('/staff', csrfProtection, requireAdminRole('superadmin'), asyncRoute(async (req, res) => {
  const staff = await adminService.createStaff(req.adminUser, req.body || {}, bcrypt, config.bcryptRounds);
  return res.status(201).json({ ok: true, data: { staff } });
}));
router.patch('/staff/:id', csrfProtection, requireAdminRole('superadmin'), asyncRoute(async (req, res) => {
  const staff = await adminService.updateStaff(req.adminUser, numericId(req.params.id), req.body || {});
  return res.json({ ok: true, data: { staff } });
}));

router.get('/audit-logs', requireAdminRole('superadmin'), asyncRoute(async (req, res) => {
  const requestedLimit = Number(req.query.limit) || 100;
  const limit = Math.min(200, Math.max(1, Math.trunc(requestedLimit)));
  return res.json({ ok: true, data: { logs: await adminService.listAuditLogs(limit) } });
}));

module.exports = router;
