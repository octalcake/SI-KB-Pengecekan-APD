# P0 frontend review

Independent standards and specification reviews compared `a9ddb6db5941716ca851937f2312551378506a24` (upstream `main`) with baseline `11fdf4f91e59f5772c65ede3161407d193c00b2f`. Remediation was implemented in `e2b6011d7df5765ba0993257e2e51a5e0cba9c6e` (`t3/frontend-review-fixes`) and `cd7dfc1dc43dada5d079f345b42eb166351855da` (shared binary transport in `client.ts`), then merged and verified at `14b064ee9e653a0eecd548f93e4a4b41c6f6eebc`.

Authoritative scope: [frontend only](frontend-only-scope.md). Backend, AI runtime, schema, and model changes are excluded. [Acceptance evidence](frontend-acceptance.md) separates deterministic fixtures from real PPE and live Gemini, which remain **NOT RUN** (external system dependencies unverified in this frontend-only scope despite upstream code availability).

## Standards

Four material findings:

1. **Medium — evidence requests bypass shared authentication handling.** `frontend/src/lib/findings/api.ts` uses a separate raw `fetch` and error parser. A `401` during evidence loading does not invalidate the shared session. The shared-interface rule requires the common client and session behavior. Use the shared transport for binary responses too.
2. **Medium — monitoring thumbnails have no missing-evidence state.** `MonitoringView.svelte` renders an image directly; `410 EVIDENCE_MISSING` becomes a broken image. The SRS and product require explicit missing/error/retry states. This overlaps specification finding 1.
3. **Medium — stale asynchronous responses overwrite current selections.** Dashboard summary/zone lookups and project-detail loads can finish out of order. A slower prior selection can replace the latest data, error, or loading state. Guard completions by request identity and selected record.
4. **Low — stale reports can be submitted for approval through the UI.** `ReportDetailPage.svelte` disables approval only while submitting. The SRS requires approval to be disabled when the source is stale; retain server error handling for concurrent source changes.

Two optional smell heuristics: duplicated feature-specific lookup/formatting code and trivial authentication/error wrappers. These are judgment calls, not additional product failures. Avoid a broad abstraction/refactor solely to remove similar code; remove trivial wrappers only where it simplifies the touched paths.

## Spec

Four material findings:

1. **Medium — missing monitoring evidence is not explicit.** Requirement: missing evidence must have a specific state, without a substitute image. See the overlapping standards finding 2.
2. **High — template replacement can lose an existing draft.** Requirement: real failure must preserve prior drafts. `handleRecreateFreshTemplateDraft` deletes the old report before creating its replacement. If creation fails, the old draft is soft-deleted and inaccessible through normal active-report UI. It is not permanently erased, but the workflow still loses accessible draft state. A preflight count cannot make two requests atomic. Remove the compound action; preserve in-place Gemini regeneration and separately confirmed delete/create operations.
3. **Medium — capture cards guess track/category metadata.** Requirement: display server-returned findings without inventing associations. `capture.ts` assigns the first positive track/category to every event, although Go's event contains no association fields. With multiple tracks/events the labels can be wrong. Omit unknown labels or retrieve the actual finding.
4. **Medium — logout occurs before authenticated monitoring cleanup.** Requirement: logout ends camera activity and sends an authenticated best-effort stop. Cookie invalidation happens first, so cleanup can receive `401`. The session store also clears local auth after failed logout. Stop/release before invalidation and retain local auth on network/server failure so logout can be retried.

## Resolution

### Dispositions of the Seven Material Findings

