from firebot.voice_intent.legacy import LEGACY_TO_CLASS, map_scores
from firebot.voice_intent.vocab import CLASSES, canonical_phrase
from firebot.command.parser import RuleParser


def test_every_mapped_label_is_a_real_class():
    for cls in LEGACY_TO_CLASS.values():
        assert cls == "UNKNOWN" or cls in CLASSES


def test_mapped_phrases_parse_to_expected_intents():
    p = RuleParser()
    assert p.parse(canonical_phrase("STOP")).name == "STOP"
    assert p.parse(canonical_phrase(LEGACY_TO_CLASS["go_home"])).name == "RETURN_HOME"
    assert p.parse(canonical_phrase(LEGACY_TO_CLASS["go_left"])).name == "GOTO"


def test_map_scores_sums_and_drops_unmapped():
    out = map_scores({"stop": 0.6, "forward": 0.3, "mystery": 0.1})
    assert out == {"STOP": 0.6, "GOTO_NORTH": 0.3}
