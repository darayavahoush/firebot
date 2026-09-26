from itertools import pairwise

import numpy as np

from firebot.db.training import TrainingStore
from firebot.planning import CostMap, PlanningController, RRTStar, path_length
from firebot.planning.rrtstar import inflate
from firebot.planning.run import compare
from firebot.sim import FireEnv, World
from firebot.sim.world import RES


def test_inflate_grows_obstacles_by_radius():
    g = np.zeros((40, 40), dtype=bool)
    g[20, 20] = True
    out = inflate(g, 0.25)
    k = int(np.ceil(0.25 / RES))
    assert out[20, 20 + k] and out[20 - k, 20] and not out[20, 20 + k + 1]


def test_plan_routes_around_pillar_and_is_collision_free():
    w = World()
    start, goal = (2.0, 3.0), (4.5, 3.0)  # pillar at x=3..3.3 blocks the straight line
    assert not w.line_of_sight(*start, *goal)
    path = RRTStar(w, seed=1).plan(start, goal)
    assert path is not None
    assert np.allclose(path[0], start) and np.hypot(*(path[-1] - goal)) < 0.3
    cmap = CostMap(w)
    for a, b in pairwise(path):
        assert cmap.segment_free(a, b)
    assert path_length(path) >= np.hypot(2.5, 0.0)


def test_plan_is_reproducible_for_a_seed():
    w = World()
    a = RRTStar(w, seed=5).plan((1.2, 1.0), (10.5, 5.0))
    b = RRTStar(w, seed=5).plan((1.2, 1.0), (10.5, 5.0))
    assert np.allclose(a, b)


def test_plan_fails_for_goal_sealed_in_wall():
    w = World(walls=[(0, 0, 12, .1), (0, 7.9, 12, .1), (0, 0, .1, 8), (11.9, 0, .1, 8),
                     (5, 3, 2, 2)])
    assert RRTStar(w, max_iter=300, seed=0).plan((1.0, 1.0), (6.0, 4.0)) is None


def test_controller_action_shape_and_range():
    env = FireEnv()
    obs, _ = env.reset(seed=0)
    ctrl = PlanningController(env.world, seed=0)
    for _ in range(50):
        a = ctrl.act(obs, env.robot)
        assert a.shape == (4,) and 0 <= a[0] <= 1 and -1 <= a[1] <= 1
        obs, *_ = env.step(a)


def test_planning_controller_extinguishes_and_does_not_regress_vs_rule():
    from firebot.planning.run import planner_factory, rule_factory, run_episode
    env, wins_p, wins_r = FireEnv(), 0, 0
    for seed in (2, 7, 15, 29):
        wins_p += run_episode(env, planner_factory(env, seed), seed)["success"]
        wins_r += run_episode(env, rule_factory(env, seed), seed)["success"]
    assert wins_p >= 3 and wins_p >= wins_r


def test_compare_writes_both_runs(tmp_path, capsys):
    db = tmp_path / "t.db"
    compare(2, 0, str(db))
    with TrainingStore(db) as tr:
        assert {r["algo"] for r in tr.run_summary()} == {"planner", "rule"}
    assert "planner" in capsys.readouterr().out
