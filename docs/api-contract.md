> Diekstrak dari [requirements.md](requirements.md) §9–10; requirements.md tetap sumber utama.

## 9. Konvensi dan API contract publik per modul

### 9.1 Konvensi umum

Base dev `http://localhost:8080/api/v1`; frontend dev mem-proxy `/api` ke Go sehingga cookie dan evidence tetap same-origin. Nama JSON `snake_case`. ID publik integer positif dari SQLite; `session_key` internal UUID acak terpisah. Tidak ada data sensitif dalam URL.

JSON request `Content-Type: application/json`. Browser memakai `credentials: same-origin` melalui proxy, cookie sesi, dan `X-CSRF-Token` pada POST/PATCH/PUT/DELETE kecuali login. Login tetap memeriksa Origin. Endpoint frame memakai `image/jpeg`, manual evidence multipart. No arbitrary fields.

Success item: `{"data":{...}}`; success list: `{"data":[...],"meta":{"page":1,"page_size":20,"total":42}}`. Pagination page≥1, page_size default20 maksimal100; default sort `id DESC`, whitelist sort tambahan captured_at. Delete/logout 204 tanpa body. Semua timestamp UTC RFC3339; time filter `from` inclusive, `to` exclusive dan wajib ber-offset/Z. Contoh waktu `2026-11-11T02:15:22Z` = 09:15:22 WIB.

Error konsisten:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Nama proyek wajib diisi.",
    "fields": {"name": "required"},
    "request_id": "req-019"
  }
}
```

| HTTP | Penggunaan |
|---|---|
| 200 / 201 / 204 | Baca/edit/action; create; delete/logout |
| 400 | JSON/header/sequence tidak valid |
| 401 / 403 | Belum login; CSRF/ownership/hak akses salah |
| 404 / 410 | ID tidak ada atau soft-deleted; file evidence hilang |
| 409 | Version konflik, sesi aktif, status salah, sumber stale, duplicate key berbeda |
| 413 / 415 | Ukuran berlebih; content type bukan yang didukung |
| 422 | Validasi bisnis input, tidak ada confirmed findings, asosiasi proyek/zona tidak cocok |
| 429 | Rate limit/frame terlalu cepat; dapat disertai Retry-After |
| 502 / 503 / 504 | Output AI invalid; AI/Gemini tidak tersedia; deadline eksternal |
| 500 | Kegagalan internal/storage, pesan tanpa stack trace/path rahasia |

`version` integer dimulai 1; setiap update bertambah 1. Update menggunakan `WHERE id=? AND version=?`, jika tidak cocok 409 `VERSION_CONFLICT`. Operasi create biasa tidak diretry otomatis oleh browser. Frame dan generate memiliki dedupe khusus; approval/stop harus idempotent untuk state yang sudah sama.

### 9.2 Akses dan health

| Method | Path | Input → output | Status |
|---|---|---|---|
| POST | `/auth/login` | username,password → user,csrf_token + cookie | 200/401/429 |
| GET | `/auth/me` | cookie → user,csrf_token | 200/401 |
| POST | `/auth/logout` | CSRF → invalidate cookie/session | 204 |
| GET | `/health` | tanpa auth → status saja | 200/503 |
| GET | `/system/status` | login → AI readiness, mode, model version, supported_violations, Gemini configured boolean | 200 |

```http
POST /api/v1/auth/login
Content-Type: application/json

