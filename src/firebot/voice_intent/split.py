"""Speaker-aware train/validation split.

Why not a plain per-clip random split: every phrase is synthesized by ~40 TTS
voices and each clip gets augmented copies, so a random split puts near-identical
clips (same voice, same phrase, same augmentation source) on both sides. The
validation score then measures "did it memorize this voice saying this phrase",
not "will it work for a voice it has never heard" -- which is the thing that
matters for a robot that hears you and Avinandan through a real mic.

Here whole *speakers* are held out instead. A speaker is a TTS voice id for
synthetic clips, or a person's name for real recordings (parsed from
`<name>_<take>.wav`).

Validation is reported in named slices so a good synthetic number can't hide a
bad real-speech number:
  synth_unseen_voice    held-out TTS voices
  real_unseen_speaker   held-out real person (needs --holdout-real-speaker, or
                        two or more real speakers and no explicit choice)
  real_seen_speaker     held-out takes of a real speaker who is also in training
                        (the only option when just one real speaker exists)

Pure numpy on purpose: no torch import, so it is cheap to unit-test.
"""
from __future__ import annotations

import numpy as np

SYNTH_SOURCES = ("synth_tts", "synth_aug")
REAL_SOURCE = "real"


def split_by_speaker(
    sources: np.ndarray,
    speakers: np.ndarray,
    labels: np.ndarray,
    val_frac: float = 0.15,
    seed: int = 0,
    holdout_real_speaker: str | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (train_idx, val_idx, val_slice) where val_slice[i] names the slice
    of the i-th entry of val_idx."""
    sources = np.asarray(sources).astype(str)
    speakers = np.asarray(speakers).astype(str)
    labels = np.asarray(labels)
    rng = np.random.default_rng(seed)
    n = len(labels)

    val_mask = np.zeros(n, dtype=bool)
    slice_of = np.full(n, "", dtype=object)

    # --- synthetic: hold out whole TTS voices --------------------------------
    is_synth = np.isin(sources, SYNTH_SOURCES)
    synth_speakers = sorted(set(speakers[is_synth]))
    if len(synth_speakers) >= 2:
        n_hold = max(1, int(round(len(synth_speakers) * val_frac)))
        held = set(rng.permutation(synth_speakers)[:n_hold].tolist())
        m = is_synth & np.isin(speakers, list(held))
        val_mask |= m
        slice_of[m] = "synth_unseen_voice"

    # --- real: hold out a whole person if we can, else a few takes -----------
    is_real = sources == REAL_SOURCE
    real_speakers = sorted(set(speakers[is_real]))
    if holdout_real_speaker is not None:
        if holdout_real_speaker not in real_speakers:
            raise ValueError(
                f"--holdout-real-speaker {holdout_real_speaker!r} not found among "
                f"real speakers {real_speakers}")
        m = is_real & (speakers == holdout_real_speaker)
        val_mask |= m
        slice_of[m] = "real_unseen_speaker"
    elif len(real_speakers) >= 2:
        held_real = real_speakers[-1]  # deterministic: last alphabetically
        m = is_real & (speakers == held_real)
        val_mask |= m
        slice_of[m] = "real_unseen_speaker"
    elif len(real_speakers) == 1:
        # One person only: the best available is held-out takes, stratified by
        # class. Flagged as "seen speaker" so it isn't mistaken for a
        # new-voice test.
        for c in np.unique(labels[is_real]):
            idx = np.where(is_real & (labels == c))[0]
            if len(idx) < 2:
                continue
            idx = rng.permutation(idx)
            n_val = max(1, int(round(len(idx) * val_frac)))
            val_mask[idx[:n_val]] = True
            slice_of[idx[:n_val]] = "real_seen_speaker"

    train_idx = np.where(~val_mask)[0]
    val_idx = np.where(val_mask)[0]
    return train_idx, val_idx, slice_of[val_idx].astype(str)


def has_speaker_info(speakers: np.ndarray) -> bool:
    """False for manifests written before the `speaker` column existed."""
    s = np.asarray(speakers).astype(str)
    return len(s) > 0 and bool((s != "").any())
