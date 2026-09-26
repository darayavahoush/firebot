"""Rule-based confrontation controller (baseline). Works from the observation vector only,
so it is directly comparable with a learned policy."""
from __future__ import annotations

import numpy as np

from .env import TURRET_LIMIT, VMAX, WMAX


def _c(v, lo, hi):
    return max(lo, min(hi, v))


def _wrap(a: float) -> float:
    return float(np.arctan2(np.sin(a), np.cos(a)))


class RuleController:
    def __init__(self) -> None:
        self.state, self.t, self.lost, self.spray_lost = "EXPLORE", 0.0, 0.0, 0.0
        self.avoid = 0
        self.gas_scan, self.gas_cool = 0.0, 0.0
        self.last_v, self.stuck, self.rec, self.rdir = 0.0, 0.0, 0.0, 1

    def act(self, obs: np.ndarray, dt: float = 0.1) -> np.ndarray:
        self.t += dt
        us, fl, gas = obs[0:4] * 4, obs[4:7], obs[7]
        seen, zt, eb = obs[8] > .5, obs[9] * .5, obs[10] * np.pi
        sg, peak, tank = obs[12] * 4, obs[13] * 325 + 25, obs[14]
        meas = obs[15] * .7
        turret = obs[16] * TURRET_LIMIT
        det = bool(seen or fl.max() > .12)
        v = w = turret_cmd = 0.0
        pump = 0.0
        if self.state == "EXPLORE":
            v, w = .7, .5 * np.sin(self.t * .6)
            if det:
                self.state = "TRACK"
            elif gas > .3 and self.gas_cool <= 0 and self.gas_scan <= 0:
                self.gas_scan, self.gas_cool = 7.0, 25.0  # one slow spin, then resume search
            if self.gas_scan > 0:
                self.gas_scan -= dt
                v, w = 0.0, .9
            self.gas_cool -= dt
        if self.state == "TRACK":
            self.lost = 0.0 if det else self.lost + dt
            tgt = zt if seen and sg > 1.2 else eb
            if det or sg < 1.5:
                w = _c(tgt * 2.2, -1.6, 1.6)
                v = .1 if abs(tgt) > .7 else .7
            else:
                v, w = .1, .9
            if seen and peak > 140:
                self.state = "SPRAY"
            elif self.lost > 3:
                self.state = "EXPLORE"
        if self.state == "SPRAY":
            # Hold the chassis still and let the pan servo do the aiming: nozzle-relative
            # bearing error, not body-relative, drives both the turret rate and the pump gate.
            v, w = 0.0, 0.0
            err = _wrap(zt - turret)
            turret_cmd = _c(err * 3, -1, 1)
            pump = float(abs(err) < .2 and tank > 0)
            self.spray_lost = 0.0 if seen else self.spray_lost + dt
            if self.spray_lost > 2:
                self.state, self.lost, self.spray_lost = "TRACK", 0.0, 0.0
        else:
            turret_cmd = _c(-turret * 2, -1, 1)  # recentre when not actively aiming to spray
        if self.state != "SPRAY":
            front = min(us[0], us[1])
            if self.avoid and front > .8:
                self.avoid = 0
            if front < .6 or self.avoid:
                if not self.avoid:
                    self.avoid = 1 if us[0] + us[2] >= us[1] + us[3] else -1
                v, w = (0.0 if front < .4 else .1), 1.7 * self.avoid
            else:
                if us[2] < .35:
                    w -= .6
                if us[3] < .35:
                    w += .6
        # stuck recovery: commanded forward but wheel odometry says we are not moving
        self.stuck = self.stuck + dt if self.last_v > .05 and meas < .3 * self.last_v else 0.0
        if self.state != "SPRAY":
            if self.stuck > .3 and self.rec <= 0:
                self.rec, self.rdir, self.stuck = 2.4, -self.rdir, 0.0
            if self.rec > 0:
                self.rec -= dt
                v, w = (0.0, 1.7 * self.rdir) if self.rec > 1.4 else (.5, 0.0)
        self.last_v = v
        return np.array([v / VMAX, _c(w / WMAX, -1, 1), turret_cmd, pump], dtype=np.float32)
