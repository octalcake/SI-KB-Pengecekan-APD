# P0-07: Verify and hand off the integrated local inspection workflow

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: https://github.com/octalcake/SI-KB-Pengecekan-APD/issues/12 — open frontend acceptance ticket (kept open until final integration PR acceptance).
Prerequisites: P0-01, P0-02, P0-03, P0-04, and P0-05 are integrated on `integration/p0-frontend` and merged with all 7 standards/spec review remediations at `14b064ee9e653a0eecd548f93e4a4b41c6f6eebc` (over baseline `11fdf4f91e59f5772c65ede3161407d193c00b2f`). Backend-only tickets P0-00 and P0-06 are cancelled per [frontend-only scope](../../frontend-only-scope.md); live Python detector and live Gemini readiness remain external dependencies (`NOT RUN`, unverified in this frontend-only scope despite upstream code availability) and do not authorize backend implementation.
Assigned lanes: Antigravity 1–3, Gemini 4 Argon, high; coordinator owns final publication.
Status: `t3/frontend-review-fixes` (`e2b6011d7df5765ba0993257e2e51a5e0cba9c6e`) merged into `integration/p0-frontend` (`cd7dfc1dc43dada5d079f345b42eb166351855da`) at merged code SHA `14b064ee9e653a0eecd548f93e4a4b41c6f6eebc` (code tree unchanged by the subsequent docs-only evidence commit); `npm run check` (`EXIT=0`), `npm run build` (`EXIT=0`), and the full serial Playwright suite (`7 passed (47.6s)`, `EXIT=0`) verified cleanly; awaiting coordinator for final PR [#13](https://github.com/octalcake/SI-KB-Pengecekan-APD/pull/13) readiness, tracker closure, and worktree cleanup.

## What it delivers

The local laptop can reproducibly run the frontend against existing APIs, complete available P0 workflows end to end, and represent unavailable backend capabilities accurately. Actual detector/Gemini readiness is reported separately (`NOT RUN`) and does not authorize backend implementation.

## Acceptance criteria

- [x] The frontend uses unchanged Go/SQLite/evidence APIs for available seeded workflows; camera/inference-unavailable behavior is verified honestly, and live capabilities not supplied by the existing backend remain explicitly NOT RUN.
- [x] User-confirmed browser/public-HTTP test seams cover auth, CRUD, capture, review/actions, stopped session, draft/edit/approve, filtered counts, and restart persistence (`frontend/tests/inspection-journey.spec.ts` + module suites).
- [x] Covered security, concurrency, stale/version/lock, unavailable-service, missing-evidence, and camera lifecycle regressions pass. Deterministic fault cases supplement the real-Go principal journey; this does not establish live detector/Gemini behavior or every storage/timeout failure.
- [x] Frontend check/build and relevant browser/API integration checks pass (`npm run check` exit `0`, `npm run build` exit `0`, `7 passed (47.6s)` across 6 Playwright spec files with `--workers=1` at merged code SHA `14b064ee9e653a0eecd548f93e4a4b41c6f6eebc`). Existing backend processes run unchanged; no backend code or tests are added or modified.
- [x] Desktop (`1280×800`), narrow-screen (`390×844`), and keyboard/dialog visual checks are recorded under `frontend/test-results/acceptance/` and inspected without exposing secrets.
- [x] Frontend startup and proxy/env instructions are reproducible in [`frontend/README.md`](../../../frontend/README.md), referring to existing backend setup in [`README.md`](../../../README.md) without implementing migration/seed changes or deleting existing storage.
- [x] Results identify PASS/FAIL/NOT RUN, versions/mode, evidence hash, request IDs, screenshots, and limitations per acceptance gate in [`docs/frontend-acceptance.md`](../../frontend-acceptance.md).
- [x] Two-axis standards/spec review is completed and findings fixed on the integration branch (`docs/frontend-review.md`, all 7 material findings resolved in `cd7dfc1` + `e2b6011`, merged and verified at `14b064ee9e653a0eecd548f93e4a4b41c6f6eebc`).
- [x] Frontend acceptance/review gates pass and delivery uses linked PR #13 with closing references. GitHub issues remain open until merge. Task worktrees were unregistered, branch refs retained, and test processes stopped; two empty Windows-locked directories were retained without forcing deletion.

## Verification & Handoff Evidence

- **Full acceptance report**: [`docs/frontend-acceptance.md`](../../frontend-acceptance.md)
- **Standards & spec review record**: [`docs/frontend-review.md`](../../frontend-review.md)
- **Principal integrated journey test**: [`frontend/tests/inspection-journey.spec.ts`](../../../frontend/tests/inspection-journey.spec.ts)
  - Executes the full officer journey through real browser UI and unchanged Go `cmd/api` (`http://127.0.0.1:48085`) proxied by Vite (`http://localhost:45175`), disposable SQLite/evidence (`node:sqlite`), fake browser camera (`audio: false`), and a deterministic Node HTTP external AI fixture (`http://127.0.0.1:48009/internal/v1/*`) with zero browser mocking of Go `/api/v1/*` routes.
  - Verifies exact byte-for-byte and SHA-256 identity (`e6ebbebf3676c7fb953e0b1389ca0d73f36536d92448994f1e6041270ca0f146`, `640×480`, `6500` bytes, sequence `#2`) between the triggering JPEG received by the external AI fixture and the stored original evidence served by `GET /api/v1/findings/1/evidence` before and after a full Go backend process restart (`api.exe` stop + respawn) and browser page reload.
- **Combined serial browser suite execution at merged code SHA `14b064ee9e653a0eecd548f93e4a4b41c6f6eebc`**:
  - Command: `$env:TEST_WEB_PORT='62173'; $env:TEST_API_PORT='62080'; $env:GOMAXPROCS='2'; $env:GOFLAGS='-p=2'; npx playwright test --workers=1 --reporter=list`
  - Outcome: `7 passed (47.6s)` (`npm run check` exit `0`, `npm run build` exit `0`, Playwright exit `0`), `0` leftover `api`/`seed`/`vite` processes after completion.
