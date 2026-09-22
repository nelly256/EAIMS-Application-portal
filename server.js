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
const authRoutes = require('./src/routes/auth');

const app = express();

app.disable('x-powered-by');
if (config.nodeEnv === 'production') app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
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

const sessionStore = new SqliteSessionStore({ ttl: config.sessionMaxAge });
app.use(session({
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
}));
app.use(ensureCsrfToken);

const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMaxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
app.use('/api', apiLimiter);
app.use('/api/auth', authRoutes);

if (config.nodeEnv === 'development') {
  app.post('/api/dev/sms', (req, res) => {
    console.log('[DEV SMS]', JSON.stringify({
      to: req.body.to,
      message: req.body.message,
      from: req.body.from,
    }, null, 2));
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

app.get('/api/dashboard', requireAuth, requireVerified, (req, res) => {
  const { publicApplicant } = require('./src/security');
  res.json({
    ok: true,
    data: {
      applicant: publicApplicant(req.applicant),
      application: null,
      message: 'Your verified account is ready for the application process.',
    },
  });
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

app.get('/style.css', (req, res) => sendFile(res, 'style.css'));
app.get('/favicon.svg', (req, res) => sendFile(res, 'favicon.svg'));
app.get('/favicon.png', (req, res) => sendFile(res, 'favicon.png'));
app.get('/eaims-logo.jpeg', (req, res) => sendFile(res, path.join('src', 'EAIMS logo.jpeg')));
app.get('/EAIMS%20logo.jpg', (req, res) => sendFile(res, 'EAIMS logo.jpg'));
app.get('/grad.JPG.jpeg', (req, res) => sendFile(res, 'grad.JPG.jpeg'));
app.get('/grad2.jpeg', (req, res) => sendFile(res, 'grad2.jpeg'));
app.get('/grad3.jpeg', (req, res) => sendFile(res, 'grad3.jpeg'));

app.use('/js', express.static(path.join(__dirname, 'public', 'js'), {
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
  await new Promise((resolve) => {
    app.listen(config.port, () => {
      console.log(`EAIMS portal listening on ${config.appBaseUrl}`);
      resolve();
    });
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { app, start };
