import numpy as np

from firebot.sensing import HFOV, HOT_C, THERM_COLS, THERM_ROWS, thermal_bearing, thermal_blobs


def _frame(*spots, ambient=25.0):
    f = np.full((THERM_ROWS, THERM_COLS), ambient)
    for r, c, temp in spots:
        f[r, c] = temp
    return f


def _old_bearing(frame):
    """The pre-segmentation formula, kept here as the regression oracle."""
    if float(frame.max()) < HOT_C:
        return None
    w = np.clip(frame - (HOT_C - 5), 0, None)
    col = float((w.sum(axis=0) * np.arange(frame.shape[1])).sum() / w.sum())
    return (15.5 - col) * HFOV / THERM_COLS


def test_no_fire_returns_none():
    assert thermal_bearing(_frame()) is None
    assert thermal_blobs(_frame()) == []


def test_single_source_matches_old_formula():
    f = _frame((10, 8, 300.0), (10, 9, 120.0), (11, 8, 90.0))
    assert abs(thermal_bearing(f) - _old_bearing(f)) < 1e-9


def test_two_sources_bearing_follows_the_stronger_one():
    fire, heater = (12, 4, 400.0), (12, 27, 250.0)
    f = _frame(fire, heater)
    b = thermal_bearing(f)
    assert abs(b - (15.5 - 4) * HFOV / THERM_COLS) < 1e-9       # aims at the fire
    assert abs(_old_bearing(f) - b) > 0.1                       # old code was dragged off


def test_blobs_sorted_by_strength_and_counted():
    f = _frame((5, 5, 500.0), (5, 6, 200.0), (20, 25, 80.0))
    blobs = thermal_blobs(f)
    assert len(blobs) == 2 and blobs[0]["strength"] > blobs[1]["strength"]
    assert blobs[0]["area"] == 2 and blobs[0]["peak"] == 500.0


def test_warm_but_not_hot_region_is_not_a_candidate():
    f = _frame((3, 3, 42.0), (3, 4, 43.0))       # warm, peak below HOT_C
    assert thermal_blobs(f) == [] and thermal_bearing(f) is None


def test_diagonal_pixels_join_one_blob():
    f = _frame((4, 4, 200.0), (5, 5, 150.0), (6, 6, 120.0))
    assert len(thermal_blobs(f)) == 1
