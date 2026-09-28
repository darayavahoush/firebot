"""Tests for firebot.voice_intent.synth_data's voice filtering, voice health-check
probe, and per-attempt temp-file naming. No real pyttsx3/TTS engine, librosa, or
soundfile needed -- everything below the filter/probe/tmp-naming logic is faked.
"""
from __future__ import annotations

from firebot.voice_intent import synth_data


class FakeVoice:
    def __init__(self, id_, languages=None):
        self.id = id_
        self.languages = languages or []


class FakeEngine:
    """Records every save_to_file call; setProperty/runAndWait/stop are no-ops
    (stop() just flips a flag so tests can check it was called)."""

    def __init__(self):
        self.calls: list[tuple[str, str]] = []  # (voice id at call time, tmp path)
        self._voice = None
        self.stopped = False

    def setProperty(self, name, value):
        if name == "voice":
            self._voice = value

    def save_to_file(self, text, path):
        self.calls.append((self._voice, path))

    def runAndWait(self):
        pass

    def stop(self):
        self.stopped = True


# ---------------------------------------------------------------------------
# _voice_lang_matches
# ---------------------------------------------------------------------------

def test_locale_segment_beats_family_name_substring():
    """'eloquence' contains 'en' -- a non-English Eloquence voice must not
    match the 'en' filter just because of that coincidence."""
    german_eloquence = FakeVoice("com.apple.eloquence.de-DE.Sandy")
    assert not synth_data._voice_lang_matches(german_eloquence, "en")


def test_locale_segment_matches_real_english_locale():
    us_eloquence = FakeVoice("com.apple.eloquence.en-US.Sandy")
    assert synth_data._voice_lang_matches(us_eloquence, "en")


def test_voice_name_substring_does_not_leak_through():
    """The voice *name* 'Ellen' also contains 'en'; a Dutch voice named Ellen
    must not match the 'en' filter either."""
    dutch_ellen = FakeVoice("com.apple.voice.compact.nl-BE.Ellen")
    assert not synth_data._voice_lang_matches(dutch_ellen, "en")


def test_languages_attribute_takes_priority():
    voice = FakeVoice("some.opaque.id.Alex", languages=[b"en_US"])
    assert synth_data._voice_lang_matches(voice, "en")


def test_falls_back_to_substring_when_no_locale_info_at_all():
    """espeak-style ids with no dash-locale segment and no `languages`: keep
    the old best-effort substring behaviour rather than excluding everything."""
    espeak_voice = FakeVoice("english-us")
    assert synth_data._voice_lang_matches(espeak_voice, "en")
    non_match = FakeVoice("german")
    assert not synth_data._voice_lang_matches(non_match, "en")


# ---------------------------------------------------------------------------
# _probe_voices
# ---------------------------------------------------------------------------

def test_probe_voices_drops_broken_voice_without_raising(monkeypatch, tmp_path):
    good = FakeVoice("com.apple.voice.en-US.Good")
    broken = FakeVoice("com.apple.eloquence.en-US.Broken")

    def fake_synthesize(voice_id, rate, text, out_wav):
        if voice_id == broken.id:
            raise synth_data.EmptyAudioError("boom")

    monkeypatch.setattr(synth_data, "_synthesize", fake_synthesize)

    survivors = synth_data._probe_voices([good, broken], tmp_path, test_phrases=["hi"])

    assert survivors == [good]
    # the scratch file used for probing shouldn't be left behind
    assert not (tmp_path / ".voice_probe.wav").exists()


def test_probe_voices_all_broken_returns_empty(monkeypatch, tmp_path):
    def always_fails(voice_id, rate, text, out_wav):
        raise RuntimeError("no audio backend")

    monkeypatch.setattr(synth_data, "_synthesize", always_fails)
    voice = FakeVoice("com.apple.eloquence.en-US.Broken")

    assert synth_data._probe_voices([voice], tmp_path, test_phrases=["hi"]) == []


