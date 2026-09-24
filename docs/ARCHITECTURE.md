# Architecture

sim/real sensors -> fusion (EIF) -> planning (OMPL / DRL) -> commands -> ESP
                          \-> db (SQLite): sessions, fire_events, sensor_readings, actions

Rule: algorithms depend on interfaces, never on hardware. Sim and real drivers emit the same
data structures, so switching to the robot changes drivers only.

## Roadmap
1. [x] DB layer + tests, EIF fusion + tests, browser visualiser (`web/`)
2. [ ] Python sim core (world, fire/gas model, sensor models)
3. [ ] Rule-based confrontation FSM (baseline)
4. [ ] Planning: RRT*/OMPL
5. [ ] Gymnasium env + DRL, benchmarked against baseline
6. [ ] Pan-tilt aiming
7. [ ] LLM command layer (validated JSON intents), then speech
8. [ ] Hardware drivers (Pi / ESP)
