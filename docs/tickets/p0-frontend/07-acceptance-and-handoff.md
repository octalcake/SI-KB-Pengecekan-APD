# P0-07: Verify and hand off the integrated local inspection workflow

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: GitHub publication pending.
Blocked by: P0-02, P0-03, P0-04, P0-05. Backend/model readiness is an external dependency; do not implement it as part of acceptance.
Assigned lane: Antigravity 3 for runtime evidence; Antigravity 1 for final UI corrections, sequentially.
Status: blocked.

## What it delivers

The local laptop can reproducibly complete the agreed inspection journey, with retained data and clear evidence for application, real PPE, and Gemini acceptance.

## Acceptance criteria

- [ ] Real frontend, Go, FastAPI, SQLite, and evidence filesystem complete the seeded happy path; fixtures are restricted to explicitly simulated inference.
- [ ] User-confirmed browser/public-HTTP test seams cover auth, CRUD, capture, review/actions, stopped session, draft/edit/approve, filtered counts, and restart persistence.
- [ ] Security, concurrency, stale/version/lock, offline/timeout/storage, and camera lifecycle failures have the specified behavior.
- [ ] Frontend check/build, relevant Go tests/build/vet as justified, and Python contracts pass.
- [ ] Desktop/narrow-screen/keyboard visual checks are recorded without exposing secrets.
- [ ] README/startup/migration/seed/env examples are reproducible without deleting existing storage or changing global accounts.
- [ ] Results identify PASS/FAIL/NOT RUN, versions/mode, evidence hash, request IDs, latency, screenshots, and limitations per acceptance gate.
- [ ] Two-axis standards/spec review is completed and findings fixed on the integration branch.
- [ ] GitHub spec/tickets are resolved through the integration PR; PR is linked and ready only after appropriate gates; task-owned worktrees/processes are cleaned.

