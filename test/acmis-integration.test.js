'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaims-acmis-test-'));
process.env.DB_PATH = path.join(tmpDir, 'acmis.db');
process.env.NODE_ENV = 'test';

const db = require('../src/db');
const applicationService = require('../src/services/application-service');
const { createAcmisIntegration } = require('../src/services/acmis-integration');

let applicantId;
let requestId;
let sourceApplicationId;

before(async () => {
  await db.migrate();
  applicantId = (await db.run(
    `INSERT INTO applicants
     (application_number, surname, other_names, email, phone, password_hash)
     VALUES ('EAIMS-2026-009001', 'Applicant', 'Test', 'acmis-test@example.test', '+256700900100', 'hash')`,
  )).id;
  sourceApplicationId = crypto.randomUUID();
  requestId = crypto.randomUUID();
  await db.run(
    `INSERT INTO application_submissions (applicant_id, status, source_application_id)
     VALUES (?, 'submitted', ?)`,
    [applicantId, sourceApplicationId],
  );
  await db.run(
    `INSERT INTO acmis_application_outbox
     (applicant_id, source_application_id, payload_json)
     VALUES (?, ?, ?)`,
    [
      applicantId,
      sourceApplicationId,
      JSON.stringify({
        sourceApplicantId: String(applicantId),
        sourceApplicationId,
        sourceApplicationNumber: 'EAIMS-2026-009001',
        applicantEmail: 'acmis-test@example.test',
        programCode: 'diploma-business-administration',
        intakeCode: 'March',
        submissionSnapshot: { applicant: { firstName: 'Test' } },
      }),
    ],
  );
});

after(async () => {
  await db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('delivers applications, synchronizes requests, and retries responses with stable IDs', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const pathName = new URL(url).pathname;
    if (pathName.endsWith('/admissions/applications')) {
      return Response.json({ applicationId: crypto.randomUUID(), duplicate: false }, { status: 202 });
    }
    if (pathName.endsWith('/information-requests')) {
      return Response.json({
        requests: [{
          id: requestId,
          requestedItems: [{ type: 'field', key: 'updatedAddress', label: 'Updated address' }, {
            type: 'document',
            key: 'proofOfAddress',
            label: 'Proof of address',
          }],
          applicantMessage: 'Please provide your current address and proof.',
          dueAt: '2026-12-01T00:00:00.000Z',
          createdAt: '2026-11-01T00:00:00.000Z',
        }],
      });
    }
    if (pathName.endsWith(`/information-requests/${requestId}/responses`)) {
      const body = JSON.parse(options.body);
      return Response.json({
        response: { sourceResponseId: body.sourceResponseId },
        duplicate: false,
      }, { status: 202 });
    }
    throw new Error(`Unexpected ACMIS request: ${pathName}`);
  };
  const integration = createAcmisIntegration({
    settings: {
      apiBaseUrl: 'https://acmis.example.test/api',
      portalToken: 'test-token',
      requestTimeoutMs: 2000,
      syncIntervalMs: 30000,
    },
    database: db,
    fetchImpl,
    logger: { error() {} },
  });

  assert.equal(await integration.processPendingApplications(), 1);
  const deliveredApplication = await db.get(
    'SELECT delivery_status, payload_json, acmis_application_id FROM acmis_application_outbox WHERE applicant_id = ?',
    [applicantId],
  );
  assert.equal(deliveredApplication.delivery_status, 'delivered');
  assert.equal(deliveredApplication.payload_json, null);
  assert.ok(deliveredApplication.acmis_application_id);

  assert.equal(await integration.syncInformationRequests(), 1);
  const requests = await integration.listInformationRequests(applicantId);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].id, requestId);
  assert.equal(requests[0].response, null);

  const supplementalDocument = await applicationService.saveInformationRequestDocument(
    applicantId,
    requestId,
    Buffer.from('%PDF-1.7 supplemental'),
    'application/pdf',
    'proof.pdf',
  );
  await assert.rejects(
    integration.submitInformationResponse(applicantId, requestId, {
      values: { updatedAddress: 'Kampala, Uganda' },
      documentsByKey: { proofOfAddress: [] },
    }),
    (error) => error.status === 400,
  );
  const response = await integration.submitInformationResponse(applicantId, requestId, {
    values: { updatedAddress: 'Kampala, Uganda' },
    documentsByKey: { proofOfAddress: [String(supplementalDocument.id)] },
  });
  assert.equal(response.deliveryStatus, 'pending');
  assert.equal(await integration.processPendingResponses(), 1);

  const storedResponse = await db.get(
    `SELECT delivery_status, source_response_id, values_json, supplemental_document_ids_json
     FROM acmis_information_responses WHERE request_id = (
       SELECT id FROM acmis_information_requests WHERE acmis_request_id = ?
     )`,
    [requestId],
  );
  assert.equal(storedResponse.delivery_status, 'delivered');
  assert.deepEqual(JSON.parse(storedResponse.values_json), { updatedAddress: 'Kampala, Uganda' });
  assert.deepEqual(
    JSON.parse(storedResponse.supplemental_document_ids_json),
    [`portal-supplemental-document-${supplementalDocument.id}`],
  );
  assert.equal((await integration.listInformationRequests(applicantId))[0].response.deliveryStatus, 'delivered');
  assert.equal(await integration.processPendingResponses(), 0);

  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ options }) => options.headers.Authorization === 'Bearer test-token'));
  assert.match(calls[0].url, /^https:\/\/acmis\.example\.test\/api\/admissions\/applications$/);
  assert.match(calls[1].url, new RegExp(`/admissions/portal/applications/${sourceApplicationId}/information-requests$`));
  assert.ok(calls[2].options.body.includes(storedResponse.source_response_id));
});

test('keeps information requests scoped to their applicant and rejects a second response', async () => {
  const otherApplicantId = (await db.run(
    `INSERT INTO applicants
     (surname, other_names, email, phone, password_hash)
     VALUES ('Other', 'Applicant', 'other-acmis@example.test', '+256700900101', 'hash')`,
  )).id;
  const integration = createAcmisIntegration({
    settings: { apiBaseUrl: '', portalToken: '' },
    database: db,
    fetchImpl: async () => {
      throw new Error('ACMIS should be disabled.');
    },
    logger: { error() {} },
  });

  assert.deepEqual(await integration.listInformationRequests(otherApplicantId), []);
  await assert.rejects(
    applicationService.saveInformationRequestDocument(
      otherApplicantId,
      requestId,
      Buffer.from('%PDF-1.7 unauthorized'),
      'application/pdf',
      'unauthorized.pdf',
    ),
    (error) => error.status === 404,
  );
  await assert.rejects(
    integration.submitInformationResponse(otherApplicantId, requestId, {
      values: { updatedAddress: 'Kampala' },
    }),
    (error) => error.status === 404,
  );
  await assert.rejects(
    integration.submitInformationResponse(applicantId, requestId, {
      values: { updatedAddress: 'Kampala' },
    }),
    (error) => error.status === 409,
  );
});
