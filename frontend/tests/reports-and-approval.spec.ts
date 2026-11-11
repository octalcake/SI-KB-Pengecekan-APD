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

interface DisposableReportStack {
	baseUrl: string;
	apiPort: number;
	webPort: number;
	dbPath: string;
	evidenceDir: string;
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

async function startDisposableReportStack(options: {
	webPort: number;
	apiPort: number;
}): Promise<DisposableReportStack> {
	const { webPort, apiPort } = options;

	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'k3-p0-05-'));
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
		GOMAXPROCS: '2',
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
		AI_BASE_URL: 'http://127.0.0.1:28009',
		AI_INTERNAL_TOKEN: 'test-internal-token-p0-05-disposable',
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
		AI_MODE: 'simulated',
		ALLOW_MANUAL_FALLBACK: 'true',
		GEMINI_ENABLED: 'false',
		GEMINI_MODEL: 'gemini-3.5-flash-lite',
		GEMINI_API_VERSION: 'v1',
		GEMINI_TIMEOUT_MS: '30000',
		GEMINI_MAX_ATTEMPTS: '2',
		GEMINI_STORE: 'false',
		REPORT_PROMPT_VERSION: 'k3-report-v1',
		DISPLAY_TIMEZONE: 'Asia/Jakarta'
	};

	execFileSync('go', ['build', '-p', '2', '-o', seedBin, './cmd/seed'], {
		cwd: backendDir,
		env: goEnv,
		stdio: 'inherit'
	});
	execFileSync('go', ['build', '-p', '2', '-o', apiBin, './cmd/api'], {
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
	const ev1Rel = '2026/11/test-fixture-r-f1.jpg';
	const ev2Rel = '2026/11/test-fixture-r-f2.jpg';
	const ev3Rel = '2026/11/test-fixture-r-f3.jpg';
	fs.writeFileSync(path.join(evidenceDir, ev1Rel), TEST_ONLY_VALID_JPEG_BYTES);
	fs.writeFileSync(path.join(evidenceDir, ev2Rel), TEST_ONLY_VALID_JPEG_BYTES);
	fs.writeFileSync(path.join(evidenceDir, ev3Rel), TEST_ONLY_VALID_JPEG_BYTES);

	const seedDb = new DatabaseSync(dbPath);
	const nowIso = '2026-11-11T03:00:00.000Z';
	const cap1Iso = '2026-11-11T03:01:10.000Z';
	const cap2Iso = '2026-11-11T03:02:20.000Z';
	const cap3Iso = '2026-11-11T03:03:30.000Z';

	// Project #1 & #2
	seedDb
		.prepare(
			`INSERT INTO projects (id, name, location, description, status, version, created_at, updated_at)
			 VALUES (1, 'Pembangunan Gedung A', 'Malang', 'Lokasi uji laporan P0-05', 'active', 1, ?, ?),
			        (2, 'Renovasi Gudang B', 'Surabaya', 'Proyek kedua P0-05', 'active', 1, ?, ?)`
		)
		.run(nowIso, nowIso, nowIso, nowIso);

	// Zone #1 (Project 1) & Zone #2 (Project 2)
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

	// Session #1: stopped, has Confirmed Finding #1 -> ELIGIBLE
	// Session #2: stopped, has Confirmed Finding #2 -> ELIGIBLE
	// Session #3: stopped, has only Pending Finding #3 -> INELIGIBLE (NO_CONFIRMED_FINDINGS)
	// Session #4: active -> INELIGIBLE (SESSION_STILL_ACTIVE)
	seedDb
		.prepare(
			`INSERT INTO monitoring_sessions
			 (id, session_key, zone_id, started_by, source, status, mode, model_version, engine_instance_id, config_json, started_at, ended_at, end_reason, last_frame_at)
			 VALUES
			 (1, '11111111-1111-4111-8111-111111111111', 1, 1, 'browser_webcam', 'stopped', 'simulated', 'ppe-sim-fixture-v1', 'eng-sim-1', ?, ?, ?, 'user_stop', ?),
			 (2, '22222222-2222-4222-8222-222222222222', 2, 1, 'manual_entry', 'stopped', 'manual', NULL, NULL, ?, ?, ?, 'manual_entry', NULL),
			 (3, '33333333-3333-4333-8333-333333333333', 1, 1, 'browser_webcam', 'stopped', 'simulated', 'ppe-sim-fixture-v1', 'eng-sim-1', ?, ?, ?, 'user_stop', ?),
			 (4, '44444444-4444-4444-8444-444444444444', 1, 1, 'browser_webcam', 'active', 'simulated', 'ppe-sim-fixture-v1', 'eng-sim-1', ?, ?, NULL, NULL, ?)`
		)
		.run(
			sessionConfigJson,
			nowIso,
			cap1Iso,
			cap1Iso,
			sessionConfigJson,
			nowIso,
			cap2Iso,
			sessionConfigJson,
			nowIso,
			cap3Iso,
			cap3Iso,
			sessionConfigJson,
			nowIso,
			cap3Iso
		);

	const personBoxJson = JSON.stringify([0.2, 0.1, 0.6, 0.95]);
	const violBoxJson = JSON.stringify([0.31, 0.11, 0.45, 0.29]);
	const rawDetJson = JSON.stringify({
		track_id: 17,
		confidence: 0.93,
		bbox: [0.2, 0.1, 0.6, 0.95],
		ppe: [{ type: 'NO_HELMET', state: 'positive', confidence: 0.89, bbox: [0.31, 0.11, 0.45, 0.29] }]
	});

	seedDb
		.prepare(
			`INSERT INTO findings
			 (id, session_id, source, track_id, track_key, detected_violation, violation_type, confidence,
			  person_bbox_json, violation_bbox_json, raw_detection_json, model_version, frame_sequence,
			  frame_width, frame_height, evidence_path, evidence_sha256, captured_at, received_at,
			  verification_status, verified_by, verified_at, notes, action_status, action_notes,
			  version, created_at, updated_at)
			 VALUES
			 (1, 1, 'auto', 17, '17:1', 'NO_HELMET', 'NO_HELMET', 0.89, ?, ?, ?, 'ppe-sim-fixture-v1', 12, 640, 480, ?, ?, ?, ?, 'confirmed', 1, ?, 'Pekerja perancah tanpa helm keselamatan.', 'in_progress', 'Sedang diberikan helm cadangan.', 2, ?, ?),
			 (2, 2, 'manual', NULL, NULL, NULL, 'NO_VEST', NULL, NULL, NULL, NULL, NULL, NULL, 640, 480, ?, ?, ?, ?, 'confirmed', 1, ?, 'Observasi manual tanpa rompi reflektif.', 'completed', 'Rompi sudah dikenakan di tempat.', 2, ?, ?),
			 (3, 3, 'auto', 21, '21:1', 'NO_HELMET', 'NO_HELMET', 0.81, ?, ?, ?, 'ppe-sim-fixture-v1', 14, 640, 480, ?, ?, ?, ?, 'pending', NULL, NULL, '', 'pending', '', 1, ?, ?)`
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
			cap1Iso,
			ev2Rel,
			TEST_ONLY_JPEG_SHA256,
			cap2Iso,
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
			cap3Iso
		);

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

	// Ensure Session #4 is active after Go startup recovery so 409 SESSION_STILL_ACTIVE is tested against live Go
	const activeDb = new DatabaseSync(dbPath);
	activeDb
		.prepare(`UPDATE monitoring_sessions SET status = 'active', ended_at = NULL, end_reason = NULL WHERE id = 4`)
		.run();
	activeDb.close();

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
		stop
	};
}

