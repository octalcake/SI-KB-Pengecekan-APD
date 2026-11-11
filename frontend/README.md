# Frontend Inspeksi K3 Konstruksi (SvelteKit 3 + Svelte 5 + TypeScript)

Antarmuka web operasional berbahasa Indonesia untuk petugas K3 pada Sistem Informasi Inspeksi K3 Konstruksi (P0 lokal). Aplikasi ini menghubungkan autentikasi sesi cookie/CSRF, manajemen master proyek dan zona, monitoring kamera browser (target 1 FPS JPEG tanpa audio), verifikasi bukti temuan serta tindak lanjut, penyusunan dan persetujuan laporan inspeksi, serta ringkasan dashboard terpisah menurut mode (`real`, `simulated`, `manual`).

Dokumen acuan:
- Spesifikasi kebutuhan sistem (SRS): [`../docs/requirements.md`](../docs/requirements.md)
- Kontrak API publik & internal: [`../docs/api-contract.md`](../docs/api-contract.md)
- Batas lingkup frontend-only: [`../docs/frontend-only-scope.md`](../docs/frontend-only-scope.md)
- Laporan penerimaan & bukti verifikasi P0-07: [`../docs/frontend-acceptance.md`](../docs/frontend-acceptance.md)

---

## 1. Prasyarat Runtime Lokal

- **Node.js**: v22+ (diuji pada Node.js `v24.18.1` dengan modul bawaan `node:sqlite` untuk harness pengujian disposable) dan **npm** (`11.x`).
- **Backend Go (`../backend`)**: harus sudah disiapkan dan dijalankan sesuai petunjuk yang ada di [`../README.md`](../README.md) dan [`../backend/.env.example`](../backend/.env.example).
  - Jangan menghapus direktori penyimpanan lokal `backend/storage/` (`k3.sqlite` maupun `evidence/`) saat memulai ulang layanan agar histori sesi, bukti foto asli, temuan, dan laporan yang sudah disetujui tetap terjaga.

---

## 2. Instalasi Dependensi Frontend

Jalankan instalasi deterministik dari lockfile di direktori `frontend/`:

```sh
cd frontend
npm ci
```

---

## 3. Konfigurasi Proxy & Variabel Lingkungan (`API_PROXY_TARGET`)

Frontend menggunakan **same-origin API boundary** melalui dev server Vite ([`vite.config.ts`](./vite.config.ts)):
- Seluruh permintaan browser ke `/api/v1/*` (termasuk cookie sesi `HttpOnly`, header `X-CSRF-Token`, unggahan frame `image/jpeg`, dan pengambilan foto bukti `/api/v1/findings/{id}/evidence`) diteruskan oleh proxy Vite ke server Go.
- Secara default, proxy mengarah ke `http://127.0.0.1:8080` dengan `changeOrigin: false` sehingga header `Host: localhost:5173` diteruskan apa adanya dan lolos daftar izin `ALLOWED_HOSTS` / `ALLOWED_ORIGINS` di Go.
- Untuk mengarahkan ke port backend Go lain tanpa mengubah kode sumber, atur variabel lingkungan `API_PROXY_TARGET`:

| Variabel Lingkungan | Default | Keterangan |
|---|---|---|
| `API_PROXY_TARGET` | `http://127.0.0.1:8080` | Target backend Go untuk proxy `/api` pada `vite dev` / `vite preview`. |

> **Penting**: Selalu buka aplikasi di browser melalui **`http://localhost:5173`** (bukan `http://127.0.0.1:5173`) agar cookie sesi `SameSite=Lax` dan pengecekan `Origin`/`Host` pada backend Go konsisten. Tidak ada kunci rahasia backend (`AI_INTERNAL_TOKEN`, `GEMINI_API_KEY`, atau kredensial DB) yang disimpan atau dibundel di sisi frontend.

---

## 4. Menjalankan Aplikasi Bersama Backend yang Ada

### A. Pastikan Backend Go Berjalan (Tanpa Menghapus Storage)

Mengacu pada petunjuk di [`../README.md`](../README.md):
- **Melalui Docker Compose** (dari root repositori):
  ```sh
  docker compose up -d
  ```
  *(Gunakan `docker compose down` tanpa `-v` saat menghentikan container agar volume `storage` tetap tersimpan.)*
