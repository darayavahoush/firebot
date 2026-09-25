"""Intent parsers. `RuleParser` is deterministic and always tried first; `SLMParser` is an
optional fallback that wraps any local small language model (llama.cpp, Ollama, ...) as a plain
`generate(prompt) -> str` callable. Both return `Intent`s that are validated identically.
"""
from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Protocol

from .intents import SAFE_WITHOUT_CONFIRMATION, SCHEMA, Intent, validate

# World frame: origin bottom-left, +x east, +y north. Override by passing `places=`.
HOME = (1.2, 1.0)
PLACES: dict[str, tuple[float, float]] = {
    "home": HOME, "base": HOME, "dock": HOME,
    "center": (6.0, 4.0), "middle": (6.0, 4.0),
    "north": (6.0, 7.0), "south": (6.0, 1.0), "east": (10.5, 4.0), "west": (2.0, 4.0),
    "northeast": (10.5, 7.0), "northwest": (1.5, 7.0),
    "southeast": (10.5, 1.0), "southwest": (1.5, 1.2),
}
_ALIASES = {"top": "north", "bottom": "south", "right": "east", "left": "west",
            "upper": "north", "lower": "south"}

# Any of these anywhere in the utterance means STOP. Deliberately over-eager: a false stop
# costs a repeat command, a missed stop costs a robot. ("don't stop" also stops.)
_STOP = re.compile(r"\b(stop|halt|freeze|abort|cancel|emergency|e-?stop|hold (on|up|position)|"
                   r"shut ?(it )?(off|down)|kill (it|the pump)|enough|whoa)\b")
_STATUS = re.compile(r"\b(status|report|state|how (much|is|are)|where are you|what do you see|"
                     r"any (fire|flame)|tank|water level|battery|what'?s (going on|happening))\b")
_HOME = re.compile(r"\b(go|come|head|return|get|move|drive)?\s*(back )?(to )?"
                   r"\b(home|base|dock|charging)\b|\bcome back\b|\breturn\b")
_GOTO = re.compile(r"\b(go|move|drive|head|navigate|travel|drive|proceed|come|position)\b")
_FIRE = re.compile(r"\b(fire|flame|flames|blaze|burning|smoke)\b")
_EXT = re.compile(r"\b(put out|extinguish|douse|suppress|spray|fight|find|search|start|begin|"
                  r"resume|carry on|continue|auto|autonomous|patrol|explore|deal with|handle)\b")
_NUM = r"(-?\d+(?:\.\d+)?)"
_COORD = re.compile(rf"\bx\s*[=:]?\s*{_NUM}[\s,;and]*y\s*[=:]?\s*{_NUM}|"
                    rf"\(?\s*{_NUM}\s*(?:,|\s)\s*{_NUM}\s*\)?")


def mentions_stop(text: str) -> bool:
    """True if `text` contains a stop word. Used by the speech backstop on partial results."""
    return bool(_STOP.search(normalise(text)))


def normalise(text: str) -> str:
    t = text.lower().strip()
    t = re.sub(r"[^\w\s.,()=:;-]", " ", t)
    return re.sub(r"\s+", " ", t)


class Parser(Protocol):
    def parse(self, text: str) -> Intent: ...


