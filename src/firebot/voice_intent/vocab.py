"""Fixed label set + phrasing templates for the offline voice-intent classifier.

This is a *closed-set* companion to `firebot.command.parser.RuleParser`, not a
replacement for it. It only ever predicts one of the classes in `CLASSES` below.
Anything genuinely open-ended -- most importantly `GOTO x=.. y=..` with raw
coordinates -- is out of scope on purpose and stays on the existing
Groq-transcription + regex-parser path. See README.md for why.

`CLASSES[i]` <-> label index `i` everywhere in this package (dataset, model
output, checkpoints). Keep this list append-only once you've trained a model
on it, or old checkpoints' label indices will silently mean the wrong thing.
"""
from __future__ import annotations

from dataclasses import dataclass

# Must match firebot.command.parser.PLACES exactly (name -> world (x, y)).
# home/base/dock share one point; center/middle share one point -- collapsed
# here to their canonical place id.
PLACES: dict[str, tuple[float, float]] = {
    "home": (1.2, 1.0),
    "center": (6.0, 4.0),
    "north": (6.0, 7.0),
    "south": (6.0, 1.0),
    "east": (10.5, 4.0),
    "west": (2.0, 4.0),
    "northeast": (10.5, 7.0),
    "northwest": (1.5, 7.0),
    "southeast": (10.5, 1.0),
    "southwest": (1.5, 1.2),
}

# Non-place commands.
_SIMPLE = ["STOP", "EXTINGUISH", "RETURN_HOME", "STATUS", "UNKNOWN"]

CLASSES: list[str] = _SIMPLE + [f"GOTO_{p.upper()}" for p in PLACES]
LABEL_TO_IDX = {name: i for i, name in enumerate(CLASSES)}
IDX_TO_LABEL = {i: name for i, name in enumerate(CLASSES)}
NUM_CLASSES = len(CLASSES)


def goto_target(label: str) -> tuple[float, float] | None:
    """`GOTO_NORTH` -> (6.0, 7.0). None for non-GOTO labels."""
    if not label.startswith("GOTO_"):
        return None
    return PLACES[label[len("GOTO_"):].lower()]


# One canonical, unambiguous phrase per non-UNKNOWN class -- chosen to parse the same way
# under both this classifier and `firebot.command.parser.RuleParser` (see build_phrase_table's
# docstring: the two are meant to agree). Used to hand the classifier's *label* back to
# callers (like the console backend's /api/transcribe) that only know how to consume text,
# without exposing CLASSES' internal naming (`GOTO_NORTHEAST`, etc.) to them.
_CANONICAL_PHRASES: dict[str, str] = {
    "STOP": "stop",
    "EXTINGUISH": "put out the fire",
    "RETURN_HOME": "return home",
    "STATUS": "status report",
}


def canonical_phrase(label: str) -> str:
    """`label` (any `CLASSES` entry) -> a natural-language phrase parsing back to it under
    `RuleParser`. Raises `KeyError` for `UNKNOWN` or any label outside `CLASSES` -- callers
    should already be branching on `UNKNOWN`/low confidence before reaching here (see
    `IntentClassifier.predict_intent_payload`), so treat that as a bug, not a fallback path.
    """
    if label not in LABEL_TO_IDX:
        raise KeyError(f"{label!r} is not a known class")
    if label in _CANONICAL_PHRASES:
        return _CANONICAL_PHRASES[label]
    target = goto_target(label)
    if target is not None:
        return f"go to {label[len('GOTO_'):].lower()}"
    raise KeyError(f"no canonical phrase defined for {label!r}")


# --------------------------------------------------------------------------
# Phrasing templates, grouped by class. These mirror the synonym groups the
# regex parser already uses (see parser.py's _STOP/_STATUS/_HOME/_GOTO/_EXT)
# so the classifier and the rule parser agree on what these words mean --
# but templates are for *generating* natural utterances, so they're written
# out as phrases rather than reused as regex fragments.
# --------------------------------------------------------------------------

STOP_PHRASES = [
    "stop", "stop now", "stop right there", "halt", "freeze", "abort",
    "abort mission", "cancel that", "cancel", "emergency stop", "e-stop",
    "hold on", "hold position", "hold up", "shut it off", "shut down",
    "shut it down", "kill it", "kill the pump", "cut it", "cut the pump",
    "cease", "belay that", "stand down", "that's enough", "enough", "whoa",
    "whoa stop", "please stop", "stop moving", "stop the robot",
]

