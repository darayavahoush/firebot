"""Load a trained checkpoint and classify a single audio clip.

CLI:
    python -m firebot.voice_intent.infer --checkpoint checkpoints/intent_head.pt clip.wav

Library:
    from firebot.voice_intent.infer import IntentClassifier
    clf = IntentClassifier("checkpoints/intent_head.pt")
    label, confidence, all_scores = clf.predict("clip.wav")

Loads the same Whisper encoder named in the checkpoint's metadata (so the
head is always paired with the encoder it was trained against) plus the
saved head weights, and reproduces features.py's exact pooling so inference
matches training. Kept separate from features.py: that script batches many
cached clips at build time, this classifies one live clip at request time.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch

from .model import IntentHead
from .vocab import goto_target


class IntentClassifier:
    def __init__(self, checkpoint_path: str | Path, device: str = "cpu") -> None:
        from transformers import WhisperFeatureExtractor, WhisperModel

        ckpt = torch.load(checkpoint_path, map_location=device, weights_only=False)
        self.classes: list[str] = ckpt["classes"]
        self.device = device
        self.extractor = WhisperFeatureExtractor.from_pretrained(ckpt["model_name"])
        self.encoder = WhisperModel.from_pretrained(ckpt["model_name"]).encoder.to(device).eval()
        for p in self.encoder.parameters():
            p.requires_grad_(False)
        self.head = IntentHead(d_model=ckpt["d_model"], hidden=ckpt["hidden"],
                                num_classes=len(self.classes)).to(device)
        self.head.load_state_dict(ckpt["state_dict"])
        self.head.eval()

    @torch.no_grad()
    def predict_array(self, audio: np.ndarray, sample_rate: int = 16_000
                       ) -> tuple[str, float, dict[str, float]]:
        """Same pipeline as `predict`, but for audio already decoded into memory (e.g. a
        browser-recorded clip loaded via `librosa.load(..., sr=16_000)`) rather than a
        file on disk -- avoids a round-trip through a temp .wav for the server's live
        request path. `audio` must already be mono float32 at `sample_rate`."""
        inputs = self.extractor([np.asarray(audio, dtype="float32")],
                                sampling_rate=sample_rate, return_tensors="pt")
        pooled = self.encoder(inputs.input_features.to(self.device)).last_hidden_state.mean(dim=1)
        logits = self.head(pooled)[0]
        probs = torch.softmax(logits, dim=0).cpu().numpy()
        idx = int(probs.argmax())
        scores = {c: float(p) for c, p in zip(self.classes, probs)}
        return self.classes[idx], float(probs[idx]), scores

    def predict(self, wav_path: str | Path, sample_rate: int = 16_000
                ) -> tuple[str, float, dict[str, float]]:
        import soundfile as sf

        audio, sr = sf.read(str(wav_path), dtype="float32")
        if sr != sample_rate:
            raise ValueError(f"{wav_path} is {sr}Hz, expected {sample_rate}Hz "
                              f"(resample first, e.g. via synth_data._resample_to_target)")
        return self.predict_array(audio, sample_rate)

    @staticmethod
    def _payload(label: str, confidence: float, scores: dict[str, float],
                 min_confidence: float) -> dict:
        if confidence < min_confidence:
            return {"name": "UNKNOWN", "params": {}, "confidence": confidence,
                    "source": "voice_intent", "raw_label": label, "scores": scores}
        target = goto_target(label)
        if target is not None:
            return {"name": "GOTO", "params": {"x": target[0], "y": target[1]},
                    "confidence": confidence, "source": "voice_intent",
                    "raw_label": label, "scores": scores}
        return {"name": label, "params": {}, "confidence": confidence,
                "source": "voice_intent", "raw_label": label, "scores": scores}

    def predict_intent_payload(self, wav_path: str | Path, min_confidence: float = 0.6
                                ) -> dict:
        """Convenience wrapper returning something close to `command.intents.Intent`
        shape, for the backend to validate/dispatch. Confidence gate is the
        classifier's job to expose, not to enforce -- caller decides what to
        do below `min_confidence` (e.g. fall back to the Groq+regex path)."""
        label, confidence, scores = self.predict(wav_path)
        return self._payload(label, confidence, scores, min_confidence)

    def predict_intent_payload_array(self, audio: np.ndarray, sample_rate: int = 16_000,
                                      min_confidence: float = 0.6) -> dict:
        """`predict_intent_payload`, but for an in-memory clip -- see `predict_array`."""
        label, confidence, scores = self.predict_array(audio, sample_rate)
        return self._payload(label, confidence, scores, min_confidence)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--checkpoint", type=Path, required=True)
    ap.add_argument("wav", type=Path)
    ap.add_argument("--min-confidence", type=float, default=0.6)
    args = ap.parse_args()

    clf = IntentClassifier(args.checkpoint)
    payload = clf.predict_intent_payload(args.wav, args.min_confidence)
    top = sorted(payload["scores"].items(), key=lambda kv: -kv[1])[:5]
    print(f"predicted: {payload['name']}  params={payload['params']}  "
          f"confidence={payload['confidence']:.1%}")
    print("top-5:")
    for label, score in top:
        print(f"  {label:16s} {score:.1%}")


if __name__ == "__main__":
    main()
