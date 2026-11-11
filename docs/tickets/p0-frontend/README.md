# P0 implementation task graph

Spec: [Complete the P0 frontend](../../spec-p0-frontend-integration.md).
Authoritative scope: [frontend only, existing APIs unchanged](../../frontend-only-scope.md).
Integration branch: `integration/p0-frontend`.
Base: originally `cbfcf803c78061d0de79b9368197c6447614d1d1` from upstream `main`, synced via normal merge with upstream `origin/main` (`a9ddb6db5941716ca851937f2312551378506a24`, PR #14) with `backend/` and `ai-service/` verified byte-for-byte identical to `origin/main`.
Tracker: [spec #4](https://github.com/octalcake/SI-KB-Pengecekan-APD/issues/4), with active frontend tickets #6, #7, #8, #9, #10 and #12. Publication and native dependency relationships have been verified against the current frontend-only scope. Backend tickets #5 and #11 are closed as not planned. See tracker-publication.json for the live-verified mapping.

| Ticket | End-to-end result | Blocked by | Planned agent |
|---|---|---|---|
| [P0-01](01-access-and-shell.md) | Login, restored session, protected workspace, real readiness, logout | none | Antigravity 1 |
| [P0-02](02-master-data-and-summary.md) | Persisted project/zone CRUD and mode-separated dashboard | P0-01 | Antigravity 1 |
| [P0-03](03-monitoring-and-evidence.md) | Browser camera/session/frame API integration and readiness/error UI | P0-01 for final integration | Antigravity 3 |
| [P0-04](04-findings-and-follow-up.md) | Evidence review, correction, follow-up and manual entries | P0-01 for final integration | Antigravity 2 |
| [P0-05](05-reports-and-approval.md) | Closed-session report editing, staleness and approval lock | P0-04 | Antigravity 2 |
| [P0-07](07-acceptance-and-handoff.md) | Frontend acceptance, API integration review and handoff | P0-02,03,04,05 | Antigravity 3 then 1 |

P0-00 (Python pipeline) and P0-06 (model/runtime) are cancelled/out of scope for this delivery. Their historical files are retained as records, not implementation instructions.

## Execution rules

- Work only on the ready frontier. Each implementer uses a delegation-tool worktree based on the integration branch, reads its ticket and confirmed spec, uses the TDD skill at already-confirmed seams, commits its changes, and merges the current integration tip before reporting.
- A separate merger agent integrates each completed ticket; open and link a draft PR after the first functional merge, with real spec/ticket closing references once publication is available.
- The user requested Antigravity 1–3 all be assigned and clarified FRONTEND ONLY. Preserve/resume Antigravity 1's existing login work, assign Antigravity 2 findings/report frontend, and Antigravity 3 monitoring frontend. No backend edits or inference installs. Frontend feature components may be prepared concurrently; final shared-auth integration/browser acceptance waits for P0-01. Bound test/build concurrency and use nonconflicting ports. The linked Mac has no runnable requested provider yet.
- Tracker publication later succeeded after authentication became available. The coordinator corrected its older scope, closed backend-only tickets as not planned, and verified frontend-only issue bodies and native dependency links. Antigravity 3's backend task failed before edits and was explicitly stopped from resuming. Preserve requested provider/model choices and frontend assignments.
- Tests use the user-confirmed browser -> real Go/SQLite/evidence/FastAPI seam, existing Go HTTP tests and Python contract tests, with separate real webcam/Gemini proof. No new user confirmation is required for those seams.
- Do not mark a ticket or spec closed from implementation or fixtures alone when required runtime or external acceptance remains unproved.

## Integration Status

- **P0-01 (#6)**: Integrated at `3d0fea498575b6c6119f13f388a2f1d71308765e` with verified frontend checks/build and real-Go browser test (`tests/auth-shell.spec.ts`).
- **P0-03 (#8)**: Integrated from `t3/frontend-monitoring-capture` (`92548b193d01cef5c4f69bb372dbdace3a487935`) at `e493551e5c7e8dab2ad4a6f1eb2552e0e7022df3` with `/monitoring` sidebar navigation enabled in `AppShell.svelte`, verified frontend build/checks, 6 contract/controller assertions, and 2 real-Go/disposable-SQLite browser tests (`tests/monitoring.spec.ts`).
- **P0-02 (#7)**: Integrated from `t3/project-dashboard-p0-02` (`0f29d4c25a4a388292e0c28aa862370d3f3388d6`) with `/projects` sidebar navigation enabled in `AppShell.svelte`, mode-separated `/` dashboard summary, verified frontend build/checks, and passing real-Go/SQLite browser tests (`tests/auth-shell.spec.ts` + `tests/projects-dashboard.spec.ts`).
- **P0-04 (#9)**: Integrated from `t3/findings-frontend` (`f77843558fcc9b7b88cd303e385d18ba5627be06`) with `/findings` (`Temuan`) sidebar navigation enabled in `AppShell.svelte`, verified frontend build/checks, and passing real-Go/SQLite/evidence browser test (`tests/findings-and-follow-up.spec.ts`, recorded from actual passing behavior/check/build evidence).
- **P0-05 (#10)**: Integrated from `t3/implement-report-workflows` (`b398a75e900d42034ea2de14eedf1d8ec706e36f`) with `/reports` navigation and real-Go/SQLite coverage of manual/template edit, staleness, approval locks, idempotency recovery, and truthful Gemini failure. The unsafe automatic delete/recreate action was removed during review remediation; independently confirmed delete/create and in-place Gemini regeneration remain available.
- **Upstream `origin/main` sync**: Merged `origin/main` (`a9ddb6db5941716ca851937f2312551378506a24`, PR #14) cleanly; `backend/` and `ai-service/` are byte-for-byte identical to `origin/main`, and the three-dot diff (`origin/main...HEAD`) is strictly frontend and docs only.
- **P0-07 (#12)**: All seven material standards/spec findings are addressed. Merged code `14b064e` passed frontend check (0 errors/warnings), production build, and the full serial suite (7 tests), including exact evidence JPEG preservation after a Go restart. See [acceptance](../../frontend-acceptance.md) and [review](../../frontend-review.md). Task worktrees were unregistered and branch refs retained; two empty Windows-locked directories remain. Test processes are stopped.
- **External runtime gates & delivery**: Real PPE and live Gemini validation remain **NOT RUN**. PR #13 contains closing references for #4, #6, #7, #8, #9, #10, and #12; those issues close on PR merge. No frontend implementation frontier remains.
