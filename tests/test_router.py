import json

import numpy as np

from firebot.voice_intent.router import N_BUCKETS, ShadowRouter, _bucket


def test_bucket_indexing_covers_full_range():
    assert _bucket(0.0) == 0
    assert _bucket(0.05) == 0
    assert _bucket(0.95) == N_BUCKETS - 1
    assert _bucket(1.0) == N_BUCKETS - 1  # exactly 1.0 must not overflow into bucket N_BUCKETS


def test_never_trusts_a_bucket_below_min_samples():
    router = ShadowRouter(min_samples_before_trust=20, rng=np.random.default_rng(0))
    for _ in range(19):
        router.update(0.95, agreed=True)  # 19 straight agreements -- still not enough data
    assert router.should_trust(0.95) is False


def test_trusts_a_high_agreement_bucket_once_enough_samples():
    router = ShadowRouter(trust_threshold=0.8, min_samples_before_trust=20,
                          rng=np.random.default_rng(0))
    for _ in range(50):
        router.update(0.95, agreed=True)
    # 50/50 agreements: Beta(51, 1) puts virtually all mass above 0.8.
    assert router.should_trust(0.95) is True


def test_never_trusts_a_low_agreement_bucket():
    router = ShadowRouter(trust_threshold=0.8, min_samples_before_trust=20,
                          rng=np.random.default_rng(0))
    for _ in range(50):
        router.update(0.3, agreed=False)
    assert router.should_trust(0.3) is False


def test_update_is_isolated_per_bucket():
    router = ShadowRouter()
    router.update(0.95, agreed=True)
    router.update(0.15, agreed=False)
    stats = {row["decile"]: row for row in router.bucket_stats()}
    assert stats[9]["n"] == 1 and stats[9]["agreement_rate"] > 0.5
    assert stats[1]["n"] == 1 and stats[1]["agreement_rate"] < 0.5
    # every other bucket untouched
    for i in range(N_BUCKETS):
        if i not in (1, 9):
            assert stats[i]["n"] == 0


def test_audit_rate_is_roughly_respected():
    router = ShadowRouter(audit_rate=0.2, rng=np.random.default_rng(1))
    audits = sum(router.should_audit() for _ in range(5000))
    assert 800 < audits < 1200  # ~1000 expected; generous band for a fixed seed


def test_save_load_round_trip(tmp_path):
    router = ShadowRouter(trust_threshold=0.85, audit_rate=0.1, min_samples_before_trust=15)
    for _ in range(30):
        router.update(0.95, agreed=True)
    router.update(0.4, agreed=False)
    path = tmp_path / "router_state.json"
    router.save(path)

    loaded = ShadowRouter.load(path)
    assert loaded.trust_threshold == 0.85
    assert loaded.audit_rate == 0.1
    assert loaded.min_samples_before_trust == 15
    orig_stats = router.bucket_stats()
    loaded_stats = loaded.bucket_stats()
    assert orig_stats == loaded_stats


def test_load_missing_or_corrupt_file_starts_fresh(tmp_path):
    missing = tmp_path / "does_not_exist.json"
    router = ShadowRouter.load(missing)
    assert router.bucket_stats() == ShadowRouter().bucket_stats()

    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{not valid json")
    router2 = ShadowRouter.load(corrupt)
    assert router2.bucket_stats() == ShadowRouter().bucket_stats()

    bad_shape = tmp_path / "bad_shape.json"
    bad_shape.write_text(json.dumps({"buckets": "not a list"}))
    router3 = ShadowRouter.load(bad_shape)
    assert router3.bucket_stats() == ShadowRouter().bucket_stats()
