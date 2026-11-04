# Production readiness and operations

## Production environment

The application requires Node.js 20.17 or newer, matching the installed SQLite driver.

Set these values in the hosting provider's secret/environment manager before starting with `NODE_ENV=production`:

- `SESSION_SECRET`: a unique random value of at least 32 characters. The example placeholder is rejected.
- `APP_BASE_URL`: the public HTTPS URL used for application links. Localhost and non-HTTPS URLs are rejected in production.
- `DB_PATH`: a persistent local path for the SQLite database. Keep it outside the public web root.
- `DB_BACKUP_DIR`: an access-restricted directory for database snapshots. It defaults to a `backups` directory beside the database.

`GROQ_API_KEY` and `GROQ_MODEL` are optional as a pair. If one is set without the other, production startup fails. When both are empty, the chatbot uses its local application information and escalates unsupported questions to support.

Configure production SMTP and SMS provider credentials if those delivery channels are used. Do not use the sandbox SMS URL or commit credentials to source control. Put TLS termination and HTTPS redirect configuration at the hosting proxy or web server, and set `trust proxy` appropriately for that deployment.

## Health endpoints

- `GET /health/live` reports that the process is running.
- `GET /health/ready` checks the database connection and reports whether the chatbot is configured for Groq or local fallback.

The readiness endpoint does not contact SMTP, SMS, or Groq. Test those integrations with controlled staging accounts before launch.

## SQLite backups

Run a consistent online backup with:

```powershell
npm run db:backup
```

The command writes a timestamped SQLite file to `DB_BACKUP_DIR` (or the default backups directory), then runs SQLite's integrity check. Verify an existing snapshot with:

```powershell
npm run db:verify-backup -- "C:\path\to\backup.sqlite"
```

Backups contain applicant and conversation data. Restrict file permissions, encrypt off-host copies, define a retention policy, and schedule `npm run db:backup` using the hosting platform or Windows Task Scheduler. The application does not schedule or automatically delete backups.

For a restore drill, stop the application and restore a copy to a separate staging database path. Run the verification command against the copy and validate the portal against that staging database before planning any production restore. Do not overwrite a live database as part of a routine check.

## CI and release checks

The GitHub Actions workflow runs `npm ci` and the automated tests on Node.js 20 and 22 for pushes and pull requests.

Before a live release, also verify in staging:

1. Applicant registration, OTP delivery, password reset, application submission, and notifications.
2. Support-agent sign-in, claim/reply/close, and that an applicant cannot access another applicant's conversation.
3. Groq responses and human handoff if AI is enabled.
4. A database backup, integrity verification, and a restore drill.
5. HTTPS cookies, proxy behavior, log/alert routing, and the production domain.

CI, health endpoints, and backup scripts do not deploy the application, provision external provider accounts, create hosting secrets, or install a scheduler/monitoring service.
