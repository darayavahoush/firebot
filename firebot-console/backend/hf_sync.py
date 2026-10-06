"""Hugging Face Hub synchronization for Firebot operator models and voiceprints.

Persists and syncs:
  - checkpoints/users/<user>.pt (Personalized Whisper intent classification heads)
  - checkpoints/users/<user>.json (Training evaluations and accuracy metrics)
  - checkpoints/users/<user>.history.jsonl (Historical retrain logs)
  - data/voiceprints/<user>.npy (speaker-ID embeddings; embedder.json/cohort.npy/speaker_calibration.json travel with them)
  - data/calibration/profiles.json (Operator profiles)
  - checkpoints/intent_head.pt, intent_head.json, intent_prototypes.pt (Base models)

Remote Hub:
  - Model Repo: anabaena/firebot-voice-intent
  - Space Repo: anabaena/firebot-console (static dashboard)
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("firebot.hf_sync")

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECKPOINTS_DIR = REPO_ROOT / "checkpoints"
USERS_DIR = CHECKPOINTS_DIR / "users"
VOICEPRINTS_DIR = REPO_ROOT / "data" / "voiceprints"
CALIBRATION_DIR = REPO_ROOT / "data" / "calibration"
PROFILES_FILE = CALIBRATION_DIR / "profiles.json"

DEFAULT_MODEL_REPO = os.environ.get("FIREBOT_HF_MODEL_REPO", "anabaena/firebot-voice-intent")
DEFAULT_SPACE_REPO = os.environ.get("FIREBOT_HF_SPACE_REPO", "anabaena/firebot-console")

_last_sync_time: float | None = None
_last_sync_error: str | None = None


def get_token() -> str | None:
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
    if token:
        return token.strip()
    try:
        from huggingface_hub import get_token as hf_get_token
        return hf_get_token()
    except Exception:
        return None


def get_hf_api(token: str | None = None):
    try:
        from huggingface_hub import HfApi
        return HfApi(token=token or get_token())
    except Exception as e:
        logger.warning("huggingface_hub is not available: %s", e)
        return None


def get_hf_sync_status() -> dict[str, Any]:
    global _last_sync_time, _last_sync_error
    token = get_token()
    api = get_hf_api(token)

    username = None
    if api and token:
        try:
            who = api.whoami()
            username = who.get("name")
        except Exception:
            username = None

    remote_files: list[str] = []
    if api:
        try:
            remote_files = api.list_repo_files(repo_id=DEFAULT_MODEL_REPO, repo_type="model")
        except Exception as e:
            _last_sync_error = str(e)

    local_models = sorted([p.name for p in USERS_DIR.glob("*.pt")]) if USERS_DIR.is_dir() else []
    local_voiceprints = sorted([p.name for p in VOICEPRINTS_DIR.glob("*.npy")]) if VOICEPRINTS_DIR.is_dir() else []

    # Check if local matches remote
    remote_users = set(p.replace("users/", "") for p in remote_files if p.startswith("users/") and p.endswith(".pt"))
    remote_vps = set(p.replace("voiceprints/", "") for p in remote_files if p.startswith("voiceprints/") and p.endswith(".npy"))

    synced = bool(
        remote_users
        and set(local_models).issuperset(remote_users)
        and set(local_voiceprints).issuperset(remote_vps)
    )

    return {
        "enabled": True,
        "token_present": bool(token),
        "user": username or ("anabaena" if token else None),
        "model_repo": DEFAULT_MODEL_REPO,
        "space_repo": DEFAULT_SPACE_REPO,
        "remote_model_files": remote_files,
        "local_user_models": local_models,
        "local_voiceprints": local_voiceprints,
        "synced": synced,
        "last_sync": _last_sync_time,
        "last_error": _last_sync_error,
    }


_VOICEPRINT_META = ("embedder.json", "speaker_calibration.json", "cohort.npy")


def _remote_voiceprints_compatible(files: list[str], repo: str, token: str | None, download) -> bool:
    """Voiceprints from a different speaker embedder are meaningless (and would overwrite fresh
    local ones), so only pull the remote set if its embedder.json matches the active embedder."""
    try:
        import json

        from firebot.speech.speaker_embed import embedder_name
        if "voiceprints/embedder.json" not in files:
            logger.warning("Skipping remote voiceprints: no embedder.json (legacy heuristic voiceprints); "
                           "re-enrol speakers to publish compatible ones")
            return False
        meta = json.loads(Path(download(repo_id=repo, filename="voiceprints/embedder.json",
                                        repo_type="model", token=token)).read_text())
        if meta.get("embedder") != embedder_name():
            logger.warning("Skipping remote voiceprints: made with %r, active embedder is %r",
                           meta.get("embedder"), embedder_name())
            return False
        return True
    except Exception as e:  # noqa: BLE001
        logger.warning("Skipping remote voiceprints (could not verify embedder): %s", e)
        return False


def pull_models_from_hf(repo_id: str | None = None) -> dict[str, Any]:
    """Download all checkpoints, user models, voiceprints, and profiles from Hugging Face Hub."""
    global _last_sync_time, _last_sync_error
    target_repo = repo_id or DEFAULT_MODEL_REPO
    token = get_token()

    try:
        from huggingface_hub import HfApi, hf_hub_download
    except ImportError:
        return {"success": False, "error": "huggingface_hub is not installed", "downloaded": []}

    api = HfApi(token=token)
    try:
        files = api.list_repo_files(repo_id=target_repo, repo_type="model")
    except Exception as e:
        _last_sync_error = str(e)
        logger.warning("Failed to list remote repo files on HF: %s", e)
        return {"success": False, "error": str(e), "downloaded": []}

    downloaded = []
    CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)
    USERS_DIR.mkdir(parents=True, exist_ok=True)
    VOICEPRINTS_DIR.mkdir(parents=True, exist_ok=True)
    CALIBRATION_DIR.mkdir(parents=True, exist_ok=True)

    skip_voiceprints = False
    if any(f.startswith("voiceprints/") for f in files):
        skip_voiceprints = not _remote_voiceprints_compatible(files, target_repo, token, hf_hub_download)

    for rf in files:
        if rf in (".gitattributes", "README.md"):
            continue
        if skip_voiceprints and rf.startswith("voiceprints/"):
            continue
        try:
            cached_path = hf_hub_download(
                repo_id=target_repo,
                filename=rf,
                repo_type="model",
                token=token,
            )
            # Determine destination path
            if rf.startswith("users/"):
                rel_name = rf.replace("users/", "")
                dest = USERS_DIR / rel_name
            elif rf.startswith("voiceprints/"):
                rel_name = rf.replace("voiceprints/", "")
                dest = VOICEPRINTS_DIR / rel_name
            elif rf == "profiles.json":
                dest = PROFILES_FILE
            else:
                dest = CHECKPOINTS_DIR / rf

            dest.parent.mkdir(parents=True, exist_ok=True)
            # Copy or write content
            with open(cached_path, "rb") as sf, open(dest, "wb") as df:
                df.write(sf.read())
            downloaded.append(str(dest.relative_to(REPO_ROOT)))
        except Exception as e:
            logger.warning("Failed to download %s from HF: %s", rf, e)

    _last_sync_time = time.time()
    _last_sync_error = None
    logger.info("Successfully pulled %d model files from Hugging Face Hub (%s)", len(downloaded), target_repo)
    return {
        "success": True,
        "repo": target_repo,
        "count": len(downloaded),
        "downloaded": downloaded,
        "synced_at": _last_sync_time,
    }


def push_models_to_hf(repo_id: str | None = None, user: str | None = None) -> dict[str, Any]:
    """Upload checkpoints, user models, voiceprints, and profiles to Hugging Face Hub."""
    global _last_sync_time, _last_sync_error
    target_repo = repo_id or DEFAULT_MODEL_REPO
    token = get_token()

    if not token:
        return {"success": False, "error": "No Hugging Face token found. Set HF_TOKEN environment variable.", "uploaded": []}

    try:
        from huggingface_hub import HfApi
    except ImportError:
        return {"success": False, "error": "huggingface_hub is not installed", "uploaded": []}

    api = HfApi(token=token)
    uploaded = []

    try:
        api.create_repo(repo_id=target_repo, repo_type="model", exist_ok=True)

        if user:
            # Upload specific user files via upload_file
            to_upload: list[tuple[Path, str]] = []
            for ext in (".pt", ".json", ".history.jsonl"):
                f = USERS_DIR / f"{user}{ext}"
                if f.is_file():
                    to_upload.append((f, f"users/{f.name}"))
            vp = VOICEPRINTS_DIR / f"{user}.npy"
            if vp.is_file():
                to_upload.append((vp, f"voiceprints/{vp.name}"))
                for meta_name in _VOICEPRINT_META:
                    mf = VOICEPRINTS_DIR / meta_name
                    if mf.is_file():
                        to_upload.append((mf, f"voiceprints/{meta_name}"))
            if PROFILES_FILE.is_file():
                to_upload.append((PROFILES_FILE, "profiles.json"))

            for local_path, path_in_repo in to_upload:
                api.upload_file(
                    path_or_fileobj=str(local_path),
                    path_in_repo=path_in_repo,
                    repo_id=target_repo,
                    repo_type="model",
                    commit_message=f"Update operator {user} model ({path_in_repo})",
                )
                uploaded.append(path_in_repo)
        else:
            # Bulk upload using staged temporary folder for single atomic commit
            import shutil
            import tempfile
            with tempfile.TemporaryDirectory() as tmp_dir:
                tmp_path = Path(tmp_dir)
                u_dir = tmp_path / "users"
                vp_dir = tmp_path / "voiceprints"
                u_dir.mkdir(exist_ok=True)
                vp_dir.mkdir(exist_ok=True)

                if USERS_DIR.is_dir():
                    for f in USERS_DIR.glob("*.*"):
                        if f.suffix in (".pt", ".json", ".jsonl"):
                            shutil.copy2(f, u_dir / f.name)
                            uploaded.append(f"users/{f.name}")

                if VOICEPRINTS_DIR.is_dir():
                    for f in [*VOICEPRINTS_DIR.glob("*.npy"),
                              *(VOICEPRINTS_DIR / m for m in _VOICEPRINT_META)]:
                        if f.is_file():
                            shutil.copy2(f, vp_dir / f.name)
                            if f"voiceprints/{f.name}" not in uploaded:
                                uploaded.append(f"voiceprints/{f.name}")

                for base in ("intent_head.pt", "intent_head.json", "intent_prototypes.pt"):
                    f = CHECKPOINTS_DIR / base
                    if f.is_file():
                        shutil.copy2(f, tmp_path / base)
                        uploaded.append(base)

                if PROFILES_FILE.is_file():
                    shutil.copy2(PROFILES_FILE, tmp_path / "profiles.json")
                    uploaded.append("profiles.json")

                api.upload_folder(
                    folder_path=str(tmp_path),
                    repo_id=target_repo,
                    repo_type="model",
                    commit_message="Sync all operator models, voiceprints, and profiles from Firebot Console",
                )

        _last_sync_time = time.time()
        _last_sync_error = None
        logger.info("Successfully pushed %d model files to Hugging Face Hub (%s)", len(uploaded), target_repo)
        return {
            "success": True,
            "repo": target_repo,
            "count": len(uploaded),
            "uploaded": uploaded,
            "synced_at": _last_sync_time,
        }
    except Exception as e:
        _last_sync_error = str(e)
        logger.error("Failed to push models to Hugging Face Hub: %s", e)
        return {"success": False, "error": str(e), "uploaded": uploaded}


def sync_on_startup() -> None:
    """Invoked on backend boot to ensure all operator models & voiceprints are present locally."""
    try:
        status = get_hf_sync_status()
        # If no user models or voiceprints are present locally, or if remote has more, pull from HF
        if not status["local_user_models"] or not status["local_voiceprints"] or not status["synced"]:
            logger.info("Local operator models missing or out of sync with Hugging Face Hub. Pulling...")
            pull_models_from_hf()
        else:
            logger.info("Local operator models and voiceprints are in sync with Hugging Face Hub.")
    except Exception as e:
        logger.warning("Startup Hugging Face sync skipped: %s", e)
