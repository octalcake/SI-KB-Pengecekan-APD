# Authoritative frontend-only scope correction

The user clarified that this work is **frontend development and integration with the existing APIs only**. This correction supersedes any earlier plan, ticket, or spec language assigning Go/Python, inference, migrations, or other backend implementation.

- Build the Svelte frontend: login/session, navigation, project/zone CRUD, dashboard, browser-camera monitoring, finding review/follow-up/manual forms, and report editing/approval.
- Call existing relative Go APIs with their documented cookie/CSRF, payload, version, error, and state contracts.
- Do not edit backend/ or ai-service/, add Go/Python business logic, implement missing endpoints, change schema/migrations, install inference dependencies, recover/train models as an implementation task, or change server configuration to hide a backend gap.
- Existing backend code may be read and run unchanged for frontend integration checks using a disposable test database/evidence. Test fixtures are test-only and clearly labeled; they cannot become production API mocks.
- A missing or unavailable backend capability must have an accurate frontend readiness/error state and be reported as an external dependency. It is not permission to build that backend capability.
- Backend-only tickets P0-00 and P0-06 are cancelled from this frontend delivery. Physical real-AI/Gemini validation remains a separate external-system prerequisite, not a reason to expand frontend scope.

## Requested frontend ownership

- Antigravity 1, Argon High: preserve and finish the existing login/session/app-shell work, then projects/zones/dashboard.
- Antigravity 2, Argon High: finding/review/follow-up/manual-entry and report frontend integration. GitHub publication is deferred while the available browser and CLI are signed out.
- Antigravity 3, Argon High: browser monitoring/capture UI and existing session/frame API integration, with no server changes. Its last run failed before edits because account verification is required.

Preserve existing frontend worktrees and edits. No provider/model substitution. Use worktree isolation and bounded test/build concurrency; shared frontend API exports come from the existing Antigravity 1 work.

## Validation

The user already confirmed browser/public-HTTP behavior testing, reuse of existing Go tests, labeled deterministic inference fixtures, and separate real webcam/Gemini acceptance. Apply those to frontend behavior without modifying the backend. Record unavailable full-stack checks as NOT RUN with their concrete backend dependency. No backend test pass or fixture result establishes real AI readiness.
