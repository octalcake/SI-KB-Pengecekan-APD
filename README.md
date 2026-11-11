# Sistem Informasi Inspeksi K3 Konstruksi

MVP lokal: webcam browser → indikasi helm/rompi (YOLO + ByteTrack) → konfirmasi temporal → foto bukti → verifikasi petugas → draft laporan (Gemini).
Spesifikasi lengkap: [`docs/requirements.md`](docs/requirements.md); kontrak API: [`docs/api-contract.md`](docs/api-contract.md).

| Service | Stack | Port (host) |
|---|---|---|
| `frontend` | SvelteKit 3 + TypeScript (Vite dev server) | `localhost:5173` |
| `backend` | Go, SQLite (`modernc.org/sqlite`) | `localhost:8080` |
| `ai-service` | Python FastAPI | internal saja (`ai-service:8000`) |
| `migrate` | dbmate, menjalankan `backend/migrations` | sekali jalan |

## Jalankan dengan Docker (disarankan)

Prasyarat: Docker Desktop.

```sh
cp .env.example .env              # opsional; tanpa .env pakai default dev
docker compose up -d --build
docker compose run --rm -e SEED_PASSWORD='password-kuat-min-12' backend ./seed
```

Buka http://localhost:5173 (selalu `localhost`, jangan `127.0.0.1`, agar cookie konsisten). Halaman awal menampilkan status backend.

Login seed: username `petugas` (lihat `SEED_USERNAME` di `backend/.env.example`), password sesuai yang dipakai saat seed.

Perintah lain:

```sh
docker compose logs -f backend          # log satu service
docker compose run --rm migrate         # terapkan migrasi baru
docker compose down                     # stop (data tetap di volume "storage")
docker compose down -v                  # stop + HAPUS database dan evidence
```

Model YOLO: taruh `best.pt` dan `model_manifest.json` di `ai-service/models/` (di-mount read-only ke container). Tanpa weights, mode `real` berstatus not-ready; CRUD tetap jalan.

Gemini: isi `GEMINI_ENABLED=true` dan `GEMINI_API_KEY` di `.env` root, lalu `docker compose up -d backend`.

## Jalankan native (tanpa Docker)

```sh
# AI service
cd ai-service
python -m venv .venv && .venv/Scripts/activate   # Linux/mac: source .venv/bin/activate
pip install -r requirements.lock
cp .env.example .env                              # isi AI_INTERNAL_TOKEN
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1

# Backend
cd backend
cp .env.example .env                              # isi AI_INTERNAL_TOKEN (sama dengan Python); GEMINI_ENABLED=false jika belum ada key
dbmate --url sqlite:./storage/k3.sqlite --no-dump-schema up
SEED_PASSWORD='password-kuat-min-12' go run ./cmd/seed
go run ./cmd/api

# Frontend
cd frontend
npm ci
npm run dev -- --host localhost
```

dbmate: https://github.com/amacneil/dbmate#installation (atau pakai `docker compose run --rm migrate`).
