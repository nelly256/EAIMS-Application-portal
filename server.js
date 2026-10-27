const path = require('path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const config = require('./src/config');
const db = require('./src/db');
const SqliteSessionStore = require('./src/session-store');
const { requireAuth, requireVerified } = require('./src/middleware/auth');
const { ensureCsrfToken, csrfProtection } = require('./src/middleware/csrf');
const { testSmtpConnection } = require('./src/services/notifications');
const applicationService = require('./src/services/application-service');
const { COUNTRY_CODES } = require('./src/validation');
const authRoutes = require('./src/routes/auth');
const chatbotRoutes = require('./src/routes/chatbot');
const supportRoutes = require('./src/routes/support');
const adminRoutes = require('./src/routes/admin');
const adminService = require('./src/services/admin-service');

const app = express();

app.disable('x-powered-by');
if (config.nodeEnv === 'production') app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
    crossOriginEmbedderPolicy: false,
  }));
morgan.token('safe-url', (req) => String(req.originalUrl || '').split('?')[0]);
const logFormat = ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"';
app.use(morgan(logFormat));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

app.get('/health/live', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ status: 'alive' });
});

app.get('/health/ready', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await db.get('SELECT 1 AS ready');
    return res.status(200).json({
      status: 'ready',
      checks: {
        database: 'ok',
        chatbot: config.chatbot.groqApiKey && config.chatbot.groqModel ? 'groq' : 'local-fallback',
      },
    });
  } catch {
    console.error('Database readiness check failed.');
    return res.status(503).json({ status: 'not_ready', checks: { database: 'unavailable' } });
  }
});

const sessionStore = new SqliteSessionStore({ ttl: config.sessionMaxAge });
const applicantSession = session({
  name: 'eaims.sid',
  secret: config.sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: config.sessionMaxAge,
    path: '/',
  },
});
const supportSession = session({
  name: 'eaims.support.sid',
  secret: config.sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: config.sessionMaxAge,
    path: '/',
  },
});
const adminSession = session({
  name: 'eaims.admin.sid',
  secret: config.sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: config.sessionMaxAge,
    path: '/',
  },
});
app.use((req, res, next) => {
  if (/^\/(?:api\/support|support|api\/admin|admin)(?:\/|$)/.test(req.path)) return next();
  return applicantSession(req, res, next);
});
app.use(['/api/support', '/support'], supportSession);
app.use(['/api/admin', '/admin'], adminSession);
app.use(ensureCsrfToken);

