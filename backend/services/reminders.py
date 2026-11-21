"""Scheduled email reminders for pending tasks with due dates."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import smtplib
import ssl
from datetime import date, datetime, timezone
from email.message import EmailMessage

from database import connect, supabase_client, supabase_configured

logger = logging.getLogger(__name__)
EMAIL_PATTERN = re.compile(r"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$")


def smtp_is_configured() -> bool:
    return bool(
        os.getenv("SMTP_HOST", "").strip()
        and (os.getenv("SMTP_FROM_EMAIL", "").strip() or os.getenv("SMTP_USERNAME", "").strip())
    )


def _send_email(recipient: str, subject: str, body: str, reply_to: str | None = None) -> None:
    host = os.getenv("SMTP_HOST", "").strip()
    port = int(os.getenv("SMTP_PORT", "587"))
    username = os.getenv("SMTP_USERNAME", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    sender = os.getenv("SMTP_FROM_EMAIL", "").strip() or username
    use_starttls = os.getenv("SMTP_USE_TLS", "true").strip().lower() == "true"

    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = subject
    if reply_to:
        message["Reply-To"] = reply_to
    message.set_content(body)

    with smtplib.SMTP(host, port, timeout=20) as smtp:
        smtp.ehlo()
        if use_starttls:
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
        if username:
            smtp.login(username, password)
        smtp.send_message(message)


def send_due_task_reminders(today: date | None = None) -> int:
    """Send one email per pending task per day once its due date arrives."""
    if not smtp_is_configured():
        return 0

    current_date = today or date.today()
    day_key = current_date.isoformat()
    if supabase_configured():
        rows = supabase_client().table("tasks").select("id,title,assignee,due_date").eq("status", "pending").not_.is_("due_date", "null").order("due_date").execute().data or []
    else:
        with connect() as db:
            rows = db.execute(
                """SELECT tasks.id, tasks.title, tasks.assignee, tasks.due_date
                   FROM tasks
                   JOIN meetings ON meetings.id = tasks.meeting_id
                   WHERE tasks.status = 'pending' AND tasks.due_date IS NOT NULL
                   ORDER BY tasks.due_date"""
            ).fetchall()

    sent = 0
    for row in rows:
        recipient = str(row["assignee"] or "").strip()
        if not EMAIL_PATTERN.fullmatch(recipient):
            continue
        try:
            due_date = date.fromisoformat(str(row["due_date"])[:10])
        except ValueError:
            continue
        if due_date > current_date:
            continue

        if supabase_configured():
            already_sent = supabase_client().table("task_reminder_sends").select("task_id").eq("task_id", row["id"]).eq("reminder_date", day_key).limit(1).execute().data
        else:
            with connect() as db:
                already_sent = db.execute(
                    "SELECT 1 FROM task_reminder_sends WHERE task_id = ? AND reminder_date = ?",
                    (row["id"], day_key),
                ).fetchone()
        if already_sent:
            continue

        is_overdue = due_date < current_date
        subject = "MeetMind task overdue" if is_overdue else "MeetMind task due today"
        body = (
            f"Reminder: {row['title']}\n\n"
            f"Due date: {due_date.isoformat()}\n"
            + ("This task is overdue. Please update its status when complete.\n" if is_overdue else "This task is due today.\n")
            + "\nThis reminder was sent by your local MeetMind workspace."
        )
        try:
            _send_email(recipient, subject, body)
        except (OSError, smtplib.SMTPException, ValueError) as exc:
            logger.warning("Could not send task reminder for task %s (%s)", row["id"], type(exc).__name__)
            continue

        reminder_row = {"task_id": row["id"], "reminder_date": day_key, "sent_at": datetime.now(timezone.utc).isoformat()}
        if supabase_configured():
            supabase_client().table("task_reminder_sends").upsert(reminder_row, on_conflict="task_id,reminder_date", ignore_duplicates=True).execute()
        else:
            with connect() as db:
                db.execute(
                    "INSERT OR IGNORE INTO task_reminder_sends (task_id, reminder_date, sent_at) VALUES (?, ?, ?)",
                    (row["id"], day_key, reminder_row["sent_at"]),
                )
        sent += 1
    return sent


async def reminder_worker() -> None:
    interval = max(300, int(os.getenv("TASK_REMINDER_INTERVAL_SECONDS", "3600")))
    while True:
        try:
            count = await asyncio.to_thread(send_due_task_reminders)
            if count:
                logger.info("Sent %s task reminder email(s)", count)
        except Exception:
            logger.exception("Task reminder check failed")
        await asyncio.sleep(interval)
