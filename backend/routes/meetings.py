"""Meeting, audio streaming, transcript, and task API routes."""

from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.websockets import WebSocketState

from database import UPLOAD_DIR, connect, supabase_client, supabase_configured
from routes.auth import COOKIE_NAME, require_user, session_user
from services.analysis import analyze_transcript
from services.transcription import transcribe_file
from services.speakers import label_speakers

router = APIRouter(prefix="/api/meetings", tags=["meetings"])
logger = logging.getLogger(__name__)
MAX_RECORDING_BYTES = int(os.getenv("MAX_RECORDING_MB", "500")) * 1024 * 1024
MAX_CHUNK_BYTES = 8 * 1024 * 1024


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return json.loads(value or "[]")
    return value or []


def update_meeting_record(meeting_id: str, values: dict[str, Any]) -> None:
    if supabase_configured():
        supabase_client().table("meetings").update(values).eq("id", meeting_id).execute()
        return
    assignments = ", ".join(f"{column} = ?" for column in values)
    with connect() as db:
        db.execute(f"UPDATE meetings SET {assignments} WHERE id = ?", (*values.values(), meeting_id))


def insert_transcript_segment(meeting_id: str, segment: dict[str, Any]) -> None:
    values = {
        "meeting_id": meeting_id,
        "start_seconds": segment["start"],
        "end_seconds": segment["end"],
        "speaker": segment.get("speaker"),
        "text": segment["text"],
        "created_at": now(),
    }
    if supabase_configured():
        supabase_client().table("transcript_segments").insert(values).execute()
    else:
        with connect() as db:
            db.execute("INSERT INTO transcript_segments (meeting_id, start_seconds, end_seconds, speaker, text, created_at) VALUES (?, ?, ?, ?, ?, ?)", tuple(values.values()))


def get_transcript_segments(meeting_id: str) -> list[dict[str, Any]]:
    if supabase_configured():
        rows = supabase_client().table("transcript_segments").select("start_seconds,end_seconds,speaker,text").eq("meeting_id", meeting_id).order("start_seconds").execute().data or []
        return [{"start": row["start_seconds"], "end": row["end_seconds"], "speaker": row["speaker"], "text": row["text"]} for row in rows]
    with connect() as db:
        return [dict(row) for row in db.execute("SELECT start_seconds AS start, end_seconds AS end, speaker, text FROM transcript_segments WHERE meeting_id = ? ORDER BY start_seconds", (meeting_id,)).fetchall()]


def public_meeting(row: Any, db: Any) -> dict:
    meeting = dict(row)
    meeting["key_points"] = json_list(meeting.get("key_points"))
    meeting["decisions"] = json_list(meeting.get("decisions"))
    if supabase_configured():
        client = supabase_client()
        meeting["tasks"] = meeting.get("tasks") or client.table("tasks").select("*").eq("meeting_id", meeting["id"]).order("created_at").execute().data or []
        nested_segments = meeting.pop("transcript_segments", None)
        if nested_segments is not None:
            meeting["segments"] = [{"start": item["start_seconds"], "end": item["end_seconds"], "speaker": item["speaker"], "text": item["text"]} for item in nested_segments]
        else:
            meeting["segments"] = get_transcript_segments(meeting["id"])
    else:
        meeting["tasks"] = [dict(item) for item in db.execute("SELECT * FROM tasks WHERE meeting_id = ? ORDER BY created_at", (meeting["id"],))]
        meeting["segments"] = [dict(item) for item in db.execute("SELECT start_seconds AS start, end_seconds AS end, speaker, text FROM transcript_segments WHERE meeting_id = ? ORDER BY start_seconds", (meeting["id"],))]
    meeting.pop("recording_path", None)
    return meeting


class MeetingCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    assignee: str | None = Field(default=None, max_length=160)
    due_date: str | None = Field(default=None, max_length=40)
    status: str | None = Field(default=None, pattern="^(needs_review|pending|completed|rejected)$")


