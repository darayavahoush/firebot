"""Speaker-embedding backends for `speaker_id.SpeakerIdentifier`.

Three backends, chosen with `FIREBOT_SPEAKER_EMBEDDER`:

  wespeaker   (default) WeSpeaker ResNet34 (VoxCeleb) exported to ONNX. ~25 MB, runs on CPU with
              `onnxruntime` + `kaldi-native-fbank` only (no torch), so it fits Render's free tier.
  speechbrain SpeechBrain ECAPA-TDNN. Needs torch + speechbrain and a local model directory.
  legacy      The old hand-built pitch/MFCC heuristic vector. Only used when asked for by name;
              it is never a silent fallback any more.

A backend that cannot load raises `SpeakerModelError` with the reason. Callers surface it
(console status, logs) instead of quietly returning a worse embedding.
"""
from __future__ import annotations

import os
import threading
import urllib.request
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16_000
MIN_SECONDS = 1.0  # shorter clips are tiled up to this length before embedding

DEFAULT_EMBEDDER = "wespeaker"
KNOWN_EMBEDDERS = ("wespeaker", "speechbrain", "legacy")

# WeSpeaker publishes ONNX exports on the Hugging Face Hub. Override with
# FIREBOT_SPEAKER_MODEL_URL / FIREBOT_SPEAKER_MODEL_PATH if the location changes or you host
# a copy yourself.
DEFAULT_WESPEAKER_URL = (
    "https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM/resolve/main/"
    "voxceleb_resnet34_LM.onnx"
)
DEFAULT_WESPEAKER_FILE = "voxceleb_resnet34_LM.onnx"
_MIN_MODEL_BYTES = 1_000_000  # anything smaller is an error page, not a model


class SpeakerModelError(RuntimeError):
    """The configured speaker-embedding backend is unavailable or failed."""


def embedder_name() -> str:
    name = (os.environ.get("FIREBOT_SPEAKER_EMBEDDER") or DEFAULT_EMBEDDER).strip().lower()
    if name not in KNOWN_EMBEDDERS:
        raise SpeakerModelError(
            f"FIREBOT_SPEAKER_EMBEDDER={name!r} is not one of {', '.join(KNOWN_EMBEDDERS)}")
    return name


def pcm16_to_float(pcm: bytes) -> np.ndarray:
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def _tile_to_min(audio: np.ndarray, min_seconds: float = MIN_SECONDS) -> np.ndarray:
    need = int(SAMPLE_RATE * min_seconds)
    if len(audio) == 0 or len(audio) >= need:
        return audio
    reps = int(np.ceil(need / len(audio)))
    return np.tile(audio, reps)[:need]


# --------------------------------------------------------------------------- WeSpeaker ONNX

def fbank_features(audio: np.ndarray) -> np.ndarray:
    """80-dim Kaldi log-mel fbank with per-utterance mean normalisation, shape (T, 80).
    This matches WeSpeaker's training front end (25 ms / 10 ms, no dither, int16 scale)."""
    try:
        import kaldi_native_fbank as knf
    except ImportError as e:
        raise SpeakerModelError(f"kaldi-native-fbank could not be imported ({type(e).__name__}: {e}); "
                                "try: pip install --force-reinstall kaldi-native-fbank") from e
    opts = knf.FbankOptions()
    opts.frame_opts.dither = 0.0
    opts.frame_opts.snip_edges = True
    opts.frame_opts.samp_freq = SAMPLE_RATE
    opts.frame_opts.frame_length_ms = 25.0
    opts.frame_opts.frame_shift_ms = 10.0
    opts.mel_opts.num_bins = 80
    opts.energy_floor = 1.0
    fb = knf.OnlineFbank(opts)
    fb.accept_waveform(SAMPLE_RATE, (audio * 32768.0).astype(np.float32).tolist())
    fb.input_finished()
    n = fb.num_frames_ready
    if n < 10:
        raise SpeakerModelError(f"clip too short for speaker embedding ({n} frames)")
    feats = np.stack([fb.get_frame(i) for i in range(n)]).astype(np.float32)
    return feats - feats.mean(axis=0, keepdims=True)


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "firebot-speaker-id"})
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    if tmp.stat().st_size < _MIN_MODEL_BYTES:
        tmp.unlink(missing_ok=True)
        raise SpeakerModelError(f"download from {url} was too small to be a model")
    tmp.replace(dest)


