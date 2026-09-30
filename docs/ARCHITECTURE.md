# Architecture

Robot (Pi)  --sensor frames-->  PC brain  --commands-->  Robot (Pi)
                                 fusion (EIF) -> planning / DRL -> command layer
                                     \-> PostgreSQL (telemetry, operator commands)
                                             ^
Browser <-> React console <-> FastAPI bridge -+   (reads history + live frames)
                                  \-> brain's loopback command bridge (manual drive, e-stop)

The Pi is a thin terminal: it streams sensors and applies commands, nothing else -- no
database, no planning, no numpy. See "Robot link" below. (`firebot-sim` and the training DB
still use local SQLite on the PC for offline experiments.)

Rule: algorithms depend on interfaces, never on hardware. Sim and real drivers emit the same
data structures, so switching to the robot changes drivers only.

## Roadmap
1. [x] DB layer + tests, EIF fusion + tests, browser visualiser (`web/`)
2. [x] Python sim core (world, sensors, Gymnasium-style env, EIF in the loop)
3. [x] Rule-based confrontation controller (baseline), `firebot-sim` records to both DBs
4. [x] Planning: numpy RRT* on the inflated occupancy grid (`Planner` interface, OMPL-swappable),
   pure-pursuit follower, `PlanningController` wrapping the rule baseline; `firebot-plan`
   benchmarks it against the baseline via `v_run_summary`
5. [x] DRL: `FireGymEnv` (gymnasium.Env) + PPO (Stable-Baselines3), benchmarked against the
   rule baseline via `firebot-eval` / `v_run_summary`
6. [x] Pan-tilt aiming: `FireEnv` turret DOF (4th action component, nozzle-relative spray
   cone), `RuleController`/`PlanningController`/`DRLController` all updated, voice `nozzle`
   command now actually drives it. Sim/software-only -- the real servo driver is item 8.
7. [x] Command layer: rule-based intent parser -> validated JSON intents -> executor; optional
   local SLM fallback (confirm-before-act), logged to `voice_commands`/`actions`;
   `firebot-cmd`. Speech: see below
8. [ ] Hardware drivers (Pi / ESP): implement the 3-method `Hardware` interface
   (`read` / `apply` / `stop`) in `firebot.link.agent`; sim already implements it (`SimHardware`)
9. [x] Robot link: thin Pi agent <-> PC brain over TCP, PostgreSQL telemetry, fail-safes
10. [x] Web console: Live (thermal, rings, joystick), History (replay, summary, faults),
    Simulator (browser-only), see "Web console" below
11. [x] Speaker identification for the audit trail; offline voice-intent classifier
12. [ ] Real camera stream (the console shows placeholder footage), real map / SLAM
13. [x] MuJoCo world: 3-D MJCF scenes generated from the same procedural floor plans, exact
    `mj_ray` lidar, contact-based collisions, trees / shrubs / barrels / shelves as obstacles;
    a drop-in `World` (see "MuJoCo world" below)
14. [x] Lidar controllers: `ScanController` (gap-following avoidance) and `FrontierController`
    (occupancy grid from lidar sweeps + frontier exploration), selectable with
    `firebot-sim --controller`. Sim-only: the real robot has no lidar yet
15. [x] Console MuJoCo tab: a live 3-D episode over WebSocket, optional logging to PostgreSQL

## Command layer (`firebot.command`)
operator text -> `RuleParser` (deterministic) -> [`SLMParser`, only if rules returned UNKNOWN]
-> `validate()` against `SCHEMA` -> `CommandController` -> actions.
- Parsers only emit `Intent`s (STOP, EXTINGUISH, GOTO x/y, RETURN_HOME, STATUS). Every intent,
  from any source, is schema/range checked; unknown intents, extra params and NaNs are rejected.
- STOP is matched anywhere in an utterance and never depends on the SLM (fail-safe bias).
- There is no "pump on" intent: the pump is only driven by autonomous suppression logic.
- SLM-derived motion intents carry `needs_confirmation` and do nothing until confirmed.
- Speech later: an offline recogniser (e.g. Vosk with a restricted grammar) yields a transcript
  that goes through the same `Interpreter`; nothing downstream changes.

## Speech (`firebot.speech`, optional `speech` extra)
mic (16 kHz mono PCM) -> `VoskRecognizer` (offline, restricted word-list grammar) ->
`spoken_to_text` (number words -> digits, drop `[unk]`) -> `Interpreter` -> same executor as typed.
- Vosk does its own end-of-utterance detection, so no VAD is required. An optional Silero VAD
  gate (`firebot.speech.vad.SileroGate`, `vad` extra) can sit in front of it if CPU on the Pi
  matters: it's a pure filter that drops non-speech chunks (plus a short hangover tail) before
  they reach Vosk, and doesn't change Vosk's own end-of-utterance logic. Opt in with `--vad` /
  `--vad-threshold` on `firebot-listen` and `firebot-brain`.
