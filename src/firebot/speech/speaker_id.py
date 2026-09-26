"""Speaker identification for operator accountability: which enrolled human issued a given
voice command, logged alongside the existing typed/voice/backstop `channel` in `Brain._record`.

Deliberately NOT used to personalize command matching -- `RuleParser` is deterministic and
already accent/phrasing-robust (see `command/parser.py`'s regex coverage); a per-speaker
command-variant profile would duplicate that for no correctness gain. This module answers a
different question -- "who said it", for the audit trail -- not "what did they say".

Uses SpeechBrain's pretrained ECAPA-TDNN (voice-fingerprint embeddings, not trained on your
specific speakers) exactly as already proven out in `voice_intent_transcribe.py`; this module
just gives it a home in the production `speech/` path instead of the standalone prototype.
Cosine-similarity threshold matching is hand-rolled (pure numpy) rather than pulled from a
library, matching `fusion/eif.py`/`fusion/pose_ekf.py`'s existing pattern: the only actually
heavy dependency here is the pretrained embedding model itself, which nothing hand-rolled can
replace -- everything downstream of the embedding is plain, readable math.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

DEFAULT_VOICEPRINT_DIR = Path("data/voiceprints")
DEFAULT_THRESHOLD = 0.5  # cosine similarity below this -> "unrecognized", not a guess

_model_cache: dict[str, object] = {}


def _load_model():
    if "model" not in _model_cache:
        from speechbrain.inference.speaker import EncoderClassifier  # optional, heavy dependency
        _model_cache["model"] = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir="pretrained_models/spkrec-ecapa-voxceleb",
        )
    return _model_cache["model"]


def pcm16_to_float(pcm: bytes) -> np.ndarray:
    """16-bit PCM bytes (the format every `speech/` audio source already yields) -> float32
    [-1, 1] mono array, the format SpeechBrain's encoder expects."""
    return (np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))


class SpeakerIdentifier:
    """`voiceprint_dir`: one `.npy` embedding per enrolled speaker, same on-disk layout
    `voice_intent_transcribe.py`'s `enroll-voice` already produces -- point this at the same
    directory and existing enrollments carry over with zero re-recording.
    """

    def __init__(self, voiceprint_dir: Path | str = DEFAULT_VOICEPRINT_DIR,
                threshold: float = DEFAULT_THRESHOLD) -> None:
        self.voiceprint_dir = Path(voiceprint_dir)
        self.threshold = threshold
        self._voiceprints: dict[str, np.ndarray] | None = None

    def _voiceprints_cached(self) -> dict[str, np.ndarray]:
        if self._voiceprints is None:
            self._voiceprints = (
                {p.stem: np.load(p) for p in self.voiceprint_dir.glob("*.npy")}
                if self.voiceprint_dir.exists() else {}
            )
        return self._voiceprints

    def reload(self) -> None:
        """Call after enrolling a new speaker mid-process, so `identify` sees them without a
        restart -- e.g. right after `enroll()` below."""
        self._voiceprints = None

    def embed(self, pcm: bytes) -> np.ndarray:
        """PCM bytes (any length -- longer/cleaner audio gives a more reliable embedding, same
        caveat as the original prototype) -> 192-dim voiceprint vector."""
        import torch
        model = _load_model()
        audio = torch.from_numpy(pcm16_to_float(pcm)).unsqueeze(0)
        with torch.no_grad():
            embedding = model.encode_batch(audio)
        return embedding.squeeze().cpu().numpy()

    def identify(self, pcm: bytes) -> tuple[str | None, float]:
        """Returns (speaker_name_or_None, best_score). None means either no one is enrolled
        yet, or the closest enrolled voice isn't a confident enough match -- reported as
        "unrecognized" rather than guessed at, same policy as `command/parser.py`'s UNKNOWN
        intent: an uncertain answer is reported as uncertain, never silently upgraded."""
        voiceprints = self._voiceprints_cached()
        if not voiceprints:
            return None, 0.0
        embedding = self.embed(pcm)
        scored = [(name, cosine_similarity(embedding, ref)) for name, ref in voiceprints.items()]
        scored.sort(key=lambda x: -x[1])
        best_name, best_score = scored[0]
        return (best_name, best_score) if best_score >= self.threshold else (None, best_score)

    def enroll(self, speaker: str, pcm: bytes) -> None:
        """Save `speaker`'s voiceprint from a natural-speech clip (several seconds, not a
        single command word -- same guidance as the original `enroll-voice` prototype)."""
        self.voiceprint_dir.mkdir(parents=True, exist_ok=True)
        np.save(self.voiceprint_dir / f"{speaker}.npy", self.embed(pcm))
        self.reload()
