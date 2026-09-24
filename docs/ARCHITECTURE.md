# Architecture

sim/real sensors -> fusion (EIF) -> planning (OMPL / DRL) -> commands -> ESP
                          \-> db (SQLite): sessions, fire_events, sensor_readings, actions

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
6. [ ] Pan-tilt aiming
7. [x] Command layer: rule-based intent parser -> validated JSON intents -> executor; optional
   local SLM fallback (confirm-before-act), logged to `voice_commands`/`actions`;
   `firebot-cmd`. Speech (offline ASR feeding the same interpreter) still to do
8. [ ] Hardware drivers (Pi / ESP)

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
