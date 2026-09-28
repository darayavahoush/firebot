"""Evaluation helpers for the intent classifier. Pure numpy (no torch) so they can be unit-tested.

Three jobs:
  * pick which validation slices may be used to choose the best epoch -- never the real
    recordings, which must stay an untouched test;
  * per-class precision as well as recall (a class can have great recall by absorbing everything);
  * a confidence table (how accurate are predictions at or above each threshold, and how many
    clips are kept), plus expected calibration error, to guide FIREBOT_VOICE_INTENT_MIN_CONFIDENCE
    and the per-class overrides.
"""
from __future__ import annotations

import numpy as np

DEFAULT_THRESHOLDS = (0.3, 0.5, 0.6, 0.7, 0.8, 0.9)


def is_real_slice(name: str) -> bool:
    return str(name).startswith("real")


def selection_mask(val_slice: np.ndarray) -> np.ndarray:
    """Validation entries allowed to steer checkpoint selection: everything except real-recording
    slices. If that leaves nothing (e.g. an all-real dataset) fall back to all entries, so
    training still works -- the caller should warn in that case."""
    val_slice = np.asarray(val_slice).astype(str)
    mask = np.array([not is_real_slice(s) for s in val_slice], dtype=bool)
    return mask if mask.any() else np.ones(len(val_slice), dtype=bool)


def finite_rows(feats: np.ndarray) -> np.ndarray:
    """Boolean mask of feature rows with no NaN/inf."""
    return np.isfinite(feats).all(axis=1)


def precision_recall(cm: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(precision, recall) per class from a confusion matrix cm[true, pred]; NaN where undefined."""
    tp = np.diag(cm).astype(np.float64)
    with np.errstate(divide="ignore", invalid="ignore"):
        precision = np.where(cm.sum(axis=0) > 0, tp / cm.sum(axis=0), np.nan)
        recall = np.where(cm.sum(axis=1) > 0, tp / cm.sum(axis=1), np.nan)
    return precision, recall


def expected_calibration_error(conf: np.ndarray, correct: np.ndarray, bins: int = 10) -> float:
    """Weighted mean |accuracy - confidence| over equal-width confidence bins. 0 = calibrated."""
    conf = np.asarray(conf, dtype=np.float64)
    correct = np.asarray(correct, dtype=np.float64)
    if len(conf) == 0:
        return float("nan")
    edges = np.linspace(0.0, 1.0, bins + 1)
    idx = np.clip(np.digitize(conf, edges[1:-1]), 0, bins - 1)
    ece = 0.0
    for b in range(bins):
        m = idx == b
        if m.any():
            ece += m.mean() * abs(correct[m].mean() - conf[m].mean())
    return float(ece)


def threshold_table(conf: np.ndarray, correct: np.ndarray,
                    thresholds=DEFAULT_THRESHOLDS) -> list[tuple[float, float, float]]:
    """[(threshold, kept_fraction, accuracy_of_kept)]. accuracy is NaN when nothing is kept."""
    conf = np.asarray(conf, dtype=np.float64)
    correct = np.asarray(correct, dtype=np.float64)
    rows = []
    for t in thresholds:
        keep = conf >= t
        kept = float(keep.mean()) if len(conf) else float("nan")
        acc = float(correct[keep].mean()) if keep.any() else float("nan")
        rows.append((float(t), kept, acc))
    return rows


def format_threshold_table(conf: np.ndarray, correct: np.ndarray) -> str:
    lines = [f"{'conf >=':>8s} {'kept':>7s} {'acc of kept':>12s}"]
    for t, kept, acc in threshold_table(conf, correct):
        acc_s = "   n/a" if np.isnan(acc) else f"{acc:11.1%}"
        lines.append(f"{t:8.2f} {kept:7.1%} {acc_s:>12s}")
    ece = expected_calibration_error(conf, correct)
    lines.append(f"ECE = {ece:.3f}  (0 is perfectly calibrated; overconfident models score high)")
    return "\n".join(lines)
