"""Clip-level offline transcription: no Vosk model or torch needed (both are injected)."""
import numpy as np

from firebot.speech import offline


class FakeRec:
    """Emits a final only once it has heard `need_bytes` of audio followed by silence."""
    def __init__(self, words="stop", need_speech=True):
        self.words, self.fed, self.reset_calls = words, [], 0
        self.need_speech = need_speech

    def reset(self):
        self.reset_calls += 1
        self.fed = []

    def feed(self, pcm):
        self.fed.append(pcm)
        heard_speech = any(any(b) for b in self.fed[:-1])
        if self.need_speech and heard_speech and not any(pcm):
            self.need_speech = False
            return self.words, ""
        return None, "par" if heard_speech else ""


def test_float_to_pcm16_clips_and_scales():
    pcm = offline.float_to_pcm16([0.0, 1.0, -1.0, 5.0, -5.0])
    a = np.frombuffer(pcm, dtype="<i2")
    assert a.tolist() == [0, 32767, -32767, 32767, -32767]


def test_transcribe_pads_silence_so_recogniser_endpoints():
    speech = offline.float_to_pcm16(np.full(8000, 0.3))
    text = offline.transcribe_pcm(speech, FakeRec("stop"))
    assert text == "stop"


def test_transcribe_converts_spoken_numbers():
    speech = offline.float_to_pcm16(np.full(8000, 0.3))
    assert offline.transcribe_pcm(speech, FakeRec("go to eight point five")) == "go to 8.5"


def test_transcribe_falls_back_to_last_partial_when_no_final():
    speech = offline.float_to_pcm16(np.full(8000, 0.3))
    assert offline.transcribe_pcm(speech, FakeRec("x", need_speech=False)) == "par"


def test_transcribe_empty_audio_returns_empty_string():
    assert offline.transcribe_pcm(b"", FakeRec()) == ""


def test_trim_to_speech_keeps_only_gate_output():
    loud = offline.float_to_pcm16(np.full(512, 0.5))
    quiet = offline.float_to_pcm16(np.zeros(512))
    pcm = quiet * 3 + loud * 2 + quiet * 3

    def gate(chunks):
        return [c for c in chunks if any(c)]
    assert offline.trim_to_speech(pcm, gate) == loud * 2


def test_trim_never_returns_silence_when_gate_rejects_everything():
    pcm = offline.float_to_pcm16(np.full(2048, 0.5))
    assert offline.trim_to_speech(pcm, lambda chunks: []) == pcm


def test_gate_drives_transcription():
    loud = offline.float_to_pcm16(np.full(4096, 0.5))
    quiet = offline.float_to_pcm16(np.zeros(4096))
    seen = []

    def gate(chunks):
        seen.append(len(list(chunks)))
        return [c for c in chunks if any(c)]
    text = offline.transcribe_pcm(quiet + loud + quiet, FakeRec("status"), gate=gate)
    assert seen and text == "status"
