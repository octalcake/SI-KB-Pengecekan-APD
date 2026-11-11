# P0-06: Load the exported PPE model in the local runtime

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: GitHub publication pending.
Blocked by: P0-03; actual Colab export/checkpoint and compatible CPU dependencies.
Assigned lane: Antigravity 3, Gemini 4 Argon, high.
Status: outside the user's frontend-only scope. Do not implement backend/model/runtime work. Treat real model readiness as an external dependency exposed through existing API responses.

## What it delivers

An officer can run the same monitoring journey in real mode with the recovered exported Person/helmet/vest model, correct capabilities, and truthful readiness.

## Acceptance criteria

- [ ] Recover the existing exported ZIP rather than retrain by default; verify weights hash, manifest/class mapping, categories, calibrated thresholds, provenance, and pins.
- [ ] Load the model once using a compatible isolated CPU environment; keep weights and credentials out of Git.
- [ ] Track only Person detections and associate positive/negative PPE on the same frame; absent or ambiguous evidence stays unknown.
- [ ] Readiness rejects missing/invalid artifacts and never reports simulated output as real.
- [ ] Actual Go/Python model integration preserves engine/session/frame contracts and temporal/evidence invariants.
- [ ] Measure 60-frame target-laptop end-to-end latency and run independent webcam/tracking/event scenarios.
- [ ] Real-model acceptance is reported separately; absent artifacts or hardware evidence leave that gate explicitly open.

