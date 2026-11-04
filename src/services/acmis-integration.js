'use strict';

const crypto = require('crypto');
const db = require('../db');
const applicationService = require('./application-service');

const MAX_DELIVERY_ATTEMPTS = 8;
const MAX_BATCH_SIZE = 20;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class AcmisHttpError extends Error {
  constructor(status) {
    super(`ACMIS returned HTTP ${status}.`);
    this.status = status;
    this.code = `HTTP_${status}`;
  }
}

class AcmisResponseError extends Error {
  constructor(code) {
    super('ACMIS returned an invalid response.');
    this.code = code;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function isValidDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function asApplicationError(status, code, message) {
  return new applicationService.ApplicationError(status, code, message);
}

function validateRequestedItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new AcmisResponseError('INVALID_REQUEST_ITEMS');
  }
  const keys = new Set();
  for (const item of items) {
    if (!isPlainObject(item)
      || !['field', 'document'].includes(item.type)
      || typeof item.key !== 'string'
      || !item.key.trim()
      || item.key.length > 100
      || (item.label !== undefined && (typeof item.label !== 'string' || item.label.length > 200))) {
      throw new AcmisResponseError('INVALID_REQUEST_ITEMS');
    }
    const key = `${item.type}:${item.key}`;
    if (keys.has(key)) throw new AcmisResponseError('INVALID_REQUEST_ITEMS');
    keys.add(key);
  }
  return items;
}

