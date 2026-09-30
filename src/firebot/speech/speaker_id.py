"""Speaker identification for operator accountability: which enrolled human issued a given
voice command, logged alongside the existing typed/voice/backstop `channel` in `Brain._record`.

Deliberately NOT used to personalize command matching -- `RuleParser` is deterministic and
already accent/phrasing-robust (see `command/parser.py`'s regex coverage); a per-speaker
command-variant profile would duplicate that for no correctness gain. This module answers a
different question -- "who said it", for the audit trail -- not "what did they say".

Uses SpeechBrain's pretrained ECAPA-TDNN (voice-fingerprint embeddings, not trained on your
specific speakers) exactly as already proven out in `scripts/voice_intent_transcribe.py`; this module
just gives it a home in the production `speech/` path instead of the standalone prototype.
Cosine-similarity threshold matching is hand-rolled (pure numpy) rather than pulled from a
library, matching `fusion/eif.py`/`fusion/pose_ekf.py`'s existing pattern: the only actually
heavy dependency here is the pretrained embedding model itself, which nothing hand-rolled can
replace -- everything downstream of the embedding is plain, readable math.
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np

DEFAULT_VOICEPRINT_DIR = Path("data/voiceprints")
DEFAULT_THRESHOLD = 0.30  # cosine similarity below this -> "unrecognized", not a guess.
# Short command-length clips score well below the 0.5+ a long clip gets; run
# `python scripts/calibrate_speakers.py` to pick a value from your own recordings.

_model_cache: dict[str, object] = {}


def _load_model():
    if not os.environ.get("FIREBOT_USE_SPEECHBRAIN"):
        return None
    if "model" not in _model_cache:
        savedir = os.environ.get("FIREBOT_SPEAKER_MODEL_DIR") or "pretrained_models/spkrec-ecapa-voxceleb"
        p = Path(savedir)
        # Check if local model directory actually exists and has hyperparams.yaml
        if not (p.is_dir() and (p / "hyperparams.yaml").exists()):
            _model_cache["model"] = None
            return None
        try:
            from speechbrain.inference.speaker import EncoderClassifier  # optional, heavy dependency
            _model_cache["model"] = EncoderClassifier.from_hparams(
                source=str(p),
                savedir=str(p),
                run_opts={"device": "cpu"},
            )
        except Exception:
            _model_cache["model"] = None
    return _model_cache["model"]


def _fallback_embed(pcm: bytes, n_dim: int = 192) -> np.ndarray:
    """Deterministic, lightweight acoustic voiceprint vector (192-dim) computed from audio
    spectrogram statistics. Used when speechbrain is not installed."""
    audio = pcm16_to_float(pcm)
    if len(audio) < 400:
        return np.zeros(n_dim, dtype=np.float32)

    frame_len, hop = 400, 160
    n_frames = max(1, (len(audio) - frame_len) // hop + 1)
    window = np.hanning(frame_len).astype(np.float32)
    spec_bins = 64
    spectra = []
    for i in range(n_frames):
        start = i * hop
        frame = audio[start:start + frame_len]
        if len(frame) < frame_len:
            frame = np.pad(frame, (0, frame_len - len(frame)))
        fft = np.abs(np.fft.rfft(frame * window))
        chunk_size = max(1, len(fft) // spec_bins)
        binned = np.array([fft[j * chunk_size:(j + 1) * chunk_size].mean() for j in range(spec_bins)])
        spectra.append(np.log1p(binned))
    spectra = np.array(spectra)
    mean_feat = np.mean(spectra, axis=0)
    std_feat = np.std(spectra, axis=0) if n_frames > 1 else np.zeros(64, dtype=np.float32)
    if n_frames > 2:
        diff = np.diff(spectra, axis=0)
        delta_feat = np.mean(np.abs(diff), axis=0)
    else:
        delta_feat = np.zeros(64, dtype=np.float32)
    vec = np.concatenate([mean_feat, std_feat, delta_feat]).astype(np.float32)
    norm = np.linalg.norm(vec)
    return (vec / norm) if norm > 1e-8 else vec


def pcm16_to_float(pcm: bytes) -> np.ndarray:
    """16-bit PCM bytes (the format every `speech/` audio source already yields) -> float32
    [-1, 1] mono array, the format SpeechBrain's encoder expects."""
    return (np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))


