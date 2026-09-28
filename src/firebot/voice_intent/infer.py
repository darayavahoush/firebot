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

from .features import valid_frame_count
from .model import IntentHead
from .vocab import CLASSES, confidence_threshold, goto_target


class IntentClassifier:
    def __init__(self, checkpoint_path: str | Path, device: str = "cpu") -> None:
        from transformers import WhisperFeatureExtractor, WhisperModel

        ckpt = torch.load(checkpoint_path, map_location=device, weights_only=False)
        if isinstance(ckpt, dict) and "head_state_dict" in ckpt:
            raise ValueError(
                f"{checkpoint_path} is an OLD-format checkpoint from the root train_voice_intent.py "
                f"(labels {ckpt.get('label_names')}) -- a different command set than this "
                "console's vocab.CLASSES (STOP, GOTO_NORTH, ...), so it can't be used. Train a new "
                "one with the firebot.voice_intent pipeline (see src/firebot/voice_intent/README.md)")
        if not isinstance(ckpt, dict) or "state_dict" not in ckpt:
            keys = list(ckpt) if isinstance(ckpt, dict) else type(ckpt).__name__
            raise ValueError(f"{checkpoint_path} isn't a firebot.voice_intent.train checkpoint "
                             f"(no 'state_dict'; found {keys}) -- re-run train.py")
        state = ckpt["state_dict"]
        # Head shape is recoverable from the weights themselves, so a checkpoint saved without
        # the optional metadata keys still loads instead of KeyError-ing.
        hidden, d_model = state["net.1.weight"].shape
        n_out = state["net.4.weight"].shape[0]
        classes = ckpt.get("classes")
        if classes is None:
            if n_out != len(CLASSES):
                raise ValueError(f"{checkpoint_path} has no 'classes' and its head has {n_out} "
                                 f"outputs but vocab.CLASSES has {len(CLASSES)} -- it was trained "
                                 "against a different vocabulary; re-run train.py")
            classes = CLASSES
        self.classes: list[str] = list(classes)
        model_name = ckpt.get("model_name", "openai/whisper-tiny.en")
        # Checkpoints trained before valid-frame pooling existed averaged over all
        # 1500 padded frames; pool the same way they were trained or the head sees
        # inputs from a different distribution.
        self.pooling: str = ckpt.get("pooling", "all_frames")
        self.device = device
        self.extractor = WhisperFeatureExtractor.from_pretrained(model_name)
        self.encoder = WhisperModel.from_pretrained(model_name).encoder.to(device).eval()
        for p in self.encoder.parameters():
            p.requires_grad_(False)
        self.head = IntentHead(d_model=ckpt.get("d_model", d_model), hidden=ckpt.get("hidden", hidden),
                                num_classes=len(self.classes)).to(device)
        self.head.load_state_dict(state)
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
        hidden = self.encoder(inputs.input_features.to(self.device)).last_hidden_state
        if self.pooling == "valid_frames":
            pooled = hidden[:, :valid_frame_count(len(audio), sample_rate)].mean(dim=1)
        else:
            pooled = hidden.mean(dim=1)
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
                 min_confidence: float,
                 class_min_confidence: dict[str, float] | None = None) -> dict:
        # A per-class threshold, when given, replaces the global one for that predicted
        # label only. Costs are asymmetric: a false STOP is cheap, a missed STOP is not,
        # while a false GOTO/EXTINGUISH moves the robot or fires the pump.
        if confidence < confidence_threshold(label, min_confidence, class_min_confidence):
            return {"name": "UNKNOWN", "params": {}, "confidence": confidence,
                    "source": "voice_intent", "raw_label": label, "scores": scores}
        target = goto_target(label)
        if target is not None:
            return {"name": "GOTO", "params": {"x": target[0], "y": target[1]},
                    "confidence": confidence, "source": "voice_intent",
                    "raw_label": label, "scores": scores}
        return {"name": label, "params": {}, "confidence": confidence,
                "source": "voice_intent", "raw_label": label, "scores": scores}

    def predict_intent_payload(self, wav_path: str | Path, min_confidence: float = 0.6,
                                class_min_confidence: dict[str, float] | None = None
                                ) -> dict:
        """Convenience wrapper returning something close to `command.intents.Intent`
        shape, for the backend to validate/dispatch. Confidence gate is the
        classifier's job to expose, not to enforce -- caller decides what to
        do below `min_confidence` (e.g. fall back to the Groq+regex path)."""
        label, confidence, scores = self.predict(wav_path)
        return self._payload(label, confidence, scores, min_confidence, class_min_confidence)

    def predict_intent_payload_array(self, audio: np.ndarray, sample_rate: int = 16_000,
                                      min_confidence: float = 0.6,
                                      class_min_confidence: dict[str, float] | None = None
                                      ) -> dict:
        """`predict_intent_payload`, but for an in-memory clip -- see `predict_array`."""
        label, confidence, scores = self.predict_array(audio, sample_rate)
        return self._payload(label, confidence, scores, min_confidence, class_min_confidence)


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
