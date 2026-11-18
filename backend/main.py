"""FastAPI application entry point and process lifecycle hooks."""

import asyncio
from dotenv import load_dotenv

# Load settings before importing modules that read environment variables.
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from database import initialize_database
from routes.auth import router as auth_router
from routes.health import router as health_router
from routes.meetings import router as meetings_router
from services.reminders import reminder_worker
ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}

app = FastAPI(title="MeetMind Local API", version="0.3.0", docs_url="/api/docs", redoc_url=None)
reminder_task: asyncio.Task | None = None
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)

@app.middleware("http")
async def local_security(request, call_next):
    origin = request.headers.get("origin")
    if request.method in {"POST", "PATCH", "DELETE"} and origin and origin not in ALLOWED_ORIGINS:
        from starlette.responses import JSONResponse
        return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Permissions-Policy"] = "microphone=(self), camera=()"
    return response

@app.on_event("startup")
async def startup() -> None:
    global reminder_task
    initialize_database()
    reminder_task = asyncio.create_task(reminder_worker())

@app.on_event("shutdown")
async def shutdown() -> None:
    if reminder_task is not None:
        reminder_task.cancel()
        try:
            await reminder_task
        except asyncio.CancelledError:
            pass

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(meetings_router)

@app.get("/")
def home():
    return {"message": "MeetMind local API is running"}