@router.post("", status_code=201)
def create_meeting(payload: MeetingCreate, user: dict = Depends(require_user)):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Meeting title cannot be blank")
    meeting_id, created_at = str(uuid.uuid4()), now()
    if supabase_configured():
        row = supabase_client().table("meetings").insert({"id": meeting_id, "workspace_id": user["workspace_id"], "title": title, "status": "ready", "created_at": created_at}).execute().data[0]
        return public_meeting(row, None)
    with connect() as db:
        db.execute("INSERT INTO meetings (id, workspace_id, title, status, created_at) VALUES (?, ?, ?, 'ready', ?)", (meeting_id, user["workspace_id"], title, created_at))
        row = db.execute("SELECT * FROM meetings WHERE id = ? AND workspace_id = ?", (meeting_id, user["workspace_id"])).fetchone()
        return public_meeting(row, db)


@router.get("")
def list_meetings(user: dict = Depends(require_user)):
    if supabase_configured():
        rows = supabase_client().table("meetings").select("*,tasks(*),transcript_segments(start_seconds,end_seconds,speaker,text)").eq("workspace_id", user["workspace_id"]).order("created_at", desc=True).limit(500).execute().data or []
        return [public_meeting(row, None) for row in rows]
    with connect() as db:
        rows = db.execute("SELECT * FROM meetings WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 500", (user["workspace_id"],)).fetchall()
        return [public_meeting(row, db) for row in rows]


@router.get("/{meeting_id}")
def get_meeting(meeting_id: str, user: dict = Depends(require_user)):
    if supabase_configured():
        rows = supabase_client().table("meetings").select("*").eq("id", meeting_id).eq("workspace_id", user["workspace_id"]).limit(1).execute().data
        if not rows:
            raise HTTPException(status_code=404, detail="Meeting not found")
        return public_meeting(rows[0], None)
    with connect() as db:
        row = db.execute("SELECT * FROM meetings WHERE id = ? AND workspace_id = ?", (meeting_id, user["workspace_id"])).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Meeting not found")
        return public_meeting(row, db)


@router.delete("/{meeting_id}", status_code=204)
def delete_meeting(meeting_id: str, user: dict = Depends(require_user)):
    if supabase_configured():
        rows = supabase_client().table("meetings").select("recording_path").eq("id", meeting_id).eq("workspace_id", user["workspace_id"]).limit(1).execute().data
        if not rows:
            raise HTTPException(status_code=404, detail="Meeting not found")
        recording = Path(rows[0]["recording_path"]) if rows[0].get("recording_path") else None
        supabase_client().table("meetings").delete().eq("id", meeting_id).execute()
        if recording and recording.parent.resolve() == UPLOAD_DIR.resolve():
            recording.unlink(missing_ok=True)
        return
    with connect() as db:
        row = db.execute("SELECT recording_path FROM meetings WHERE id = ? AND workspace_id = ?", (meeting_id, user["workspace_id"])).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Meeting not found")
        recording = Path(row["recording_path"]) if row["recording_path"] else None
        db.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))
    if recording and recording.parent.resolve() == UPLOAD_DIR.resolve():
        recording.unlink(missing_ok=True)


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    assignee: str = Field(default="", max_length=160)
    due_date: str | None = Field(default=None, max_length=40)


@router.post("/{meeting_id}/tasks", status_code=201)
def create_task(meeting_id: str, payload: TaskCreate, user: dict = Depends(require_user)):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Task title cannot be blank")
    task_id = str(uuid.uuid4())
    if supabase_configured():
        client = supabase_client()
        if not client.table("meetings").select("id").eq("id", meeting_id).eq("workspace_id", user["workspace_id"]).limit(1).execute().data:
            raise HTTPException(status_code=404, detail="Meeting not found")
        return client.table("tasks").insert({"id": task_id, "meeting_id": meeting_id, "title": title, "assignee": payload.assignee.strip(), "due_date": payload.due_date, "status": "needs_review", "created_at": now()}).execute().data[0]
    with connect() as db:
        if not db.execute("SELECT id FROM meetings WHERE id = ? AND workspace_id = ?", (meeting_id, user["workspace_id"])).fetchone():
            raise HTTPException(status_code=404, detail="Meeting not found")
        db.execute("INSERT INTO tasks (id, meeting_id, title, assignee, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, 'needs_review', ?)", (task_id, meeting_id, title, payload.assignee.strip(), payload.due_date, now()))
        return dict(db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())


