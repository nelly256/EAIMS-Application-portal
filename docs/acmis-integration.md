# Portal to ACMIS synchronization

The Portal sends submitted applications to ACMIS and polls ACMIS for applicant-facing information requests. Applicants view and answer those requests on **Track My Application**. The integration runs only on the Portal server; the ACMIS bearer token is never sent to the browser.

## Configuration

Set both values in the Portal environment to enable synchronization:

```text
ACMIS_API_BASE_URL=https://acmis.example.org
ACMIS_PORTAL_TOKEN=<the shared Portal integration token>
```

`ACMIS_API_BASE_URL` is the ACMIS API origin or deployment base path, without a trailing slash. The Portal appends `/admissions/applications` and `/admissions/portal/applications/...` to it. `ACMIS_PORTAL_TOKEN` must match `PORTAL_INTEGRATION_TOKEN` in ACMIS. In production the ACMIS URL must use HTTPS. Leave both settings empty to disable delivery; the Portal still accepts applicant submissions and stores them locally.

Optional controls are `ACMIS_REQUEST_TIMEOUT_MS` (default 10,000) and `ACMIS_SYNC_INTERVAL_MS` (default 30,000). Restart the Portal after changing integration settings.

## Data and delivery

- Each Portal submission receives a persisted UUID `sourceApplicationId`; it is distinct from the applicant account ID and human application number.
- `sourceApplicantId` is the Portal applicant's numeric ID serialized as text. `sourceApplicationNumber` remains the human-facing `EAIMS-...` reference.
- `programCode` currently uses the Portal program ID and `intakeCode` uses the selected Portal intake name. Both teams must confirm these values against the ACMIS catalogue before production use.
- The application payload is captured in a durable Portal outbox in the same transaction as submission. ACMIS downtime does not make the applicant's Portal submission fail. The server retries transient failures with bounded exponential backoff; successful payloads are cleared from the outbox. Existing submitted applications are queued when synchronization is enabled.
- The Portal polls for open ACMIS information requests and stores them locally. Applicants can submit requested text and upload PDF, JPEG, or PNG supplemental documents. Responses are saved before delivery and retried using a stable response UUID.
- A response is accepted once per ACMIS request. A permanent delivery failure is retained for investigation and is shown to the applicant as a prompt to contact admissions.
- Permanently failed application payloads remain in the Portal outbox for operator investigation; successfully delivered application payloads are cleared.

## Document access

The Portal remains the source of truth for original evidence and applicant-uploaded supplemental files. ACMIS receives opaque references only; it does not copy files into its database. Authorized ACMIS staff retrieve a referenced file on demand through the staff endpoint:

```text
GET /admissions/applications/:applicationId/documents/:sourceDocumentId
```

The caller must have an authenticated staff session and `admissions.applications.read`. ACMIS verifies that the opaque reference belongs to that application's submitted snapshot or to an applicant response stored for that application before making a server-to-server request. The Portal endpoint is:

```text
GET /api/integrations/acmis/applications/:sourceApplicationId/documents/:sourceDocumentId
```

It accepts the shared integration bearer token and serves only files associated with the submitted Portal application. Original references use `portal-document-{id}`; passport photos use `portal-{sourceApplicationId}-passport-photo`; supplemental references use `portal-supplemental-document-{id}` and are valid only after the reference was included in a stored response for that application. The Portal owns the underlying bytes.

Only PDF, JPEG and PNG files up to 10 MiB are returned. Both systems use private, no-store responses and `nosniff`; ACMIS applies a request timeout and enforces the byte limit even when the upstream omits its content length. ACMIS records staff actor, application, document reference, result and correlation ID in its append-only audit events. The Portal records authenticated retrieval outcomes and correlation IDs in its document-access audit table. Invalid integration tokens are rejected before document lookup and file bytes or applicant details are not written to these audit records.

Configure `PORTAL_API_BASE_URL` and `PORTAL_INTEGRATION_TOKEN` in ACMIS, and set `ACMIS_PORTAL_TOKEN` in the Portal to the same secret. ACMIS requires HTTPS for the Portal URL in production; the Portal requires HTTPS for its ACMIS URL. The shared secret must be provisioned outside source control and rotated operationally. Staff document retrieval is implemented, but browser UI presentation, content integrity hashes, retention/archival policy and credential-rotation procedures remain to be agreed.

## Current scope and operations

This integration covers application intake and the additional-information request/response round trip only. It does not synchronize admissions decisions back to the Portal, expose an integration status dashboard, or reconcile program/intake catalogues. Request polling and delivery operate in batches of up to 20 records per cycle. Server logs include safe error codes and internal record IDs, not payloads, applicant data or tokens.

The current Portal database supports one application per applicant account. The ACMIS contract permits multiple independent applications per person, so the Portal's application model must be expanded before that capability is enabled.
