'use strict';

const db = require('../db');

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.adminUserId) {
    return res.status(401).json({
      ok: false,
      error: { code: 'ADMIN_AUTH_REQUIRED', message: 'Sign in as an administrator to continue.' },
    });
  }
  db.get(
    'SELECT id, email, role FROM admin_users WHERE id = ? AND is_active = 1',
    [req.session.adminUserId],
  )
    .then((admin) => {
      if (!admin) {
        return req.session.destroy((error) => {
          if (error) return next(error);
          return res.status(401).json({
            ok: false,
            error: { code: 'ADMIN_AUTH_REQUIRED', message: 'Sign in as an administrator to continue.' },
          });
        });
      }
      req.adminUser = admin;
      return next();
    })
    .catch(next);
}

function requireAdminRole(...roles) {
  return (req, res, next) => {
    if (!req.adminUser || !roles.includes(req.adminUser.role)) {
      return res.status(403).json({
        ok: false,
        error: { code: 'ADMIN_FORBIDDEN', message: 'Your administrator role cannot perform this action.' },
      });
    }
    return next();
  };
}

module.exports = { requireAdmin, requireAdminRole };