1. **Binary evidence requests share common auth/CSRF/error pipeline (Standards #1)**: **Resolved (`cd7dfc1` + `e2b6011`, merged at `14b064e`)**. `apiRequest` in [`frontend/src/lib/api/client.ts`](../frontend/src/lib/api/client.ts) accepts `responseType: 'json' | 'blob' = 'json'` and `apiBlob` wraps that single transport. `fetchProtectedEvidenceBlob` in [`findings/api.ts`](../frontend/src/lib/findings/api.ts) delegates to it. Binary `401` responses clear CSRF and notify the shared session store, which calls `clearSession`.
2. **Explicit missing/forbidden/auth/error states & object-URL cleanup for monitoring thumbnails (Standards #2 / Spec #1)**: **Resolved (`e2b6011`)**. [`MonitoringView.svelte`](../frontend/src/lib/monitoring/MonitoringView.svelte) loads thumbnails through `apiBlob`, tracks loading/ready/error states, distinguishes missing evidence (`410`), expired session (`401`) and forbidden access (`403`), and revokes `blob:` URLs on cleanup. The finding link remains available for authoritative details and evidence recovery; no replacement photo is shown.
3. **Stale asynchronous response guards on dashboard and project detail (Standards #3)**: **Resolved (`e2b6011`)**. Dashboard `handleProjectFilterChange` and `loadSummary` guard responses with request counters and selected-project checks. Project detail guards `loadProject` and `loadZones` with `projectReqSeq`/`zonesReqSeq` and `projectId` identity, resetting old forms on route changes while preserving same-record conflict edits.
4. **Disable approval button when report source is stale or unacknowledged (Standards #4)**: **Resolved (`e2b6011`)**. [`ReportDetailPage.svelte`](../frontend/src/lib/reports/ReportDetailPage.svelte) uses `disabled={approving || isStale || !reviewAcknowledged}`, where `isStale` derives from `report.is_stale`. Backend `409 STALE_REPORT` and `422 VALIDATION_ERROR` handling remains available for concurrent changes and invalid requests.
5. **Remove non-atomic automatic delete + template recreate action (Spec #2)**: **Resolved (`e2b6011`)**. Removed `handleRecreateFreshTemplateDraft` from [`ReportDetailPage.svelte`](../frontend/src/lib/reports/ReportDetailPage.svelte) and updated [`docs/tickets/p0-frontend/05-reports-and-approval.md`](tickets/p0-frontend/05-reports-and-approval.md). In-place Gemini regeneration (`POST /api/v1/reports/{id}/regenerate`) and separately confirmed draft deletion (`DELETE /api/v1/reports/{id}`) + new template draft creation (`POST /api/v1/reports`) remain intact and independently confirmed.
6. **No guessed track/category associations on capture cards (Spec #3)**: **Resolved (`e2b6011`)**. [`capture.ts`](../frontend/src/lib/monitoring/capture.ts) omits unassociated track/category fields. Cards show the server's finding ID, verification status, sequence, mode, time, and a link to the persisted finding detail. They do not fetch or invent an event-to-track association.
7. **Pre-logout monitoring/camera stop and auth retention on failed logout (Spec #4)**: **Resolved (`e2b6011`)**. [`authSession.registerBeforeLogout`](../frontend/src/lib/auth/session.svelte.ts) runs [`MonitoringView.svelte`](../frontend/src/lib/monitoring/MonitoringView.svelte) cleanup (releasing the media stream and sending an authenticated best-effort `POST /api/v1/monitoring/sessions/{id}/stop`) *before* calling `POST /api/v1/auth/logout`, and retains local session state if `/auth/logout` fails with a non-`401` error so the officer can retry.

### Optional Smells Disposition

- Feature-specific lookup/date formatting helpers remain intentionally localized per module (`projects`, `findings`, `reports`, `monitoring`) to avoid broad cross-module refactoring unrelated to material defects.

### Final Verification at Merged Code SHA `14b064ee9e653a0eecd548f93e4a4b41c6f6eebc`

- **Type & Svelte Check (`npm run check`)**: Exit code `0` (`svelte-check found 0 errors and 0 warnings`).
- **Production Build (`npm run build`)**: Exit code `0` (SSR and client bundles built cleanly).
- **Full Serial Playwright Acceptance Suite**:
  - Command: `$env:TEST_WEB_PORT='62173'; $env:TEST_API_PORT='62080'; $env:GOMAXPROCS='2'; $env:GOFLAGS='-p=2'; npx playwright test --workers=1 --reporter=list`
  - Result: **7 passed (47.6s)** across all 6 spec files (`auth-shell.spec.ts`, `findings-and-follow-up.spec.ts`, `inspection-journey.spec.ts`, `monitoring.spec.ts`, `projects-dashboard.spec.ts`, `reports-and-approval.spec.ts`), exit code `0`.
  - Evidence SHA-256 receipt (`frontend/test-results/acceptance/journey-evidence-summary.json`): triggering JPEG, stored evidence, and post-restart evidence all match `e6ebbebf3676c7fb953e0b1389ca0d73f36536d92448994f1e6041270ca0f146` (`640×480`, `6500` bytes, frame sequence `#2`), distinct from UI screenshot `bf9ce7e6a43061787413c058f10013e57e1b6176c100c1ec36aa07a8b5455bc6`.
  - Process cleanup: `0` leftover `api`, `seed`, or test port listeners after run.
