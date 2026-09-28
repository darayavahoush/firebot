from firebot.db.summary import narrate, summarize_run


def _run(pump=True):
    frames = []
    for i in range(101):
        t = i * 0.1
        pumping = pump and 4.0 <= t <= 8.0
        frames.append({"t": t, "x": t * 0.5, "y": 0.0, "tank": 1.0 - (max(0.0, min(t, 8.0) - 4.0) * 0.05 if pump else 0.0),
                       "cmd_pump": pumping, "mode": "AUTO" if t < 6 else "IDLE",
                       "sensors": {"flame_left": 0.6 if t >= 3.0 else 0.0, "us_left": 1.0}})
    return frames


def test_facts_from_run():
    s = summarize_run(_run(), [{"valid": True}, {"valid": False}], [])
    f = s["facts"]
    assert f["duration_s"] == 10.0 and f["distance_m"] == 5.0
    assert f["first_fire_cue_s"] == 3.0 and f["pump_activations"] == 1 and f["pump_on_s"] == 4.0
    assert f["water_used_pct"] == 20 and f["rejected_commands"] == 1
    assert f["modes"] == ["AUTO", "IDLE"]
    assert "never" not in s["text"].lower().split("pump")[0]
    assert "extinguished" not in s["text"]


def test_no_pump_no_fire_run():
    frames = [{"t": i * 0.1, "x": 0.0, "y": 0.0, "tank": 1.0, "cmd_pump": False,
               "sensors": {"flame_left": 0.0}} for i in range(20)]
    text = summarize_run(frames, [], [])["text"]
    assert "never registered a fire" in text and "never activated" in text
    assert "No telemetry anomalies" in text


def test_empty_run():
    assert summarize_run([], [], [])["facts"] == {}


def test_anomalies_appear_in_text():
    an = [{"severity": "critical", "message": "pump or hose fault"},
          {"severity": "info", "message": "x jumped"}]
    s = summarize_run(_run(), [], an)
    assert s["facts"]["critical_anomalies"] == 1 and "pump or hose fault" in s["text"]


def test_narrate_accepts_faithful_rewrite():
    s = summarize_run(_run(), [], [])
    assert narrate(s, lambda p: "The robot drove 5 m over 10 s.") == "The robot drove 5 m over 10 s."


def test_narrate_rejects_invented_numbers():
    s = summarize_run(_run(), [], [])
    assert narrate(s, lambda p: "The robot drove 99 m.") == s["text"]


def test_narrate_falls_back_on_error_or_empty():
    s = summarize_run(_run(), [], [])

    def boom(p):
        raise TimeoutError
    assert narrate(s, boom) == s["text"] and narrate(s, lambda p: "  ") == s["text"]
