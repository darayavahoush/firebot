"""
Fine-tune a lightweight command classifier on top of a FROZEN Whisper encoder.

Why this shape (not full Whisper seq2seq fine-tuning):
- Commands are a small closed vocabulary -> classification, not open transcription.
- Freezing the encoder and training only a small head means:
    - training is fast (minutes, not hours), even on CPU or a single GPU
    - inference is one encoder forward pass + a tiny head forward pass,
      NO autoregressive decoding -> low latency, matches the local-first
      fast-path your server.py already expects before falling back to Groq
    - the resulting checkpoint is tiny (head weights only, KBs not GBs)

Checkpoint format written (ADJUST to match your actual infer.py / vocab.py --
paste those files and I'll align this exactly):
    {
        "encoder": "whisper-tiny" | "whisper-base",
        "head_state_dict": <torch state dict of the classifier head>,
        "label_names": [...],   # index -> command string
        "feature_dim": <int>,
    }

USAGE:
    pip install -U openai-whisper torch scikit-learn numpy

    python train_voice_intent.py \
        --data-dir ./data/commands \
        --model-size tiny \
        --out checkpoints/intent_head.pt

Expected data-dir layout -- one subfolder per command, PLUS an "unknown"
class with background noise / other speech / silence as negatives (this is
what lets the classifier abstain instead of forcing a wrong guess -- your
server.py code already treats "UNKNOWN" as "fall through to Groq"):
    data/commands/
        stop/clip001.wav
        stop/clip002.wav
        go_home/clip001.wav
        ...
        unknown/clip001.wav
        unknown/clip002.wav

Tips for the dataset itself (matters more than the training code):
- Record each command from multiple speakers, distances, and background
  noise levels if you can -- a classifier trained on one clean voice in a
  quiet room will not generalize to real usage.
- Aim for at least ~20-30 clips per command class and a comparably-sized
  "unknown" set to start; more is better, but this is enough to sanity-check
  the pipeline before you invest in a bigger recording session.
- Keep clips short (1-3s) and trimmed close to just the spoken command.
"""

import argparse
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import whisper  # pip install -U openai-whisper
from sklearn.model_selection import train_test_split
from torch.utils.data import Dataset


class CommandHead(nn.Module):
    """Small MLP over mean-pooled Whisper encoder hidden states."""

    def __init__(self, in_dim: int, n_classes: int, hidden: int = 128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden, n_classes),
        )

    def forward(self, x):
        return self.net(x)


class CommandClipDataset(Dataset):
    def __init__(self, data_dir: Path, label_names: list, whisper_model, device):
        self.samples = []
        for label_idx, label in enumerate(label_names):
            for wav_path in sorted((data_dir / label).glob("*.wav")):
                self.samples.append((wav_path, label_idx))
        if not self.samples:
            raise ValueError(f"No .wav clips found under {data_dir}")
        self.whisper_model = whisper_model
        self.device = device

    def __len__(self):
        return len(self.samples)

    def _extract_feature(self, wav_path: Path) -> torch.Tensor:
        audio = whisper.load_audio(str(wav_path))
        audio = whisper.pad_or_trim(audio)
        mel = whisper.log_mel_spectrogram(audio).to(self.device)
        with torch.no_grad():
            enc_out = self.whisper_model.encoder(mel.unsqueeze(0))  # (1, T, D)
        return enc_out.mean(dim=1).squeeze(0).cpu()  # (D,) mean-pool over time

    def __getitem__(self, idx):
        wav_path, label_idx = self.samples[idx]
        return self._extract_feature(wav_path), label_idx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--model-size", default="tiny", choices=["tiny", "base"])
    parser.add_argument("--out", type=Path, default=Path("checkpoints/intent_head.pt"))
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--val-split", type=float, default=0.15)
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"

    label_names = sorted(p.name for p in args.data_dir.iterdir() if p.is_dir())
    print(f"Found {len(label_names)} classes: {label_names}")

    print(f"Loading whisper-{args.model_size} (encoder only, frozen)...")
    whisper_model = whisper.load_model(args.model_size, device=device)
    whisper_model.eval()
    for p in whisper_model.parameters():
        p.requires_grad = False

    dataset = CommandClipDataset(args.data_dir, label_names, whisper_model, device)
    print(f"Extracting features for {len(dataset)} clips (one pass, cached in memory)...")
    feats, labels = zip(*[dataset[i] for i in range(len(dataset))])
    feats = torch.stack(feats)
    labels = torch.tensor(labels)

    idx_train, idx_val = train_test_split(
        np.arange(len(labels)), test_size=args.val_split,
        stratify=labels.numpy(), random_state=0,
    )

    head = CommandHead(in_dim=feats.shape[1], n_classes=len(label_names)).to(device)
    optimizer = torch.optim.Adam(head.parameters(), lr=args.lr)
    criterion = nn.CrossEntropyLoss()

    X_train, y_train = feats[idx_train].to(device), labels[idx_train].to(device)
    X_val, y_val = feats[idx_val].to(device), labels[idx_val].to(device)

    best_val_acc = 0.0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    for epoch in range(args.epochs):
        head.train()
        optimizer.zero_grad()
        loss = criterion(head(X_train), y_train)
        loss.backward()
        optimizer.step()

        head.eval()
        with torch.no_grad():
            val_acc = (head(X_val).argmax(dim=1) == y_val).float().mean().item()

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save({
                "encoder": f"whisper-{args.model_size}",
                "head_state_dict": head.state_dict(),
                "label_names": label_names,
                "feature_dim": feats.shape[1],
            }, args.out)

        print(f"epoch {epoch + 1:3d}  loss {loss.item():.4f}  val_acc {val_acc:.3f}")

    print(f"Best val acc: {best_val_acc:.3f}  ->  saved to {args.out}")


if __name__ == "__main__":
    main()
