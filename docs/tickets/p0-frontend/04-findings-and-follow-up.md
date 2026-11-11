# P0-04: Review evidence and record follow-up

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: GitHub publication pending.
Blocked by: P0-03.
Assigned lane: Antigravity 2, Gemini 4 Argon, high; account verification is currently required before dispatch.
Status: blocked.

## What it delivers

An officer locates a captured finding, inspects its protected original evidence, confirms/rejects/corrects it, records follow-up, and uses explicitly enabled manual capture when configured.

## Acceptance criteria

- [ ] Paginated gallery/list filters cover project/zone/session/time/category/verification/action as specified.
- [ ] Full evidence, zoom/toggle overlay, original immutable result, final category, mode, capture time, and temporary track semantics are visible.
- [ ] Review/correction uses versions; required notes and confirmed-only follow-up are enforced.
- [ ] Completed actions require notes, and allowed soft deletion respects approved-source locks.
- [ ] Manual multipart evidence uses an eligible closed manual session and never impersonates real inference.
- [ ] Missing evidence, forbidden access, validation, conflict, and locked states are specific.
- [ ] Browser journey confirms one finding, rejects another, saves follow-up, and preserves changes on reload; relevant Go checks pass.

