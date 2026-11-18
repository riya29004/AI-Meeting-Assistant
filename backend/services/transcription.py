"""Lazy-loaded faster-whisper transcription for saved meeting audio."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

_model: Any = None
_model_name: str | None = None


def transcribe_file(path: Path) -> list[dict[str, Any]]:
    """Transcribe a complete audio file into timestamped, speaker-neutral segments."""
    global _model, _model_name
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError("Transcription dependency is missing. From the backend folder, run: .venv\\Scripts\\python.exe -m pip install -r requirements.txt") from exc
    requested_model = os.getenv("WHISPER_MODEL", "base")
    if _model is None or _model_name != requested_model:
        _model = WhisperModel(requested_model, device=os.getenv("WHISPER_DEVICE", "cpu"), compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8"))
        _model_name = requested_model
    segments, _ = _model.transcribe(str(path), vad_filter=True, word_timestamps=False)
    return [{"start": float(segment.start), "end": float(segment.end), "speaker": None, "text": segment.text.strip()} for segment in segments if segment.text.strip()]