{"username":"petugas","password":"<password-yang-di-seed>"}
```

```json
{"data":{"user":{"id":1,"display_name":"Anisa","role":"officer"},"csrf_token":"<random-token>"}}
```

Health tidak membocorkan .env, path model, atau credential. Status Gemini configured tidak berarti quota pasti tersedia.

### 9.3 Proyek

| Method | Path | Input / filter | Output |
|---|---|---|---|
| POST | `/projects` | name,location,description | 201 Project |
| GET | `/projects` | q,status,page,page_size | 200 Project[] |
| GET | `/projects/{id}` | path id | 200 Project |
| PATCH | `/projects/{id}` | version + field name/location/description/status | 200 Project |
| DELETE | `/projects/{id}` | query version | 204 jika tidak dirujuk; selain itu409 |

```json
{"name":"Pembangunan Gedung A","location":"Malang","description":"Demo inspeksi APD"}
```

```json
{"data":{"id":1,"name":"Pembangunan Gedung A","location":"Malang","description":"Demo inspeksi APD","status":"active","version":1,"created_at":"2026-11-11T02:00:00Z","updated_at":"2026-11-11T02:00:00Z"}}
```

Contoh arsip: `PATCH /projects/1` body `{"version":1,"status":"archived"}`; 409 `SESSION_ACTIVE` bila zona proyek sedang dimonitor. Penghapusan dengan version menjadi `/projects/1?version=2` dan tetap memerlukan CSRF.

### 9.4 Zona

| Method | Path | Input / filter | Output |
|---|---|---|---|
| POST | `/projects/{project_id}/zones` | name,description | 201 Zone |
| GET | `/projects/{project_id}/zones` | status,page,page_size | 200 Zone[] |
| GET | `/zones/{id}` | path id | 200 Zone |
| PATCH | `/zones/{id}` | version + name/description/status | 200 Zone |
| DELETE | `/zones/{id}` | version query | 204 atau409 jika dipakai |

```json
{"name":"Lantai 2","description":"Area pengamatan webcam demo"}
```

```json
{"data":{"id":2,"project_id":1,"name":"Lantai 2","description":"Area pengamatan webcam demo","status":"active","version":1,"created_at":"2026-11-11T02:01:00Z","updated_at":"2026-11-11T02:01:00Z"}}
```

### 9.5 Monitoring dan frame

| Method | Path | Input / filter | Output |
|---|---|---|---|
| POST | `/monitoring/sessions` | project_id,zone_id,source=browser_webcam (fallback manual_entry) | 201 Session |
| GET | `/monitoring/sessions` | project_id,zone_id,status,page,page_size | 200 Session[] |
| GET | `/monitoring/sessions/{id}` | path id | 200 Session |
| POST | `/monitoring/sessions/{id}/frames` | binary JPEG + header | 200 FrameResult |
| POST | `/monitoring/sessions/{id}/stop` | `{"reason":"user_stop"}` | 200 Session; repeat sama200 |

Start request/response:

```json
{"project_id":1,"zone_id":2,"source":"browser_webcam"}
```

```json
{"data":{"id":15,"project_id":1,"zone_id":2,"started_by":1,"source":"browser_webcam","status":"active","mode":"real","model_version":"ppe-demo-v1","supported_violations":["NO_HELMET","NO_VEST"],"started_at":"2026-11-11T02:15:00Z","ended_at":null,"config":{"sample_fps":1,"confirm_hits":2,"confirm_max_frames":3,"confirm_window_ms":2000,"track_timeout_ms":5000}}}
```

Mode tidak boleh dipilih bebas oleh frontend: berasal dari konfigurasi server `real|simulated|manual`. Start real gagal 503 `MODEL_NOT_READY` bila model tidak ada; tidak otomatis turun menjadi simulasi. Mode manual memakai `source=manual_entry` dan membuat sesi yang langsung stopped dengan ended_at=started_at untuk pencatatan fallback, tanpa frame endpoint atau kewajiban model ready. `manual_entry` tidak diterima di mode real/simulated; alur normal tetap browser_webcam.

Frame request (semua header wajib):

```http
POST /api/v1/monitoring/sessions/15/frames
Content-Type: image/jpeg
X-CSRF-Token: <token>
X-Frame-Sequence: 12
X-Captured-At: 2026-11-11T02:15:22Z
X-Sample-Elapsed-Ms: 22000

