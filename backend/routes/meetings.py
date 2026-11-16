from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, UploadFile, File

router = APIRouter()
UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"


@router.get("/meetings")
def get_meetings():
    return {"message": "Meetings endpoint is working"}


@router.post("/meetings/upload")
async def upload_meeting(file: UploadFile = File(...)):
    safe_name = Path(file.filename or "meeting-audio").name
    stored_name = f"{uuid4().hex[:12]}-{safe_name}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    upload_path = UPLOAD_DIR / stored_name

    with upload_path.open("wb") as buffer:
        while chunk := await file.read(1024 * 1024):
            buffer.write(chunk)

    return {
        "message": "File uploaded successfully",
        "filename": stored_name,
    }
