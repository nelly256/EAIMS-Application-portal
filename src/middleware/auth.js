const db = require('../db');
const { publicApplicant } = require('../security');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Please log in to continue.' } });
  }
  db.get('SELECT * FROM applicants WHERE id = ? AND is_active = 1', [req.session.userId])
    .then((applicant) => {
      if (!applicant) {
        req.session.destroy(() => {});
        return res.status(401).json({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Please log in to continue.' } });
      }
      req.applicant = applicant;
      next();
    })
    .catch(next);
}

function requireVerified(req, res, next) {
  if (!req.applicant || !req.applicant.is_verified) {
    return res.status(403).json({ ok: false, error: { code: 'VERIFICATION_REQUIRED', message: 'Verify your account before continuing.' } });
  }
  next();
}

function serializeApplicant(applicant) {
  return publicApplicant(applicant);
}

module.exports = { requireAuth, requireVerified, serializeApplicant };
