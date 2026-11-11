import { expect, test } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, '..');
const backendDir = path.resolve(frontendDir, '..', 'backend');

const TEST_USERNAME = process.env.TEST_SEED_USERNAME ?? 'petugas';
const TEST_PASSWORD = process.env.TEST_SEED_PASSWORD ?? 'K3-Disp0sable-Test-Pass!2026';

// Valid minimal 1x1 JPEG fixture (test-only labeled fixture for Go checkJPEG validation)
const TEST_ONLY_VALID_JPEG_BYTES = Buffer.from(
	'/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
	'base64'
);
const TEST_ONLY_JPEG_SHA256 = crypto
	.createHash('sha256')
	.update(TEST_ONLY_VALID_JPEG_BYTES)
	.digest('hex');

interface DisposableFindingStack {
	baseUrl: string;
	apiPort: number;
	webPort: number;
	dbPath: string;
	evidenceDir: string;
	missingEvidenceAbsPath: string;
	stop: () => Promise<void>;
}

function waitForHttpReady(url: string, timeoutMs = 45_000): Promise<void> {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const check = () => {
			const req = http.get(url, (res) => {
				res.resume();
				if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
					resolve();
				} else if (Date.now() - started > timeoutMs) {
					reject(new Error(`Timeout waiting for ${url} (last status ${res.statusCode})`));
				} else {
					setTimeout(check, 250);
				}
			});
			req.on('error', () => {
				if (Date.now() - started > timeoutMs) {
					reject(new Error(`Timeout waiting for ${url}`));
				} else {
					setTimeout(check, 250);
				}
			});
		};
		check();
	});
}

