-- Run this in the Supabase SQL Editor before starting the backend with
-- SUPABASE_URL and the server-side SUPABASE_SECRET_KEY configured.

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
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
    key_points JSONB NOT NULL DEFAULT '[]'::jsonb,
    decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
    error TEXT
);

CREATE TABLE IF NOT EXISTS transcript_segments (
    id BIGSERIAL PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    start_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    end_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_segments_dedupe ON transcript_segments(meeting_id, start_seconds, end_seconds, text);
CREATE INDEX IF NOT EXISTS idx_tasks_meeting ON tasks(meeting_id, status);
CREATE INDEX IF NOT EXISTS idx_meetings_workspace_created ON meetings(workspace_id, created_at DESC);

-- Upgrade tables created by the earlier direct-Postgres setup.
ALTER TABLE meetings ALTER COLUMN key_points DROP DEFAULT;
ALTER TABLE meetings ALTER COLUMN key_points TYPE JSONB USING COALESCE(NULLIF(key_points::text, ''), '[]')::jsonb;
ALTER TABLE meetings ALTER COLUMN key_points SET DEFAULT '[]'::jsonb;
ALTER TABLE meetings ALTER COLUMN decisions DROP DEFAULT;
ALTER TABLE meetings ALTER COLUMN decisions TYPE JSONB USING COALESCE(NULLIF(decisions::text, ''), '[]')::jsonb;
ALTER TABLE meetings ALTER COLUMN decisions SET DEFAULT '[]'::jsonb;

-- All access currently goes through the authenticated FastAPI backend.
-- No browser-facing Supabase policies are needed; keep direct API access denied.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_reminder_sends ENABLE ROW LEVEL SECURITY;

