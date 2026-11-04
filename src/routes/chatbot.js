'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db');
const { randomToken } = require('../security');
const { csrfProtection } = require('../middleware/csrf');
const conversations = require('../services/chatbot-conversations');
const { ChatbotProviderError, answerQuestion } = require('../services/chatbot-assistant');
const applicationService = require('../services/application-service');

const router = express.Router();

const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.chatbot.maxMessagesPerHour,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    ok: false,
    error: { code: 'CHAT_RATE_LIMITED', message: 'Please wait before sending another message.' },
  },
});

function routeError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function currentApplicant(req) {
  if (!req.session.userId) return undefined;
  const applicant = await db.get(
    'SELECT id FROM applicants WHERE id = ? AND is_active = 1 AND is_verified = 1',
    [req.session.userId],
  );
  if (!applicant) throw routeError(401, 'AUTH_REQUIRED', 'Please sign in again to continue.');
  req.chatApplicantId = applicant.id;
  return applicant;
}

async function currentConversation(req, createIfMissing = false) {
  const applicant = await currentApplicant(req);
  req.chatApplicantId = applicant && applicant.id;
  if (!req.session.chatVisitorKey) req.session.chatVisitorKey = randomToken(32);
  if (createIfMissing) {
    const result = await conversations.getOrCreateConversation(
      req.session.chatVisitorKey,
      applicant && applicant.id,
    );
    req.session.chatConversationId = result.conversation.id;
    req.session.chatVisitorKey = result.visitorKey;
    return result.conversation;
  }

  const conversation = await conversations.getVisitorConversation(
    req.session.chatVisitorKey,
    applicant && applicant.id,
  );
  if (conversation) req.session.chatConversationId = conversation.id;
  return conversation;
}

async function answerPrivateQuestion(question, applicantId) {
  const asksForApplicationNumber = /\b(application number|application no\.?|my number)\b/i.test(question);
  const asksForStatus = /\b(?:my application status|status of my application|has my application|did i submit|am i admitted|my admission status|(?:my|application) status|my status)\b/i.test(question);
  const asksForSelection = /\b(which|what).{0,25}(program|course).{0,20}(choose|selected|select)\b/i.test(question);
  if (!asksForApplicationNumber && !asksForStatus && !asksForSelection) return undefined;
  if (!applicantId) {
    return 'Sign in to view your personal application number, status, or saved program selection.';
  }

  if (asksForSelection) {
    const selection = await applicationService.getProgramSelection(applicantId);
    if (!selection) return 'There is no saved program selection on your account yet.';
    return `Your saved selection is ${selection.name} for the ${selection.intake} intake.`;
  }

  if (asksForApplicationNumber) {
    const applicant = await db.get('SELECT application_number FROM applicants WHERE id = ?', [applicantId]);
    return applicant && applicant.application_number
      ? `Your application number is ${applicant.application_number}.`
      : 'Your account does not yet have an application number. Please contact admissions support.';
  }

  const submission = await applicationService.getApplicationSubmission(applicantId);
  if (!submission) return 'There is no submitted application on your account. Complete and submit it from My Application.';
  if (submission.status === 'admitted') return 'Your application status is Admitted. Check your dashboard for the admission notification.';
  return 'Your application has been submitted and is being processed. Check your dashboard for updates.';
}

function serializeConversation(conversation, messages) {
  return {
    id: conversation.id,
    status: conversation.status,
    handoffReason: conversation.handoffReason || null,
    updatedAt: conversation.updatedAt,
    messages,
  };
}

router.get('/csrf', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, data: { token: req.session.csrfToken } });
});

router.get('/conversation', async (req, res, next) => {
  try {
    const conversation = await currentConversation(req);
    const messages = conversation ? await conversations.getMessages(conversation.id) : [];
    return res.json({
      ok: true,
      data: conversation ? serializeConversation(conversation, messages) : null,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/messages', chatLimiter, csrfProtection, async (req, res, next) => {
  try {
    const content = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!content || content.length > 1000) {
      throw routeError(400, 'INVALID_CHAT_MESSAGE', 'Enter a message of 1 to 1000 characters.');
    }

    const conversation = await currentConversation(req, true);
    if (conversation.status === 'closed') {
      throw routeError(409, 'CHAT_CLOSED', 'This conversation is closed. Start a new chat to continue.');
    }
    await conversations.addMessage(conversation.id, 'applicant', content);

    if (conversation.status === 'pending_human' || conversation.status === 'in_progress') {
      const messages = await conversations.getMessages(conversation.id);
      return res.json({ ok: true, data: serializeConversation(conversation, messages) });
    }

    const privateAnswer = await answerPrivateQuestion(content, req.chatApplicantId);
    let result = privateAnswer ? { answer: privateAnswer, handoff: false } : undefined;
    if (!result) {
      try {
        result = await answerQuestion(content);
      } catch (error) {
        if (!(error instanceof ChatbotProviderError)) throw error;
        console.warn(`Chatbot provider unavailable (${error.code}); escalating the conversation.`);
        result = {
          answer: 'I could not get a reliable answer just now. I’ll send your question to the admissions support team.',
          handoff: true,
          reason: error.code.toLowerCase(),
        };
      }
    }

    if (result.answer) await conversations.addMessage(conversation.id, 'assistant', result.answer);
    if (result.handoff) await conversations.handoffConversation(conversation.id, result.reason);

    const updatedConversation = await conversations.getVisitorConversation(
      req.session.chatVisitorKey,
      req.session.userId,
    );
    const messages = await conversations.getMessages(conversation.id);
    return res.json({
      ok: true,
      data: serializeConversation(updatedConversation, messages),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/handoff', csrfProtection, async (req, res, next) => {
  try {
    const conversation = await currentConversation(req, true);
    if (conversation.status === 'closed') {
      throw routeError(409, 'CHAT_CLOSED', 'This conversation is closed. Start a new chat to continue.');
    }
    await conversations.handoffConversation(conversation.id, 'requested');
    const updatedConversation = await conversations.getVisitorConversation(
      req.session.chatVisitorKey,
      req.session.userId,
    );
    const messages = await conversations.getMessages(conversation.id);
    return res.json({
      ok: true,
      data: serializeConversation(updatedConversation, messages),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
