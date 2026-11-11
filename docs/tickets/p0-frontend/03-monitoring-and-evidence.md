# P0-03: Integrate the browser monitoring frontend with existing APIs

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: https://github.com/octalcake/SI-KB-Pengecekan-APD/issues/8 — open frontend implementation ticket.
Blocked by: P0-01 for final shared-auth integration and browser acceptance. Frontend monitoring components and contract-driven capture logic can be prepared independently. P0-00 is cancelled/out of scope.
Assigned lane: Antigravity 3, Gemini 4 Argon, high.
Status: integrated in `integration/p0-frontend` (GitHub issue #8 remains open until final integration PR acceptance).

## What it delivers

An officer selects an existing project/zone, sees the server's readiness/mode, starts and stops browser monitoring through existing Go endpoints, sends serialized JPEGs, displays exact returned inference snapshots and finding links, and receives useful errors when the backend is unavailable. This ticket changes frontend code only.

## Acceptance criteria

- [x] Consume existing system-status/session/frame/stop APIs; no Go/Python, schema, model/runtime, or backend test files are changed.
- [x] Server mode/capabilities determine UI readiness; simulation/manual provenance is visible; unavailable real mode never silently becomes simulation.
- [x] Camera is user initiated, video only, aspect-preserving at most 640×480, target 1 FPS with one request in flight and no backlog.
- [x] Headers/times/sequences and snapshot-only normalized overlays follow the contract.
- [x] Stop/logout/route leave/hidden tab/device loss/errors release media and best-effort close the session; idle timeout remains a backstop.
- [x] Display server-returned events/evidence links without inventing findings or implementing server temporal/dedupe rules in the browser.
- [x] Existing API unknown, timeout, restart, second-session, size/format/rate/sequence, and authentication errors have correct frontend recovery behavior.
- [x] Frontend check/build and relevant browser capture/readiness/lifecycle tests pass; unavailable actual inference is explicitly NOT RUN with its backend dependency, not implemented as part of this task.

## Implementation & Verification Evidence

- **Source commit**: `92548b193d01cef5c4f69bb372dbdace3a487935` (`t3/frontend-monitoring-capture`), implementing `/monitoring` route (`frontend/src/routes/(app)/monitoring/+page.svelte`), `MonitoringView.svelte`, `SnapshotOverlay.svelte`, `api.ts`, `capture.ts`, `types.ts`, `index.ts`, and `frontend/tests/monitoring.spec.ts`.
- **Integration navigation activation**: `frontend/src/lib/components/AppShell.svelte` default `Monitoring` nav entry updated from `disabledReason` to `href: '/monitoring'`.
- **Checks & tests**:
  - `npm run check` (`svelte-check`) and `npm run build` (`vite build`): `0 errors and 0 warnings`.
  - Contract/controller checks (6 assertions in `frontend/tests/monitoring.spec.ts`): aspect-preserving `640×480` sizing (`1280×720 -> 640×360`, `480×960 -> 240×480`), normalized `[x_min,y_min,x_max,y_max]` bbox scaling, `DEFAULT_CAMERA_CONSTRAINTS` (`video` ideal `640×480`, `audio: false`), `POST /api/v1/monitoring/sessions/{id}/frames` binary JPEG + `X-Frame-Sequence` / `X-Captured-At` / `X-Sample-Elapsed-Ms` headers, `TRACKER_RESET` vs `FRAME_TOO_FAST` (`Retry-After`) error classification, and single-in-flight capture loop with `skippedBusyTicks` (no backlog queue).
  - Browser suite (`npx playwright test tests/monitoring.spec.ts --workers=1`, `2 passed` against unchanged Go `cmd/api` + disposable SQLite + test-only fake-camera/frame fixtures):
    - Authenticated sidebar `Monitoring` link navigates to `/monitoring` (`aria-current="page"`).
    - Loads persisted active projects and zones from real Go/SQLite.
    - Displays truthful server mode/readiness (`mode=real`, `ai_ready=false`).
    - Clicking "Mulai Monitoring" against unchanged Go when Python `/internal/v1/*` is unavailable returns `503 AI_UNAVAILABLE`, surfaces the truthful error alert without switching to simulated mode, and immediately stops/releases camera tracks (`audio: false`).
    - Verifies `409 CAMERA_BUSY` recovery with request ID, `503 TRACKER_RESET` camera release and session interruption, labeled deterministic fixture JPEG frame upload + separate snapshot-only normalized bbox overlays (zero bbox overlays on live `<video>`), `finding_created` link to `/findings/{id}`, explicit `user_stop`, and `visibilitychange` (`page_hidden`) lifecycle stop.
- **External backend dependencies (`NOT RUN`)**:
  - Real Python PPE inference (`/internal/v1/health`, `/internal/v1/detect`, `/internal/v1/tracks/reset`) and real Gemini report generation are **NOT RUN** and outside frontend implementation scope.

## Hard scope boundary

Read backend contracts as needed but edit frontend/ only. Existing backend processes may run unchanged against disposable test data. Do not implement missing AI endpoints, load models, change server mode/configuration to simulate success, or install Python inference dependencies. Reuse the shared frontend API/session exports from P0-01 when integrating the completed route.


