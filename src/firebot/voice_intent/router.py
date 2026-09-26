"""ShadowRouter: an online, auditable policy deciding when to trust the local
voice-intent classifier standalone vs. double-checking it against Groq+regex.

Why a Thompson-sampling bandit over confidence-decile buckets, not a deep net:
  * The context is 1-D (the classifier's own confidence score) and the only decision is
    binary (trust standalone / double-check) -- a full policy network is the wrong tool for
    a problem this small, and would need far more traffic to fit than this robot will ever
    generate.
  * This is a safety-relevant robot-command router. A Beta-Bernoulli posterior per bucket is
    fully inspectable at any time (`bucket_stats()`) -- an operator can look at "requests in
    the 80-90% confidence decile agreed with Groq 94% of the time" and reason about that
    directly. A trained net's decision boundary can't be audited that way.
  * Thompson sampling naturally balances exploration (buckets with little data get sampled
    optimistically, so they still occasionally get "trusted" and thereby get more data) against
    exploitation (buckets with a lot of agreement data trust their own estimate), without a
    separate exploration schedule to tune.

Usage (see server.py's /api/transcribe wiring):

    router = ShadowRouter.load(path)          # or ShadowRouter() to start fresh
    if router.should_trust(confidence) and not router.should_audit():
        return canonical_phrase          # skip Groq entirely
    groq_text = await call_groq(...)
    router.update(confidence, agreed=(canonical_phrase == groq_text))
    router.save(path)
    return groq_text  # Groq's own transcription still wins when we double-checked

"Shadow" means this never overrides safety: the command actually dispatched to the robot
always still comes from the classifier's own `min_confidence` gate (see
`IntentClassifier.predict_intent_payload`) or the Groq+regex fallback -- this router only
decides whether Groq gets called *in addition*, to keep collecting ground truth to audit
and improve the local classifier against, not whether the robot is allowed to move.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

N_BUCKETS = 10  # confidence deciles: [0, .1), [.1, .2), ..., [.9, 1.0]


def _bucket(confidence: float) -> int:
    return min(N_BUCKETS - 1, max(0, int(confidence * N_BUCKETS)))


@dataclass
class BucketStats:
    alpha: float = 1.0  # Beta prior: agreements seen + 1
    beta: float = 1.0   # Beta prior: disagreements seen + 1

    @property
    def n(self) -> int:
        return int(round(self.alpha + self.beta - 2.0))

    @property
    def mean(self) -> float:
        return self.alpha / (self.alpha + self.beta)


class ShadowRouter:
    def __init__(self, trust_threshold: float = 0.9, audit_rate: float = 0.05,
                 min_samples_before_trust: int = 20,
                 rng: np.random.Generator | None = None) -> None:
        """`trust_threshold`: a bucket is only trusted standalone once a *sampled* Beta draw
        for it clears this (see `should_trust`) -- it's a target agreement rate with
        Groq+regex, not a raw confidence value, so it should stay high (this gates skipping
        a network round-trip, not gating whether the robot moves at all).
        `audit_rate`: even once a bucket is trusted, this fraction of its requests still get
        double-checked in the background, so its estimate can't go stale/drift unnoticed.
        `min_samples_before_trust`: below this many observations in a bucket, always
        double-check regardless of the sampled draw -- Thompson sampling handles small
        samples reasonably well on its own, but trusting a decile after one lucky draw on a
        freshly-deployed router is a bad trade for a robot command path specifically.
        """
        self.trust_threshold = trust_threshold
        self.audit_rate = audit_rate
        self.min_samples_before_trust = min_samples_before_trust
        self.rng = rng if rng is not None else np.random.default_rng()
        self.buckets_: list[BucketStats] = [BucketStats() for _ in range(N_BUCKETS)]

    def should_trust(self, confidence: float) -> bool:
        """Whether to skip Groq for a request with this classifier confidence."""
        b = self.buckets_[_bucket(confidence)]
        if b.n < self.min_samples_before_trust:
            return False
        return bool(self.rng.beta(b.alpha, b.beta) >= self.trust_threshold)

    def should_audit(self) -> bool:
        """Whether to double-check anyway even when `should_trust` said yes -- keeps a
        trusted bucket's estimate fresh. Independent of any particular request/confidence."""
        return bool(self.rng.random() < self.audit_rate)

    def update(self, confidence: float, agreed: bool) -> None:
        """Record whether the local classifier's label agreed with Groq+regex's result, for
        the confidence decile `confidence` fell in."""
        b = self.buckets_[_bucket(confidence)]
        if agreed:
            b.alpha += 1.0
        else:
            b.beta += 1.0

    def bucket_stats(self) -> list[dict[str, Any]]:
        """One row per confidence decile, for logging/dashboards/manual audit."""
        return [{"decile": i, "n": b.n, "agreement_rate": b.mean}
                for i, b in enumerate(self.buckets_)]

    def to_json(self) -> dict[str, Any]:
        return {"trust_threshold": self.trust_threshold, "audit_rate": self.audit_rate,
                "min_samples_before_trust": self.min_samples_before_trust,
                "buckets": [{"alpha": b.alpha, "beta": b.beta} for b in self.buckets_]}

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> ShadowRouter:
        router = cls(trust_threshold=float(data.get("trust_threshold", 0.9)),
                     audit_rate=float(data.get("audit_rate", 0.05)),
                     min_samples_before_trust=int(data.get("min_samples_before_trust", 20)))
        for i, b in enumerate(data.get("buckets") or []):
            if i >= N_BUCKETS:
                break
            router.buckets_[i] = BucketStats(alpha=float(b["alpha"]), beta=float(b["beta"]))
        return router

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_json()))

    @classmethod
    def load(cls, path: str | Path) -> ShadowRouter:
        """A missing or corrupt file just starts a fresh router (no ground truth yet) rather
        than raising -- exactly the case `min_samples_before_trust` exists to make safe, so
        a bad/missing state file degrades to "always double-check", never to a crash."""
        p = Path(path)
        if not p.exists():
            return cls()
        try:
            return cls.from_json(json.loads(p.read_text()))
        except (json.JSONDecodeError, KeyError, TypeError, ValueError):
            return cls()


__all__ = ["N_BUCKETS", "BucketStats", "ShadowRouter"]
