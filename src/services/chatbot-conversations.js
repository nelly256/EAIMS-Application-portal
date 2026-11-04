'use strict';

const crypto = require('crypto');
const db = require('../db');
const { randomToken } = require('../security');

class ChatConversationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function getVisitorConversation(visitorKey, applicantId) {
  if (applicantId) {
    return db.get(
      `SELECT id, status, handoff_reason AS handoffReason, updated_at AS updatedAt,
              assigned_agent_id AS assignedAgentId
       FROM chat_conversations
       WHERE applicant_id = ?
       ORDER BY CASE WHEN status = 'closed' THEN 1 ELSE 0 END, updated_at DESC, rowid DESC
       LIMIT 1`,
      [applicantId],
    );
  }
  if (!visitorKey) return undefined;
  return db.get(
    `SELECT id, status, handoff_reason AS handoffReason, updated_at AS updatedAt,
            assigned_agent_id AS assignedAgentId
     FROM chat_conversations
     WHERE visitor_key = ? AND applicant_id IS NULL`,
    [visitorKey],
  );
}

async function getOrCreateConversation(visitorKey, applicantId) {
  return db.transaction(async () => {
    const existing = await getVisitorConversation(visitorKey, applicantId);
    if (existing && existing.status !== 'closed') {
      return { conversation: existing, visitorKey: visitorKey || randomToken(32) };
    }

    const nextVisitorKey = existing || !visitorKey ? randomToken(32) : visitorKey;
    const id = crypto.randomUUID();
    await db.run(
      `INSERT INTO chat_conversations (id, visitor_key, applicant_id)
       VALUES (?, ?, ?)`,
      [id, nextVisitorKey, applicantId || null],
    );
    const conversation = await db.get(
      `SELECT id, status, handoff_reason AS handoffReason, updated_at AS updatedAt,
              assigned_agent_id AS assignedAgentId
       FROM chat_conversations WHERE id = ?`,
      [id],
    );
    return { conversation, visitorKey: nextVisitorKey };
  });
}

async function getMessages(conversationId) {
  return db.all(
    `SELECT id, sender_type AS sender, content, created_at AS createdAt
     FROM chat_messages
     WHERE conversation_id = ?
     ORDER BY id`,
    [conversationId],
  );
}

async function addMessage(conversationId, sender, content, agentId = null) {
  const result = await db.run(
    `INSERT INTO chat_messages (conversation_id, sender_type, sender_agent_id, content)
     VALUES (?, ?, ?, ?)`,
    [conversationId, sender, agentId, content],
  );
  await db.run(
    `UPDATE chat_conversations SET updated_at = datetime('now')
     WHERE id = ?`,
    [conversationId],
  );
  return db.get(
    `SELECT id, sender_type AS sender, content, created_at AS createdAt
     FROM chat_messages WHERE id = ?`,
    [result.id],
  );
}

