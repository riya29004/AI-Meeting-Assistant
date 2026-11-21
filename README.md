# MeetMind — Local AI Meeting Assistant

MeetMind is a local-first meeting assistant. The React client captures microphone and shared-tab audio; FastAPI receives the WebSocket stream, transcribes it locally with faster-whisper, analyzes the transcript through an optional OpenAI-compatible LLM, and stores meetings and tasks in SQLite or Supabase Postgres.

## Run locally

Backend (PowerShell terminal):

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn main:app --reload --host 127.0.0.1
```

Frontend (second terminal):

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://localhost:5173` and choose **Get started**. Recording requires microphone permission and sharing the meeting browser tab with **Share tab audio** enabled. Keep the backend bound to loopback; the local API is not designed for network exposure.

### Use Supabase Postgres

SQLite remains the default when Supabase credentials are blank. To use Supabase, install the updated backend requirements and run `backend/supabase_schema.sql` in the Supabase SQL Editor. Set `SUPABASE_URL` to the project URL and `SUPABASE_SECRET_KEY` to the server-side secret API key in `backend/.env`. The backend uses Supabase's HTTPS Data API; no Postgres connection URI or local CA certificate is needed. Keep the key private and never put it in the frontend environment or source control. The backend checks API access during startup and reports missing tables or credentials.

To copy existing SQLite records, configure the Supabase API values and run `python scripts/migrate_sqlite_to_supabase.py` from the `backend` directory. Keyed records can be safely reprocessed; existing rows are left unchanged. Audio files are not uploaded: recordings stay in the local `MEETMIND_DATA_DIR`, so this integration stores application records only.

## Transcription and optional AI services

Transcription is a required part of the meeting workflow and runs locally after each audio window and again at meeting completion. It is included in `requirements.txt`, so the standard backend setup installs it. The first model use may download files from Hugging Face. Set `WHISPER_MODEL` in `backend/.env` to select a model. The default is `base` on CPU with int8 compute.

Speaker diarization is optional. Accept the Hugging Face terms for `pyannote/speaker-diarization-community-1`, set `HF_TOKEN` in `backend/.env`, install `requirements-speaker.txt`, and make sure ffmpeg is installed. Audio diarization runs locally; without these steps, transcript segments remain speaker-neutral.

For summary, key points, decisions, and suggested tasks, configure Groq Cloud in `backend/.env` using `LLM_BASE_URL=https://api.groq.com/openai/v1`, `LLM_MODEL` (the example uses `openai/gpt-oss-20b`), and `LLM_API_KEY`. Groq's API is OpenAI-compatible, so the existing backend integration can use its Chat Completions endpoint. Groq offers a free usage tier subject to model-specific rate limits and quotas; check the current Groq Console limits before relying on it. The key stays on the backend. Transcripts are sent to Groq for analysis; enable this only when meeting content may be shared with that provider. Without a key, recording/transcription still work, while AI analysis is skipped.

### Automatic task email reminders

The backend checks for confirmed pending tasks with a due date. It emails the assignee on the due date and once per day while overdue. The assignee field must contain an email address. The backend must be running for reminders to be sent; reminders are not queued while the computer is off. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM_EMAIL` in `backend/.env` (Gmail commonly uses `smtp.gmail.com`, port `587`, STARTTLS enabled, and an app password). Reminders stay disabled until an SMTP host and sender are configured. Each email contains only the task title and due date, not the meeting transcript. SMTP credentials are kept in the local backend environment file.

The landing page contact form uses the same SMTP settings to deliver messages to `CONTACT_EMAIL` (set in `backend/.env`; the example is the support address provided for this project). Contact messages are sent by email and are not stored in the database. The form returns an unavailable or delivery error instead of reporting success when email delivery is not configured or fails.

## Local data and privacy

- SQLite database (when Supabase is not configured): `backend/data/meetmind.sqlite3`
- Audio recordings: `backend/data/recordings/`
- Default audio retention: 30 days after recording file creation (expired files are pruned when the backend starts); set `AUDIO_RETENTION_DAYS=0` to remove audio when a meeting is finalized, or `KEEP_AUDIO=true` to retain audio indefinitely.
- Recordings without a transcript are retained so transcription can be retried. Remove the meeting from the UI to delete its record and audio immediately.
- `MEETMIND_DATA_DIR` can move local data to another directory. `MAX_RECORDING_MB` caps each recording (default 500 MB).
- `.env` and local data are excluded from Git. Never commit API keys or meeting content.

## Implemented modules

- Meeting creation, history, details, and deletion; SQLite by default or Supabase Postgres when configured
- Microphone plus shared-tab capture, browser-side mixing, and WebSocket audio streaming
- Periodic partial transcript updates and final timestamped transcript using faster-whisper
- LLM summary, key-point, decision, and action-item extraction through a replaceable provider adapter
- Human review of suggested tasks, editable assignees/due dates/status, completion tracking, and browser notifications while the workspace is open
- Analytics based on saved local meetings/tasks
- Downloadable Markdown minutes and calendar `.ics` export
- Local audio retention controls, origin/host restrictions, request validation, recording-size limits, and safe error responses

## Limitations

This local version supports accounts, cookie-based sign-in, workspace invitations, and shared workspace data on one local server. Invitation codes must be shared manually. The server binds to loopback and is not designed for remote hosting or multi-device collaboration. `.ics` is a portable calendar export; Google/Outlook OAuth sync is not included. Speaker labels require the optional pyannote package, model access, and Hugging Face token; without them transcripts are timestamped but speaker-neutral. Browser reminders require the workspace to be open. Live Whisper processing is best-effort and may update every several seconds; it is not word-level streaming. Review all AI output before relying on it.