@router.post("/{meeting_id}/analyze")
async def analyze_meeting(meeting_id: str, user: dict = Depends(require_user)):
    if supabase_configured():
        rows = supabase_client().table("meetings").select("transcript").eq("id", meeting_id).eq("workspace_id", user["workspace_id"]).limit(1).execute().data
        meeting = rows[0] if rows else None
    else:
        with connect() as db:
            meeting = db.execute("SELECT transcript FROM meetings WHERE id = ? AND workspace_id = ?", (meeting_id, user["workspace_id"])).fetchone()
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if not meeting["transcript"].strip():
        raise HTTPException(status_code=409, detail="A transcript is required before analysis")
    try:
        result = await run_in_threadpool(analyze_transcript, meeting["transcript"])
        if result.get("status") != "complete":
            raise RuntimeError("Configure an LLM provider in backend/.env before rerunning analysis.")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if supabase_configured():
        client = supabase_client()
        client.table("meetings").update({"summary": result["summary"], "key_points": result["key_points"], "decisions": result["decisions"], "error": None}).eq("id", meeting_id).eq("workspace_id", user["workspace_id"]).execute()
        client.table("tasks").delete().eq("meeting_id", meeting_id).eq("status", "needs_review").execute()
        task_rows = []
        for task in result["tasks"]:
            title = str(task.get("title", "")).strip()[:300]
            if title:
                task_rows.append({"id": str(uuid.uuid4()), "meeting_id": meeting_id, "title": title, "assignee": str(task.get("assignee", ""))[:160], "due_date": str(task.get("due_date", ""))[:40] or None, "status": "needs_review", "source_text": str(task.get("source_text", ""))[:1000], "created_at": now()})
        if task_rows:
            client.table("tasks").insert(task_rows).execute()
        row = client.table("meetings").select("*").eq("id", meeting_id).eq("workspace_id", user["workspace_id"]).limit(1).execute().data[0]
        return public_meeting(row, None)
    with connect() as db:
        db.execute("UPDATE meetings SET summary = ?, key_points = ?, decisions = ?, error = NULL WHERE id = ? AND workspace_id = ?", (result["summary"], json.dumps(result["key_points"]), json.dumps(result["decisions"]), meeting_id, user["workspace_id"]))
        db.execute("DELETE FROM tasks WHERE meeting_id = ? AND status = 'needs_review'", (meeting_id,))
        for task in result["tasks"]:
            title = str(task.get("title", "")).strip()[:300]
            if title:
                db.execute("INSERT INTO tasks (id, meeting_id, title, assignee, due_date, status, source_text, created_at) VALUES (?, ?, ?, ?, ?, 'needs_review', ?, ?)", (str(uuid.uuid4()), meeting_id, title, str(task.get("assignee", ""))[:160], str(task.get("due_date", ""))[:40] or None, str(task.get("source_text", ""))[:1000], now()))
        row = db.execute("SELECT * FROM meetings WHERE id = ? AND workspace_id = ?", (meeting_id, user["workspace_id"])).fetchone()
        return public_meeting(row, db)

