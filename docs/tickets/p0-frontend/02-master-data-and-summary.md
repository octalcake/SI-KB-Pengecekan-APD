# P0-02: Prepare projects and zones and inspect filtered totals

Parent spec: [P0 frontend integration](../../spec-p0-frontend-integration.md).
Tracker: GitHub publication pending.
Blocked by: P0-01.
Assigned lane: Antigravity 1, Gemini 4 Argon, high.
Status: blocked.

## What it delivers

A signed-in officer can create/search/edit projects and zones, archive referenced records, and see mode-separated dashboard totals through real persisted APIs.

## Acceptance criteria

- [ ] CRUD, pagination, active/archive filters, and project-zone relationship are usable.
- [ ] Referenced deletion explains archival; active-session archival conflicts remain visible.
- [ ] Version conflicts retain unsaved input and offer a reload.
- [ ] Dashboard uses actual summary data with project/zone/date/mode filters and configured timezone.
- [ ] Real/simulated/manual counts remain separate; count unit is finding, not worker.
- [ ] Empty, loading, failed, validation, and success states are distinct.
- [ ] Browser tests verify persisted CRUD after reload and filtered totals; relevant backend checks and frontend gates pass.

