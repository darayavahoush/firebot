"""Download the WeSpeaker ONNX speaker model into pretrained_models/wespeaker (idempotent).

Run at build time (render.yaml / Dockerfile do) so the first request doesn't have to wait for it.
Override the source with FIREBOT_SPEAKER_MODEL_URL, the location with FIREBOT_SPEAKER_MODEL_DIR.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("FIREBOT_SPEAKER_MODEL_DIR",
                      str(Path(__file__).resolve().parents[1] / "pretrained_models" / "wespeaker"))

from firebot.speech.speaker_embed import SpeakerModelError, WeSpeakerOnnx

try:
    m = WeSpeakerOnnx()
except SpeakerModelError as e:
    sys.exit(f"speaker model unavailable: {e}")
print(f"speaker model ready: {m.path}")
