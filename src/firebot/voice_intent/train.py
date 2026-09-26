"""Train the intent classifier head on cached Whisper embeddings.

Usage:
    python -m firebot.voice_intent.train \
        --features data/voice_intent/features_openai_whisper-tiny.en.npz \
        --out checkpoints/intent_head.pt

CPU-only and fast: this never touches Whisper itself, just a small MLP over
already-extracted fixed-size vectors, so an epoch over a few thousand clips
is sub-second once loaded.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler

from .model import IntentHead
from .vocab import CLASSES, NUM_CLASSES


def stratified_split(labels: np.ndarray, val_frac: float, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Per-class split so rare classes still get validation coverage instead
    of a plain random split potentially leaving a class with zero val
    examples (and a misleadingly perfect- or zero-looking accuracy for it)."""
    rng = np.random.default_rng(seed)
    train_idx, val_idx = [], []
    for c in range(NUM_CLASSES):
        idx = np.where(labels == c)[0]
        if len(idx) == 0:
            continue
        rng.shuffle(idx)
        n_val = max(1, int(round(len(idx) * val_frac))) if len(idx) > 1 else 0
        val_idx.extend(idx[:n_val])
        train_idx.extend(idx[n_val:])
    return np.array(train_idx), np.array(val_idx)


def class_balanced_sampler(labels: np.ndarray) -> WeightedRandomSampler:
    counts = np.bincount(labels, minlength=NUM_CLASSES).astype(np.float64)
    counts[counts == 0] = 1  # avoid div-by-zero for classes absent from this split
    weight_per_class = 1.0 / counts
    sample_weights = weight_per_class[labels]
    return WeightedRandomSampler(sample_weights, num_samples=len(labels), replacement=True)


def confusion_matrix(preds: np.ndarray, targets: np.ndarray, num_classes: int) -> np.ndarray:
    cm = np.zeros((num_classes, num_classes), dtype=np.int64)
    for p, t in zip(preds, targets):
        cm[t, p] += 1
    return cm


def print_report(cm: np.ndarray) -> None:
    present = [i for i in range(NUM_CLASSES) if cm[i].sum() > 0]
    print(f"\n{'class':16s} {'n':>4s} {'acc':>6s}")
    for i in present:
        n = cm[i].sum()
        acc = cm[i, i] / n if n else 0.0
        flag = "  <-- weak" if acc < 0.7 else ""
        print(f"{CLASSES[i]:16s} {n:4d} {acc:6.1%}{flag}")
    overall = np.trace(cm) / cm.sum() if cm.sum() else 0.0
    print(f"\noverall val accuracy: {overall:.1%}")
    confused = [(cm[i, j], CLASSES[i], CLASSES[j]) for i in present for j in present
                if i != j and cm[i, j] > 0]
    if confused:
        print("\ntop confusions (true -> predicted, count):")
        for count, true_l, pred_l in sorted(confused, reverse=True)[:8]:
            print(f"  {true_l:16s} -> {pred_l:16s} x{count}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--features", type=Path, required=True, help="npz from features.py")
    ap.add_argument("--out", type=Path, required=True, help="where to save the trained head")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--hidden", type=int, default=128)
    ap.add_argument("--val-frac", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    data = np.load(args.features, allow_pickle=True)
    feats, labels = data["features"], data["labels"]
    d_model = int(data["d_model"])
    model_name = str(data["model_name"])
    print(f"Loaded {len(feats)} embeddings ({d_model}-dim, from {model_name})")

    train_idx, val_idx = stratified_split(labels, args.val_frac, args.seed)
    x_train = torch.from_numpy(feats[train_idx])
    y_train = torch.from_numpy(labels[train_idx])
    x_val = torch.from_numpy(feats[val_idx])
    y_val = torch.from_numpy(labels[val_idx])
    print(f"train={len(train_idx)}  val={len(val_idx)}")

    missing = [CLASSES[c] for c in range(NUM_CLASSES) if (labels == c).sum() == 0]
    if missing:
        print(f"[warn] these classes have ZERO examples and can never be predicted "
              f"correctly: {missing}")

    train_ds = TensorDataset(x_train, y_train)
    sampler = class_balanced_sampler(y_train.numpy())
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, sampler=sampler)

    head = IntentHead(d_model=d_model, hidden=args.hidden)
    opt = torch.optim.AdamW(head.parameters(), lr=args.lr, weight_decay=1e-4)
    loss_fn = nn.CrossEntropyLoss()

    best_val_acc = -1.0
    best_state = None
    for epoch in range(1, args.epochs + 1):
        head.train()
        total_loss = 0.0
        for xb, yb in train_loader:
            opt.zero_grad()
            logits = head(xb)
            loss = loss_fn(logits, yb)
            loss.backward()
            opt.step()
            total_loss += loss.item() * len(xb)
        train_loss = total_loss / len(train_ds)

        head.eval()
        with torch.no_grad():
            val_logits = head(x_val)
            val_preds = val_logits.argmax(dim=1)
            val_acc = (val_preds == y_val).float().mean().item() if len(val_idx) else float("nan")

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_state = {k: v.clone() for k, v in head.state_dict().items()}

        if epoch % 5 == 0 or epoch == 1:
            print(f"epoch {epoch:3d}  train_loss={train_loss:.4f}  val_acc={val_acc:.1%}")

    head.load_state_dict(best_state)
    head.eval()
    with torch.no_grad():
        val_preds = head(x_val).argmax(dim=1).numpy()
    cm = confusion_matrix(val_preds, y_val.numpy(), NUM_CLASSES)
    print_report(cm)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "state_dict": head.state_dict(),
        "d_model": d_model,
        "hidden": args.hidden,
        "model_name": model_name,
        "classes": CLASSES,
        "best_val_acc": best_val_acc,
    }, args.out)
    meta_path = args.out.with_suffix(".json")
    meta_path.write_text(json.dumps({
        "model_name": model_name, "classes": CLASSES, "best_val_acc": best_val_acc,
        "n_train": len(train_idx), "n_val": len(val_idx),
    }, indent=2))
    print(f"\nSaved best checkpoint (val_acc={best_val_acc:.1%}) to {args.out}")


if __name__ == "__main__":
    main()
