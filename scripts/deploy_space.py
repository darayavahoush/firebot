#!/usr/bin/env python3
"""Deploy the built Firebot console frontend to Hugging Face Static Space."""
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

readme_content = """---
title: Firebot Tactical Command Console
emoji: 🚒
colorFrom: pink
colorTo: blue
sdk: static
pinned: false
license: mit
---

# Firebot Tactical Operations Console
Interactive Command and Telemetry Dashboard for Autonomous Firefighting Robotics.
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
    commit_message="Deploy Firebot Tactical Console to Hugging Face Static Space",
)
shutil.rmtree(stage_dir)
print(f"Successfully deployed to: https://huggingface.co/spaces/{space_id}")
print("Direct Web URL: https://anabaena-firebot-console.hf.space")