const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMaxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
app.use('/api', apiLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatbotRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/admin', adminRoutes);

if (config.nodeEnv === 'development') {
  app.post('/api/dev/sms', (req, res) => {
    console.log('[DEV SMS] Message accepted by the development stub.');
    res.status(200).json({ success: true, messageId: `dev-sms-${Date.now()}` });
  });

  app.post('/api/dev/test-email', csrfProtection, async (req, res, next) => {
    try {
      const testEmail = req.body && req.body.email;
      const results = await testSmtpConnection(testEmail || null);
      res.json({ ok: true, data: results });
    } catch (error) {
      next(error);
    }
  });
}

app.get('/api/dashboard', requireAuth, requireVerified, async (req, res, next) => {
  const { publicApplicant } = require('./src/security');
  try {
    const [profile, programSelection, documents, application, notifications, announcements] = await Promise.all([
      applicationService.getApplicationProfile(req.applicant.id),
      applicationService.getProgramSelection(req.applicant.id),
      applicationService.listApplicationDocuments(req.applicant.id),
      applicationService.getApplicationSubmission(req.applicant.id),
      applicationService.getApplicationStatusNotifications(req.applicant.id),
      adminService.listAnnouncements(true),
    ]);
    const savedProfile = profile || {};
    return res.json({
      ok: true,
      data: {
        applicant: publicApplicant(req.applicant),
        application: application || null,
        notifications,
        announcements,
        programSelection: programSelection || null,
        applicationProfile: {
          firstName: savedProfile ? savedProfile.first_name : req.applicant.other_names || '',
          lastName: savedProfile ? savedProfile.last_name : req.applicant.surname || '',
          idNumber: savedProfile.id_number || '',
          countryOfBirth: savedProfile.country_of_birth || '',
          dateOfBirth: savedProfile ? savedProfile.date_of_birth : req.applicant.date_of_birth || '',
          gender: savedProfile ? savedProfile.gender : req.applicant.sex || '',
          physicalAddress: savedProfile.physical_address || '',
          nextOfKinName: savedProfile.next_of_kin_name || '',
          nextOfKinContact: savedProfile.next_of_kin_contact || '',
          hasPassportPhoto: Boolean(savedProfile.has_passport_photo),
        },
        documents,
        message: 'Your verified account is ready for the application process.',
      },
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/application/profile', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const [savedProfile, programSelection, documents, submission, notifications, programs, intakes] = await Promise.all([
      applicationService.getApplicationProfile(req.applicant.id),
      applicationService.getProgramSelection(req.applicant.id),
      applicationService.listApplicationDocuments(req.applicant.id),
      applicationService.getApplicationSubmission(req.applicant.id),
      applicationService.getApplicationStatusNotifications(req.applicant.id),
      applicationService.getPrograms(),
      applicationService.getIntakes(),
    ]);
    const profile = savedProfile || {};
    return res.json({
      ok: true,
      data: {
        countries: COUNTRY_CODES.map((country) => country.name),
        programs,
        intakes,
        programSelection: programSelection || null,
        submission: submission || null,
        notifications,
        profile: {
          applicationNumber: req.applicant.application_number || '',
          firstName: profile.first_name || req.applicant.other_names || '',
          lastName: profile.last_name || req.applicant.surname || '',
          idNumber: profile.id_number || '',
          email: req.applicant.email || '',
          phone: req.applicant.phone || '',
          countryOfBirth: profile.country_of_birth || '',
          dateOfBirth: profile.date_of_birth || req.applicant.date_of_birth || '',
          gender: profile.gender || req.applicant.sex || '',
          physicalAddress: profile.physical_address || '',
          nextOfKinName: profile.next_of_kin_name || '',
          nextOfKinContact: profile.next_of_kin_contact || '',
          trainingArrangements: JSON.parse(profile.training_arrangements || '[]'),
          employmentHistory: JSON.parse(profile.employment_history || '[]'),
          courseReason: profile.course_reason || '',
          hasPassportPhoto: Boolean(profile.has_passport_photo),
          passportPhotoMime: profile.passport_photo_mime || '',
          updatedAt: profile.updated_at || '',
          documents,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/application/submit', requireAuth, requireVerified, csrfProtection, async (req, res, next) => {
  try {
    const submission = await applicationService.submitApplication(req.applicant.id);
    return res.status(201).json({ ok: true, data: { submission } });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/application/notifications/read', requireAuth, requireVerified, csrfProtection, async (req, res, next) => {
  try {
    const result = await applicationService.markApplicationStatusNotificationsRead(req.applicant.id);
    return res.json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

app.put('/api/application/program-selection', requireAuth, requireVerified, csrfProtection, async (req, res, next) => {
  try {
    const selection = await applicationService.saveProgramSelection(req.applicant.id, req.body || {});
    return res.json({ ok: true, data: { programSelection: selection } });
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/application/profile', requireAuth, requireVerified, csrfProtection, async (req, res, next) => {
  try {
    const profile = await applicationService.saveApplicationProfile(req.applicant.id, req.body || {});
    return res.json({ ok: true, data: { profile } });
  } catch (error) {
    return next(error);
  }
});

app.put('/api/application/profile/photo', requireAuth, requireVerified, csrfProtection,
  express.raw({ type: ['image/jpeg', 'image/png'], limit: '5mb' }), async (req, res, next) => {
    try {
      const profile = await applicationService.savePassportPhoto(
        req.applicant.id,
        req.body,
        req.get('Content-Type')?.split(';')[0],
      );
      return res.json({ ok: true, data: { profile } });
    } catch (error) {
      return next(error);
    }
  });

app.get('/api/application/profile/photo', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const photo = await applicationService.getPassportPhoto(req.applicant.id);
    if (!photo) return res.status(404).json({ ok: false, error: { code: 'PHOTO_NOT_FOUND', message: 'No passport photo has been uploaded.' } });
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.type(photo.passport_photo_mime).send(photo.passport_photo);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/application/documents/:category', requireAuth, requireVerified, csrfProtection,
  express.raw({ type: '*/*', limit: '10mb' }), async (req, res, next) => {
    try {
      let originalName;
      try {
        originalName = decodeURIComponent(req.get('X-File-Name') || '');
      } catch {
        throw new applicationService.ApplicationError(400, 'INVALID_DOCUMENT', 'Choose a file with a valid name.', {
          file: 'Choose a file with a valid name.',
        });
      }
      const document = await applicationService.saveApplicationDocument(
        req.applicant.id,
        req.params.category,
        req.body,
        req.get('Content-Type')?.split(';')[0],
        originalName,
      );
      return res.status(201).json({ ok: true, data: { document } });
    } catch (error) {
      return next(error);
    }
  });

app.get('/api/application/documents', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const documents = (await applicationService.listApplicationDocuments(req.applicant.id)).map((document) => ({
      ...document,
      filename: document.original_name,
      size: document.file_size,
    }));
    return res.json({ ok: true, data: { documents } });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/application/documents', requireAuth, requireVerified, csrfProtection,
  express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png'], limit: '10mb' }), async (req, res, next) => {
    try {
      const originalName = typeof req.query.name === 'string' ? req.query.name : '';
      const document = await applicationService.saveApplicationDocument(
        req.applicant.id,
        'additional',
        req.body,
        req.get('Content-Type')?.split(';')[0],
        originalName,
      );
      return res.status(201).json({
        ok: true,
        data: {
          document: { ...document, filename: document.original_name, size: document.file_size },
        },
      });
    } catch (error) {
      return next(error);
    }
  });

async function sendApplicationDocument(req, res, next) {
  try {
    const documentId = Number(req.params.id);
    if (!Number.isSafeInteger(documentId) || documentId < 1) {
      return res.status(404).json({ ok: false, error: { code: 'DOCUMENT_NOT_FOUND', message: 'The requested document was not found.' } });
    }
    const document = await applicationService.getApplicationDocument(req.applicant.id, documentId);
    if (!document) {
      return res.status(404).json({ ok: false, error: { code: 'DOCUMENT_NOT_FOUND', message: 'The requested document was not found.' } });
    }
    const fallbackName = document.original_name.replace(/[^\x20-\x7e]|["\\]/g, '_');
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set(
      'Content-Disposition',
      `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(document.original_name)}`,
    );
    return res.type(document.mime_type).send(document.file_data);
  } catch (error) {
    return next(error);
  }
}

app.get('/api/application/documents/:id', requireAuth, requireVerified, sendApplicationDocument);
app.get('/api/application/documents/:id/file', requireAuth, requireVerified, sendApplicationDocument);

app.delete('/api/application/documents/:id', requireAuth, requireVerified, csrfProtection, async (req, res, next) => {
  try {
    const documentId = Number(req.params.id);
    if (!Number.isSafeInteger(documentId) || documentId < 1
      || !await applicationService.deleteApplicationDocument(req.applicant.id, documentId)) {
      return res.status(404).json({ ok: false, error: { code: 'DOCUMENT_NOT_FOUND', message: 'The requested document was not found.' } });
    }
    return res.json({ ok: true, data: { deleted: true } });
  } catch (error) {
    return next(error);
  }
});

function sendFile(res, file) {
  res.sendFile(path.join(__dirname, file));
}

app.get('/', (req, res) => sendFile(res, 'index.html'));
app.get('/index.html', (req, res) => sendFile(res, 'index.html'));
app.get('/register.html', (req, res) => sendFile(res, 'register.html'));
app.get('/login.html', (req, res) => sendFile(res, 'login.html'));
app.get('/verify.html', (req, res) => sendFile(res, 'verify.html'));
app.get('/forgot-password.html', (req, res) => sendFile(res, 'forgot-password.html'));
app.get('/reset-password.html', (req, res) => sendFile(res, 'reset-password.html'));
app.get('/dashboard.html', requireAuth, requireVerified, (req, res) => sendFile(res, 'dashboard.html'));
app.get('/dashboard', requireAuth, requireVerified, (req, res) => sendFile(res, 'dashboard.html'));
app.get('/admin/login', (req, res, next) => {
  if (!req.session.adminUserId) {
    res.set('Cache-Control', 'no-store');
    return sendFile(res, 'admin-login.html');
  }
  return db.get('SELECT id FROM admin_users WHERE id = ? AND is_active = 1', [req.session.adminUserId])
    .then((admin) => {
      if (admin) return res.redirect('/admin');
      res.set('Cache-Control', 'no-store');
      return sendFile(res, 'admin-login.html');
    })
    .catch(next);
});
app.get('/admin', (req, res, next) => {
  if (!req.session.adminUserId) return res.redirect('/admin/login');
  return db.get('SELECT id FROM admin_users WHERE id = ? AND is_active = 1', [req.session.adminUserId])
    .then((admin) => {
      if (admin) {
        res.set('Cache-Control', 'no-store');
        return sendFile(res, 'admin.html');
      }
      return req.session.destroy((error) => {
        if (error) return next(error);
        return res.redirect('/admin/login');
      });
    })
    .catch(next);
});
app.get('/my-application.html', requireAuth, requireVerified, (req, res) => sendFile(res, 'my-application.html'));
app.get('/my-application', requireAuth, requireVerified, (req, res) => sendFile(res, 'my-application.html'));
app.get('/track-application.html', requireAuth, requireVerified, (req, res) => sendFile(res, 'track-application.html'));
app.get('/track-application', requireAuth, requireVerified, (req, res) => sendFile(res, 'track-application.html'));
app.get('/documents.html', requireAuth, requireVerified, (req, res) => sendFile(res, 'documents.html'));
app.get('/documents', requireAuth, requireVerified, (req, res) => sendFile(res, 'documents.html'));
app.get('/support', (req, res) => res.redirect('/support/login'));
app.get('/support/login', (req, res, next) => {
  if (!req.session.supportAgentId) return sendFile(res, 'support-login.html');
  db.get('SELECT id FROM support_agents WHERE id = ? AND is_active = 1', [req.session.supportAgentId])
    .then((agent) => {
      if (agent) return res.redirect('/support/inbox');
      return req.session.destroy((error) => {
        if (error) return next(error);
        return sendFile(res, 'support-login.html');
      });
    })
    .catch(next);
});
app.get('/support/inbox', (req, res, next) => {
  if (!req.session.supportAgentId) return res.redirect('/support/login');
  return db.get('SELECT id FROM support_agents WHERE id = ? AND is_active = 1', [req.session.supportAgentId])
    .then((agent) => {
      if (agent) return sendFile(res, 'support-inbox.html');
      return req.session.destroy((error) => {
        if (error) return next(error);
        return res.redirect('/support/login');
      });
    })
    .catch(next);
});

app.get('/style.css', (req, res) => sendFile(res, 'style.css'));
app.get('/favicon.svg', (req, res) => sendFile(res, 'favicon.svg'));
app.get('/favicon.png', (req, res) => sendFile(res, 'favicon.png'));
app.get('/eaims-logo.jpeg', (req, res) => sendFile(res, 'eaims-logo.jpeg'));
app.get(/\.(jpe?g|png|gif|ico|webp)$/i, (req, res, next) => {
  res.sendFile(req.path, { root: __dirname }, (err) => {
    if (err) next();
  });
});

app.use('/js', express.static(path.join(__dirname, 'public', 'js'), {
  immutable: true,
  maxAge: config.nodeEnv === 'production' ? '1d' : 0,
}));
app.use('/css', express.static(path.join(__dirname, 'public', 'css'), {
  immutable: true,
  maxAge: config.nodeEnv === 'production' ? '1d' : 0,
}));

app.use('/api', (req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'The requested endpoint was not found.' } }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'index.html')));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error(error);
  const status = error.status || 500;
  const code = error.code || 'INTERNAL_ERROR';
  const message = status >= 500 ? 'Something went wrong. Please try again.' : error.message;
  const payload = { ok: false, error: { code, message } };
  if (error.fields && typeof error.fields === 'object') {
    payload.error.fields = error.fields;
  }
  return res.status(status).json(payload);
});

async function start() {
  await db.migrate();
  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, () => {
      console.log(`EAIMS portal listening on ${config.appBaseUrl}`);
      resolve(server);
    });
    server.once('error', reject);
  });
}

async function shutdown(server, timeoutMs = 10000) {
  if (!server || !server.listening) {
    sessionStore.close();
    return db.close();
  }

  await new Promise((resolve, reject) => {
    const forceCloseTimer = setTimeout(() => {
      console.error('Graceful shutdown timed out; closing active HTTP connections.');
      server.closeAllConnections();
    }, timeoutMs);
    forceCloseTimer.unref();

    server.close(async (error) => {
      clearTimeout(forceCloseTimer);
      sessionStore.close();
      try {
        await db.close();
      } catch (closeError) {
        return reject(closeError);
      }
      if (error) return reject(error);
      return resolve();
    });
  });
}

if (require.main === module) {
  start().then((server) => {
    let shutdownStarted = false;
    const handleShutdown = (signal) => {
      if (shutdownStarted) return;
      shutdownStarted = true;
      console.log(`Received ${signal}; shutting down gracefully.`);
      shutdown(server).catch((error) => {
        console.error('Graceful shutdown failed.', error);
        process.exitCode = 1;
      });
    };

    process.once('SIGINT', () => handleShutdown('SIGINT'));
    process.once('SIGTERM', () => handleShutdown('SIGTERM'));
  }).catch(async (error) => {
    console.error(error);
    sessionStore.close();
    try {
      await db.close();
    } catch (closeError) {
      console.error('Unable to close the database after startup failed.', closeError);
    }
    process.exitCode = 1;
  });
}

module.exports = { app, start, shutdown };
