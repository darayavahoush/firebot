"""
Host your own ultra-lightweight Small Language Model (SLM) for FireBot.

Runs an OpenAI-compatible API server using FastAPI and Hugging Face transformers.
Compatible with models like:
- Qwen/Qwen2.5-0.5B-Instruct (Recommended: 350MB VRAM/RAM, excellent JSON output)
- HuggingFaceTB/SmolLM2-135M-Instruct (Ultra-small: 135M params, runs on a Raspberry Pi or 256MB RAM)
- HuggingFaceTB/SmolLM2-360M-Instruct

Usage:
    python host_slm.py --model Qwen/Qwen2.5-0.5B-Instruct --port 8080
    
Then point FireBot to it:
    export FIREBOT_SLM_URL=http://localhost:8080/v1
"""
from __future__ import annotations

import argparse
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Dict, Any

app = FastAPI(title="FireBot SLM Intent Server")
model_pipeline = None
model_name = ""

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatCompletionRequest(BaseModel):
    model: str = ""
    messages: List[ChatMessage]
    temperature: float = 0.0
    max_tokens: int = 150

@app.post("/v1/chat/completions")
@app.post("/chat/completions")
def chat_completions(req: ChatCompletionRequest) -> Dict[str, Any]:
    global model_pipeline
    if model_pipeline is None:
        return {"choices": [{"message": {"content": '{"intent": "UNKNOWN", "params": {}}'}}]}

    # Format chat with chat template
    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    outputs = model_pipeline(
        messages,
        max_new_tokens=req.max_tokens,
        temperature=max(0.01, req.temperature),
        do_sample=req.temperature > 0.0,
    )
    content = outputs[0]["generated_text"][-1]["content"]

    return {
        "id": "slm-chatcmpl",
        "object": "chat.completion",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop"
            }
        ]
    }

@app.get("/health")
def health():
    return {"status": "ok", "model": model_name}

def main():
    global model_pipeline, model_name
    parser = argparse.ArgumentParser(description="Host a lightweight SLM for FireBot")
    parser.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct", help="Hugging Face model ID")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on")
    parser.add_argument("--host", default="0.0.0.0", help="Host address")
    args = parser.parse_args()

    model_name = args.model
    print(f"Loading SLM: {model_name}...")
    try:
        from transformers import pipeline
        model_pipeline = pipeline("text-generation", model=model_name, device_map="auto")
        print(f"SLM loaded successfully. Starting server on http://{args.host}:{args.port}")
    except Exception as e:
        print(f"Failed to load model pipeline: {e}")
        print("Ensure 'transformers' and 'torch' or 'accelerate' are installed: pip install transformers torch")

    uvicorn.run(app, host=args.host, port=args.port)

if __name__ == "__main__":
    main()