- STOP backstop: `Listener` watches Vosk *partial* results and calls `on_stop` the moment a stop
  word is heard, mid-sentence, bypassing the interpreter. It complements a physical e-stop; it is
  not a substitute (ASR can miss words, especially over motor/pump noise).
- `firebot.speech.grammar.EXAMPLES` is checked in tests to be both sayable (words in the Vosk
  vocabulary) and understood by the rule parser -- extend the grammar and the rules together.
- Model: download e.g. `vosk-model-small-en-us-0.15` from alphacephei.com/vosk/models and pass
  its directory to `firebot-listen --model`.

## Robot link (`firebot.link`)
```
Pi: Hardware.read() -> frame --TCP/JSON lines--> brain: Perception -> CommandController -> cmd
Pi: Hardware.apply(cmd) <------------------------------------------------------ +-> Postgres
```
- **Pi (`agent.py`, `protocol.py`; stdlib only):** send a frame every 1/rate s, apply each command,
  reconnect on its own. Implement `Hardware` (`read`, `apply`, `stop`) for the real drivers.
- **Brain (`brain.py`, `server.py`):** one frame in, one command out. Starts IDLE on every
  connection. Operator text (`Brain.submit_text`, from the terminal or a speech recogniser) goes
  through the existing interpreter/validator/executor.
- **Telemetry (`sink.py`, `pg.py`):** frames, fused fire estimate, mode, commands and operator
  commands go to PostgreSQL through a background writer. The control loop never waits on the
  database; during an outage rows are buffered (bounded, newest kept) and written on recovery.
  Session ids are UUIDs made by the brain, so a session can start while the DB is unreachable.
  Thermal frames are stored every Nth frame (`--thermal-every`, default 10).
- **Wire format:** newline-delimited JSON, `hello` (version + token) -> `welcome`, then `frame`
  (Pi -> PC) and `cmd` (PC -> Pi, normalised v/w + pump). Everything is validated on receipt.

Fail-safes
| Failure | What happens |
|---|---|
| PC silent / link down / brain hung | Pi watchdog (default 0.5 s) stops motors and pump; agent keeps reconnecting |
| Brain busy planning (RRT*) | brain sends "hold still" keepalives every 0.15 s so the watchdog stays fed |
| Operator says stop | detected on submit; overrides any command already being computed; sent as zeros |
| Bad token / protocol version | rejected before any command is sent; brain refuses non-loopback bind without a token |
| Garbage / NaN / wrong-shape frames | dropped and counted; commands from the Pi are clamped and type-checked too |
| Database down | control unaffected; rows buffered, then written on recovery |
| Pi restarts / reconnects | fresh brain state, mode IDLE |

Voice (`firebot-brain --voice-model DIR [--voice-wav FILE] [--voice-device N]`): the mic is on the
PC, never the Pi. Final transcripts go to `BrainServer.submit_command(text, "voice")` -- the same
interpreter/validator/executor as typed input. The STOP backstop calls `emergency_stop()` on the
first partial result containing a stop word, mid-sentence; it flags the brain's e-stop at once, so
it overrides a command already being computed. Each operator command is logged with its channel
(`operator_commands.intent->>'channel'` = typed / voice / backstop). If the mic or model fails at
start-up the brain exits with an error; if the audio stream dies later, typed control continues.
Voice complements a physical e-stop; it does not replace one.

Speaker ID (`firebot.speech.speaker_id`, `firebot-brain --speaker-id`): SpeechBrain ECAPA embeddings
matched by cosine similarity against enrolled voiceprints (`enroll_speaker.py`, threshold and margin
tunable via `FIREBOT_SPEAKER_*`). It answers "who said it" for the audit trail and never changes
what a command means: the rule parser stays deterministic. The speaker is recorded in the command
channel (`voice:<name>`).

Limits: the token authenticates but the link is not encrypted -- use it over a trusted LAN or a
VPN (WireGuard/Tailscale). Odometry pose comes from the Pi (wheel encoders/IMU); there is no SLAM
on the robot yet (the sim's `FrontierController` uses the simulator's true pose). `Brain` assumes the sim's room map (`World`) until a real map is configured.

## MuJoCo world (`firebot.sim`, optional `mujoco` extra)
`MuJoCoWorld` is a drop-in for `World` (`grid`, `occupied`, `is_free`, `ray`, `line_of_sight`), so
`FireEnv`, the sensor models, RRT* and every controller run unchanged on it.
- Walls and props are static MuJoCo geoms compiled from generated MJCF. Trees are a thin solid
  trunk plus a visual-only canopy above the scan plane, the way a 2-D lidar sees them.
