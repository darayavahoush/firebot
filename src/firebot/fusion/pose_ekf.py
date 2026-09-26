"""Extended Kalman Filter for robot pose (x, y, theta) from differential-drive odometry,
optionally corrected by an absolute heading measurement (compass/IMU yaw).

Why this exists: `Perception.update` and `PlanningController.act` both take `pose` as given --
correct in sim (ground truth from `World`), but on real hardware nothing turns raw wheel
encoder ticks + IMU readings into a pose estimate yet. This fills that gap.

Why hand-rolled instead of `filterpy`/ROS's `robot_localization`, matching `fusion/eif.py`'s
existing pattern: the state is 3-D, the motion model is one line, and the whole filter is
~40 lines of plain numpy -- a dependency buys nothing here, and (as with `BearingEIF`) an
operator should be able to read the update equations directly rather than trust a library's
internals for a safety-relevant estimate. Swap in `robot_localization`'s dual-EKF only if this
ever needs to fuse GPS for outdoor operation -- indoor/wheel-odometry-only, this is complete.

Motion model: standard differential-drive (v = forward speed m/s, w = turn rate rad/s from
wheel encoders, matching the units `follow_path`/`RuleController` already use elsewhere).
Process noise scales with |v| and |w| (a robot that isn't moving isn't accumulating drift).
"""
from __future__ import annotations

import numpy as np


def wrap(a: float) -> float:
    return float(np.arctan2(np.sin(a), np.cos(a)))


class PoseEKF:
    """State: [x, y, theta]. Call `predict` every control tick, `update_heading` whenever a
    new absolute-heading reading (compass, IMU yaw, AHRS) is available -- these need not be
    synchronised; `update_heading` can be skipped on ticks with no new reading.
    """

    def __init__(self, prior_pose=(0.0, 0.0, 0.0), prior_std=(0.1, 0.1, 0.1),
                 v_noise: float = 0.05, w_noise: float = 0.05) -> None:
        """`v_noise`/`w_noise`: process-noise coefficients (fraction of |v|*dt, |w|*dt added to
        position/heading variance per predict step) -- tune these up if wheels slip a lot on
        your surface, down if odometry is unusually clean (encoders + firm indoor flooring)."""
        self.x = np.array(prior_pose, dtype=float)
        self.P = np.diag(np.asarray(prior_std, dtype=float) ** 2)
        self.v_noise, self.w_noise = v_noise, w_noise

    @property
    def pose(self) -> np.ndarray:
        return self.x.copy()

    @property
    def std(self) -> np.ndarray:
        """[std_x, std_y, std_theta] -- feed sigma into PlanningController's replan-on-drift
        logic the same way `BearingEIF`'s sigma already gates replanning there."""
        return np.sqrt(np.diag(self.P))

    def predict(self, v: float, w: float, dt: float) -> None:
        """Advance the pose estimate by one control tick using commanded/measured (v, w)."""
        x, y, th = self.x
        # Exact differential-drive integration (arc, not straight-line) when turning; the
        # straight-line fallback avoids a 0/0 when w is exactly zero.
        if abs(w) > 1e-6:
            nx = x + (v / w) * (np.sin(th + w * dt) - np.sin(th))
            ny = y - (v / w) * (np.cos(th + w * dt) - np.cos(th))
        else:
            nx = x + v * dt * np.cos(th)
            ny = y + v * dt * np.sin(th)
        nth = wrap(th + w * dt)
        self.x = np.array([nx, ny, nth])

        # Jacobian of the motion model wrt state, evaluated at the pre-update pose.
        F = np.eye(3)
        if abs(w) > 1e-6:
            F[0, 2] = (v / w) * (np.cos(th + w * dt) - np.cos(th))
            F[1, 2] = (v / w) * (np.sin(th + w * dt) - np.sin(th))
        else:
            F[0, 2] = -v * dt * np.sin(th)
            F[1, 2] = v * dt * np.cos(th)

        q = self.v_noise * abs(v) * dt + 1e-6
        qth = self.w_noise * abs(w) * dt + 1e-6
        Q = np.diag([q, q, qth])
        self.P = F @ self.P @ F.T + Q

    def update_heading(self, yaw_meas: float, sigma: float) -> None:
        """Fuse an absolute heading reading (rad). `sigma`: measurement std -- pass a larger
        value for a noisy/uncalibrated magnetometer, smaller for a fused AHRS yaw estimate."""
        H = np.array([[0.0, 0.0, 1.0]])
        innov = wrap(yaw_meas - self.x[2])
        S = float((H @ self.P @ H.T).item()) + sigma**2
        K = (self.P @ H.T) / S
        self.x = self.x + (K[:, 0] * innov)
        self.x[2] = wrap(self.x[2])
        self.P = (np.eye(3) - K @ H) @ self.P
