"""Single active tracker session, guarded by one global lock (SRS §6.5, §10)."""
import threading
import time
from collections import OrderedDict

CACHE_SIZE = 30
# shortcut: an active session idle this long may be replaced by a new key, so Python cannot stay
# stuck on 409 if Go crashed before saving the key; upgrade to an explicit admin reset if needed.
STALE_AFTER_S = 60


class SessionError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


class Sessions:
    def __init__(self, detector, clock=time.monotonic):
        self.detector = detector
        self.clock = clock
        self.lock = threading.Lock()
        self.key = None
        self.tracker = None
        self.cache: OrderedDict[int, tuple[str, dict]] = OrderedDict()
        self.last_seq = 0
        self.last_used = 0.0

    def start(self, key: str, mode: str):
        with self.lock:
            if mode != self.detector.s.ai_mode:
                raise SessionError(409, "MODE_MISMATCH", "Mode berbeda dengan AI_MODE.")
            if not self.detector.ready:
                raise SessionError(503, "MODEL_NOT_READY", "Model belum siap.")
            if self.key == key:
                return  # idempotent: no tracker reset
            if self.key is not None and self.clock() - self.last_used < STALE_AFTER_S:
                raise SessionError(409, "SESSION_ACTIVE", "Sesi lain masih aktif.")
            self.key, self.tracker = key, self.detector.new_tracker()
            self.cache.clear()
            self.last_seq, self.last_used = 0, self.clock()

    def stop(self, key: str):
        with self.lock:
            if self.key == key:
                self.key, self.tracker = None, None
                self.cache.clear()
                self.last_seq = 0

    def infer(self, key: str, seq: int, sha: str, decode):
        """decode() returns the BGR image or raises SessionError; only called for a new sequence."""
        with self.lock:
            if self.key is None or key != self.key:
                raise SessionError(409, "SESSION_MISMATCH", "session_key tidak aktif.")
            if seq in self.cache:
                cached_sha, result = self.cache[seq]
                if cached_sha != sha:
                    raise SessionError(409, "FRAME_CONFLICT", "Sequence sama dengan bytes berbeda.")
                return result  # retry: no second model/tracker step
            if seq <= self.last_seq:
                raise SessionError(409, "FRAME_TOO_OLD", "Sequence lama atau tidak berurutan.")
            img = decode()
            try:
                persons, warnings, ms = self.detector.run(img, self.tracker)
            except Exception as e:
                raise SessionError(503, "MODEL_ERROR", "Inferensi gagal.") from e
            result = {
                "session_key": key, "frame_sequence": seq, "mode": self.detector.s.ai_mode,
                "model_version": self.detector.manifest.get("model_version"),
                "width": int(img.shape[1]), "height": int(img.shape[0]), "inference_ms": ms,
                "persons": persons, "warnings": warnings,
            }
            self.cache[seq] = (sha, result)
            while len(self.cache) > CACHE_SIZE:
                self.cache.popitem(last=False)
            self.last_seq, self.last_used = seq, self.clock()
            return result
