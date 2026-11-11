import hashlib

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.ppe_association import associate, normalize

TOKEN = "test-token-123456"
H = {"X-Internal-Token": TOKEN}


class FakeDetector:
    def __init__(self, s):
        self.s, self.ready, self.calls, self.fail = s, True, 0, False
        self.manifest = {"model_version": "fake-v1"}

    def info(self):
        return {"ready": self.ready, "model_version": "fake-v1", "mode": self.s.ai_mode, "class_map": {},
                "thresholds": {}, "supported_violations": ["NO_HELMET", "NO_VEST"]}

    def new_tracker(self):
        return object()

    def run(self, img, tracker):
        self.calls += 1
        if self.fail:
            raise RuntimeError("boom")
        return [{"track_id": 1, "confidence": 0.9, "bbox": [0.1, 0.1, 0.5, 0.9], "ppe": []}], [], 5


@pytest.fixture
def env():
    s = Settings(_env_file=None, ai_internal_token=TOKEN)
    det = FakeDetector(s)
    with TestClient(create_app(s, det)) as c:
        yield c, det


def jpeg():
    ok, buf = cv2.imencode(".jpg", np.zeros((48, 64, 3), np.uint8))
    return buf.tobytes()


def infer(c, seq, data, key="k1", sha=None):
    form = {"session_key": key, "frame_sequence": str(seq), "captured_at": "2026-01-01T00:00:00Z",
            "sample_elapsed_ms": "0", "sha256": sha or hashlib.sha256(data).hexdigest()}
    return c.post("/internal/v1/infer", data=form, files={"frame": ("f.jpg", data, "image/jpeg")}, headers=H)


def test_token_and_sessions(env):
    c, _ = env
    assert c.get("/internal/health").status_code == 200
    assert c.get("/internal/v1/model-info").status_code == 403
    assert c.get("/internal/v1/model-info", headers=H).json()["ready"] is True
    start = lambda k, m="real": c.post("/internal/v1/sessions/start", json={"session_key": k, "mode": m}, headers=H)
    assert start("k1").status_code == 200
    assert start("k1").status_code == 200  # idempotent
    assert start("k2").status_code == 409
    assert start("k2", "simulated").status_code == 409
    assert c.post("/internal/v1/sessions/stop", json={"session_key": "unknown"}, headers=H).status_code == 200
    assert c.post("/internal/v1/sessions/stop", json={"session_key": "k1"}, headers=H).status_code == 200
    assert start("k2").status_code == 200


def test_infer_rules(env):
    c, det = env
    c.post("/internal/v1/sessions/start", json={"session_key": "k1", "mode": "real"}, headers=H)
    img = jpeg()
    r = infer(c, 1, img)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["engine_instance_id"] and body["width"] == 64 and body["height"] == 48
    assert infer(c, 1, img).json() == body and det.calls == 1  # retry served from cache
    assert infer(c, 1, img + b"x").status_code == 409  # same seq, different bytes
    assert infer(c, 2, img, key="other").status_code == 409
    assert infer(c, 2, img, sha="0" * 64).status_code == 422
    assert infer(c, 2, b"\x89PNG not a jpeg").status_code == 422
    assert infer(c, 2, img).status_code == 200
    assert infer(c, 1, img + b"y").status_code == 409  # older than last seq
    det.fail = True
    assert infer(c, 3, img).status_code == 503


def test_association():
    a, b = [0, 0, 100, 200], [300, 0, 400, 200]
    regions = [
        ("no_helmet", 0.9, [30, 10, 70, 50]),   # head of a -> positive
        ("vest", 0.8, [20, 60, 80, 140]),       # torso of a -> negative
        ("helmet", 0.9, [330, 10, 370, 50]),    # head of b -> negative
        ("no_vest", 0.4, [320, 60, 380, 140]),  # below threshold -> ignored
        ("no_vest", 0.9, [330, 150, 335, 155]), # smaller than 12px -> ignored
    ]
    out = associate([a, b], regions, ["NO_HELMET", "NO_VEST"], 0.5)
    states = [{p["type"]: p["state"] for p in person} for person in out]
    assert states == [{"NO_HELMET": "positive", "NO_VEST": "negative"},
                      {"NO_HELMET": "negative", "NO_VEST": "unknown"}]
    assert out[1][1]["confidence"] is None and out[1][1]["bbox"] is None
    # no_helmet in the torso band of a does not count as head.
    assert associate([a], [("no_helmet", 0.9, [30, 100, 70, 140])], ["NO_HELMET"], 0.5)[0][0]["state"] == "unknown"
    # One box inside two overlapping persons is ambiguous.
    overlap = associate([[0, 0, 100, 200], [10, 0, 110, 200]], [("no_helmet", 0.9, [40, 10, 70, 50])], ["NO_HELMET"], 0.5)
    assert [p[0]["state"] for p in overlap] == ["unknown", "unknown"]
    # Both indication and PPE on one head conflict.
    both = associate([a], [("no_helmet", 0.9, [30, 10, 70, 50]), ("helmet", 0.9, [30, 10, 70, 50])], ["NO_HELMET"], 0.5)
    assert both[0][0]["state"] == "unknown"
    assert normalize([-10, 0, 64, 48], 64, 48) == [0.0, 0.0, 1.0, 1.0]
    assert normalize([70, 0, 80, 48], 64, 48) is None
