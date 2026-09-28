# Databases

Three stores, deliberately separate:

| Store | Engine | Written by | Used for |
|---|---|---|---|
| Telemetry DB | PostgreSQL | `firebot-brain` (background writer) | Live console, History replay, summaries |
| Operational DB (`firebot.db`) | SQLite | `firebot-sim`, `Store` | Offline sim runs, device registry, incidents |
| Training DB (`training.db`) | SQLite | DRL training | Dataset and experiment tracker |

The SQLite files are linked only by `episodes.source_session_id` (no cross-DB foreign key). The
console reads **only** the PostgreSQL telemetry DB.

## Telemetry DB (PostgreSQL, `FIREBOT_DB`, `firebot.link.pg.PostgresBackend`)
Migrations live in `db/pg_migrations/` and are applied by the brain on connect
(`schema_migrations` tracks versions).

| Table | Purpose |
|---|---|
| `sessions` | One brain run. `id` is a UUID made by the brain so it can start while the DB is down. `ended_at IS NULL` marks the live session the console follows |
| `frames` | One row per robot frame, primary key `(session_id, seq)`: pose, speed, tank, `sensors` (JSONB), fused fire estimate (`est_x/y/sigma`), `mode`, the command sent, `compute_ms` |
| `operator_commands` | Typed / voice / backstop / manual commands with parsed intent (JSONB, includes `channel`), `valid` and the reply |
| `v_session_summary` (view) | Frames, duration, minimum tank, whether the pump ran, command count per session |

**Thermal grids are sparse.** `frames.thermal` is a flattened 768-value `REAL[]` (24 x 32,
row-major) stored only when `seq % thermal_every == 0` (`firebot-brain --thermal-every`, default
10; `0` = never). The other frames have `thermal = NULL`. Anything that needs "the current thermal
image" must look back for the newest non-null row rather than assume the latest frame has one.
`/ws/telemetry` does this; `_reshape_thermal` in `server.py` restores the 24 x 32 shape.

Useful checks:
```sql
-- is the live session storing thermal grids?
SELECT count(*) AS frames, count(thermal) AS with_thermal FROM frames
WHERE session_id = (SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1);
```
Connect with `psql "$FIREBOT_DB"` (psql does not read the variable by itself).

## Operational DB (SQLite, `firebot.db`, `firebot.db.store.Store`)
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

## Training DB (SQLite, `training.db`, `firebot.db.training.TrainingStore`)
`scenarios` (deduplicated by config hash) -> `runs` (algo, hyperparams, git commit) ->
`episodes` (policy, split train/val/test, source sim/real, outcome stats) -> `transitions`
(obs, action, reward, terminated, truncated as float32 blobs). Plus `metrics` (curves),
`checkpoints`, `eval_results`, and `v_run_summary`. Baselines (rule/rrt) are stored as runs too,
so DRL is compared against them with the same query.

## Migrations
Forward-only SQL files in `db/migrations/`, `db/training_migrations/` (SQLite, version tracked with
`PRAGMA user_version`) and `db/pg_migrations/` (PostgreSQL, tracked in `schema_migrations`), named
`NNN_name.sql` and applied in order. Never edit an applied
migration: add a new one.
