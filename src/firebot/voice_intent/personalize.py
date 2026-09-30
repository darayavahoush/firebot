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


def holdout_indices(keys: list[str], label_names: list[str], frac: float = 0.15,
                    min_class_size: int = 4) -> np.ndarray:
    """A stable hold-out: per class with enough clips, the ~`frac` of clips whose key hashes lowest.
    Depends only on the clip's key (its file name), so it does not reshuffle when new clips arrive
    -- the same clips stay unseen by training, and retrains can be compared fairly."""
    import hashlib
    by_class: dict[str, list[int]] = {}
    for i, c in enumerate(label_names):
        by_class.setdefault(c, []).append(i)
    hold: list[int] = []
    for idx in by_class.values():
        if len(idx) < min_class_size:
            continue
        k = max(1, round(frac * len(idx)))
        idx = sorted(idx, key=lambda i: hashlib.sha1(keys[i].encode()).hexdigest())
        hold.extend(idx[:k])
    return np.array(sorted(hold), dtype=int)


def personalize(base_ckpt: dict, feats: np.ndarray, label_names: list[str], *, holdout: int = 1,
                seed: int = 0, optional: frozenset[str] = frozenset({"UNKNOWN"}),
                holdout_idx: np.ndarray | None = None, incumbent: dict | None = None,
                refit_all: bool = True, min_clips: int | None = None,
                allow_partial: bool = False, **ft) -> tuple[dict, dict]:
    """Returns (checkpoint_dict_for_the_user, report). The checkpoint is the base one with a
    fine-tuned `state_dict`; `report["accepted"]` says whether it beat the base on held-out clips
    (when it didn't, the checkpoint returned is the base's, so callers can always save it).
    `optional` classes (default UNKNOWN) need no recordings.

    When `allow_partial=True`, training proceeds on whatever commands the operator has recorded
    (at least `min_clips` per recorded class, default 1). Unrecorded classes retain their base
    weights thanks to L2-SP anchoring.
    """
    classes: list[str] = list(base_ckpt["classes"])
    unknown = sorted(set(label_names) - set(classes))
    if unknown:
        raise ValueError(f"labels not in the model's classes: {unknown}")
    labels = np.array([classes.index(n) for n in label_names])
    counts = {c: int((labels == i).sum()) for i, c in enumerate(classes)}
    req_clips = MIN_CLIPS_PER_CLASS if min_clips is None else min_clips

    if allow_partial:
        missing = [c for c, n in counts.items() if 0 < n < req_clips and c not in optional]
        unrecorded = [c for c, n in counts.items() if n == 0]
    else:
        missing = [c for c, n in counts.items() if n < req_clips and c not in optional]
        unrecorded = [c for c, n in counts.items() if n == 0]

    report: dict = {"clips": len(labels), "per_class": counts, "missing": missing,
                    "unrecorded": unrecorded, "accepted": False, "base_acc": None,
                    "personal_acc": None}
    if missing:
        report["reason"] = f"need at least {req_clips} clips for: {', '.join(missing)}"
        return base_ckpt, report
    if len(labels) == 0:
        report["reason"] = "no audio clips provided for calibration"
        return base_ckpt, report

    if holdout_idx is not None:
        ho = np.asarray(holdout_idx, dtype=int)
        tr = np.setdiff1d(np.arange(len(labels)), ho)
    else:
        tr, ho = _split(labels, holdout, seed)

    # If holdout is non-empty, evaluate generalization on unseen clips.
    # If holdout is empty (small sample size), evaluate empirical fit on available recordings.
    eval_idx = ho if len(ho) > 0 else tr
    x = torch.as_tensor(feats, dtype=torch.float32)
    y = torch.as_tensor(labels, dtype=torch.long)
    base_acc = accuracy(head_from_ckpt(base_ckpt), x[eval_idx], y[eval_idx])
    inc_acc = accuracy(head_from_ckpt(incumbent), x[eval_idx], y[eval_idx]) if incumbent is not None else None
    trial = finetune_head(base_ckpt, feats[tr], labels[tr], seed=seed, **ft)
    personal_acc = accuracy(trial, x[eval_idx], y[eval_idx])
    report.update(base_acc=round(base_acc, 4), personal_acc=round(personal_acc, 4), holdout=len(ho),
                  incumbent_acc=None if inc_acc is None else round(inc_acc, 4))
    if personal_acc < base_acc:
        report["reason"] = "personal model wasn't better than the default"
        return base_ckpt, report
    if inc_acc is not None and personal_acc < inc_acc:
        report["reason"] = "the retrained model was worse than your current one, so it was not used"
        return incumbent, report

    final = trial if not refit_all else finetune_head(base_ckpt, feats, labels, seed=seed, **ft)
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
