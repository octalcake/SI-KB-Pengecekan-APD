# P0 frontend and end-to-end integration plan

Status: planning deliverable; implementation has not started.

Prepared 2026-11-11 against upstream `main` at `cbfcf803c78061d0de79b9368197c6447614d1d1`.
Repository: https://github.com/octalcake/SI-KB-Pengecekan-APD

## Outcome and boundaries

Deliver the repository's P0 workflow on one local laptop with a browser webcam, as confirmed by the user:

Login → create project/zone → start webcam inspection → send JPEG samples through Go to Python → persist an event's original evidence → human review and follow-up → stop inspection → generate/edit a report → approve and lock → inspect dashboard totals.

Keep SvelteKit 3, Svelte 5 runes, TypeScript, Go, SQLite, and FastAPI. `docs/requirements.md` is the product authority; its API sections and `docs/api-contract.md` must agree. Use Indonesian interface copy. This is a local MVP, with one seeded officer account and one active camera session globally.

P1 charts, export/PDF, cloud hosting, new roles, CCTV, multi-camera support, model training UI, and unrelated backend refactoring are outside this release. Real PPE inference and real Gemini are separate acceptance gates; a passing simulated or template workflow does not satisfy them.

## Verified starting point

- The current `sibk` workspace has a placeholder README/assets and a local `master` commit, with no remote. Upstream was inspected in a separate temporary clone; application source has not been imported or modified.
- Upstream frontend is a starter layout and a health-status page. There is no login, application navigation, business UI, API client, or camera implementation yet.
- Go has the P0 routes, services, SQLite/evidence persistence, temporal engine, auth/CSRF, manual findings, reports, and dashboard summary. Existing handler tests use fake AI/Gemini boundaries. Their presence is not a current test pass.
- Python currently exposes only `/internal/health`. The four required model/session/inference endpoints and YOLO/ByteTrack runtime are missing. Its dependency list contains the web scaffold, not the inference stack.
- The existing Vite dev proxy preserves the browser's Host and forwards `/api` to Go. Business API calls and evidence must remain same-origin; the browser must never call Python directly.
- Local tools found: Node 24.18.1, npm 11.16.0, Go 1.27.0, Python 3.14.6. Docker and dbmate were not found in PATH. This does not establish whether Docker Desktop is installed elsewhere.

## Colab model evidence and artifact handoff

Notebook inspected read-only, including its saved cell outputs:
https://colab.research.google.com/drive/1T2rY0UInBvbi-deY5Eev9z6_YMtEIedt?usp=sharing

- Saved training/export outputs show a YOLO26n run using Ultralytics `8.4.210` and torch `2.14.1+cu130`. These are recorded training versions, not proof that matching laptop CPU wheels are installed or compatible.
- Logical class IDs in the saved output: helmet 0, vest 2, person 5, no_helmet 6, no_vest 11. Both `NO_HELMET` and `NO_VEST` passed the notebook's validation gate.
- The notebook recommends `person=0.30`, `violation=0.25`, and `predict_floor=0.10`. Read and verify the exported manifest before using these calibrated values; do not silently retain different runtime defaults or change the temporal baseline.
- Export output lists `models/best.pt`, `models/model_manifest.json`, `config/bytetrack-k3.yaml`, `requirements-pins.txt`, reports, and `HANDOFF.md` inside `bundle_ppe-demo-v1_20261111-043416.zip`.
- Recorded runtime path: `/content/k3-training/bundle_ppe-demo-v1_20261111-043416.zip`. The training checkpoint was `/content/k3-training/runs/ppe_20261111-043416/weights/best.pt`.
- Drive mounting failed with `credential propagation was unsuccessful`; training backup and ZIP export both print `Drive: None`. The notebook's automatic download call ran, but saved notebook output cannot prove that the browser finished downloading the ZIP or that the Colab runtime still retains it.
- No matching `bundle_ppe-demo-v1*.zip` was found in `C:/Users/akmal/Downloads`. Other download locations were not searched broadly.
- The notebook has no independent webcam test, skipped its tracking clip test, and exports `validated_for_live=false`. Colab latency is not laptop end-to-end latency.

First real-model gate: obtain the exported ZIP from its saved download or surviving Colab runtime/backup, inspect the archive, verify the manifest and checkpoint hash, and place the model files in ignored `ai-service/models/`. Do not retrain by default. If the artifact cannot be recovered, report that prerequisite explicitly while completing labeled simulation/manual integration.

