"""Make impostor clips for scripts/calibrate_speakers.py --impostors from LibriSpeech test-clean.

    python scripts/fetch_impostors.py                 # download test-clean (~350 MB), write clips
    python scripts/fetch_impostors.py --src DIR       # or cut clips from your own other-speaker audio

The cohort (build_cohort.py) uses dev-clean; impostors come from a different split with different
speakers, so false-accept estimates aren't flattered by the cohort having seen the same voices.
Writes 1-3 s wav clips (command length) to data/_impostors/ (git-ignored).
"""
from __future__ import annotations

import argparse
import tarfile
from pathlib import Path

import numpy as np
import soundfile as sf
from build_cohort import _flac_to_pcm
from download_util import download_atomic

URL = "https://www.openslr.org/resources/12/test-clean.tar.gz"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, help="directory of .flac/.wav files (skips the download)")
    ap.add_argument("--workdir", type=Path, default=Path("data/_cohort_src"))
    ap.add_argument("--out", type=Path, default=Path("data/_impostors"))
    ap.add_argument("--per-speaker", type=int, default=5)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()

    src = a.src
    if src is None:
        a.workdir.mkdir(parents=True, exist_ok=True)
        tgz = a.workdir / "test-clean.tar.gz"
        download_atomic(URL, tgz)
        if not (a.workdir / "LibriSpeech" / "test-clean").exists():
            with tarfile.open(tgz) as t:
                t.extractall(a.workdir, filter="data")
        src = a.workdir / "LibriSpeech" / "test-clean"
    if not src.is_dir():
        raise SystemExit(f"{src} is not a directory")

    rng = np.random.default_rng(a.seed)
    by_spk: dict[str, list[Path]] = {}
    for f in sorted([*src.glob("**/*.flac"), *src.glob("**/*.wav")]):
        key = f.parts[-3] if f.suffix == ".flac" and len(f.parts) >= 3 else f.parent.name
        by_spk.setdefault(key, []).append(f)

    a.out.mkdir(parents=True, exist_ok=True)
    n = 0
    for spk, files in sorted(by_spk.items()):
        segs: list[bytes] = []
        for i in rng.permutation(len(files))[:3]:
            try:
                segs += _flac_to_pcm(files[i], rng)
            except Exception as e:  # noqa: BLE001 -- skip a bad file, keep going
                print(f"  skipped {files[i]}: {e}")
        for j, i in enumerate(rng.permutation(len(segs))[: a.per_speaker]):
            audio = np.frombuffer(segs[i], dtype="<i2")
            sf.write(a.out / f"{spk}_{j}.wav", audio, 16_000, subtype="PCM_16")
            n += 1
    if n == 0:
        raise SystemExit(f"no impostor clips written; delete {src} and re-run to re-extract")
    print(f"wrote {n} impostor clips from {len(by_spk)} speakers to {a.out}/")


if __name__ == "__main__":
    main()
