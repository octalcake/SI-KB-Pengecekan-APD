# P0-04: Review evidence and record follow-up

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: https://github.com/octalcake/SI-KB-Pengecekan-APD/issues/9 — open frontend implementation ticket (kept open pending final integration PR acceptance).
Blocked by: P0-01 for shared auth/API integration. Existing finding APIs allow independent frontend work without requiring the new monitoring UI.
Assigned lane: Antigravity 2, Gemini 4 Argon, high. Frontend only; backend code is out of scope.
Status: integrated in `integration/p0-frontend` (GitHub issue #9 remains open pending final PR acceptance).

## What it delivers

An officer locates a captured finding, inspects its protected original evidence, confirms/rejects/corrects it, records follow-up, and uses explicitly enabled manual capture when configured.

## Acceptance criteria

- [x] Paginated gallery/list filters cover project/zone/session/time/category/verification/action as specified.
- [x] Full evidence, zoom/toggle overlay, original immutable result, final category, mode, capture time, and temporary track semantics are visible.
- [x] Review/correction uses versions; required notes and confirmed-only follow-up are enforced.
- [x] Completed actions require notes, and allowed soft deletion respects approved-source locks.
- [x] Manual multipart evidence uses an eligible closed manual session and never impersonates real inference.
- [x] Missing evidence, forbidden access, validation, conflict, and locked states are specific.
- [x] Browser journey confirms one finding, rejects another, saves follow-up, and preserves changes on reload; relevant Go checks pass.

## Implementation & Verification Evidence

- **Source commit**: `f77843558fcc9b7b88cd303e385d18ba5627be06` (`t3/findings-frontend`), implementing `/findings` and `/findings/[id]` routes (`frontend/src/routes/(app)/findings/+page.svelte`, `frontend/src/routes/(app)/findings/[id]/+page.svelte`), `FindingsGalleryPage.svelte`, `FindingDetailPage.svelte`, `FindingEvidenceViewer.svelte`, `ManualFindingForm.svelte`, `api.ts`, `format.ts`, `types.ts`, `index.ts`, and `frontend/tests/findings-and-follow-up.spec.ts`.
- **Integration navigation activation**: `frontend/src/lib/components/AppShell.svelte` default `Temuan` nav entry updated from `disabledReason` to `href: '/findings'`.
- **Actual passing behavior, check, and build evidence** (recorded directly from actual passing behavior/check/build without claiming TDD red->green from an empty fixture setup):
  - `npm run check` (`svelte-check`) and `npm run build` (`vite build`): `0 errors and 0 warnings`.
  - Browser suite (`npx playwright test tests/findings-and-follow-up.spec.ts --workers=1`, `1 passed` against unchanged Go `cmd/api` + `cmd/seed` + disposable SQLite/evidence):
    - Gallery filtering on `/findings` (`project_id`, `verification_status`) and pagination metadata.
    - Evidence inspection on `/findings/1` with full image preview dialog, normalized bbox overlay toggle, immutable `detected_violation` (`NO_HELMET`), final `violation_type` correction (`NO_VEST`), and temporary `track_key` (`17:1`, explicitly labeled non-biometric/non-worker identity).
    - Versioned confirmation (`version` 1 -> 2), confirmed-only follow-up enforcement, required notes for `completed` follow-up (`version` 2 -> 3), and rejection-before-delete guard on confirmed findings.
    - Required rejection notes on `/findings/2` and `409 VERSION_CONFLICT` recovery preserving the officer's unsaved rejection note across reload (`version` 1 -> 2 -> 3).
    - `410 EVIDENCE_MISSING` display on `/findings/3` and soft delete (`DELETE /api/v1/findings/3?version=1 -> 204`).
    - Approved-report lock (`409 REPORT_LOCKED`) banner and mutation rejection on `/findings/4`.
    - Multipart manual finding submission (`POST /api/v1/findings` on eligible closed manual session #2) labeled with `MANUAL` provenance, plus `403 MANUAL_FALLBACK_DISABLED` verification when manual fallback is disabled.
    - Reload persistence from Go/SQLite and network error (`BACKEND_UNREACHABLE`) unsaved-input preservation.
- **External runtime gates (`NOT RUN`)**:
  - Real-model Python PPE runtime and live Gemini API validation were **NOT RUN** during frontend merger verification (external validation unverified).
