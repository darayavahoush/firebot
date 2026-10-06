"""Verification metrics for speaker ID: EER, minDCF and threshold selection.

Trials are (score, is_target) pairs. A *target* trial is a clip scored against its own speaker's
voiceprint; a *non-target* trial is a clip from someone else (another enrolled speaker, or an
impostor from a public cohort) scored against that voiceprint. False accepts (non-target scored
above threshold) are the dangerous error here, because they would hand someone else's identity
to the speaker-permissions layer.
"""
from __future__ import annotations

import numpy as np


def _sweep(target: np.ndarray, nontarget: np.ndarray):
    """Yield (thresholds, miss_rate, false_accept_rate), thresholds ascending."""
    thr = np.unique(np.concatenate([target, nontarget]))
    thr = np.concatenate([[thr[0] - 1e-6], thr, [thr[-1] + 1e-6]])
    t_sorted, n_sorted = np.sort(target), np.sort(nontarget)
    # accept when score >= threshold
    miss = np.searchsorted(t_sorted, thr, side="left") / len(t_sorted)
    fa = 1.0 - np.searchsorted(n_sorted, thr, side="left") / len(n_sorted)
    return thr, miss, fa


def eer(target: list[float] | np.ndarray, nontarget: list[float] | np.ndarray) -> tuple[float, float]:
    """(equal_error_rate, threshold_at_eer)."""
    t, n = np.asarray(target, float), np.asarray(nontarget, float)
    if len(t) == 0 or len(n) == 0:
        raise ValueError("need both target and non-target trials")
    thr, miss, fa = _sweep(t, n)
    i = int(np.argmin(np.abs(miss - fa)))
    return float((miss[i] + fa[i]) / 2), float(thr[i])


def min_dcf(target, nontarget, p_target: float = 0.01, c_miss: float = 1.0,
            c_fa: float = 1.0) -> tuple[float, float]:
    """(normalised minDCF, threshold achieving it). The default prior (0.01) weights false
    accepts heavily, matching "someone else must not get this operator's permissions"."""
    t, n = np.asarray(target, float), np.asarray(nontarget, float)
    if len(t) == 0 or len(n) == 0:
        raise ValueError("need both target and non-target trials")
    thr, miss, fa = _sweep(t, n)
    dcf = c_miss * p_target * miss + c_fa * (1 - p_target) * fa
    norm = min(c_miss * p_target, c_fa * (1 - p_target))
    i = int(np.argmin(dcf))
    return float(dcf[i] / norm), float(thr[i])


def pick_threshold(target, nontarget, max_far: float = 0.01) -> float:
    """Lowest threshold whose false-accept rate is <= `max_far` (falls back to the EER point
    if no threshold achieves that)."""
    t, n = np.asarray(target, float), np.asarray(nontarget, float)
    thr, miss, fa = _sweep(t, n)
    ok = np.flatnonzero(fa <= max_far)
    if ok.size == 0:
        return eer(t, n)[1]
    return float(thr[ok[0]])
