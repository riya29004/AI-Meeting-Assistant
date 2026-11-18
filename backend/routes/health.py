"""Lightweight API health endpoint."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health_check():
    return {"status": "healthy", "features": {"database": "sqlite", "transcription": "faster-whisper", "analysis": "optional-openai-compatible"}}
