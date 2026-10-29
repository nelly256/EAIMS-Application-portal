'use strict';

const crypto = require('crypto');
const db = require('../db');

const ORIGINAL_DOCUMENT_PATTERN = /^portal-document-([1-9]\d{0,14})$/;
const SUPPLEMENTAL_DOCUMENT_PATTERN = /^portal-supplemental-document-([1-9]\d{0,14})$/;

function safeEqual(left, right) {
  const expected = Buffer.from(String(left || ''));
  const supplied = Buffer.from(String(right || ''));
  return expected.length > 0
    && expected.length === supplied.length
    && crypto.timingSafeEqual(expected, supplied);
}

function createAcmisDocumentAccess({ token, database = db }) {
  const expectedToken = String(token || '').trim();

  function requireToken(req, res, next) {
    const match = req.get('Authorization')?.match(/^Bearer\s+(.+)$/i);
    if (!expectedToken || !safeEqual(match && match[1], expectedToken)) {
      return res.status(401).json({
        ok: false,
        error: {
          code: 'INTEGRATION_AUTHENTICATION_REQUIRED',
          message: 'Integration authentication is required.',
        },
      });
    }
    return next();
  }

  async function getDocument(sourceApplicationId, sourceDocumentId, correlationId) {
    const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(correlationId || '')
      ? correlationId
      : crypto.randomUUID();

    return database.transaction(async () => {
      const submission = await database.get(
        `SELECT applicant_id FROM application_submissions
         WHERE source_application_id = ?`,
        [sourceApplicationId],
      );
      let document;
      let resultCode = 'not_found';

      if (submission) {
        const originalMatch = sourceDocumentId.match(ORIGINAL_DOCUMENT_PATTERN);
        const supplementalMatch = sourceDocumentId.match(SUPPLEMENTAL_DOCUMENT_PATTERN);
        if (originalMatch) {
          document = await database.get(
            `SELECT original_name, mime_type, file_data
             FROM application_documents
             WHERE id = ? AND applicant_id = ?`,
            [Number(originalMatch[1]), submission.applicant_id],
          );
        } else if (supplementalMatch) {
          const supplemental = await database.get(
            `SELECT document.original_name, document.mime_type, document.file_data,
                    information_response.supplemental_document_ids_json
             FROM acmis_supplemental_documents AS document
             JOIN acmis_information_requests AS information_request
               ON information_request.id = document.request_id
             JOIN acmis_information_responses AS information_response
               ON information_response.request_id = information_request.id
             WHERE document.id = ?
               AND document.applicant_id = ?
               AND information_request.applicant_id = ?
               AND information_request.source_application_id = ?`,
            [
              Number(supplementalMatch[1]),
              submission.applicant_id,
              submission.applicant_id,
              sourceApplicationId,
            ],
          );
          if (supplemental) {
            const references = JSON.parse(supplemental.supplemental_document_ids_json);
            if (references.includes(sourceDocumentId)) document = supplemental;
          }
        } else if (sourceDocumentId === `portal-${sourceApplicationId}-passport-photo`) {
          document = await database.get(
            `SELECT CASE passport_photo_mime
                      WHEN 'image/jpeg' THEN 'passport-photo.jpg'
                      WHEN 'image/png' THEN 'passport-photo.png'
                    END AS original_name,
                    passport_photo_mime AS mime_type,
                    passport_photo AS file_data
             FROM application_profiles
             WHERE applicant_id = ? AND passport_photo IS NOT NULL`,
            [submission.applicant_id],
          );
        }
      }

      if (document) resultCode = 'served';
      await database.run(
        `INSERT INTO acmis_document_access_audit
         (source_application_id, source_document_id, correlation_id, result_code)
         VALUES (?, ?, ?, ?)`,
        [sourceApplicationId, sourceDocumentId, requestId, resultCode],
      );
      return document;
    });
  }

  return { requireToken, getDocument };
}

module.exports = { createAcmisDocumentAccess };
