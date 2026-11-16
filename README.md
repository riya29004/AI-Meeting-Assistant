# MeetMind

MeetMind is a React and FastAPI project for meeting audio capture and follow-up. The frontend includes a public landing page, separate Admin and Assignee sign-in screens, a role preview, and a two-source browser capture interface.

## Current implementation

- Frontend: React, TypeScript, Vite, and project CSS.
- Backend: FastAPI.
- `GET /health`: backend health check.
- `GET /meetings`: currently a placeholder response; it does not list stored recordings.
- `POST /meetings/upload`: stores an uploaded file in `backend/uploads` with a unique filename.
- Browser capture records shared-tab audio and microphone audio independently. Both files are uploaded separately.

Authentication, account approval, database records, Whisper transcription, transcript synchronization, Groq analysis, task management, reminders, analytics, and automatic audio retention cleanup are not implemented by the backend yet. The sign-in fields stay disabled until an authentication API is available. The Admin/Assignee selector in the workspace is a UI preview only and does not enforce permissions.

Uploaded recordings remain on disk in `backend/uploads`; they are not deleted automatically. Do not upload sensitive recordings until retention controls are implemented.

## Run locally

Start the backend from `backend`:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend from `frontend`:

```powershell
npm ci
npm run dev
```

The frontend defaults to `http://localhost:8000` for the API. Set `VITE_API_BASE_URL` in a local frontend `.env` file to use a different backend URL.

Browser tab audio capture requires a supported browser and a secure context such as `localhost`. Choose a browser tab and enable its audio sharing option. Headphones help prevent feedback.

## Frontend checks

```powershell
npm run typecheck
npm run lint
npm run build
```
