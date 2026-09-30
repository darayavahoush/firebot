"""Multimodal Gymnasium Environment for Deep Reinforcement Learning Sensor Fusion.

Exposes structured, physically grounded observation tokens for:
  - MLX90640 Thermal IR array (peak heat, heated area, centroid bearing, visibility)
  - 3-Channel Optical Flame Phototransistors (radial left, center, right)
  - 2-Channel Chemical MQ-2 Gas Sensors (front, rear, differential gradient)
  - 4-Channel Acoustic Ultrasonic Rangefinders (clearance envelope)
  - Bayesian Extended Information Filter (EIF) fire belief state & covariance
  - Proprioceptive states (chassis velocities, turret pan angle, water capacity)

Incorporates Information-Theoretic Active Sensing Rewards:
  - Covariance Reduction Reward: R_info = max(0, Tr(P_{t-1}) - Tr(P_t))
  - Cross-Modal Sensor Verification Bonus
  - Gas Concentration Gradient Follow Bonus
"""
from __future__ import annotations

from collections.abc import Callable
from typing import ClassVar

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from firebot.fusion import BearingEIF
from firebot.sensing import HFOV, HOT_C, THERM_COLS, THERM_ROWS, thermal_bearing, thermal_blobs
from firebot.sim.env import (
    ACT_DIM,
    DEFAULT_MIN_FIRE_DIST,
    DT,
    EXTINGUISH_RATE,
    SPRAY_CONE,
    SPRAY_RANGE,
    TURRET_LIMIT,
    TURRET_WMAX,
    VMAX,
    WATER_RATE,
    WMAX,
    clamp_min_fire_dist,
)
from firebot.sim.sensors import read_sensors
from firebot.sim.world import Fire, World

_START = (1.2, 1.0)


