"""Enroll a speaker's voiceprint using the production `speech.speaker_id` module -- no
dependency on the standalone `voice_intent_transcribe.py` prototype.

    python enroll_speaker.py --speaker ananya
    python enroll_speaker.py --speaker avinandan
"""
from __future__ import annotations

import argparse

from firebot.speech.audio import mic_chunks
from firebot.speech.speaker_id import SpeakerIdentifier


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--speaker", required=True)
    p.add_argument("--seconds", type=float, default=8.0)
    a = p.parse_args()

    print(f"Recording {a.seconds}s of natural speech for '{a.speaker}' "
          f"(count numbers, describe your day -- not a command word).")
    input("Press Enter to start...")
    chunks, gen = [], mic_chunks()
    n_bytes_needed = int(a.seconds * 16_000) * 2  # 16 kHz, 16-bit
    total = 0
    for chunk in gen:
        chunks.append(chunk)
        total += len(chunk)
        if total >= n_bytes_needed:
            break
    print("Done. Computing voiceprint...")
    SpeakerIdentifier().enroll(a.speaker, b"".join(chunks))
    print(f"Saved voiceprint for '{a.speaker}' to data/voiceprints/{a.speaker}.npy")


if __name__ == "__main__":
    main()
