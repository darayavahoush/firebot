"""Measure how well speaker ID separates the enrolled people using their recorded command
clips (data/commands/<command>/<speaker>_NNN.wav), and rebuild voiceprints from those clips.

    python calibrate_speakers.py            # report only: accuracy + recommended threshold
    python calibrate_speakers.py --write    # also save averaged voiceprints (old ones -> .bak)

Voiceprints built from many short command clips match what the console hears at test time
far better than one long enrolment recording. Leave-one-out: each clip is scored against
voiceprints built WITHOUT it, so the numbers aren't flattered by testing on training data.
"""
from __future__ import annotations

import argparse
import re
import shutil
from collections import defaultdict
from pathlib import Path

import numpy as np

from firebot.speech.speaker_id import SpeakerIdentifier, cosine_similarity, trim_silence

CLIP = re.compile(r"^(?P<spk>[a-z]+)_\d+\.wav$")


def load_pcm(path: Path) -> bytes:
    import librosa
    audio, _ = librosa.load(str(path), sr=16_000, mono=True)
    audio = trim_silence(audio.astype("float32"))
    return (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=Path("data/commands"))
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--voiceprints", type=Path, default=Path("data/voiceprints"))
    a = ap.parse_args()

    ident = SpeakerIdentifier(a.voiceprints)
    emb: dict[str, list[np.ndarray]] = defaultdict(list)
    for d in sorted(p for p in a.data.iterdir() if p.is_dir() and p.name != "unknown"):
        for wav in sorted(d.glob("*.wav")):
            m = CLIP.match(wav.name)
            if m:
                emb[m["spk"]].append(ident.embed(load_pcm(wav)))
    speakers = sorted(emb)
    if len(speakers) < 2:
        raise SystemExit(f"need clips from at least 2 speakers, found {speakers}")
    print("clips per speaker:", {s: len(v) for s, v in emb.items()})

    own, other, correct, total = [], [], 0, 0
    for s in speakers:
        for i, e in enumerate(emb[s]):
            protos = {}
            for t in speakers:
                vs = [x for j, x in enumerate(emb[t]) if not (t == s and j == i)]
                protos[t] = np.mean(vs, axis=0)
            sc = {t: cosine_similarity(e, protos[t]) for t in speakers}
            own.append(sc[s]); other += [v for t, v in sc.items() if t != s]
            correct += max(sc, key=sc.get) == s; total += 1
    own, other = np.array(own), np.array(other)
    print(f"\nleave-one-out accuracy: {correct}/{total} = {correct / total:.1%}")
    print(f"same-speaker score : mean {own.mean():.2f}  5th pct {np.percentile(own, 5):.2f}")
    print(f"other-speaker score: mean {other.mean():.2f}  95th pct {np.percentile(other, 95):.2f}")
    thr = float(np.clip((np.percentile(own, 5) + np.percentile(other, 95)) / 2, 0.15, 0.6))
    print(f"\nrecommended:  export FIREBOT_SPEAKER_THRESHOLD={thr:.2f}")

    if a.write:
        a.voiceprints.mkdir(parents=True, exist_ok=True)
        for s in speakers:
            f = a.voiceprints / f"{s}.npy"
            if f.exists():
                shutil.copy(f, f.with_suffix(".npy.bak"))
            np.save(f, np.mean(emb[s], axis=0))
        print(f"saved voiceprints for {speakers} to {a.voiceprints}/ (old ones kept as .bak)")


if __name__ == "__main__":
    main()
