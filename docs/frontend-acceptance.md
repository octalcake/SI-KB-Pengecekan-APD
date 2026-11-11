# Laporan Penerimaan & Serah Terima Integrasi Frontend P0 (P0-07)

Dokumen ini mencatat bukti verifikasi runtime, status penerimaan per gerbang (*gate*), integritas bukti SHA-256, ID permintaan (`X-Request-Id`), inspeksi visual responsif (`1280×800` dan `390×844`), serta batas ketergantungan eksternal untuk pengiriman frontend P0 Sistem Informasi Inspeksi K3 Konstruksi.

- **Batas Lingkup Otoritatif**: [`docs/frontend-only-scope.md`](./frontend-only-scope.md) — pengiriman ini mencakup kode dan pengujian **frontend saja** terhadap kontrak API Go yang sudah ada tanpa mengubah `backend/`, `ai-service/`, skema SQLite, konfigurasi server, ataupun artefak model.
- **Spesifikasi Induk**: [`docs/spec-p0-frontend-integration.md`](./spec-p0-frontend-integration.md)
- **Tiket Pelacak**: [`docs/tickets/p0-frontend/07-acceptance-and-handoff.md`](./tickets/p0-frontend/07-acceptance-and-handoff.md) (GitHub Issue [#12](https://github.com/octalcake/SI-KB-Pengecekan-APD/issues/12), PR [#13](https://github.com/octalcake/SI-KB-Pengecekan-APD/pull/13))
- **Baseline Sumber yang Diuji**: `11fdf4f91e59f5772c65ede3161407d193c00b2f` (`integration/p0-frontend`, mencakup integrasi P0-01 s.d. P0-05 serta sinkronisasi upstream `a9ddb6d`).

---

## 1. Status Penerimaan per Gerbang (*Gate Summary*)

| Gerbang Penerimaan (*Gate*) | Status | Batas Sistem & Bukti Aktual |
|---|---|---|
| **1. Aplikasi & Pipeline Lokal Terintegrasi** (`SvelteKit UI` ↔ `Go cmd/api` ↔ `SQLite` + `Evidence Storage` ↔ `Fixture HTTP AI /internal/v1/*`) | **PASS (Baseline `11fdf4f`, Menunggu Merge Perbaikan Review Spesifikasi)** | `7 passed (1.1m)` pada eksekusi serial satu worker (`npx playwright test --workers=1`) mencakup 6 file spesifikasi: `auth-shell.spec.ts`, `projects-dashboard.spec.ts`, `monitoring.spec.ts`, `findings-and-follow-up.spec.ts`, `reports-and-approval.spec.ts`, dan perjalanan terintegrasi baru `inspection-journey.spec.ts`. *Catatan*: PR #13 tetap berstatus **draft** hingga koordinator menggabungkan 4 perbaikan temuan review spesifikasi dari lajur paralel Argon 3 dan memvalidasi ulang komit gabungan. |
| **2. Inferensi PPE Kamera Nyata** (`AI_MODE=real`, Python FastAPI YOLO/ByteTrack + Webcam Fisik) | **NOT RUN** | **Ketergantungan sistem eksternal di luar lingkup frontend-only** ([`docs/frontend-only-scope.md`](./frontend-only-scope.md)). Memerlukan validasi bundel model pada perangkat lokal serta lingkungan runtime CPU Python yang kompatibel. Frontend terbukti menampilkan status jujur `ai_ready=false` / `503 AI_UNAVAILABLE` tanpa beralih diam-diam ke mode simulasi, dan melepaskan kamera segera saat ditolak server. Tidak ada klaim atau angka benchmark latensi 60-frame webcam fisik yang dibuat. |
| **3. Generasi Narasi Laporan Gemini Nyata** (`GEMINI_ENABLED=true` + `GEMINI_API_KEY` Aktif) | **NOT RUN** | **Ketergantungan sistem eksternal di luar lingkup frontend-only**. Kredensial dan kuota live Gemini API tidak dikonfigurasi pada lingkungan uji (`GEMINI_ENABLED=false`, `gemini_configured=false`). Frontend terbukti menampilkan kegagalan jujur `503 GEMINI_UNAVAILABLE`, mempertahankan UUID v4 `request_key` saat pemulihan respons hilang, menjaga suntingan draft yang belum disimpan, serta menyediakan alur eksplisit berlabel `TEMPLATE` dan `MANUAL` (yang tidak dihitung sebagai bukti kelulusan Gemini nyata). |

---

## 2. Versi Runtime & Lingkungan Eksekusi

| Komponen | Versi / Konfigurasi Terverifikasi |
|---|---|
| Sistem Operasi | Windows (`win32`, `amd64`) |
| Node.js | `v24.18.1` (menggunakan modul bawaan `node:sqlite` `DatabaseSync` untuk migrasi DB uji disposable) |
| npm | `11.16.0` |
| Go Toolchain | `go version go1.27.0 windows/amd64` (`GOMAXPROCS=2`, `GOFLAGS=-p=2`) |
| Python (Referensi Read-Only) | `Python 3.14.6` (tidak dieksekusi atau dimodifikasi oleh suite frontend) |
| Frontend Stack | `@sveltejs/kit ^3.0.0`, `svelte ^5.57.2`, `vite ^8.3.0`, `typescript ^6.0.3`, `svelte-check ^4.6.0`, `@playwright/test ^1.65.0` |
| Zona Waktu Tampilan | `Asia/Jakarta` (WIB) |

---

## 3. Perintah Verifikasi Reproducible & Isolasi Port

### A. Instalasi & Eksekusi Suite Browser Serial

```powershell
cd frontend
npm ci --no-audit --no-fund
# Exit code: 0 (added 59 packages in 6s)

$env:TEST_WEB_PORT='62173'
$env:TEST_API_PORT='62080'
$env:GOMAXPROCS='2'
$env:GOFLAGS='-p=2'
npx playwright test --workers=1 --reporter=list
# Exit code: 0 — 7 passed (1.1m)
```

### B. Alokasi Port Bebas Konflik Antar-Spesifikasi

| Spesifikasi Uji | Web Port (Vite) | API Port (Go `cmd/api`) | AI Boundary Port | Mode Go (`AI_MODE`) | Catatan Isolasi |
|---|---|---|---|---|---|
| Base `webServer` (`start-test-stack.mjs`: `auth-shell.spec.ts`, `projects-dashboard.spec.ts`, `monitoring.spec.ts`) | `62173` (`TEST_WEB_PORT`) | `62080` (`TEST_API_PORT`) | `18000` (offline) | `real` | Menguji kesiapan jujur `ai_ready=false` & `503 AI_UNAVAILABLE` pada mode `real`. |
| `findings-and-follow-up.spec.ts` | `25175` | `28085` | `28000` (offline) | `simulated` (`ALLOW_MANUAL_FALLBACK=true`) | Stack SQLite + direktori bukti sementara `k3-p0-04-*`. |
| `inspection-journey.spec.ts` (**Baru — P0-07**) | `45175` | `48085` | `48009` (Node HTTP AI Fixture) | `simulated` | Stack penuh tanpa mock browser Go; terhubung ke fixture AI eksternal `/internal/v1/*` (`k3-p0-07-*`). |
| `reports-and-approval.spec.ts` | `55175` | `58085` | `28009` (offline) | `simulated` | Stack SQLite + bukti sementara `k3-p0-05-*`. |

### C. Verifikasi Pembersihan Proses (*Process Cleanup*)

Setelah eksekusi `npx playwright test --workers=1` selesai, pemeriksaan proses dan soket TCP memastikan **0 proses anak tertinggal**:

```powershell
Get-Process -Name "api","seed" -ErrorAction SilentlyContinue
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in @(15173,18080,25175,28085,45175,48085,48009,55175,58085,62173,62080) }
# Output: kosong (tidak ada proses api/seed/vite uji yang tersisa)
```

---

## 4. Bukti Perjalanan Inspeksi Terintegrasi (`frontend/tests/inspection-journey.spec.ts`)

Pengujian di [`frontend/tests/inspection-journey.spec.ts`](../frontend/tests/inspection-journey.spec.ts) menjalankan seluruh perjalanan petugas melalui **browser Chromium nyata → proxy Vite → binary Go `cmd/api` asli tanpa perubahan → SQLite & direktori bukti sementara → fixture HTTP Node.js eksternal hanya pada batas `/internal/v1/*`**, tanpa mencegat atau melakukan mock pada satu pun endpoint `/api/v1/*` Go:

1. **Login & Kesiapan Sistem**:
   - Masuk melalui `/login` sebagai `petugas` (`Petugas: Anisa`), memverifikasi chip `Mode: SIMULASI`, `Model Siap` (`ppe-sim-fixture-v1`), dan cakupan `NO_HELMET` serta `NO_VEST`.
2. **Pembuatan Proyek & Zona melalui UI**:
   - Membuat proyek aktif `Proyek Gedung Utama P0-07` (`Malang`) di `/projects` dan zona aktif `Zona Perancah Lantai 3` di `/projects/1`.
3. **Monitoring Kamera Browser & Konfirmasi Temporal 2-dari-3 di Go**:
   - Memilih proyek dan zona persisten di `/monitoring`, memverifikasi banner permanen `MODE SIMULASI AKTIF`.
   - Menekan `Mulai Monitoring`, memverifikasi `navigator.mediaDevices.getUserMedia` dipanggil tepat 1 kali dengan `{ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }`.
   - Loop capture mengirim frame JPEG biner (`640×480`) ke `POST /api/v1/monitoring/sessions/1/frames`. Go meneruskan multipart frame beserta hash SHA-256 ke fixture eksternal `POST /internal/v1/infer` (`engine_instance_id: "eng-sim-fixture-p0-07"`).
   - Fixture AI mengembalikan 2 track deterministik (`track_id: 101` `NO_HELMET` positif `0.91`, `track_id: 202` `NO_VEST` positif `0.87`).
   - Pada **Frame Sequence `#2`** (2 positif dalam 3 frame valid di dalam jendela 2000 ms), engine temporal Go (`internal/service/temporal.go`) mengonfirmasi event dan menyimpan foto bukti JPEG pemicu serta membuat **Temuan #1 (`101:1`, `NO_HELMET`, `pending`)** dan **Temuan #2 (`202:1`, `NO_VEST`, `pending`)**.
   - Memverifikasi kotak pembatas (`.person-bbox` dan `.obs-bbox`) dirender pada panel `Snapshot Hasil Inferensi Terakhir` (`[data-testid="snapshot-overlay-layer"]`) dan **0 kotak overlay** pada elemen `<video>` live preview.
   - Menghentikan sesi melalui tombol `Hentikan Monitoring` (`reason: "user_stop"`), memverifikasi track kamera dilepaskan dan sesi tercatat `stopped`.
4. **Verifikasi Integritas Bukti Asli SHA-256 (Bukan Screenshot Halaman)**:
   - **Frame Pemicu yang Diterima Fixture AI (`/internal/v1/infer`, Sequence `#2`)**:
     - Dimensi: `640 × 480 px` (`6500` byte)
     - SHA-256 JPEG Pemicu: `e6ebbebf3676c7fb953e0b1389ca0d73f36536d92448994f1e6041270ca0f146`
   - **Bukti Asli yang Disimpan & Disajikan Go (`GET /api/v1/findings/1` & `GET /api/v1/findings/1/evidence`)**:
     - `finding.evidence_sha256`: `e6ebbebf3676c7fb953e0b1389ca0d73f36536d92448994f1e6041270ca0f146`
     - SHA-256 byte unduhan `GET /api/v1/findings/1/evidence`: `e6ebbebf3676c7fb953e0b1389ca0d73f36536d92448994f1e6041270ca0f146` (`Buffer.compare === 0`)
     - SHA-256 setelah **Restart Proses Backend Go**: `e6ebbebf3676c7fb953e0b1389ca0d73f36536d92448994f1e6041270ca0f146`
     - SHA-256 Screenshot Halaman Monitoring (`monitoring-1280x800.png`): `bf9ce7e6a43061787413c058f10013e57e1b6176c100c1ec36aa07a8b5455bc6` (berbeda dari bukti asli, membuktikan bahwa yang disimpan adalah frame JPEG kamera asli saat event terjadi, bukan tangkapan layar UI).
5. **Verifikasi, Koreksi Kategori Akhir, dan Tindak Lanjut Temuan**:
   - Mengikuti tautan langsung dari Monitoring (`/findings/1`), membuka dialog pratinjau penuh dengan keyboard (`Enter`) dan menutupnya dengan `Escape`.
   - Mengonfirmasi Temuan #1 (`Versi #1` → `Versi #2`), mengoreksi kategori akhir petugas menjadi `NO_VEST` sementara indikasi awal model tetap `NO_HELMET` immutable (`Versi #2` → `Versi #3`), lalu menyimpan tindak lanjut `completed` dengan catatan wajib (`Versi #3` → `Versi #4`).
   - Menolak Temuan #2 (`/findings/2`) dengan alasan penolakan wajib (`Versi #1` → `Versi #2`).
6. **Penyusunan Laporan `TEMPLATE`, Suntingan, Pengakuan Tinjauan, Persetujuan, & Penguncian**:
   - Memilih Sesi #1 yang sudah tertutup di `/reports` (`data-eligible="true"`), membuat draft berlabel eksplisit `Provenance: TEMPLATE` (`/reports/1`, `Versi #1`).
   - Memverifikasi snapshot sumber historis hanya memuat Temuan #1 (`[F-1]`) yang terkonfirmasi dan tidak memuat Temuan #2 yang ditolak.
   - Menyunting judul dan narasi teks biasa (`Versi #1` → `Versi #2`), mencentang kotak pengakuan tinjauan manusia (`review_acknowledged`), dan menyetujui laporan (`Versi #2` → `Versi #3`, status `Disetujui`).
   - Memverifikasi laporan berubah menjadi tampilan baca-saja (*read-only*) dan percobaan mengubah Temuan #1 di `/findings/1` ditolak oleh Go dengan `409 REPORT_LOCKED`.
7. **Pemisahan Total Dashboard (`real` vs `simulated`)**:
   - Pada `/` (Dashboard), saat `Mode Data` = `real` (default): `Sesi Inspeksi = 0`, `Temuan Menunggu Review = 0`, `Temuan Terkonfirmasi = 0`, `Temuan Ditolak = 0`, `Tindakan Terbuka = 0`.
   - Saat `Mode Data` = `simulated`: `Sesi Inspeksi = 1`, `Temuan Menunggu Review = 0`, `Temuan Terkonfirmasi = 1`, `Temuan Ditolak = 1`, `Tindakan Terbuka = 0`.
8. **Ketahanan Data & Bukti Melintasi Restart Proses Backend Go dan Reload Halaman**:
   - Menghentikan proses `api.exe` Go dan menjalankan proses `api.exe` baru terhadap file SQLite serta direktori bukti yang sama, lalu melakukan `page.reload()`.
   - Tanpa kueri saluran samping (*side-channel*) ke SQLite, pembacaan melalui UI dan API publik membuktikan sesi autentikasi, metrik dashboard `simulated`, detail Temuan #1 (`Versi #4`, `Terkonfirmasi`, `Selesai`), file bukti asli (`/api/v1/findings/1/evidence`), dan Laporan #1 yang telah disetujui (`Versi #3`, `Disetujui`, snapshot `[F-1]`) tetap utuh.

### D. Rekaman `X-Request-Id` Aktual dari Perjalanan Terintegrasi

Diambil dari `journey-evidence-summary.json` hasil eksekusi aktual:

| Endpoint Publik Go | `X-Request-Id` Terobservasi |
|---|---|
| `POST /api/v1/auth/login` | `req-bff6ca317b64` |
| `GET /api/v1/auth/me` | `req-e1efd5be8cee` |
| `GET /api/v1/system/status` | `req-aeeb121b674f` |
| `POST /api/v1/projects` | `req-bc29a6d25c9f` |
| `POST /api/v1/projects/1/zones` | `req-58ce1e88f228` |
| `POST /api/v1/monitoring/sessions` | `req-ef40e7a71790` |
| `POST /api/v1/monitoring/sessions/1/frames` | `req-222c47068535` |
| `POST /api/v1/monitoring/sessions/1/stop` | `req-87be2ff0f6df` |
| `GET /api/v1/findings/1` | `req-811c0a70c524` |
| `GET /api/v1/findings/1/evidence` | `req-e3eee602ad5d` |
| `PATCH /api/v1/findings/1` | `req-095fc6a7c8f5` |
| `PATCH /api/v1/findings/2` | `req-d58d9fa12702` |
| `POST /api/v1/reports` | `req-9c91e2d28a3b` |
| `PATCH /api/v1/reports/1` | `req-94e19b0f3980` |
| `POST /api/v1/reports/1/approve` | `req-8d1f69e4863f` |
| `GET /api/v1/dashboard/summary` | `req-cce0ae9dc47c` |

---

## 5. Inspeksi Visual, Tata Letak Responsif (`1280×800` & `390×844`), dan Aksesibilitas Keyboard

Tangkapan layar aktual diambil oleh runner Playwright dan disimpan di luar pohon sumber yang dilacak Git (di dalam direktori artefak sesi lokal) serta telah diperiksa secara visual satu per satu:

| Layar | Viewport Desktop (`1280×800`) | Viewport Sempit (`390×844`) | Hasil Pemeriksaan Visual & Overflow |
|---|---|---|---|
| **Dashboard (`/`)** | `C:/Users/akmal/.t3/userdata/providers/antigravity/7be9b928ae8cba283f02640839db79b9ad29c4740201527659e873129d9e1991/antigravity-acp/brain/b7b57a87-0d15-42d1-9aaa-e46dea7526aa/captures/dashboard-1280x800.png` | `C:/Users/akmal/.t3/userdata/providers/antigravity/7be9b928ae8cba283f02640839db79b9ad29c4740201527659e873129d9e1991/antigravity-acp/brain/b7b57a87-0d15-42d1-9aaa-e46dea7526aa/captures/dashboard-390x844.png` | **PASS** — `scrollWidth <= clientWidth` pada kedua ukuran; navigasi berganti dari sidebar kiri ke bilah pil horizontal pada layar sempit; kartu metrik dan banner `MODE SIMULASI AKTIF` terbaca jelas tanpa rahasia yang terekspos. |
| **Monitoring (`/monitoring`)** | `C:/Users/akmal/.t3/userdata/providers/antigravity/7be9b928ae8cba283f02640839db79b9ad29c4740201527659e873129d9e1991/antigravity-acp/brain/b7b57a87-0d15-42d1-9aaa-e46dea7526aa/captures/monitoring-1280x800.png` | `C:/Users/akmal/.t3/userdata/providers/antigravity/7be9b928ae8cba283f02640839db79b9ad29c4740201527659e873129d9e1991/antigravity-acp/brain/b7b57a87-0d15-42d1-9aaa-e46dea7526aa/captures/monitoring-390x844.png` | **PASS** — `scrollWidth <= clientWidth`; pratinjau live terpisah dari snapshot hasil inferensi; indikator sampling `Target 1 FPS • Efektif 1,00 FPS` dan daftar `Capture Temuan Terbaru (2 temuan)` tertumpuk rapi pada `390×844`. |
| **Detail Temuan (`/findings/1`)** | `C:/Users/akmal/.t3/userdata/providers/antigravity/7be9b928ae8cba283f02640839db79b9ad29c4740201527659e873129d9e1991/antigravity-acp/brain/b7b57a87-0d15-42d1-9aaa-e46dea7526aa/captures/findings-1280x800.png` | `C:/Users/akmal/.t3/userdata/providers/antigravity/7be9b928ae8cba283f02640839db79b9ad29c4740201527659e873129d9e1991/antigravity-acp/brain/b7b57a87-0d15-42d1-9aaa-e46dea7526aa/captures/findings-390x844.png` | **PASS** — `scrollWidth <= clientWidth`; kotak pembatas `Person` dan `NO_HELMET (91%)` selaras di atas foto bukti `640 × 480 px`; dialog pratinjau penuh dapat dibuka dengan fokus keyboard (`Enter`) dan ditutup dengan `Escape`; metadata immutable (`NO_HELMET`, `101:1`, `bukan identitas pekerja`) berdampingan jelas dengan kategori akhir petugas (`NO_VEST`). |
| **Detail Laporan (`/reports/1`)** | `C:/Users/akmal/.t3/userdata/providers/antigravity/7be9b928ae8cba283f02640839db79b9ad29c4740201527659e873129d9e1991/antigravity-acp/brain/b7b57a87-0d15-42d1-9aaa-e46dea7526aa/captures/reports-1280x800.png` | `C:/Users/akmal/.t3/userdata/providers/antigravity/7be9b928ae8cba283f02640839db79b9ad29c4740201527659e873129d9e1991/antigravity-acp/brain/b7b57a87-0d15-42d1-9aaa-e46dea7526aa/captures/reports-390x844.png` | **PASS** — `scrollWidth <= clientWidth`; tampilan terkunci (*read-only*) setelah persetujuan menampilkan provenance `Draft Template Aplikasi (Bukan Output Gemini)`, `source_hash`, dan `Snapshot Sumber Historis (Immutable)` dengan referensi `[F-1]`. |

---

## 6. Petunjuk Startup Reproducible & Pelestarian Storage

Petunjuk lengkap instalasi (`npm ci`), konfigurasi proxy dev (`API_PROXY_TARGET`), startup bersama backend Go yang ada, serta pelestarian `backend/storage/` telah didokumentasikan di [`frontend/README.md`](../frontend/README.md) (menggantikan teks scaffold bawaan `sv`) dengan merujuk pada petunjuk backend di [`README.md`](../README.md).

---

## 7. Temuan Review Spesifikasi pada Baseline `11fdf4f` & Status Serah Terima

Pada baseline `11fdf4f91e59f5772c65ede3161407d193c00b2f`, review spesifikasi dua-sumbu mengidentifikasi 4 temuan pada kode produksi frontend yang **sedang diperbaiki secara terpisah oleh lajur implementer Argon 3** pada worktree terisolasi (tanpa tumpang tindih dengan file uji/dokumen P0-07 ini):
1. **Penghapusan + pembuatan ulang otomatis draft template stale (`ReportDetailPage.svelte`)**: aksi dua langkah (`DELETE /api/v1/reports/{id}` diikuti `POST /api/v1/reports`) tidak atomik jika langkah kedua gagal; sedang dihapus sehingga petugas menggunakan aksi Hapus Draft dan Buat Draft Template yang sudah terkonfirmasi secara terpisah.
2. **Label track/kategori tertebak pada kartu event capture (`capture.ts`)**: asosiasi `firstPositiveTrack` pada daftar `capturedEvents` sedang dihapus karena payload `FrameEvent` Go hanya membawa `finding_id`, `verification_status`, dan `evidence_url`.
3. **State thumbnail bukti hilang (`MonitoringView.svelte` / `FindingsGalleryPage.svelte`)**: penambahan state eksplisit saat thumbnail bukti mengembalikan error (`410 EVIDENCE_MISSING`) agar tidak tampak sebagai gambar rusak tanpa keterangan.
4. **Urutan penghentian monitoring saat logout (`AppShell.svelte` / `auth.svelte.ts`)**: memastikan kamera dan sesi monitoring dihentikan sebelum sesi autentikasi dihapus pada `POST /api/v1/auth/logout`, serta mempertahankan status autentikasi di UI apabila permintaan logout gagal.

**Status Serah Terima (Merger Handoff)**:
- Seluruh pengujian penerimaan dan dokumentasi P0-07 di cabang ini telah lulus (`7 passed`) terhadap baseline `11fdf4f91e59f5772c65ede3161407d193c00b2f`.
- Koordinator dapat menggabungkan cabang ini bersama cabang perbaikan produksi Argon 3 ke `integration/p0-frontend` dan menjalankan ulang suite serial satu kali pada SHA gabungan sebelum mengubah PR [#13](https://github.com/octalcake/SI-KB-Pengecekan-APD/pull/13) dari **draft** menjadi siap tinjau.
