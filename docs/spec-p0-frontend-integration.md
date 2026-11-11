# Complete the P0 inspection frontend and integrate the local workflow end to end

Implementation has not started. This specification describes the agreed scope and acceptance behavior; it does not claim that runtime tests have passed.

## Problem Statement

A K3 officer needs one usable application for a local construction-site inspection: choose a project and zone, inspect browser-camera images for helmet and vest indications, preserve the triggering evidence, verify findings, record follow-up, and approve an inspection report.

The inspected repository has Go business endpoints and persistence, but its frontend is only a health-status starter page and its Python service exposes only health. An officer cannot complete the inspection workflow through the application. A successful training run alone does not close the missing camera, inference, review, and reporting integrations.

The first release must run on one local laptop with a browser webcam. Its behavior must distinguish real detections, deterministic simulation, manual evidence, and report templates, so a demonstration does not misrepresent which integrations have been validated.

## Solution

Build an Indonesian-language inspection application on the existing stack. Connect login, project/zone management, live monitoring, evidence and finding review, follow-up, reports, and filtered dashboard totals to the existing Go API. Complete the Python model/session/inference boundary so browser JPEG samples can create evidence-backed pending findings through the actual services.

An officer should be able to complete this journey without editing data outside the application: login, prepare a project and zone, start monitoring, inspect and review captured evidence, record follow-up, stop the session, create and edit a report, acknowledge review, approve the report, and revisit the persisted results after a restart.

Deliver and validate the application workflow, real PPE inference, and real Gemini generation as separate gates. Explicit simulation/manual/template fallbacks keep the application usable when an external dependency is unavailable; they do not pass the real integration gates.

## User Stories

