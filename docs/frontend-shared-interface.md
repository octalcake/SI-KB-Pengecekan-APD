# Frontend integration interface

The frontend uses feature-first clean architecture. See [frontend-architecture.md](frontend-architecture.md) for the tree, rules and commands. This replaces the older concurrent-preparation snapshot and its broad `#lib` exports.

- `shared/http/client.ts` is the single generic transport: relative `/api/v1`, same-origin cookies, CSRF, JSON/binary/multipart bodies, JSON/list/blob responses, request IDs, retry metadata and central 401 notification. Feature infrastructure uses it; screens do not.
- `shared/errors.ts` exports `ApiError` and `isApiError` without a transport/framework dependency. `shared/envelopes.ts` holds envelopes/pagination; `shared/domain/types.ts` holds `SystemMode` and `ViolationType`.
- `app/auth.ts` composes the only `authSession`: bootstrap, login/logout, readiness, current user/CSRF, notices and `registerBeforeLogout`. Reactive state lives in auth presentation; sequencing lives in application. Monitoring cleanup stops capture/releases camera before logout. Failed non-401 logout retains authentication.
- `app/{projects,dashboard,findings,monitoring,reports}.ts` composes typed feature operations/workflows. `app/lookups.ts` adapts project/zone and monitoring-session lookups for findings/reports; those features no longer maintain duplicate endpoint consumers.
- Projects owns project/zone models and CRUD; monitoring owns sessions. Cross-feature model imports use explicit `features/projects/domain.ts`, `features/monitoring/domain.ts`, or `features/auth/domain.ts`. Dashboard uses the type-only `features/projects/application.ts` lookup contract. Public contracts export no Svelte or adapters.
- Resource fields still match the existing Go contracts. Mutations preserve optimistic versions. Reports retain request keys after lost responses and require review acknowledgement before approval. There are no automatic mutation retries or delete/recreate report workflows.

All paths above are relative to `frontend/src/lib/`. The authoritative scope remains [frontend-only-scope.md](frontend-only-scope.md). Backend/AI code, schema, server configuration and dependencies are outside this migration.
