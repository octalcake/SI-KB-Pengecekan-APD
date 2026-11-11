"""YOLO + ByteTrack wrapper. Loaded once at startup (SRS §10)."""
import hashlib
import json
import logging
import time
from pathlib import Path

from app import ppe_association
from app.config import Settings

log = logging.getLogger("ai.detector")
MAX_PERSONS = 50


class Detector:
    def __init__(self, s: Settings):
        self.s = s
        self.ready = False
        self.manifest: dict = {}
        self.model = None
        try:
            self._load()
            self.ready = s.ai_mode == "real"
        except Exception as e:  # missing/invalid weights: health still works, model-info says not ready
            log.error("model not loaded: %s", e)

    def _load(self):
        m = json.loads(Path(self.s.model_manifest_path).read_text(encoding="utf-8"))
        weights = Path(self.s.model_path).read_bytes()
        if hashlib.sha256(weights).hexdigest() != m["weights_sha256"]:
            raise ValueError("weights sha256 does not match manifest")
        from ultralytics import YOLO  # heavy import, only when weights exist

        self.model = YOLO(self.s.model_path)
        self.manifest = m
        # Class IDs come from the manifest; Person is not assumed to be 0 (SRS §14.2).
        self.ids = {k: int(v) for k, v in m["logical_class_map"].items()}
        self.labels = {v: k for k, v in self.ids.items()}
        self.types = [t for t in m["supported_violations"] if t in ppe_association.BANDS]
        # First predict takes seconds (lazy init); do it now so the first real frame fits Go's 2s timeout.
        import numpy as np

        self.model.predict(np.zeros((480, 640, 3), np.uint8), imgsz=self.s.imgsz, device=self.s.device, verbose=False)

    def info(self) -> dict:
        return {
            "ready": self.ready,
            "model_version": self.manifest.get("model_version"),
            "mode": self.s.ai_mode,
            "class_map": self.manifest.get("logical_class_map", {}),
            "thresholds": {"person": self.s.person_conf, "violation": self.s.violation_conf,
                           "predict_floor": self.s.predict_conf_floor},
            "supported_violations": self.types if self.ready else [],
        }

    def new_tracker(self):
        from ultralytics.trackers.byte_tracker import BYTETracker
        from ultralytics.utils import YAML, IterableSimpleNamespace

        return BYTETracker(IterableSimpleNamespace(**YAML.load(self.s.tracker_config)))

    def run(self, img, tracker) -> tuple[list, list, int]:
        """One predict, Person boxes only into ByteTrack, PPE associated on the same frame (§6.2)."""
        import torch

        # At 1 FPS the CPU idles between frames; waking the default one-thread-per-core pool cost
        # ~1.2s per frame in Docker/WSL2, 2 threads stay ~70ms (measured). Per call because the
        # OpenMP setting is per thread and requests run on different threadpool threads.
        torch.set_num_threads(2)
        t0 = time.perf_counter()
        res = self.model.predict(img, imgsz=self.s.imgsz, device=self.s.device, conf=self.s.predict_conf_floor,
                                 classes=list(self.ids.values()), verbose=False)[0]
        boxes = res.boxes.cpu().numpy()
        person_boxes = boxes[boxes.cls == self.ids["person"]]
        # Only tracks matched in this frame come back; lost (predicted) tracks are not "seen" (§6.3).
        tracks = tracker.update(person_boxes, img)
        regions = [(self.labels.get(int(c)), float(p), b.tolist()) for c, p, b in zip(boxes.cls, boxes.conf, boxes.xyxy)]
        persons = []
        for row in tracks:
            idx = int(row[7])
            conf = float(person_boxes.conf[idx])
            if conf >= self.s.person_conf:
                persons.append((int(row[4]), conf, person_boxes.xyxy[idx].tolist()))
        persons.sort(key=lambda p: -p[1])
        warnings = []
        if len(persons) > MAX_PERSONS:
            persons, warnings = persons[:MAX_PERSONS], ["too_many_persons"]
        return self.build(persons, regions, img.shape[1], img.shape[0]), warnings, round((time.perf_counter() - t0) * 1000)

    def build(self, persons, regions, w, h) -> list:
        """persons: (track_id, conf, xyxy px). Returns §10 persons with normalized boxes."""
        out = []
        ppe = ppe_association.associate([p[2] for p in persons], regions, self.types, self.s.violation_conf)
        for (tid, conf, box), items in zip(persons, ppe):
            nbox = ppe_association.normalize(box, w, h)
            if nbox is None:
                continue
            for it in items:
                if it["bbox"] is not None:
                    it["bbox"] = ppe_association.normalize(it["bbox"], w, h)
                    if it["bbox"] is None:
                        it.update(state="unknown", confidence=None)
                if it["confidence"] is not None:
                    it["confidence"] = round(it["confidence"], 4)
            out.append({"track_id": tid, "confidence": round(conf, 4), "bbox": nbox, "ppe": items})
        return out
