-- Schema v1. Timestamps are UTC epoch seconds (REAL). JSON columns hold TEXT.
CREATE TABLE sessions (
    id         INTEGER PRIMARY KEY,
    started_at REAL NOT NULL,
    ended_at   REAL,
    mode       TEXT NOT NULL CHECK (mode IN ('sim', 'real')),
    notes      TEXT
);

CREATE TABLE fire_events (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts         REAL NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN
               ('detected', 'localised', 'suppressing', 'extinguished', 'lost')),
    x          REAL,
    y          REAL,
    confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    intensity  REAL,
    meta       TEXT
);
CREATE INDEX idx_fire_events_session_ts ON fire_events(session_id, ts);

CREATE TABLE sensor_readings (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts         REAL NOT NULL,
    sensor     TEXT NOT NULL,
    value      REAL NOT NULL
);
CREATE INDEX idx_readings_session_sensor_ts ON sensor_readings(session_id, sensor, ts);

CREATE TABLE actions (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts         REAL NOT NULL,
    command    TEXT NOT NULL,
    params     TEXT,
    outcome    TEXT
);
CREATE INDEX idx_actions_session_ts ON actions(session_id, ts);
