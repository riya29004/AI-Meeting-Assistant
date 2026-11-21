# Security and privacy notes

## Deployment boundary

This build is for one machine. Start FastAPI on `127.0.0.1` and Vite on `127.0.0.1`; do not bind either service to `0.0.0.0` or expose it through a tunnel/reverse proxy. The local HTTP session cookie is intentionally non-Secure because the loopback app uses HTTP. A remote deployment needs HTTPS, secure cookies, a production secrets manager, and a reviewed deployment configuration before it is safe to expose.

## Protections in this local build

- Passwords are stored as salted PBKDF2-HMAC-SHA256 hashes. Session tokens are random, stored as hashes in the configured database, expire after seven days, and travel in HttpOnly, SameSite=Strict cookies.
- Login and account creation attempts are rate-limited per client address. Mutating HTTP requests are checked against the local UI Origin; WebSocket handshakes require an allowed Origin and a valid session.
- Meeting, transcript, task, and calendar APIs are scoped to the active workspace. Invite codes are random, one-use, stored as hashes, and expire after seven days.
- The API validates Host and CORS origins, applies response security headers, caps audio chunks and total recording size, and returns generic recording errors.
- SQL values are parameterized. Stored meeting text is rendered as text in the React UI. Local audio files are only deleted from the managed recordings directory.
- Raw audio is retained for the configured number of days and pruned when the backend starts. The default is 30 days. Set `AUDIO_RETENTION_DAYS=0` to remove audio after finalization or `KEEP_AUDIO=true` to retain it indefinitely.
- Speaker model usage telemetry is disabled by default; the gated model must still be downloaded from Hugging Face at first use.
- LLM calls are optional and happen only when `LLM_API_KEY` is configured. The base URL must use HTTPS, except loopback URLs for local models; redirects are disabled. The transcript is sent to that configured provider for analysis.
- Email reminders are disabled until SMTP settings are configured. Reminders send the task title and due date to the email address in the assignee field; transcripts are not included. Keep SMTP credentials private in `backend/.env` and use TLS.
- Supabase's secret API key is used only by the FastAPI backend and bypasses table RLS. Keep it in backend/server environment variables, never in frontend code; API routes enforce session and workspace checks.

## Remaining risks and boundaries

- SQLite/Supabase records, transcripts, summaries, tasks, and retained recordings are **not application-encrypted at rest**. Use operating-system disk encryption for local files and protect the Supabase database credentials. Supabase integration stores records only; audio remains on the local machine.
- Workspace members can see and delete shared meetings. Do not invite someone who should not have access to the workspace’s meeting data.
- The app has no email verification or password recovery. Invite codes are shown once and must be shared through a channel you trust.
- Browser reminders work only while the workspace is open. This is not a background notification service.
- Local accounts and workspaces are not hardened for remote or multi-device hosting.
- Review AI transcripts, summaries, decisions, and suggested tasks before relying on them. Speaker diarization requires the optional gated pyannote model and Hugging Face token; provider OAuth calendar sync is not included, and calendar export is an `.ics` file.

## Dependency review

The frontend dependency tree was checked with `npm audit`; the final result was zero known vulnerabilities. A full `pip-audit` run could not be completed because the configured package index did not provide `cyclonedx-python-lib`, a required scanner dependency. The backend requirements remove the unused multipart package and set patched minimums for Starlette and AnyIO; this is not a substitute for a complete Python dependency audit.
