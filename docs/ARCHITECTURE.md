# Architecture

Robot (Pi)  --sensor frames-->  PC brain  --commands-->  Robot (Pi)
                                 fusion (EIF) -> planning / DRL -> command layer
                                     \-> PostgreSQL (telemetry, operator commands)

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

Limits: the token authenticates but the link is not encrypted -- use it over a trusted LAN or a
VPN (WireGuard/Tailscale). Odometry pose comes from the Pi (wheel encoders/IMU); there is no SLAM
yet. `Brain` assumes the sim's room map (`World`) until a real map is configured.