class MultimodalFireGymEnv(gym.Env):
    """Publication-grade Multimodal Sensor Fusion Gymnasium Environment."""

    metadata: ClassVar[dict] = {"render_modes": []}

    def __init__(
        self,
        max_steps: int = 1500,
        world: World | None = None,
        world_factory: Callable[[np.random.Generator], World] | None = None,
        min_fire_dist: float = DEFAULT_MIN_FIRE_DIST,
        info_gain_weight: float = 3.5,
        cross_modal_weight: float = 1.0,
        gas_gradient_weight: float = 0.8,
    ) -> None:
        super().__init__()
        self.max_steps = max_steps
        self.world_arg = world
        self.world = world or World()
        self.world_factory = world_factory
        self.min_fire_dist = min_fire_dist
        self.info_gain_weight = info_gain_weight
        self.cross_modal_weight = cross_modal_weight
        self.gas_gradient_weight = gas_gradient_weight

        # Structured Multimodal Observation Space
        self.observation_space = spaces.Dict(
            {
                # Thermal Vision Token: [norm_peak, norm_area, norm_bearing, has_detection]
                "thermal": spaces.Box(
                    low=np.array([0.0, 0.0, -1.0, 0.0], dtype=np.float32),
                    high=np.array([1.0, 1.0, 1.0, 1.0], dtype=np.float32),
                    dtype=np.float32,
                ),
                # Optical Flame IR Array: [flame_left, flame_center, flame_right]
                "flame": spaces.Box(low=0.0, high=1.0, shape=(3,), dtype=np.float32),
                # Chemical MQ-2 Gas: [front, rear, gradient = front - rear]
                "gas": spaces.Box(
                    low=np.array([0.0, 0.0, -1.0], dtype=np.float32),
                    high=np.array([1.0, 1.0, 1.0], dtype=np.float32),
                    dtype=np.float32,
                ),
                # Sonar Envelope: [front_left, front_right, left, right] normalized to [0, 1]
                "ultrasonic": spaces.Box(low=0.0, high=1.0, shape=(4,), dtype=np.float32),
                # Bayesian Filter Belief: [rel_x, rel_y, rel_bearing / pi, sigma / 4.0]
                "eif_belief": spaces.Box(low=-10.0, high=10.0, shape=(4,), dtype=np.float32),
                # Proprioception: [speed / vmax, tank_level, turret / limit, collision_flag]
                "proprio": spaces.Box(low=-1.0, high=1.0, shape=(4,), dtype=np.float32),
            }
        )

        # Action: [forward speed 0..1, chassis turn -1..1, turret turn -1..1, pump >0.5 = on]
        self.action_space = spaces.Box(
            low=np.array([0.0, -1.0, -1.0, 0.0], dtype=np.float32),
            high=np.array([1.0, 1.0, 1.0, 1.0], dtype=np.float32),
            shape=(ACT_DIM,),
            dtype=np.float32,
        )

        self.rng = np.random.default_rng(0)
        self.robot = np.zeros(3)
        self.turret = 0.0
        self.fire = Fire(6.0, 4.0)
        self.eif = BearingEIF()
        self.t = 0
        self.tank = 1.0
        self.collisions = 0
        self.meas_speed = 0.0
        self.prev_cov_trace = 200.0
        self.last_sensors: dict = {}

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        if seed is not None:
            self.rng = np.random.default_rng(seed)

        if self.world_factory is not None:
            old = self.world
            self.world = self.world_factory(self.rng)
            if old is not self.world and hasattr(old, "close"):
                old.close()

        start = (
            _START
            if self.world.is_free(*_START, 0.22)
            else self.world.random_free_point(self.rng, 0.22)
        )
        self.robot = np.array([start[0], start[1], 0.6], dtype=np.float32)
        self.turret = 0.0

        min_dist = clamp_min_fire_dist(self.world, self.min_fire_dist)
        fx, fy = self.world.random_free_point(self.rng, 0.5, self.robot[:2], min_dist)
        self.fire = Fire(fx, fy)
        self.eif = BearingEIF()

        self.t = 0
        self.tank = 1.0
        self.collisions = 0
        self.meas_speed = 0.0
        self.prev_cov_trace = float(np.trace(self.eif.cov))
        self.last_sensors = read_sensors(self.world, self.fire, *self.robot, self.rng)

        # Update initial filter observation
        self._update_fusion(self.last_sensors)

        obs = self._build_obs(self.last_sensors)
        info = {
            "fire_x": float(fx),
            "fire_y": float(fy),
            "eif_sigma": float(np.sqrt(max(self.eif.cov[0, 0], self.eif.cov[1, 1]))),
        }
        return obs, info

    def _update_fusion(
        self, s: dict, thermal_sigma: float = 0.04, flame_sigma: float = 0.3
    ) -> tuple[bool, float | None]:
        """Update Bayesian BearingEIF with multimodal observations."""
        x, y, th = self.robot
        zt = thermal_bearing(s["thermal"])
        seen = zt is not None

        if seen:
            self.eif.update(x, y, th, zt, thermal_sigma)
        else:
            # Check 3 flame sensors
            f = np.array([s["flame_left"], s["flame_center"], s["flame_right"]])
            if f.sum() > 0.15:
                weights = np.array([0.52, 0.0, -0.52])  # rad
                bearing = float((f * weights).sum() / f.sum())
                self.eif.update(x, y, th, bearing, flame_sigma)

        return seen, zt

    def _build_obs(self, s: dict) -> dict[str, np.ndarray]:
        """Construct structured multimodal observation tokens."""
        # 1. Thermal vision features
        blobs = thermal_blobs(s["thermal"])
        if blobs:
            b0 = blobs[0]
            peak_norm = float(np.clip((b0["peak"] - 25.0) / 325.0, 0.0, 1.0))
            area_norm = float(np.clip(b0["area"] / float(THERM_ROWS * THERM_COLS), 0.0, 1.0))
            bearing_norm = float(np.clip((15.5 - b0["col"]) * HFOV / THERM_COLS / (HFOV / 2), -1.0, 1.0))
            has_det = 1.0
        else:
            peak_norm = float(np.clip((float(np.max(s["thermal"])) - 25.0) / 325.0, 0.0, 1.0))
            area_norm = 0.0
            bearing_norm = 0.0
            has_det = 0.0
        thermal_token = np.array([peak_norm, area_norm, bearing_norm, has_det], dtype=np.float32)

        # 2. Flame optical array
        flame_token = np.array(
            [s["flame_left"], s["flame_center"], s["flame_right"]], dtype=np.float32
        )

        # 3. Chemical MQ-2 gas array
        g_front = s["mq2_front"]
        g_rear = s["mq2_rear"]
        gas_token = np.array([g_front, g_rear, g_front - g_rear], dtype=np.float32)

        # 4. Sonar ultrasonic clearance envelope
        us_token = np.array(
            [s["us_front_left"], s["us_front_right"], s["us_left"], s["us_right"]],
            dtype=np.float32,
        ) / 4.0

        # 5. Bayesian EIF belief state
        m = self.eif.mean
        P = self.eif.cov
        dx = float(m[0] - self.robot[0])
        dy = float(m[1] - self.robot[1])
        heading = self.robot[2]
        rel_bearing = float(np.arctan2(dy, dx) - heading)
        rel_bearing = float(np.arctan2(np.sin(rel_bearing), np.cos(rel_bearing)))
        sigma = float(np.sqrt(max(P[0, 0], P[1, 1])))
        eif_token = np.array(
            [
                np.clip(dx / 10.0, -2.0, 2.0),
                np.clip(dy / 10.0, -2.0, 2.0),
                rel_bearing / np.pi,
                min(sigma, 4.0) / 4.0,
            ],
            dtype=np.float32,
        )

        # 6. Proprioceptive state
        proprio_token = np.array(
            [
                self.meas_speed / VMAX,
                self.tank,
                self.turret / TURRET_LIMIT,
                1.0 if self.collisions > 0 else 0.0,
            ],
            dtype=np.float32,
        )

        return {
            "thermal": thermal_token,
            "flame": flame_token,
            "gas": gas_token,
            "ultrasonic": us_token,
            "eif_belief": eif_token,
            "proprio": proprio_token,
        }

    def step(self, action):
        self.t += 1
        v = float(np.clip(action[0], 0, 1)) * VMAX
        w = float(np.clip(action[1], -1, 1)) * WMAX
        turret_rate = float(np.clip(action[2], -1, 1)) * TURRET_WMAX
        pump = float(action[3]) > 0.5 and self.tank > 0

        x, y, th = self.robot
        th += w * DT
        self.turret = float(
            np.clip(self.turret + turret_rate * DT, -TURRET_LIMIT, TURRET_LIMIT)
        )
        nx, ny = x + np.cos(th) * v * DT, y + np.sin(th) * v * DT

        # Check collision with wall/obstacle
        collided = v > 0 and not self.world.is_free(nx, ny, 0.22)
        if collided:
            nx, ny = x, y
            self.collisions += 1

        self.meas_speed = float(np.hypot(nx - x, ny - y)) / DT
        self.robot = np.array([nx, ny, th], dtype=np.float32)

        # Extinguishment physics
        fx, fy = self.fire.x, self.fire.y
        dist_to_fire = float(np.hypot(fx - nx, fy - ny))
        nozzle_heading = th + self.turret
        fire_bearing = float(np.arctan2(fy - ny, fx - nx))
        aim_err = abs(float(np.arctan2(np.sin(fire_bearing - nozzle_heading), np.cos(fire_bearing - nozzle_heading))))

        spraying_fire = (
            pump
            and dist_to_fire <= SPRAY_RANGE
            and aim_err <= SPRAY_CONE
            and self.world.line_of_sight(nx, ny, fx, fy)
        )

        if pump:
            self.tank = max(0.0, self.tank - WATER_RATE * DT)
        if spraying_fire:
            self.fire.extinguish(EXTINGUISH_RATE * DT)

        # Read updated sensors & execute Bayesian Information Filter update
        self.last_sensors = read_sensors(self.world, self.fire, *self.robot, self.rng)
        seen_thermal, zt = self._update_fusion(self.last_sensors)

        # ---------------------------------------------------------
        # Information-Theoretic Multi-Sensor Reward Formulation
        # ---------------------------------------------------------
        current_cov_trace = float(np.trace(self.eif.cov))
        # 1. Active Information Gain (Reduction in EIF covariance trace)
        info_gain = max(0.0, self.prev_cov_trace - current_cov_trace)
        r_info = self.info_gain_weight * min(info_gain, 5.0)
        self.prev_cov_trace = current_cov_trace

        # 2. Cross-Modal Agreement Bonus (Thermal confirms flame sensors)
        flame_sum = float(
            self.last_sensors["flame_left"]
            + self.last_sensors["flame_center"]
            + self.last_sensors["flame_right"]
        )
        r_cross = 0.0
        if seen_thermal and flame_sum > 0.2:
            r_cross = self.cross_modal_weight * 0.5

        # 3. Chemical Gas Gradient Follow Reward
        delta_gas = self.last_sensors["mq2_front"] - self.last_sensors["mq2_rear"]
        r_gas = self.gas_gradient_weight * max(0.0, delta_gas) if v > 0.1 else 0.0

        # 4. Suppression & Alignment Reward
        r_suppress = 15.0 * EXTINGUISH_RATE * DT if spraying_fire else 0.0
        if pump and not spraying_fire:
            r_suppress -= 0.1  # penalize water waste

        # 5. Safety & Motion penalties
        r_collision = -2.0 if collided else 0.0
        r_step = -0.01  # small time cost

        total_reward = float(r_info + r_cross + r_gas + r_suppress + r_collision + r_step)

        # Terminations
        done = False
        success = self.fire.p <= 0.0
        timeout = self.t >= self.max_steps
        out_of_water = self.tank <= 0.0 and self.fire.p > 0.0

        if success:
            total_reward += 50.0
            done = True
        elif out_of_water or timeout:
            done = True

        obs = self._build_obs(self.last_sensors)
        info = {
            "success": success,
            "fire_p": float(self.fire.p),
            "collisions": self.collisions,
            "eif_sigma": float(np.sqrt(max(self.eif.cov[0, 0], self.eif.cov[1, 1]))),
            "info_gain": float(info_gain),
            "t": float(self.t * DT),
        }

        return obs, total_reward, done, False, info
