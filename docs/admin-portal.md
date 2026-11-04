# EAIMS administration portal

The staff portal is available at `/admin`. It provides role-protected intake and programme management, applicant and application review, applicant-dashboard announcements, CSV reports, staff access management, and audit history. AR synchronization is not included.

## Provision the first staff account

There is no public administrator registration. Create the initial superadministrator from the project directory using one-time environment variables in PowerShell:

```powershell
$env:ADMIN_EMAIL = "authorized.staff@example.org"
$securePassword = Read-Host "Choose a unique password of at least 12 characters" -AsSecureString
$env:ADMIN_PASSWORD = [System.Net.NetworkCredential]::new("", $securePassword).Password
npm run admin:create
Remove-Item Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD
$securePassword.Dispose()
```

The command succeeds only when no administrator account exists. It hashes the password and creates a superadministrator. Do not place staff passwords in source control or share them through chat. After provisioning, sign in at `/admin/login`; superadministrators can create, change roles for, and deactivate additional staff accounts.

If the database contains an older integer-keyed programme and intake catalogue, migration preserves those tables as `programs_legacy`, `intakes_legacy`, and `program_intakes_legacy` before creating the current admissions catalogue. Historical applications remain linked to the preserved catalogue.

## Roles

- **Superadministrator:** all portal operations, staff access, and audit history.
- **Administrator:** programmes, intakes, applicants, applications, announcements, and reports.
- **Reviewer:** applicant/application read access and forward-only submission status changes.

Applicant and support-agent accounts are separate and do not grant access to the admin portal.

## Initial catalogue behavior

The database migration seeds all 32 programmes currently listed by the applicant portal and the existing March and August intake names. Those existing programmes and intakes remain active/open on migration so current applicant selection behavior is preserved. New intake periods start closed, and new programmes have no intake availability until staff selects it. Closing an intake or deactivating a programme prevents new applicant selections while retaining previously saved records.

Application dates are optional. When supplied, the opening and closing dates are enforced against the server's current date. Intake names cannot be renamed because existing application selections store the name.

Announcements are published in the applicant dashboard; this version does not send bulk email. CSV reports contain applicant personal information and must be handled as confidential institutional records.

Rejected applicant submission attempts are recorded with the validation/error code and timestamp (not submitted field values) so staff can locate failed and incomplete submissions.

Run `npm run migrate` to apply database changes explicitly; the server also runs migrations during startup.

Portal-to-ACMIS application delivery and applicant information requests are documented in [ACMIS synchronization](./acmis-integration.md).
