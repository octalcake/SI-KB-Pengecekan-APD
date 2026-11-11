# P0-07: Verify and hand off the integrated local inspection workflow

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: GitHub publication pending.
Blocked by: P0-02, P0-03, P0-04, P0-05. Backend/model readiness is an external dependency; do not implement it as part of acceptance.
Assigned lane: Antigravity 3 for runtime evidence; Antigravity 1 for final UI corrections, sequentially.
Status: blocked.

## What it delivers

The local laptop can reproducibly run the frontend against existing APIs, complete available P0 workflows, and represent unavailable backend capabilities accurately. Actual detector/Gemini readiness is reported separately and does not authorize backend implementation.

## Acceptance criteria

- [ ] The frontend uses unchanged Go/SQLite/evidence APIs for available seeded workflows; camera/inference-unavailable behavior is verified honestly, and live capabilities not supplied by the existing backend remain explicitly NOT RUN.
- [ ] User-confirmed browser/public-HTTP test seams cover auth, CRUD, capture, review/actions, stopped session, draft/edit/approve, filtered counts, and restart persistence.
- [ ] Security, concurrency, stale/version/lock, offline/timeout/storage, and camera lifecycle failures have the specified behavior.
- [ ] Frontend check/build and relevant browser/API integration checks pass. Existing backend checks may run unchanged as supporting evidence; no backend code or tests are added or modified.
- [ ] Desktop/narrow-screen/keyboard visual checks are recorded without exposing secrets.
- [ ] Frontend startup and proxy/env instructions are reproducible, referring to existing backend setup without implementing migration/seed changes or deleting existing storage.
- [ ] Results identify PASS/FAIL/NOT RUN, versions/mode, evidence hash, request IDs, latency, screenshots, and limitations per acceptance gate.
- [ ] Two-axis standards/spec review is completed and findings fixed on the integration branch.
- [ ] GitHub spec/tickets are resolved through the integration PR; PR is linked and ready only after appropriate gates; task-owned worktrees/processes are cleaned.

