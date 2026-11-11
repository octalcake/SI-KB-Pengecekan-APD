"""Uji model di laptop: hash, kelas, latency CPU, dan deteksi pada foto/webcam.

Pemakaian (dari folder ai-service, venv aktif):
    python test_model.py                         # hash + kelas + latency (gambar kosong)
    python test_model.py webcam                  # ambil 1 foto webcam lalu deteksi
    python test_model.py "C:/path/ke/foto.jpg"   # deteksi pada foto

Setiap uji disimpan dengan nama unik di folder uji_output/ (tidak menimpa hasil lama),
dan ringkasannya ditambahkan ke uji_output/log.csv.
Threshold dibaca dari .env (PERSON_CONF, VIOLATION_CONF) bila ada, sama seperti ai-service;
jika tidak ada, memakai rekomendasi di model_manifest.json.
"""
import csv
import hashlib
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

MODEL, MANIFEST, ENV_FILE = Path('models/best.pt'), Path('models/model_manifest.json'), Path('.env')
OUT_DIR = Path('uji_output')
OUT_DIR.mkdir(exist_ok=True)


def read_env(path):
    # Parser .env sederhana: KEY=VALUE, abaikan komentar.
    values = {}
    if path.exists():
        for line in path.read_text(encoding='utf-8').splitlines():
            line = line.split('#', 1)[0].strip()
            if '=' in line:
                key, value = line.split('=', 1)
                values[key.strip()] = value.strip()
    return values


def unique_name(stem, suffix):
    # <waktu>_<nama>.<ext>; tambah _2, _3 bila uji dijalankan dalam detik yang sama.
    base = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}_{stem}"
    path, n = OUT_DIR / f'{base}{suffix}', 2
    while path.exists():
        path, n = OUT_DIR / f'{base}_{n}{suffix}', n + 1
    return path


m = json.loads(MANIFEST.read_text(encoding='utf-8'))

# 1) File tidak rusak
sha = hashlib.sha256(MODEL.read_bytes()).hexdigest()
hash_ok = sha == m['weights_sha256']
print('1) Hash cocok dengan manifest:', hash_ok)

# 2) Kelas model sama dengan manifest
model = YOLO(str(MODEL))
names_ok = {str(k): v for k, v in model.names.items()} == m['native_classes']
print('2) Kelas cocok dengan manifest:', names_ok)
print('   Label logis:', m['logical_class_map'])

# Threshold: .env (seperti ai-service) lalu fallback ke manifest
env = read_env(ENV_FILE)
thr = dict(m['thresholds'])
if env.get('PERSON_CONF'):
    thr['person'] = float(env['PERSON_CONF'])
if env.get('VIOLATION_CONF'):
    thr['violation'] = float(env['VIOLATION_CONF'])
print(f"   Threshold dipakai: person={thr['person']}, violation={thr['violation']}"
      f"  (sumber: {'.env' if env.get('VIOLATION_CONF') else 'manifest'})")

# Sumber gambar
arg = sys.argv[1] if len(sys.argv) > 1 else None
src, label = None, 'kosong'
if arg == 'webcam':
    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)   # backend Windows yang lebih stabil
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    ok, frame = False, None
    for _ in range(60):                          # ~2 detik agar auto-exposure stabil
        ok, frame = cap.read()
        time.sleep(0.03)
    cap.release()
    if not ok:
        sys.exit('Webcam tidak bisa dibuka (tutup aplikasi lain yang memakai kamera, atau ganti index 0 ke 1)')
    brightness = frame.mean()
    print(f'   Kecerahan foto: {brightness:.0f} (normal > 60)')
    if brightness < 30:
        sys.exit('Foto terlalu gelap: buka penutup kamera, nyalakan lampu, atau coba index 1')
    src = unique_name('webcam', '.jpg')
    cv2.imwrite(str(src), frame)
    label = 'webcam'
elif arg:
    src = Path(arg)
    if not src.is_file():
        sys.exit(f'File tidak ditemukan: {src.resolve()}\n'
                 'Contoh path benar: "C:/Users/ACER/Downloads/foto.jpg"')
    label = src.stem.replace(' ', '_')

if src is not None:
    raw = cv2.imread(str(src))
    if raw is None:
        sys.exit(f'File bukan gambar yang bisa dibaca OpenCV: {src}')
    img = cv2.resize(raw, (640, 480))
else:
    img = np.zeros((480, 640, 3), np.uint8)

# 3) Latency CPU, 60 frame 640x480 (SRS §7.3)
for _ in range(3):
    model.predict(img, imgsz=640, device='cpu', verbose=False)
lat = []
for _ in range(60):
    t = time.perf_counter()
    model.predict(img, imgsz=640, device='cpu', verbose=False)
    lat.append((time.perf_counter() - t) * 1000)
p50, p95 = np.percentile(lat, [50, 95])
print(f'3) Latency CPU: p50={p50:.0f} ms, p95={p95:.0f} ms')

# 4) Deteksi pada foto
detections, result_path = [], ''
if src is not None:
    id_to_logical = {v: k for k, v in m['logical_class_map'].items()}
    res = model.predict(str(src), imgsz=640, device='cpu', conf=thr['predict_floor'], verbose=False)[0]
    print('4) Deteksi:')
    for cls, conf in zip(res.boxes.cls.int().tolist(), res.boxes.conf.tolist()):
        logical = id_to_logical.get(cls)
        if not logical:
            continue                 # kelas yang diabaikan aplikasi (gloves, boots, dll.)
        batas = thr['person'] if logical == 'person' else thr['violation']
        lolos = conf >= batas
        detections.append(f"{logical}:{conf:.2f}{'' if lolos else '(bawah)'}")
        print(f"   {logical:10s} conf={conf:.2f}  ({'LOLOS' if lolos else 'di bawah'} threshold {batas})")
    if not detections:
        print('   (tidak ada deteksi label logis)')
    result_path = unique_name(f'{label}_hasil', '.jpg')
    cv2.imwrite(str(result_path), res.plot())
    print(f'   Gambar dengan box disimpan di {result_path}')

# Log ringkasan (ditambahkan, tidak ditimpa)
log_path = OUT_DIR / 'log.csv'
new_log = not log_path.exists()
with log_path.open('a', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    if new_log:
        w.writerow(['waktu', 'sumber', 'hash_ok', 'kelas_ok', 'thr_person', 'thr_violation',
                    'p50_ms', 'p95_ms', 'deteksi', 'gambar_hasil'])
    w.writerow([datetime.now().isoformat(timespec='seconds'), arg or 'kosong', hash_ok, names_ok,
                thr['person'], thr['violation'], round(float(p50)), round(float(p95)),
                ' '.join(detections), str(result_path)])
print(f'   Ringkasan ditambahkan ke {log_path}')