async function handoffConversation(conversationId, reason) {
  return db.transaction(async () => {
    const conversation = await db.get(
      'SELECT status FROM chat_conversations WHERE id = ?',
      [conversationId],
    );
    if (!conversation) throw new ChatConversationError(404, 'CHAT_NOT_FOUND', 'This conversation could not be found.');
    if (conversation.status === 'closed') {
      throw new ChatConversationError(409, 'CHAT_CLOSED', 'This conversation is closed. Start a new chat to continue.');
    }
    if (conversation.status === 'pending_human' || conversation.status === 'in_progress') return false;

    await db.run(
      `UPDATE chat_conversations
       SET status = 'pending_human', handoff_reason = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [reason, conversationId],
    );
    await addMessage(
      conversationId,
      'system',
      'This conversation has been sent to the admissions support inbox. Keep this chat open to see a reply.',
    );
    return true;
  });
}

async function listSupportConversations() {
  return db.all(
    `SELECT conversation.id, conversation.status,
            conversation.handoff_reason AS handoffReason,
            conversation.updated_at AS updatedAt,
            conversation.assigned_agent_id AS assignedAgentId,
            agent.email AS assignedAgentEmail,
            applicant.surname, applicant.other_names AS otherNames,
            applicant.email AS applicantEmail,
            applicant.application_number AS applicationNumber,
            (SELECT message.content FROM chat_messages AS message
             WHERE message.conversation_id = conversation.id
             ORDER BY message.id DESC LIMIT 1) AS latestMessage
     FROM chat_conversations AS conversation
     LEFT JOIN applicants AS applicant ON applicant.id = conversation.applicant_id
     LEFT JOIN support_agents AS agent ON agent.id = conversation.assigned_agent_id
     WHERE conversation.status != 'closed'
     ORDER BY CASE conversation.status WHEN 'pending_human' THEN 0 ELSE 1 END,
              conversation.updated_at DESC`,
  );
}

async function getSupportConversation(conversationId) {
  return db.get(
    `SELECT id, status, handoff_reason AS handoffReason,
            assigned_agent_id AS assignedAgentId
     FROM chat_conversations WHERE id = ?`,
    [conversationId],
  );
}

async function claimConversation(conversationId, agentId) {
  const result = await db.run(
    `UPDATE chat_conversations
     SET assigned_agent_id = ?, status = 'in_progress', updated_at = datetime('now')
     WHERE id = ? AND status IN ('pending_human', 'in_progress')
       AND (assigned_agent_id IS NULL OR assigned_agent_id = ?)`,
    [agentId, conversationId, agentId],
  );
  if (result.changes) return;

  const conversation = await getSupportConversation(conversationId);
  if (!conversation) throw new ChatConversationError(404, 'CHAT_NOT_FOUND', 'This conversation could not be found.');
  if (conversation.status === 'closed') throw new ChatConversationError(409, 'CHAT_CLOSED', 'This conversation is closed.');
  if (!['pending_human', 'in_progress'].includes(conversation.status)) {
    throw new ChatConversationError(409, 'CHAT_NOT_ESCALATED', 'This conversation has not been sent to support.');
  }
  throw new ChatConversationError(409, 'CHAT_ASSIGNED', 'This conversation is assigned to another support agent.');
}

async function replyToConversation(conversationId, agentId, content) {
  return db.transaction(async () => {
    const conversation = await getSupportConversation(conversationId);
    if (!conversation) throw new ChatConversationError(404, 'CHAT_NOT_FOUND', 'This conversation could not be found.');
    if (conversation.status === 'closed') throw new ChatConversationError(409, 'CHAT_CLOSED', 'This conversation is closed.');
    if (!['pending_human', 'in_progress'].includes(conversation.status)) {
      throw new ChatConversationError(409, 'CHAT_NOT_ESCALATED', 'This conversation has not been sent to support.');
    }
    if (conversation.assignedAgentId && conversation.assignedAgentId !== agentId) {
      throw new ChatConversationError(409, 'CHAT_ASSIGNED', 'This conversation is assigned to another support agent.');
    }
    if (!conversation.assignedAgentId) {
      await db.run(
        `UPDATE chat_conversations SET assigned_agent_id = ?, status = 'in_progress',
           updated_at = datetime('now')
         WHERE id = ? AND assigned_agent_id IS NULL AND status IN ('pending_human', 'in_progress')`,
        [agentId, conversationId],
      );
    }
    return addMessage(conversationId, 'support', content, agentId);
  });
}

async function closeConversation(conversationId, agentId) {
  return db.transaction(async () => {
    const conversation = await getSupportConversation(conversationId);
    if (!conversation) throw new ChatConversationError(404, 'CHAT_NOT_FOUND', 'This conversation could not be found.');
    if (!['pending_human', 'in_progress'].includes(conversation.status)) {
      throw new ChatConversationError(409, 'CHAT_NOT_ESCALATED', 'This conversation has not been sent to support.');
    }
    if (conversation.assignedAgentId && conversation.assignedAgentId !== agentId) {
      throw new ChatConversationError(409, 'CHAT_ASSIGNED', 'This conversation is assigned to another support agent.');
    }
    await db.run(
      `UPDATE chat_conversations SET status = 'closed', updated_at = datetime('now')
       WHERE id = ?`,
      [conversationId],
    );
    await addMessage(conversationId, 'system', 'This conversation has been closed by admissions support.');
  });
}

module.exports = {
  ChatConversationError,
  getVisitorConversation,
  getOrCreateConversation,
  getMessages,
  addMessage,
  handoffConversation,
  listSupportConversations,
  getSupportConversation,
  claimConversation,
  replyToConversation,
  closeConversation,
};