<binary JPEG; bukan base64>
```

Sequence dimulai 1 dan bertambah untuk setiap sample yang dikirim, boleh ada gap jika tick dilewati; sample_elapsed_ms adalah waktu monotonic browser sejak sesi sampling mulai. Captured_at dipakai sebagai metadata dan divalidasi wajar terhadap clock lokal, bukan penentu window. Receipt monotonic Go menentukan interval §6.3. Capture dan receipt ada pada response/cache; hanya timestamp frame yang menghasilkan finding disimpan permanen pada findings. Frame lain tidak memiliki record database; diagnosis delay per frame memakai log metadata tanpa gambar.

```json
{
  "data": {
    "session_id":15,
    "frame_sequence":12,
    "captured_at":"2026-11-11T02:15:22Z",
    "received_at":"2026-11-11T02:15:22.020Z",
    "width":640,
    "height":480,
    "inference_ms":310,
    "model_version":"ppe-demo-v1",
    "mode":"real",
    "tracks":[{
      "track_id":17,
      "track_key":"17:1",
      "person_confidence":0.93,
      "person_bbox":[0.20,0.10,0.60,0.95],
      "observations":[{
        "type":"NO_HELMET",
        "state":"positive",
        "confidence":0.89,
        "bbox":[0.31,0.11,0.45,0.29]
      }]
    }],
    "events":[{
      "type":"finding_created",
      "finding_id":105,
      "verification_status":"pending",
      "evidence_url":"/api/v1/findings/105/evidence"
    }]
  }
}
```

BBox di seluruh API berarti `[x_min,y_min,x_max,y_max]` **ternormalisasi 0..1 pada JPEG asli yang dikirim**, bukan `[x,y,width,height]`. `x_min<x_max`, `y_min<y_max`. Person bbox terpisah dari indikasi/head/torso bbox. Overlay dikalikan ukuran tampilan dengan aspect ratio konsisten; mirror preview jangan mengubah koordinat foto. Frame tanpa objek sukses `tracks:[],events:[]`.

Sesi aktif kedua →409 `CAMERA_BUSY`; sequence beda isi →409 `FRAME_SEQUENCE_CONFLICT`; frame pada sesi stopped →409 `SESSION_NOT_ACTIVE`; tracker instance berubah →503 `TRACKER_RESET` dan sesi interrupted. Sampling lebih cepat dari batas dev →429. Stop tidak memproses frame tambahan setelah sesi ditutup.

### 9.6 Temuan, review, dan evidence

| Method | Path | Input / filter | Output |
|---|---|---|---|
| GET | `/findings` | project_id,zone_id,session_id,violation_type,verification_status,action_status,from,to,page,page_size | 200 Finding[] |
| GET | `/findings/{id}` | path id | 200 Finding |
| PATCH | `/findings/{id}` | version + verification_status/violation_type/notes/action_status/action_notes | 200 Finding |
| DELETE | `/findings/{id}` | version query | 204 soft delete; aturan §5.5 |
| GET | `/findings/{id}/evidence` | id, cookie | 200 image/jpeg, Cache-Control:no-store |
| POST | `/findings` | multipart manual; hanya fallback aktif | 201 Finding |

Resource Finding lengkap contoh:

```json
{
  "data": {
    "id":105,"session_id":15,"project_id":1,"zone_id":2,
    "source":"auto","mode":"real","track_id":17,"track_key":"17:1",
    "detected_violation":"NO_HELMET","violation_type":"NO_HELMET",
    "confidence":0.89,"person_bbox":[0.20,0.10,0.60,0.95],
    "violation_bbox":[0.31,0.11,0.45,0.29],
    "evidence_url":"/api/v1/findings/105/evidence",
    "evidence_sha256":"<64-karakter-hex>",
    "frame_sequence":12,"frame_width":640,"frame_height":480,
    "model_version":"ppe-demo-v1",
    "captured_at":"2026-11-11T02:15:22Z",
    "received_at":"2026-11-11T02:15:22.020Z",
    "verification_status":"pending","verified_by":null,"verified_at":null,
    "notes":"","action_status":"pending","action_notes":"",
    "version":1,"created_at":"2026-11-11T02:15:22.400Z",
    "updated_at":"2026-11-11T02:15:22.400Z"
  }
}
```

Project/zone diperoleh melalui join sesi, bukan kolom ganda yang bisa berbeda. Evidence path internal tidak dikirim ke browser. `person_bbox`/`violation_bbox`, confidence, model/track dan sequence null untuk manual. Response `raw_detection` dapat ditampilkan sebagai metadata yang dibatasi, bukan seluruh tensor.

Konfirmasi oleh petugas:

```http
PATCH /api/v1/findings/105
Content-Type: application/json