@router.patch("/{meeting_id}/tasks/{task_id}")
def update_task(meeting_id: str, task_id: str, payload: TaskUpdate, user: dict = Depends(require_user)):
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Provide at least one task field to update")
    if any(value is None for key, value in changes.items() if key != "due_date"):
        raise HTTPException(status_code=422, detail="Task fields cannot be null")
    if supabase_configured():
        client = supabase_client()
        meeting = client.table("meetings").select("id").eq("id", meeting_id).eq("workspace_id", user["workspace_id"]).limit(1).execute().data
        task = client.table("tasks").select("id").eq("id", task_id).eq("meeting_id", meeting_id).limit(1).execute().data
        if not meeting or not task:
            raise HTTPException(status_code=404, detail="Task not found")
        updated = client.table("tasks").update(changes).eq("id", task_id).eq("meeting_id", meeting_id).execute().data
        return updated[0]
    with connect() as db:
        exists = db.execute("SELECT tasks.id FROM tasks JOIN meetings ON meetings.id = tasks.meeting_id WHERE tasks.id = ? AND tasks.meeting_id = ? AND meetings.workspace_id = ?", (task_id, meeting_id, user["workspace_id"])).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Task not found")
        db.execute("UPDATE tasks SET " + ", ".join(f"{key} = ?" for key in changes) + " WHERE id = ? AND meeting_id = ?", (*changes.values(), task_id, meeting_id))
        return dict(db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())


@router.get("/{meeting_id}/minutes", response_class=PlainTextResponse)
def download_minutes(meeting_id: str, user: dict = Depends(require_user)):
    if supabase_configured():
        client = supabase_client()
        rows = client.table("meetings").select("*").eq("id", meeting_id).eq("workspace_id", user["workspace_id"]).limit(1).execute().data
        if not rows:
            raise HTTPException(status_code=404, detail="Meeting not found")
        row = rows[0]
        tasks = client.table("tasks").select("*").eq("meeting_id", meeting_id).order("created_at").execute().data or []
    else:
        with connect() as db:
            row = db.execute("SELECT * FROM meetings WHERE id = ? AND workspace_id = ?", (meeting_id, user["workspace_id"])).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Meeting not found")
            tasks = db.execute("SELECT * FROM tasks WHERE meeting_id = ? ORDER BY created_at", (meeting_id,)).fetchall()
    points, decisions = json_list(row["key_points"]), json_list(row["decisions"])
    body = [f"# {row['title']}", "", f"Date: {row['created_at']}", f"Status: {row['status']}", "", "## Summary", row["summary"] or "No summary available.", "", "## Key points"]
    body += [f"- {item}" for item in points] or ["- No key points available."]
    body += ["", "## Decisions"] + ([f"- {item}" for item in decisions] or ["- No decisions available."])
    body += ["", "## Action items"]
    body += [f"- [{task['status']}] {task['title']} — {task['assignee'] or 'Unassigned'} — due {task['due_date'] or 'not set'}" for task in tasks] or ["- No action items."]
    body += ["", "## Transcript", row["transcript"] or "No transcript available.", ""]
    return PlainTextResponse("\n".join(body), headers={"Content-Disposition": f'attachment; filename="minutes-{meeting_id}.md"'})


@router.get("/calendar/export.ics", response_class=PlainTextResponse)
def export_calendar(user: dict = Depends(require_user)):
    if supabase_configured():
        client = supabase_client()
        meetings = client.table("meetings").select("id,title").eq("workspace_id", user["workspace_id"]).execute().data or []
        meeting_titles = {meeting["id"]: meeting["title"] for meeting in meetings}
        tasks = client.table("tasks").select("*").in_("meeting_id", list(meeting_titles)).not_.is_("due_date", "null").neq("status", "rejected").order("due_date").execute().data if meeting_titles else []
        tasks = [{**task, "meeting_title": meeting_titles.get(task["meeting_id"], "")} for task in tasks or []]
    else:
        with connect() as db:
            tasks = db.execute("SELECT tasks.*, meetings.title AS meeting_title FROM tasks JOIN meetings ON meetings.id = tasks.meeting_id WHERE tasks.due_date IS NOT NULL AND tasks.status != 'rejected' AND meetings.workspace_id = ? ORDER BY tasks.due_date", (user["workspace_id"],)).fetchall()
    def escape(value: str) -> str:
        return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MeetMind//Local Calendar//EN", "CALSCALE:GREGORIAN"]
    for task in tasks:
        try:
            due = datetime.fromisoformat(task["due_date"][:10]).strftime("%Y%m%d")
        except ValueError:
            continue
        lines.extend(["BEGIN:VEVENT", f"UID:{task['id']}@meetmind.local", f"DTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}", f"DTSTART;VALUE=DATE:{due}", f"SUMMARY:{escape(task['title'])}", f"DESCRIPTION:{escape('Meeting: ' + task['meeting_title'] + '. Assignee: ' + (task['assignee'] or 'Unassigned'))}", "END:VEVENT"])
    lines.append("END:VCALENDAR")
    return PlainTextResponse("\r\n".join(lines), media_type="text/calendar", headers={"Content-Disposition": 'attachment; filename="meetmind-tasks.ics"'})