def default_model_dir() -> Path:
    return Path(os.environ.get("FIREBOT_SPEAKER_MODEL_DIR") or "pretrained_models/wespeaker")


class WeSpeakerOnnx:
    def __init__(self, model_path: Path | str | None = None) -> None:
        try:
            import onnxruntime as ort
        except ImportError as e:
            raise SpeakerModelError(f"onnxruntime could not be imported ({type(e).__name__}: {e}); "
                                    "try: pip install --force-reinstall onnxruntime") from e
        path = Path(model_path or os.environ.get("FIREBOT_SPEAKER_MODEL_PATH")
                    or default_model_dir() / DEFAULT_WESPEAKER_FILE)
        if not path.exists():
            if os.environ.get("FIREBOT_SPEAKER_AUTODOWNLOAD", "1") == "0":
                raise SpeakerModelError(f"speaker model not found at {path}")
            url = os.environ.get("FIREBOT_SPEAKER_MODEL_URL") or DEFAULT_WESPEAKER_URL
            try:
                _download(url, path)
            except SpeakerModelError:
                raise
            except Exception as e:
                raise SpeakerModelError(
                    f"could not download speaker model from {url}: {type(e).__name__}: {e}. "
                    f"Download it manually to {path} or set FIREBOT_SPEAKER_MODEL_PATH.") from e
        so = ort.SessionOptions()
        so.intra_op_num_threads = int(os.environ.get("FIREBOT_SPEAKER_THREADS", "1"))
        so.inter_op_num_threads = 1
        try:
            self.session = ort.InferenceSession(
                str(path), sess_options=so, providers=["CPUExecutionProvider"])
        except Exception as e:
            raise SpeakerModelError(f"could not load {path}: {type(e).__name__}: {e}") from e
        self.input_name = self.session.get_inputs()[0].name
        self.path = path

    def embed(self, audio: np.ndarray) -> np.ndarray:
        feats = fbank_features(_tile_to_min(audio))
        out = self.session.run(None, {self.input_name: feats[None]})
        emb = np.asarray(out[-1]).reshape(-1).astype(np.float32)
        return emb


# --------------------------------------------------------------------------- SpeechBrain

class SpeechBrainEcapa:
    def __init__(self) -> None:
        savedir = Path(os.environ.get("FIREBOT_SPEAKER_MODEL_DIR")
                       or "pretrained_models/spkrec-ecapa-voxceleb")
        if not (savedir.is_dir() and (savedir / "hyperparams.yaml").exists()):
            raise SpeakerModelError(f"SpeechBrain ECAPA model not found in {savedir}")
        try:
            from speechbrain.inference.speaker import EncoderClassifier
            self.model = EncoderClassifier.from_hparams(
                source=str(savedir), savedir=str(savedir), run_opts={"device": "cpu"})
        except Exception as e:
            raise SpeakerModelError(f"could not load SpeechBrain ECAPA: {type(e).__name__}: {e}") from e

    def embed(self, audio: np.ndarray) -> np.ndarray:
        import torch
        with torch.no_grad():
            e = self.model.encode_batch(torch.from_numpy(_tile_to_min(audio)).unsqueeze(0))
        return e.squeeze().cpu().numpy().astype(np.float32)


# --------------------------------------------------------------------------- registry

_cache: dict[str, object] = {}
_lock = threading.Lock()


def get_backend(name: str | None = None):
    """Return the (cached) backend object for `name`, or raise SpeakerModelError."""
    name = name or embedder_name()
    with _lock:
        if name not in _cache:
            if name == "wespeaker":
                _cache[name] = WeSpeakerOnnx()
            elif name == "speechbrain":
                _cache[name] = SpeechBrainEcapa()
            else:
                raise SpeakerModelError(f"{name!r} has no model backend")
        return _cache[name]


def reset_backends() -> None:
    with _lock:
        _cache.clear()
