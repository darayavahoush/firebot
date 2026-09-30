"""Cross-Attention Multimodal Feature Extractor for Deep Reinforcement Learning.

Architecture:
  1. Modality-Specific Tokenizers:
     - Thermal Vision Token (MLX90640) -> d_embed
     - Flame Phototransistor Token (IR array) -> d_embed
     - Chemical Gas Token (MQ-2 gradient) -> d_embed
     - Acoustic Sonar Token (Ultrasonic envelope) -> d_embed
     - Bayesian EIF Belief Token -> d_embed
     - Proprioceptive Dynamics Token -> d_embed
  2. Modality Identity Embeddings
  3. Multi-Head Self/Cross-Attention Transformer Block:
     - Captures inter-modal dependencies and complementary cross-verification
     - Computes interpretable attention matrices across sensor streams
  4. Non-Linear Fusion MLP:
     - Outputs latent state representation for Actor-Critic heads
     - Auxiliary head for learned adaptive measurement covariance (R_t)
"""
from __future__ import annotations

import gymnasium as gym
import torch
import torch.nn as nn
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor


class MultimodalCrossAttentionExtractor(BaseFeaturesExtractor):
    """Publication-grade Multi-Head Cross-Attention Sensor Fusion Backbone."""

    def __init__(
        self,
        observation_space: gym.spaces.Dict,
        embed_dim: int = 64,
        num_heads: int = 4,
        features_dim: int = 128,
        num_layers: int = 2,
    ) -> None:
        super().__init__(observation_space, features_dim=features_dim)

        self.embed_dim = embed_dim
        self.num_heads = num_heads
        self.modalities = ["thermal", "flame", "gas", "ultrasonic", "eif_belief", "proprio"]
        self.num_modalities = len(self.modalities)

        # Modality Tokenizers
        self.tokenizers = nn.ModuleDict(
            {
                "thermal": nn.Sequential(
                    nn.Linear(4, embed_dim),
                    nn.GELU(),
                    nn.Linear(embed_dim, embed_dim),
                ),
                "flame": nn.Sequential(
                    nn.Linear(3, embed_dim),
                    nn.GELU(),
                    nn.Linear(embed_dim, embed_dim),
                ),
                "gas": nn.Sequential(
                    nn.Linear(3, embed_dim),
                    nn.GELU(),
                    nn.Linear(embed_dim, embed_dim),
                ),
                "ultrasonic": nn.Sequential(
                    nn.Linear(4, embed_dim),
                    nn.GELU(),
                    nn.Linear(embed_dim, embed_dim),
                ),
                "eif_belief": nn.Sequential(
                    nn.Linear(4, embed_dim),
                    nn.GELU(),
                    nn.Linear(embed_dim, embed_dim),
                ),
                "proprio": nn.Sequential(
                    nn.Linear(4, embed_dim),
                    nn.GELU(),
                    nn.Linear(embed_dim, embed_dim),
                ),
            }
        )

        # Learnable modality position/type embeddings
        self.modality_embeddings = nn.Parameter(
            torch.randn(1, self.num_modalities, embed_dim) * 0.02
        )

        # Transformer Cross-Attention Layers
        self.attention_layers = nn.ModuleList(
            [
                nn.MultiheadAttention(
                    embed_dim=embed_dim,
                    num_heads=num_heads,
                    batch_first=True,
                    dropout=0.05,
                )
                for _ in range(num_layers)
            ]
        )
        self.norm_layers_1 = nn.ModuleList([nn.LayerNorm(embed_dim) for _ in range(num_layers)])
        self.norm_layers_2 = nn.ModuleList([nn.LayerNorm(embed_dim) for _ in range(num_layers)])

        self.ffn_layers = nn.ModuleList(
            [
                nn.Sequential(
                    nn.Linear(embed_dim, embed_dim * 2),
                    nn.GELU(),
                    nn.Dropout(0.05),
                    nn.Linear(embed_dim * 2, embed_dim),
                )
                for _ in range(num_layers)
            ]
        )

        # Final projection to features_dim
        self.post_norm = nn.LayerNorm(embed_dim * self.num_modalities)
        self.fusion_mlp = nn.Sequential(
            nn.Linear(embed_dim * self.num_modalities, 256),
            nn.GELU(),
            nn.Dropout(0.05),
            nn.Linear(256, features_dim),
            nn.LayerNorm(features_dim),
        )

        # Auxiliary Head: Learned Adaptive EIF Measurement Covariance [sigma_thermal, sigma_flame]
        self.aux_covariance_head = nn.Sequential(
            nn.Linear(features_dim, 64),
            nn.GELU(),
            nn.Linear(64, 2),
            nn.Softplus(),  # strictly positive variances
        )

        # Cache for attention interpretability plotting
        self.last_attention_weights: torch.Tensor | None = None

    def forward(self, observations: dict[str, torch.Tensor]) -> torch.Tensor:
        batch_size = next(iter(observations.values())).shape[0]

        # 1. Project individual sensor modalities into shared latent embedding space
        tokens = []
        for name in self.modalities:
            obs = observations[name].float()
            token = self.tokenizers[name](obs)  # [Batch, embed_dim]
            tokens.append(token)

        # Stack into sequence: [Batch, num_modalities, embed_dim]
        x = torch.stack(tokens, dim=1)
        x = x + self.modality_embeddings

        # 2. Multi-Head Cross/Self-Attention Blocks
        for mha, norm1, ffn, norm2 in zip(
            self.attention_layers,
            self.norm_layers_1,
            self.ffn_layers,
            self.norm_layers_2,
        ):
            # Attention with residual connection
            attn_out, weights = mha(x, x, x, need_weights=True)
            self.last_attention_weights = weights.detach()
            x = norm1(x + attn_out)

            # Feed-Forward with residual connection
            ffn_out = ffn(x)
            x = norm2(x + ffn_out)

        # 3. Concatenate all modality tokens & apply fusion MLP
        flat = x.reshape(batch_size, -1)
        flat = self.post_norm(flat)
        features = self.fusion_mlp(flat)

        return features

    def predict_adaptive_covariance(self, features: torch.Tensor) -> torch.Tensor:
        """Predict adaptive measurement noise std dev: [sigma_thermal, sigma_flame]."""
        return self.aux_covariance_head(features) + 0.01

    def get_attention_weights(self) -> torch.Tensor | None:
        """Retrieve the last forward pass cross-attention matrix [Batch, 6, 6]."""
        return self.last_attention_weights
