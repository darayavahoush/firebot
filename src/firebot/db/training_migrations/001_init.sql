CREATE TABLE scenarios (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    seed        INTEGER,
    config      TEXT NOT NULL,          -- JSON: layout, fire params, noise
    config_hash TEXT NOT NULL UNIQUE,
    created_at  REAL NOT NULL
);

CREATE TABLE runs (
    id           INTEGER PRIMARY KEY,
    algo         TEXT NOT NULL,          -- 'ppo', 'sac', 'rule', 'rrt', ...
    hyperparams  TEXT,
    git_commit   TEXT,
    env_version  TEXT,
    status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
    started_at   REAL NOT NULL,
    ended_at     REAL,
    notes        TEXT
);

CREATE TABLE episodes (
    id                 INTEGER PRIMARY KEY,
    run_id             INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    scenario_id        INTEGER REFERENCES scenarios(id),
    policy             TEXT NOT NULL CHECK (policy IN ('drl','rule','rrt','random','human')),
    split              TEXT NOT NULL DEFAULT 'train' CHECK (split IN ('train','val','test')),
    source             TEXT NOT NULL DEFAULT 'sim' CHECK (source IN ('sim','real')),
    source_session_id  INTEGER,          -- session id in the operational DB (no cross-DB FK)
    obs_dim            INTEGER NOT NULL,
    act_dim            INTEGER NOT NULL,
    n_steps            INTEGER NOT NULL,
    total_reward       REAL NOT NULL,
    success            INTEGER NOT NULL CHECK (success IN (0,1)),
    collisions         INTEGER NOT NULL DEFAULT 0,
    water_used         REAL,
    time_to_extinguish REAL,
    final_obs          BLOB,
    created_at         REAL NOT NULL
);
CREATE INDEX idx_episodes_run ON episodes(run_id, split);

CREATE TABLE transitions (
    episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    step       INTEGER NOT NULL,
    obs        BLOB NOT NULL,            -- float32 little-endian, length obs_dim
    action     BLOB NOT NULL,            -- float32 little-endian, length act_dim
    reward     REAL NOT NULL,
    terminated INTEGER NOT NULL CHECK (terminated IN (0,1)),
    truncated  INTEGER NOT NULL CHECK (truncated IN (0,1)),
    PRIMARY KEY (episode_id, step)
) WITHOUT ROWID;

CREATE TABLE metrics (
    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step   INTEGER NOT NULL,
    name   TEXT NOT NULL,
    value  REAL NOT NULL,
    PRIMARY KEY (run_id, name, step)
) WITHOUT ROWID;

CREATE TABLE checkpoints (
    id      INTEGER PRIMARY KEY,
    run_id  INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step    INTEGER NOT NULL,
    path    TEXT NOT NULL,
    metrics TEXT,
    created_at REAL NOT NULL
);

CREATE TABLE eval_results (
    id            INTEGER PRIMARY KEY,
    run_id        INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    checkpoint_id INTEGER REFERENCES checkpoints(id),
    scenario_id   INTEGER REFERENCES scenarios(id),
    metric        TEXT NOT NULL,
    value         REAL NOT NULL
);

CREATE VIEW v_run_summary AS
SELECT r.id AS run_id, r.algo, r.status,
       COUNT(e.id) AS episodes,
       AVG(e.success) AS success_rate,
       AVG(e.total_reward) AS mean_reward,
       AVG(e.n_steps) AS mean_steps,
       AVG(e.collisions) AS mean_collisions
FROM runs r LEFT JOIN episodes e ON e.run_id = r.id
GROUP BY r.id;