## Agent assignments and RAM policy

All three implementation lanes must use `gemini-4-argon` with `target.options = { "thinking_level": "high" }`. Keep Sol as the planning/integration coordinator. No nested agents.

| Lane | Requested provider | Owned implementation | Handoff |
|---|---|---|---|
| Antigravity 1 | `antigravity` — Antigravity 1 | Application shell/navigation, design tokens and shared UI components, login/dashboard/project-zone routes, responsive layout and UX states | Working shell consuming the API/session contract; final UI consistency pass |
| Antigravity 2 | `antigravity_2` — Antigravity 2 | Typed API and auth/session modules; findings and report feature modules/routes; scoped Go contract fixes and their regression checks | Stable API/session exports; real CRUD/review/report flows; no mock production data |
| Antigravity 3 | `antigravity_antigravity_3` — Antigravity 3 locally | Monitoring route/component and capture controller; Python AI/session runtime; AI contract checks; end-to-end test files and runtime evidence | JPEG-to-finding pipeline, real-model readiness, repeatable acceptance harness |

Confirmed remote machine: `malwildan-MacBookAir`, environment `7b230202-de30-4560-8fb1-97c1bfba4b10`, linked with full access. Its capability response reports Antigravity disabled and Codex unauthenticated; no remote agent is currently runnable. Do not silently substitute a different provider/model.

Preferred resource placement, once the requested remote provider is enabled: move Antigravity 3's code/AI contract work to the Mac and keep only one active local lane. Discover the remote provider ID/model/options before dispatch; do not assume the Windows instance IDs exist there. Build separate checkouts using the delegation tool's worktree isolation. Transfer changes by reviewed commits/patches. Keep weights, credentials, databases, and evidence outside Git. Mac tests supplement, rather than replace, the final Windows webcam/runtime check; Python/torch locks must target the actual deployment platform.

Until that prerequisite is met, run the requested local agents sequentially: 2 establishes API/session contracts, 1 builds the core UI, then 3 completes monitoring/AI and end-to-end proof. Stop idle dev/test processes between lanes; use one browser/test worker and one FastAPI worker. Do not run training, three dev stacks, or simultaneous dependency installs. This trades elapsed time for lower peak RAM.

An initial Antigravity 1 planning review was cancelled before returning findings. It has not been restarted; this plan does not claim three completed delegate reviews or any remote execution.

## Ownership and integration contracts

- Coordinator owns Git setup/import, root documentation, lockfile/package-script changes, global configuration, task sequencing, and final integration. Start a feature branch from fetched upstream `main`, preserving the existing local `master`; carry this plan onto that branch. Recheck upstream HEAD before starting implementation. Do not reset or overwrite unrelated work.
- Agent 1 owns `frontend/src/routes/+layout.svelte`, login and protected shell/layout, shared UI/style files, and dashboard/project route files. Proposed routes: `/login`, `/dashboard`, `/projects`, `/projects/[id]`; redirect `/` to the appropriate login/dashboard destination.
- Agent 2 owns `frontend/src/lib/api.ts`, `types.ts`, `session.svelte.ts`, findings/report feature files, and `/findings`, `/findings/[id]`, `/reports`, `/reports/[id]` under the protected route group. Manual entry can be a form within findings, not an extra subsystem.
- Agent 3 owns `frontend/src/lib/monitoring/**`, monitoring-specific components and `/monitoring`, `ai-service/app/**`, AI tests, and `frontend/e2e/**`. Keep camera DOM access client-side and inside user-initiated flows.
- Agent 2 proposes any Go changes with a failing contract case. Agent 3 reports backend integration issues to that owner instead of editing the same Go files concurrently. Coordinator serializes package/lockfile, Docker, environment-example, and API-doc updates.
- Before UI work, Agent 2 publishes typed resource/envelope/error shapes and a small shared request interface covering JSON, binary JPEG, and multipart. Share the authenticated user, in-memory CSRF token, auth bootstrap status, and expired-session behavior. Use `#lib` imports already configured in this repo; do not assume an older SvelteKit alias/API.

## Implementation sequence and gates

### 1. Establish the baseline and contracts

Adopt upstream source on the feature branch, resolve the model artifact location, and choose a viable local Python environment. The existing Docker image uses Python 3.12; verify CPU inference dependency support before choosing a native interpreter. Prefer a compatible isolated environment; do not replace the user's global Python or install CUDA packages on the laptop.

