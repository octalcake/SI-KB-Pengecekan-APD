# P0-03: Integrate the browser monitoring frontend with existing APIs

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: GitHub publication pending.
Blocked by: P0-01 for final shared-auth integration and browser acceptance. Frontend monitoring components and contract-driven capture logic can be prepared independently. P0-00 is cancelled/out of scope.
Assigned lane: Antigravity 3, Gemini 4 Argon, high.
Status: blocked.

## What it delivers

An officer selects an existing project/zone, sees the server's readiness/mode, starts and stops browser monitoring through existing Go endpoints, sends serialized JPEGs, displays exact returned inference snapshots and finding links, and receives useful errors when the backend is unavailable. This ticket changes frontend code only.

## Acceptance criteria

- [ ] Consume existing system-status/session/frame/stop APIs; no Go/Python, schema, model/runtime, or backend test files are changed.
- [ ] Server mode/capabilities determine UI readiness; simulation/manual provenance is visible; unavailable real mode never silently becomes simulation.
- [ ] Camera is user initiated, video only, aspect-preserving at most 640×480, target 1 FPS with one request in flight and no backlog.
- [ ] Headers/times/sequences and snapshot-only normalized overlays follow the contract.
- [ ] Stop/logout/route leave/hidden tab/device loss/errors release media and best-effort close the session; idle timeout remains a backstop.
- [ ] Display server-returned events/evidence links without inventing findings or implementing server temporal/dedupe rules in the browser.
- [ ] Existing API unknown, timeout, restart, second-session, size/format/rate/sequence, and authentication errors have correct frontend recovery behavior.
- [ ] Frontend check/build and relevant browser capture/readiness/lifecycle tests pass; unavailable actual inference is explicitly NOT RUN with its backend dependency, not implemented as part of this task.

## Hard scope boundary

Read backend contracts as needed but edit frontend/ only. Existing backend processes may run unchanged against disposable test data. Do not implement missing AI endpoints, load models, change server mode/configuration to simulate success, or install Python inference dependencies. Reuse the shared frontend API/session exports from P0-01 when integrating the completed route.

