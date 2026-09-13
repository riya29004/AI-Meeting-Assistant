# AI Meeting Assistant

An AI-powered meeting assistant that will process meeting audio,
generate transcripts, and provide useful meeting insights.

## Current Progress

- React + Vite frontend setup
- FastAPI backend setup
- Frontend ↔ backend connection
- CORS configured
- Health check API
- Meetings API
- Audio file upload
- Audio files saved locally

## Tech Stack

### Frontend
- React
- Vite
- JavaScript

### Backend
- Python
- FastAPI
- Uvicorn

### Planned AI Pipeline
- Whisper → Speech-to-Text
- LLM → Summary, decisions, action items

## Project Structure

```text
AI Meeting Assistant/
├── backend/
│   ├── routes/
│   │   ├── health.py
│   │   └── meetings.py
│   ├── uploads/
│   ├── main.py
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   └── App.jsx
│   ├── package.json
│   └── package-lock.json
│
├── .gitignore
└── README.md