{"version":1,"verification_status":"confirmed","notes":"Kepala terlihat jelas tanpa helm pada foto."}
```

Response 200 Finding sama, version2, verified_by1, verified_at waktu server. Penolakan menggunakan `rejected` dan alasan. Tindak lanjut: `{"version":2,"action_status":"completed","action_notes":"Petugas meminta penggunaan helm dan memeriksa ulang langsung."}`. Ini contoh catatan manusia, bukan rekomendasi AI.

Manual multipart fields: `session_id=16`, `violation_type=NO_HELMET`, `notes=Observasi manual petugas`, `evidence=<JPEG>`. Sesi harus stopped/interrupted mode manual; source ditetapkan server manual. File dan batas dimensi sama. Endpoint mengembalikan 403 `MANUAL_FALLBACK_DISABLED` bila fitur tidak diaktifkan. Tidak memasukkan manual record ke sesi mode real untuk menjaga provenance sederhana.

### 9.7 Laporan

| Method | Path | Input / filter | Output |
|---|---|---|---|
| POST | `/reports/generate` | session_id,request_key UUID | 201 Report draft Gemini |
| POST | `/reports` | session_id,title,content (manual) atau session_id,use_template=true (template) | 201 Report draft manual/template |
| GET | `/reports` | project_id,session_id,status,page,page_size | 200 Report[] |
| GET | `/reports/{id}` | path id | 200 Report + snapshot + is_stale |
| PATCH | `/reports/{id}` | version,title/content | 200 Report draft |
| POST | `/reports/{id}/regenerate` | version,request_key UUID | 200 Report draft Gemini baru |
| POST | `/reports/{id}/approve` | version,review_acknowledged=true | 200 Report approved |
| DELETE | `/reports/{id}` | version query | 204 soft delete draft saja |

Generate:

```json
{"session_id":15,"request_key":"2ac448a4-fdb8-4542-91c5-103524b42f27"}
```

```json
{
  "data": {
    "id":8,"session_id":15,"status":"draft","title":"Draft inspeksi sesi 15",
    "content":"Pada inspeksi zona terpilih ditemukan indikasi tanpa helm yang telah dikonfirmasi petugas [#105].",
    "generated_by":"gemini","gemini_model":"gemini-3.5-flash-lite",
    "prompt_version":"k3-report-v1","source_finding_ids":[105],
    "source_hash":"<sha256-canonical-snapshot>","is_stale":false,
    "snapshot":{"session_id":15,"mode":"real","project":{"id":1,"name":"Pembangunan Gedung A"},"zone":{"id":2,"name":"Lantai 2"},"findings":[{"id":105,"version":2,"violation_type":"NO_HELMET","captured_at":"2026-11-11T02:15:22Z","notes":"Kepala terlihat jelas tanpa helm pada foto.","action_status":"pending","action_notes":""}]},
    "approved_by":null,"approved_at":null,"version":1,
    "created_at":"2026-11-11T02:30:00Z","updated_at":"2026-11-11T02:30:00Z"
  }
}
```

Contoh menggunakan model yang tercantum saat penyusunan; env dapat diganti setelah smoke test resmi §13. Response adalah kontrak aplikasi sendiri, bukan response mentah Google.

Hash sumber berasal dari canonical JSON snapshot yang disimpan: session id/mode, project dan zone id/nama, serta semua temuan confirmed nondeleted di sesi, terurut id, mencakup version, jenis final, captured_at, notes dan tindakan. Hash berubah jika confirmed baru masuk, confirmed ditolak, catatan/tindakan diubah, master rename, atau temuan dihapus. Metadata yang tidak dikirim ke laporan tidak perlu memengaruhi hash. Untuk **draft**, `is_stale` dihitung dengan membandingkan snapshot tersimpan dan sumber saat read/approve, bukan flag yang mudah tertinggal. Approved selalu memakai snapshot historis dan `is_stale=false`; rename master sesudah approval tidak mengubah isi atau validitas historis laporan.

Generate tidak menahan transaksi selama HTTP ke Gemini. Ambil snapshot → panggil API → validasi → transaksi singkat memeriksa hash+version dan unique active report. Gunakan mutex per sesi untuk generate/regenerate; `request_key` replay mengembalikan report hasil yang sama. Request key sama dengan input berbeda →409. Key gagal tidak membuat draft kosong; retry key yang sama boleh dijalankan ulang setelah failure terminal. Lost response dicek melalui daftar laporan; unique report/session menghalangi duplikasi.

Manual create memerlukan confirmed minimal satu dan sesi closed; snapshot tetap dibuat server. Jika title/content diberikan, server menetapkan generated_by=manual. Jika use_template=true, server membuat title/content deterministik dan menetapkan generated_by=template; kombinasi use_template dengan content ditolak422. Jangan menerima generated_by dari browser atau otomatis menyebut gemini bila error terjadi. Regenerate stale memerlukan confirm UI dan mengganti sumber serta teks; PATCH content biasa tidak membuat stale source menjadi fresh.

Approval dan semua edit/delete finding pada sesi yang sama memakai mutex sesi yang sama serta transaksi SQLite singkat `BEGIN IMMEDIATE`. Approval membaca hash/versi sumber dan mengubah status dalam transaksi itu; edit finding memeriksa adanya approved report dan menulis perubahan dalam transaksi yang sama. Mutasi master juga berjalan dalam transaksi writer yang sama sehingga tidak menyelinap di antara pemeriksaan sumber dan commit approval. Jangan memanggil BEGIN manual di dalam `sql.Tx` yang sudah aktif: driver dipilih untuk mendukung mode transaksi tersebut. Tidak ada lock atau transaksi yang dipertahankan selama panggilan Gemini.

Error penting: 422 `NO_CONFIRMED_FINDINGS`,409 `SESSION_STILL_ACTIVE`,409 `REPORT_EXISTS`,409 `SOURCE_CHANGED`,409 `STALE_REPORT`,409 `REPORT_LOCKED`,503 `GEMINI_UNAVAILABLE`,502 `INVALID_GEMINI_OUTPUT`. Approval ulang pada approved report yang sama mengembalikan status yang ada tanpa mengubah snapshot.

### 9.8 Dashboard

| Method | Path | Filter | Output |
|---|---|---|---|
| GET | `/dashboard/summary` | project_id,zone_id,from,to | counts |
| GET | `/dashboard/trends` | filter sama, P1 | date,count_confirmed |
| GET | `/dashboard/zones` | filter sama, P1 | zone_id,zone_name,count_confirmed |

```json
{"data":{"sessions":2,"findings_pending":3,"findings_confirmed":4,"findings_rejected":1,"confirmed_actions_open":2,"count_unit":"finding","timezone":"Asia/Jakarta"}}
```

Perbandingan statistik tidak mencampur mode simulated dengan real: default summary hanya real; filter tambahan `mode=real|simulated|manual` wajib ditampilkan jika fallback aktif. Sesi dihitung berdasarkan started_at; finding berdasarkan captured_at. Jelaskan perbedaan pada tooltip. Agregasi harian memakai batas hari Asia/Jakarta yang diubah menjadi UTC di service.

## 10. API contract internal AI service

Base `http://127.0.0.1:8000`; seluruh endpoint internal kecuali health memakai `X-Internal-Token`. Browser tidak mengaksesnya. Tidak ada key Gemini di Python.

