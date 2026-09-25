# Databases

Two SQLite files, deliberately separate: the operational DB is written by the robot/sim at
runtime; the training DB is a dataset + experiment tracker. They are linked only by
`episodes.source_session_id` (no cross-DB foreign key).

## Operational DB (`firebot.db`, `firebot.db.store.Store`)
| Table | Purpose |
|---|---|
| `devices` | Equipment registry: kind, model, controller (pi/esp), bus, pin/address, mount pose, calibration JSON |
| `sessions` | One run of the robot or sim (`mode` = sim/real) |
| `sensor_readings` | Scalar sensors (ultrasonic, flame, MQ-2, water level...), linked to `devices` by name |
| `thermal_frames` | MLX90640 32x24 frames as float32 BLOBs + min/max/hotspot |
| `images` | RGB frame paths (files on disk, never blobs) |
| `robot_poses` | odom / imu / fused / sim_truth poses |
| `power_samples` | battery and rail voltage/current |
| `actuator_states` | pump duty, servo angles, motor commands |
| `fire_events` | detected / localised / suppressing / extinguished / lost, with x,y, confidence, zone |
| `actions`, `voice_commands` | executed commands; transcript -> LLM intent JSON -> validated -> action |
| `zones` | named map regions for breakout-by-location queries |
| `v_incidents` (view) | detection-to-extinguish response time per session (one incident per session) |

`Store.seed_default_devices()` loads the current equipment list; edit `db/devices.py` to match
real pins and mount poses.

## Training DB (`training.db`, `firebot.db.training.TrainingStore`)
`scenarios` (deduplicated by config hash) -> `runs` (algo, hyperparams, git commit) ->
`episodes` (policy, split train/val/test, source sim/real, outcome stats) -> `transitions`
(obs, action, reward, terminated, truncated as float32 blobs). Plus `metrics` (curves),
`checkpoints`, `eval_results`, and `v_run_summary`. Baselines (rule/rrt) are stored as runs too,
so DRL is compared against them with the same query.

## Migrations
Forward-only SQL files in `db/migrations/` and `db/training_migrations/`, named `NNN_name.sql`
and applied in order (version tracked with `PRAGMA user_version`). Never edit an applied
migration: add a new one.