def trim_silence(audio: np.ndarray, sample_rate: int = 16_000, rel_db: float = -30.0,
                 pad_ms: int = 120, min_seconds: float = 0.4) -> np.ndarray:
    """Cut leading/trailing silence so the voiceprint is computed on speech, not on a few
    seconds of room noise around a one-word command (which drags the similarity down).
    Returns the input unchanged if nothing clearly louder than the rest is found."""
    hop = max(1, int(sample_rate * 0.02))
    n = len(audio) // hop
    if n < 3:
        return audio
    rms = np.sqrt(np.mean(np.square(audio[: n * hop].reshape(n, hop)), axis=1))
    loud = np.flatnonzero(rms > rms.max() * 10 ** (rel_db / 20))
    if loud.size == 0:
        return audio
    pad = int(sample_rate * pad_ms / 1000)
    out = audio[max(0, loud[0] * hop - pad): (loud[-1] + 1) * hop + pad]
    return out if len(out) >= min_seconds * sample_rate else audio


def decide_speaker(scores: dict[str, float], threshold: float = DEFAULT_THRESHOLD,
                   margin: float = 0.05) -> tuple[str | None, float]:
    """(name_or_None, best_score) from per-speaker cosine scores. Reports a name only when the
    best score clears `threshold` AND beats the runner-up by `margin`: with just a couple of
    enrolled voices, a near-tie means "can't tell them apart", not "the slightly higher one"."""
    if not scores:
        return None, 0.0
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    name, best = ranked[0]
    if best < threshold:
        return None, best
    if len(ranked) > 1 and best - ranked[1][1] < margin:
        return None, best
    return name, best


class SpeakerIdentifier:
    """`voiceprint_dir`: one `.npy` embedding per enrolled speaker, same on-disk layout
    `scripts/voice_intent_transcribe.py`'s `enroll-voice` already produces -- point this at the same
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
        """PCM bytes (any length) -> 192-dim voiceprint vector.
        Uses SpeechBrain ECAPA-TDNN if enabled, or lightweight acoustic spectral embedding."""
        if os.environ.get("FIREBOT_USE_SPEECHBRAIN"):
            try:
                model = _load_model()
                if model is not None:
                    import torch
                    audio = torch.from_numpy(pcm16_to_float(pcm)).unsqueeze(0)
                    with torch.no_grad():
                        embedding = model.encode_batch(audio)
                    return embedding.squeeze().cpu().numpy()
            except Exception:
                pass
        return _fallback_embed(pcm)

    def enrolled(self) -> list[str]:
        return sorted(self._voiceprints_cached())

    def scores(self, pcm: bytes) -> dict[str, float]:
        """Cosine similarity of the clip to every enrolled voiceprint."""
        voiceprints = self._voiceprints_cached()
        if not voiceprints:
            return {}
        embedding = self.embed(pcm)
        return {name: cosine_similarity(embedding, ref) for name, ref in voiceprints.items()}

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
        """Save `speaker`'s voiceprint from a single clip. Prefer `enroll_multi` for anything
        meant to recognize short, command-length audio at test time (see its docstring) --
        this single-clip form is kept for callers enrolling from one long, already-known-good
        recording where averaging doesn't apply."""
        self.voiceprint_dir.mkdir(parents=True, exist_ok=True)
        np.save(self.voiceprint_dir / f"{speaker}.npy", self.embed(pcm))
        self.reload()

    def enroll_multi(self, speaker: str, clips: list[bytes]) -> None:
        """Save `speaker`'s voiceprint as the mean of several clips' embeddings, not one clip's.

        `identify()` is tested against short, command-length audio (a few seconds or less --
        whatever a single spoken command yields), not the multi-second natural-speech monologue
        a single enrollment clip would naturally be. A voiceprint built from one long clip is a
        real but different acoustic sample than what it'll be compared against, which costs
        similarity score independent of whether it's really the same speaker (a length/content
        mismatch, not an identity one). Enrolling from several separate clips *at the length and
        style `identify()` will actually see* removes that mismatch, and averaging their
        embeddings reduces the variance any single short clip's embedding carries on its own --
        the same reason any noisy measurement benefits from averaging repeated samples.
        """
        if not clips:
            raise ValueError("enroll_multi: need at least one clip")
        embedding = np.mean([self.embed(pcm) for pcm in clips], axis=0)
        self.voiceprint_dir.mkdir(parents=True, exist_ok=True)
        np.save(self.voiceprint_dir / f"{speaker}.npy", embedding)
        self.reload()