STATUS_PHRASES = [
    "status", "status report", "give me a status report", "report",
    "give me a report", "state", "what's your state", "how much water",
    "how's the tank", "how are you doing", "where are you",
    "where are you right now", "what do you see", "any fire", "any flames",
    "tank level", "water level", "check the water level", "battery",
    "battery level", "what's going on", "what's happening",
    "give me a sitrep", "sitrep", "give me an update", "check in",
    "status check",
]

RETURN_HOME_PHRASES = [
    "go home", "come home", "head home", "return home", "get home",
    "move home", "drive home", "go back to base", "go back to dock",
    "return to base", "return to dock", "head back to base",
    "come back to base", "back to base", "back to home", "come back",
    "return", "retreat", "pull back", "fall back", "go to the charging dock",
    "head to the charging station", "return to charging",
]

EXTINGUISH_PHRASES = [
    "put out the fire", "extinguish the fire", "extinguish it",
    "douse the fire", "suppress the fire", "spray the fire",
    "fight the fire", "find the fire", "search for the fire",
    "start searching for the fire", "begin the search", "resume searching",
    "carry on searching", "continue the search", "go autonomous",
    "autonomous mode", "start patrol", "patrol", "explore the area",
    "deal with the fire", "handle the fire", "attack the fire",
    "knock it down", "knock down the fire", "tackle the fire",
    "there's a fire", "there's smoke", "I see flames", "put the fire out",
    "go put out the fire", "go find the fire",
]

UNKNOWN_PHRASES = [
    "what's the weather like", "tell me a joke", "how old are you",
    "what time is it", "play some music", "order a pizza",
    "what's your name", "who made you", "can you hear me",
    "testing testing", "hello", "good morning", "thanks",
    "that's great", "nice work", "okay cool", "um so anyway",
    "I was just wondering", "never mind",
]

# Verb phrases used to build "go to <place>" style utterances.
_GOTO_VERBS = [
    "go to", "move to", "drive to", "head to", "navigate to", "head over to",
    "proceed to", "advance to", "roll to", "get to",
]
_GOTO_VERBS_NOTO = ["go", "move", "drive", "head", "navigate", "proceed"]

# Natural ways to say each place, beyond the raw name (compass synonyms and
# corner phrasings mirror parser.py's _ALIASES / compass-combination logic).
_PLACE_ALIASES: dict[str, list[str]] = {
    "home": ["home", "base", "the dock", "the base station"],
    "center": ["the center", "the middle", "the centre", "the middle of the room"],
    "north": ["north", "the top", "up north", "the north side", "the far end"],
    "south": ["south", "the bottom", "down south", "the south side"],
    "east": ["east", "the right side", "the east side"],
    "west": ["west", "the left side", "the west side"],
    "northeast": ["northeast", "the top right", "the upper right corner",
                  "the northeast corner"],
    "northwest": ["northwest", "the top left", "the upper left corner",
                  "the northwest corner"],
    "southeast": ["southeast", "the bottom right", "the lower right corner",
                  "the southeast corner"],
    "southwest": ["southwest", "the bottom left", "the lower left corner",
                  "the southwest corner"],
}


def build_phrase_table() -> dict[str, list[str]]:
    """label -> list of candidate utterances. Deterministic order/content."""
    table: dict[str, list[str]] = {
        "STOP": STOP_PHRASES,
        "EXTINGUISH": EXTINGUISH_PHRASES,
        "RETURN_HOME": RETURN_HOME_PHRASES,
        "STATUS": STATUS_PHRASES,
        "UNKNOWN": UNKNOWN_PHRASES,
    }
    for place in PLACES:
        phrases: list[str] = []
        for alias in _PLACE_ALIASES[place]:
            for verb in _GOTO_VERBS:
                phrases.append(f"{verb} {alias}")
            for verb in _GOTO_VERBS_NOTO:
                phrases.append(f"{verb} {alias}")
        table[f"GOTO_{place.upper()}"] = sorted(set(phrases))
    return table


@dataclass(frozen=True)
class VocabStats:
    num_classes: int
    phrases_per_class: dict[str, int]


def stats() -> VocabStats:
    table = build_phrase_table()
    return VocabStats(NUM_CLASSES, {k: len(v) for k, v in table.items()})


if __name__ == "__main__":
    s = stats()
    print(f"{s.num_classes} classes")
    for name, n in s.phrases_per_class.items():
        print(f"  {name:16s} {n} template phrases")
