# P0-03: Capture webcam events through Go and Python

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: GitHub publication pending.
Blocked by: P0-00 and P0-01 (project/zone APIs already exist; P0-02 UI is not a prerequisite). Reuse the Python boundary from P0-00 rather than rebuild it.
Assigned lane: Antigravity 3, Gemini 4 Argon, high.
Status: blocked.

## What it delivers

An officer selects an existing project/zone, starts one browser-camera session, sends serialized JPEGs to the actual Python boundary through Go, views exact inference snapshots, and opens evidence-backed pending findings. Deterministic inference is explicitly simulated until real model readiness is proved.

## Acceptance criteria

- [ ] Python implements protected model-info, start, infer, and stop; single worker/lock, engine ID, validation, sequence/hash cache, and cleanup follow the internal contract.
- [ ] Simulated inference is deterministic and permanently labeled; real mode never silently becomes simulation; manual mode cannot accept automatic frames.
- [ ] Camera is user initiated, video only, aspect-preserving at most 640×480, target 1 FPS with one request in flight and no backlog.
- [ ] Headers/times/sequences and snapshot-only normalized overlays follow the contract.
- [ ] Stop/logout/route leave/hidden tab/device loss/errors release media and best-effort close the session; idle timeout remains a backstop.
- [ ] Actual Go/FastAPI/SQLite produce a pending finding and original triggering JPEG hash; duplicate frames and repeated tracks do not recapture.
- [ ] Unknown, timeout, restart, second-session, invalid image, stale sequence, and wrong-token checks pass at approved public seams.
- [ ] Frontend gates and Python/Go boundary checks pass, with real inference clearly separated from fixture success.

