"""Per-user head fine-tuning, on made-up embeddings (no Whisper needed)."""
import numpy as np
import pytest

torch = pytest.importorskip("torch")

from firebot.voice_intent.model import IntentHead
from firebot.voice_intent.personalize import (
    MIN_CLIPS_PER_CLASS,
    head_from_ckpt,
    personalize,
)
from firebot.voice_intent.vocab import CLASSES

D = 32


def _protos(seed=0):
    return np.random.default_rng(seed).normal(size=(len(CLASSES), D)).astype("float32") * 2


def _base_ckpt():
    """A base head that knows the classes on 'average' voices."""
    torch.manual_seed(0)
    head = IntentHead(d_model=D, hidden=32)
    protos = torch.as_tensor(_protos())
    opt = torch.optim.Adam(head.parameters(), lr=1e-2)
    y = torch.arange(len(CLASSES)).repeat(20)
    x = protos[y] + 0.3 * torch.randn(len(y), D)
    for _ in range(200):
        loss = torch.nn.functional.cross_entropy(head(x), y)
        opt.zero_grad(); loss.backward(); opt.step()
    return {"state_dict": {k: v.clone() for k, v in head.state_dict().items()},
            "classes": list(CLASSES), "hidden": 32, "d_model": D, "pooling": "valid_frames"}


def _user_clips(shift, n=5, seed=1):
    """This user's voice: every class embedding is shifted (an 'accent'), so the base head is worse."""
    rng = np.random.default_rng(seed)
    protos = _protos()
    feats, names = [], []
    for i, c in enumerate(CLASSES):
        for _ in range(n):
            feats.append(protos[i] + shift + 0.3 * rng.normal(size=D))
            names.append(c)
    return np.array(feats, dtype="float32"), names


def test_personal_head_beats_base_on_shifted_voice():
    ckpt = _base_ckpt()
    shift = np.random.default_rng(9).normal(size=D).astype("float32") * 2.5
    feats, names = _user_clips(shift)
    out, rep = personalize(ckpt, feats, names)
    assert rep["accepted"], rep
    assert rep["personal_acc"] >= rep["base_acc"]
    # the saved checkpoint is a normal, loadable head with the same classes
    head = head_from_ckpt(out)
    assert out["classes"] == list(CLASSES) and out["personalized"]["clips"] == len(names)
    x = torch.as_tensor(feats)
    y = torch.as_tensor([CLASSES.index(n) for n in names])
    assert (head(x).argmax(1) == y).float().mean() > (head_from_ckpt(ckpt)(x).argmax(1) == y).float().mean()


def test_refuses_when_classes_missing():
    ckpt = _base_ckpt()
    feats, names = _user_clips(0.0, n=MIN_CLIPS_PER_CLASS)
    keep = [i for i, n in enumerate(names) if n != "STOP"]
    out, rep = personalize(ckpt, feats[keep], [names[i] for i in keep])
    assert not rep["accepted"] and rep["missing"] == ["STOP"]
    assert out is ckpt


def test_unknown_label_rejected():
    ckpt = _base_ckpt()
    feats, names = _user_clips(0.0)
    with pytest.raises(ValueError):
        personalize(ckpt, feats, ["BOGUS"] * len(names))
