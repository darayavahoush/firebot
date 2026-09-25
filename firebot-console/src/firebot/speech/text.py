"""Spoken-text clean-up: ASR emits number *words* ("eight point five"); the command rules want
digits. Also strips Vosk's out-of-vocabulary marker. Pure functions, no audio dependencies."""
from __future__ import annotations

import re

_UNITS = {w: i for i, w in enumerate(
    ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"])}
_UNK = re.compile(r"\[unk\]|<unk>")


def spoken_to_text(text: str) -> str:
    """'go to eight point five three' -> 'go to 8.5 3'; drops [unk]; lowercases."""
    tokens = _UNK.sub(" ", text.lower()).split()
    out: list[str] = []
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t in _UNITS:
            num = str(_UNITS[t])
            if i + 2 < len(tokens) and tokens[i + 1] == "point" and tokens[i + 2] in _UNITS \
                    and _UNITS[tokens[i + 2]] < 10:
                num += "." + str(_UNITS[tokens[i + 2]])
                i += 2
            out.append(num)
        else:
            out.append(t)
        i += 1
    return " ".join(out)
