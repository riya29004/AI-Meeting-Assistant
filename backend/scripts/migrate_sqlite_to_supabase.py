"""Copy local MeetMind records to Supabase through its HTTPS Data API."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")
sys.path.insert(0, str(BACKEND_DIR))

from database import DB_PATH, supabase_client, supabase_configured

TABLES = (
    ("users", "id"),
    ("workspaces", "id"),
    ("workspace_members", "workspace_id,user_id"),
    ("sessions", "token_hash"),
    ("invitations", "code_hash"),
    ("meetings", "id"),
    ("transcript_segments", "meeting_id,start_seconds,end_seconds,text"),
    ("tasks", "id"),
    ("task_reminder_sends", "task_id,reminder_date"),
)
BATCH_SIZE = 100


def migrate(source_path: Path) -> None:
    if not supabase_configured():
        raise RuntimeError("Set SUPABASE_URL and SUPABASE_SECRET_KEY in backend/.env before migrating.")
    if not source_path.is_file():
        raise FileNotFoundError(f"Local SQLite database not found: {source_path}")

    client = supabase_client()
    copied = 0
    with sqlite3.connect(source_path) as local_db:
        local_db.row_factory = sqlite3.Row
        for table, conflict_columns in TABLES:
            try:
                rows = local_db.execute(f"SELECT * FROM {table}").fetchall()
            except sqlite3.OperationalError as exc:
                if "no such table" in str(exc).lower():
                    continue
                raise
            payload = [dict(row) for row in rows]
            if table == "meetings":
                for row in payload:
                    for field in ("key_points", "decisions"):
                        row[field] = json.loads(row.get(field) or "[]")
            if table == "transcript_segments":
                # IDs are internal; natural-key upserts make migration retries idempotent.
                for row in payload:
                    row.pop("id", None)
            for offset in range(0, len(payload), BATCH_SIZE):
                batch = payload[offset:offset + BATCH_SIZE]
                request = client.table(table)
                if conflict_columns:
                    request = request.upsert(batch, on_conflict=conflict_columns, ignore_duplicates=True)
                else:
                    request = request.insert(batch)
                try:
                    request.execute()
                except Exception as exc:
                    raise RuntimeError(
                        f"Could not migrate table '{table}' using conflict key "
                        f"'{conflict_columns}'. Run the current backend/supabase_schema.sql "
                        "in the Supabase SQL Editor, then rerun the migration. "
                        "For transcript_segments, the required unique index is "
                        "idx_segments_dedupe (meeting_id, start_seconds, end_seconds, text)."
                    ) from exc
                copied += len(batch)
            print(f"Migrated {len(payload)} rows from {table}.")

    print(f"Migration complete: processed {copied} local rows (existing keyed rows were left unchanged).")
    print("Local recording files remain on this machine; only database records were copied.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DB_PATH, help="SQLite database file to copy")
    args = parser.parse_args()
    migrate(args.source.expanduser().resolve())


if __name__ == "__main__":
    main()
