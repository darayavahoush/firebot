# Architecture

sim/real sensors -> fusion (EIF) -> planning (OMPL / DRL) -> commands -> ESP
                          \-> db (SQLite): sessions, fire_events, sensor_readings, actions

Rule: algorithms depend on interfaces, never on hardware. Sim and real drivers emit the same
data structures, so switching to the robot changes drivers only.

## Roadmap
1. [x] DB layer + tests, EIF fusion + tests, browser visualiser (`web/`)
2. [x] Python sim core (world, sensors, Gymnasium-style env, EIF in the loop)
3. [x] Rule-based confrontation controller (baseline), `firebot-sim` records to both DBs
4. [ ] Planning: RRT*/OMPL
5. [x] DRL: `FireGymEnv` (gymnasium.Env) + PPO (Stable-Baselines3), benchmarked against the
   rule baseline via `firebot-eval` / `v_run_summary`
6. [ ] Pan-tilt aiming
7. [ ] LLM command layer (validated JSON intents), then speech
8. [ ] Hardware drivers (Pi / ESP)
