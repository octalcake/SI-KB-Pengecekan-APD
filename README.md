# Sistem Informasi Inspeksi K3 Konstruksi

MVP lokal: webcam browser → indikasi helm/rompi (YOLO + ByteTrack) → konfirmasi temporal → foto bukti → verifikasi petugas → draft laporan (Gemini).
Spesifikasi lengkap: [`docs/requirements.md`](docs/requirements.md); kontrak API: [`docs/api-contract.md`](docs/api-contract.md).

Petunjuk frontend: [`frontend/README.md`](frontend/README.md). Hasil pengujian alur inspeksi dan batas validasi PPE/Gemini: [`docs/frontend-acceptance.md`](docs/frontend-acceptance.md); review dan perbaikannya: [`docs/frontend-review.md`](docs/frontend-review.md).

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

Model YOLO: `best.pt` dan `model_manifest.json` ada di `ai-service/models/` (di-mount read-only ke container; hash dicek terhadap manifest). Tanpa weights atau hash beda, mode `real` berstatus not-ready; CRUD tetap jalan.

Gemini: isi `GEMINI_ENABLED=true` dan `GEMINI_API_KEY` di `.env` root, lalu `docker compose up -d backend`.

Mode simulasi (fallback bila model belum siap): set `AI_MODE=simulated` di `.env` root lalu `docker compose up -d backend ai-service`. ai-service memakai fixture deterministik (gambar diabaikan, bukan inferensi): satu Person, NO_HELMET `+, unknown, +, +, -, -` berulang. Semua sesi, temuan, dan laporan tercatat permanen sebagai `simulated`; dashboard default hanya menghitung `real`. Kembalikan ke `AI_MODE=real` untuk demo model nyata.

## Jalankan native (tanpa Docker)

```sh
# AI service
cd ai-service
python -m venv .venv && .venv/Scripts/activate   # Linux/mac: source .venv/bin/activate
pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.in   # lock khusus Linux/Docker
cp .env.example .env                              # isi AI_INTERNAL_TOKEN
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
# test: pip install -r requirements-dev.txt && python -m pytest tests

# Backend
cd backend
cp .env.example .env                              # isi AI_INTERNAL_TOKEN (sama dengan Python); GEMINI_ENABLED=false jika belum ada key
dbmate --url sqlite:./storage/k3.sqlite --no-dump-schema up
SEED_PASSWORD='password-kuat-min-12' go run ./cmd/seed
go run ./cmd/api

# Frontend
cd frontend
bun install --frozen-lockfile
bun run dev --host localhost
```

## Continuous integration

GitHub Actions menjalankan [CI](.github/workflows/ci.yml) pada setiap pull request dan push ke `main`; workflow juga dapat dijalankan manual. Tiga job berjalan paralel:

- **Frontend**: Bun `1.4.4` (versi di `frontend/package.json`), instalasi dari `bun.lock` dengan `--frozen-lockfile`, ESLint, pemeriksaan tipe Svelte, build, audit dependensi tingkat high/critical, dan seluruh suite Playwright Chromium. Node.js 24 tetap digunakan oleh harness `node:sqlite`; Go mengikuti `backend/go.mod`. Laporan HTML, trace kegagalan, dan bukti pengujian disimpan sebagai artifact selama 7 hari.
- **Backend**: `go vet`, seluruh pengujian unit/HTTP dengan race detector, dan `go build`.
- **AI service**: Python 3.12, dependensi API yang dibatasi `requirements.lock`, pemeriksaan dependensi, kompilasi modul, dan `pytest tests`. Pengujian memakai fake detector/simulasi; akurasi model YOLO dan API Gemini nyata tidak diuji.

Pengujian memakai SQLite dan direktori bukti sementara, tanpa kredensial produksi atau GitHub Secrets. Tidak ada deployment otomatis. Agar kegagalan CI memblokir merge, administrator repositori perlu mewajibkan status **Frontend**, **Backend**, dan **AI service** pada branch protection/ruleset `main` setelah workflow pertama berjalan.

dbmate: https://github.com/amacneil/dbmate#installation (atau pakai `docker compose run --rm migrate`).
