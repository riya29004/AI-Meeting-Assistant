"""SQLite connection setup, schema initialization, and data-path selection."""

from __future__ import annotations

import os
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("MEETMIND_DATA_DIR") or BACKEND_DIR / "data").expanduser().resolve()
UPLOAD_DIR = DATA_DIR / "recordings"
DB_PATH = DATA_DIR / "meetmind.sqlite3"
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_SECRET_KEY = (os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")).strip()
_supabase_client = None


def supabase_configured() -> bool:
    has_url = bool(SUPABASE_URL)
    has_key = bool(SUPABASE_SECRET_KEY)
    if has_url != has_key:
        raise RuntimeError("Set both SUPABASE_URL and SUPABASE_SECRET_KEY, or leave both blank to use SQLite.")
    if SUPABASE_SECRET_KEY.startswith("sb_publishable_"):
        raise RuntimeError(
            "SUPABASE_SECRET_KEY contains a publishable key. Use the Supabase secret API key "
            "in the backend environment; never put it in frontend code."
        )
    if os.getenv("SUPABASE_DB_URL", "").strip() and not has_url:
        raise RuntimeError("This version uses the Supabase Data API. Replace SUPABASE_DB_URL with SUPABASE_URL and SUPABASE_SECRET_KEY.")
    return has_url and has_key


def supabase_client():
    """Return the server-only Supabase API client, initializing it on first use."""
    global _supabase_client
    if not supabase_configured():
        raise RuntimeError("Set SUPABASE_URL and SUPABASE_SECRET_KEY in backend/.env to use Supabase.")
    if _supabase_client is None:
        from supabase import create_client

        _supabase_client = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
    return _supabase_client


@contextmanager
def connect():
    if supabase_configured():
        raise RuntimeError("Raw SQL is only available in SQLite mode; use the Supabase Data API.")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=15)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 15000")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    if supabase_configured():
        try:
            supabase_client().table("users").select("id").limit(1).execute()
        except Exception as exc:
            raise RuntimeError("Supabase API setup failed. Check the Project URL, server key, and run backend/supabase_schema.sql.") from exc
        prune_expired_recordings()
        return

    with connect() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS workspace_members (
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role TEXT NOT NULL DEFAULT 'member',
                joined_at TEXT NOT NULL,
                PRIMARY KEY (workspace_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS invitations (
                code_hash TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS meetings (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ready',
                created_at TEXT NOT NULL,
                started_at TEXT,
                ended_at TEXT,
                recording_path TEXT,
                transcript TEXT NOT NULL DEFAULT '',
                summary TEXT NOT NULL DEFAULT '',
                key_points TEXT NOT NULL DEFAULT '[]',
                decisions TEXT NOT NULL DEFAULT '[]',
                error TEXT
            );
            CREATE TABLE IF NOT EXISTS transcript_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
                start_seconds REAL NOT NULL DEFAULT 0,
                end_seconds REAL NOT NULL DEFAULT 0,
                speaker TEXT,
                text TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                assignee TEXT NOT NULL DEFAULT '',
                due_date TEXT,
                status TEXT NOT NULL DEFAULT 'needs_review',
                source_text TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS task_reminder_sends (
                task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                reminder_date TEXT NOT NULL,
                sent_at TEXT NOT NULL,
                PRIMARY KEY (task_id, reminder_date)
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(user_id, expires_at);
            CREATE INDEX IF NOT EXISTS idx_segments_meeting ON transcript_segments(meeting_id, start_seconds);
            CREATE INDEX IF NOT EXISTS idx_tasks_meeting ON tasks(meeting_id, status);
        """)
        columns = {row["name"] for row in db.execute("PRAGMA table_info(meetings)").fetchall()}
        for name, declaration in (("workspace_id", "TEXT NOT NULL DEFAULT ''"), ("key_points", "TEXT NOT NULL DEFAULT '[]'"), ("decisions", "TEXT NOT NULL DEFAULT '[]'")):
            if name not in columns:
                db.execute(f"ALTER TABLE meetings ADD COLUMN {name} {declaration}")
        current_time = datetime.now(timezone.utc).isoformat()
        db.execute("CREATE INDEX IF NOT EXISTS idx_meetings_workspace_created ON meetings(workspace_id, created_at DESC)")
        db.execute("DELETE FROM sessions WHERE expires_at <= ?", (current_time,))
        db.execute("DELETE FROM invitations WHERE expires_at <= ?", (current_time,))
        db.execute(
            "UPDATE meetings SET status = 'interrupted', ended_at = COALESCE(ended_at, ?), error = ? WHERE status = 'recording'",
            (current_time, "Backend restarted during recording. Any saved audio remains available."),
        )
        db.execute(
            "UPDATE meetings SET status = CASE WHEN transcript != '' THEN 'saved' ELSE 'failed' END, ended_at = COALESCE(ended_at, ?), error = CASE WHEN transcript != '' THEN ? ELSE ? END WHERE status = 'processing'",
            (current_time, "Backend restarted during AI analysis. The transcript was saved; retry analysis.", "Backend restarted during transcription. The recording was retained when available."),
        )
    prune_expired_recordings()


def prune_expired_recordings() -> None:
    if os.getenv("KEEP_AUDIO", "false").lower() == "true":
        return
    days = max(0, int(os.getenv("AUDIO_RETENTION_DAYS", "30")))
    cutoff = time.time() - days * 86400
    if supabase_configured():
        rows = supabase_client().table("meetings").select("id,recording_path,status").not_.is_("recording_path", "null").execute().data or []
        rows = [row for row in rows if row["status"] not in {"recording", "processing"}]
    else:
        with connect() as db:
            rows = [dict(row) for row in db.execute("SELECT id, recording_path FROM meetings WHERE recording_path IS NOT NULL AND status NOT IN ('recording', 'processing')").fetchall()]
    for row in rows:
        path = Path(row["recording_path"])
        if path.parent.resolve() != UPLOAD_DIR.resolve():
            continue
        try:
            if path.stat().st_mtime <= cutoff:
                path.unlink(missing_ok=True)
                if supabase_configured():
                    supabase_client().table("meetings").update({"recording_path": None}).eq("id", row["id"]).execute()
                else:
                    with connect() as db:
                        db.execute("UPDATE meetings SET recording_path = NULL WHERE id = ?", (row["id"],))
        except FileNotFoundError:
            if supabase_configured():
                supabase_client().table("meetings").update({"recording_path": None}).eq("id", row["id"]).execute()
            else:
                with connect() as db:
                    db.execute("UPDATE meetings SET recording_path = NULL WHERE id = ?", (row["id"],))
