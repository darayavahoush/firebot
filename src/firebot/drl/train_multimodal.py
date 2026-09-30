"""Train the Multimodal Cross-Attention DRL Sensor Fusion Policy (MM-FusionRL).

Usage:
    firebot-train-multimodal --timesteps 200000 --n-envs 4 --seed 42 --out runs/mm_fusion

Integrates:
  - MultimodalFireGymEnv with information-theoretic active sensing rewards
  - MultimodalCrossAttentionExtractor (Transformer-based sensor fusion)
  - PPO Actor-Critic with hardware acceleration (MPS/CUDA)
  - Curriculum learning support (Stage 1..3 procedural environments)
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback, CheckpointCallback
from stable_baselines3.common.env_util import make_vec_env

from firebot.drl.curriculum import make_curriculum_env
from firebot.drl.multimodal_env import MultimodalFireGymEnv
from firebot.drl.multimodal_network import MultimodalCrossAttentionExtractor


class AttentionLoggingCallback(BaseCallback):
    """Logs cross-attention weights and information gain telemetry."""

    def __init__(self, log_freq: int = 1000, verbose: int = 0) -> None:
        super().__init__(verbose)
        self.log_freq = log_freq

    def _on_step(self) -> bool:
        if self.n_calls % self.log_freq == 0:
            extractor = getattr(
                getattr(self.model.policy, "features_extractor", None),
                "get_attention_weights",
                None,
            )
            if extractor:
                attn = extractor()
                if attn is not None:
                    mean_attn = attn.mean(dim=0).cpu().numpy()
                    # Log diagonal self-attention vs off-diagonal cross-attention
                    self.logger.record("fusion/mean_cross_attention", float(mean_attn.mean()))
        return True


def train_multimodal(
    timesteps: int = 200_000,
    n_envs: int = 4,
    seed: int = 42,
    learning_rate: float = 3e-4,
    n_steps: int = 1024,
    batch_size: int = 64,
    gamma: float = 0.99,
    out_dir: str = "runs/mm_fusion",
    stage: int | None = None,
    checkpoint_every: int = 25_000,
) -> PPO:
    """Train publication-grade MM-FusionRL model."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    # Determine device: Apple Silicon Metal (MPS), CUDA, or CPU
    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"
    print(f"-> Training MM-FusionRL on device: {device}")

    # Environment setup
    if stage is not None:
        print(f"-> Curriculum Stage {stage} active")
        env_fn = lambda: make_curriculum_env(stage=stage, seed=seed)
        vec_env = make_vec_env(env_fn, n_envs=n_envs, seed=seed)
    else:
        vec_env = make_vec_env(
            MultimodalFireGymEnv,
            n_envs=n_envs,
            seed=seed,
            monitor_dir=str(out / "monitor"),
        )

    # Policy configuration with Multimodal Cross-Attention Backbone
    policy_kwargs = dict(
        features_extractor_class=MultimodalCrossAttentionExtractor,
        features_extractor_kwargs=dict(
            embed_dim=64,
            num_heads=4,
            features_dim=128,
            num_layers=2,
        ),
        net_arch=dict(pi=[128, 64], vf=[128, 64]),
        activation_fn=torch.nn.GELU,
    )

    model = PPO(
        "MultiInputPolicy",
        vec_env,
        learning_rate=learning_rate,
        n_steps=n_steps,
        batch_size=batch_size,
        gamma=gamma,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.01,
        vf_coef=0.5,
        max_grad_norm=0.5,
        policy_kwargs=policy_kwargs,
        verbose=1,
        seed=seed,
        device=device,
        tensorboard_log=str(out / "tb"),
    )

    checkpoint_callback = CheckpointCallback(
        save_freq=max(1, checkpoint_every // n_envs),
        save_path=str(out / "checkpoints"),
        name_prefix="mm_fusion_ckpt",
    )
    attn_callback = AttentionLoggingCallback(log_freq=2000)

    print("-> Commencing multimodal reinforcement learning optimization...")
    model.learn(
        total_timesteps=timesteps,
        callback=[checkpoint_callback, attn_callback],
        progress_bar=False,
    )

    final_model_path = out / "mm_fusion_final.zip"
    model.save(str(final_model_path))
    print(f"-> Model saved to {final_model_path}")

    return model


def main() -> None:
    parser = argparse.ArgumentParser(description="Train MM-FusionRL Multimodal Sensor Fusion Policy")
    parser.add_argument("--timesteps", type=int, default=100_000, help="Total training steps")
    parser.add_argument("--n-envs", type=int, default=4, help="Parallel environments")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--lr", type=float, default=3e-4, help="Learning rate")
    parser.add_argument("--out", type=str, default="runs/mm_fusion", help="Output directory")
    parser.add_argument("--stage", type=int, default=None, help="Curriculum stage (1, 2, or 3)")
    args = parser.parse_args()

    train_multimodal(
        timesteps=args.timesteps,
        n_envs=args.n_envs,
        seed=args.seed,
        learning_rate=args.lr,
        out_dir=args.out,
        stage=args.stage,
    )


if __name__ == "__main__":
    main()
