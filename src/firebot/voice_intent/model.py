"""The only thing actually trained: a small MLP head on top of frozen,
pre-extracted Whisper-encoder embeddings (see features.py). Deliberately
tiny -- with a few hundred to a few thousand embeddings this is the right
model capacity; a bigger head just overfits faster on CPU-scale data."""
from __future__ import annotations

import torch
import torch.nn as nn

from .vocab import NUM_CLASSES


class IntentHead(nn.Module):
    def __init__(self, d_model: int, hidden: int = 128, num_classes: int = NUM_CLASSES,
                 dropout: float = 0.2) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.LayerNorm(d_model),
            nn.Linear(d_model, hidden),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)