1. As a K3 officer, I want to sign in with my seeded account, so that inspection data and evidence are available only to an authenticated user.
2. As a K3 officer, I want an existing session to be recognized when I reopen the application, so that I can continue without an unnecessary login.
3. As a K3 officer, I want clear feedback for incorrect credentials, expired sessions, and unavailable services, so that I know how to recover.
4. As a K3 officer, I want logout to end camera activity and invalidate my session, so that an unattended browser does not continue inspecting or exposing data.
5. As a K3 officer, I want consistent Indonesian navigation among dashboard, projects/zones, monitoring, findings, and reports, so that I can follow an inspection from preparation to approval.
6. As a K3 officer, I want to create, search, view, and edit projects, so that observations are tied to the correct construction work.
7. As a K3 officer, I want to create, view, and edit zones within a project, so that evidence records the selected inspection location.
8. As a K3 officer, I want unused master records to be deletable and referenced records to explain archival instead, so that cleanup preserves inspection history.
9. As a K3 officer, I want archival to be blocked when related monitoring is active, so that a live session retains valid project and zone metadata.
10. As a K3 officer, I want conflicting edits to preserve my input and offer a reload, so that another tab cannot cause my work to disappear silently.
11. As a K3 officer, I want model readiness, operating mode, supported PPE categories, and report-service availability to be visible, so that I understand what this installation can actually do.
12. As a K3 officer, I want unsupported PPE categories to be unavailable for automatic detection, so that the interface does not imply model coverage that is absent.
13. As a K3 officer, I want to choose an active project and one of its active zones before monitoring, so that captured findings have consistent location metadata.
14. As a K3 officer, I want the browser to request camera access after my action and capture no audio, so that inspection uses only the intended video input.
15. As a K3 officer, I want camera denial, disconnection, or unavailability to have a useful recovery state, so that a failed start does not leave an unexplained active session.
16. As a K3 officer, I want one global active camera session to be enforced, so that another tab cannot start a competing inspection.
17. As a K3 officer, I want a smooth live preview and a separately identified latest inference snapshot, so that delayed inference is not presented as a current live overlay.
18. As a K3 officer, I want bounding boxes to align with the original inferred image, so that I can judge the evidence accurately.
19. As a K3 officer, I want mode, supported categories, sampling activity, and result age to be shown during monitoring, so that stale or degraded results are apparent.
20. As a K3 officer, I want a newly confirmed temporal indication to capture the original triggering photograph automatically, so that the stored evidence corresponds to the event.
21. As a K3 officer, I want repeated indications on the same track and category to avoid duplicate findings within its episode, so that the review queue stays useful.
22. As a K3 officer, I want unknown, obscured, or ambiguous observations to remain inconclusive, so that missing visual evidence is not treated as a violation or a safe result.
23. As a K3 officer, I want stopping monitoring to release the camera and reject later frames, so that the inspection has a clear end.
24. As a K3 officer, I want hidden tabs, route changes, logout, and terminal pipeline failures to stop camera activity, so that the application does not imply unsupported background monitoring.
25. As a K3 officer, I want an AI restart or lost tracker state to interrupt the session clearly, so that events are not confirmed across incompatible tracker histories.
26. As a K3 officer, I want new captures to link directly to their finding, so that I can move from monitoring to verification.
27. As a K3 officer, I want a paginated finding gallery with project, zone, session, time, category, verification, and action filters, so that I can locate relevant evidence.
28. As a K3 officer, I want to enlarge the full-frame evidence and toggle its overlay, so that I can inspect the original image as well as the model annotations.
29. As a K3 officer, I want the original model indication, confidence score, temporary track reference, mode, and capture time to remain visible, so that my decision retains its context.
30. As a K3 officer, I want to confirm or reject a pending finding with notes and an appropriate final category, so that a human makes the verification decision.
31. As a K3 officer, I want to correct an earlier decision with a note before report approval, so that a mistaken review can be repaired without changing the immutable model result.
32. As a K3 officer, I want to record follow-up on confirmed findings and require notes for completion, so that actions have a usable record.
33. As a K3 officer, I want permitted finding deletion to remove it from default lists while respecting report locks, so that cleanup does not invalidate approved reports.
34. As a K3 officer, I want missing evidence or storage failure to be explicit, so that an unrelated photograph is never substituted for a missing original.
35. As a K3 officer, I want server-enabled manual fallback to accept a photograph and notes in a clearly manual session, so that I can record an observation when automatic inference is unavailable.
36. As a K3 officer, I want simulation and manual provenance to remain visible on records and reports, so that demonstrations and actual inspections are distinguishable.
37. As a K3 officer, I want to select a closed session with confirmed findings when creating a report, so that the report has a stable eligible source.
38. As a K3 officer, I want a Gemini draft to use only officer-confirmed findings and sanitized text metadata, so that unreviewed findings and photographs are not sent for narrative generation.
39. As a K3 officer, I want an explicitly labeled template or manual draft when Gemini is unavailable, so that reporting can continue with honest provenance.
40. As a K3 officer, I want to edit and save a draft's title and plain-text narrative, so that I can correct it before approval.
41. As a K3 officer, I want to inspect the report's historical source snapshot and linked findings, so that I can verify what the narrative describes.
42. As a K3 officer, I want stale source data to block approval and require regeneration, so that an approved report does not silently omit source changes.
43. As a K3 officer, I want regeneration to confirm replacement of the current draft, so that a fresh source does not unexpectedly overwrite my editing work.
44. As a K3 officer, I want generation retries and lost responses to recover the existing result, so that one session does not accumulate duplicate active reports.
45. As a K3 officer, I want to acknowledge that I reviewed the report before approval, so that automated text is not approved without a human action.
46. As a K3 officer, I want approved reports and their source findings to be locked, so that the approved record remains consistent.
47. As a K3 officer, I want permitted draft deletion and report filtering by project, session, and status, so that I can manage work in progress and revisit approved records.
48. As a K3 officer, I want dashboard totals to reflect persisted sessions, verification statuses, and open confirmed actions, so that the summary matches the underlying records.
49. As a K3 officer, I want real, simulated, and manual dashboard results to be filtered separately, so that simulated activity is not presented as actual inspection activity.
50. As a K3 officer, I want local date filters and explicit display timezone behavior, so that time-based lists and counts have predictable boundaries.
51. As a K3 officer, I want empty, loading, offline, validation, conflict, stale, and locked states to explain the next action, so that a failed request is not mistaken for no data.
52. As a K3 officer, I want readable narrow-screen layouts, keyboard-operable controls, visible focus, and labeled forms, so that the workflow remains usable across the supported browser sizes.
53. As a local technical operator, I want repeatable setup, migrations, seeding, and startup instructions, so that the application can be started on the demonstration laptop.
54. As a local technical operator, I want checkpoint hashes, class mapping, calibrated thresholds, and compatible CPU dependencies checked before real mode, so that the runtime uses the model that was exported.
55. As a local technical operator, I want data and evidence to survive service restarts, so that a restart does not erase the inspection or resurrect an abandoned active session.
56. As the project owner, I want test results to distinguish the application pipeline, real PPE, and real Gemini, so that completion claims are supported by the work actually performed.
57. As the project owner, I want Antigravity 1, 2, and 3 to use Argon High with bounded ownership and controlled concurrency, so that implementation follows the requested model choice while limiting local RAM use.

