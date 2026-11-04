'use strict';

const db = require('../db');

function requireSupportAgent(req, res, next) {
  if (!req.session || !req.session.supportAgentId) {
    return res.status(401).json({
      ok: false,
      error: { code: 'SUPPORT_AUTH_REQUIRED', message: 'Sign in as a support agent to continue.' },
    });
  }
  db.get(
    'SELECT id, email FROM support_agents WHERE id = ? AND is_active = 1',
    [req.session.supportAgentId],
  )
    .then((agent) => {
      if (!agent) {
        return req.session.destroy((error) => {
          if (error) return next(error);
          res.status(401).json({
            ok: false,
            error: { code: 'SUPPORT_AUTH_REQUIRED', message: 'Sign in as a support agent to continue.' },
          });
        });
      }
      req.supportAgent = agent;
      return next();
    })
    .catch(next);
}

module.exports = { requireSupportAgent };
