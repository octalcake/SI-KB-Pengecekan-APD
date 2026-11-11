# Frontend architecture

The frontend is organized by feature with inward dependencies. Routes adapt SvelteKit navigation/parameters; features own behavior and screens; `app` supplies concrete dependencies. This migration is based on `eb967bb2888471a977f6511e96d44a73dbecc3c4`, including phone PR #16 and Bun/CI PR #17.

## Actual source tree

```text
frontend/src/
  routes/
    +layout.svelte                 global styling/favicon
    login/+page.svelte             LoginPage adapter
    (app)/+layout.svelte           authenticated shell/bootstrap
    (app)/+page.svelte             DashboardPage adapter
    (app)/{projects,monitoring,findings,reports}/...
  lib/
    app/
      AppShell.svelte
      auth.ts                     one session + auth workflow wiring
      projects.ts                 project/zone adapter + normalization
      dashboard.ts                summary + project lookup wiring
      monitoring.ts               HTTP/camera/runtime + capture wiring
      findings.ts                 finding/evidence + context wiring
      reports.ts                  report context + per-screen requests
      lookups.ts                  project/zone/session lookup adaptation
    features/
      auth/
        domain/types.ts
        application/auth-workflow.ts
        infrastructure/http-adapter.ts
        presentation/{LoginPage.svelte,session.svelte.ts}
        domain.ts                 pure public types
      projects/
        domain/types.ts
        application/projects-workflow.ts
        infrastructure/http-adapter.ts
        presentation/{ProjectsListPage.svelte,ProjectDetailPage.svelte,format.ts}
        domain.ts, application.ts  public models/lookup contract
      dashboard/
        domain/{types.ts,summary.ts}
        application/dashboard-workflow.ts
        infrastructure/http-adapter.ts
        presentation/DashboardPage.svelte
      monitoring/
        domain/{types.ts,geometry.ts}
        application/{contracts.ts,capture-workflow.ts}
        infrastructure/{http-adapter.ts,camera-adapter.ts}
        presentation/{MonitoringView.svelte,SnapshotOverlay.svelte,errors.ts}
        domain.ts                 public session types
      findings/
        domain/types.ts
        application/findings-workflow.ts
        infrastructure/http-adapter.ts
        presentation/{FindingsGalleryPage.svelte,FindingDetailPage.svelte,
          FindingEvidenceViewer.svelte,ManualFindingForm.svelte,format.ts,evidence-state.ts}
      reports/
        domain/types.ts
        application/{report-context.ts,report-requests.ts}
        infrastructure/{http-adapter.ts,request-key.ts}
        presentation/{ReportsListPage.svelte,ReportDetailPage.svelte,format.ts}
    shared/
      domain/types.ts
      errors.ts
      envelopes.ts
      http/client.ts
    assets/favicon.svg
```

## Dependency rules and seams

- Domain contains pure resource models, aliases to canonical owner models, and calculations (dashboard date intervals and monitoring geometry). Projects owns zones; monitoring owns session models. Wire field names remain where they already describe the domain.
- Application imports its own domain, shared pure definitions, and intentional foreign public domain/application contracts. It cannot import Svelte/SvelteKit, browser runtime globals, transport, infrastructure, presentation or `app`, even transitively through shared helpers or public barrels.
- Infrastructure contains relative Go HTTP calls, camera/JPEG sampling, and UUID generation. It cannot depend on presentation or `app`. `MonitoringHttpClient` is private to infrastructure. Capture receives clocks, scheduler, abort creation, camera release, object-URL cleanup, error classification, JPEG sampling and session/frame operations.
- Presentation contains Svelte screens, `$state` session storage, display text and error formatting. Screens call composed operations from `app`; they cannot import concrete infrastructure/generic HTTP or call `fetch`.
- `app` is the composition seam. It may import private modules from different features to supply dependencies. Cross-feature imports elsewhere must use an explicit pure `domain.ts` or `application.ts` entrypoint. There is no broad feature index or root `#lib` barrel.
- Shared imports no feature or `app`. `shared/http/client.ts` is the only generic transport, including evidence blobs and 401 invalidation. Auth endpoints live in auth infrastructure.

The application interfaces are the test surface. Deterministic test adapters provide a second implementation at each tested seam. No DI framework, new packages, endpoint classes or speculative DTO mappings were added. Simple operations are composed directly; project normalization overrides only operations that need it instead of repeating every forwarding method.

## Extracted behavior

