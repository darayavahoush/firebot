from itertools import pairwise

import numpy as np
import pytest

from firebot.sim.world import World


def test_random_world_is_bigger_than_default_and_varies():
    a = World.random(seed=1)
    b = World.random(seed=2)
    assert a.width > 12.0 and a.height > 8.0
    assert (a.width, a.height, a.walls) != (b.width, b.height, b.walls)


def test_random_world_perimeter_is_sealed_and_interior_reachable():
    w = World.random(seed=7)
    assert not w.is_free(0.02, w.height / 2) and not w.is_free(w.width - 0.02, w.height / 2)
    rng = np.random.default_rng(7)
    a = w.random_free_point(rng)
    b = w.random_free_point(rng)
    assert w.is_free(*a, 0.1) and w.is_free(*b, 0.1)


def test_random_world_is_reproducible_for_a_seed():
    a = World.random(seed=42)
    b = World.random(seed=42)
    assert a.width == b.width and a.height == b.height and a.walls == b.walls


def test_rrtstar_respects_random_world_bounds():
    from firebot.planning import RRTStar
    w = World.random(seed=3)
    rng = np.random.default_rng(3)
    start = w.random_free_point(rng)
    goal = w.random_free_point(rng, avoid=start, min_dist=3.0)
    path = RRTStar(w, seed=0, max_iter=4000).plan(start, goal)
    if path is not None:
        assert path[:, 0].max() <= w.width and path[:, 1].max() <= w.height


def test_ompl_planner_matches_planner_protocol():
    pytest.importorskip("ompl")
    from firebot.planning import OMPLPlanner
    w = World()  # fixed default map: pillar blocks the straight line, same as test_planning.py
    start, goal = (2.0, 3.0), (4.5, 3.0)
    path = OMPLPlanner(w, seed=0, time_limit=2.0).plan(start, goal)
    assert path is not None
    assert np.allclose(path[0], start) and np.hypot(*(path[-1] - goal)) < 0.3
    from firebot.planning import CostMap
    cmap = CostMap(w)
    for a, b in pairwise(path):
        assert cmap.segment_free(a, b)
