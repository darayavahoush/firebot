#!/usr/bin/env python3
"""Deploy the built Firebot console frontend and all operator models to Hugging Face Static Space."""
import shutil
from pathlib import Path
from huggingface_hub import HfApi, get_token

root = Path(__file__).resolve().parents[1]
dist_dir = root / "firebot-console" / "frontend" / "dist"
if not dist_dir.is_dir():
    raise SystemExit("Error: frontend dist directory does not exist. Run 'npm run build' first.")

stage_dir = root / "hf_static_space"
if stage_dir.exists():
    shutil.rmtree(stage_dir)
shutil.copytree(dist_dir, stage_dir)

# Stage all operator models, voiceprints, and profiles into the static space
models_stage = stage_dir / "models"
models_stage.mkdir(parents=True, exist_ok=True)
users_stage = models_stage / "users"
voiceprints_stage = models_stage / "voiceprints"
users_stage.mkdir(parents=True, exist_ok=True)
voiceprints_stage.mkdir(parents=True, exist_ok=True)

# Copy user models
users_src = root / "checkpoints" / "users"
if users_src.is_dir():
    for f in users_src.glob("*.*"):
        if f.suffix in (".pt", ".json", ".jsonl"):
            shutil.copy2(f, users_stage / f.name)

# Copy voiceprints
vp_src = root / "data" / "voiceprints"
if vp_src.is_dir():
    for f in vp_src.glob("*.npy"):
        shutil.copy2(f, voiceprints_stage / f.name)

# Copy base checkpoints & profiles
for base in ("intent_head.pt", "intent_head.json", "intent_prototypes.pt"):
    bp = root / "checkpoints" / base
    if bp.is_file():
        shutil.copy2(bp, models_stage / base)

prof_file = root / "data" / "calibration" / "profiles.json"
if prof_file.is_file():
    shutil.copy2(prof_file, models_stage / "profiles.json")

readme_content = """---
title: Firebot Tactical Command Console
emoji: 🚒
colorFrom: red
colorTo: blue
sdk: static
pinned: false
license: mit
---

# Firebot Tactical Operations Console

Interactive Command and Telemetry Dashboard for Autonomous Firefighting Robotics.

Live Web App: [anabaena-firebot-console.hf.space](https://anabaena-firebot-console.hf.space)
Backend API: [firebot-api.onrender.com](https://firebot-api.onrender.com)
Hugging Face Model Hub: [anabaena/firebot-voice-intent](https://huggingface.co/anabaena/firebot-voice-intent)

## Architecture & Technology Stack

1. **Perception & State Estimation**:
   - Extended Information Filter (EIF bearing-only flame localization with dynamic 2-sigma uncertainty covariance).
   - Pose EKF (differential drive odometry with gyro/IMU yaw fusion).
   - Robust anomaly detection (median/MAD physical fault detector).

2. **Planning & Autonomous Robotics Control**:
   - Informed RRT* Path Planning on inflated occupancy grids.
   - Pure-pursuit path tracking and trajectory smoothing.
   - Frontier Exploration (occupancy grid from 36-ray lidar sweeps, BFS frontier routing).
   - 360° Lidar Avoidance (gap-following controller).

3. **Natural Language SLM Intent Engine & Groq Acceleration**:
   - Hosted SLM Intent Engine (`allam-2-7b` / `qwen/qwen3.8-27b` on Groq): Zero-temperature structured JSON intent generation with strict robotics schema validation.
   - Sub-200ms latency inference for arbitrary conversational operator phrases.
   - Automatic execution pipeline: converts natural language intents into autonomous commands (`DRIVE`, `GOTO`, `EXTINGUISH`, `PATROL`, `STOP`).

4. **Operator Voice Studio & Personal Acoustic Adaptation**:
   - Browser-native 16 kHz AudioWorklet recording with real-time waveform visualizer.
   - Per-Operator Personalized Whisper Classifier Heads: fine-tuned on frozen Whisper encoder embeddings with L2-SP pull.
   - ECAPA-TDNN Speaker Verification: cosine similarity matching across enrolled operator voiceprints (`ananya` and `avinandan`).

5. **Hugging Face Model Cloud Persistence**:
   - Every operator model and voiceprint is stored on Hugging Face Hub (`anabaena/firebot-voice-intent`) and served in this Space:
     - `/models/users/{user}.pt`: Personalized Whisper classifier heads.
     - `/models/users/{user}.json`: Training evaluations and accuracy metrics.
     - `/models/voiceprints/{user}.npy`: ECAPA-TDNN acoustic embeddings.
     - `/models/profiles.json`: Active operator profiles.
     - `/models/intent_head.pt`, `/models/intent_prototypes.pt`: Base intent classifiers.

6. **Cloud Telemetry Sink & Storage**:
   - Render PostgreSQL (`firebot-db`, `dpg-daukj1k9v7es739ubf10-a`) with connection pooling (`asyncpg`).
   - 24x32 MLX90640 radiometric thermal array storage and historical playback scrubber.
   - Auto-seeded mission sorties with full telemetry frames.

7. **MuJoCo 3D Procedural Physics Simulation**:
   - 8-room procedural architectural layouts (Datacenter, Hazmat Lab, Control Room, etc.).
   - Real-time Three.js WebGL rendering with 4 camera modes (Orbit, Chase follow, FPV rover, Tactical top-down).
   - Volumetric GPU particle systems (turbulent smoke plumes, thermal embers, water mist extinguisher spray).
"""
(stage_dir / "README.md").write_text(readme_content)

token = get_token()
api = HfApi(token=token)
space_id = "anabaena/firebot-console"

print(f"Deploying to Hugging Face Space: {space_id}...")
api.create_repo(repo_id=space_id, repo_type="space", space_sdk="static", exist_ok=True)
commit = api.upload_folder(
    folder_path=str(stage_dir),
    repo_id=space_id,
    repo_type="space",
    commit_message="Deploy Firebot Tactical Console & all operator models to Hugging Face Space",
)
shutil.rmtree(stage_dir)
print(f"Successfully deployed to: https://huggingface.co/spaces/{space_id}")
print("Direct Web URL: https://anabaena-firebot-console.hf.space")
