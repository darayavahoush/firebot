"""Unit and integration tests for MM-FusionRL Multimodal Sensor Fusion Architecture."""
from __future__ import annotations

import numpy as np
import pytest
import torch

from firebot.drl.multimodal_env import MultimodalFireGymEnv
from firebot.drl.multimodal_network import MultimodalCrossAttentionExtractor


def test_multimodal_env_creation_and_reset():
    """Verify MultimodalFireGymEnv initializes and exposes structured modalities."""
    env = MultimodalFireGymEnv()
    obs, info = env.reset(seed=123)

    expected_keys = {"thermal", "flame", "gas", "ultrasonic", "eif_belief", "proprio"}
    assert set(obs.keys()) == expected_keys
    assert obs["thermal"].shape == (4,)
    assert obs["flame"].shape == (3,)
    assert obs["gas"].shape == (3,)
    assert obs["ultrasonic"].shape == (4,)
    assert obs["eif_belief"].shape == (4,)
    assert obs["proprio"].shape == (4,)

    assert "fire_x" in info
    assert "fire_y" in info
    assert "eif_sigma" in info


def test_multimodal_env_step_and_reward():
    """Verify environment step dynamics and information-theoretic reward calculation."""
    env = MultimodalFireGymEnv()
    obs, info = env.reset(seed=456)

    action = np.array([0.5, 0.2, -0.1, 0.0], dtype=np.float32)
    next_obs, reward, done, truncated, step_info = env.step(action)

    assert isinstance(reward, float)
    assert not done or done
    assert "success" in step_info
    assert "info_gain" in step_info
    assert step_info["info_gain"] >= 0.0


def test_cross_attention_feature_extractor():
    """Verify PyTorch MultimodalCrossAttentionExtractor tensor transformations."""
    env = MultimodalFireGymEnv()
    obs, _ = env.reset(seed=789)

    extractor = MultimodalCrossAttentionExtractor(
        env.observation_space,
        embed_dim=32,
        num_heads=2,
        features_dim=64,
        num_layers=1,
    )

    extractor.eval()
    batch_obs = {k: torch.tensor(v, dtype=torch.float32).unsqueeze(0) for k, v in obs.items()}
    features = extractor(batch_obs)

    assert features.shape == (1, 64)

    # Test learned adaptive covariance prediction
    cov = extractor.predict_adaptive_covariance(features)
    assert cov.shape == (1, 2)
    assert (cov > 0.0).all()

    # Test attention weights matrix access
    attn = extractor.get_attention_weights()
    assert attn is not None
    assert attn.shape == (1, 6, 6)
    # Check that attention distribution per head sums to ~1 across keys
    assert torch.allclose(attn.sum(dim=-1), torch.ones(1, 6), atol=1e-4)
