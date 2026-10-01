"""
firebot.slm_intent — Small Language Model (SLM) Natural Language Intent Engine.

Translates any natural-language operator voice or text command into structured robot intents
and parameters (STOP, EXTINGUISH, GOTO, RETURN_HOME, STATUS, DRIVE, PUMP, UNKNOWN),
then executes them on the FireBot hardware or simulator.

Supports:
1. Hosted Free Cloud SLM via Groq (llama-3.2-1b-preview / llama-3.2-3b-preview) — default when GROQ_API_KEY is present.
2. Self-Hosted Local/Remote SLM via OpenAI-compatible API (Ollama, vLLM, llama-cpp-python, etc.) via FIREBOT_SLM_URL.
3. Local shell CLI execution via FIREBOT_SLM_CMD.
4. Robust deterministic fallback to RuleParser if SLM is unavailable or offline.
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
from typing import Any

import httpx

from firebot.command.parser import RuleParser, PLACES, normalise

logger = logging.getLogger("firebot.slm")

# Environment configurations
SLM_URL = os.environ.get("FIREBOT_SLM_URL", "").rstrip("/")
SLM_MODEL = os.environ.get("FIREBOT_SLM_MODEL", "")
SLM_API_KEY = os.environ.get("FIREBOT_SLM_API_KEY", "")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
SLM_CMD = os.environ.get("FIREBOT_SLM_CMD", "")

# Default model selections
DEFAULT_GROQ_MODEL = "llama-3.2-1b-preview"
DEFAULT_OLLAMA_MODEL = "qwen2.5:0.5b"

SYSTEM_PROMPT = """You are an AI intent parser for FireBot, an autonomous firefighting robot.
Your job is to parse any operator voice or text message into a single JSON command.

Allowed intents and parameters:
1. STOP: {"intent": "STOP", "params": {}}
   - Triggers: emergency stop, halt, freeze, abort, cut pump, hold position, shut down.
2. EXTINGUISH: {"intent": "EXTINGUISH", "params": {}}
   - Triggers: put out the fire, douse flames, spray water, fight fire, autonomous suppression, search and destroy fire, tackle the blaze.
3. GOTO: {"intent": "GOTO", "params": {"x": float, "y": float}}
   - Triggers: move, go, navigate, head to a location or coordinate.
   - Known locations on 12m (x) by 8m (y) map:
     * home / base / dock: x=1.2, y=1.0
     * center / middle: x=6.0, y=4.0
     * north: x=6.0, y=7.0
     * south: x=6.0, y=1.0
     * east: x=10.5, y=4.0
     * west: x=2.0, y=4.0
     * northeast: x=10.5, y=7.0
     * northwest: x=1.5, y=7.0
     * southeast: x=10.5, y=1.0
     * southwest: x=1.5, y=1.2
4. RETURN_HOME: {"intent": "RETURN_HOME", "params": {}}
   - Triggers: return home, go back to dock, retreat, return to charging base.
5. STATUS: {"intent": "STATUS", "params": {}}
   - Triggers: report status, what is your battery, water level, sitrep, where are you, check telemetry.
6. DRIVE: {"intent": "DRIVE", "params": {"dir": "fwd"|"back"|"left"|"right"|"stop", "speed": 10-100}}
   - Triggers: drive forward, turn left, steer right, reverse, move ahead.
7. PUMP: {"intent": "PUMP", "params": {"on": true|false}}
   - Triggers: turn on pump, start spraying, turn off pump.
8. UNKNOWN: {"intent": "UNKNOWN", "params": {}}
   - If the message is unrelated chatter or completely unparseable.