Apply the existing migration to a dedicated development SQLite database, seed a development account, and verify health, login, `/auth/me`, and `/system/status`. Keep existing storage intact. Use the repository's dbmate path or a compatible isolated migration runner; never remove volumes to obtain a clean start.

Freeze resource DTOs, status enums, error codes, bbox/time semantics, and session exports. Keep secrets in ignored environment files. Use the secret-input tool if a real user credential/key is needed; do not ask for it in chat or bake it into fixtures.

Gate: real Go/SQLite requests work through relative `/api/v1`; cookie and CSRF behavior are demonstrated; runtime prerequisites and model availability are recorded.

### 2. Build the usable application shell and master data

Create the protected app shell with Indonesian navigation and officer/logout controls. Bootstrap auth via `/auth/me`, show a loading state while checking it, and send unauthenticated users to login. Backend remains the authorization boundary; frontend route guards are navigation UX.

Build dashboard counts and project/zone list/detail/forms with real filters, pagination, version-aware edits, and delete/archive behavior. Populate all selectors from persisted data. Distinguish a failed request from an empty list. Keep the information density readable at the 1280px demo viewport and stack panels on narrow screens. Use labels, keyboard focus, accessible dialogs, and text beside status colors. Visual direction is not locked by this technical plan.

Gate: login and persisted project/zone CRUD survive reload; referenced master deletion explains archive; `409 VERSION_CONFLICT` offers reload without silently dropping an unsaved edit.

### 3. Complete monitoring and the Python boundary

Implement `/internal/v1/model-info`, `/sessions/start`, `/infer`, and `/sessions/stop` under the existing internal-token contract. Load weights once, validate the manifest/class map/hash and supported categories, and pin compatible CPU inference dependencies. Use ByteTrack on Person boxes; associate PPE on the same frame. Ambiguous or absent evidence is `unknown`, never automatic proof of a violation. Keep one worker and one inference lock, engine-instance detection, idempotent same-key start, session cleanup, and a bounded 30-sequence cache keyed by metadata/hash. Python never writes findings or opens SQLite.

Browser controller: explicit camera permission, video without audio, aspect-preserving JPEG at most 640×480/quality 0.7, target one sample/second, one request in flight, skip busy ticks, and no old-frame queue. Send sequence, UTC capture time, and monotonic elapsed milliseconds with the exact JPEG. Keep Go authoritative for 2 hits in the last 3 valid frames within 2 seconds, track expiry at 5 seconds, and event/evidence dedupe.

Render a smooth live preview separately from the last inference snapshot. Draw normalized `[x_min,y_min,x_max,y_max]` boxes only over the exact JPEG that produced that response. Show mode, readiness, supported categories, effective sampling and result age, recent finding links, and truthful degraded/offline states.

On stop, logout, route leave, tab hide, permission loss, or terminal frame error, stop sampling and release camera tracks; best-effort POST stop includes CSRF. `pagehide` cleanup is best effort and the server's 15-second idle interruption is the backstop. Treat 429 with its bounded delay, never generic retries of mutating operations. Keep the backend's same-sequence retry/deadline semantics intact. A tracker restart interrupts the session and requires a new start.

Modes come from the server; there is no client-side switch to pretend that real mode succeeded. Real mode without weights remains not-ready. Simulated sessions/fixtures retain a permanent simulation label; manual mode uses a closed `manual_entry` session and server-enabled multipart evidence. Never silently change mode on failure.

Gate: browser JPEG → real Go → actual FastAPI process → persisted pending finding works, and its evidence SHA-256 matches the triggering JPEG. Demonstrate dedupe, unknown handling, stop/cleanup, and restart behavior. Label a deterministic Python fixture run as simulation. Real-model acceptance remains separate.

### 4. Complete finding review and reports

Findings: filtered gallery/list, protected full-frame evidence, optional overlay/zoom, original immutable model result, verification form, corrected final category/notes, follow-up status/notes, and allowed soft deletion. Make the distinction between temporal capture and officer confirmation visible. Only confirmed findings can progress actions, and completion needs notes. Missing evidence gets a specific state, not a replacement photo. Manual entries retain manual provenance.

Reports: choose a closed session, require at least one confirmed finding, generate via Go/Gemini or explicitly create a manual/template draft, edit title/plain-text content, inspect the source snapshot, regenerate with confirmation, and approve only after review acknowledgement. Reuse an operation's UUID request key for recovery, not for a different input. Handle `REPORT_EXISTS` by opening the existing report rather than creating a duplicate.

