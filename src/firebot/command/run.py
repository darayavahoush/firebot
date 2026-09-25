"""Operator command line for the simulator: type (or script) natural-language commands.

    firebot-cmd                                   # interactive
    firebot-cmd --script "go to the east side; status; extinguish" --steps 300

Each command is interpreted by the rule parser, validated, executed for `--steps` sim steps
(0.1 s each, or until arrival / fire out), and logged to the ops DB (`voice_commands` +
`actions`). Nothing here needs a language model; `--slm-cmd` optionally plugs one in for
phrasings the rules don't cover (its output is confirmed with the operator before acting).
"""
from __future__ import annotations

import argparse
import time

from firebot.db.store import Store
from firebot.sim.env import DT, FireEnv

from .executor import CommandController, Result
from .intents import Intent
from .parser import Interpreter, slm_from_shell_command


def record(ops: Store, sid: int, text: str, intent: Intent, valid: bool, res: Result) -> None:
    aid = None
    if valid and res.ok and intent.name != "UNKNOWN":
        aid = ops.log_action(sid, intent.name, intent.params, res.message)
    ops.log_voice_command(sid, text, intent.to_json(), valid and res.ok, aid)


def command_and_run(env, ctrl, interp, ops, sid, text, obs, steps, confirm=None):
    """Interpret + execute one command, then advance the sim. Returns (obs, result, done)."""
    intent, valid, reason = interp.interpret(text)
    res = ctrl.handle(intent) if valid else Result(False, f"rejected: {reason}")
    if res.pending is not None and confirm is not None and confirm(res.message):
        res = ctrl.handle(res.pending, confirmed=True)
    record(ops, sid, text, intent, valid, res)
    done = False
    if res.ok and intent.name not in ("STATUS", "STOP"):
        for _ in range(steps):
            obs, _, te, tr, _ = env.step(ctrl.act(obs, env.robot, DT))
            if te or tr:
                done = True
                break
            if ctrl.mode == "IDLE":  # arrived / stopped
                break
    ctrl.obs = obs
    return obs, res, done


def run_script(commands: list[str], seed: int, steps: int, ops_path: str,
               interp: Interpreter | None = None, confirm=None) -> list[str]:
    env, out = FireEnv(), []
    interp = interp or Interpreter()
    obs, _ = env.reset(seed=seed)
    ctrl = CommandController(env.world, seed=seed)
    ctrl.obs, ctrl.pose = obs, env.robot
    with Store(ops_path) as ops:
        ops.seed_default_devices()
        sid = ops.start_session("sim", f"operator commands, seed {seed}")
        for text in commands:
            obs, res, done = command_and_run(env, ctrl, interp, ops, sid, text, obs, steps, confirm)
            ctrl.pose = env.robot
            tail = "" if res.message.startswith("Mode ") else f"  [{ctrl.status()}]"
            out.append(f"> {text}\n  {res.message}{tail}")
            if done:
                out.append("  Episode over: " + ("fire extinguished." if env.fire.p <= 0 else
                                                 "time limit reached."))
                break
        ops.end_session(sid)
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--script", help="semicolon-separated commands (non-interactive)")
    p.add_argument("--steps", type=int, default=100, help="sim steps per command (0.1 s each)")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--ops-db", default="firebot.db")
    p.add_argument("--slm-cmd", help="shell command wrapping a local SLM (prompt on stdin)")
    a = p.parse_args()
    interp = Interpreter(fallback=slm_from_shell_command(a.slm_cmd) if a.slm_cmd else None)
    ask = lambda msg: input(f"  {msg} [y/N] ").strip().lower().startswith("y")
    if a.script:
        cmds = [c.strip() for c in a.script.split(";") if c.strip()]
        print("\n".join(run_script(cmds, a.seed, a.steps, a.ops_db, interp, None)))
        return
    print("Type a command (e.g. 'put out the fire', 'go to the east side', 'status', 'stop'). "
          "Empty line = keep running. Ctrl-D quits.")
    env = FireEnv()
    obs, _ = env.reset(seed=a.seed)
    ctrl = CommandController(env.world, seed=a.seed)
    with Store(a.ops_db) as ops:
        ops.seed_default_devices()
        sid = ops.start_session("sim", f"operator REPL, seed {a.seed}")
        t0 = time.time()
        try:
            while True:
                text = input("> ").strip()
                ctrl.pose = env.robot
                if not text:
                    for _ in range(a.steps):
                        obs, _, te, tr, _ = env.step(ctrl.act(obs, env.robot, DT))
                        if te or tr:
                            break
                    print("  " + ctrl.status())
                    continue
                obs, res, done = command_and_run(env, ctrl, interp, ops, sid, text, obs,
                                                 a.steps, ask)
                ctrl.pose = env.robot
                print(f"  {res.message}  [{ctrl.status()}]")
                if done:
                    print("  Episode over.")
                    break
        except (EOFError, KeyboardInterrupt):
            print()
        ops.end_session(sid)
        print(f"Session logged ({time.time() - t0:.0f}s wall).")


if __name__ == "__main__":
    main()