Output ONLY a valid JSON object in this exact schema:
{"intent": "<INTENT_NAME>", "params": {...}, "explanation": "<brief rationale>"}
Do not output markdown backticks, prose, or explanations outside the JSON."""

_rule_parser = RuleParser()


def _extract_json(raw: str) -> dict[str, Any] | None:
    """Extract a JSON dictionary from an LLM/SLM response string."""
    raw = raw.strip()
    # Strip markdown code fencing if present
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    # Search for { ... }
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return None


async def _query_http_slm(endpoint: str, model: str, api_key: str, text: str) -> dict[str, Any] | None:
    """Query an OpenAI-compatible /chat/completions endpoint."""
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Operator voice command: {text}"},
        ],
        "temperature": 0.0,
        "max_tokens": 150,
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(endpoint, json=payload, headers=headers)
        if r.status_code != 200:
            logger.warning("SLM request to %s failed (%s): %s", endpoint, r.status_code, r.text[:200])
            return None
        res_data = r.json()
        content = res_data["choices"][0]["message"]["content"]
        return _extract_json(content)


def _query_cli_slm(cmd: str, text: str) -> dict[str, Any] | None:
    """Execute a local SLM shell command (e.g. ollama CLI)."""
    prompt = f"{SYSTEM_PROMPT}\n\nOperator message: {text}\nJSON:"
    try:
        proc = subprocess.run(
            cmd, shell=True, input=prompt, capture_output=True, text=True, timeout=15, check=False
        )
        if proc.returncode == 0 and proc.stdout:
            return _extract_json(proc.stdout)
    except Exception as e:
        logger.warning("CLI SLM failed: %s", e)
    return None


async def parse_intent_slm(text: str) -> dict[str, Any]:
    """Parse an utterance into a structured intent using the active SLM, with rule fallback."""
    cleaned = normalise(text)
    if not cleaned:
        return {"intent": "UNKNOWN", "params": {}, "confidence": 0.0, "source": "empty", "explanation": "No speech detected"}

    slm_result: dict[str, Any] | None = None

    # 1. Custom self-hosted endpoint (Ollama, vLLM, custom microservice)
    if SLM_URL:
        endpoint = f"{SLM_URL}/chat/completions" if not SLM_URL.endswith("/chat/completions") else SLM_URL
        model = SLM_MODEL or DEFAULT_OLLAMA_MODEL
        try:
            slm_result = await _query_http_slm(endpoint, model, SLM_API_KEY, cleaned)
        except Exception as e:
            logger.warning("Error querying custom SLM (%s): %s", endpoint, e)

    # 2. Free hosted Groq SLM (Llama 3.2 1B / 3B) if no custom URL specified
    elif GROQ_API_KEY:
        endpoint = "https://api.groq.com/openai/v1/chat/completions"
        model = SLM_MODEL or DEFAULT_GROQ_MODEL
        try:
            slm_result = await _query_http_slm(endpoint, model, GROQ_API_KEY, cleaned)
        except Exception as e:
            logger.warning("Error querying Groq SLM: %s", e)

    # 3. Local CLI command
    elif SLM_CMD:
        slm_result = _query_cli_slm(SLM_CMD, cleaned)

    # Process SLM output if valid
    if slm_result and "intent" in slm_result:
        raw_intent = str(slm_result.get("intent", "UNKNOWN")).upper().strip()
        params = slm_result.get("params") or {}
        explanation = slm_result.get("explanation") or f"Recognized by SLM as {raw_intent}"

        if raw_intent in ("STOP", "EXTINGUISH", "RETURN_HOME", "STATUS", "DRIVE", "PUMP", "GOTO", "UNKNOWN"):
            # Sanitize coordinates if GOTO
            if raw_intent == "GOTO":
                try:
                    params["x"] = max(0.5, min(11.5, float(params.get("x", 6.0))))
                    params["y"] = max(0.5, min(7.5, float(params.get("y", 4.0))))
                except (ValueError, TypeError):
                    params = {"x": 6.0, "y": 4.0}
            return {
                "intent": raw_intent,
                "params": params,
                "confidence": 0.95,
                "source": "slm",
                "explanation": explanation,
                "text": text,
            }

    # 4. Fallback to deterministic RuleParser
    rule_intent = _rule_parser.parse(text)
    return {
        "intent": rule_intent.name,
        "params": rule_intent.params,
        "confidence": rule_intent.confidence,
        "source": "rules",
        "explanation": f"Classified by deterministic grammar as {rule_intent.name}",
        "text": text,
    }


def describe_intent(intent_name: str, params: dict[str, Any]) -> str:
    """Human-readable action description for an intent."""
    if intent_name == "STOP":
        return "Emergency stop: motor & water pump halted."
    if intent_name == "EXTINGUISH":
        return "Autonomous firefighting: search & suppress fire."
    if intent_name == "RETURN_HOME":
        return "Returning to docking base (1.2m, 1.0m)."
    if intent_name == "GOTO":
        x = params.get("x", 6.0)
        y = params.get("y", 4.0)
        return f"Navigating to waypoint ({x:.1f}m, {y:.1f}m)."
    if intent_name == "STATUS":
        return "System telemetry and battery/tank audit requested."
    if intent_name == "DRIVE":
        direction = params.get("dir", "fwd")
        speed = params.get("speed", 50)
        return f"Teleoperation drive: {direction} at {speed}% speed."
    if intent_name == "PUMP":
        state = "ON" if params.get("on", True) else "OFF"
        return f"Water pump actuator switched {state}."
    return "No matching robotic action found."
