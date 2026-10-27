# Applicant chatbot and support inbox

The applicant chat widget is available on the portal's public and applicant pages. It answers from the program catalog and application workflow. Application number, saved program, and submission-status questions are answered from the signed-in applicant's own account and are not sent to the AI provider.

## AI configuration

AI-generated answers are optional. Without provider credentials the chatbot uses its local application/program information and sends unsupported questions to the support inbox. To enable generated answers:

1. Create a Groq API key through the provider's console.
2. Set `GROQ_API_KEY` and a currently supported `GROQ_MODEL` in the server environment (or the local `.env` file).
3. Restart the server.

Do not put provider credentials in frontend files, source control, or chat messages. When AI is enabled, general chat questions are sent to Groq with relevant portal information; applicant-specific application data is kept out of those requests.

## Provisioning a support agent

Support accounts are separate from applicant accounts and cannot be self-registered. Run the following from PowerShell on the server. The password prompt is hidden; the script stores only a bcrypt hash. Running it for an existing email resets that agent's password.

```powershell
$env:SUPPORT_AGENT_EMAIL = Read-Host "Support agent email"
$securePassword = Read-Host "Support agent password" -AsSecureString
$env:SUPPORT_AGENT_PASSWORD = [System.Net.NetworkCredential]::new("", $securePassword).Password
npm run support-agent:create
Remove-Item Env:SUPPORT_AGENT_EMAIL, Env:SUPPORT_AGENT_PASSWORD
Remove-Variable securePassword
```

Use a unique password of at least 12 characters. Give the agent their credentials through a secure channel. Agents sign in at `/support/login`; the protected inbox is at `/support/inbox`. The inbox refreshes open conversations automatically, and agents can claim, reply to, and close them.

## Data and handoff

Conversations and messages are stored in the portal's SQLite database. An applicant's signed-in session can access only that applicant's conversations; anonymous visitors are bound to a high-entropy server-side session. Support APIs require an active support-agent account and use a separate HTTP-only session cookie. Uncertain, unsupported, fee, entry-criteria, and explicitly requested human questions are placed in the inbox.

For deployment settings, health checks, backup procedures, and the pre-launch checklist, see [production-readiness.md](./production-readiness.md).
