"""Enroll a speaker's voiceprint using the production `speech.speaker_id` module -- no
dependency on the standalone `voice_intent_transcribe.py` prototype.

Records several short clips and averages their embeddings (`SpeakerIdentifier.enroll_multi`)
rather than one long monologue -- short, command-length clips are what `identify()` actually
sees at recognition time, so enrolling at that same length/style (several times, then
averaged) matches the acoustic distribution recognition will be tested against, instead of a
single long clip that scores worse purely from being a different kind of sample -- same
speaker, mismatched content/duration.

    python enroll_speaker.py --speaker ananya
    python enroll_speaker.py --speaker avinandan
"""
from __future__ import annotations

import argparse

from firebot.speech.audio import mic_chunks
from firebot.speech.speaker_id import SpeakerIdentifier


def record_clip_bytes(seconds: float) -> bytes:
    chunks = []
    n_bytes_needed = int(seconds * 16_000) * 2  # 16 kHz, 16-bit
    total = 0
    for chunk in mic_chunks():
        chunks.append(chunk)
        total += len(chunk)
        if total >= n_bytes_needed:
            break
    return b"".join(chunks)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--speaker", required=True)
    p.add_argument("--clips", type=int, default=6,
                   help="number of short clips to record and average (default: 6)")
    p.add_argument("--clip-seconds", type=float, default=2.0,
                   help="length of each clip in seconds -- match this to the --clip-seconds "
                        "you'll actually run recognize/listen with, so enrollment and "
                        "recognition see the same style of audio (default: 2.0)")
    a = p.parse_args()

    print(f"Recording {a.clips} clips of {a.clip_seconds}s each for '{a.speaker}' -- "
          f"say a different short, natural phrase each time (not silence, and not the same "
          f"single word every time), so the averaged voiceprint isn't overfit to one phrase.")
    clips = []
    for i in range(a.clips):
        input(f"Press Enter to record clip {i + 1}/{a.clips}...")
        clips.append(record_clip_bytes(a.clip_seconds))
        print("  captured.")

    print("Computing averaged voiceprint...")
    SpeakerIdentifier().enroll_multi(a.speaker, clips)
    print(f"Saved voiceprint for '{a.speaker}' to data/voiceprints/{a.speaker}.npy "
          f"(averaged over {a.clips} clips)")


if __name__ == "__main__":
    main()
