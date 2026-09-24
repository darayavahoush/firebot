import numpy as np

from firebot.fusion import BearingEIF


def test_triangulates_fire_from_moving_robot():
    fire = np.array([8.0, 5.0])
    f = BearingEIF()
    rng = np.random.default_rng(0)
    for k in range(60):
        rx, ry, th = 1.0 + 0.1 * k, 1.0 + 0.05 * k, 0.3
        z = np.arctan2(fire[1] - ry, fire[0] - rx) - th + rng.normal(0, 0.03)
        f.update(rx, ry, th, z, 0.04)
    assert np.linalg.norm(f.mean - fire) < 0.5
    assert np.trace(f.cov) < 1.0
