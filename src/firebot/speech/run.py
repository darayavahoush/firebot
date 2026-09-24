"""Voice control for the simulator (offline, Vosk).

    firebot-listen --model ~/models/vosk-model-small-en-us-0.15            # microphone
    firebot-listen --model ~/models/vosk-model-small-en-us-0.15 --wav cmd.wav

Every utterance is logged to `voice_commands` / `actions`, exactly like typed commands. The
sim advances only when a command arrives (no wall-clock loop yet); on the robot the same
Listener runs beside the real control loop.
"""
from __future__ import annotations

import argparse
from collections.abc import Callable, Iterable

from firebot.command.executor import CommandController
from firebot.command.intents import Intent
from firebot.command.parser import Interpreter
from firebot.command.run import command_and_run, record
from firebot.db.store import Store
from firebot.sim.env import FireEnv

from .listener import Heard, Listener
from .recognizer import Recognizer


def listen(chunks: Iterable[bytes], recognizer: Recognizer, seed: int, steps: int, ops_path: str,
           interp: Interpreter | None = None, say: Callable[[str], None] = print) -> list[str]:
    env, log = FireEnv(), []
    interp = interp or Interpreter()
    state = {"obs": env.reset(seed=seed)[0], "done": False}
    ctrl = CommandController(env.world, seed=seed)
    ctrl.obs, ctrl.pose = state["obs"], env.robot

    def emit(line: str) -> None:
        log.append(line)
        say(line)

    with Store(ops_path) as ops:
        ops.seed_default_devices()
        sid = ops.start_session("sim", f"voice control, seed {seed}")

        def on_stop(partial: str) -> None:  # backstop: fires mid-utterance, bypasses interpreter
            res = ctrl.handle(Intent("STOP", text=partial, source="backstop"))
            record(ops, sid, f"[backstop] {partial}", Intent("STOP", text=partial,
                                                            source="backstop"), True, res)
            emit(f"! STOP heard ({partial!r}): {res.message}")

        def on_command(h: Heard) -> None:
            if state["done"]:
                return
            ctrl.pose = env.robot
            state["obs"], res, state["done"] = command_and_run(
                env, ctrl, interp, ops, sid, h.text, state["obs"], steps)
            ctrl.pose = env.robot
            emit(f"> {h.text}\n  {res.message}  [{ctrl.status()}]")
            if state["done"]:
                emit("  Episode over.")

        Listener(recognizer, interp, on_command, on_stop).process(chunks)
        ops.end_session(sid)
    return log


def main() -> None:
    from .audio import mic_chunks, wav_chunks
    from .recognizer import VoskRecognizer

    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", required=True, help="path to an unpacked Vosk model directory")
    p.add_argument("--wav", help="16 kHz mono WAV to transcribe instead of the microphone")
    p.add_argument("--open-vocab", action="store_true",
                   help="disable the restricted grammar (slower, less robust, any words)")
    p.add_argument("--steps", type=int, default=100)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--ops-db", default="firebot.db")
    p.add_argument("--device", help="sounddevice input device index or name")
    a = p.parse_args()
    rec = VoskRecognizer(a.model, restrict=not a.open_vocab)
    if a.wav:
        chunks = wav_chunks(a.wav)
    else:
        print("Listening... say 'put out the fire', 'go to the east side', 'status', 'stop'. "
              "Ctrl-C quits.")
        dev = int(a.device) if a.device and a.device.isdigit() else a.device
        chunks = mic_chunks(device=dev)
    try:
        listen(chunks, rec, a.seed, a.steps, a.ops_db)
    except KeyboardInterrupt:
        print()


if __name__ == "__main__":
    main()