## Implementation Decisions

- Retain SvelteKit 3, Svelte 5 runes, TypeScript, Go, SQLite, and FastAPI. The repository SRS and matching public/internal API contract remain authoritative. Preserve domain vocabulary: session, temporary track/episode, temporal event, pending finding, officer verification, action status, report snapshot, stale draft, and approved report.
- Keep business authority in Go. Svelte owns navigation, forms, camera permission/preview/sampling, and presentation. Python owns model loading, tracking, and PPE association; it does not persist findings, access SQLite, or call Gemini. Go alone persists evidence and report state and calls Gemini.
- Use the existing same-origin public API boundary. The browser sends session cookies and CSRF on mutations; the HTTP-only session cookie is not exposed to frontend code. Bootstrap the officer and in-memory CSRF state through the existing current-user operation. Secrets and internal tokens remain outside browser bundles and committed data.
- Preserve response envelopes, snake-case DTOs, pagination, UTC timestamps, positive IDs, version checks, UUID operation keys, binary JPEG frames, and multipart manual evidence. Handle no-content success without attempting JSON parsing. Do not generically retry create/edit/approve operations.
- Build a small shared typed API/session layer and UI primitives. Agent 1 owns shell, login, dashboard, project/zone UI and final consistency. Agent 2 owns API/session contracts, findings/reports, and necessary Go contract fixes. Agent 3 owns monitoring/capture, Python integration, AI contract tests, and end-to-end evidence. Shared configuration and lockfile changes are serialized by the coordinator.
- Start implementation from the upstream default branch while preserving the existing local branch and unrelated work. Keep changes limited to P0. Reuse existing services, migration/schema, evidence storage, and test boundaries; propose a schema change only if an actual P0 contract gap requires it.
- The frontend supports the complete authenticated workflow, including lookup data, filters, pagination, provenance, version conflicts, absent evidence, and report lock states. It must use persisted API data rather than fabricated dashboard values or hardcoded production findings. Interface copy is Indonesian, with readable desktop layout and stacked narrow-screen panels.
- Camera use is explicit and client-side, with no audio. Generate aspect-preserving JPEGs no larger than 640 by 480 at quality 0.7. Target one sample per second, permit only one frame request in flight, skip busy ticks, and never queue old frames to catch up. Send sequence, UTC capture time, and monotonic elapsed time.
- Go retains the locked temporal rule: at least two positive observations among the last three valid frames inside two seconds, with the current frame positive. Track episodes expire after five seconds without an observed Person. Record one finding per track episode/category and mark it recorded only after the original evidence and metadata are saved.
- Model boxes use normalized minimum/maximum coordinates on the original sampled JPEG. Overlay them on the exact returned inference snapshot, separate from live preview. Preview mirroring cannot alter evidence coordinates. Track IDs are temporary references, not identities; confidence is a model score, not proof.
- Complete Python's existing internal model-info, session-start, inference, and session-stop contracts using internal-token authentication. Load and verify model/manifest once; track Person boxes and associate PPE on the same image. Preserve unknown for ambiguity, occlusion, unsupported labels, or insufficient evidence. An absent helmet/vest detection alone is not a positive violation.
- Keep one Python worker and one inference lock. Validate image input and output shapes, preserve engine-instance checks, and implement bounded sequence/hash replay caching. Idempotent session start must not reset an already active tracker. Python restarts and unresolved inference failures interrupt monitoring rather than mixing temporal state.
- Stop sampling and release media tracks on explicit stop, logout, route leave, hidden tab, camera failure, or terminal frame error. Send an authenticated best-effort stop; page exit cannot guarantee delivery, so the existing server idle interruption remains the backstop. Do not claim background browser sampling.
- The server selects real, simulated, or manual mode. Real-mode failure cannot silently become simulation. Capability checks control the UI. Simulated fixtures and manual records preserve their provenance, and dashboard totals separate modes. Manual evidence requires the server-enabled fallback and an eligible closed manual session.
- Retain existing review/version rules, final-category corrections, action-note requirements, allowed soft deletion, and approved-report source locks. Distinguish temporal confirmation, which creates a pending finding, from human confirmation, which establishes report eligibility.
- Reports use a server-built canonical snapshot of confirmed nondeleted findings from a closed session. Retain source-hash freshness, generation-time source rechecks, operation-key deduplication, explicit regeneration, review acknowledgement, and immutable approved reports. Saving narrative text cannot make stale source data fresh. Render report and note content as text, not injected HTML.
- Real Gemini remains a backend integration. Only the permitted sanitized text snapshot goes to Gemini. Real failure must preserve prior drafts and offer explicitly manual/template creation. Configured credentials do not establish live quota or a passing integration.
- Use the exported model's verified class map and supported categories. Saved notebook output recommends Person threshold 0.30, violation threshold 0.25, and prediction floor 0.10; confirm these against the recovered manifest before configuring the runtime. Keep calibrated thresholds fixed during a session and preserve the temporal constants.
- Use an isolated compatible CPU inference environment. Verify Python and CPU-wheel availability before locking dependencies; do not install the Colab CUDA stack or replace the user's global interpreter. Keep model weights, secrets, evidence, and development databases outside Git.
- Preserve the user's routing: Antigravity 1, 2, and 3 use Gemini 4 Argon with high thinking. No nested agents or silent provider substitution. Offload suitable code/AI work to the linked Mac only after its requested provider becomes runnable; keep physical webcam acceptance on the target local laptop.
- Limit RAM through bounded test/build concurrency, one worker per suite, and no duplicate frontend development stacks; stop only task-owned idle processes. The user subsequently requested Antigravity 1–3 all be assigned and explicitly preserved the running Antigravity 1 task. Independent UI, actual-Python integration, and tracker-publication work can therefore proceed concurrently. Separate checkouts come from the delegation tool rather than shell-created agent worktrees; remote offload still requires a runnable requested provider.

