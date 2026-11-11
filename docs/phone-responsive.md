# Phone Responsive Adaptation Receipt (`fix/phone-responsive`)

## Scope & Guardrails

- **Scope**: Frontend-only (`frontend/src/**`, `frontend/tests/inspection-journey.spec.ts`, and `docs/phone-responsive.md`).
- **Untouched**: No changes to `backend/`, `ai-service/`, database schemas, auth/session/CSRF/concurrency contracts, dependencies (`package.json` / `package-lock.json`), or product workflows.
- **Visual & Interaction Preservation**: Preserved warm stone/amber K3 industrial palette, Indonesian terminology, provenance/simulation banners, native form controls, pinch-zoom capability, and the 240px desktop sidebar layout (`> 900px`).

## Audited Routes & States

All core officer workflows were inspected before and after editing using the real Go API + SQLite + simulated AI stack with touch emulation (`hasTouch: true`) and long populated identifiers/narratives across `320x568`, `320x844`, `375x812`, `390x844`, `430x932`, `844x390` (landscape), and `1280x800` (desktop regression):

1. `/login` — Officer login card, form inputs (`Username`, `Password`), and primary submit button.
2. `/` — Dashboard summary filters, metric cards, category summary grid, and system readiness `spec-grid`.
3. `/projects` — Project filter bar, creation form, project cards with long project names/locations/tokens, inline edit form, and delete confirmation.
4. `/projects/[id]` — Project detail header, inline project edit form, zone creation form, zone cards with long zone names, and inline zone edit form.
5. `/monitoring` — Project/zone/camera selectors, active live browser video preview, `SnapshotOverlay` canvas + detection pill list, and captured finding cards with evidence thumbnails.
6. `/findings` — Findings filter bar, `ManualFindingForm` toggle and inputs, and findings gallery cards with `FindingEvidenceViewer`.
7. `/findings/[id]` — Finding detail page, `FindingEvidenceViewer`, full-image modal dialog (`role="dialog"` in both `320x568` portrait and `844x390` landscape), immutable metadata with SHA-256 hash, human verification/correction form, and follow-up status form.
8. `/reports` — Reports filter bar, draft creation form (Template, Manual with title/content inputs, and Gemini mode with `request_key` info box), and report cards.
9. `/reports/[id]` — Draft narrative editor (`formTitle`, `formContent`), Gemini regenerate confirmation dialog (`request_key`), officer review acknowledgement & approval actions, and locked approved state (`<pre>` narrative, SHA-256 `source_hash`, and immutable snapshot finding cards).

## Root Causes Identified in Baseline (`before`)

1. **Horizontal Overflow at 320px (`457px` scrollWidth / `137px` overflow on `/projects`)**:
   - Multi-column CSS grids with fixed minimum column tracks (`minmax(340px, 1fr)`, `minmax(320px, 1fr)`, `minmax(300px, 1fr)`, `minmax(240px, 1fr)`) exceeded narrow phone viewports (`320px`–`375px`) when combined with container padding.
   - Flex rows and grid children lacked `min-width: 0` or `overflow-wrap: anywhere` for long uninterrupted project/zone tokens, SHA-256 hashes, and idempotency `request_key` values.
2. **Touch Target & Pointer Interception Failures on Phone**:
   - Action buttons, filter resets, pagination/card links, and header controls rendered at `28px`–`38px` height (`< 44px` minimum touch target).
   - On `/projects/[id]` at `320px`, the inline zone edit cancel button overflowed its card container and was intercepted by adjacent zone cards during touch taps.
   - Top navigation pills wrapped unevenly on narrow screens without uniform touch sizing.
3. **Form Input Auto-Zoom Risk on Mobile Safari (`< 16px` font-size)**:
   - `input`, `select`, and `textarea` elements across login, filters, project/zone forms, finding review forms, and report editors used `0.85rem`–`0.95rem` (`13.6px`–`15.2px`), which creates a mobile input-zoom risk; actual iOS focus behavior was not tested.
4. **Full-Image Evidence Modal Clipping in Phone Portrait & Landscape**:
   - `FindingDetailPage.svelte` full-image modal had fixed padding and lacked viewport-bounded scroll handling and compact header stacking for `320x568` and `844x390` landscape viewports.

## Summary of Responsive Fixes (`after`)

- **Viewport & Global Craft Floor** ([app.html](../frontend/src/app.html), [+layout.svelte](../frontend/src/routes/+layout.svelte)):
  - Added `viewport-fit=cover` to the viewport meta tag while keeping user zoom enabled.
  - Enforced `font-size: 1rem` (`16px`) and `min-height: 2.75rem` (`44px`) on interactive form controls (`input`, `select`, `textarea`, `button`) at `<= 768px` or on coarse-pointer touch devices (including phone landscape), plus `max-width: 100%` on media elements, without using global `overflow-x: hidden`.
