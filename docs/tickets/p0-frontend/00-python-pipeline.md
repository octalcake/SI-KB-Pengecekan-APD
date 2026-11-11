# P0-00: Produce an evidence-backed finding through the actual Python boundary

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: GitHub publication pending.
Blocked by: None; existing Go auth/project/session/frame/evidence APIs already provide the public test seam.
Assigned lane: Antigravity 3, Gemini 4 Argon, high.
Status: ready-for-agent.

## What it delivers

A client of the existing public Go API can start a clearly simulated session, send controlled JPEGs through an actual FastAPI process, receive temporal events, and retrieve a persisted original evidence photograph. This service integration is independently verifiable before the new login UI lands. The browser monitoring surface remains P0-03.

## Acceptance criteria

- [ ] Python implements protected model-info, session start, inference, and stop under the existing internal contract.
- [ ] One worker/inference lock, engine instance, idempotent same-key start, image validation, metadata validation, 30-sequence/hash replay caching, out-of-order rejection, and cleanup match the contract.
- [ ] Deterministic simulated observations produce a real Go temporal event/finding/evidence through actual HTTP, without fake Go CRUD or fake database/storage.
- [ ] Public evidence bytes match the triggering JPEG hash; duplicate sequences do not advance the tracker/temporal count twice.
- [ ] Wrong token/session, invalid JPEG, cache conflict, no detections, timeout/restart, stop, and mode mismatch have the specified response behavior.
- [ ] Real mode without a valid loaded model is not-ready; simulated mode never impersonates real inference, and manual mode cannot process automatic frames.
- [ ] TDD red/green evidence exists at the already-approved Python/public-Go HTTP seams. Existing relevant Go monitoring/temporal checks still pass.
- [ ] No browser/frontend files, authentication-shell code, existing storage, global Python, or accounts are changed. No torch/training/CUDA install is required for this simulated-contract slice.

## Ownership and resource boundaries

Own Python service code/tests/dependency pins needed for this slice and narrowly necessary Go HTTP consumer-contract regression tests. Do not alter Go business semantics without a failing public-boundary case. Use dedicated temporary DB/evidence and nonconflicting loopback ports. Keep tests serial and the Go build concurrency low while Antigravity 1 works; stop only your own processes. Recover/load real weights and benchmark in P0-06.
