# Frontend integration interface

Owner: Antigravity 1's preserved P0-01 frontend work. Reuse this interface when composing monitoring, findings and reports; do not create a second login/session stack. This is an interface snapshot for concurrent feature preparation, not a claim that P0-01 has landed or passed tests.

The existing P0-01 work exports through `#lib`:

- `apiData<T>(path, options?)` resolves one unwrapped resource; `apiList<T>(path, options?)` resolves the list envelope including data/meta; `apiNoContent(path, options?)` resolves a 204 operation.
- Paths are relative to the API base, such as `/projects`. Options carry method, headers, body and normal fetch options. An object body is JSON; Blob/FormData/binary bodies are preserved rather than stringified. Do not set a multipart boundary yourself.
- `ApiError` and `isApiError` expose status, code, message, field errors, request ID, retry-after and network-error state. Handle versions/locks/readiness explicitly, without automatic mutation retries.
- `authSession` owns bootstrap, login/logout, authenticated user, CSRF, and system readiness. Its state includes status, user, csrfToken, systemStatus, loading/error/notice fields; methods include bootstrap, refreshSystemStatus, login and logout.
- `getCsrfToken`, `systemStatusApi`, `setCsrfToken`, and auth API helpers are also exported, but feature pages should consume the central session rather than implement another bootstrap.
- Existing API/type definitions and the SRS are the resource contract. Feature-specific resource types/API calls belong with that feature.

Feature preparation may define components and API consumers against this agreed interface before its implementation lands. Do not stub or replace the shared client in production code just to turn a missing-foundation check green. Before final feature acceptance, merge the integration tip containing P0-01, connect its actual exports, and run frontend/browser checks. Report any dependency gap honestly.

Disjoint ownership: 1 owns shared auth/API/UI styles and project/dashboard routes; 2 owns finding/report modules and routes; 3 owns monitoring modules and route. Package/lockfile/test-runner changes are serialized through the integration coordinator. Do not modify another agent's frontend worktree or any backend/AI source.
