'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
const config = require('../config');
const db = require('../db');
const { randomToken } = require('../security');
const { csrfProtection } = require('../middleware/csrf');
const { requireSupportAgent } = require('../middleware/support-auth');
const conversations = require('../services/chatbot-conversations');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.authRateLimitMaxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    ok: false,
    error: { code: 'LOGIN_RATE_LIMITED', message: 'Too many sign-in attempts. Please try again later.' },
  },
});

function routeError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

router.get('/csrf', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, data: { token: req.session.csrfToken } });
});

router.post('/login', loginLimiter, csrfProtection, async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!validator.isEmail(email) || email.length > 254 || !password || password.length > 128) {
      throw routeError(400, 'INVALID_CREDENTIALS', 'Enter a valid email and password.');
    }

    const agent = await db.get(
      'SELECT id, email, password_hash FROM support_agents WHERE lower(email) = lower(?) AND is_active = 1',
      [email],
    );
    const matches = agent ? await bcrypt.compare(password, agent.password_hash) : false;
    if (!matches) throw routeError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

    await new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
    req.session.supportAgentId = agent.id;
    req.session.csrfToken = randomToken(24);
    await db.run(
      "UPDATE support_agents SET last_login_at = datetime('now') WHERE id = ?",
      [agent.id],
    );
    await new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
    return res.json({
      ok: true,
      data: { agent: { id: agent.id, email: agent.email }, csrfToken: req.session.csrfToken },
    });
  } catch (error) {
    return next(error);
  }
});

router.use(requireSupportAgent);

router.get('/me', (req, res) => res.json({
  ok: true,
  data: { agent: req.supportAgent },
}));

router.post('/logout', csrfProtection, async (req, res, next) => {
  try {
    await new Promise((resolve, reject) => req.session.destroy((error) => (error ? reject(error) : resolve())));
    res.clearCookie('eaims.support.sid', {
      path: '/',
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
    });
    return res.json({ ok: true, data: { redirect: '/support/login' } });
  } catch (error) {
    return next(error);
  }
});

router.get('/conversations', async (req, res, next) => {
  try {
    const items = await conversations.listSupportConversations();
    return res.json({ ok: true, data: { conversations: items } });
  } catch (error) {
    return next(error);
  }
});

router.get('/conversations/:id', async (req, res, next) => {
  try {
    const conversation = await conversations.getSupportConversation(req.params.id);
    if (!conversation) throw routeError(404, 'CHAT_NOT_FOUND', 'This conversation could not be found.');
    const messages = await conversations.getMessages(conversation.id);
    return res.json({ ok: true, data: { conversation, messages } });
  } catch (error) {
    return next(error);
  }
});

router.post('/conversations/:id/claim', csrfProtection, async (req, res, next) => {
  try {
    await conversations.claimConversation(req.params.id, req.supportAgent.id);
    return res.json({ ok: true, data: { message: 'Conversation assigned to you.' } });
  } catch (error) {
    return next(error);
  }
});

router.post('/conversations/:id/replies', csrfProtection, async (req, res, next) => {
  try {
    const content = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!content || content.length > 2000) {
      throw routeError(400, 'INVALID_SUPPORT_MESSAGE', 'Enter a reply of 1 to 2000 characters.');
    }
    const message = await conversations.replyToConversation(
      req.params.id,
      req.supportAgent.id,
      content,
    );
    return res.json({ ok: true, data: { message } });
  } catch (error) {
    return next(error);
  }
});

router.post('/conversations/:id/close', csrfProtection, async (req, res, next) => {
  try {
    await conversations.closeConversation(req.params.id, req.supportAgent.id);
    return res.json({ ok: true, data: { message: 'Conversation closed.' } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