@router.websocket("/{meeting_id}/audio")
async def stream_audio(websocket: WebSocket, meeting_id: str):
    origin = websocket.headers.get("origin", "")
    allowed = {"http://localhost:5173", "http://127.0.0.1:5173"}
    if origin not in allowed:
        await websocket.close(code=4403, reason="Origin not allowed")
        return
    user = session_user(websocket.cookies.get(COOKIE_NAME))
    if not user:
        await websocket.close(code=4401, reason="Sign in to continue")
        return
    if supabase_configured():
        rows = supabase_client().table("meetings").select("id,status").eq("id", meeting_id).eq("workspace_id", user["workspace_id"]).limit(1).execute().data
        row = rows[0] if rows else None
    else:
        with connect() as db:
            row = db.execute("SELECT id, status FROM meetings WHERE id = ? AND workspace_id = ?", (meeting_id, user["workspace_id"])).fetchone()
    if row is None or row["status"] not in {"ready", "failed", "interrupted"}:
        await websocket.close(code=4409, reason="Meeting unavailable")
        return
    await websocket.accept()
    recording_path = UPLOAD_DIR / f"{meeting_id}.webm"
    total_bytes, elapsed = 0, 0.0
    seen_segments: set[tuple[int, str]] = set()
    transcription_failed = False
    transcription_error = ""
    model_capability_sent = False
    command_started = False
    finalized = False
    try:
        with recording_path.open("xb") as recording:
            while True:
                message = await websocket.receive()
                if message.get("bytes") is not None:
                    chunk = message["bytes"]
                    if len(chunk) > MAX_CHUNK_BYTES or total_bytes + len(chunk) > MAX_RECORDING_BYTES:
                        await websocket.send_json({"type": "error", "message": "Recording size limit reached. Stop the meeting and try a shorter recording."})
                        raise ValueError("Recording limit exceeded")
                    recording.write(chunk)
                    total_bytes += len(chunk)
                    elapsed += 3
                    recording.flush()
                    if elapsed >= 12 and total_bytes > 4096 and not transcription_failed:
                        elapsed = 0
                        snapshot_path: Path | None = None
                        try:
                            with tempfile.NamedTemporaryFile(suffix=".webm", dir=UPLOAD_DIR, delete=False) as snapshot:
                                snapshot_path = Path(snapshot.name)
                            shutil.copyfile(recording_path, snapshot_path)
                            segments = await run_in_threadpool(transcribe_file, snapshot_path)
                            for segment in segments:
                                key = (round(segment["start"]), segment["text"])
                                if key not in seen_segments:
                                    seen_segments.add(key)
                                    insert_transcript_segment(meeting_id, segment)
                                    await websocket.send_json({"type": "transcript", "segment": segment})
                            model_capability_sent = True
                        except RuntimeError as exc:
                            transcription_failed, transcription_error = True, str(exc)
                            if not model_capability_sent:
                                await websocket.send_json({"type": "notice", "message": transcription_error})
                        except Exception:
                            # Growing WebM snapshots may not be decodable until the recorder finalizes.
                            pass
                        finally:
                            if snapshot_path is not None:
                                snapshot_path.unlink(missing_ok=True)
                    continue
                if message.get("text"):
                    command = json.loads(message["text"])
                    if command.get("type") == "start" and not command_started:
                        command_started = True
                        update_meeting_record(meeting_id, {"status": "recording", "started_at": now(), "recording_path": str(recording_path), "error": None})
                        await websocket.send_json({"type": "status", "status": "recording"})
                    elif command.get("type") == "stop":
                        break
        if not command_started:
            raise ValueError("Recording session did not start")
        update_meeting_record(meeting_id, {"status": "processing", "ended_at": now(), "recording_path": str(recording_path)})
        try:
            await websocket.send_json({"type": "status", "status": "processing", "phase": "transcription"})
        except Exception:
            # Keep processing and persisting if the browser disconnects after sending stop.
            logger.info("Client disconnected after stopping meeting %s", meeting_id)
        final_segments: list[dict[str, Any]] = []
        try:
            final_segments = await run_in_threadpool(transcribe_file, recording_path)
            transcription_failed, transcription_error = False, ""
        except RuntimeError as exc:
            transcription_failed, transcription_error = True, str(exc)
        except Exception:
            logger.exception("Final transcription failed for meeting %s", meeting_id)
            transcription_failed, transcription_error = True, "Transcription failed. The recording was retained for retry."
        if not final_segments and not transcription_failed:
            transcription_failed = True
            transcription_error = "Whisper did not detect speech in this recording. Check the shared-tab audio and try again."
        if transcription_failed:
            # Keep interim segments as a recoverable partial transcript; do not call the LLM on failed ASR.
            final_segments = get_transcript_segments(meeting_id)
        speaker_notice = None
        if final_segments and not transcription_failed:
            try:
                final_segments, speaker_notice = await run_in_threadpool(label_speakers, recording_path, final_segments)
            except Exception:
                logger.exception("Speaker labeling failed for meeting %s", meeting_id)
                speaker_notice = "Speaker labels could not be generated; the transcript is still available."
        transcript = "\n".join(f"[{part['start']:0.1f}s] {part['speaker'] + ': ' if part.get('speaker') else ''}{part['text']}" for part in final_segments)
        if not transcription_failed:
            # Replace interim snapshots with the finalized transcript segments.
            if supabase_configured():
                client = supabase_client()
                client.table("transcript_segments").delete().eq("meeting_id", meeting_id).execute()
                if final_segments:
                    client.table("transcript_segments").insert([{"meeting_id": meeting_id, "start_seconds": item["start"], "end_seconds": item["end"], "speaker": item.get("speaker"), "text": item["text"], "created_at": now()} for item in final_segments]).execute()
            else:
                with connect() as db:
                    db.execute("DELETE FROM transcript_segments WHERE meeting_id = ?", (meeting_id,))
                    for segment in final_segments:
                        db.execute("INSERT INTO transcript_segments (meeting_id, start_seconds, end_seconds, speaker, text, created_at) VALUES (?, ?, ?, ?, ?, ?)", (meeting_id, segment["start"], segment["end"], segment["speaker"], segment["text"], now()))
        analysis: dict[str, Any] = {"summary": "", "key_points": [], "decisions": [], "tasks": [], "status": "skipped"}
        analysis_error = ""
        if transcript and not transcription_failed:
            try:
                analysis = await run_in_threadpool(analyze_transcript, transcript)
            except Exception:
                logger.exception("Meeting analysis failed for meeting %s", meeting_id)
                analysis_error = "Transcript saved, but AI analysis did not complete. You can retry it later."
        final_status = "failed" if transcription_failed else ("completed" if transcript else "saved")
        if supabase_configured():
            update_meeting_record(meeting_id, {"status": final_status, "ended_at": now(), "transcript": transcript, "summary": analysis.get("summary", ""), "key_points": analysis.get("key_points", []), "decisions": analysis.get("decisions", []), "error": analysis_error or transcription_error or None})
            tasks_to_save = []
            for task in analysis.get("tasks", []):
                title = str(task.get("title", "")).strip()[:300]
                if title:
                    tasks_to_save.append({"id": str(uuid.uuid4()), "meeting_id": meeting_id, "title": title, "assignee": str(task.get("assignee", ""))[:160], "due_date": str(task.get("due_date", ""))[:40] or None, "status": "needs_review", "source_text": str(task.get("source_text", ""))[:1000], "created_at": now()})
            if tasks_to_save:
                supabase_client().table("tasks").insert(tasks_to_save).execute()
        else:
            with connect() as db:
                db.execute("UPDATE meetings SET status = ?, ended_at = COALESCE(ended_at, ?), transcript = ?, summary = ?, key_points = ?, decisions = ?, error = ? WHERE id = ?", (final_status, now(), transcript, analysis.get("summary", ""), json.dumps(analysis.get("key_points", [])), json.dumps(analysis.get("decisions", [])), analysis_error or transcription_error, meeting_id))
                for task in analysis.get("tasks", []):
                    title = str(task.get("title", "")).strip()[:300]
                    if title:
                        db.execute("INSERT INTO tasks (id, meeting_id, title, assignee, due_date, status, source_text, created_at) VALUES (?, ?, ?, ?, ?, 'needs_review', ?, ?)", (str(uuid.uuid4()), meeting_id, title, str(task.get("assignee", ""))[:160], str(task.get("due_date", ""))[:40] or None, str(task.get("source_text", ""))[:1000], now()))
        finalized = True
        retention_days = int(os.getenv("AUDIO_RETENTION_DAYS", "30"))
        if retention_days <= 0:
            recording_path.unlink(missing_ok=True)
            update_meeting_record(meeting_id, {"recording_path": None})
        if analysis_error:
            process_message = analysis_error
        elif transcription_error:
            process_message = transcription_error
        elif not transcript:
            process_message = "Recording saved. Install faster-whisper to enable transcription."
        elif analysis.get("status") != "complete":
            process_message = "Transcript saved. Configure an LLM provider to generate meeting insights."
        else:
            process_message = ""
        message = "; ".join(item for item in (process_message, speaker_notice) if item)
        try:
            await websocket.send_json({"type": "complete", "status": final_status, "transcript": transcript, "analysis": analysis, "speaker_notice": speaker_notice, "message": message})
        except Exception:
            # Final results are durable even if the client closed before receiving them.
            logger.info("Final results for meeting %s were saved after the client disconnected", meeting_id)
    except WebSocketDisconnect:
        logger.warning("Audio WebSocket disconnected for meeting %s before completion", meeting_id)
        update_meeting_record(meeting_id, {"status": "interrupted", "ended_at": now(), "recording_path": str(recording_path) if recording_path.exists() else None, "error": "Audio connection ended before processing completed. The recording was retained when available."})
    except Exception:
        logger.exception("Audio recording pipeline failed for meeting %s", meeting_id)
        if finalized:
            # Results are committed; a failed final notification must not undo them.
            return
        error_message = "Recording processing failed. Check the backend terminal for details; the recording was retained when available."
        partial_segments = get_transcript_segments(meeting_id)
        partial_transcript = "\n".join(f"[{item['start']:0.1f}s] {item['speaker'] + ': ' if item['speaker'] else ''}{item['text']}" for item in partial_segments)
        update_meeting_record(meeting_id, {"status": "failed", "ended_at": now(), "recording_path": str(recording_path) if recording_path.exists() else None, "transcript": partial_transcript, "error": error_message})
        try:
            if websocket.application_state == WebSocketState.CONNECTED:
                await websocket.send_json({"type": "error", "status": "failed", "message": error_message, "transcript": partial_transcript})
                await websocket.close()
        except Exception:
            # The client may already have disconnected while the server was processing audio.
            pass
