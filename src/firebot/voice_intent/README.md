# Voice intent classifier (closed-set, offline, CPU-trainable)

A separate, optional path alongside the existing Groq-Whisper-transcription +
regex-parser flow (`command/parser.py`, `/api/transcribe`): instead of
transcribing speech to text and then regexing the text into an `Intent`, this
classifies audio directly into one of 15 fixed command classes, using a
**frozen** pretrained Whisper encoder plus a small trained classifier head.

## Why this shape, specifically

- Your command set is closed (see `vocab.py` — `STOP`, `EXTINGUISH`,
  `RETURN_HOME`, `STATUS`, `UNKNOWN`, plus one `GOTO_<place>` per named
  waypoint). Closed-set audio → label is classification, not transcription,
  and classification needs far less data and compute than fine-tuning an ASR
  model to generate better text.
- Freezing the Whisper encoder and training only a small MLP head means the
  expensive part (running Whisper) happens **once per audio clip, ever**
  (cached to disk by `features.py`) rather than once per clip per training
  epoch. That's what makes this realistic on a CPU-only machine — training the
  head itself is seconds per epoch over cached embeddings.
- **Out of scope on purpose:** free-form `GOTO x=.. y=..` with raw
  coordinates. That's open-ended, not closed-set, so it isn't a class here —
  it stays on the existing Groq-transcription + regex path. This classifier
  only ever returns one of the 15 classes in `vocab.CLASSES`.

## Pipeline

```
synth_data.py  -->  manifest.csv + audio/*.wav
      |
features.py    -->  features_<model>.npz   (frozen encoder embeddings, cached)
      |
train.py       -->  checkpoints/intent_head.pt   (the only thing actually trained)
      |
infer.py       -->  IntentClassifier.predict_intent_payload(wav) -> dict
```

## 1. Install

```bash
pip install -r src/firebot/voice_intent/requirements.txt
```

On Linux, `pyttsx3` needs an OS TTS engine installed — if `synth_data.py`
errors with "no voices found":
```bash
sudo apt install espeak-ng
```
macOS and Windows already ship one (NSSpeechSynthesizer / SAPI5) — nothing
extra to install there.

## 2. Generate training data

```bash
python -m firebot.voice_intent.synth_data --out data/voice_intent
```

This synthesizes every phrase in `vocab.build_phrase_table()` with every
installed English TTS voice (`--voice-filter en` is the default — pass `''`
to use every language your system has voices for), plus a couple of
augmented copies per clip (gain/noise/time-stretch/pitch-shift — see
`_augment()`). Useful flags:
- `--limit-per-class N` — quick smoke-test run before committing to the full
  generation (which can take a while: template phrases × voices × variants).
- `--variants-per-voice N` / `--augment N` — trade dataset size for
  generation time.

**Add your own recordings** (you said you can record some yourself): put
them in `<label>/*.wav` folders, e.g.:
```
my_recordings/
  STOP/take1.wav
  STOP/take2.wav
  GOTO_NORTH/take1.wav
  ...
```
`<label>` must be one of the names in `vocab.CLASSES` — run
`python -m firebot.voice_intent.vocab` to see the full list and how many
template phrases each already has. Then:
```bash
python -m firebot.voice_intent.synth_data --out data/voice_intent \
    --real-dir my_recordings --skip-synth   # if you already ran synth once
```
Real and synthetic clips are merged into the same `manifest.csv` with a
`source` column (`synth_tts` / `synth_aug` / `real`) so you can inspect the
mix later, but they train identically — no special-casing downstream.

**When the "3 maybe later" real dataset shows up:** same `--real-dir`
mechanism, just point it at that data's directory (reorganized into
`<label>/*.wav` first if it isn't already). Nothing else in the pipeline
needs to change.

## 3. Extract frozen embeddings (the slow step, but only runs once)

```bash
python -m firebot.voice_intent.features --data data/voice_intent \
    --model openai/whisper-tiny.en
```

First run downloads `openai/whisper-tiny.en` from Hugging Face (~150MB) and
caches it locally. This is the one step that needs internet access to HF —
everything else is fully offline. `whisper-base.en` is a reasonable step up
if tiny's embeddings aren't separating your classes well enough (bigger,
slower to extract, same frozen-then-cache approach still applies).

## 4. Train the head

```bash
python -m firebot.voice_intent.train \
    --features data/voice_intent/features_openai_whisper-tiny.en.npz \
    --out checkpoints/intent_head.pt
```

Trains a small MLP (`model.py`) on the cached embeddings with a stratified
train/val split and class-balanced sampling (so rare classes aren't drowned
out), prints a per-class accuracy + confusion-matrix report, and saves the
best-val-accuracy checkpoint. Watch for:
- Any class flagged `<-- 0 examples!` at the start — means `synth_data.py`
  produced nothing for it (check the manifest / TTS warnings).
- Any class flagged `<-- weak` in the final report (< 70% val accuracy) —
  usually means that class needs more/more-varied phrasings in `vocab.py`,
  or your real recordings for it are too few/too similar to each other.
- The "top confusions" list — if two classes keep swapping, check whether
  their template phrases actually sound different (e.g. `GOTO_NORTH` vs
  `GOTO_NORTHEAST` sharing "north" heavily) and diversify the wording.

## 5. Use it

```bash
python -m firebot.voice_intent.infer --checkpoint checkpoints/intent_head.pt clip.wav
```

or from the backend:
```python
from firebot.voice_intent.infer import IntentClassifier
clf = IntentClassifier("checkpoints/intent_head.pt")
payload = clf.predict_intent_payload(wav_path, min_confidence=0.6)
# {"name": "GOTO", "params": {"x": 6.0, "y": 7.0}, "confidence": 0.91,
#  "source": "voice_intent", "raw_label": "GOTO_NORTH", "scores": {...}}
```
`payload["name"]`/`payload["params"]` line up with `command.intents.Intent`
so it can go through the same `validate()` call as the rules/SLM parsers —
this isn't wired into `server.py` yet, that's a separate step once you've
got a checkpoint you're happy with (natural design: try this classifier
first since it's instant and free/offline; anything below `min_confidence`,
or a coordinate-based `GOTO`, falls through to the existing Groq
transcription + regex path).

## A note on expectations

This won't beat Groq's Whisper-Large-v3-turbo on raw accuracy — that's a
much bigger model doing full transcription. What it buys you is: **zero
marginal cost, no network round-trip, and works with no internet** for
exactly the commands your robot actually accepts. Treat it as a fast local
first-pass for the common cases, with Groq+regex as the fallback for
anything it's unsure about or that's outside its 15 classes.
