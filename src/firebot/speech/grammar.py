"""Restricted vocabulary for Vosk. A closed word list makes the small model far more accurate
and robust to motor noise: anything else is decoded as `[unk]` and ignored by the rules.

`EXAMPLES` doubles as documentation and as a test that grammar and parser stay in sync.
"""
from __future__ import annotations

import json

from firebot.command.parser import PLACES

COMMAND_WORDS = ["stop", "halt", "freeze", "abort", "cancel", "emergency", "hold", "on", "up", "position", "enough", "whoa", "please", "go", "to", "the", "move", "drive", "head", "navigate", "come", "back", "return", "home", "base", "dock", "charging", "put", "out", "extinguish", "douse", "suppress", "spray", "fight", "find", "search", "start", "begin", "resume", "carry", "continue", "fire", "flame", "flames", "blaze", "burning", "smoke", "it", "and", "then", "now", "status", "report", "state", "how", "much", "is", "are", "where", "you", "what", "do", "see", "any", "tank", "water", "level", "battery", "x", "y", "point", "comma", "corner", "side"]
NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]
PLACE_WORDS = sorted({w for name in PLACES for w in [name]} |
                     {"top", "bottom", "left", "right", "upper", "lower", "north", "south",
                      "east", "west", "center", "middle"})

VOCAB: list[str] = sorted(set(COMMAND_WORDS) | set(NUMBER_WORDS) | set(PLACE_WORDS))

# phrase -> expected intent name (checked in tests against RuleParser)
EXAMPLES: dict[str, str] = {
    "stop": "STOP", "emergency stop": "STOP", "halt": "STOP",
    "put out the fire": "EXTINGUISH", "find the fire": "EXTINGUISH", "start": "EXTINGUISH",
    "go to the east side": "GOTO", "go to the top right": "GOTO", "go to the center": "GOTO",
    "go to five three": "GOTO", "go to x eight point five y six": "GOTO",
    "come back home": "RETURN_HOME", "return to base": "RETURN_HOME",
    "status": "STATUS", "how much water is left": "STATUS", "where are you": "STATUS",
}


def grammar_json() -> str:
    """JSON word list for `KaldiRecognizer(model, rate, grammar)`; includes `[unk]`."""
    return json.dumps([*VOCAB, "[unk]"])