class RuleParser:
    def __init__(self, places: dict[str, tuple[float, float]] | None = None) -> None:
        self.places = dict(PLACES if places is None else places)

    def _place(self, t: str) -> tuple[float, float] | None:
        words = [_ALIASES.get(w, w) for w in re.findall(r"[a-z]+", t)]
        for name in self.places:  # exact named waypoint first ("kitchen", "home", ...)
            if name in words and name not in ("north", "south", "east", "west"):
                return self.places[name]
        # compass combos: "top right" / "north east" / "northeast" -> corner
        ns = next((w for w in words if w in ("north", "south")), "")
        ew = next((w for w in words if w in ("east", "west")), "")
        key = ns + ew
        if key in self.places:
            return self.places[key]
        return self.places.get(ns or ew or "")

    def parse(self, text: str) -> Intent:
        t = normalise(text)
        mk = lambda name, **p: Intent(name, p, 1.0, "rules", t)
        if _STOP.search(t):
            return mk("STOP")
        m = _COORD.search(t) if _GOTO.search(t) or "x" in t else None
        if m:
            g = [v for v in m.groups() if v is not None]
            return mk("GOTO", x=float(g[0]), y=float(g[1]))
        if _STATUS.search(t) and not _EXT.search(t):
            return mk("STATUS")
        if _HOME.search(t):
            return mk("RETURN_HOME")
        if _GOTO.search(t) and not _FIRE.search(t):
            xy = self._place(t)
            if xy:
                return mk("GOTO", x=xy[0], y=xy[1])
        if _EXT.search(t) or _FIRE.search(t):
            return mk("EXTINGUISH")
        if _STATUS.search(t):
            return mk("STATUS")
        return Intent("UNKNOWN", {}, 0.0, "rules", t)


SLM_PROMPT = """You convert a firefighting-robot operator's message into ONE JSON object.
Allowed intents and params:
{schema}
Reply with JSON only, no prose: {{"intent": "<NAME>", "params": {{...}}}}
If the message is not a robot command, use {{"intent": "UNKNOWN", "params": {{}}}}.
World is 12 m (x, east) by 8 m (y, north).
Message: {text}
JSON:"""


class SLMParser:
    """Wraps a local small model. Output is untrusted: parsed as JSON, then validated."""

    def __init__(self, generate: Callable[[str], str], confidence: float = 0.7) -> None:
        self.generate, self.confidence = generate, confidence

    def parse(self, text: str) -> Intent:
        t = normalise(text)
        # MANUAL is console-joystick-only (see executor.update_manual()) -- never offer it as
        # something a spoken/typed utterance can produce.
        schema = "\n".join(f"- {n}: {{{', '.join(p)}}}" for n, p in SCHEMA.items()
                          if n not in ("UNKNOWN", "MANUAL"))
        try:
            raw = self.generate(SLM_PROMPT.format(schema=schema, text=t))
            blob = re.search(r"\{.*\}", raw, re.DOTALL)
            data = json.loads(blob.group(0)) if blob else {}
            name, params = str(data.get("intent", "UNKNOWN")).upper(), data.get("params") or {}
            if not isinstance(params, dict):
                raise TypeError("params must be an object")
        except Exception:  # noqa: BLE001 -- any model/JSON failure degrades to UNKNOWN
            return Intent("UNKNOWN", {}, 0.0, "slm", t)
        intent = Intent(name, dict(params), self.confidence, "slm", t,
                        needs_confirmation=name not in SAFE_WITHOUT_CONFIRMATION)
        ok, _ = validate(intent)
        return intent if ok else Intent("UNKNOWN", {}, 0.0, "slm", t)


class Interpreter:
    """Rules first; the SLM (if any) only sees utterances the rules did not understand."""

    def __init__(self, rules: Parser | None = None, fallback: Parser | None = None) -> None:
        self.rules, self.fallback = rules or RuleParser(), fallback

    def interpret(self, text: str) -> tuple[Intent, bool, str]:
        intent = self.rules.parse(text)
        if intent.name == "UNKNOWN" and self.fallback is not None:
            intent = self.fallback.parse(text)
        if intent.name == "MANUAL":
            # Defense in depth: MANUAL must only ever reach the executor via
            # CommandController.update_manual(), never through a parsed utterance -- no
            # parser should produce it, but a hallucinating SLM is exactly the case this
            # guards against, so text/voice can never bypass the confirmation gate this way.
            return Intent("UNKNOWN", {}, 0.0, intent.source, intent.text), False, \
                "MANUAL is not a voice/text command"
        ok, reason = validate(intent)
        if not ok:
            return Intent("UNKNOWN", {}, 0.0, intent.source, intent.text), False, reason
        return intent, True, reason
