# P0-01: Sign in and enter the inspection workspace

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: GitHub publication pending; this local record is an implementation mirror, not a closed tracker issue.
Blocked by: None.
Assigned lane: Antigravity 1, Gemini 4 Argon, high.
Status: implemented-locally (tracker publication pending).

## What it delivers

An officer can log in through the existing Go API, reopen an authenticated workspace, see genuine system readiness, and log out. This establishes the shared frontend API/session contract and a usable Indonesian app shell.

## Acceptance criteria

- [x] Public API calls preserve cookies, CSRF, structured errors, and no-content responses; no business endpoint is duplicated in Svelte.
- [x] An unauthenticated visit reaches login; checking/restoring a session has an explicit loading state.
- [x] Incorrect credentials and backend failure have distinct recovery messages; successful login survives reload.
- [x] The workspace shows the authenticated officer and actual system mode/readiness.
- [x] Logout invalidates the session and clears protected UI; subsequent protected API/evidence requests fail.
- [x] Responsive, labeled, keyboard-usable login and shell match SRS operational UI.
- [x] One browser test is first shown failing, then passing against real Go/SQLite; frontend checks/build pass.
- [x] Document the small API/session exports for subsequent tickets; no speculative framework.

## Shared `#lib` API & Session Exports

All subsequent frontend tickets (`P0-02`..`P0-05`) import from `#lib` (or subpath `#lib/api/client`, `#lib/auth/session.svelte`, `#lib/types/api`):

- `API_BASE` (`'/api/v1'`)
- `apiData<T>(path, options?)`: executes same-origin request with cookie + automatic `X-CSRF-Token` on mutating methods and unwraps `{ data: T }`.
- `apiList<T>(path, options?)`: resolves paginated `{ data: T[]; meta: PageMeta }`.
- `apiNoContent(path, options?)`: resolves `204 No Content` without attempting JSON parsing.
- `apiRequest<T>(path, options?)`: low-level typed request helper supporting JSON objects, binary `Blob`/`Uint8Array`/`ArrayBuffer` (`image/jpeg`), and `FormData` multipart payloads.
- `ApiError` & `isApiError(err)`: structured error boundary exposing `status`, `code`, `message`, `fields`, `requestId`, `retryAfter`, and `isNetworkError`. Automatically invalidates `authSession` when a protected call receives `401`.
- `authSession`: reactive Svelte 5 runes store (`status`, `user`, `csrfToken`, `systemStatus`, `systemStatusLoading`, `systemStatusError`, `bootstrapError`, `sessionNotice`) with methods `bootstrap(force?)`, `login(username, password)`, `refreshSystemStatus()`, `logout()`, and `clearSession(notice?)`.
- Auth/system endpoint helpers: `loginApi`, `meApi`, `logoutApi`, `systemStatusApi`, `healthApi`, `getCsrfToken`, `setCsrfToken`, `onUnauthorized`.
- Shared types: `User`, `AuthSessionPayload`, `SystemMode`, `ViolationType`, `SystemStatus`, `HealthStatus`, `PageMeta`, `ApiEnvelope<T>`, `ApiListEnvelope<T>`, `ApiErrorBody`, `ApiErrorEnvelope`.

## Red / Green Verification Evidence

- **Initial Red (`npx playwright test`)**: against the starter health page + real Go (`127.0.0.1:18080`) + temporary SQLite DB, `tests/auth-shell.spec.ts` failed at `await expect(page).toHaveURL(/\/login$/)` (`Received: "http://localhost:15173/"`).
- **Final Green (`npm run check`, `npm run build`, `npx playwright test`)**:
  - `svelte-check`: `0 errors and 0 warnings`.
  - `vite build`: SSR and client bundles built cleanly.
  - `playwright test` (1 worker, temporary SQLite migrated from `001_init.sql` + seeded via `cmd/seed` + live `cmd/api` + Vite `/api` proxy): `1 passed` (`GET /auth/me -> 401`, `POST /auth/login (bad) -> 401`, network abort -> distinct backend alert, `POST /auth/login (valid) -> 200`, `GET /system/status -> 200`, reload `GET /auth/me -> 200`, `POST /auth/logout -> 204`, post-logout `GET /auth/me -> 401`, `GET /system/status -> 401`, `GET /findings/1/evidence -> 401`).

## Scope

No project forms, camera, findings, or reports yet. Frontend only: consume existing Go auth unchanged. Report backend gaps instead of changing Go/Python code, schema, or server configuration. See the authoritative frontend-only scope correction.