function createAcmisIntegration({
  settings,
  database = db,
  fetchImpl = globalThis.fetch,
  logger = console,
}) {
  const baseUrl = String(settings.apiBaseUrl || '').trim().replace(/\/+$/, '');
  const token = String(settings.portalToken || '').trim();
  const enabled = Boolean(baseUrl && token);
  const requestTimeoutMs = Math.max(1000, Number(settings.requestTimeoutMs) || 10000);
  const syncIntervalMs = Math.max(5000, Number(settings.syncIntervalMs) || 30000);
  let timer;
  let activeRun;

  function endpoint(path) {
    return new URL(path.replace(/^\/+/, ''), `${baseUrl}/`).toString();
  }

  async function requestJson(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(endpoint(path), {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new AcmisHttpError(response.status);
      try {
        return await response.json();
      } catch {
        throw new AcmisResponseError('INVALID_JSON');
      }
    } catch (error) {
      if (error instanceof AcmisHttpError || error instanceof AcmisResponseError) throw error;
      if (controller.signal.aborted) {
        const timeoutError = new Error('ACMIS request timed out.');
        timeoutError.code = 'TIMEOUT';
        throw timeoutError;
      }
      const networkError = new Error('ACMIS request failed.');
      networkError.code = 'NETWORK_ERROR';
      throw networkError;
    } finally {
      clearTimeout(timeout);
    }
  }

  function retryable(error) {
    if (error instanceof AcmisHttpError) {
      return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
    }
    return !(error instanceof AcmisResponseError);
  }

  function safeErrorCode(error) {
    if (error instanceof AcmisHttpError) return error.code;
    if (error instanceof AcmisResponseError) return error.code;
    if (error.code === 'APPLICATION_SNAPSHOT_UNAVAILABLE') return error.code;
    return error.code === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK_ERROR';
  }

  async function updateDeliveryFailure(table, id, attempts, error) {
    const nextAttempt = attempts + 1;
    const shouldRetry = retryable(error) && nextAttempt < MAX_DELIVERY_ATTEMPTS;
    const delaySeconds = Math.min(900, 5 * (2 ** Math.min(nextAttempt - 1, 8)));
    await database.run(
      `UPDATE ${table}
       SET delivery_status = ?,
           attempts = ?,
           next_attempt_at = datetime('now', ?),
           lease_until = NULL,
           last_error_code = ?
       WHERE id = ?`,
      [
        shouldRetry ? 'pending' : 'failed',
        nextAttempt,
        `+${delaySeconds} seconds`,
        safeErrorCode(error),
        id,
      ],
    );
    logger.error('ACMIS delivery failed.', {
      recordId: id,
      code: safeErrorCode(error),
      willRetry: shouldRetry,
    });
  }

  async function claimOutboxRecord(table) {
    return database.transaction(async () => {
      const row = await database.get(
        `SELECT * FROM ${table}
         WHERE (delivery_status = 'pending' AND next_attempt_at <= datetime('now'))
            OR (delivery_status = 'sending' AND (lease_until IS NULL OR lease_until <= datetime('now')))
         ORDER BY id
         LIMIT 1`,
      );
      if (!row) return undefined;
      const result = await database.run(
        `UPDATE ${table}
         SET delivery_status = 'sending', lease_until = datetime('now', '+60 seconds')
         WHERE id = ?
           AND ((delivery_status = 'pending' AND next_attempt_at <= datetime('now'))
             OR (delivery_status = 'sending' AND (lease_until IS NULL OR lease_until <= datetime('now'))))`,
        [row.id],
      );
      return result.changes ? row : undefined;
    });
  }

  function validateAcknowledgement(payload) {
    if (!isPlainObject(payload)
      || typeof payload.applicationId !== 'string'
      || typeof payload.duplicate !== 'boolean') {
      throw new AcmisResponseError('INVALID_ACKNOWLEDGEMENT');
    }
    return payload;
  }

  function validateResponseAcknowledgement(payload, expectedResponseId) {
    if (!isPlainObject(payload)
      || typeof payload.duplicate !== 'boolean'
      || !isPlainObject(payload.response)
      || payload.response.sourceResponseId !== expectedResponseId) {
      throw new AcmisResponseError('INVALID_ACKNOWLEDGEMENT');
    }
    return payload;
  }

  async function processPendingApplications(limit = MAX_BATCH_SIZE) {
    if (!enabled) return 0;
    let processed = 0;
    while (processed < limit) {
      const row = await claimOutboxRecord('acmis_application_outbox');
      if (!row) break;
      try {
        const payload = JSON.parse(row.payload_json);
        const acknowledgement = validateAcknowledgement(await requestJson('admissions/applications', {
          method: 'POST',
          body: payload,
        }));
        await database.run(
          `UPDATE acmis_application_outbox
           SET delivery_status = 'delivered',
               payload_json = NULL,
               acmis_application_id = ?,
               delivered_at = datetime('now'),
               next_request_sync_at = datetime('now'),
               lease_until = NULL,
               last_error_code = NULL
           WHERE id = ? AND delivery_status = 'sending'`,
          [acknowledgement.applicationId, row.id],
        );
      } catch (error) {
        await updateDeliveryFailure('acmis_application_outbox', row.id, row.attempts, error);
      }
      processed += 1;
    }
    return processed;
  }

  async function persistRequests(row, requests) {
    if (!Array.isArray(requests) || requests.length > 100) {
      throw new AcmisResponseError('INVALID_REQUEST_LIST');
    }
    await database.transaction(async () => {
      for (const request of requests) {
        if (!isPlainObject(request)
          || typeof request.id !== 'string'
          || !REQUEST_ID_PATTERN.test(request.id)
          || typeof request.applicantMessage !== 'string'
          || !request.applicantMessage.trim()
          || request.applicantMessage.length > 2000
          || !isValidDate(request.createdAt)
          || (request.dueAt !== null && request.dueAt !== undefined && !isValidDate(request.dueAt))) {
          throw new AcmisResponseError('INVALID_REQUEST');
        }
        const requestedItems = validateRequestedItems(request.requestedItems);
        await database.run(
          `INSERT INTO acmis_information_requests
           (applicant_id, source_application_id, acmis_request_id, requested_items_json,
            applicant_message, due_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(acmis_request_id) DO NOTHING`,
          [
            row.applicant_id,
            row.source_application_id,
            request.id,
            JSON.stringify(requestedItems),
            request.applicantMessage.trim(),
            request.dueAt || null,
            request.createdAt,
          ],
        );
        const stored = await database.get(
          `SELECT applicant_id, source_application_id, requested_items_json,
                  applicant_message, due_at, created_at
           FROM acmis_information_requests WHERE acmis_request_id = ?`,
          [request.id],
        );
        if (!stored
          || stored.applicant_id !== row.applicant_id
          || stored.source_application_id !== row.source_application_id
          || stored.requested_items_json !== JSON.stringify(requestedItems)
          || stored.applicant_message !== request.applicantMessage.trim()
          || stored.due_at !== (request.dueAt || null)
          || stored.created_at !== request.createdAt) {
          throw new AcmisResponseError('REQUEST_CONFLICT');
        }
        await database.run(
          `UPDATE acmis_information_requests SET synced_at = datetime('now')
           WHERE acmis_request_id = ?`,
          [request.id],
        );
      }
      await database.run(
        `UPDATE acmis_application_outbox
         SET next_request_sync_at = datetime('now', ?),
             request_sync_attempts = 0,
             last_error_code = NULL
         WHERE id = ?`,
        [`+${Math.ceil(syncIntervalMs / 1000)} seconds`, row.id],
      );
    });
  }

  async function syncInformationRequests(limit = MAX_BATCH_SIZE) {
    if (!enabled) return 0;
    const rows = await database.all(
      `SELECT * FROM acmis_application_outbox
       WHERE delivery_status = 'delivered'
         AND (next_request_sync_at IS NULL OR next_request_sync_at <= datetime('now'))
       ORDER BY COALESCE(next_request_sync_at, '1970-01-01 00:00:00'), id
       LIMIT ?`,
      [limit],
    );
    for (const row of rows) {
      try {
        const payload = await requestJson(
          `admissions/portal/applications/${encodeURIComponent(row.source_application_id)}/information-requests`,
        );
        if (!isPlainObject(payload) || !Array.isArray(payload.requests)) {
          throw new AcmisResponseError('INVALID_REQUEST_LIST');
        }
        await persistRequests(row, payload.requests);
      } catch (error) {
        const code = safeErrorCode(error);
        const delaySeconds = retryable(error)
          ? Math.min(900, 5 * (2 ** Math.min(row.request_sync_attempts || 0, 8)))
          : Math.ceil(syncIntervalMs / 1000);
        await database.run(
          `UPDATE acmis_application_outbox
           SET next_request_sync_at = datetime('now', ?),
               request_sync_attempts = request_sync_attempts + 1,
               last_error_code = ?
           WHERE id = ?`,
          [`+${delaySeconds} seconds`, code, row.id],
        );
        logger.error('ACMIS information-request sync failed.', { recordId: row.id, code });
      }
    }
    return rows.length;
  }

  async function processPendingResponses(limit = MAX_BATCH_SIZE) {
    if (!enabled) return 0;
    let processed = 0;
    while (processed < limit) {
      const row = await claimOutboxRecord('acmis_information_responses');
      if (!row) break;
      try {
        const request = await database.get(
          `SELECT source_application_id, acmis_request_id
           FROM acmis_information_requests WHERE id = ?`,
          [row.request_id],
        );
        if (!request) throw new AcmisResponseError('REQUEST_NOT_FOUND');
        validateResponseAcknowledgement(await requestJson(
          `admissions/portal/applications/${encodeURIComponent(request.source_application_id)}`
            + `/information-requests/${encodeURIComponent(request.acmis_request_id)}/responses`,
          {
            method: 'POST',
            body: {
              sourceResponseId: row.source_response_id,
              submittedAt: row.submitted_at,
              values: JSON.parse(row.values_json),
              supplementalDocumentIds: JSON.parse(row.supplemental_document_ids_json),
            },
          },
        ), row.source_response_id);
        await database.run(
          `UPDATE acmis_information_responses
           SET delivery_status = 'delivered',
               delivered_at = datetime('now'),
               lease_until = NULL,
               last_error_code = NULL
           WHERE id = ? AND delivery_status = 'sending'`,
          [row.id],
        );
        await database.run(
          `UPDATE acmis_application_outbox
           SET next_request_sync_at = datetime('now')
           WHERE source_application_id = ?`,
          [request.source_application_id],
        );
      } catch (error) {
        await updateDeliveryFailure('acmis_information_responses', row.id, row.attempts, error);
      }
      processed += 1;
    }
    return processed;
  }

  async function listInformationRequests(applicantId) {
    const rows = await database.all(
      `SELECT request.acmis_request_id, request.requested_items_json,
              request.applicant_message, request.due_at, request.created_at,
              response.delivery_status, response.submitted_at
       FROM acmis_information_requests AS request
       LEFT JOIN acmis_information_responses AS response ON response.request_id = request.id
       WHERE request.applicant_id = ?
       ORDER BY request.created_at DESC, request.id DESC`,
      [applicantId],
    );
    return rows.map((row) => ({
      id: row.acmis_request_id,
      requestedItems: JSON.parse(row.requested_items_json),
      applicantMessage: row.applicant_message,
      dueAt: row.due_at,
      createdAt: row.created_at,
      response: row.delivery_status ? {
        deliveryStatus: row.delivery_status,
        submittedAt: row.submitted_at,
      } : null,
    }));
  }

  async function submitInformationResponse(applicantId, requestId, body) {
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      throw asApplicationError(404, 'INFORMATION_REQUEST_NOT_FOUND', 'The information request was not found.');
    }
    if (!isPlainObject(body)
      || Object.keys(body).some((key) => !['values', 'documentsByKey'].includes(key))) {
      throw asApplicationError(400, 'INVALID_INFORMATION_RESPONSE', 'Provide a valid response to the information request.');
    }
    const values = body.values === undefined ? {} : body.values;
    const documentsByKey = body.documentsByKey === undefined ? {} : body.documentsByKey;
    if (!isPlainObject(values) || !isPlainObject(documentsByKey)) {
      throw asApplicationError(400, 'INVALID_INFORMATION_RESPONSE', 'Provide valid response fields and documents.');
    }

    return database.transaction(async () => {
      const request = await database.get(
        `SELECT id, requested_items_json FROM acmis_information_requests
         WHERE applicant_id = ? AND acmis_request_id = ?`,
        [applicantId, requestId],
      );
      if (!request) {
        throw asApplicationError(404, 'INFORMATION_REQUEST_NOT_FOUND', 'The information request was not found.');
      }
      const existing = await database.get(
        'SELECT id FROM acmis_information_responses WHERE request_id = ?',
        [request.id],
      );
      if (existing) {
        throw asApplicationError(409, 'INFORMATION_RESPONSE_ALREADY_SUBMITTED', 'A response has already been submitted for this request.');
      }

      const requestedItems = JSON.parse(request.requested_items_json);
      const fieldKeys = requestedItems.filter((item) => item.type === 'field').map((item) => item.key);
      const documentKeys = requestedItems.filter((item) => item.type === 'document').map((item) => item.key);
      if (Object.keys(values).some((key) => !fieldKeys.includes(key))
        || fieldKeys.some((key) => typeof values[key] !== 'string'
          || !values[key].trim()
          || values[key].length > 4000)) {
        throw asApplicationError(400, 'INVALID_INFORMATION_RESPONSE', 'Complete each requested field using valid text.');
      }
      const normalizedValues = Object.fromEntries(fieldKeys.map((key) => [key, values[key].trim()]));
      if (Object.keys(documentsByKey).some((key) => !documentKeys.includes(key))) {
        throw asApplicationError(400, 'INVALID_INFORMATION_RESPONSE', 'Choose a document for each requested document type.');
      }
      const documentIds = [];
      for (const key of documentKeys) {
        const ids = documentsByKey[key];
        if (!Array.isArray(ids) || !ids.length
          || ids.some((id) => typeof id !== 'string' || !/^[1-9]\d{0,14}$/.test(id))) {
          throw asApplicationError(400, 'INVALID_INFORMATION_RESPONSE', 'Upload each requested supporting document before submitting.');
        }
        documentIds.push(...ids);
      }
      if (documentIds.length > 50 || new Set(documentIds).size !== documentIds.length
        || (!Object.keys(normalizedValues).length && !documentIds.length)) {
        throw asApplicationError(400, 'INVALID_INFORMATION_RESPONSE', 'Upload the requested supporting documents before submitting.');
      }
      if (documentIds.length) {
        const placeholders = documentIds.map(() => '?').join(', ');
        const ownedDocuments = await database.all(
          `SELECT id FROM acmis_supplemental_documents
           WHERE applicant_id = ? AND request_id = ? AND id IN (${placeholders})`,
          [applicantId, request.id, ...documentIds.map(Number)],
        );
        if (ownedDocuments.length !== documentIds.length) {
          throw asApplicationError(400, 'INVALID_INFORMATION_RESPONSE', 'Choose documents uploaded to your own account.');
        }
      }

      const sourceResponseId = crypto.randomUUID();
      const submittedAt = new Date().toISOString();
      const supplementalDocumentIds = documentIds.map((id) => `portal-supplemental-document-${id}`);
      const result = await database.run(
        `INSERT INTO acmis_information_responses
         (request_id, source_response_id, values_json, supplemental_document_ids_json, submitted_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          request.id,
          sourceResponseId,
          JSON.stringify(normalizedValues),
          JSON.stringify(supplementalDocumentIds),
          submittedAt,
        ],
      );
      return {
        id: result.id,
        deliveryStatus: 'pending',
        submittedAt,
      };
    });
  }

  async function runOnce() {
    if (!enabled) return;
    await applicationService.queueExistingAcmisApplications();
    await processPendingApplications();
    await processPendingResponses();
    await syncInformationRequests();
  }

  function start() {
    if (!enabled || timer) return;
    const run = () => {
      if (activeRun) return;
      activeRun = runOnce()
        .catch((error) => {
          logger.error('ACMIS synchronization cycle failed.', {
            code: safeErrorCode(error),
          });
        })
        .finally(() => {
          activeRun = undefined;
        });
    };
    run();
    timer = setInterval(run, syncIntervalMs);
    timer.unref();
  }

  async function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (activeRun) await activeRun;
  }

  return {
    enabled,
    listInformationRequests,
    processPendingApplications,
    processPendingResponses,
    submitInformationResponse,
    syncInformationRequests,
    start,
    stop,
  };
}

module.exports = { createAcmisIntegration };