Preserve draft edits on external failure. Surface `SOURCE_CHANGED`, `STALE_REPORT`, `VERSION_CONFLICT`, and locked status distinctly. Saving narrative text cannot refresh stale source data. Approved reports are read-only and source findings remain locked. Show provenance on session/finding/report surfaces. Dashboard mode filters keep real, simulated, and manual totals separate; counts represent findings, not unique workers. Convert date boundaries to explicit UTC intervals while displaying the configured `Asia/Jakarta` timezone.

Gate: confirm one finding, reject another, record follow-up, stop, draft/edit/approve using real Go/SQLite. Only confirmed items enter the snapshot. Source changes block approval; an approved report and its source cannot be mutated through the UI or API.

### 5. Prove the local end-to-end result and document it

Use the real frontend, Go API, FastAPI process, development SQLite database, and evidence filesystem. Keep deterministic AI fixtures only at the inference boundary for repeatability. Add a small Playwright suite for the essential business journey and meaningful failure states, not styling tests for every button. Use controlled JPEG input/fake camera for automation, then perform a separate physical webcam pass on the target laptop.

Run `npm run check` and `npm run build`; relevant existing Go config/temporal/monitoring/report checks and regression tests for changed behavior; Python contract tests for tokens, start/stop, replay/hash mismatch, image validation, no detections, not-ready, and restart. Broaden Go checks/build/vet if backend integration changes justify it. No existing test pass is assumed.

Record results as PASS/FAIL/NOT RUN with the device, versions, mode, example request IDs, evidence hash, screenshots without secrets, and remaining limitations. Update README/startup instructions and environment examples, preserving same-origin `localhost` behavior. A Vite dev-proxy check does not prove a packaged production reverse proxy; add that only if the delivery target changes.

## Acceptance checklist

| Gate | Required proof |
|---|---|
| P0 application | Fresh dev DB/seed → login → project/zone CRUD → camera/session → evidence → review/follow-up → closed session → draft/edit/approve → filtered dashboard; persisted after process restart |
| Temporal/evidence | `+,+` and `+,unknown,+` trigger once; out-of-window hits do not; duplicate requests do not advance tracking; per-track/type dedupe; 5-second expiry; original triggering JPEG hash matches evidence |
| Concurrency/data | Second active session rejected; stale versions preserved for conflict recovery; source changes during generation rejected; approved report/source lock enforced |
| Lifecycle/failures | Camera denied/unplugged, hidden tab/navigation/logout, Python offline/restart/deadline, storage failure/missing evidence, Gemini timeout/invalid output; none shown as success or safe status |
| Auth/data protection | Unauthenticated evidence denied, missing/wrong CSRF rejected, cross-origin rejected, raw JPEG/multipart accepted correctly, HTML notes rendered as text, no secrets in browser bundle/logs |
| Real PPE integration | Recovered checkpoint/manifest verified, supported labels shown, independent webcam/tracking tests on the demo laptop, 60-frame end-to-end latency measurement and SRS event scenarios; otherwise mark not passed |
| Real Gemini integration | A real configured call through Go produces a validated confirmed-only draft; otherwise manual/template works and real Gemini is marked NOT RUN/failed with the reason |
| UX | Desktop and narrow-screen visual review, keyboard/form/error checks, accurate provenance and counts, clear empty/loading/offline/conflict/stale/locked states |

## Open prerequisites and decision log

- Confirmed: repository P0, local laptop/webcam, existing stack, requested Antigravity 1/2/3 with Argon High; remote offload authorized and machine linked.
- Model archive retrieval is pending. The notebook's saved export log is available; the actual ZIP/checkpoint/hash has not been retrieved or loaded.
- Enable/authenticate the requested Antigravity provider on the Mac before remote delegation can start. Until then, sequential local lanes preserve the user's model choice and limit concurrency.
- Actual Python CPU-wheel compatibility and migration runner availability need verification at setup time; no install/build/run was performed in this planning pass.
- A Gemini key/live quota has not been verified. Manual/template reports allow application validation independently.
- Final visual direction remains open for implementation. Product facts and flows come from the SRS; no placeholder metrics or fabricated detections belong in the shipped UI.

This plan records inspected source and saved notebook outputs. It is not a runtime validation report or a claim that delegates, real inference, Gemini, or the end-to-end application have passed.
