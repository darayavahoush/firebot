"""Build the impostor cohort used for AS-norm score normalisation.

    python scripts/build_cohort.py --librispeech            # download dev-clean (~340 MB), build
    python scripts/build_cohort.py --wav-dir path/to/wavs   # or use your own other-speaker audio

Cuts each utterance into 1-3 s segments (command length), embeds them with the ACTIVE embedder
and saves data/voiceprints/cohort.npy (N x D, a few hundred KB; commit it so Render has it).
Rebuild it whenever you change FIREBOT_SPEAKER_EMBEDDER. Use speakers who are not enrolled.
Download/extract needs network access to openslr.org, so run it on your own machine.
"""
from __future__ import annotations

import argparse
import json
import tarfile
from pathlib import Path

import numpy as np
from download_util import download_atomic

from firebot.speech.speaker_embed import embedder_name
from firebot.speech.speaker_id import COHORT_FILE, META_FILE, SpeakerIdentifier, trim_silence

LIBRISPEECH_URL = "https://www.openslr.org/resources/12/dev-clean.tar.gz"
SR = 16_000


def _flac_to_pcm(path: Path, rng: np.random.Generator) -> list[bytes]:
    import soundfile as sf
    audio, sr = sf.read(str(path), dtype="float32")
    if sr != SR:
        return []
    audio = trim_silence(audio)
    segs = []
    pos = 0
    while pos < len(audio):
        n = int(rng.uniform(1.0, 3.0) * SR)
        seg = audio[pos:pos + n]
        if len(seg) >= SR:
            segs.append((np.clip(seg, -1, 1) * 32767).astype("<i2").tobytes())
        pos += n
    return segs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav-dir", type=Path)
    ap.add_argument("--librispeech", action="store_true")
    ap.add_argument("--workdir", type=Path, default=Path("data/_cohort_src"))
    ap.add_argument("--speakers-max", type=int, default=60)
    ap.add_argument("--per-speaker", type=int, default=6, help="segments kept per speaker")
    ap.add_argument("--out", type=Path, default=Path("data/voiceprints"))
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()

    src = a.wav_dir
    if a.librispeech:
        a.workdir.mkdir(parents=True, exist_ok=True)
        tgz = a.workdir / "dev-clean.tar.gz"
        download_atomic(LIBRISPEECH_URL, tgz)
        if not (a.workdir / "LibriSpeech").exists():
            with tarfile.open(tgz) as t:
                t.extractall(a.workdir, filter="data")
        src = a.workdir / "LibriSpeech" / "dev-clean"
    if not src or not src.is_dir():
        raise SystemExit("give --librispeech or --wav-dir DIR")

    rng = np.random.default_rng(a.seed)
    files = sorted([*src.glob("**/*.flac"), *src.glob("**/*.wav")])
    by_spk: dict[str, list[Path]] = {}
    for f in files:  # LibriSpeech layout: <speaker>/<chapter>/file; otherwise group by parent dir
        key = f.parts[-3] if a.librispeech else f.parent.name
        by_spk.setdefault(key, []).append(f)
    spk_ids = sorted(by_spk)
    rng.shuffle(spk_ids)

    ident = SpeakerIdentifier(a.out)
    embs = []
    for spk in spk_ids[: a.speakers_max]:
        segs: list[bytes] = []
        for f in rng.permutation(len(by_spk[spk]))[:4]:
            segs += _flac_to_pcm(by_spk[spk][f], rng)
        picks = rng.permutation(len(segs))[: a.per_speaker]
        embs += [ident.embed(segs[i]) for i in picks]
        print(f"  {spk}: {len(picks)} segments")
    if len(embs) < 50:
        raise SystemExit(f"only {len(embs)} cohort embeddings; need at least 50")

    a.out.mkdir(parents=True, exist_ok=True)
    meta = a.out / META_FILE
    if meta.exists() and json.loads(meta.read_text()).get("embedder") not in (None, embedder_name()):
        print("warning: existing voiceprints use a different embedder; re-run calibrate_speakers.py --write")
    np.save(a.out / COHORT_FILE, np.stack(embs).astype(np.float32))
    print(f"saved {len(embs)} cohort embeddings ({embedder_name()}) to {a.out / COHORT_FILE}")


if __name__ == "__main__":
    main()
