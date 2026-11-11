# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source of truth

`docs/requirements.md` (Indonesian SRS; `docs/api-contract.md` is a copy of §9–10, keep both in sync) defines everything: API contracts (§9, §10), DB schema (§11), env contract (§14), folder layout (§15), and the implementation order (§16.1). Read the relevant section before implementing a module. Backend is through step 6 of §16.1: auth, middleware, project/zone CRUD, monitoring sessions, the frame pipeline (temporal 2-of-3, dedupe, evidence, automatic pending findings), and `GET /findings/{id}/evidence`. Not implemented yet: finding list/review/delete/manual (step 7), reports and Gemini (step 8), dashboard (step 9), the frontend UI, and the Python `/internal/v1/*` endpoints. Until Python has those, starting a session returns 503 `AI_UNAVAILABLE`.

## Commands

Docker (full stack):
- `docker compose up -d --build`: start everything (migrate runs first, then backend).
- `docker compose run --rm -e SEED_PASSWORD='...' backend ./seed`: create the officer account. Use `./seed`, not `/app/seed`: Git Bash rewrites absolute paths.
- `docker compose run --rm migrate`: apply new migrations.
- `docker compose down -v`: deletes the SQLite DB and evidence (named volume `storage`).

Backend (`backend/`):
- `go build ./...`, `go vet ./...`, `go test ./...`
- Single test: `go test ./internal/service -run TestSRSTimeline` (the §6.4 timeline), `go test ./internal/handler -run TestMonitoringFlow` (end-to-end over HTTP with SQLite in a temp dir and a fake AI client)
- `go run ./cmd/api`, `go run ./cmd/seed` (needs `backend/.env`, copy from `.env.example`)

Frontend (`frontend/`): `npm run dev`, `npm run check` (svelte-check, the type gate), `npm run build`.

AI service (`ai-service/`): `uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1`. Lockfile is `requirements.lock`, generated with `pip freeze` inside `python:3.12-slim` from `requirements.in`. Regenerate it the same way after editing `requirements.in`.

## Architecture

Browser (Svelte) → Go API → FastAPI. Go is the only component that touches SQLite, evidence files, and Gemini. FastAPI holds YOLO + ByteTrack state in memory and has no DB access. It must run with exactly one worker, because tracker state is per-process. The browser never calls FastAPI. Go calls it with the `X-Internal-Token` header, and both sides must share the same `AI_INTERNAL_TOKEN`.

Frontend calls only relative `/api/v1/...`. The Vite dev proxy forwards `/api` to Go (`API_PROXY_TARGET`, default `http://127.0.0.1:8080`; Docker sets `http://backend:8080`), so cookies and evidence stay same-origin. Do not put business handlers in SvelteKit. SvelteKit 3 has no `$env/dynamic/public`, which is why the API base is hardcoded.

Go layering (SRS §4.2): handler (parse/auth/HTTP) → service (business rules, temporal 2-of-3 window, dedupe) → repository (`internal/repository/sqlite`, all SQL). Routing uses the stdlib `http.ServeMux` with method patterns (`internal/handler/api.go` lists every route).

- `internal/httpx` holds the §9.1 JSON envelope. Return a `*domain.AppError` from any layer to get that status and code; any other error becomes a logged 500.
- Middleware (`internal/middleware`): `Base` (request ID, recovery, logging) → `Origin` (Host allowlist on every request, Origin allowlist on mutating requests) → `Authenticator.Require` per route (session cookie, plus `X-CSRF-Token` on mutating requests).
- `sqlite.Store.Tx` runs `BEGIN IMMEDIATE` (`_txlock=immediate` in the DSN). Run multi-step rules inside it.
- `service.Monitoring` keeps the single active session in memory (`runtime`), with a per-session mutex that serialises frames, stop and the 1s `Tick` (idle timeout, track expiry). On startup `Reconcile` interrupts sessions that were left active. `service.Temporal` is the pure 2-of-3 engine. Call `MarkRecorded` only after the evidence file and the DB row are both saved. Only add interfaces at boundaries that tests need to swap: the AI client, Gemini client, clock, and storage.

## Config and env

- `backend/internal/config` loads the full §14.1 env contract and fails startup on errors. It rejects `isi-...` placeholder secrets and any change to the temporal baseline (2 hits / 3 frames / 2000ms, track timeout 5000ms). The baseline is locked by the SRS.
- Docker reads `backend/.env.example` and `ai-service/.env.example` as base values. Compose `environment:` overrides addresses and paths, and supplies secrets from the root `.env` (`AI_INTERNAL_TOKEN`, `SEED_PASSWORD`, `GEMINI_*`). `backend/.env` and `ai-service/.env` are used only for native runs.
- In Docker, `GEMINI_ENABLED` defaults to false, so the stack runs without a key.

## Database

- Migrations live in `backend/migrations/` and use dbmate format (`-- migrate:up` / `-- migrate:down`). dbmate replaces the SRS's `cmd/migrate`. Add a new numbered file (`002_...sql`); never edit `001_init.sql` after it has been applied.
- Do not put PRAGMAs in migrations. dbmate runs migrations in a transaction, where `foreign_keys` and `journal_mode` are no-ops. The pragmas (`foreign_keys`, WAL, `busy_timeout`) are set per connection in the DSN in `internal/repository/sqlite/db.go`, with `SetMaxOpenConns(1)`.
- Timestamps are UTC RFC3339 strings written by Go. Optimistic locking uses the `version` column with `WHERE id=? AND version=?`, and a mismatch returns 409 `VERSION_CONFLICT`.
