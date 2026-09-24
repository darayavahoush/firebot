import numpy as np
import pytest

from firebot.command import CommandController, Intent, Interpreter, RuleParser, SLMParser, validate
from firebot.command.run import run_script
from firebot.db.store import Store
from firebot.planning import follow_path
from firebot.sim import FireEnv

P = RuleParser()


@pytest.mark.parametrize("text,name", [
    ("Stop!", "STOP"), ("please stop spraying", "STOP"), ("EMERGENCY", "STOP"),
    ("go to the east side but stop", "STOP"),          # stop anywhere wins
    ("put out the fire", "EXTINGUISH"), ("find the fire and put it out", "EXTINGUISH"),
    ("start", "EXTINGUISH"), ("come back home", "RETURN_HOME"), ("return to base", "RETURN_HOME"),
    ("how much water is left?", "STATUS"), ("where are you", "STATUS"),
    ("dance", "UNKNOWN"), ("tell me a joke", "UNKNOWN"),
])
def test_rule_parser_intents(text, name):
    assert P.parse(text).name == name


@pytest.mark.parametrize("text,xy", [
    ("go to 5, 3", (5, 3)), ("move to x 8.5 y 6", (8.5, 6)),
    ("go to the top right", (10.5, 7.0)), ("head to the west side", (2.0, 4.0)),
    ("drive to the north east corner", (10.5, 7.0)), ("go to the center", (6.0, 4.0)),
])
def test_rule_parser_goto(text, xy):
    i = P.parse(text)
    assert i.name == "GOTO" and (i.params["x"], i.params["y"]) == xy


def test_custom_named_waypoint():
    p = RuleParser(places={"kitchen": (9.0, 2.0)})
    assert p.parse("go to the kitchen").params == {"x": 9.0, "y": 2.0}


def test_validate_rejects_bad_intents():
    assert not validate(Intent("GOTO", {"x": 50, "y": 3}))[0]           # out of world
    assert not validate(Intent("GOTO", {"x": float("nan"), "y": 3}))[0]
    assert not validate(Intent("GOTO", {"x": 3}))[0]                     # missing y
    assert not validate(Intent("STOP", {"speed": 9}))[0]                 # extra param
    assert not validate(Intent("PUMP_ON", {}))[0]                        # not in schema
    assert not validate(Intent("GOTO", {"x": "abc", "y": 1}))[0]
    assert validate(Intent("GOTO", {"x": "5", "y": 3}))[0]               # coerced


def test_out_of_range_goto_from_text_is_rejected_by_interpreter():
    intent, ok, _ = Interpreter().interpret("go to 99, 99")
    assert not ok and intent.name == "UNKNOWN"


def test_slm_output_is_untrusted():
    good = SLMParser(lambda _: 'Sure! {"intent": "GOTO", "params": {"x": 4, "y": 2}}')
    i = good.parse("mosey over yonder")
    assert i.name == "GOTO" and i.source == "slm" and i.needs_confirmation
    for bad in ("not json", '{"intent": "PUMP_ON", "params": {}}',
                '{"intent": "GOTO", "params": {"x": 400, "y": 2}}',
                '{"intent": "GOTO", "params": [1, 2]}', ""):
        assert SLMParser(lambda _, b=bad: b).parse("x").name == "UNKNOWN"

    def boom(_):
        raise RuntimeError("model crashed")
    assert SLMParser(boom).parse("x").name == "UNKNOWN"


def test_slm_only_consulted_when_rules_fail():
    calls = []
    slm = SLMParser(lambda p: calls.append(p) or '{"intent": "STATUS", "params": {}}')
    interp = Interpreter(fallback=slm)
    assert interp.interpret("stop")[0].source == "rules" and not calls
    i, ok, _ = interp.interpret("gimme the lowdown")
    assert ok and i.name == "STATUS" and i.source == "slm" and calls
    assert not i.needs_confirmation  # read-only intents never need confirmation


def test_slm_motion_requires_confirmation_before_moving():
    env = FireEnv()
    env.reset(seed=0)
    c = CommandController(env.world)
    c.pose = env.robot
    i = SLMParser(lambda _: '{"intent": "GOTO", "params": {"x": 5, "y": 3}}').parse("go yonder")
    r = c.handle(i)
    assert not r.ok and r.pending is i and c.mode == "IDLE"
    assert c.handle(r.pending, confirmed=True).ok and c.mode == "GOTO"


def test_stop_zeroes_actions_and_latches():
    env = FireEnv()
    obs, _ = env.reset(seed=1)
    c = CommandController(env.world, seed=1)
    c.pose = env.robot
    c.handle(Intent("EXTINGUISH"))
    for _ in range(20):
        obs, *_ = env.step(c.act(obs, env.robot))
    c.handle(Intent("STOP"))
    for _ in range(5):
        assert not c.act(obs, env.robot).any()


def test_goto_reaches_target_and_never_sprays():
    env = FireEnv()
    obs, _ = env.reset(seed=3)
    c = CommandController(env.world, seed=3)
    c.pose = env.robot
    assert c.handle(Intent("GOTO", {"x": 10.5, "y": 4.0})).ok
    for _ in range(900):
        a = c.act(obs, env.robot)
        assert a[2] == 0.0
        obs, *_ = env.step(a)
        if c.mode == "IDLE":
            break
    assert c.arrived and np.hypot(*(env.robot[:2] - [10.5, 4.0])) < 0.5


def test_goto_unreachable_reports_no_route():
    from firebot.sim import World
    w = World(walls=[(0, 0, 12, .1), (0, 7.9, 12, .1), (0, 0, .1, 8), (11.9, 0, .1, 8),
                     (5, 3, 2, 2)])  # solid block; its centre is unreachable
    c = CommandController(w)
    c.pose = np.array([1.2, 1.0, 0.0])
    r = c.handle(Intent("GOTO", {"x": 6.0, "y": 4.0}))
    assert not r.ok and "No safe route" in r.message and c.mode == "IDLE"


def test_follow_path_regression_no_spinning_past_first_vertex():
    path = np.array([[1.0, 1.0], [8.0, 1.0]])
    a = follow_path(path, np.array([3.0, 1.0, 0.0]))  # already 2 m along, facing the goal
    assert a is not None and a[0] > 0.5 and abs(a[1]) < 0.1
    assert follow_path(path, np.array([7.9, 1.0, 0.0])) is None  # arrived


def test_script_logs_commands_and_actions(tmp_path):
    db = tmp_path / "ops.db"
    out = run_script(["status", "go to the center", "blah blah", "stop"], 0, 50, str(db))
    assert any("Heading to" in line for line in out) and any("didn't understand" in line
                                                             for line in out)
    with Store(db) as s:
        rows = s.conn.execute("SELECT transcript, validated, action_id FROM voice_commands"
                              " ORDER BY id").fetchall()
        assert [r["transcript"] for r in rows] == ["status", "go to the center", "blah blah", "stop"]
        assert [r["validated"] for r in rows] == [1, 1, 0, 1]
        assert rows[2]["action_id"] is None and rows[1]["action_id"] is not None
        cmds = [r[0] for r in s.conn.execute("SELECT command FROM actions ORDER BY id")]
        assert cmds == ["STATUS", "GOTO", "STOP"]
