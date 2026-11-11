# Hasil uji backend (SRS §17.5)

Tanggal: 2026-11-11. Basis commit: `41050e3` + perubahan lokal yang belum di-commit. Mesin: Windows 11, Docker Desktop (WSL2), CPU saja. Model `ppe-demo-v1` (`best.pt`, sha256 cocok dengan manifest).

Kolom **Aplikasi** berarti lulus dengan pipeline/fixture. Kolom **AI nyata** berarti lulus dengan model/Gemini sungguhan (§17.4: lulus fixture ≠ lulus integrasi nyata).

## Cara menjalankan ulang

- Go: `cd backend && go test ./...`. Dengan race detector (butuh cgo; di Windows lewat Docker): `docker run --rm -v "$PWD:/src" -w /src -e CGO_ENABLED=1 golang:1.27 go test -race ./...`
- Python: `cd ai-service && python -m pytest tests`
- Uji di stack Docker memakai script HTTP lewat proxy Vite (`http://localhost:5173/api/v1`) dengan user test terpisah.

## Checklist §17.3 (bagian backend)

| ID | Bukti | Aplikasi | AI nyata |
|---|---|---|---|
| TEMP-01 | `service.TestSRSTimeline`; Docker: 2 frame positif → 1 finding | lulus | lulus (`best.pt`, NO_VEST) |
| TEMP-02 | `TestSRSTimeline`, `TestLatestFrameMustBePositive`; Docker simulated `+,unknown,+` | lulus | — |
| TEMP-03 | `TestOutsideWindowDoesNotConfirm` | lulus | — |
| TEMP-04 | `TestMonitoringFlow` (retry dari cache, bytes beda 409); pytest cache Python; Docker retry sama | lulus | lulus |
| TEMP-05 | `TestEpisodeBoundary` (4,9 s tetap `7:1`, 5,0 s jadi `7:2`) | lulus | — |
| TEMP-06 | Keterbatasan: tidak ada re-identification, ID dapat berganti saat overlap | dicatat | dicatat |
| TEMP-07 | pytest `test_association` (tanpa box → unknown, konflik → unknown, ambigu → unknown) | lulus | — |
| TEMP-08 | `TestTwoFindingsOneFrame` (2 file evidence, 2 track_key) | lulus | — |
| FAIL-01 | Frontend (izin kamera) | belum (frontend) | — |
| FAIL-02 | `TestIdleTimeout` (→ `interrupted`/`idle_timeout`); `pagehide` frontend belum | lulus (server) | — |
| FAIL-03 | Docker: `docker compose restart ai-service` saat sesi aktif → frame berikut 503 `AI_UNAVAILABLE`, sesi `interrupted`/`ai_error`, 0 finding | lulus | lulus |
| FAIL-04 | `TestEvidenceWriteFailure` (500 `STORAGE_ERROR`, sesi interrupted, 0 row); karantina orphan `TestQuarantine`, log startup `quarantined=0` | lulus | — |
| FAIL-05 | `TestGeminiFailureKeepsDraft` (429/invalid/timeout → draft tetap, edit manual jalan); Docker: satu 503 sementara dari Google, retry 201 | lulus | lulus |
| DATA-01 | `TestReportFlow` (edit notes → `is_stale`, approve 409 `STALE_REPORT`) | lulus | — |
| DATA-02 | `TestSourceChangedDuringGeneration` (409 `SOURCE_CHANGED`, 0 report) | lulus | — |
| DATA-03 | `TestReportFlow` (approved: edit/delete/regenerate + finding sumber 409 `REPORT_LOCKED`) | lulus | — |
| DATA-04 | `TestConcurrentStart` (4 start paralel → tepat 1 active) | lulus | — |
| DATA-05 | `TestSoftDeleteNoRecapture` (tidak capture ulang, list default & evidence mengecualikan) | lulus | — |
| SEC-01 | `TestSecurityChecks` (tanpa cookie 401, CSRF salah 403, Origin asing 403, evidence tanpa cookie 401) | lulus | — |
| SEC-02 | `TestSecurityChecks` (JPEG palsu 422, >1 MiB 413, MIME salah 415, id traversal 404) | lulus | — |
| SEC-03 | `TestSecurityChecks` (notes HTML disimpan apa adanya sebagai teks; sesi hanya rejected → Gemini tidak dipanggil). Render aman di UI: frontend | lulus (API) | — |
| SEC-04 | Scan repo + `docker compose logs` terhadap nilai secret di `.env` dan pola key Google: tidak ada; `.env` di-ignore git | lulus | — |
| FALL-01 | Docker `AI_MODE=simulated`: sesi/finding/report `simulated`, dashboard default tidak menghitungnya, draft Gemini "Seluruh input adalah simulasi" | lulus | lulus (Gemini) |

Tambahan: restart Go saat sesi aktif → sesi `interrupted`/`server_restart`, frame berikut 409 `SESSION_NOT_ACTIVE`, sesi baru bisa dimulai (tracker Python lama di-stop oleh reconcile). `go test -race ./...` bersih.

## Alur utama di Docker (mode real)

Login → proyek/zona → start sesi → 3 frame `hasil_uji/webcam_uji.jpg` → 1 finding NO_VEST (dedupe frame 3) → evidence 200 (bytes = frame pemicu) → confirm → stop → generate Gemini nyata 201 (prompt `k3-report-v2`, menyebut deteksi otomatis + verifikasi petugas) → approve → dashboard summary/trends/zones konsisten. Hasil: 0 gagal.

## Latency (Docker, CPU, 20 frame pada 1 FPS)

| Metrik | p50 | p95 |
|---|---|---|
| Request frame end-to-end (client → Go → Python → Go) | 143 ms | 192 ms |
| Inferensi Python | 99 ms | 131 ms |

Catatan: dengan thread torch default (11) inferensi ~1,2 s di Docker/WSL2 karena CPU idle di antara frame; dibatasi 2 thread di `ai-service/app/detector.py`. Ukur ulang di laptop demo.

## Belum lulus / di luar backend

- AC-10: model belum divalidasi di kamera demo dengan orang sungguhan (baru foto uji).
- FAIL-01, `pagehide`/tab hidden, render notes aman: menunggu frontend.
- Keterbatasan: `request_key` lama setelah regenerate hanya di memori; redaksi notes hanya email/telepon; trend memakai satu offset zona waktu (tepat untuk Asia/Jakarta).
