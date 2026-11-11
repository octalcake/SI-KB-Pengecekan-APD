"""AI_MODE=simulated: deterministic fixture, no model (SRS §18.2 fallback C).

The input image is ignored: results are a fixed script, not inference. Go stores mode=simulated
permanently on the session, findings and report, and the UI must show a SIMULASI banner.
"""
from app.config import Settings

MODEL_VERSION = "simulated-fixture-v1"
# NO_HELMET state per frame, repeating. "+, unknown, +" confirms on the 3rd frame (§18.3 demo) only
# if frames 1-3 fall within 2000ms; the 4th "+" confirms anyway when sampling jitter pushes it past.
NO_HELMET_SCRIPT = ["positive", "unknown", "positive", "positive", "negative", "negative"]
PERSON_BOX = [0.25, 0.10, 0.75, 0.95]
HEAD_BOX = [0.40, 0.12, 0.60, 0.30]
TORSO_BOX = [0.32, 0.35, 0.68, 0.70]


class SimulatedDetector:
    def __init__(self, s: Settings):
        self.s = s
        self.ready = s.ai_mode == "simulated"
        self.manifest = {"model_version": MODEL_VERSION}

    def info(self) -> dict:
        return {
            "ready": self.ready,
            "model_version": MODEL_VERSION,
            "mode": self.s.ai_mode,
            "class_map": {},
            "thresholds": {},
            "supported_violations": ["NO_HELMET", "NO_VEST"] if self.ready else [],
        }

    def new_tracker(self) -> dict:
        return {"frames": 0}

    def run(self, img, tracker) -> tuple[list, list, int]:
        state = NO_HELMET_SCRIPT[tracker["frames"] % len(NO_HELMET_SCRIPT)]
        tracker["frames"] += 1
        helmet = {"type": "NO_HELMET", "state": state, "confidence": None, "bbox": None}
        if state != "unknown":
            helmet.update(confidence=0.9, bbox=HEAD_BOX)
        vest = {"type": "NO_VEST", "state": "negative", "confidence": 0.9, "bbox": TORSO_BOX}
        person = {"track_id": 1, "confidence": 0.9, "bbox": PERSON_BOX, "ppe": [helmet, vest]}
        return [person], ["simulated"], 0