- **Atau secara Native** (dari direktori `../backend`, menggunakan `backend/.env` yang merujuk pada `./storage/k3.sqlite` dan `./storage/evidence`):
  ```sh
  cd ../backend
  go run ./cmd/api
  ```
  *(Jika database lokal baru pertama kali diinisialisasi, jalankan migrasi `dbmate` dan `./cmd/seed` satu kali sesuai [`../README.md`](../README.md).)*

### B. Jalankan Dev Server Frontend

Dari direktori `frontend/`:

```sh
cd frontend
npm run dev -- --host localhost --port 5173 --strictPort
```

Buka **`http://localhost:5173`** di browser dan masuk menggunakan akun petugas yang telah di-seed (default `petugas`).

---

## 5. Pemeriksaan Tipe, Build Produksi, dan Pengujian Integrasi Browser

### Pemeriksaan Tipe & Build

```sh
cd frontend
npm run check
npm run build
```

### Pengujian End-to-End Playwright (Satu Worker Serial, Stack Disposable Terisolasi)

Suite Playwright di [`tests/`](./tests/) menjalankan binary Go `cmd/seed` dan `cmd/api` tanpa perubahan terhadap database SQLite sementara (`os.tmpdir()`) dan direktori bukti sementara, sehingga **tidak menyentuh atau mengubah** `backend/storage/` milik pengguna.

Jalankan seluruh suite secara serial (`--workers=1`) dengan batas konkurensi Go dan port uji bebas konflik:

```powershell
# PowerShell (Windows)
cd frontend
$env:TEST_WEB_PORT='62173'
$env:TEST_API_PORT='62080'
$env:GOMAXPROCS='2'
$env:GOFLAGS='-p=2'
npx playwright test --workers=1
```

```sh
# Bash / POSIX
cd frontend
TEST_WEB_PORT=62173 TEST_API_PORT=62080 GOMAXPROCS=2 GOFLAGS=-p=2 npx playwright test --workers=1
```

Cakupan spesifikasi pengujian di `frontend/tests/`:
- [`tests/auth-shell.spec.ts`](./tests/auth-shell.spec.ts): bootstrap sesi `/api/v1/auth/me`, login/logout CSRF, pemulihan error kredensial vs jaringan, status kesiapan sistem, dan navigasi responsif.
- [`tests/projects-dashboard.spec.ts`](./tests/projects-dashboard.spec.ts): CRUD proyek & zona, proteksi hapus vs arsip (`409 PROJECT_IN_USE`, `409 ZONE_IN_USE`, `409 SESSION_ACTIVE`), pemulihan `409 VERSION_CONFLICT` tanpa kehilangan input, dan ringkasan dashboard terpisah menurut mode.
- [`tests/monitoring.spec.ts`](./tests/monitoring.spec.ts): pemilihan proyek/zona aktif, permintaan kamera tanpa audio (`audio: false`), penolakan jujur `503 AI_UNAVAILABLE` tanpa beralih diam-diam ke simulasi, pemulihan `409 CAMERA_BUSY` dan `503 TRACKER_RESET`, overlay kotak pembatas pada snapshot terpisah, dan penghentian saat tab disembunyikan.
- [`tests/findings-and-follow-up.spec.ts`](./tests/findings-and-follow-up.spec.ts): filter galeri temuan, pratinjau bukti & toggle overlay, konfirmasi/penolakan/koreksi kategori ber-versi, tindak lanjut, penanganan `410 EVIDENCE_MISSING` dan `409 REPORT_LOCKED`, serta unggahan temuan manual multipart.
- [`tests/reports-and-approval.spec.ts`](./tests/reports-and-approval.spec.ts): kelayakan sesi tertutup, kegagalan jujur `503 GEMINI_UNAVAILABLE` & retensi `request_key`, pembuatan laporan `TEMPLATE` & `MANUAL`, deteksi `is_stale`, pengakuan tinjauan manusia (`review_acknowledged`), dan penguncian permanen setelah persetujuan.
- [`tests/inspection-journey.spec.ts`](./tests/inspection-journey.spec.ts): perjalanan utama terintegrasi penuh dari login → pembuatan proyek/zona di UI → monitoring webcam ke Go asli + fixture HTTP AI eksternal (`/internal/v1/*`) → konfirmasi temporal 2-dari-3 di Go → pencocokan SHA-256 foto bukti asli terhadap JPEG pemicu → verifikasi/koreksi & tindak lanjut → penyusunan/persetujuan laporan `TEMPLATE` & kunci sumber → pemisahan total dashboard `simulated` vs `real` → ketahanan data & bukti melintasi restart proses Go dan muat ulang halaman.
