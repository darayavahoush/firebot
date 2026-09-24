import numpy as np

from firebot.sim import FireEnv, RuleController, World
from firebot.sim.sensors import thermal_bearing


def test_ray_and_occupancy():
    w = World()
    assert abs(w.ray(1.0, 1.0, np.pi, 4.0) - 0.9) < 0.1  # left boundary wall at x=0.1
    assert not w.is_free(0.05, 4.0) and w.is_free(6.0, 1.0)
    assert not w.line_of_sight(2.0, 3.0, 4.5, 3.0)  # blocked by the pillar at x=3


def test_env_is_deterministic_and_obs_shape():
    a, b = FireEnv(), FireEnv()
    oa, _ = a.reset(seed=3)
    ob, _ = b.reset(seed=3)
    assert oa.shape == (FireEnv.obs_dim,) and np.allclose(oa, ob)
    for _ in range(20):
        ra = a.step([.5, .2, 0])
        rb = b.step([.5, .2, 0])
    assert np.allclose(ra[0], rb[0]) and ra[1] == rb[1]


def test_thermal_bearing_matches_truth():
    env = FireEnv()
    for seed in range(20):
        env.reset(seed=seed)
        tr = env.last["_truth"]
        zt = thermal_bearing(env.last["thermal"])
        if zt is not None:
            assert abs(zt - tr["bearing"]) < 0.08
            return
    raise AssertionError("fire never visible in 20 seeds")


def test_baseline_beats_random_and_mostly_succeeds():
    wins = 0
    for seed in range(8):
        env = FireEnv()
        obs, _ = env.reset(seed=seed)
        c = RuleController()
        while True:
            obs, _, te, tr, _ = env.step(c.act(obs))
            if te or tr:
                break
        wins += te
    assert wins >= 6