async function startDisposableFindingStack(options: {
	webPort: number;
	apiPort: number;
	aiMode?: 'real' | 'simulated' | 'manual';
	allowManualFallback?: boolean;
}): Promise<DisposableFindingStack> {
	const {
		webPort,
		apiPort,
		aiMode = 'simulated',
		allowManualFallback = true
	} = options;

	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'k3-p0-04-'));
	const dbPath = path.join(tempRoot, 'k3.sqlite');
	const evidenceDir = path.join(tempRoot, 'evidence');
	const subEvidenceDir = path.join(evidenceDir, '2026', '11');
	fs.mkdirSync(subEvidenceDir, { recursive: true });

	const exeExt = process.platform === 'win32' ? '.exe' : '';
	const seedBin = path.join(tempRoot, `seed${exeExt}`);
	const apiBin = path.join(tempRoot, `api${exeExt}`);

	const migrationSql = fs.readFileSync(
		path.join(backendDir, 'migrations', '001_init.sql'),
		'utf8'
	);
	const [upSql] = migrationSql.split('-- migrate:down');
	const db = new DatabaseSync(dbPath);
	db.exec(upSql);
	db.close();

	const goEnv: Record<string, string | undefined> = {
		...process.env,
		APP_ENV: 'test',
		HTTP_ADDR: `127.0.0.1:${apiPort}`,
		ALLOWED_HOSTS: `localhost:${webPort},localhost:${apiPort},127.0.0.1:${apiPort}`,
		ALLOWED_ORIGINS: `http://localhost:${webPort},http://localhost:${apiPort}`,
		DB_PATH: dbPath,
		EVIDENCE_DIR: evidenceDir,
		AUTH_COOKIE_NAME: 'k3_session',
		AUTH_TTL_HOURS: '8',
		AUTH_COOKIE_SECURE: 'false',
		SEED_USERNAME: TEST_USERNAME,
		SEED_DISPLAY_NAME: 'Anisa',
		SEED_PASSWORD: TEST_PASSWORD,
		AI_BASE_URL: 'http://127.0.0.1:28000',
		AI_INTERNAL_TOKEN: 'test-internal-token-p0-04-disposable',
		AI_TIMEOUT_MS: '500',
		FRAME_TOTAL_DEADLINE_MS: '1500',
		FRAME_MAX_BYTES: '1048576',
		FRAME_MAX_PIXELS: '1000000',
		FRAME_TARGET_FPS: '1',
		CONFIRM_HITS: '2',
		CONFIRM_MAX_FRAMES: '3',
		CONFIRM_WINDOW_MS: '2000',
		TRACK_TIMEOUT_MS: '5000',
		SESSION_IDLE_TIMEOUT_MS: '15000',
		AI_MODE: aiMode,
		ALLOW_MANUAL_FALLBACK: allowManualFallback ? 'true' : 'false',
		GEMINI_ENABLED: 'false',
		GEMINI_MODEL: 'gemini-3.5-flash-lite',
		GEMINI_API_VERSION: 'v1',
		GEMINI_TIMEOUT_MS: '30000',
		GEMINI_MAX_ATTEMPTS: '2',
		GEMINI_STORE: 'false',
		REPORT_PROMPT_VERSION: 'k3-report-v1',
		DISPLAY_TIMEZONE: 'Asia/Jakarta'
	};

	execFileSync('go', ['build', '-o', seedBin, './cmd/seed'], {
		cwd: backendDir,
		env: goEnv,
		stdio: 'inherit'
	});
	execFileSync('go', ['build', '-o', apiBin, './cmd/api'], {
		cwd: backendDir,
		env: goEnv,
		stdio: 'inherit'
	});
	execFileSync(seedBin, [], {
		cwd: backendDir,
		env: goEnv,
		stdio: 'inherit'
	});

	// Write test-only labeled evidence JPEG files and SQLite records matching the exact Go schema
	const ev1Rel = '2026/11/test-fixture-f1.jpg';
	const ev2Rel = '2026/11/test-fixture-f2.jpg';
	const ev3Rel = '2026/11/test-fixture-f3-missing.jpg';
	const ev4Rel = '2026/11/test-fixture-f4-locked.jpg';

	fs.writeFileSync(path.join(evidenceDir, ev1Rel), TEST_ONLY_VALID_JPEG_BYTES);
	fs.writeFileSync(path.join(evidenceDir, ev2Rel), TEST_ONLY_VALID_JPEG_BYTES);
	fs.writeFileSync(path.join(evidenceDir, ev4Rel), TEST_ONLY_VALID_JPEG_BYTES);
	// Note: ev3Rel is intentionally NOT written on disk to test 410 EVIDENCE_MISSING from Go!

	const seedDb = new DatabaseSync(dbPath);
	const nowIso = '2026-11-11T02:15:00.000Z';
	const cap1Iso = '2026-11-11T02:15:22.000Z';
	const cap2Iso = '2026-11-11T02:16:10.000Z';
	const cap3Iso = '2026-11-11T02:17:05.000Z';
	const cap4Iso = '2026-11-11T02:18:00.000Z';

	// Project #1 & #2
	seedDb
		.prepare(
			`INSERT INTO projects (id, name, location, description, status, version, created_at, updated_at)
			 VALUES (1, 'Pembangunan Gedung A', 'Malang', 'Lokasi uji P0-04', 'active', 1, ?, ?),
			        (2, 'Renovasi Gudang B', 'Surabaya', 'Proyek kedua', 'active', 1, ?, ?)`
		)
		.run(nowIso, nowIso, nowIso, nowIso);

	// Zone #1 (in Project 1) & Zone #2 (in Project 2)
	seedDb
		.prepare(
			`INSERT INTO zones (id, project_id, name, description, status, version, created_at, updated_at)
			 VALUES (1, 1, 'Lantai 2 Struktur', 'Area perancah utama', 'active', 1, ?, ?),
			        (2, 2, 'Area Bongkar Muat', 'Zona gudang', 'active', 1, ?, ?)`
		)
		.run(nowIso, nowIso, nowIso, nowIso);

	const sessionConfigJson = JSON.stringify({
		sample_fps: 1,
		confirm_hits: 2,
		confirm_max_frames: 3,
		confirm_window_ms: 2000,
		track_timeout_ms: 5000,
		supported_violations: ['NO_HELMET', 'NO_VEST']
	});

	// Session #1: simulated closed session (labeled deterministic test fixture)
	// Session #2: manual closed session (eligible for manual multipart entry)
	// Session #3: simulated closed session with an approved report locking Finding #4
	seedDb
		.prepare(
			`INSERT INTO monitoring_sessions
			 (id, session_key, zone_id, started_by, source, status, mode, model_version, engine_instance_id, config_json, started_at, ended_at, end_reason, last_frame_at)
			 VALUES
			 (1, '11111111-1111-4111-8111-111111111111', 1, 1, 'browser_webcam', 'stopped', 'simulated', 'ppe-sim-fixture-v1', 'eng-sim-1', ?, ?, ?, 'user_stop', ?),
			 (2, '22222222-2222-4222-8222-222222222222', 1, 1, 'manual_entry', 'stopped', 'manual', NULL, NULL, ?, ?, ?, 'manual_entry', NULL),
			 (3, '33333333-3333-4333-8333-333333333333', 2, 1, 'browser_webcam', 'stopped', 'simulated', 'ppe-sim-fixture-v1', 'eng-sim-1', ?, ?, ?, 'user_stop', ?)`
		)
		.run(
			sessionConfigJson,
			nowIso,
			cap3Iso,
			cap3Iso,
			sessionConfigJson,
			nowIso,
			nowIso,
			sessionConfigJson,
			nowIso,
			cap4Iso,
			cap4Iso
		);

	const personBoxJson = JSON.stringify([0.2, 0.1, 0.6, 0.95]);
	const violBoxJson = JSON.stringify([0.31, 0.11, 0.45, 0.29]);
	const rawDetJson = JSON.stringify({
		track_id: 17,
		confidence: 0.93,
		bbox: [0.2, 0.1, 0.6, 0.95],
		ppe: [{ type: 'NO_HELMET', state: 'positive', confidence: 0.89, bbox: [0.31, 0.11, 0.45, 0.29] }]
	});

	// Insert Findings #1, #2, #3 (in Session #1) and Finding #4 (in Session #3, confirmed & locked by approved report)
	seedDb
		.prepare(
			`INSERT INTO findings
			 (id, session_id, source, track_id, track_key, detected_violation, violation_type, confidence,
			  person_bbox_json, violation_bbox_json, raw_detection_json, model_version, frame_sequence,
			  frame_width, frame_height, evidence_path, evidence_sha256, captured_at, received_at,
			  verification_status, verified_by, verified_at, notes, action_status, action_notes,
			  version, created_at, updated_at)
			 VALUES
			 (1, 1, 'auto', 17, '17:1', 'NO_HELMET', 'NO_HELMET', 0.89, ?, ?, ?, 'ppe-sim-fixture-v1', 12, 640, 480, ?, ?, ?, ?, 'pending', NULL, NULL, '', 'pending', '', 1, ?, ?),
			 (2, 1, 'auto', 21, '21:1', 'NO_VEST', 'NO_VEST', 0.84, ?, ?, ?, 'ppe-sim-fixture-v1', 15, 640, 480, ?, ?, ?, ?, 'pending', NULL, NULL, '', 'pending', '', 1, ?, ?),
			 (3, 1, 'auto', 25, '25:1', 'NO_HELMET', 'NO_HELMET', 0.78, ?, ?, ?, 'ppe-sim-fixture-v1', 19, 640, 480, ?, ?, ?, ?, 'rejected', 1, ?, 'Foto file hilang untuk uji 410', 'pending', '', 1, ?, ?),
			 (4, 3, 'auto', 30, '30:1', 'NO_HELMET', 'NO_HELMET', 0.92, ?, ?, ?, 'ppe-sim-fixture-v1', 8, 640, 480, ?, ?, ?, ?, 'confirmed', 1, ?, 'Sudah dikonfirmasi dan masuk laporan disetujui', 'completed', 'Selesai sebelum laporan disetujui', 2, ?, ?)`
		)
		.run(
			personBoxJson,
			violBoxJson,
			rawDetJson,
			ev1Rel,
			TEST_ONLY_JPEG_SHA256,
			cap1Iso,
			cap1Iso,
			cap1Iso,
			cap1Iso,
			personBoxJson,
			violBoxJson,
			rawDetJson,
			ev2Rel,
			TEST_ONLY_JPEG_SHA256,
			cap2Iso,
			cap2Iso,
			cap2Iso,
			cap2Iso,
			personBoxJson,
			violBoxJson,
			rawDetJson,
			ev3Rel,
			TEST_ONLY_JPEG_SHA256,
			cap3Iso,
			cap3Iso,
			cap3Iso,
			cap3Iso,
			cap3Iso,
			personBoxJson,
			violBoxJson,
			rawDetJson,
			ev4Rel,
			TEST_ONLY_JPEG_SHA256,
			cap4Iso,
			cap4Iso,
			cap4Iso,
			cap4Iso,
			cap4Iso
		);

	// Insert an approved report for Session #3 containing Finding #4 in its snapshot so Go LockedByApprovedReport returns true
	const approvedSnapshot = JSON.stringify({
		session_id: 3,
		mode: 'simulated',
		project: { id: 2, name: 'Renovasi Gudang B' },
		zone: { id: 2, name: 'Area Bongkar Muat' },
		findings: [
			{
				id: 4,
				version: 2,
				violation_type: 'NO_HELMET',
				captured_at: cap4Iso,
				notes: 'Sudah dikonfirmasi dan masuk laporan disetujui',
				action_status: 'completed',
				action_notes: 'Selesai sebelum laporan disetujui'
			}
		]
	});
	const approvedSourceHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

	seedDb
		.prepare(
			`INSERT INTO reports
			 (id, session_id, created_by, title, content, status, generated_by, findings_snapshot_json, source_hash, approved_by, approved_at, version, created_at, updated_at)
			 VALUES (1, 3, 1, 'Laporan Sesi 3 Disetujui', 'Isi laporan terkunci [F-4].', 'approved', 'manual', ?, ?, 1, ?, 1, ?, ?)`
		)
		.run(approvedSnapshot, approvedSourceHash, cap4Iso, cap4Iso, cap4Iso);

	seedDb.close();

	const runtimeEnv = { ...goEnv };
	delete runtimeEnv.SEED_PASSWORD;

	const apiProc = spawn(apiBin, [], {
		cwd: backendDir,
		env: runtimeEnv,
		stdio: 'inherit'
	});

	const viteCli = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');
	const webProc = spawn(
		process.execPath,
		[viteCli, 'dev', '--host', 'localhost', '--port', String(webPort), '--strictPort'],
		{
			cwd: frontendDir,
			env: {
				...process.env,
				API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`
			},
			stdio: 'inherit'
		}
	);

	const baseUrl = `http://localhost:${webPort}`;
	await waitForHttpReady(`${baseUrl}/api/v1/health`);

	const stop = async () => {
		for (const proc of [webProc, apiProc]) {
			if (proc && !proc.killed) {
				try {
					proc.kill();
				} catch {
					// ignore
				}
			}
		}
		await new Promise((r) => setTimeout(r, 300));
		try {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		} catch {
			// ignore
		}
	};

	return {
		baseUrl,
		apiPort,
		webPort,
		dbPath,
		evidenceDir,
		missingEvidenceAbsPath: path.join(evidenceDir, ev3Rel),
		stop
	};
}

test.describe('P0-04: Galeri temuan, verifikasi bukti, tindak lanjut, dan fallback manual', () => {
	let stack: DisposableFindingStack;

	test.beforeAll(async () => {
		stack = await startDisposableFindingStack({
			webPort: 25175,
			apiPort: 28085,
			aiMode: 'simulated',
			allowManualFallback: true
		});
	});

	test.afterAll(async () => {
		if (stack) {
			await stack.stop();
		}
	});

	test('perjalanan penuh petugas: filter galeri, periksa bukti asli & overlay, konfirmasi #1 + tindak lanjut selesai, tolak #2, koreksi keputusan, tangani 410/409/lock, tambah temuan manual, dan pertahankan data saat reload', async ({
		page
	}) => {
		await page.goto(`${stack.baseUrl}/`);
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('heading', { name: /Masuk Petugas K3/i })).toBeVisible();

		await page.getByLabel(/Username/i).fill(TEST_USERNAME);
		await page.getByLabel(/Password/i).fill(TEST_PASSWORD);
		await page.getByRole('button', { name: /Masuk/i }).click();
		await expect(page).toHaveURL(/\/$/);

		// 1. Buka galeri /findings dan periksa daftar awal (4 temuan fixture terpersisten di SQLite)
		await page.goto(`${stack.baseUrl}/findings`);
		await expect(page.getByRole('heading', { name: /Daftar Temuan Inspeksi/i })).toBeVisible();
		await expect(page.getByTestId('findings-total-count')).toHaveText('4');

		// Filter berdasarkan Proyek #1 dan Status Verifikasi = pending -> harus menampilkan #1 dan #2
		await page.getByLabel(/^Proyek$/i).selectOption('1');
		await page.getByLabel(/Status Verifikasi/i).selectOption('pending');
		await page.getByRole('button', { name: /Terapkan Filter/i }).click();
		await expect(page.getByTestId('findings-total-count')).toHaveText('2');
		await expect(page.getByTestId('finding-card-1')).toBeVisible();
		await expect(page.getByTestId('finding-card-2')).toBeVisible();

		// 2. Buka detail Temuan #1, periksa bukti asli, toggle overlay, perbesar, dan metadata immutable
		await page.getByRole('link', { name: /Buka Temuan #1/i }).click();
		await expect(page).toHaveURL(/\/findings\/1$/);
		await expect(page.getByRole('heading', { name: /Detail Temuan #1/i })).toBeVisible();

		await expect(page.getByTestId('finding-evidence-img')).toBeVisible();
		await expect(page.getByTestId('finding-bbox-overlay')).toBeVisible();
		await expect(page.getByTestId('immutable-detected-violation')).toContainText('NO_HELMET');
		await expect(page.getByTestId('temporary-track-reference')).toContainText('17:1');
		await expect(page.getByTestId('temporary-track-reference')).toContainText(
			/bukan identitas pekerja/i
		);

		// Toggle overlay off dan on
		await page.getByRole('button', { name: /Sembunyikan Overlay/i }).click();
		await expect(page.getByTestId('finding-bbox-overlay')).toBeHidden();
		await page.getByRole('button', { name: /Tampilkan Overlay/i }).click();
		await expect(page.getByTestId('finding-bbox-overlay')).toBeVisible();

		// Perbesar bukti dan tutup dengan tombol
		await page.getByRole('button', { name: /Perbesar Bukti/i }).click();
		await expect(page.getByRole('dialog', { name: /Pratinjau Penuh Foto Bukti/i })).toBeVisible();
		await page.getByRole('button', { name: /Tutup Pratinjau/i }).click();
		await expect(page.getByRole('dialog', { name: /Pratinjau Penuh Foto Bukti/i })).toBeHidden();

		// Sebelum dikonfirmasi, tindak lanjut dinonaktifkan dengan alasan jelas
		await expect(page.getByTestId('followup-disabled-reason')).toBeVisible();

		// 3. Konfirmasi Temuan #1 beserta koreksi kategori akhir ke NO_VEST (indikasi model NO_HELMET tetap immutable)
		await page.getByLabel(/Jenis Hasil Petugas/i).selectOption('NO_VEST');
		await page
			.getByLabel(/Catatan Verifikasi/i)
			.fill('Kepala memakai topi gelap namun rompi keselamatan tidak digunakan.');
		await page.getByRole('button', { name: /Konfirmasi Temuan/i }).click();

		await expect(page.getByTestId('verification-status-badge')).toContainText(/Terkonfirmasi/i);
		await expect(page.getByTestId('finding-version-badge')).toContainText('Versi #2');
		// Indikasi awal model tetap NO_HELMET sedangkan kategori akhir menjadi NO_VEST
		await expect(page.getByTestId('immutable-detected-violation')).toContainText('NO_HELMET');
		await expect(page.getByTestId('final-violation-type')).toContainText('NO_VEST');

		// 4. Tindak lanjut pada temuan terkonfirmasi: completed wajib catatan
		await page.getByLabel(/Status Tindak Lanjut/i).selectOption('completed');
		await page.getByLabel(/Catatan Tindak Lanjut/i).fill('');
		await page.getByRole('button', { name: /Simpan Tindak Lanjut/i }).click();
		await expect(page.getByTestId('finding-mutation-error')).toContainText(
			/Catatan tindak lanjut wajib diisi/i
		);

		await page
			.getByLabel(/Catatan Tindak Lanjut/i)
			.fill('Petugas menyerahkan rompi reflektif cadangan dan memastikan dipakai.');
		await page.getByRole('button', { name: /Simpan Tindak Lanjut/i }).click();
		await expect(page.getByTestId('action-status-badge')).toContainText(/Selesai/i);
		await expect(page.getByTestId('finding-version-badge')).toContainText('Versi #3');

		// Temuan terkonfirmasi tidak dapat langsung dihapus tanpa ditolak dulu
		await expect(page.getByTestId('delete-disabled-reason')).toContainText(
			/koreksi menjadi Ditolak dengan catatan alasan terlebih dahulu/i
		);

		// 5. Buka Temuan #2 dan uji penolakan (wajib alasan) serta konflik versi (409 VERSION_CONFLICT)
		await page.goto(`${stack.baseUrl}/findings/2`);
		await expect(page.getByRole('heading', { name: /Detail Temuan #2/i })).toBeVisible();

		// Tolak tanpa alasan -> error validasi
		await page.getByLabel(/Catatan Verifikasi/i).fill('');
		await page.getByRole('button', { name: /Tolak Temuan/i }).click();
		await expect(page.getByTestId('finding-mutation-error')).toContainText(
			/Alasan penolakan wajib diisi/i
		);

		// Simulasikan perubahan konkuren di tab lain via API langsung sehingga version di DB naik ke 2
		const concurrentRes = await page.evaluate(async () => {
			const meRes = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
			const meJson = await meRes.json();
			const csrf = meJson.data.csrf_token;
			const patchRes = await fetch('/api/v1/findings/2', {
				method: 'PATCH',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-CSRF-Token': csrf
				},
				body: JSON.stringify({
					version: 1,
					notes: 'Catatan awal dari tab lain'
				})
			});
			return patchRes.status;
		});
		expect(concurrentRes).toBe(200);

		// Sekarang petugas di halaman ini (masih memegang version=1) mengisi alasan penolakan dan klik Tolak Temuan -> 409 VERSION_CONFLICT
		const officerRejectionReason =
			'Rompi tertutup bayangan perancah namun sebenarnya terpakai dengan benar.';
		await page.getByLabel(/Catatan Verifikasi/i).fill(officerRejectionReason);
		await page.getByRole('button', { name: /Tolak Temuan/i }).click();

		await expect(page.getByTestId('finding-mutation-error')).toHaveAttribute(
			'data-error-code',
			'VERSION_CONFLICT'
		);
		// Pastikan teks yang sudah diketik petugas tidak hilang!
		await expect(page.getByLabel(/Catatan Verifikasi/i)).toHaveValue(officerRejectionReason);

		// Klik tombol Muat Ulang Data Terbaru (Pertahankan Input Saya) lalu simpan ulang -> berhasil!
		await page
			.getByRole('button', { name: /Muat Ulang Data Terbaru \(Pertahankan Input Saya\)/i })
			.click();
		await expect(page.getByTestId('finding-version-badge')).toContainText('Versi #2');
		await expect(page.getByLabel(/Catatan Verifikasi/i)).toHaveValue(officerRejectionReason);

		await page.getByRole('button', { name: /Tolak Temuan/i }).click();
		await expect(page.getByTestId('verification-status-badge')).toContainText(/Ditolak/i);
		await expect(page.getByTestId('finding-version-badge')).toContainText('Versi #3');

		// 6. Periksa Temuan #3 yang file buktinya hilang (410 EVIDENCE_MISSING) lalu hapus (soft delete)
		await page.goto(`${stack.baseUrl}/findings/3`);
		await expect(page.getByTestId('evidence-error-state')).toHaveAttribute(
			'data-error-code',
			'EVIDENCE_MISSING'
		);
		await expect(page.getByTestId('evidence-error-state')).toContainText(/410 EVIDENCE_MISSING/i);

		// Soft delete Temuan #3 (berstatus rejected dan tidak dikunci laporan)
		await page.getByRole('button', { name: /Hapus Temuan/i }).click();
		await page.getByRole('button', { name: /Ya, Hapus Temuan/i }).click();
		await expect(page).toHaveURL(/\/findings$/);
		await expect(page.getByTestId('findings-total-count')).toHaveText('3');

		// 7. Periksa Temuan #4 yang dikunci oleh laporan disetujui (409 REPORT_LOCKED)
		await page.goto(`${stack.baseUrl}/findings/4`);
		await page.getByLabel(/Catatan Verifikasi/i).fill('Coba ubah temuan yang sudah masuk laporan approved');
		await page.getByRole('button', { name: /Simpan Kategori \/ Catatan Saja/i }).click();
		await expect(page.getByTestId('finding-mutation-error')).toHaveAttribute(
			'data-error-code',
			'REPORT_LOCKED'
		);
		await expect(page.getByTestId('approved-report-lock-banner')).toBeVisible();

		// 8. Tambah temuan manual melalui formulir multipart pada Sesi #2 (mode manual tertutup)
		await page.goto(`${stack.baseUrl}/findings`);
		await page.getByRole('button', { name: /Tambah Temuan Manual/i }).click();
		await page.getByLabel(/Sesi Mode Manual \(Tertutup\)/i).selectOption('2');
		await page.getByLabel(/Jenis Indikasi APD/i).selectOption('NO_HELMET');
		await page
			.getByLabel(/Catatan Observasi Manual Petugas/i)
			.fill('Observasi manual petugas pada area tangga darurat.');
		await page.getByLabel(/Foto Bukti JPEG/i).setInputFiles({
			name: 'bukti-manual.jpg',
			mimeType: 'image/jpeg',
			buffer: TEST_ONLY_VALID_JPEG_BYTES
		});
		await page.getByRole('button', { name: /Simpan Temuan Manual/i }).click();

		await expect(page.getByTestId('manual-finding-success')).toContainText(/Provenance: MANUAL/i);
		await expect(page.getByTestId('findings-total-count')).toHaveText('4');

		// 9. Reload halaman dan pastikan perubahan Temuan #1 dan #2 tetap tersimpan dari Go/SQLite
		await page.goto(`${stack.baseUrl}/findings/1`);
		await page.reload();
		await expect(page.getByTestId('verification-status-badge')).toContainText(/Terkonfirmasi/i);
		await expect(page.getByTestId('action-status-badge')).toContainText(/Selesai/i);
		await expect(page.getByLabel(/Catatan Tindak Lanjut/i)).toHaveValue(
			'Petugas menyerahkan rompi reflektif cadangan dan memastikan dipakai.'
		);

		await page.goto(`${stack.baseUrl}/findings/2`);
		await expect(page.getByTestId('verification-status-badge')).toContainText(/Ditolak/i);
		await expect(page.getByLabel(/Catatan Verifikasi/i)).toHaveValue(officerRejectionReason);

		// 10. Uji kegagalan jaringan (network failure) saat menyimpan koreksi: tampilkan error spesifik dan pertahankan input!
		const unsavedNetworkNote = 'Catatan koreksi saat jaringan terputus sementara';
		await page.getByLabel(/Catatan Verifikasi/i).fill(unsavedNetworkNote);
		await page.route('**/api/v1/findings/2', async (route) => {
			if (route.request().method() === 'PATCH') {
				await route.abort('failed');
				return;
			}
			await route.continue();
		});
		await page.getByRole('button', { name: /Konfirmasi Temuan/i }).click();
		await expect(page.getByTestId('finding-mutation-error')).toHaveAttribute(
			'data-error-code',
			'BACKEND_UNREACHABLE'
		);
		await expect(page.getByLabel(/Catatan Verifikasi/i)).toHaveValue(unsavedNetworkNote);
		await page.unroute('**/api/v1/findings/2');

		// 11. Uji 403 MANUAL_FALLBACK_DISABLED pada stack default (playwright webServer di baseURL yang memiliki ALLOW_MANUAL_FALLBACK=false)
		await page.goto('/');
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('heading', { name: /Masuk Petugas K3/i })).toBeVisible();
		await page.getByLabel(/Username/i).fill(TEST_USERNAME);
		await page.getByLabel(/Password/i).fill(TEST_PASSWORD);
		await page.getByRole('button', { name: /Masuk/i }).click();
		await expect(page).toHaveURL(/\/$/);

		const manualDisabledStatus = await page.evaluate(async () => {
			const meRes = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
			const meJson = await meRes.json();
			const csrf = meJson.data.csrf_token;
			const form = new FormData();
			form.set('session_id', '1');
			form.set('violation_type', 'NO_HELMET');
			form.set('notes', 'Coba manual saat fitur dinonaktifkan');
			form.set('evidence', new Blob(['fake'], { type: 'image/jpeg' }), 'test.jpg');
			const res = await fetch('/api/v1/findings', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'X-CSRF-Token': csrf },
				body: form
			});
			const body = await res.json();
			return { status: res.status, code: body?.error?.code };
		});
		expect(manualDisabledStatus).toEqual({
			status: 403,
			code: 'MANUAL_FALLBACK_DISABLED'
		});
	});
});
