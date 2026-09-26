import numpy as np

from firebot.sim import FireEnv, RuleController, World
from firebot.sim.env import clamp_min_fire_dist
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
        ra = a.step([.5, .2, 0, 0])
        rb = b.step([.5, .2, 0, 0])
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


def test_world_factory_rebuilds_every_episode():
    seen_widths = set()

    def factory(rng):
        w = float(rng.uniform(6.0, 20.0))
        seen_widths.add(w)
        return World(walls=[(0, 0, w, .1), (0, 7.9, w, .1), (0, 0, .1, 8), (w - .1, 0, .1, 8)],
                     width=w, height=8.0)

    env = FireEnv(world_factory=factory, min_fire_dist=2.0)  # factory() runs once here too
    widths_after_reset = []
    for seed in range(4):
        env.reset(seed=seed)
        widths_after_reset.append(env.world.width)
    assert len(set(widths_after_reset)) == 4  # a fresh map on every reset(), not reused


def test_min_fire_dist_clamp_is_always_satisfiable():
    # A tiny room: [1, width-1] x [1, height-1] is a near-degenerate sliver, so any
    # naive (unclamped, or per-axis-clamped) min_fire_dist can still exceed the box's
    # reachable diagonal and spin `random_free_point` forever.
    tiny = World(walls=[(0, 0, 2.2, .1), (0, 2.1, 2.2, .1), (0, 0, .1, 2.2),
                        (2.1, 0, .1, 2.2)], width=2.2, height=2.2)
    env = FireEnv(world=tiny, min_fire_dist=999.0)
    obs, _ = env.reset(seed=0)  # must return promptly, not hang
    assert obs.shape == (FireEnv.obs_dim,)


def test_clamp_min_fire_dist_floors_at_zero_for_degenerate_box():
    degenerate = World(width=1.5, height=1.5)  # width/height <= 2 -> empty sampling box
    assert clamp_min_fire_dist(degenerate, 10.0) == 0.0


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
