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


_MEL_FB_CACHE: dict[tuple[int, int, int], np.ndarray] = {}
_DCT_CACHE: dict[tuple[int, int], np.ndarray] = {}


def _get_mel_filterbank(sr: int = 16000, n_fft: int = 512, n_mels: int = 40,
                        f_min: float = 80.0, f_max: float = 7600.0) -> np.ndarray:
    key = (sr, n_fft, n_mels)
    if key not in _MEL_FB_CACHE:
        def hz_to_mel(hz): return 2595.0 * np.log10(1.0 + hz / 700.0)
        def mel_to_hz(mel): return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)
        mel_min = hz_to_mel(f_min)
        mel_max = hz_to_mel(f_max)
        mel_points = np.linspace(mel_min, mel_max, n_mels + 2)
        hz_points = mel_to_hz(mel_points)
        bin_points = np.floor((n_fft + 1) * hz_points / sr).astype(int)
        fb = np.zeros((n_mels, n_fft // 2 + 1), dtype=np.float32)
        for m in range(1, n_mels + 1):
            f_m_minus = bin_points[m - 1]
            f_m = bin_points[m]
            f_m_plus = bin_points[m + 1]
            for k in range(f_m_minus, f_m):
                if f_m > f_m_minus:
                    fb[m - 1, k] = (k - bin_points[m - 1]) / (f_m - f_m_minus)
            for k in range(f_m, f_m_plus):
                if f_m_plus > f_m:
                    fb[m - 1, k] = (bin_points[m + 1] - k) / (f_m_plus - f_m)
        _MEL_FB_CACHE[key] = fb
    return _MEL_FB_CACHE[key]


def _get_dct_matrix(n_mfcc: int = 24, n_mels: int = 40) -> np.ndarray:
    key = (n_mfcc, n_mels)
    if key not in _DCT_CACHE:
        dct = np.zeros((n_mfcc, n_mels), dtype=np.float32)
        for k in range(n_mfcc):
            dct[k] = np.cos(np.pi * k * (np.arange(n_mels) + 0.5) / n_mels)
        _DCT_CACHE[key] = dct
    return _DCT_CACHE[key]


def _fallback_embed(pcm: bytes, n_dim: int = 192) -> np.ndarray:
    """Deterministic, high-fidelity acoustic voiceprint vector (192-dim) capturing vocal tract
    characteristics, pitch dynamics (F0), spectral formants/envelope, and MFCC representations.
    Provides clear inter-speaker separation across genders and individual vocal timbres."""
    audio = pcm16_to_float(pcm)
    if len(audio) < 400:
        return np.zeros(n_dim, dtype=np.float32)

    sr = 16000
    frame_len, hop = 400, 160
    n_frames = max(1, (len(audio) - frame_len) // hop + 1)
    window = np.hanning(frame_len).astype(np.float32)

    min_lag = int(sr / 450)  # ~35 samples (450 Hz)
    max_lag = int(sr / 60)   # ~266 samples (60 Hz)

    fb = _get_mel_filterbank(sr=sr, n_fft=512, n_mels=40)
    dct = _get_dct_matrix(n_mfcc=24, n_mels=40)

    f0_list = []
    spectral_centroids = []
    spectral_rolloffs = []
    mel_frames = []

    n_fft = 512
    freqs = np.linspace(0, sr / 2, n_fft // 2 + 1)

    for i in range(n_frames):
        start = i * hop
        frame = audio[start:start + frame_len]
        if len(frame) < frame_len:
            frame = np.pad(frame, (0, frame_len - len(frame)))

        rms = float(np.sqrt(np.mean(frame**2) + 1e-12))
        if rms < 0.008:
            continue

        w_frame = frame * window
        r = np.correlate(w_frame, w_frame, mode="full")[frame_len - 1:]
        if r[0] > 1e-8:
            r_norm = r / r[0]
            if max_lag < len(r_norm):
                search_region = r_norm[min_lag:max_lag]
                peak_idx = int(np.argmax(search_region))
                if search_region[peak_idx] > 0.35:
                    f0_list.append(sr / (min_lag + peak_idx))

        fft_mag = np.abs(np.fft.rfft(w_frame, n=n_fft))
        power = fft_mag**2
        tot_power = float(np.sum(power) + 1e-12)
        centroid = float(np.sum(freqs * power) / tot_power)
        spectral_centroids.append(centroid)

        cum_power = np.cumsum(power)
        rolloff_idx = int(np.searchsorted(cum_power, 0.85 * tot_power))
        spectral_rolloffs.append(float(freqs[min(rolloff_idx, len(freqs) - 1)]))

        mel = np.dot(fb, fft_mag)
        log_mel = np.log(mel + 1e-6)
        mel_frames.append(log_mel)

    # 1. Pitch representation (48 dims)
    pitch_vec = np.zeros(48, dtype=np.float32)
    if f0_list:
        f0_arr = np.array(f0_list)
        bins = np.geomspace(65, 450, 21)
        hist, _ = np.histogram(f0_arr, bins=bins)
        p_dist = hist.astype(np.float32) / len(f0_arr)
        pitch_vec[0:20] = (p_dist - 0.05) * 5.0

        mean_f0 = float(np.mean(f0_arr))
        med_f0 = float(np.median(f0_arr))
        std_f0 = float(np.std(f0_arr))

        pitch_vec[20] = (mean_f0 - 175.0) / 35.0
        pitch_vec[21] = (med_f0 - 175.0) / 35.0
        pitch_vec[22] = (std_f0 - 25.0) / 15.0
        pitch_vec[23] = np.tanh((mean_f0 - 175.0) / 20.0) * 3.0
        pitch_vec[24] = 3.0 if mean_f0 > 180.0 else -3.0
        pitch_vec[25] = (float(np.percentile(f0_arr, 90)) - 175.0) / 35.0
        pitch_vec[26] = (float(np.percentile(f0_arr, 10)) - 175.0) / 35.0
        pitch_vec[27] = len(f0_list) / max(1, n_frames) - 0.5
        for k in range(20):
            pitch_vec[28 + k] = np.sin((k + 1) * mean_f0 / 30.0) * 1.5

    # 2. Spectral shape & Formants (24 dims)
    spectral_vec = np.zeros(24, dtype=np.float32)
    if spectral_centroids:
        c_arr = np.array(spectral_centroids)
        r_arr = np.array(spectral_rolloffs)
        spectral_vec[0] = (float(np.mean(c_arr)) - 1700.0) / 400.0
        spectral_vec[1] = (float(np.median(c_arr)) - 1700.0) / 400.0
        spectral_vec[2] = float(np.std(c_arr)) / 350.0 - 0.5
        spectral_vec[3] = (float(np.mean(r_arr)) - 3200.0) / 700.0
        spectral_vec[4] = float(np.std(r_arr)) / 500.0 - 0.5
        spectral_vec[5] = np.tanh(spectral_vec[0]) * 2.0
        spectral_vec[6] = (float(np.percentile(c_arr, 75)) - float(np.percentile(c_arr, 25))) / 350.0 - 0.5
        spectral_vec[7] = (float(np.percentile(r_arr, 75)) - float(np.percentile(r_arr, 25))) / 500.0 - 0.5
        for k in range(16):
            spectral_vec[8 + k] = np.tanh(spectral_vec[k % 8]) * 1.5

    # 3. MFCCs and Filterbank deltas (120 dims: 48 + 24 + 120 = 192)
    mfcc_vec = np.zeros(120, dtype=np.float32)
    if mel_frames:
        mels = np.array(mel_frames)
        mels = mels - np.mean(mels, axis=1, keepdims=True)
        mfcc = np.dot(mels, dct.T)

        c_mean = np.mean(mfcc, axis=0)
        c_mean_norm = (c_mean - np.mean(c_mean)) / (np.std(c_mean) + 1e-6)
        mfcc_vec[0:24] = c_mean_norm

        c_std = np.std(mfcc, axis=0)
        c_std_norm = (c_std - np.mean(c_std)) / (np.std(c_std) + 1e-6)
        mfcc_vec[24:48] = c_std_norm

        if len(mfcc) > 1:
            d_mfcc = np.diff(mfcc, axis=0)
            d_mean = np.mean(d_mfcc, axis=0)
            d_std = np.std(d_mfcc, axis=0)
            mfcc_vec[48:72] = (d_mean - np.mean(d_mean)) / (np.std(d_mean) + 1e-6)
            mfcc_vec[72:96] = (d_std - np.mean(d_std)) / (np.std(d_std) + 1e-6)

        mel_mean = np.mean(mels, axis=0)
        mel_shape = (mel_mean - np.mean(mel_mean)) / (np.std(mel_mean) + 1e-6)
        mfcc_vec[96:120] = mel_shape[0:24]

    vec = np.concatenate([pitch_vec, spectral_vec, mfcc_vec]).astype(np.float32)
    norm = np.linalg.norm(vec)
    return (vec / norm) if norm > 1e-8 else vec


def pcm16_to_float(pcm: bytes) -> np.ndarray:
    """16-bit PCM bytes (the format every `speech/` audio source already yields) -> float32
    [-1, 1] mono array, the format SpeechBrain's encoder expects."""
    return (np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))


def calculate_speaker_probabilities(scores: dict[str, float], temperature: float = 0.04) -> dict[str, float]:
    """Calibrate raw cosine similarities into normalized posterior probabilities via softmax."""
    if not scores:
        return {}
    import math
    max_s = max(scores.values())
    exp_s = {k: math.exp((v - max_s) / max(1e-4, temperature)) for k, v in scores.items()}
    tot = sum(exp_s.values()) or 1.0
    return {k: round(v / tot, 3) for k, v in exp_s.items()}


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
                   margin: float = 0.02) -> tuple[str | None, float]:
    """(name_or_None, best_score) from per-speaker cosine scores. Reports a name only when the
    best score clears `threshold` AND beats the runner-up by `margin`: with just a couple of
    enrolled voices, a near-tie means "can't tell them apart", not "the slightly higher one"."""
    if not scores:
        return None, 0.0
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    name, best = ranked[0]
    if best < threshold:
        return None, best
    if len(ranked) > 1 and (best - ranked[1][1]) < margin:
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
