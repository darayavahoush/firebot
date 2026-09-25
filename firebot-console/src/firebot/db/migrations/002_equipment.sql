-- v2: equipment registry, telemetry, thermal frames, power, actuators, voice, zones, incidents.
CREATE TABLE zones (
    id      INTEGER PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE,
    kind    TEXT,
    polygon TEXT            -- JSON [[x,y],...] in map frame (metres)
);

CREATE TABLE devices (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL CHECK (kind IN ('sensor','actuator','camera','compute','power')),
    model       TEXT,
    controller  TEXT CHECK (controller IS NULL OR controller IN ('pi','esp')),
    bus         TEXT CHECK (bus IS NULL OR bus IN ('gpio','i2c','uart','usb','csi','pwm','adc')),
    address     TEXT,       -- pin / I2C address / port
    unit        TEXT,
    mount_x REAL, mount_y REAL, mount_z REAL,      -- metres, robot frame
    mount_yaw REAL, mount_pitch REAL,              -- radians
    calibration TEXT,       -- JSON (offsets, scale, thresholds)
    active      INTEGER NOT NULL DEFAULT 1,
    notes       TEXT
);

ALTER TABLE sensor_readings ADD COLUMN device_id INTEGER REFERENCES devices(id);
ALTER TABLE sensor_readings ADD COLUMN quality REAL;
ALTER TABLE fire_events ADD COLUMN zone_id INTEGER REFERENCES zones(id);
ALTER TABLE fire_events ADD COLUMN thermal_frame_id INTEGER;

CREATE TABLE thermal_frames (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    device_id  INTEGER REFERENCES devices(id),
    ts         REAL NOT NULL,
    rows       INTEGER NOT NULL,
    cols       INTEGER NOT NULL,
    min_c      REAL, max_c REAL,
    hot_row    INTEGER, hot_col INTEGER,
    data       BLOB NOT NULL      -- little-endian float32, row-major (deg C)
);
CREATE INDEX idx_thermal_session_ts ON thermal_frames(session_id, ts);

CREATE TABLE images (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    device_id  INTEGER REFERENCES devices(id),
    ts         REAL NOT NULL,
    path       TEXT NOT NULL,     -- file on disk, never a blob
    width INTEGER, height INTEGER,
    thermal_frame_id INTEGER REFERENCES thermal_frames(id)
);
CREATE INDEX idx_images_session_ts ON images(session_id, ts);

CREATE TABLE robot_poses (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts         REAL NOT NULL,
    x REAL NOT NULL, y REAL NOT NULL, theta REAL NOT NULL,
    v REAL, w REAL,
    source     TEXT NOT NULL CHECK (source IN ('odom','imu','fused','sim_truth')),
    cov        TEXT
);
CREATE INDEX idx_poses_session_ts ON robot_poses(session_id, ts);

CREATE TABLE power_samples (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts         REAL NOT NULL,
    rail       TEXT NOT NULL,     -- 'battery', '5v', 'pump', ...
    voltage REAL, current REAL
);
CREATE INDEX idx_power_session_ts ON power_samples(session_id, rail, ts);

CREATE TABLE actuator_states (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    device_id  INTEGER NOT NULL REFERENCES devices(id),
    ts         REAL NOT NULL,
    value      REAL NOT NULL      -- pump duty 0..1, servo angle rad, motor speed, ...
);
CREATE INDEX idx_actuator_session_ts ON actuator_states(session_id, device_id, ts);

CREATE TABLE voice_commands (
    id          INTEGER PRIMARY KEY,
    session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts          REAL NOT NULL,
    transcript  TEXT NOT NULL,
    intent      TEXT,             -- JSON produced by the LLM
    validated   INTEGER NOT NULL DEFAULT 0 CHECK (validated IN (0,1)),
    action_id   INTEGER REFERENCES actions(id)
);

-- One incident per session (documented assumption).
CREATE VIEW v_incidents AS
SELECT s.id AS session_id, s.mode,
       MIN(CASE WHEN f.kind='detected'     THEN f.ts END) AS detected_ts,
       MIN(CASE WHEN f.kind='localised'    THEN f.ts END) AS localised_ts,
       MIN(CASE WHEN f.kind='suppressing'  THEN f.ts END) AS suppressing_ts,
       MIN(CASE WHEN f.kind='extinguished' THEN f.ts END) AS extinguished_ts,
       MIN(CASE WHEN f.kind='extinguished' THEN f.ts END)
         - MIN(CASE WHEN f.kind='detected' THEN f.ts END) AS response_s
FROM sessions s JOIN fire_events f ON f.session_id = s.id
GROUP BY s.id;
