# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A seeded K3 officer inspecting a selected project and zone on a local construction-site demonstration laptop. A technical operator configures services, model artifacts, and the development account outside the product UI.

## Product Purpose

Unify webcam inspection, original photographic evidence, officer verification, follow-up notes, and approved inspection reports. The user confirmed the repository's P0 scope and one local laptop with browser webcam.

## Operating Context

Indonesian-language operational application. One active camera session globally. A live video preview is separate from the exact latest inferred JPEG. Tracking is temporary and never identifies a worker. Human review determines whether a captured indication is confirmed or rejected.

## Capabilities and Constraints

- Preserve SvelteKit 3/Svelte 5/TypeScript, Go/SQLite/evidence storage, and FastAPI. The SRS and its API contract are the domain authority.
- Login, project/zone CRUD, monitoring, evidence review, follow-up, draft editing and approval, dashboard summary, and basic failure recovery are P0.
- Automatically supported categories are NO_HELMET and NO_VEST only when the model manifest/runtime supports them.
- Webcam has no audio, samples target 1 FPS, and sends an aspect-preserving JPEG. Go owns temporal confirmation, dedupe, evidence, and business rules.
- Real, simulated, manual, Gemini, and template/manual-report provenance must stay truthful. Unknown/absent observations never imply safety or a positive violation.
- Approved reports use immutable historical source snapshots; stale drafts cannot be approved.
- Secrets and original evidence are protected; no backend/internal credentials in frontend bundles.
- Cloud hosting, CCTV, multi-camera, worker identification, report export, and model training UI are outside this release.

## Evidence on Hand

Repository SRS/API contracts and existing Go services/tests. A supplied Colab notebook has saved training/export outputs for both target categories, but the actual exported model bundle has not yet been recovered or validated on the laptop. Real Gemini credentials/quota have not been established. No runtime acceptance is claimed.

## Product Principles

- Evidence and provenance are visible and traceable.
- The officer makes the verification and approval decisions.
- A failure is explicit and recoverable; it cannot appear as safe status or empty success.
- Retain data and draft edits while respecting versions, staleness, and locks.
- Complete a usable local workflow without additional infrastructure.

## Accessibility & Inclusion

Readable desktop operation and stacked narrow-screen layouts, labeled forms, keyboard access, visible focus, and text accompanying status colors. No specific visual brand or palette has been pinned by the user.
