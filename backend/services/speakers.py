"""Optional speaker diarization for timestamped transcript segments."""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

_pipeline: Any = None
_pipeline_lock = threading.Lock()


def label_speakers(path: Path, segments: list[dict]) -> tuple[list[dict], str | None]:
    token = os.getenv("HF_TOKEN", "").strip()
    if not token:
        return segments, "Speaker labels are off. Set HF_TOKEN and install requirements-speaker.txt to enable local diarization."
    global _pipeline
    try:
        from pyannote.audio import Pipeline
    except ImportError:
        return segments, "Speaker labels are off. Install requirements-speaker.txt in the backend environment."
    try:
        with _pipeline_lock:
            if _pipeline is None:
                _pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-community-1", token=token)
        output = _pipeline(str(path))
        turns = list(output.speaker_diarization)
        first_seen: dict[str, str] = {}
        for turn, speaker in turns:
            if speaker not in first_seen:
                first_seen[speaker] = f"Speaker {len(first_seen) + 1}"
        labeled = []
        for segment in segments:
            best_speaker, best_overlap = None, 0.0
            for turn, speaker in turns:
                overlap = max(0.0, min(segment["end"], turn.end) - max(segment["start"], turn.start))
                if overlap > best_overlap:
                    best_speaker, best_overlap = speaker, overlap
            labeled.append({**segment, "speaker": first_seen.get(best_speaker) if best_speaker else None})
        return labeled, None
    except Exception:
        # Do not fail meeting capture/transcription if an optional gated model is unavailable.
        return segments, "Speaker diarization could not run. Check the Hugging Face token, model access, and ffmpeg installation."

