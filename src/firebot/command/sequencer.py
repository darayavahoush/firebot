"""Multi-step voice/text commands ("go to the kitchen, then check for fire, then come home")
via LangGraph -- decomposition and sequencing only. LangGraph never classifies or validates a
command itself; every step it produces still goes through the exact same `Interpreter.interpret`
-> `validate()` -> `CommandController.handle` path a single-utterance command would. If that
path rejects a step or requires confirmation, the sequence stops there and reports back --
it never auto-confirms on the operator's behalf, and a STOP anywhere aborts immediately.

Why this is safe to add: it can only ever produce intents the interpreter already accepts, in
the schema `command/intents.py` already defines. Worst case, a bad decomposition just produces
steps that come back UNKNOWN one at a time -- the same failure mode a single misheard utterance
already has today, not a new one.

Requires `pip install langgraph`. `generate`: same `Callable[[str], str]` shape as
`slm_from_shell_command` already uses for `SLMParser` -- pass the exact same local-model wrapper
so this needs no new API keys/accounts, consistent with every other model choice in this repo.
"""
from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import TypedDict

from .executor import CommandController, Result
from .intents import Intent
from .parser import Interpreter

DECOMPOSE_PROMPT = """Split the operator's message into an ordered list of separate robot
commands, as a JSON array of short plain-English strings -- each one one command, in the order
they should happen. If it's already a single command, return a one-element array. If it's not
a robot command at all, return an empty array. No prose, JSON only.

Message: {text}
JSON array:"""


class SeqState(TypedDict):
    text: str
    steps: list[str]
    results: list[dict]   # {"step": str, "intent": str, "ok": bool, "message": str}
    stopped: bool


class Sequencer:
    """`generate`: LLM callable for decomposition only (see module docstring).
    `interp`: the SAME `Interpreter` instance production already uses -- not a separate one --
    so rules-first/SLM-fallback behavior is identical to single-utterance commands.
    `handle`: `CommandController.handle`, called once per validated step.
    """

    def __init__(self, generate: Callable[[str], str], interp: Interpreter,
                handle: Callable[[Intent, bool], Result]) -> None:
        self.generate, self.interp, self.handle = generate, interp, handle
        self._graph = self._build()

    def _decompose(self, state: SeqState) -> SeqState:
        try:
            raw = self.generate(DECOMPOSE_PROMPT.format(text=state["text"]))
            blob = re.search(r"\[.*\]", raw, re.DOTALL)
            steps = json.loads(blob.group(0)) if blob else []
            steps = [s for s in steps if isinstance(s, str) and s.strip()]
        except Exception:  # noqa: BLE001 -- decomposition failure degrades to "no steps found"
            steps = []
        return {**state, "steps": steps}

    def _execute_next(self, state: SeqState) -> SeqState:
        steps, results = list(state["steps"]), list(state["results"])
        step = steps.pop(0)
        intent, valid, reason = self.interp.interpret(step)
        stopped = state["stopped"]
        if not valid:
            results.append({"step": step, "intent": intent.name, "ok": False, "message": reason})
            return {**state, "steps": [], "results": results, "stopped": True}  # bad step: abort
        if intent.needs_confirmation:
            # Never auto-confirm a chained step on the operator's behalf -- report it as
            # pending and stop the sequence here; the operator must explicitly confirm before
            # anything further (chained or not) proceeds, same confirmation gate as always.
            results.append({"step": step, "intent": intent.name, "ok": False,
                           "message": f"needs confirmation: {step!r} -- sequence paused"})
            return {**state, "steps": [], "results": results, "stopped": True}
        res = self.handle(intent, False)
        results.append({"step": step, "intent": intent.name, "ok": res.ok, "message": res.message})
        if intent.name == "STOP":
            stopped = True
            steps = []
        return {**state, "steps": steps, "results": results, "stopped": stopped}

    def _has_more(self, state: SeqState) -> str:
        return "execute" if (state["steps"] and not state["stopped"]) else "end"

    def _build(self):
        from langgraph.graph import END, StateGraph  # imported lazily -- optional dependency
        g = StateGraph(SeqState)
        g.add_node("decompose", self._decompose)
        g.add_node("execute", self._execute_next)
        g.set_entry_point("decompose")
        g.add_conditional_edges("decompose", self._has_more, {"execute": "execute", "end": END})
        g.add_conditional_edges("execute", self._has_more, {"execute": "execute", "end": END})
        return g.compile()

    def run(self, text: str) -> list[dict]:
        """Runs the full decompose -> execute-in-order loop, returns one result dict per step
        actually attempted (may be fewer than the decomposed step count if one stops the
        sequence -- rejection/confirmation/STOP all halt remaining steps, never skip past)."""
        final = self._graph.invoke(SeqState(text=text, steps=[], results=[], stopped=False))
        return final["results"]


def sequencer_from_shell_command(cmd: str, interp: Interpreter, ctrl: CommandController,
                                 timeout: float = 20.0) -> Sequencer:
    """Convenience constructor reusing the exact shell-command wrapping `slm_from_shell_command`
    already uses -- same local model, same invocation mechanism, one more consumer of it."""
    import subprocess

    def generate(prompt: str) -> str:
        return subprocess.run(cmd, shell=True, input=prompt, capture_output=True, text=True,
                              timeout=timeout, check=False).stdout
    return Sequencer(generate, interp, ctrl.handle)
