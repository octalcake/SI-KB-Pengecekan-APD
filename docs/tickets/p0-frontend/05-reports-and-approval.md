# P0-05: Draft, review, and approve an inspection report

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: https://github.com/octalcake/SI-KB-Pengecekan-APD/issues/10 — open frontend implementation ticket.
Blocked by: P0-04.
Assigned lane: Antigravity 2, Gemini 4 Argon, high. Frontend only; consume report APIs unchanged and report backend gaps.
Status: implemented in `t3/implement-report-workflows` (awaiting merger integration into `integration/p0-frontend`; live Gemini external gate remains NOT RUN).

## What it delivers

An officer creates a confirmed-only report for a closed session, edits its narrative, inspects its source snapshot, regenerates stale source, and explicitly approves an immutable report.

## Acceptance criteria

- [x] Session eligibility, report list/filter/detail, manual/template creation, and backend Gemini generation are accessible.
- [x] Operation keys and lost-response recovery avoid duplicate active reports.
- [x] Source snapshot, links, generator provenance, staleness, version conflict, and generation failures are visible.
- [x] Narrative editing cannot refresh stale source; regeneration protects unsaved edits and requires explicit confirmation.
- [x] Approval requires review acknowledgement; stale source and approved report/source mutations are rejected.
- [x] Existing drafts survive Gemini failure; only sanitized confirmed-only text goes to real Gemini.
- [x] Browser + real Go/SQLite prove template/manual report edit/approval and stale/lock behavior.
- [ ] Real Gemini smoke result is separately PASS/FAIL/NOT RUN with its prerequisite; never infer a pass from templates. (**NOT RUN** — external prerequisite: live `GEMINI_ENABLED=true` and valid `GEMINI_API_KEY` with quota are not configured in the local test environment).

## Red / Green Verification Evidence

- **Initial Red (`npx playwright test tests/reports-and-approval.spec.ts --workers=1`)**:
  - Ran against the real Go API (`127.0.0.1:58085`) + disposable SQLite migrated from `backend/migrations/001_init.sql` + Vite dev server (`localhost:55175`) before `/reports` and `/reports/[id]` route files existed.
  - Failed as expected at `await expect(page.getByRole('heading', { name: /Laporan Inspeksi K3/i })).toBeVisible()` with `404 GET /reports`.
- **Final Green (`npm run check`, `npm run build`, `npx playwright test tests/reports-and-approval.spec.ts --workers=1`, and `go test ./internal/handler -run 'TestReportFlow|TestGenerateWithoutGemini'`)**:
  - `npm run check`: `svelte-check found 0 errors and 0 warnings`.
  - `npm run build`: SSR and client bundles built cleanly.
  - `npx playwright test tests/reports-and-approval.spec.ts --workers=1`: `1 passed` against unchanged Go (`cmd/api` + `cmd/seed`) and disposable SQLite/evidence:
    - Closed-session eligibility check: active session rejected with `409 SESSION_STILL_ACTIVE`; closed session with 0 confirmed findings rejected with `422 NO_CONFIRMED_FINDINGS`; closed session with confirmed findings marked eligible.
    - Gemini generation (`POST /api/v1/reports/generate`): surfaces honest `503 GEMINI_UNAVAILABLE` when `GEMINI_ENABLED=false`, retains the UUID v4 `request_key` across lost-response network aborts for the same session, and mints a fresh UUID when switching `session_id`.
    - Manual draft creation (`POST /api/v1/reports` with `use_template=false`, `generated_by=manual`) and allowed draft soft deletion (`DELETE /api/v1/reports/1?version=1 -> 204`).
    - Template draft creation (`POST /api/v1/reports` with `use_template=true`, `generated_by=template`), immutable historical snapshot display, and `[F-1]` link to `/findings/1`.
    - Duplicate creation conflict (`409 REPORT_EXISTS`) surfaces direct link to open the existing active report (`#2`).
    - Version-aware plain-text title/narrative editing (`PATCH /api/v1/reports/2`): `409 VERSION_CONFLICT` preserves the officer's unsaved title/narrative edits and offers one-click reload before re-saving (`version` 1 -> 2 -> 3).
    - Modifying confirmed source finding `F-1` flips report `#2` to `is_stale=true`; saving narrative text (`version` 3 -> 4) keeps `is_stale=true`; approving without `review_acknowledged` fails with `422 VALIDATION_ERROR`; approving while stale fails with `409 STALE_REPORT`.
    - Explicit regeneration confirmation modal (`POST /api/v1/reports/2/regenerate`): protects unsaved narrative edits in the form when Gemini returns `503 GEMINI_UNAVAILABLE`; recreating a fresh template draft (`#3`) refreshes the snapshot (`is_stale=false`).
    - Explicit human review acknowledgement + approval (`POST /api/v1/reports/3/approve` -> `status='approved'`), switching `/reports/3` to read-only view and locking both the approved report and source finding `F-1` (`409 REPORT_LOCKED` on `PATCH /reports/3`, `DELETE /reports/3`, and `PATCH /findings/1`).
    - Report list filtering by `project_id`, `session_id`, and `status` (`approved` vs `draft`).
  - Supporting unchanged Go handler baseline: `go test -p 2 ./internal/handler -run 'TestReportFlow|TestGenerateWithoutGemini'` passed (`ok k3/backend/internal/handler`).
- **Separate Gate Status**:
  - **Application / Pipeline (Frontend + Go + SQLite)**: **PASS**
  - **Real PPE Inference**: **NOT RUN** (external model bundle/runtime prerequisite)
  - **Real Gemini Narrative Generation**: **NOT RUN** (external live `GEMINI_API_KEY` / quota prerequisite; template/manual drafts do not count as live Gemini proof)
