const { randomToken, safeEqual } = require('../security');

function ensureCsrfToken(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = randomToken(24);
  next();
}

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.get('X-CSRF-Token') || (req.body && req.body._csrf);
  if (!token || !req.session.csrfToken || !safeEqual(token, req.session.csrfToken)) {
    return res.status(403).json({ ok: false, error: { code: 'CSRF_INVALID', message: 'Your session could not be verified. Refresh the page and try again.' } });
  }
  next();
}

module.exports = { ensureCsrfToken, csrfProtection };
