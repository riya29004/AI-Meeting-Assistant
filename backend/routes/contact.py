"""Public contact form delivery."""

from __future__ import annotations

import logging
import os
import re
import time
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from services.reminders import _send_email, smtp_is_configured

router = APIRouter(prefix="/api/contact", tags=["contact"])
logger = logging.getLogger(__name__)
EMAIL_PATTERN = re.compile(r"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$")
CONTACT_EMAIL = os.getenv("CONTACT_EMAIL", "riya.g290604@gmail.com").strip()
SUBMISSIONS: dict[str, list[float]] = defaultdict(list)


class ContactSubmission(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=254)
    subject: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=20, max_length=5000)

    @field_validator("name", "subject", "message")
    @classmethod
    def require_non_whitespace(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field cannot be blank")
        return value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Enter a valid email address")
        return value


@router.get("/config")
def contact_config():
    return {"email": CONTACT_EMAIL}


@router.post("", status_code=202)
def submit_contact(payload: ContactSubmission, request: Request):
    client_ip = request.client.host if request.client else "local"
    now = time.time()
    recent = [sent for sent in SUBMISSIONS[client_ip] if now - sent < 3600]
    if len(recent) >= 5:
        raise HTTPException(status_code=429, detail="Too many messages were sent. Please try again later.")
    if not CONTACT_EMAIL or not smtp_is_configured():
        raise HTTPException(status_code=503, detail="Contact messages are temporarily unavailable. Please email support directly.")

    recent.append(now)
    SUBMISSIONS[client_ip] = recent
    body = f"Name: {payload.name}\nEmail: {payload.email}\n\n{payload.message}"
    try:
        _send_email(CONTACT_EMAIL, f"MeetMind contact: {payload.subject}", body, reply_to=payload.email)
    except Exception as exc:
        logger.warning("Contact form delivery failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=502, detail="We could not send your message right now. Please try again shortly.") from exc

    return {"message": "Your message has been sent. We’ll get back to you soon."}
