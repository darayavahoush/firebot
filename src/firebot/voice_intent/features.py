"""Extract frozen Whisper-encoder embeddings for every clip in a manifest, once,
and cache them to disk. Training the classifier head then reads embeddings
straight off disk -- no audio loading, no encoder forward pass -- which is
what makes this practical on a CPU: the expensive part (running Whisper) only
ever happens once per clip, not once per clip per epoch.

Usage:
    python -m firebot.voice_intent.features --data data/voice_intent \
        --model openai/whisper-tiny.en

Needs a real internet connection to pull `--model` from Hugging Face the
first time (cached locally after that by `transformers`). Requires torch +
transformers -- see requirements.txt.
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np


def load_manifest(data_dir: Path) -> list[tuple[Path, str, str]]:
    rows = []
    with (data_dir / "manifest.csv").open() as f:
        for row in csv.DictReader(f):
            rows.append((data_dir / row["path"], row["label"], row["source"]))
    return rows


def extract_all(data_dir: Path, model_name: str, batch_size: int = 8,
                 device: str = "cpu") -> Path:
    import soundfile as sf
    import torch
    from transformers import WhisperFeatureExtractor, WhisperModel

    from . import vocab

    rows = load_manifest(data_dir)
    if not rows:
        raise RuntimeError(f"No rows in {data_dir / 'manifest.csv'} -- run synth_data.py first.")

    print(f"Loading {model_name} (encoder only, frozen)...")
    extractor = WhisperFeatureExtractor.from_pretrained(model_name)
    encoder = WhisperModel.from_pretrained(model_name).encoder.to(device).eval()
    for p in encoder.parameters():
        p.requires_grad_(False)

    feats = np.zeros((len(rows), encoder.config.d_model), dtype=np.float32)
    labels = np.zeros(len(rows), dtype=np.int64)
    paths = []

    with torch.no_grad():
        for start in range(0, len(rows), batch_size):
            batch = rows[start:start + batch_size]
            audios = []
            for path, _, _ in batch:
                audio, sr = sf.read(str(path), dtype="float32")
                assert sr == 16_000, f"{path} is {sr}Hz, expected 16000Hz"
                audios.append(audio)
            inputs = extractor(audios, sampling_rate=16_000, return_tensors="pt")
            out = encoder(inputs.input_features.to(device))
            # mean-pool over the time dimension -> one fixed-size vector per clip
            pooled = out.last_hidden_state.mean(dim=1).cpu().numpy()
            feats[start:start + len(batch)] = pooled
            for path, label, _ in batch:
                labels[len(paths)] = vocab.LABEL_TO_IDX[label]
                paths.append(str(path))
            if start % (batch_size * 20) == 0:
                print(f"  {start + len(batch)}/{len(rows)}")

    out_path = data_dir / f"features_{model_name.replace('/', '_')}.npz"
    np.savez(out_path, features=feats, labels=labels, paths=np.array(paths),
             model_name=model_name, d_model=encoder.config.d_model)
    print(f"Saved {feats.shape[0]} embeddings ({feats.shape[1]}-dim) to {out_path}")
    return out_path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, required=True, help="dir with manifest.csv from synth_data.py")
    ap.add_argument("--model", type=str, default="openai/whisper-tiny.en",
                     help="HF Whisper checkpoint to use as the frozen encoder")
    ap.add_argument("--batch-size", type=int, default=8)
    args = ap.parse_args()
    extract_all(args.data, args.model, args.batch_size)


if __name__ == "__main__":
    main()