## Testing Decisions

- Primary confirmed seam: the officer's browser journey through the real Svelte frontend, Go HTTP boundary, SQLite/evidence storage, and a real FastAPI process. Assert observable records, state transitions, protected evidence, report content eligibility, and recovery behavior rather than component internals, helper calls, or CSS implementation. The user explicitly confirmed this seam, reuse of existing Go HTTP tests, labeled deterministic AI fixtures, and separate real-webcam/live-Gemini acceptance.
- Use controlled JPEGs or a fake camera for repeatable browser automation, with deterministic inference only at the existing AI boundary and permanent simulated provenance. Do not mock Go CRUD, persistence, review, report locks, or the API/session integration in the principal acceptance journey. Follow it with a separate physical webcam test.
- Reuse the existing Go HTTP-handler integration tests for monitoring and reports. They already use temporary SQLite/evidence storage and replaceable AI/Gemini clients. Extend them for genuine changed business behavior; keep the existing pure temporal tests for receipt-time/window/deduplication edge cases instead of reproducing those internals in every browser test.
- Test the actual Python HTTP contract for authentication, readiness, idempotent start/stop, valid JPEGs, image limits, sequence/hash replay conflicts, out-of-order frames, no detections, mode consistency, malformed output, and tracker restart. Use the existing Go AI-client boundary as the consumer; add no generic testing abstraction without a demonstrated need.
- The main happy path must persist project/zone changes, produce and link an event's original evidence, confirm one finding and reject another, save follow-up, close the session, create/edit/approve a report, update filtered counts, and retain data after restart. Run the actual Go/Python processes; a Go fake-client test alone does not pass this gate.
- Prove original evidence bytes by comparing the stored SHA-256 with the triggering JPEG. Cover independent tracks/categories, same-frame multiple findings, duplicate requests, suppression within an episode, five-second track expiry, unknown handling, and the two-of-three/two-second boundary.
- Cover camera permission failure, disconnection, tab hide, route change, logout, second active session, AI timeout/offline/restart, storage failure/missing evidence, stale versions, source changes during generation, stale approval, locked reports/sources, Gemini failure/invalid output, and recovery of a lost generation response.
- Verify unauthenticated evidence rejection, CSRF and Origin checks, safe text rendering, and absence of secrets in frontend assets/logs. Check keyboard use, labels, focus, narrow layouts, state messages, and provenance without creating tests that merely mirror styling.
- Run the frontend type/check and build gates, relevant Go config/temporal/monitoring/report tests and changed-behavior checks, and Python contract tests. Broaden build/vet/regression coverage when changes or failures justify it.
- Real PPE acceptance requires the recovered checkpoint/manifest/hash, supported-category checks, independent webcam and tracking tests on the demo laptop, a 60-frame end-to-end latency measurement, and the SRS scripted event scenarios. A training/validation score, Colab latency, or fixture pass is insufficient.
- Real Gemini acceptance requires a live call through Go and a validated confirmed-only draft. If no usable key/quota exists, prove manual/template reporting separately and mark real Gemini NOT RUN or failed with its concrete reason.
- Record PASS, FAIL, and NOT RUN separately for application/pipeline, real PPE, and real Gemini. Include device/runtime/mode, relevant request IDs, evidence integrity, observed latency, screenshots without secrets, and open failures. No runtime tests have been executed for this specification.

