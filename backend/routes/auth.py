"""Local account sessions, authentication, and workspace membership routes."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from database import connect, supabase_client, supabase_configured

router = APIRouter(prefix="/api/auth", tags=["authentication"])
COOKIE_NAME = "meetmind_session"
SESSION_DAYS = 7
PBKDF2_ROUNDS = 310_000
LOGIN_ATTEMPTS: dict[str, list[float]] = {}
REGISTER_ATTEMPTS: dict[str, list[float]] = {}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat()


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt_hex, expected = encoded.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds)).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_user(token: str | None):
    if not token:
        return None
    if supabase_configured():
        client = supabase_client()
        session = client.table("sessions").select("user_id").eq("token_hash", token_hash(token)).gt("expires_at", iso_now()).limit(1).execute().data
        if not session:
            return None
        user_id = session[0]["user_id"]
        user = client.table("users").select("id,email").eq("id", user_id).limit(1).execute().data
        memberships = client.table("workspace_members").select("workspace_id,role").eq("user_id", user_id).order("joined_at", desc=True).limit(1).execute().data
        if not user or not memberships:
            return None
        return {**user[0], **memberships[0]}
    with connect() as db:
        row = db.execute("SELECT users.id, users.email, workspace_members.workspace_id, workspace_members.role FROM sessions JOIN users ON users.id = sessions.user_id JOIN workspace_members ON workspace_members.user_id = users.id WHERE sessions.token_hash = ? AND sessions.expires_at > ? ORDER BY workspace_members.joined_at DESC LIMIT 1", (token_hash(token), iso_now())).fetchone()
        return dict(row) if row else None


def require_user(request: Request) -> dict:
    user = session_user(request.cookies.get(COOKIE_NAME))
    if not user:
        raise HTTPException(status_code=401, detail="Sign in to continue")
    return user


def set_session(response: Response, user_id: str) -> None:
    raw_token = secrets.token_urlsafe(32)
    created = utc_now()
    if supabase_configured():
        supabase_client().table("sessions").insert({
            "token_hash": token_hash(raw_token),
            "user_id": user_id,
            "expires_at": (created + timedelta(days=SESSION_DAYS)).isoformat(),
            "created_at": created.isoformat(),
        }).execute()
        response.set_cookie(COOKIE_NAME, raw_token, max_age=SESSION_DAYS * 86400, httponly=True, secure=False, samesite="strict", path="/")
        return
    with connect() as db:
        db.execute("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", (token_hash(raw_token), user_id, (created + timedelta(days=SESSION_DAYS)).isoformat(), created.isoformat()))
    response.set_cookie(COOKIE_NAME, raw_token, max_age=SESSION_DAYS * 86400, httponly=True, secure=False, samesite="strict", path="/")


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=256)


class JoinWorkspace(BaseModel):
    code: str = Field(min_length=20, max_length=128)


def validate_email(value: str) -> str:
    email = value.strip().lower()
    name, parsed = parseaddr(email)
    if name or parsed != email or "@" not in email or "." not in email.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    return email


def check_rate(request: Request, buckets: dict[str, list[float]], limit: int, window_seconds: int, message: str) -> None:
    ip = request.client.host if request.client else "local"
    current = time.time()
    recent = [stamp for stamp in buckets.get(ip, []) if current - stamp < window_seconds]
    if len(recent) >= limit:
        raise HTTPException(status_code=429, detail=message)
    recent.append(current)
    buckets[ip] = recent


@router.post("/register", status_code=201)
def register(payload: Credentials, response: Response, request: Request):
    check_rate(request, REGISTER_ATTEMPTS, 5, 3600, "Too many account creation attempts. Try again later.")
    email = validate_email(payload.email)
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Use a password with at least 8 characters")
    user_id, workspace_id, created = str(uuid.uuid4()), str(uuid.uuid4()), iso_now()
    workspace_name = email.split("@", 1)[0][:80] + "'s workspace"
    if supabase_configured():
        client = supabase_client()
        if client.table("users").select("id").eq("email", email).limit(1).execute().data:
            raise HTTPException(status_code=409, detail="An account with this email already exists")
        try:
            client.table("users").insert({"id": user_id, "email": email, "password_hash": hash_password(payload.password), "created_at": created}).execute()
            client.table("workspaces").insert({"id": workspace_id, "name": workspace_name, "created_at": created}).execute()
            client.table("workspace_members").insert({"workspace_id": workspace_id, "user_id": user_id, "role": "owner", "joined_at": created}).execute()
            client.table("meetings").update({"workspace_id": workspace_id}).eq("workspace_id", "").execute()
        except Exception:
            client.table("users").delete().eq("id", user_id).execute()
            client.table("workspaces").delete().eq("id", workspace_id).execute()
            raise
        set_session(response, user_id)
        return {"id": user_id, "email": email, "workspace_id": workspace_id, "role": "owner"}
    with connect() as db:
        if db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
            raise HTTPException(status_code=409, detail="An account with this email already exists")
        db.execute("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)", (user_id, email, hash_password(payload.password), created))
        db.execute("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)", (workspace_id, workspace_name, created))
        db.execute("INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)", (workspace_id, user_id, created))
        # One-time migration: assign pre-account local meetings to the first account.
        db.execute("UPDATE meetings SET workspace_id = ? WHERE workspace_id = ''", (workspace_id,))
    set_session(response, user_id)
    return {"id": user_id, "email": email, "workspace_id": workspace_id, "role": "owner"}


@router.post("/login")
def login(payload: Credentials, request: Request, response: Response):
    check_rate(request, LOGIN_ATTEMPTS, 8, 900, "Too many sign-in attempts. Wait 15 minutes and try again.")
    email = validate_email(payload.email)
    if supabase_configured():
        users = supabase_client().table("users").select("id,email,password_hash").eq("email", email).limit(1).execute().data
        row = users[0] if users else None
    else:
        with connect() as db:
            row = db.execute("SELECT id, email, password_hash FROM users WHERE email = ?", (email,)).fetchone()
    if not row or not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    LOGIN_ATTEMPTS.pop(request.client.host if request.client else "local", None)
    set_session(response, row["id"])
    return {"id": row["id"], "email": row["email"]}


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        if supabase_configured():
            supabase_client().table("sessions").delete().eq("token_hash", token_hash(token)).execute()
        else:
            with connect() as db:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="strict")


@router.get("/me")
def me(request: Request):
    user = require_user(request)
    return {key: user[key] for key in ("id", "email", "workspace_id", "role")}


@router.get("/workspace/members")
def list_members(request: Request):
    user = require_user(request)
    if supabase_configured():
        client = supabase_client()
        memberships = client.table("workspace_members").select("user_id,role,joined_at").eq("workspace_id", user["workspace_id"]).order("joined_at").execute().data or []
        user_ids = [member["user_id"] for member in memberships]
        profiles = client.table("users").select("id,email").in_("id", user_ids).execute().data if user_ids else []
        emails = {profile["id"]: profile["email"] for profile in profiles or []}
        return [{"id": member["user_id"], "email": emails.get(member["user_id"], ""), "role": member["role"], "joined_at": member["joined_at"]} for member in memberships]
    with connect() as db:
        return [dict(row) for row in db.execute("SELECT users.id, users.email, workspace_members.role, workspace_members.joined_at FROM workspace_members JOIN users ON users.id = workspace_members.user_id WHERE workspace_members.workspace_id = ? ORDER BY workspace_members.joined_at", (user["workspace_id"],)).fetchall()]


@router.post("/workspace/invitations", status_code=201)
def create_invitation(request: Request):
    user = require_user(request)
    if user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only a workspace owner can create invitations")
    raw_code = secrets.token_urlsafe(32)
    created = utc_now()
    if supabase_configured():
        expires = (created + timedelta(days=7)).isoformat()
        supabase_client().table("invitations").insert({"code_hash": token_hash(raw_code), "workspace_id": user["workspace_id"], "created_by": user["id"], "expires_at": expires, "created_at": created.isoformat()}).execute()
        return {"code": raw_code, "expires_at": expires}
    with connect() as db:
        db.execute("INSERT INTO invitations (code_hash, workspace_id, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?)", (token_hash(raw_code), user["workspace_id"], user["id"], (created + timedelta(days=7)).isoformat(), created.isoformat()))
    return {"code": raw_code, "expires_at": (created + timedelta(days=7)).isoformat()}


@router.post("/workspace/join")
def join_workspace(payload: JoinWorkspace, request: Request):
    user = require_user(request)
    if supabase_configured():
        client = supabase_client()
        invitations = client.table("invitations").select("workspace_id").eq("code_hash", token_hash(payload.code)).gt("expires_at", iso_now()).limit(1).execute().data
        if not invitations:
            raise HTTPException(status_code=404, detail="Invitation is invalid or expired")
        workspace_id = invitations[0]["workspace_id"]
        client.table("workspace_members").upsert({"workspace_id": workspace_id, "user_id": user["id"], "role": "member", "joined_at": iso_now()}, on_conflict="workspace_id,user_id", ignore_duplicates=True).execute()
        client.table("invitations").delete().eq("code_hash", token_hash(payload.code)).execute()
        return {"workspace_id": workspace_id, "message": "You joined the workspace. It is now your active workspace."}
    with connect() as db:
        invitation = db.execute("SELECT * FROM invitations WHERE code_hash = ? AND expires_at > ?", (token_hash(payload.code), iso_now())).fetchone()
        if not invitation:
            raise HTTPException(status_code=404, detail="Invitation is invalid or expired")
        db.execute("INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)", (invitation["workspace_id"], user["id"], iso_now()))
        # Invitations are one-use to prevent forwarded codes from being reused.
        db.execute("DELETE FROM invitations WHERE code_hash = ?", (token_hash(payload.code),))
        return {"workspace_id": invitation["workspace_id"], "message": "You joined the workspace. It is now your active workspace."}

