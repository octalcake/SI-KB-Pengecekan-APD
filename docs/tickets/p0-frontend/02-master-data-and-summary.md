# P0-02: Prepare projects and zones and inspect filtered totals

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: https://github.com/octalcake/SI-KB-Pengecekan-APD/issues/7 — open frontend implementation ticket (kept open pending integration PR).
Blocked by: P0-01.
Assigned lane: Antigravity 1, Gemini 4 Argon, high.
Status: implemented-in-worktree; P0-01 foundation (`3d0fea498575b6c6119f13f388a2f1d71308765e`) and latest `integration/p0-frontend` (`e493551e5c7e8dab2ad4a6f1eb2552e0e7022df3`) merged.

## What it delivers

A signed-in officer can create/search/edit projects and zones, archive referenced records, and see mode-separated dashboard totals through real persisted APIs.

## Acceptance criteria

- [x] CRUD, pagination, active/archive filters, and project-zone relationship are usable.
- [x] Referenced deletion explains archival; active-session archival conflicts remain visible.
- [x] Version conflicts retain unsaved input and offer a reload.
- [x] Dashboard uses actual summary data with project/zone/date/mode filters and configured timezone.
- [x] Real/simulated/manual counts remain separate; count unit is finding, not worker.
- [x] Empty, loading, failed, validation, and success states are distinct.
- [x] Browser tests verify persisted CRUD after reload and filtered totals; relevant backend checks and frontend gates pass.

## Implementation & Verification Evidence

- **Frontend modules & routes**:
  - `frontend/src/lib/projects/api.ts`: Typed DTOs (`Project`, `Zone`, `RecordStatus`, filter/create/update shapes), relative API helpers (`listProjectsApi`, `getProjectApi`, `createProjectApi`, `updateProjectApi`, `deleteProjectApi`, `listZonesApi`, `getZoneApi`, `createZoneApi`, `updateZoneApi`, `deleteZoneApi`), Indonesian validation field translations, and `Asia/Jakarta` timestamp formatting.
  - `frontend/src/lib/dashboard/api.ts`: Typed `DashboardSummary` and `DashboardSummaryFilter`, `dashboardSummaryApi`, and `localDateRangeToUtcInterval` / `localDateStartToUtcIso` converting local calendar date boundaries (`00:00` in configured `Asia/Jakarta` timezone) to UTC RFC3339 inclusive `from` and exclusive `to` parameters.
  - `frontend/src/lib/index.ts`: Re-exports project, zone, and dashboard summary types and API helpers through `#lib`.
  - `frontend/src/lib/components/AppShell.svelte`: Enables `Proyek & Zona` (`/projects`) navigation link while preserving the integrated `Monitoring` (`/monitoring`) link and highlighting nested `/projects/[id]` routes as active.
  - `frontend/src/routes/(app)/projects/+page.svelte`: Project creation, search (`q`), status filtering (`active` / `archived`), pagination, inline editing, versioned deletion, `409 PROJECT_IN_USE` archival explanation with one-click `Arsipkan Sekarang`, `409 SESSION_ACTIVE` conflict visibility, and `409 VERSION_CONFLICT` unsaved-input preservation with `Muat Ulang Data Terbaru`.
  - `frontend/src/routes/(app)/projects/[id]/+page.svelte`: Project detail & zone CRUD owned by the project, archived-project zone creation guard, zone status filter and pagination, `409 ZONE_IN_USE` archival explanation with one-click `Arsipkan Sekarang`, `409 SESSION_ACTIVE` conflict visibility, and `409 VERSION_CONFLICT` unsaved-input preservation with reload.
  - `frontend/src/routes/(app)/+page.svelte`: Populates the root `/` dashboard with real `/api/v1/dashboard/summary` counts (`sessions`, `findings_pending`, `findings_confirmed`, `findings_rejected`, `confirmed_actions_open`), mode filter (`real`, `simulated`, `manual` kept strictly separate, defaulting to `real`), persisted project/zone selectors, local date range filter (`Asia/Jakarta`), explicit `count_unit: "finding"` ("bukan jumlah pekerja unik"), and distinct loading/empty/validation/backend-failure states while retaining system readiness and supported PPE category panels.
- **TDD & verification gates**:
  - **Red**: `npx playwright test tests/projects-dashboard.spec.ts --workers=1` on isolated ports `45173`/`48080` failed initially on missing `Proyek & Zona` navigation link (`getByRole('link', { name: /Proyek & Zona/i })` not found).
  - **Green**: `npx playwright test tests/auth-shell.spec.ts tests/projects-dashboard.spec.ts --workers=1` on ports `45173`/`48080` with `GOMAXPROCS=2`: `2 passed` against unchanged Go `cmd/api` and disposable SQLite.
  - **Frontend type/build gates**: `npm run check` (`svelte-check found 0 errors and 0 warnings`) and `npm run build` (`vite build` SSR + client succeeded).
  - **Supporting unchanged Go baseline**: `GOMAXPROCS=2 go test ./internal/handler -count=1` (`ok k3/backend/internal/handler 0.503s`).
  - **External backend dependencies (`NOT RUN`)**: Real Python PPE inference and live Gemini API generation remain external dependencies and are marked `NOT RUN`.
