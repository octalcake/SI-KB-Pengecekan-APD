# P0-05: Draft, review, and approve an inspection report

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: GitHub publication pending.
Blocked by: P0-04.
Assigned lane: Antigravity 2, Gemini 4 Argon, high. Frontend only; consume report APIs unchanged and report backend gaps.
Status: blocked.

## What it delivers

An officer creates a confirmed-only report for a closed session, edits its narrative, inspects its source snapshot, regenerates stale source, and explicitly approves an immutable report.

## Acceptance criteria

- [ ] Session eligibility, report list/filter/detail, manual/template creation, and backend Gemini generation are accessible.
- [ ] Operation keys and lost-response recovery avoid duplicate active reports.
- [ ] Source snapshot, links, generator provenance, staleness, version conflict, and generation failures are visible.
- [ ] Narrative editing cannot refresh stale source; regeneration protects unsaved edits and requires explicit confirmation.
- [ ] Approval requires review acknowledgement; stale source and approved report/source mutations are rejected.
- [ ] Existing drafts survive Gemini failure; only sanitized confirmed-only text goes to real Gemini.
- [ ] Browser + real Go/SQLite prove template/manual report edit/approval and stale/lock behavior.
- [ ] Real Gemini smoke result is separately PASS/FAIL/NOT RUN with its prerequisite; never infer a pass from templates.

