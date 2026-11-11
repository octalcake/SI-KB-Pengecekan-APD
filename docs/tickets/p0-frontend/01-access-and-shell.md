# P0-01: Sign in and enter the inspection workspace

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: GitHub publication pending; this local record is an implementation mirror, not a closed tracker issue.
Blocked by: None.
Assigned lane: Antigravity 1, Gemini 4 Argon, high.
Status: in progress in the existing Antigravity 1 worktree; do not cancel or duplicate this implementation.

## What it delivers

An officer can log in through the existing Go API, reopen an authenticated workspace, see genuine system readiness, and log out. This establishes the shared frontend API/session contract and a usable Indonesian app shell.

## Acceptance criteria

- [ ] Public API calls preserve cookies, CSRF, structured errors, and no-content responses; no business endpoint is duplicated in Svelte.
- [ ] An unauthenticated visit reaches login; checking/restoring a session has an explicit loading state.
- [ ] Incorrect credentials and backend failure have distinct recovery messages; successful login survives reload.
- [ ] The workspace shows the authenticated officer and actual system mode/readiness.
- [ ] Logout invalidates the session and clears protected UI; subsequent protected API/evidence requests fail.
- [ ] Responsive, labeled, keyboard-usable login and shell match SRS operational UI.
- [ ] One browser test is first shown failing, then passing against real Go/SQLite; frontend checks/build pass.
- [ ] Document the small API/session exports for subsequent tickets; no speculative framework.

## Scope

No project forms, camera, findings, or reports yet. Frontend only: consume existing Go auth unchanged. Report backend gaps instead of changing Go/Python code, schema, or server configuration. See the authoritative frontend-only scope correction.