- Auth installs CSRF after bootstrap/login, classifies bootstrap failures, and awaits registered cleanup before logout. Stop failure is best effort; non-401 logout failure retains session state, while success/401 clears it. Reactive deduplication/state remains in presentation.
- Projects normalizes submitted text and filters while preserving optimistic versions and archive intent. Existing edit/conflict/route identity guards remain in screens.
- Dashboard converts local date filters into inclusive/exclusive UTC bounds and normalizes project/zone IDs before summary loading. Request-sequence guards remain with reactive state.
- Findings loads context independently with partial lookup failure and assembles gallery lookups. Project/zone/session operations come from their owners at composition. Evidence retains central auth/error handling, cancellation, retry, 410/403 states and URL cleanup.
- Capture retains single-in-flight sampling, sequence/elapsed values, skipped ticks, Retry-After backoff, original JPEG snapshot/event association, terminal stops and cleanup. Object-URL cleanup is best effort: adapter failure does not interrupt disposal of a canceled sample or session shutdown. Browser adapters supply camera/runtime operations. Start cancellation, DOM attachment and route/tab listeners remain in monitoring presentation.
- Reports assembles session eligibility context and owns per-screen request keys scoped to session or report identity/version. Lost responses reuse keys; explicit fresh operations and source/idempotency/version conflicts replace them. Approval requires a fresh draft and review acknowledgement. Failed operations preserve officer edits. There is no automatic report deletion/recreation.

## Adding or changing a feature

1. Put models and actual invariants/calculations in its domain. Reuse owner models through narrow public contracts instead of duplicating project/zone/session definitions.
2. Extract orchestration into a small typed function/factory when it hides real ordering, normalization or decisions. Accept dependencies. Do not add a forwarding tier for every endpoint.
3. Implement Go/browser adapters in infrastructure using shared transport. Compose them once in `app/<feature>.ts`.
4. Keep reactive/UI state in presentation; put error parsing and Indonesian display helpers there. Make routes thin adapters with reactive params for detail screens.
5. Exercise behavior through injected deterministic adapters, then run checks below. Public contracts must stay pure; extend guard fixtures for new resolution patterns.

## Verification commands and receipts

From `frontend/`, using Bun **1.4.4** and Node **24**:

```powershell
bun install --frozen-lockfile
bun run lint
bun run check:architecture
bun run test:application
bun run check
bun run build
$env:GOMAXPROCS='2'
$env:GOFLAGS='-p=2'
$env:TEST_WEB_PORT='46173'
$env:TEST_API_PORT='46080'
$env:TEST_JOURNEY_STACK_WEB_PORT='46175'
$env:TEST_JOURNEY_STACK_API_PORT='46085'
$env:TEST_JOURNEY_STACK_AI_PORT='46009'
$env:TEST_REPORT_STACK_WEB_PORT='46176'
$env:TEST_REPORT_STACK_API_PORT='46086'
$env:PLAYWRIGHT_HTML_OPEN='never'
bun run test:e2e --workers=1 --reporter=line
```

`check` executes the architecture guard, its fixture tests, deterministic application/transport tests, SvelteKit sync and strict `svelte-check`, so existing CI runs them without a workflow rewrite. The guard uses the TypeScript AST and Svelte parser, resolves relative and `#lib/` imports/exports/dynamic imports/import types/require, rejects private foreign access and outward dependencies (including transitively), and checks framework/browser/HTTP usage, including Svelte runes in inner modules. Infrastructure cannot reach presentation/composition through helpers; presentation cannot reach transport through helpers, while composed operations remain allowed. Computed module specifiers are rejected because they cannot be verified statically.

Verification on 2026-11-11: frozen install, lint, architecture guard + **8 fixture tests**, **10 deterministic application/transport tests**, typecheck (**0 errors, 0 warnings**), production build and the **full 8-test serial Playwright suite** passed. The final browser suite passed in **1.0m** after restoring best-effort URL cleanup and tightening the guard. Both explicitly serial journey tests ran together; the existing 48-state phone/landscape/desktop audit and photo aspect-ratio assertion remain intact. Acceptance screenshots/hash summaries are generated under ignored `frontend/test-results/`.

All 13 moved screen markup/style blocks were compared as UTF-8 against the baseline, normalizing only line endings. They match except the approval button's disabled expression now calls the extracted approval decision. Original UI strings, selectors, phone CSS/touch targets/safe areas and the scrollable photo dialog remain intact.

Go ran unchanged with disposable SQLite/evidence and bounded build concurrency. Fixture inference is test-only. **Real PPE inference, physical webcam acceptance and live Gemini: NOT RUN.** Existing adapter-auto reports no deployment platform detected; deployment configuration is outside this migration. Backend/AI/dependency/lockfile/CI changes relative to the baseline are excluded.
