"""IntentClassifier must load checkpoints that lack the optional metadata keys (e.g. 'classes')
instead of dying with KeyError -- the console then logs "local voice-intent unavailable" and
silently loses the local model. Whisper itself is stubbed out; only the head/ckpt logic runs."""
import sys
import types

import pytest

torch = pytest.importorskip("torch")

from firebot.voice_intent.infer import IntentClassifier  # noqa: E402
from firebot.voice_intent.model import IntentHead  # noqa: E402
from firebot.voice_intent.vocab import CLASSES  # noqa: E402


@pytest.fixture(autouse=True)
def fake_transformers(monkeypatch):
    class _Enc(torch.nn.Module):
        pass

    class _Whisper:
        @classmethod
        def from_pretrained(cls, name):
            m = cls()
            m.encoder = _Enc()
            return m

    class _Extractor:
        @classmethod
        def from_pretrained(cls, name):
            return cls()

    mod = types.SimpleNamespace(WhisperModel=_Whisper, WhisperFeatureExtractor=_Extractor)
    monkeypatch.setitem(sys.modules, "transformers", mod)


def _state(n_out=len(CLASSES), d_model=16, hidden=8):
    return IntentHead(d_model=d_model, hidden=hidden, num_classes=n_out).state_dict()


def test_loads_checkpoint_without_classes_key(tmp_path):
    p = tmp_path / "head.pt"
    torch.save({"state_dict": _state()}, p)
    clf = IntentClassifier(p)
    assert clf.classes == CLASSES


def test_loads_full_checkpoint(tmp_path):
    p = tmp_path / "head.pt"
    torch.save({"state_dict": _state(), "d_model": 16, "hidden": 8,
                "model_name": "openai/whisper-tiny.en", "classes": CLASSES}, p)
    assert IntentClassifier(p).classes == CLASSES


def test_vocab_mismatch_without_classes_is_a_clear_error(tmp_path):
    p = tmp_path / "head.pt"
    torch.save({"state_dict": _state(n_out=len(CLASSES) + 3)}, p)
    with pytest.raises(ValueError, match="different vocabulary"):
        IntentClassifier(p)


def test_non_checkpoint_file_is_a_clear_error(tmp_path):
    p = tmp_path / "head.pt"
    torch.save({"weights": 1}, p)
    with pytest.raises(ValueError, match="state_dict"):
        IntentClassifier(p)
