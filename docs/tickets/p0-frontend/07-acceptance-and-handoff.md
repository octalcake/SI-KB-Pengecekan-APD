# P0-07: Verify and hand off the integrated local inspection workflow

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: https://github.com/octalcake/SI-KB-Pengecekan-APD/issues/12 — open frontend acceptance ticket (kept open until final integration PR acceptance).
Prerequisites: P0-01, P0-02, P0-03, P0-04, and P0-05 are integrated on `integration/p0-frontend` (`11fdf4f91e59f5772c65ede3161407d193c00b2f`). Backend-only tickets P0-00 and P0-06 are cancelled per [frontend-only scope](../../frontend-only-scope.md); live Python detector and live Gemini readiness remain external dependencies (`NOT RUN`) and do not authorize backend implementation.
Assigned lane: Antigravity 3, Gemini 4 Argon, high (runtime acceptance test & documentation); separate Argon 3 production fix lane for the 4 spec-review findings on baseline `11fdf4f`.
Status: acceptance suite (`frontend/tests/inspection-journey.spec.ts`), setup docs (`frontend/README.md`), and verification report (`docs/frontend-acceptance.md`) verified against baseline `11fdf4f91e59f5772c65ede3161407d193c00b2f`; awaiting coordinator merge of the separate production spec-review fixes before marking PR [#13](https://github.com/octalcake/SI-KB-Pengecekan-APD/pull/13) ready for review.

## What it delivers

The local laptop can reproducibly run the frontend against existing APIs, complete available P0 workflows end to end, and represent unavailable backend capabilities accurately. Actual detector/Gemini readiness is reported separately (`NOT RUN`) and does not authorize backend implementation.

## Acceptance criteria

- [x] The frontend uses unchanged Go/SQLite/evidence APIs for available seeded workflows; camera/inference-unavailable behavior is verified honestly, and live capabilities not supplied by the existing backend remain explicitly NOT RUN.
- [x] User-confirmed browser/public-HTTP test seams cover auth, CRUD, capture, review/actions, stopped session, draft/edit/approve, filtered counts, and restart persistence (`frontend/tests/inspection-journey.spec.ts` + module suites).
- [x] Security, concurrency, stale/version/lock, offline/timeout/storage, and camera lifecycle failures have the specified behavior.
- [x] Frontend check/build and relevant browser/API integration checks pass (`7 passed` across 6 Playwright spec files with `--workers=1`). Existing backend processes run unchanged; no backend code or tests are added or modified.
- [x] Desktop (`1280×800`), narrow-screen (`390×844`), and keyboard/dialog visual checks are recorded and inspected without exposing secrets.
- [x] Frontend startup and proxy/env instructions are reproducible in [`frontend/README.md`](../../../frontend/README.md), referring to existing backend setup in [`README.md`](../../../README.md) without implementing migration/seed changes or deleting existing storage.
- [x] Results identify PASS/FAIL/NOT RUN, versions/mode, evidence hash, request IDs, screenshots, and limitations per acceptance gate in [`docs/frontend-acceptance.md`](../../frontend-acceptance.md).
- [ ] Two-axis standards/spec review is completed and findings fixed on the integration branch. *(Standards & spec review completed on baseline `11fdf4f`; 4 production spec-review findings are being fixed on a separate Argon 3 worktree and must be merged and re-verified on `integration/p0-frontend` by the coordinator.)*
- [ ] GitHub spec/tickets are resolved through the integration PR; PR is linked and ready only after appropriate gates; task-owned worktrees/processes are cleaned. *(Own test processes verified clean; GitHub issues and draft status on PR #13 are preserved open/draft until coordinator merges the production fix lane.)*

## Verification & Handoff Evidence

- **Full acceptance report**: [`docs/frontend-acceptance.md`](../../frontend-acceptance.md)
- **Principal integrated journey test**: [`frontend/tests/inspection-journey.spec.ts`](../../../frontend/tests/inspection-journey.spec.ts)
  - Executes the full officer journey through real browser UI and unchanged Go `cmd/api` (`http://127.0.0.1:48085`) proxied by Vite (`http://localhost:45175`), disposable SQLite/evidence (`node:sqlite`), fake browser camera (`audio: false`), and a deterministic Node HTTP external AI fixture (`http://127.0.0.1:48009/internal/v1/*`) with zero browser mocking of Go `/api/v1/*` routes.
  - Verifies exact byte-for-byte and SHA-256 identity (`e6ebbebf3676c7fb953e0b1389ca0d73f36536d92448994f1e6041270ca0f146`, `640×480`, `6500` bytes, sequence `#2`) between the triggering JPEG received by the external AI fixture and the stored original evidence served by `GET /api/v1/findings/1/evidence` before and after a full Go backend process restart (`api.exe` stop + respawn) and browser page reload.
- **Combined serial browser suite execution**:
  - Command: `$env:TEST_WEB_PORT='62173'; $env:TEST_API_PORT='62080'; $env:GOMAXPROCS='2'; $env:GOFLAGS='-p=2'; npx playwright test --workers=1 --reporter=list`
  - Outcome: `7 passed (1.1m)`, exit code `0`, `0` leftover `api`/`seed`/`vite` processes after completion.
