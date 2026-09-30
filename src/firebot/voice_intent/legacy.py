"""Run the OLD-format checkpoint (`scripts/train_voice_intent.py`: frozen openai-whisper encoder
+ small MLP head, trained on the recorded data/commands clips) inside the console.

Its labels (forward/backward/go_left/go_right/go_home/stop/unknown) aren't `vocab.CLASSES`,
so each is translated to the closest console class via LEGACY_TO_CLASS below. EDIT that map
if you want different behaviour. Same interface as `infer.IntentClassifier`, so the backend
doesn't care which one it got. Needs `pip install openai-whisper` (what the old trainer used).
"""
from __future__ import annotations

import numpy as np

# legacy label -> vocab.CLASSES label ("UNKNOWN" = ignore). The console has no relative
# moves (only absolute GOTO places), so forward/backward/left/right become the map's
# top/bottom/west/east places, the same words RuleParser already treats as aliases.
LEGACY_TO_CLASS: dict[str, str] = {
    "stop": "STOP",
    "go_home": "RETURN_HOME",
    "forward": "GOTO_NORTH",
    "backward": "GOTO_SOUTH",
    "go_left": "GOTO_WEST",
    "go_right": "GOTO_EAST",
    "unknown": "UNKNOWN",
}


def map_scores(legacy_scores: dict[str, float]) -> dict[str, float]:
    """Legacy per-label probabilities -> per-console-class scores (unmapped labels dropped)."""
    out: dict[str, float] = {}
    for label, p in legacy_scores.items():
        cls = LEGACY_TO_CLASS.get(label)
        if cls is not None:
            out[cls] = out.get(cls, 0.0) + p
    return out


class LegacyIntentClassifier:
    def __init__(self, ckpt: dict, device: str = "cpu") -> None:
        import torch
        import torch.nn as nn

        try:
            import whisper  # openai-whisper, same package the old trainer used
        except ImportError as e:
            raise ImportError("legacy checkpoint needs openai-whisper: pip install openai-whisper") from e

        self.label_names: list[str] = list(ckpt["label_names"])
        self.device = device
        size = str(ckpt.get("encoder", "whisper-tiny")).removeprefix("whisper-")
        self._whisper = whisper
        self._torch = torch
        self.encoder = whisper.load_model(size, device=device).encoder.eval()
        state = ckpt["head_state_dict"]
        hidden, in_dim = state["net.0.weight"].shape
        # Same architecture as train_voice_intent.CommandHead (keys net.0 / net.3).
        self.head = nn.Sequential(nn.Linear(in_dim, hidden), nn.ReLU(), nn.Dropout(0.2),
                                  nn.Linear(hidden, len(self.label_names)))
        self.head.load_state_dict({k.removeprefix("net."): v for k, v in state.items()})
        self.head.to(device).eval()

    def predict_array(self, audio: np.ndarray, sample_rate: int = 16_000):
        torch, whisper = self._torch, self._whisper
        if sample_rate != 16_000:
            raise ValueError("legacy classifier expects 16 kHz audio")
        with torch.no_grad():
            a = whisper.pad_or_trim(np.asarray(audio, dtype="float32"))
            mel = whisper.log_mel_spectrogram(a).to(self.device)
            feat = self.encoder(mel.unsqueeze(0)).mean(dim=1)  # mean over all frames, as trained
            probs = torch.softmax(self.head(feat)[0], dim=0).cpu().numpy()
        scores = map_scores({n: float(p) for n, p in zip(self.label_names, probs)})
        label = max(scores, key=scores.get)
        return label, float(scores[label]), scores

    def predict_intent_payload_array(self, audio, sample_rate: int = 16_000,
                                      min_confidence: float = 0.6,
                                      class_min_confidence: dict[str, float] | None = None) -> dict:
        from .infer import IntentClassifier
        label, conf, scores = self.predict_array(audio, sample_rate)
        if label == "UNKNOWN":
            return {"name": "UNKNOWN", "params": {}, "confidence": conf,
                    "source": "voice_intent", "raw_label": label, "scores": scores}
        return IntentClassifier._payload(label, conf, scores, min_confidence, class_min_confidence)