- **AppShell Navigation & Safe Areas** ([AppShell.svelte](../frontend/src/lib/components/AppShell.svelte)):
  - Added `env(safe-area-inset-*)` padding support for notched phones.
  - Adapted `.primary-nav` at `<= 640px` into a clean 2-column touch grid (`min-height: 2.75rem` per link, with the 5th item spanning full width) while keeping the `240px` left sidebar at `> 900px`.
- **Single-Column Collapse & Fluid Wrapping Across Pages**:
  - Updated grid tracks in [(app)/+page.svelte](../frontend/src/routes/%28app%29/+page.svelte), [projects/+page.svelte](../frontend/src/routes/%28app%29/projects/+page.svelte), [projects/[id]/+page.svelte](../frontend/src/routes/%28app%29/projects/%5Bid%5D/+page.svelte), [MonitoringView.svelte](../frontend/src/lib/monitoring/MonitoringView.svelte), [SnapshotOverlay.svelte](../frontend/src/lib/monitoring/SnapshotOverlay.svelte), [FindingsGalleryPage.svelte](../frontend/src/lib/findings/FindingsGalleryPage.svelte), [ManualFindingForm.svelte](../frontend/src/lib/findings/ManualFindingForm.svelte), [FindingEvidenceViewer.svelte](../frontend/src/lib/findings/FindingEvidenceViewer.svelte), [FindingDetailPage.svelte](../frontend/src/lib/findings/FindingDetailPage.svelte), [ReportsListPage.svelte](../frontend/src/lib/reports/ReportsListPage.svelte), and [ReportDetailPage.svelte](../frontend/src/lib/reports/ReportDetailPage.svelte) to use `minmax(min(100%, ...), 1fr)` and collapse cleanly to `minmax(0, 1fr)` on phone widths.
  - Added `min-width: 0` and `overflow-wrap: anywhere` on long titles, SHA-256 hashes, `request_key` codes, and report `<pre>` narratives.
  - Stacked form/card action buttons full-width or in balanced 2-column touch rows with `min-height: 2.75rem` (`44px`) on phone viewports.
  - Bounded the full-image evidence modal on `/findings/[id]` (`max-height: calc(100dvh - 1rem)`, scrollable dialog container, compact landscape header at `max-height: 500px`) so both `320x568` portrait and `844x390` landscape remain fully operable.

## Verification Summary

- **Automated Multi-Viewport Audit** ([inspection-journey.spec.ts](../frontend/tests/inspection-journey.spec.ts)):
  - Audited 48 route/viewport combinations across `/login`, `/`, `/projects`, `/projects/[id]`, `/monitoring`, `/findings`, `/findings/1`, `/findings/1#modal`, `/reports`, `/reports#gemini`, `/reports/draft`, and `/reports/1` at `320`, `375`, `390`, `430`, `844x390` landscape, and `1280x800` desktop.
  - Result: `overflowPx = 0`, `outOfBoundsControls = 0`, `smallTouchTargets = 0`, `smallFormFonts = 0` across all 48 checks.
- **Impeccable Detector**:
  - `impeccable.cmd detect --json <15 edited files>` returned `[]` (zero anti-pattern findings).
- **Typecheck, Build & Full Playwright Suite**:
  - `npm run check`: `0 errors and 0 warnings`.
  - `npm run build`: succeeded cleanly with zero unused CSS warnings.
  - `npx playwright test --workers=1`: `8 passed` across the 6 existing spec files on the delegate branch before synchronization with the newer backend changes on main.

## Current-main Integration and Limits

- Current upstream backend requires `REPORT_PROMPT_VERSION=k3-report-v2`; only the frontend disposable test environments were aligned. Backend and AI source remain unchanged from `origin/main`.
- Phone validation additionally checks that the evidence dialog preserves the image's original aspect ratio in portrait and landscape.
- Login controls wait for client initialization and session checking; the form also uses POST so an early submission cannot place credentials in the URL.
- Verification uses Chromium mobile viewport/touch emulation. Physical Android/iPhone devices, mobile Safari/WebKit, and real on-screen keyboard behavior have **not** been tested. Real PPE inference and live Gemini are separate from this layout change.
- Final integrated verification against upstream main `77069ce`: `npm run check` passed with 0 errors/warnings; `npm run build` passed; full one-worker Playwright suite passed **8 tests across 6 spec files** in 1.0m. The 48-state audit reports no horizontal overflow, out-of-bounds controls, undersized audited touch targets, or form fonts below 16px.
- The two inspection journey tests are explicitly serial: the phone stage continues from the persisted inspection created in the first stage. Run the whole file/suite, rather than selecting the phone stage alone.
- Additional reproduced/fixed defects: early taps could submit the login form before hydration; the enlarged evidence image could distort under flex/max-height constraints. The phone journey now waits on usable login controls and asserts original photo proportions in both dialog orientations. The modal image and normalized overlays share their sized frame; scrolling is contained in the dialog.
- A manual detector pass over the coordinator's three updated UI targets returned `[]` (exit 0).
