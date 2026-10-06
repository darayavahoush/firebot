"""Measure speaker-ID quality on your recorded clips and (re)build voiceprints + thresholds.

    python scripts/calibrate_speakers.py                       # report only
    python scripts/calibrate_speakers.py --write               # also enrol everyone + save thresholds
    python scripts/calibrate_speakers.py --impostors DIR       # add impostor clips (e.g. LibriSpeech)

Clips are read from data/calibration/<speaker>/<CLASS>/NNN.wav (what the console records).
Each clip is scored leave-one-out: against voiceprints built WITHOUT it, so the numbers aren't
flattered by testing on training data. Reported:
  * identification accuracy among the enrolled speakers
  * EER and minDCF (prior 0.01) for verification, using other enrolled speakers' clips and any
    --impostors clips as non-target trials, for plain cosine and, if data/voiceprints/cohort.npy
    exists (scripts/build_cohort.py), AS-norm
With --write the better scoring mode and a threshold giving <= --max-far false-accept rate on the
available non-target trials are saved to data/voiceprints/speaker_calibration.json, where the
console picks them up automatically (FIREBOT_SPEAKER_THRESHOLD/MARGIN still override).

Two enrolled speakers can't show a real false-accept rate; add --impostors for that.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
from speaker_clips import load_pcm, speaker_clips

from firebot.speech.speaker_embed import embedder_name
from firebot.speech.speaker_eval import eer, min_dcf, pick_threshold
from firebot.speech.speaker_id import (
    CALIBRATION_FILE,
    COHORT_FILE,
    META_FILE,
    SpeakerIdentifier,
    as_norm,
    cosine_similarity,
    l2_normalize,
)


def _proto(vs: list[np.ndarray]) -> np.ndarray:
    return l2_normalize(np.mean(vs, axis=0))


def _backup_incompatible(vp_dir: Path) -> None:
    meta = vp_dir / META_FILE
    stored = json.loads(meta.read_text()).get("embedder") if meta.exists() else "legacy"
    files = [p for p in vp_dir.glob("*.npy") if p.name != COHORT_FILE]
    if files and stored != embedder_name():
        bak = vp_dir / f"backup_{stored}"
        bak.mkdir(exist_ok=True)
        for p in files + ([meta] if meta.exists() else []):
            shutil.move(str(p), bak / p.name)
        print(f"moved {len(files)} voiceprints from the {stored!r} embedder to {bak}/")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=Path("data/calibration"))
    ap.add_argument("--voiceprints", type=Path, default=Path("data/voiceprints"))
    ap.add_argument("--impostors", type=Path, help="directory of impostor .wav clips (any depth)")
    ap.add_argument("--max-impostors", type=int, default=300)
    ap.add_argument("--max-far", type=float, default=0.01, help="target false-accept rate")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--force", action="store_true", help="write even if accuracy is below 80%%")
    a = ap.parse_args()

    print(f"embedder: {embedder_name()}")
    ident = SpeakerIdentifier(a.voiceprints)
    clips = speaker_clips(a.data)
    emb: dict[str, list[np.ndarray]] = {}
    for spk, wavs in clips.items():
        es = []
        for w in wavs:
            try:
                es.append(ident.embed(load_pcm(w)))
            except Exception as e:  # noqa: BLE001 -- report and skip unusable clips
                print(f"  skipped {w}: {e}")
        if len(es) >= 2:
            emb[spk] = es
    speakers = sorted(emb)
    if len(speakers) < 2:
        raise SystemExit(f"need >=2 clips from at least 2 speakers in {a.data}, found {speakers}")
    print("clips per speaker:", {s: len(v) for s, v in emb.items()})

    cohort_path = a.voiceprints / COHORT_FILE
    cohort = None
    if cohort_path.exists():
        c = np.load(cohort_path)
        if c.ndim == 2 and len(c) >= 10:
            cohort = np.stack([l2_normalize(r) for r in c])
            print(f"cohort: {len(cohort)} impostor embeddings (AS-norm available)")

    imp_emb: list[np.ndarray] = []
    if a.impostors:
        wavs = sorted(a.impostors.glob("**/*.wav"))[: a.max_impostors]
        for w in wavs:
            try:
                imp_emb.append(ident.embed(load_pcm(w)))
            except Exception:  # noqa: BLE001, S112
                continue
        print(f"impostor clips: {len(imp_emb)}")

    modes = ["cosine"] + (["asnorm"] if cohort is not None else [])

    def score(mode: str, ref: np.ndarray, e: np.ndarray) -> float:
        return as_norm(ref, e, cohort) if mode == "asnorm" else cosine_similarity(e, ref)

    results: dict[str, dict] = {}
    for mode in modes:
        tgt, non, correct, total = [], [], 0, 0
        for s in speakers:
            for i, e in enumerate(emb[s]):
                protos = {}
                for t in speakers:
                    vs = [x for j, x in enumerate(emb[t]) if not (t == s and j == i)]
                    protos[t] = _proto(vs)
                sc = {t: score(mode, protos[t], e) for t in speakers}
                tgt.append(sc[s])
                non += [v for t, v in sc.items() if t != s]
                correct += max(sc, key=sc.get) == s
                total += 1
        full = {t: _proto(emb[t]) for t in speakers}
        for e in imp_emb:
            non += [score(mode, full[t], e) for t in speakers]
        e_rate, _ = eer(tgt, non)
        d, _ = min_dcf(tgt, non)
        thr = pick_threshold(tgt, non, a.max_far)
        gap = float(np.median(tgt) - np.median(non))
        results[mode] = dict(acc=correct / total, eer=e_rate, mindcf=d, threshold=thr,
                             margin=max(0.0, 0.1 * gap), n_target=len(tgt), n_nontarget=len(non))
        r = results[mode]
        print(f"\n[{mode}] accuracy {correct}/{total} = {r['acc']:.1%}   EER {r['eer']:.1%}   "
              f"minDCF {r['mindcf']:.3f}   ({r['n_target']} target / {r['n_nontarget']} non-target trials)")
        print(f"[{mode}] threshold for FAR<={a.max_far:.0%}: {r['threshold']:.3f}   margin {r['margin']:.3f}")
    if not imp_emb:
        print("\nnote: non-target trials are only the other enrolled speakers; pass --impostors DIR "
              "for a meaningful false-accept estimate.")

    best = min(modes, key=lambda m: results[m]["eer"])
    print(f"\nbest scoring mode: {best}")

    if a.write and results[best]["acc"] < 0.8 and not a.force:
        raise SystemExit(f"not writing: accuracy {results[best]['acc']:.0%} is below 80% -- check the "
                         "embedder/clips (or pass --force)")
    if a.write:
        a.voiceprints.mkdir(parents=True, exist_ok=True)
        _backup_incompatible(a.voiceprints)
        for s in speakers:
            np.save(a.voiceprints / f"{s}.npy", _proto(emb[s]))
        (a.voiceprints / META_FILE).write_text(json.dumps(
            {"embedder": embedder_name(), "dim": int(next(iter(emb.values()))[0].shape[0])}))
        r = results[best]
        (a.voiceprints / CALIBRATION_FILE).write_text(json.dumps({
            "scoring": best, "embedder": embedder_name(), "threshold": round(r["threshold"], 4),
            "margin": round(r["margin"], 4), "eer": round(r["eer"], 4), "min_dcf": round(r["mindcf"], 4),
            "max_far": a.max_far, "n_impostors": len(imp_emb), "speakers": speakers}, indent=2))
        print(f"saved voiceprints for {speakers} and {CALIBRATION_FILE} to {a.voiceprints}/")


if __name__ == "__main__":
    main()
