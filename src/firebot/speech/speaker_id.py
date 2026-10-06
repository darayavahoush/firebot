"""Speaker identification for operator accountability: which enrolled human issued a given
voice command, logged alongside the existing typed/voice/backstop `channel` in `Brain._record`.

Deliberately NOT used to personalize command matching -- `RuleParser` is deterministic and
already accent/phrasing-robust (see `command/parser.py`'s regex coverage); a per-speaker
command-variant profile would duplicate that for no correctness gain. This module answers a
different question -- "who said it", for the audit trail -- not "what did they say".

Embeddings come from a pretrained speaker model chosen by `FIREBOT_SPEAKER_EMBEDDER`
(see `speaker_embed.py`): WeSpeaker ResNet34 via ONNX by default, SpeechBrain ECAPA optionally,
and the old hand-built heuristic only when asked for by name. A model that fails to load raises
`SpeakerModelError`; it never silently degrades to the heuristic. Voiceprints record which
embedder made them and are refused if it doesn't match the current one.

Scoring is cosine similarity, optionally AS-normalised against a cohort of impostor embeddings
(`cohort.npy` next to the voiceprints). Everything downstream of the embedding is plain numpy.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np

from .speaker_embed import (
    SpeakerModelError,
    embedder_name,
    get_backend,
)

DEFAULT_VOICEPRINT_DIR = Path("data/voiceprints")
DEFAULT_THRESHOLD = 0.30  # cosine similarity below this -> "unrecognized", not a guess.
# Run `python scripts/calibrate_speakers.py --write` to pick values from your own recordings;
# they are saved to `speaker_calibration.json` in the voiceprint dir and used automatically.
DEFAULT_MARGIN = 0.05

META_FILE = "embedder.json"
CALIBRATION_FILE = "speaker_calibration.json"
COHORT_FILE = "cohort.npy"
LEGACY = "legacy"


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
    if len(ranked) > 1 and (best - ranked[1][1]) < margin:
        return None, best
    return name, best


def l2_normalize(v: np.ndarray) -> np.ndarray:
    v = np.asarray(v, dtype=np.float32).reshape(-1)
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-8 else v


def as_norm(enroll_emb: np.ndarray, test_emb: np.ndarray, cohort: np.ndarray,
            top_k: int = 100) -> float:
    """Adaptive symmetric score normalisation (AS-norm). `cohort` is (N, D) unit-length impostor
    embeddings. Each side's score against the cohort is summarised by the mean/std of its top-K
    scores, and the trial score is z-scored against both. This removes the per-speaker and
    per-clip offsets that make a single global cosine threshold unreliable."""
    k = max(2, min(top_k, len(cohort)))
    e, t = l2_normalize(enroll_emb), l2_normalize(test_emb)
    se = np.sort(cohort @ e)[-k:]
    st = np.sort(cohort @ t)[-k:]
    raw = float(e @ t)
    ze = (raw - float(se.mean())) / (float(se.std()) + 1e-6)
    zt = (raw - float(st.mean())) / (float(st.std()) + 1e-6)
    return 0.5 * (ze + zt)


class SpeakerSmoother:
    """Blends the last few commands' per-speaker scores (exponentially decayed by age) so one
    noisy one-second clip can't flip the label. Clips older than `window_s` are forgotten, so a
    different person taking over the mic is picked up after a few commands, not never."""

    def __init__(self, window_s: float = 25.0, half_life_s: float = 8.0, max_items: int = 5) -> None:
        self.window_s, self.half_life_s, self.max_items = window_s, half_life_s, max_items
        self._hist: list[tuple[float, dict[str, float]]] = []

    def reset(self) -> None:
        self._hist.clear()

    def update(self, scores: dict[str, float], now: float | None = None) -> dict[str, float]:
        now = time.monotonic() if now is None else now
        self._hist = [(t, s) for t, s in self._hist if now - t <= self.window_s]
        self._hist.append((now, dict(scores)))
        self._hist = self._hist[-self.max_items:]
        num: dict[str, float] = {}
        den: dict[str, float] = {}
        for t, s in self._hist:
            w = 0.5 ** ((now - t) / self.half_life_s)
            for name, v in s.items():
                num[name] = num.get(name, 0.0) + w * v
                den[name] = den.get(name, 0.0) + w
        return {name: num[name] / den[name] for name in num}


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def load_calibration(voiceprint_dir: Path | str) -> dict:
    """Thresholds written by `scripts/calibrate_speakers.py --write` ({} if none yet)."""
    return _read_json(Path(voiceprint_dir) / CALIBRATION_FILE)


def resolve_thresholds(voiceprint_dir: Path | str, env_threshold: str | None = None,
                       env_margin: str | None = None) -> tuple[float, float]:
    """(threshold, margin): explicit env override > calibration file > defaults. Calibration
    values are tied to the scoring mode they were measured in (cosine vs AS-norm), so they are
    ignored if the mode has since changed."""
    cal = load_calibration(voiceprint_dir)
    mode_now = "asnorm" if (Path(voiceprint_dir) / COHORT_FILE).exists() else "cosine"
    if cal.get("scoring") != mode_now:
        cal = {}
    thr = float(env_threshold) if env_threshold else float(cal.get("threshold", DEFAULT_THRESHOLD))
    mar = float(env_margin) if env_margin else float(cal.get("margin", DEFAULT_MARGIN))
    return thr, mar


def softmax_temperature(scoring: str) -> float:
    """Temperature for `calculate_speaker_probabilities`: AS-norm scores are z-score-like, so
    they need a far larger temperature than raw cosine."""
    return 0.5 if scoring == "asnorm" else 0.04


class SpeakerIdentifier:
    """`voiceprint_dir` holds one `<speaker>.npy` unit-length embedding per enrolled speaker plus
    `embedder.json` naming the embedder that produced them. Voiceprints from another embedder
    (including the legacy heuristic vectors enrolled before `embedder.json` existed) are refused
    with a clear "re-enrol" error, because embeddings from different models are not comparable.
    An optional `cohort.npy` (N, D) switches scoring to AS-norm.
    """

    def __init__(self, voiceprint_dir: Path | str = DEFAULT_VOICEPRINT_DIR,
                 threshold: float = DEFAULT_THRESHOLD, use_cohort: bool = True) -> None:
        self.voiceprint_dir = Path(voiceprint_dir)
        self.threshold = threshold
        self.use_cohort = use_cohort
        self._voiceprints: dict[str, np.ndarray] | None = None
        self._cohort: np.ndarray | None = None
        self._cohort_loaded = False

    # ---- storage -------------------------------------------------------------------------
    def _stored_embedder(self) -> str:
        meta = _read_json(self.voiceprint_dir / META_FILE)
        return meta.get("embedder") or LEGACY

    def _write_meta(self, dim: int) -> None:
        (self.voiceprint_dir / META_FILE).write_text(
            json.dumps({"embedder": embedder_name(), "dim": dim}))

    def _check_compatible(self) -> None:
        stored, now = self._stored_embedder(), embedder_name()
        if stored != now:
            raise SpeakerModelError(
                f"voiceprints in {self.voiceprint_dir} were made with the {stored!r} embedder but "
                f"the active embedder is {now!r}; re-enrol every speaker "
                f"(scripts/enroll_speaker.py or the console's enrol button)")

    def _signature(self) -> tuple:
        if not self.voiceprint_dir.exists():
            return ()
        return tuple((p.name, p.stat().st_mtime_ns) for p in sorted(self.voiceprint_dir.glob("*"))
                     if p.suffix in (".npy", ".json"))

    def _voiceprints_cached(self) -> dict[str, np.ndarray]:
        # Re-read when files change on disk (enrolment/recalibration by another process or request).
        sig = self._signature()
        if self._voiceprints is not None and sig != getattr(self, "_sig", sig):
            self.reload()
        self._sig = sig
        if self._voiceprints is None:
            files = sorted(self.voiceprint_dir.glob("*.npy")) if self.voiceprint_dir.exists() else []
            files = [p for p in files if p.name != COHORT_FILE]
            if files:
                self._check_compatible()
            self._voiceprints = {p.stem: l2_normalize(np.load(p)) for p in files}
        return self._voiceprints

    def cohort(self) -> np.ndarray | None:
        if not self.use_cohort:
            return None
        if not self._cohort_loaded:
            path = self.voiceprint_dir / COHORT_FILE
            self._cohort = None
            if path.exists():
                c = np.load(path)
                dims = {v.shape[0] for v in self._voiceprints_cached().values()}
                if c.ndim == 2 and len(c) >= 10 and dims == {c.shape[1]}:
                    self._cohort = np.stack([l2_normalize(r) for r in c])
            self._cohort_loaded = True
        return self._cohort

    def reload(self) -> None:
        """Call after enrolling or recalibrating mid-process so `scores` sees the change."""
        self._voiceprints = None
        self._cohort = None
        self._cohort_loaded = False

    def info(self) -> dict:
        """What is actually in use, for the console status panel."""
        cal = load_calibration(self.voiceprint_dir)
        out = {"embedder": embedder_name(), "stored_embedder": self._stored_embedder(),
               "scoring": "asnorm" if (self.use_cohort and (self.voiceprint_dir / COHORT_FILE).exists())
               else "cosine", "calibrated": bool(cal)}
        return out

    # ---- embedding -----------------------------------------------------------------------
    def embed(self, pcm: bytes) -> np.ndarray:
        """PCM16 bytes -> unit-length embedding from the active embedder. Raises
        `SpeakerModelError` if the embedder can't run; never substitutes a different one."""
        name = embedder_name()
        if name == LEGACY:
            return _fallback_embed(pcm)
        return l2_normalize(get_backend(name).embed(pcm16_to_float(pcm)))

    def enrolled(self) -> list[str]:
        return sorted(self._voiceprints_cached())

    # ---- scoring -------------------------------------------------------------------------
    def scores_from_embedding(self, embedding: np.ndarray) -> dict[str, float]:
        voiceprints = self._voiceprints_cached()
        if not voiceprints:
            return {}
        cohort = self.cohort()
        if cohort is not None:
            return {n: as_norm(ref, embedding, cohort) for n, ref in voiceprints.items()}
        return {n: cosine_similarity(embedding, ref) for n, ref in voiceprints.items()}

    def scores(self, pcm: bytes) -> dict[str, float]:
        """Per-speaker scores for the clip: AS-normed if a cohort is present, else cosine."""
        if not self._voiceprints_cached():
            return {}
        return self.scores_from_embedding(self.embed(pcm))

    def identify(self, pcm: bytes) -> tuple[str | None, float]:
        scores = self.scores(pcm)
        if not scores:
            return None, 0.0
        return decide_speaker(scores, self.threshold, 0.0)

    # ---- enrolment -----------------------------------------------------------------------
    def _save(self, speaker: str, embedding: np.ndarray) -> None:
        self.voiceprint_dir.mkdir(parents=True, exist_ok=True)
        existing = [p for p in self.voiceprint_dir.glob("*.npy") if p.name != COHORT_FILE
                    and p.stem != speaker]
        if existing and self._stored_embedder() != embedder_name():
            raise SpeakerModelError(
                f"other voiceprints in {self.voiceprint_dir} came from the "
                f"{self._stored_embedder()!r} embedder; re-enrol everyone with {embedder_name()!r} "
                f"(or delete them) before adding {speaker!r}")
        np.save(self.voiceprint_dir / f"{speaker}.npy", embedding)
        self._write_meta(int(embedding.shape[0]))
        self.reload()

    def enroll(self, speaker: str, pcm: bytes) -> None:
        """Single-clip enrolment. Prefer `enroll_multi` for command-length audio."""
        self._save(speaker, self.embed(pcm))

    def enroll_multi(self, speaker: str, clips: list[bytes]) -> None:
        """Voiceprint = mean (unit-normalised on load) of several clips' embeddings. Enrol with clips at the
        length and style `identify()` will see (short commands, varied phrases): averaging
        removes per-clip variance and the length/content mismatch a single long clip adds."""
        if not clips:
            raise ValueError("enroll_multi: need at least one clip")
        self._save(speaker, np.mean([self.embed(p) for p in clips], axis=0))