- `ray()` / `rays()` are exact `mj_ray` / `mj_multiRay` casts at lidar height over the solid geom
  group only. The planning grid is derived from the scene itself, so planners and physics cannot
  disagree about what is solid. `robot_collides()` is a real narrow-phase contact query.
- Maps come from `mapgen.py` (BSP rooms with a doorway between each adjacent pair, typed rooms,
  a reachability guarantee), so every fire is reachable.
- Rendering: `render()` (headless top-down PNG), `render3d()` (still, headless-safe) and `view()`
  (interactive viewer; `mjpython` on macOS).

Controllers, each building on the last:
| Controller | Sensors it uses | Behaviour |
|---|---|---|
| `rule` | 4 ultrasonic beams, 3 flame sensors, gas | explore / track / spray baseline |
| `scan` | + 36-ray lidar (`FireEnv.scan`, 360 deg, 4 m) | same logic, gap-following avoidance instead of spinning |
| `frontier` | + robot pose | builds an occupancy grid from lidar, BFS to the nearest frontier, pure pursuit |

The lidar is a simulation-only sensor. Only `rule` runs on the sensors the real robot has, so
results for `scan` and `frontier` say what a lidar would add, not how the current hardware behaves.

## Web console (`firebot-console/`)
```
React (Vite) --HTTP/WS--> FastAPI bridge (server.py) --SQL--> PostgreSQL   (history, live frames)
                                     \--loopback HTTP + bearer token--> brain (manual, e-stop)
```
- **Live frames:** `/ws/telemetry` polls the live session's newest frame every 0.4 s. Because
  thermal grids are stored only every Nth frame, it also fetches the newest stored grid when the
  latest frame has none and sends it once (`thermal_seq`). The frontend keeps the last grid and
  labels it "Held from Ns ago".
- **Manual control:** the console sends drive, pump and nozzle as separate events; the bridge merges
  them into one `(v, w, pump, nozzle)` sample for the brain's `/manual` route (`link/cmdhttp.py`).
  Analog `v` is clamped to 0..1 (no reverse) and `w` to -1..1, positive = counter-clockwise. If no
  fresh sample arrives for 0.5 s (`MANUAL_TIMEOUT`) the brain goes to IDLE and stops motors and
  pump, so the UI re-sends while the stick is held. `/estop` calls `BrainServer.emergency_stop()`. Both routes need the
  token; the brain refuses to start the bridge without one.
- **History:** `/api/runs/{id}/anomalies` and `/summary` are computed from stored frames and
  operator commands by `firebot.fusion.anomaly` (deterministic; an optional local model may only
  re-word the text and is rejected if it changes a number).
- **Voice transcription:** `/api/transcribe` tries the local intent classifier, then offline Vosk,
  then Groq Whisper, and reports the mode in `/api/voice/status`. Speaker ID runs on the same audio.
- **Simulator page:** a browser-only port of the sim, planner (informed RRT*, standing in for OMPL
  which has no browser build) and command grammar. It shares no state with the real robot.
- **Voice calibration:** `firebot.voice_intent.personalize` fine-tunes a copy of the classifier head on a
  user's own embedded clips (L2-SP pull to the base weights, light noise augmentation) and keeps it only if it
  matches or beats the base on one held-out clip per command. `backend/calibration.py` serves recording, training
  and reset; `/api/transcribe` picks the head for the operator (`user` form field, else the speaker-ID result).
- **MuJoCo page:** `WS /ws/mujoco?seed=&controller=&speed=&log=` (`backend/mujoco_stream.py`). The
  server runs `firebot.sim.stream.EpisodeStream` in a worker thread and sends the map once (a
  `scene` message), then a small `frame` about every 0.1 s of sim time and a final `end`. The
  browser draws everything with three.js, so the server needs `mujoco` but no display or GL.
  The client can send `{paused}` and `{speed}` while it runs. `GET /api/mujoco/status` reports
  whether `mujoco` is installed. With `log=1` the run is written to the telemetry DB (below).
- **Logging a MuJoCo run:** a session with `robot = 'mujoco-sim'` and `meta` holding the seed,
  controller and outcome; one `frames` row per tick (batched every 10 frames) using the same
  sensor names as the real robot, plus a `lidar` list of 36 ranges in `sensors`. The session stays
  open (`ended_at IS NULL`) while playing, so the Live page follows it, and is closed even if the
  browser disconnects. Thermal grids are not produced by the sim. A real robot session that is
  also live can be shadowed on the Live page, since it shows the newest open session.
- **Reading the console safely:** the console never opens a socket to the Pi; everything goes
  through the brain, so the fail-safes above still apply to manual driving.