| Method | Path | Input | Output |
|---|---|---|---|
| GET | `/internal/health` | none | status,engine_instance_id |
| GET | `/internal/v1/model-info` | token | ready,model_version,mode,class_map,thresholds,supported_violations |
| POST | `/internal/v1/sessions/start` | session_key,mode | tracker reset dan session aktif |
| POST | `/internal/v1/infer` | multipart frame + metadata | inference result |
| POST | `/internal/v1/sessions/stop` | session_key | tracker/cache dibersihkan |

Start body `{"session_key":"<uuid-Go>","mode":"real"}`. Start dengan key sama bersifat idempotent dan **tidak reset ulang** tracker yang sudah aktif. Key berbeda saat masih aktif →409. Pada Go startup, lakukan reconcile: query health lalu stop orphan tracker key lama sebelum start baru. Model weights dimuat sekali saat Python startup. `engine_instance_id` UUID berubah setiap proses baru.

Infer memakai multipart fields `session_key`, `frame_sequence`, `captured_at`, `sample_elapsed_ms`, `sha256`, dan `frame` binary. File + metadata memakai form, bukan JSON body bersamaan. FastAPI mendukung upload dengan `UploadFile` dan form multipart. [FastAPI request files](https://fastapi.tiangolo.com/tutorial/request-files/).

```json
{
  "session_key":"<uuid-Go>","engine_instance_id":"<uuid-Python>",
  "frame_sequence":12,"mode":"real","model_version":"ppe-demo-v1",
  "width":640,"height":480,"inference_ms":310,
  "persons":[{
    "track_id":17,"confidence":0.93,"bbox":[0.20,0.10,0.60,0.95],
    "ppe":[
      {"type":"NO_HELMET","state":"positive","confidence":0.89,"bbox":[0.31,0.11,0.45,0.29]},
      {"type":"NO_VEST","state":"negative","confidence":0.91,"bbox":[0.25,0.30,0.55,0.70]}
    ]
  }]
}
```

`negative` berarti bukti visual APD terkait terlihat, bukan “pasti patuh seluruh K3”. `unknown` menggunakan confidence/bbox null bila tidak ada penilaian andal. Jika kelas tidak didukung model, category masuk supported_violations tidak boleh muncul seolah aktif. Go memetakan track_id ke track_key/episode; Python tidak membuat finding. JSON response dibatasi 256KiB, validasi bbox/enum/finite confidence 0..1, dan cap 50 Person/frame. Jika terlalu padat, return warning, tandai degraded; jangan klaim cakupan semua orang.

Satu lock global infer di Python; hasil disimpan cache sebelum release lock. Retry sequence sama mengembalikan cached result tanpa model/tracker step kedua. Out-of-order →409. Infer gagal →503 `MODEL_ERROR`; invalid image →422; salah session →409; internal token salah →403. Field `engine_instance_id` diverifikasi Go pada setiap hasil.

