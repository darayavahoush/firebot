"""Per-user calibration: fine-tune only the small classifier head on a person's own clips.

The Whisper encoder stays frozen, so a user's ~75 clips are embedded once (see
`IntentClassifier.embed_array`) and the head is nudged toward their voice in seconds on CPU.
Two things keep 5 clips/class from wrecking the base model:

* **L2-SP**: an L2 penalty pulling the weights back toward the base head, not toward zero, so
  the personal head can only drift as far as the evidence justifies.
* **A hold-out check**: one clip per class is set aside; the personal head is kept only if it
  is at least as accurate as the base head on those clips (`personalize` returns `accepted`).

Pure torch/numpy -- no Whisper needed here, which keeps it unit-testable.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from .model import IntentHead

MIN_CLIPS_PER_CLASS = 3


def head_from_ckpt(ckpt: dict, device: str = "cpu") -> IntentHead:
    state = ckpt["state_dict"]
    hidden, d_model = state["net.1.weight"].shape
    head = IntentHead(d_model=d_model, hidden=hidden, num_classes=state["net.4.weight"].shape[0])
    head.load_state_dict(state)
    return head.to(device).eval()


@torch.no_grad()
def accuracy(head: IntentHead, feats: torch.Tensor, labels: torch.Tensor) -> float:
    if len(labels) == 0:
        return 0.0
    head.eval()
    return float((head(feats).argmax(1) == labels).float().mean())


def finetune_head(base_ckpt: dict, feats: np.ndarray, labels: np.ndarray, *, epochs: int = 40,
                  lr: float = 5e-4, l2sp: float = 0.5, noise: float = 0.02, seed: int = 0) -> IntentHead:
    """Copy of the base head, fine-tuned on (feats, labels) with an L2-SP pull to the base."""
    torch.manual_seed(seed)
    base = head_from_ckpt(base_ckpt)
    head = head_from_ckpt(base_ckpt)
    anchor = [p.detach().clone() for p in base.parameters()]
    x = torch.as_tensor(feats, dtype=torch.float32)
    y = torch.as_tensor(labels, dtype=torch.long)
    opt = torch.optim.AdamW(head.parameters(), lr=lr, weight_decay=0.0)
    scale = x.std().clamp_min(1e-6)
    head.train()
    for _ in range(epochs):
        perm = torch.randperm(len(x))
        for i in range(0, len(x), 16):
            idx = perm[i:i + 16]
            xb = x[idx] + noise * scale * torch.randn_like(x[idx])   # light embedding-space augmentation
            loss = F.cross_entropy(head(xb), y[idx], label_smoothing=0.05)
            loss = loss + l2sp * sum(((p - a) ** 2).sum() for p, a in zip(head.parameters(), anchor))
            opt.zero_grad()
            loss.backward()
            opt.step()
    return head.eval()


def _split(labels: np.ndarray, holdout: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Hold out `holdout` clip(s) per class that has enough clips to spare."""
    rng = np.random.default_rng(seed)
    hold = []
    for c in np.unique(labels):
        idx = np.flatnonzero(labels == c)
        if len(idx) > MIN_CLIPS_PER_CLASS:
            hold.extend(rng.choice(idx, size=holdout, replace=False))
    hold = np.array(sorted(hold), dtype=int)
    train = np.setdiff1d(np.arange(len(labels)), hold)
    return train, hold


def personalize(base_ckpt: dict, feats: np.ndarray, label_names: list[str], *, holdout: int = 1,
                seed: int = 0, optional: frozenset[str] = frozenset({"UNKNOWN"}), **ft) -> tuple[dict, dict]:
    """Returns (checkpoint_dict_for_the_user, report). The checkpoint is the base one with a
    fine-tuned `state_dict`; `report["accepted"]` says whether it beat the base on held-out clips
    (when it didn't, the checkpoint returned is the base's, so callers can always save it).
    `optional` classes (default UNKNOWN) need no recordings."""
    classes: list[str] = list(base_ckpt["classes"])
    unknown = sorted(set(label_names) - set(classes))
    if unknown:
        raise ValueError(f"labels not in the model's classes: {unknown}")
    labels = np.array([classes.index(n) for n in label_names])
    counts = {c: int((labels == i).sum()) for i, c in enumerate(classes)}
    missing = [c for c, n in counts.items() if n < MIN_CLIPS_PER_CLASS and c not in optional]
    report: dict = {"clips": len(labels), "per_class": counts, "missing": missing,
                    "accepted": False, "base_acc": None, "personal_acc": None}
    if missing:
        report["reason"] = f"need at least {MIN_CLIPS_PER_CLASS} clips for: {', '.join(missing)}"
        return base_ckpt, report

    tr, ho = _split(labels, holdout, seed)
    x = torch.as_tensor(feats, dtype=torch.float32)
    y = torch.as_tensor(labels, dtype=torch.long)
    base_acc = accuracy(head_from_ckpt(base_ckpt), x[ho], y[ho])
    trial = finetune_head(base_ckpt, feats[tr], labels[tr], seed=seed, **ft)
    personal_acc = accuracy(trial, x[ho], y[ho])
    report.update(base_acc=round(base_acc, 4), personal_acc=round(personal_acc, 4), holdout=len(ho))
    if personal_acc < base_acc:
        report["reason"] = "personal model wasn't better than the default on held-out clips"
        return base_ckpt, report

    final = finetune_head(base_ckpt, feats, labels, seed=seed, **ft)     # refit on every clip
    out = dict(base_ckpt)
    out["state_dict"] = {k: v.detach().clone() for k, v in final.state_dict().items()}
    out["personalized"] = {"clips": len(labels), "base_acc": report["base_acc"],
                           "personal_acc": report["personal_acc"]}
    report["accepted"] = True
    return out, report


def save_user_ckpt(ckpt: dict, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    torch.save(ckpt, path)


def load_user_head(path: str | Path, device: str = "cpu") -> IntentHead:
    return head_from_ckpt(torch.load(path, map_location=device, weights_only=False), device)