def test_probe_voices_catches_a_voice_that_only_fails_on_a_later_phrase(monkeypatch, tmp_path):
    """Regression test: a voice that renders a trivial phrase fine but fails
    on realistic vocabulary phrases (this is what 'Albert' actually did --
    passed a one-word-style probe, then failed on every real GOTO phrase) must
    still get dropped. A probe that only ever tries one easy phrase can't see
    this; it needs more than one, including something longer/less trivial.
    """
    sometimes_broken = FakeVoice("com.apple.speech.synthesis.voice.Sometimes")

    def fake_synthesize(voice_id, rate, text, out_wav):
        if text == "a longer, more realistic phrase":
            raise synth_data.EmptyAudioError("decoded to zero samples")

    monkeypatch.setattr(synth_data, "_synthesize", fake_synthesize)

    survivors = synth_data._probe_voices(
        [sometimes_broken], tmp_path,
        test_phrases=["hi", "a longer, more realistic phrase"],
    )

    assert survivors == []


# ---------------------------------------------------------------------------
# _synthesize's temp filename, per-call engine, and empty-audio retry
# ---------------------------------------------------------------------------

def test_synthesize_temp_names_dont_collide_across_repeated_failures(monkeypatch, tmp_path):
    """Regression test: `out_wav` reuses the same clip index across every failed
    attempt for a class (the caller only advances the index on success), so a
    temp filename derived from `out_wav` collided on every retry -- which is
    why the same '00000_tts.raw.wav' showed up in warnings for entirely
    different phrases. The temp name must be attempt-unique instead.
    """
    engines_created: list[FakeEngine] = []

    def factory():
        e = FakeEngine()
        engines_created.append(e)
        return e

    monkeypatch.setattr(synth_data, "_resample_to_target", lambda src, dst: None)

    out_wav = tmp_path / "00000_tts.wav"  # same path both calls, like a stuck clip_idx
    synth_data._synthesize("voice-a", 175, "hello", out_wav, engine_factory=factory)
    synth_data._synthesize("voice-b", 175, "hello again", out_wav, engine_factory=factory)

    tmp_paths_used = [path for e in engines_created for _voice, path in e.calls]
    assert len(set(tmp_paths_used)) == 2, (
        f"expected two distinct temp files, got {tmp_paths_used}"
    )


def test_synthesize_uses_a_fresh_engine_per_call(monkeypatch, tmp_path):
    """Each attempt (including retries) should get its own engine instance,
    and every engine created should be stopped -- resource hygiene matters
    here since this script has already once run a process out of file
    descriptors."""
    engines_created: list[FakeEngine] = []

    def factory():
        e = FakeEngine()
        engines_created.append(e)
        return e

    monkeypatch.setattr(synth_data, "_resample_to_target", lambda src, dst: None)

    out_wav = tmp_path / "00000_tts.wav"
    synth_data._synthesize("voice-a", 175, "hello", out_wav, engine_factory=factory)
    synth_data._synthesize("voice-a", 175, "hello again", out_wav, engine_factory=factory)

    assert len(engines_created) == 2
    assert engines_created[0] is not engines_created[1]
    assert all(e.stopped for e in engines_created), "every engine should be stopped after use"


def test_synthesize_retries_on_empty_audio_and_recovers(monkeypatch, tmp_path):
    """A zero-sample result gets a couple of retries (each with a fresh
    engine) before being treated as a real failure -- covers pyttsx3's
    documented macOS race where runAndWait() can return before the file is
    actually flushed."""
    attempts = {"n": 0}

    def flaky_resample(src, dst):
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise synth_data.EmptyAudioError("decoded to zero samples")
        dst.write_bytes(b"ok")

    monkeypatch.setattr(synth_data, "_resample_to_target", flaky_resample)

    out_wav = tmp_path / "clip.wav"
    synth_data._synthesize("voice-a", 175, "hello", out_wav,
                            engine_factory=FakeEngine, retry_delay=0)

    assert attempts["n"] == 3
    assert out_wav.read_bytes() == b"ok"


def test_synthesize_gives_up_after_max_attempts(monkeypatch, tmp_path):
    def always_empty(src, dst):
        raise synth_data.EmptyAudioError("decoded to zero samples")

    monkeypatch.setattr(synth_data, "_resample_to_target", always_empty)

    out_wav = tmp_path / "clip.wav"
    try:
        synth_data._synthesize("voice-a", 175, "hello", out_wav,
                                engine_factory=FakeEngine, retry_delay=0, max_attempts=3)
        assert False, "expected EmptyAudioError to propagate after exhausting retries"
    except synth_data.EmptyAudioError:
        pass