## Out of Scope

- Cloud hosting, multi-tenant or production-readiness claims, multi-camera/CCTV/RTSP ingestion, worker or face identification, attendance, and emergency alarms.
- Registration, account administration, additional application roles, multi-level approval, notifications, action-ticket systems, and a full append-only review audit module.
- P1 trend/zone charts, report PDF/Excel/document export, stored video/audio, pre-event video buffering, and webcam background sampling guarantees.
- Model training/retraining UI, automatic retraining from reviewer feedback, new datasets/training runs by default, unrelated ML experiments, ONNX/TensorRT optimization before the baseline, and guaranteed field accuracy.
- New databases, brokers, WebSockets, extra business services, and unrelated backend/schema/architecture refactoring.
- Treating simulation as real detection, treating template/manual output as a successful Gemini call, or claiming that the tool certifies safety or replaces K3 inspection procedures.

## Further Notes

- Source understanding is grounded in upstream commit `cbfcf803c78061d0de79b9368197c6447614d1d1` and its SRS/API contract. Recheck current upstream and relevant existing behavior before implementation. The local project currently contains its original scaffold and planning documents; application source has not been imported.
- The user confirmed one local laptop with browser webcam and authorized using the linked `malwildan-MacBookAir` to reduce local RAM. At the last capability check, Antigravity on that Mac was disabled and its Codex accounts were unauthenticated; remote execution is an unresolved prerequisite, not completed work.
- Saved outputs in the supplied [Colab notebook](https://colab.research.google.com/drive/1T2rY0UInBvbi-deY5Eev9z6_YMtEIedt?usp=sharing) show an exported `bundle_ppe-demo-v1_20261111-043416.zip` containing `best.pt`, `model_manifest.json`, tracker configuration, dependency pins, and evaluation/handoff material. The recorded logical class IDs are Person 5, no_helmet 6, no_vest 11, helmet 0, and vest 2; both requested violation categories passed the notebook's validation gate.
- The notebook's Drive credential propagation failed; backup output is `Drive: None`. Its automatic browser-download invocation is recorded, but the actual ZIP is not yet recovered. No matching bundle was found in the default local Downloads folder. Recover the existing export from a download, surviving runtime, or backup before considering retraining.
- The exported manifest is explicitly not live-validated. Saved outputs show no independent webcam test and a skipped tracking clip test. Its Colab training versions/benchmarks are evidence about that recorded run, not proof of compatibility or performance on the demonstration laptop.
- Docker and the migration CLI were not found in the local PATH during planning. A compatible CPU Python environment, migration/startup method, actual model artifact, and any real Gemini credentials/quota must be verified at setup. These prerequisites must be reported without marking the corresponding real acceptance gates complete.
- Implementation assignments are planned, not completed reviews. The initial Antigravity 1 planning delegate was cancelled before returning findings. This specification adds no application code and does not imply that any delegate or runtime acceptance has passed.
