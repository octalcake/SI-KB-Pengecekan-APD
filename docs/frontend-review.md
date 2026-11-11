# P0 frontend review

Independent standards and specification reviews compared `a9ddb6db5941716ca851937f2312551378506a24` (upstream `main`) with `11fdf4f91e59f5772c65ede3161407d193c00b2f`. This records the reviewed baseline; remediation and final verification are pending below.

Authoritative scope: [frontend only](frontend-only-scope.md). Backend, AI runtime, schema, and model changes are excluded. [Acceptance evidence](frontend-acceptance.md) separates deterministic fixtures from real PPE and live Gemini, which remain **NOT RUN**.

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

- Seven distinct material issues (four per axis, with one overlap).
- A single isolated implementation task is addressing the findings.
- Baseline acceptance: **7 passed** through real Go/SQLite/evidence and a labeled external inference fixture, including evidence hash equality and restart persistence.
- Final review-fix inspection, regression results, and PR readiness: **pending**.
