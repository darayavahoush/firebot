# FireBot SLM Voice Intent Engine & Self-Hosting Guide

FireBot features an **SLM (Small Language Model) Natural Language Intent Engine** that converts unconstrained operator voice commands and typed natural language into structured robotic actions (`STOP`, `EXTINGUISH`, `GOTO`, `RETURN_HOME`, `STATUS`, `DRIVE`, `PUMP`).

---

## 1. How It Works

1. **Acoustic / Speech Input**:
   - The operator speaks into the browser microphone or uploads an audio clip.
   - The speech is transcribed into natural text via Whisper or the Web Speech API.
2. **SLM Intent Extraction**:
   - The transcribed text is sent to the SLM intent parser (`POST /api/voice/intent`).
   - The SLM maps natural phrasing into structured JSON matching the FireBot robotic command schema:
     ```json
     {
       "intent": "EXTINGUISH",
       "params": {},
       "confidence": 0.95,
       "explanation": "Operator instructed autonomous fire suppression"
     }
     ```
3. **Execution**:
   - If execution is enabled (`execute: true` or the UI's **"Auto-execute recognized intent"** checkbox), FireBot immediately dispatches the command to the hardware bridge (`/manual`, `/estop`) or simulator engine.

---

## 2. Supported SLM Deployment Options

### Option A: Free Hosted Cloud SLM via Groq (Zero Hosting Required)
By default, if `GROQ_API_KEY` is present, FireBot automatically uses Groq's high-speed hosted SLM:
- **Model**: `llama-3.2-1b-preview` (1B parameter Small Language Model) or `llama-3.2-3b-preview`
- **Latency**: ~80ms - 150ms
- **Cost**: 100% Free Tier
- **Setup**: No hosting or servers needed; simply keep `GROQ_API_KEY` set.

---

### Option B: Self-Hosted with Ollama (Local Machine, Docker, or Cloud VM)
You can run any open-source SLM locally using Ollama:
```bash
# 1. Install Ollama and pull an ultra-fast SLM
ollama pull qwen2.5:0.5b
# or
ollama pull smollm2:135m
# or
ollama pull llama3.2:1b

# 2. Run Ollama (listens on http://localhost:11434 by default)
ollama serve
```

Configure FireBot to point to your Ollama instance:
```bash
export FIREBOT_SLM_URL="http://localhost:11434/v1"
export FIREBOT_SLM_MODEL="qwen2.5:0.5b"
```

---

### Option C: Standalone Python Server (`scripts/host_slm.py`)
FireBot includes a dedicated lightweight FastAPI server script that can run on any Linux/Mac server, Render web service, or Raspberry Pi:
```bash
# 1. Install dependencies
pip install transformers torch uvicorn fastapi

# 2. Start the SLM server (runs on port 8080)
python scripts/host_slm.py --model Qwen/Qwen2.5-0.5B-Instruct --port 8080
```

Configure FireBot:
```bash
export FIREBOT_SLM_URL="http://localhost:8080/v1"
export FIREBOT_SLM_MODEL="Qwen/Qwen2.5-0.5B-Instruct"
```

---

### Option D: Local Shell CLI Execution
If you prefer direct CLI piping:
```bash
export FIREBOT_SLM_CMD="ollama run qwen2.5:0.5b"
```

---

## 3. Environment Variables Reference

| Variable | Description | Default |
| :--- | :--- | :--- |
| `FIREBOT_SLM_URL` | OpenAI-compatible endpoint URL (e.g. `http://localhost:11434/v1`) | None (falls back to Groq if key present) |
| `FIREBOT_SLM_MODEL` | SLM model identifier | `llama-3.2-1b-preview` (Groq) or `qwen2.5:0.5b` (Ollama) |
| `FIREBOT_SLM_API_KEY` | Bearer token / API key for custom endpoint | None |
| `GROQ_API_KEY` | Groq API key for hosted Whisper & Llama 3.2 1B SLM | Configured |
| `FIREBOT_SLM_CMD` | Shell CLI command to run local SLM on stdin | None |

---

## 4. Robotic Command Schema

| Intent | Triggers / Example Utterances | Parameters |
| :--- | :--- | :--- |
| `STOP` | "Freeze", "Stop right now", "Emergency stop", "Shut off water" | `{}` |
| `EXTINGUISH` | "Put out the fire in the kitchen", "Spray the flames", "Tackle the blaze" | `{}` |
| `GOTO` | "Head over to coordinate 7, 3", "Move to the north corner" | `{"x": float, "y": float}` |
| `RETURN_HOME`| "Return to base", "Go back to dock", "Retreat" | `{}` |
| `STATUS` | "How much water is left?", "Report battery status", "Sitrep" | `{}` |
| `DRIVE` | "Drive forward a bit", "Rotate left 45 degrees" | `{"dir": "fwd"\|"back"\|"left"\|"right", "speed": 10-100}` |
| `PUMP` | "Turn on the water pump", "Stop spraying" | `{"on": true\|false}` |
