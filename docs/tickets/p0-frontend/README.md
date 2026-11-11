# P0 implementation task graph

Spec: [Complete the P0 frontend](../../spec-p0-frontend-integration.md).
Integration branch: `integration/p0-frontend`.
Base: `cbfcf803c78061d0de79b9368197c6447614d1d1` from upstream `main`.
Tracker: GitHub Issues in octalcake/SI-KB-Pengecekan-APD. Publication is pending authentication; these committed local records mirror the work and do not replace tracker closure.

| Ticket | End-to-end result | Blocked by | Planned agent |
|---|---|---|---|
| [P0-00](00-python-pipeline.md) | Actual Go/Python HTTP pipeline to a persisted simulated finding and original evidence | none; existing Go API | Antigravity 3 |
| [P0-01](01-access-and-shell.md) | Login, restored session, protected workspace, real readiness, logout | none | Antigravity 1 |
| [P0-02](02-master-data-and-summary.md) | Persisted project/zone CRUD and mode-separated dashboard | P0-01 | Antigravity 1 |
| [P0-03](03-monitoring-and-evidence.md) | Browser JPEG through real Go/Python to pending evidence | P0-00, P0-01 | Antigravity 3 |
| [P0-04](04-findings-and-follow-up.md) | Evidence review, correction, follow-up and manual entries | P0-03 | Antigravity 2 |
| [P0-05](05-reports-and-approval.md) | Closed-session report editing, staleness and approval lock | P0-04 | Antigravity 2 |
| [P0-06](06-real-ppe-runtime.md) | Recovered model in real inference mode with laptop evidence | P0-03 + model/runtime prerequisites | Antigravity 3 |
| [P0-07](07-acceptance-and-handoff.md) | Full runtime proof, review and handoff | P0-02,04,05,06 | Antigravity 3 then 1 |

## Execution rules

- Work only on the ready frontier. Each implementer uses a delegation-tool worktree based on the integration branch, reads its ticket and confirmed spec, uses the TDD skill at already-confirmed seams, commits its changes, and merges the current integration tip before reporting.
- A separate merger agent integrates each completed ticket; open and link a draft PR after the first functional merge, with real spec/ticket closing references once publication is available.
- The user subsequently requested Antigravity 1–3 all be assigned and explicitly said not to cancel the running task. Keep Antigravity 1's current implementation running; assign the independent actual-Python pipeline slice to Antigravity 3 and tracker publication to Antigravity 2. Bound test/build concurrency and avoid overlapping frontend stacks or heavyweight inference installs. The linked Mac cannot currently accept requested-provider work; discover its enabled Argon provider before future remote dispatch.
- Antigravity 2 failed before execution with `Verify your account to continue.` Its tickets are not silently reassigned to another provider/model.
- Tests use the user-confirmed browser -> real Go/SQLite/evidence/FastAPI seam, existing Go HTTP tests and Python contract tests, with separate real webcam/Gemini proof. No new user confirmation is required for those seams.
- Do not mark a ticket or spec closed from implementation or fixtures alone when required runtime or external acceptance remains unproved.

Current implementation frontier: P0-00 and P0-01. Antigravity 1's existing P0-01 work is preserved. GitHub publication is a separate ready coordination task for Antigravity 2; its earlier verification failure may still block it. No application implementation has landed on the integration branch yet.