test.describe('P0-05: Penyusunan laporan inspeksi, snapshot sumber, staleness, dan penguncian persetujuan', () => {
	let stack: DisposableReportStack;

	test.beforeAll(async () => {
		stack = await startDisposableReportStack({
			webPort: Number(process.env.TEST_REPORT_STACK_WEB_PORT ?? '55175'),
			apiPort: Number(process.env.TEST_REPORT_STACK_API_PORT ?? '58085')
		});
	});

	test.afterAll(async () => {
		if (stack) {
			await stack.stop();
		}
	});

	test('perjalanan penuh petugas: kelayakan sesi tertutup, kegagalan jujur Gemini (503) & retensi request_key, pembuatan template & manual, suntingan versi, staleness sumber, konfirmasi regenerate, persetujuan wajib ack, dan penguncian permanen laporan + temuan sumber', async ({
		page
	}) => {
		await page.goto(`${stack.baseUrl}/`);
		await expect(page).toHaveURL(/\/login$/);

		await page.getByLabel(/Username/i).fill(TEST_USERNAME);
		await page.getByLabel(/Password/i).fill(TEST_PASSWORD);
		await page.getByRole('button', { name: /Masuk/i }).click();
		await expect(page).toHaveURL(/\/$/);

		// 1. Buka halaman /reports dan periksa kesiapan serta kelayakan sesi
		await page.goto(`${stack.baseUrl}/reports`);
		await expect(page.getByRole('heading', { name: /Laporan Inspeksi K3/i })).toBeVisible();
		await expect(page.getByTestId('reports-total-count')).toHaveText('0');
		await expect(page.getByTestId('gemini-readiness-chip')).toContainText(
			/Tidak Dikonfigurasi \/ Nonaktif/i
		);

		// Uji Sesi #4 (masih aktif) -> 409 SESSION_STILL_ACTIVE
		await page.getByTestId('create-session-select').selectOption('4');
		await expect(page.getByTestId('session-eligibility-status')).toContainText(
			/SESSION_STILL_ACTIVE/i
		);
		await page.getByTestId('submit-create-template').click();
		await expect(page.getByTestId('report-create-error')).toHaveAttribute(
			'data-error-code',
			'SESSION_STILL_ACTIVE'
		);

		// Uji Sesi #3 (tertutup tetapi 0 temuan terkonfirmasi) -> 422 NO_CONFIRMED_FINDINGS
		await page.getByTestId('create-session-select').selectOption('3');
		await expect(page.getByTestId('session-eligibility-status')).toContainText(
			/NO_CONFIRMED_FINDINGS/i
		);
		await page.getByTestId('submit-create-template').click();
		await expect(page.getByTestId('report-create-error')).toHaveAttribute(
			'data-error-code',
			'NO_CONFIRMED_FINDINGS'
		);

		// 2. Pilih Sesi #1 (memenuhi syarat: tertutup + 1 temuan terkonfirmasi) dan uji generasi Gemini (503 GEMINI_UNAVAILABLE + retensi UUID request_key)
		await page.getByTestId('create-session-select').selectOption('1');
		await expect(page.getByTestId('session-eligibility-status')).toHaveAttribute(
			'data-eligible',
			'true'
		);

		await page.getByRole('radio', { name: /Generasi Narasi Gemini Backend/i }).check();
		await page.getByTestId('submit-generate-gemini').click();

		// Go mengembalikan 503 GEMINI_UNAVAILABLE karena GEMINI_ENABLED=false; UI jujur menampilkannya dan menyimpan request_key
		await expect(page.getByTestId('report-create-error')).toHaveAttribute(
			'data-error-code',
			'GEMINI_UNAVAILABLE'
		);
		const firstSession1Key = (
			await page.getByTestId('active-generate-request-key').textContent()
		)?.trim();
		expect(firstSession1Key).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
		);

		// Uji pemulihan respons hilang (network abort): klik lagi pada sesi yang sama memakai request_key yang sama!
		let observedGenerateKeys: string[] = [];
		await page.route('**/api/v1/reports/generate', async (route) => {
			const postData = route.request().postDataJSON() as { request_key: string };
			observedGenerateKeys.push(postData.request_key);
			if (observedGenerateKeys.length === 1) {
				await route.abort('failed');
				return;
			}
			await route.continue();
		});

		await page.getByTestId('submit-generate-gemini').click();
		await expect(page.getByTestId('report-create-error')).toHaveAttribute(
			'data-error-code',
			'BACKEND_UNREACHABLE'
		);
		await page.getByTestId('retry-lost-response-same-key').click();
		await expect(page.getByTestId('report-create-error')).toHaveAttribute(
			'data-error-code',
			'GEMINI_UNAVAILABLE'
		);
		expect(observedGenerateKeys.length).toBe(2);
		expect(observedGenerateKeys[0]).toBe(firstSession1Key);
		expect(observedGenerateKeys[1]).toBe(firstSession1Key);
		await page.unroute('**/api/v1/reports/generate');

		// Jika input (session_id) diganti ke Sesi #2, request_key lama tidak boleh dipakai ulang!
		await page.getByTestId('create-session-select').selectOption('2');
		await page.getByTestId('submit-generate-gemini').click();
		const session2Key = (
			await page.getByTestId('active-generate-request-key').textContent()
		)?.trim();
		expect(session2Key).not.toBe(firstSession1Key);

		// 3. Buat Draft Manual pada Sesi #2 kemudian hapus draft tersebut (DELETE /reports/{id}?version=1 -> 204)
		await page.getByRole('radio', { name: /Draft Tulis Manual Petugas/i }).check();
		await page.getByLabel(/Judul Laporan Manual/i).fill('Draft Manual Sementara Sesi 2');
		await page
			.getByLabel(/Isi Narasi Laporan Manual/i)
			.fill('Narasi manual awal untuk menguji penghapusan draft.');
		await page.getByTestId('submit-create-manual').click();

		await expect(page).toHaveURL(/\/reports\/1$/);
		await expect(page.getByTestId('report-provenance-badge')).toContainText(/Provenance: MANUAL/i);
		await page.getByTestId('open-delete-report-btn').click();
		await page.getByTestId('confirm-delete-report-btn').click();
		await expect(page).toHaveURL(/\/reports$/);
		await expect(page.getByTestId('reports-total-count')).toHaveText('0');

		// 4. Buat Draft Template pada Sesi #1 (POST /reports { session_id: 1, use_template: true })
		await page.getByTestId('create-session-select').selectOption('1');
		await page.getByRole('radio', { name: /Draft Template Terstruktur/i }).check();
		await page.getByTestId('submit-create-template').click();

		// Karena ID #1 sudah soft-deleted, laporan baru memiliki ID #2
		await expect(page).toHaveURL(/\/reports\/2$/);
		await expect(page.getByTestId('report-status-badge')).toContainText(/Draft/i);
		await expect(page.getByTestId('report-provenance-badge')).toContainText(
			/Provenance: TEMPLATE/i
		);
		await expect(page.getByTestId('report-fresh-badge')).toBeVisible();
		await expect(page.getByTestId('report-version-badge')).toContainText('Versi #1');

		// Periksa snapshot sumber historis dan tautan ke temuan F-1
		await expect(page.getByTestId('report-snapshot-section')).toContainText(
			'Pembangunan Gedung A'
		);
		await expect(page.getByTestId('report-snapshot-section')).toContainText('Lantai 2 Struktur');
		await expect(page.getByTestId('snapshot-finding-1')).toContainText('[F-1]');
		await expect(page.getByTestId('snapshot-finding-link-1')).toHaveAttribute(
			'href',
			'/findings/1'
		);

		// 5. Uji pembuatan duplikat pada Sesi #1 dari halaman daftar -> 409 REPORT_EXISTS menawarkan pembukaan laporan yang sudah ada
		await page.goto(`${stack.baseUrl}/reports`);
		await expect(page.getByTestId('reports-total-count')).toHaveText('1');
		await page.getByTestId('create-session-select').selectOption('1');
		await page.getByTestId('submit-create-template').click();
		await expect(page.getByTestId('report-create-error')).toHaveAttribute(
			'data-error-code',
			'REPORT_EXISTS'
		);
		await page.getByTestId('open-existing-report-on-conflict').click();
		await expect(page).toHaveURL(/\/reports\/2$/);

		// 6. Sunting judul & narasi teks biasa, uji 409 VERSION_CONFLICT (input tidak hilang), lalu simpan
		const concurrentPatchStatus = await page.evaluate(async () => {
			const meRes = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
			const meJson = await meRes.json();
			const csrf = meJson.data.csrf_token;
			const res = await fetch('/api/v1/reports/2', {
				method: 'PATCH',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-CSRF-Token': csrf
				},
				body: JSON.stringify({
					version: 1,
					title: 'Judul dari Tab Lain'
				})
			});
			return res.status;
		});
		expect(concurrentPatchStatus).toBe(200);

		const editedTitle = 'Laporan Inspeksi Sesi S-1 (Telah Ditinjau Petugas)';
		const editedNarrative =
			'Proyek: Pembangunan Gedung A\nZona: Lantai 2 Struktur\n\nRingkasan Petugas: Temuan [F-1] tanpa helm telah ditindaklanjuti di lapangan. <script>alert("xss")</script>';
		await page.getByLabel(/Judul Laporan/i).fill(editedTitle);
		await page.getByLabel(/^Isi Narasi Laporan/i).fill(editedNarrative);
		await page.getByTestId('save-report-narrative-btn').click();

		// Harus 409 VERSION_CONFLICT dan teks suntingan petugas tetap utuh!
		await expect(page.getByTestId('report-mutation-error')).toHaveAttribute(
			'data-error-code',
			'VERSION_CONFLICT'
		);
		await expect(page.getByLabel(/Judul Laporan/i)).toHaveValue(editedTitle);
		await expect(page.getByLabel(/^Isi Narasi Laporan/i)).toHaveValue(editedNarrative);

		// Klik Muat Ulang Data Terbaru (Pertahankan Input Saya) -> version naik ke #2, lalu simpan ulang -> version #3
		await page.getByTestId('reload-report-preserving-input').click();
		await expect(page.getByTestId('report-version-badge')).toContainText('Versi #2');
		await expect(page.getByLabel(/Judul Laporan/i)).toHaveValue(editedTitle);

		await page.getByTestId('save-report-narrative-btn').click();
		await expect(page.getByTestId('report-version-badge')).toContainText('Versi #3');

		// 7. Ubah temuan sumber F-1 sehingga laporan menjadi STALE (is_stale=true)
		const findingUpdateStatus = await page.evaluate(async () => {
			const meRes = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
			const meJson = await meRes.json();
			const csrf = meJson.data.csrf_token;
			const res = await fetch('/api/v1/findings/1', {
				method: 'PATCH',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-CSRF-Token': csrf
				},
				body: JSON.stringify({
					version: 2,
					action_status: 'completed',
					action_notes: 'Helm cadangan sudah dipakai oleh pekerja perancah.'
				})
			});
			return res.status;
		});
		expect(findingUpdateStatus).toBe(200);

		await page.reload();
		await expect(page.getByTestId('report-stale-badge')).toBeVisible();
		await expect(page.getByTestId('report-stale-warning-banner')).toBeVisible();

		// Menyimpan suntingan teks narasi TIDAK menyegarkan status stale!
		const noteWhileStale = `${editedNarrative}\nCatatan tambahan saat sumber stale.`;
		await page.getByLabel(/^Isi Narasi Laporan/i).fill(noteWhileStale);
		await page.getByTestId('save-report-narrative-btn').click();
		await expect(page.getByTestId('report-version-badge')).toContainText('Versi #4');
		await expect(page.getByTestId('report-stale-badge')).toBeVisible();

		// Mencoba menyetujui laporan tanpa centang review_acknowledged -> 422 VALIDATION_ERROR
		await page.getByTestId('approve-report-btn').click();
		await expect(page.getByTestId('report-mutation-error')).toHaveAttribute(
			'data-error-code',
			'VALIDATION_ERROR'
		);

		// Mencoba menyetujui laporan saat STALE (dengan centang) -> 409 STALE_REPORT
		await page.getByTestId('review-acknowledged-checkbox').check();
		await page.getByTestId('approve-report-btn').click();
		await expect(page.getByTestId('report-mutation-error')).toHaveAttribute(
			'data-error-code',
			'STALE_REPORT'
		);

		// 8. Uji konfirmasi eksplisit Regenerate Gemini: ketika Gemini 503 gagal, suntingan yang belum disimpan di layar TIDAK hilang!
		const unsavedBeforeRegen = `${noteWhileStale}\nBaris belum disimpan sebelum klik regenerate.`;
		await page.getByLabel(/^Isi Narasi Laporan/i).fill(unsavedBeforeRegen);
		await expect(page.getByTestId('unsaved-edits-indicator')).toBeVisible();

		await page.getByTestId('open-regenerate-confirm-btn').click();
		await expect(page.getByTestId('regenerate-confirm-dialog')).toBeVisible();
		await page.getByTestId('confirm-regenerate-btn').click();

		await expect(page.getByTestId('report-mutation-error')).toHaveAttribute(
			'data-error-code',
			'GEMINI_UNAVAILABLE'
		);
		await expect(page.getByLabel(/^Isi Narasi Laporan/i)).toHaveValue(unsavedBeforeRegen);

		// 9. Segarkan sumber tanpa Gemini dengan "Buat Ulang Draft Template dari Sumber Terbaru" -> membuat Laporan #3 dengan is_stale=false dan snapshot F-1 versi terbaru
		await page.getByTestId('open-recreate-template-btn').click();
		await expect(page.getByTestId('recreate-template-confirm-dialog')).toBeVisible();
		await page.getByTestId('confirm-recreate-template-btn').click();

		await expect(page).toHaveURL(/\/reports\/3$/);
		await expect(page.getByTestId('report-fresh-badge')).toBeVisible();
		await expect(page.getByTestId('snapshot-finding-1')).toContainText(
			'Helm cadangan sudah dipakai oleh pekerja perancah.'
		);

		// Sunting judul laporan segar #3 sebelum disetujui
		const finalApprovedTitle = 'Laporan Resmi Sesi S-1 Gedung A (Disetujui)';
		await page.getByLabel(/Judul Laporan/i).fill(finalApprovedTitle);
		await page.getByTestId('save-report-narrative-btn').click();
		await expect(page.getByTestId('report-version-badge')).toContainText('Versi #2');

		// 10. Setujui laporan #3 dengan centang pernyataan petugas -> status = approved, tampilan menjadi read-only
		await page.getByTestId('review-acknowledged-checkbox').check();
		await page.getByTestId('approve-report-btn').click();

		await expect(page.getByTestId('report-status-badge')).toContainText(/Disetujui/i);
		await expect(page.getByTestId('approved-report-locked-banner')).toBeVisible();
		await expect(page.getByTestId('approved-readonly-view')).toBeVisible();
		await expect(page.getByTestId('approved-report-title')).toHaveText(finalApprovedTitle);

		// 11. Verifikasi penguncian permanen (409 REPORT_LOCKED) pada laporan yang disetujui maupun temuan sumber F-1 di UI /findings/1
		const lockChecks = await page.evaluate(async () => {
			const meRes = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
			const meJson = await meRes.json();
			const csrf = meJson.data.csrf_token;
			const headers = {
				'Content-Type': 'application/json',
				'X-CSRF-Token': csrf
			};

			const patchRep = await fetch('/api/v1/reports/3', {
				method: 'PATCH',
				credentials: 'same-origin',
				headers,
				body: JSON.stringify({ version: 3, title: 'Coba Ubah' })
			});
			const delRep = await fetch('/api/v1/reports/3?version=3', {
				method: 'DELETE',
				credentials: 'same-origin',
				headers
			});
			const patchFinding = await fetch('/api/v1/findings/1', {
				method: 'PATCH',
				credentials: 'same-origin',
				headers,
				body: JSON.stringify({ version: 3, notes: 'Coba ubah temuan terkunci' })
			});

			return {
				patchRep: { status: patchRep.status, code: (await patchRep.json())?.error?.code },
				delRep: { status: delRep.status, code: (await delRep.json())?.error?.code },
				patchFinding: {
					status: patchFinding.status,
					code: (await patchFinding.json())?.error?.code
				}
			};
		});

		expect(lockChecks.patchRep).toEqual({ status: 409, code: 'REPORT_LOCKED' });
		expect(lockChecks.delRep).toEqual({ status: 409, code: 'REPORT_LOCKED' });
		expect(lockChecks.patchFinding).toEqual({ status: 409, code: 'REPORT_LOCKED' });

		// Klik tautan temuan F-1 dari snapshot laporan -> mengarah ke /findings/1 dan membuktikan integrasi lintas halaman
		await page.getByTestId('snapshot-finding-link-1').click();
		await expect(page).toHaveURL(/\/findings\/1$/);
		await expect(page.getByRole('heading', { name: /Detail Temuan #1/i })).toBeVisible();

		// Kembali ke /reports dan uji filter berdasarkan status=approved serta project_id=1
		await page.goto(`${stack.baseUrl}/reports`);
		await expect(page.getByTestId('reports-total-count')).toHaveText('1');
		await page.getByLabel(/Proyek/i).selectOption('1');
		await page.getByLabel(/Status Laporan/i).selectOption('approved');
		await page.getByRole('button', { name: /Terapkan Filter/i }).click();
		await expect(page.getByTestId('reports-total-count')).toHaveText('1');
		await expect(page.getByTestId('report-card-3')).toBeVisible();

		// Filter status=draft harus kosong (0) karena laporan #3 sudah disetujui
		await page.getByLabel(/Status Laporan/i).selectOption('draft');
		await page.getByRole('button', { name: /Terapkan Filter/i }).click();
		await expect(page.getByTestId('reports-total-count')).toHaveText('0');
	});
});
