import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
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

const DEFAULT_CAPTURE_DIR =
	process.env.TEST_ACCEPTANCE_CAPTURE_DIR ??
	path.join(frontendDir, 'test-results', 'acceptance');

interface ReceivedAiFrame {
	sessionKey: string;
	frameSequence: number;
	capturedAt: string;
	sampleElapsedMs: number;
	reportedSha256: string;
	computedSha256: string;
	jpegBytes: Buffer;
	width: number;
	height: number;
}

interface DisposableJourneyStack {
	baseUrl: string;
	apiPort: number;
	webPort: number;
	aiPort: number;
	receivedFrames: ReceivedAiFrame[];
	startedSessionKeys: string[];
	stoppedSessionKeys: string[];
	restartBackend: () => Promise<void>;
	stop: () => Promise<void>;
}

function readJpegDimensions(buf: Buffer): { width: number; height: number } {
	if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
		return { width: 640, height: 480 };
	}
	let offset = 2;
	while (offset + 4 < buf.length) {
		if (buf[offset] !== 0xff) {
			offset += 1;
			continue;
		}
		while (offset < buf.length && buf[offset] === 0xff) {
			offset += 1;
		}
		if (offset >= buf.length) break;
		const marker = buf[offset]!;
		offset += 1;

		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) {
			break;
		}
		if (offset + 2 > buf.length) break;
		const segLen = buf.readUInt16BE(offset);
		if (segLen < 2 || offset + segLen > buf.length) break;

		const isSof =
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc;
		if (isSof && offset + 7 <= buf.length) {
			const height = buf.readUInt16BE(offset + 3);
			const width = buf.readUInt16BE(offset + 5);
			return { width, height };
		}
		offset += segLen;
	}
	return { width: 640, height: 480 };
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

async function installFakeCamera(page: Page) {
	await page.addInitScript(() => {
		const w = window as unknown as {
			__fakeCameraCalls: MediaStreamConstraints[];
			__fakeTracksStopped: number;
		};
		w.__fakeCameraCalls = [];
		w.__fakeTracksStopped = 0;

		let activeCanvasInterval: ReturnType<typeof setInterval> | null = null;

		const install = () => {
			if (!navigator.mediaDevices) {
				Object.defineProperty(navigator, 'mediaDevices', {
					value: {},
					configurable: true
				});
			}

			navigator.mediaDevices.getUserMedia = async (
				constraints: MediaStreamConstraints = {}
			): Promise<MediaStream> => {
				w.__fakeCameraCalls.push(constraints);

				const canvas = document.createElement('canvas');
				canvas.width = 640;
				canvas.height = 480;
				const ctx = canvas.getContext('2d')!;
				let tick = 0;

				const drawFrame = () => {
					tick += 1;
					ctx.fillStyle = '#0f172a';
					ctx.fillRect(0, 0, 640, 480);
					// Worker 1 silhouette (left)
					ctx.fillStyle = '#ea580c';
					ctx.fillRect(128, 48, 256, 408);
					// Worker 2 silhouette (right)
					ctx.fillStyle = '#2563eb';
					ctx.fillRect(320, 58, 192, 394);
					ctx.fillStyle = '#f8fafc';
					ctx.font = '18px sans-serif';
					ctx.fillText(`K3 Simulated Inspection Camera Tick ${tick}`, 24, 34);
				};
				drawFrame();
				activeCanvasInterval = setInterval(drawFrame, 120);

				const stream = canvas.captureStream(10);
				for (const track of stream.getTracks()) {
					const origStop = track.stop.bind(track);
					track.stop = () => {
						w.__fakeTracksStopped += 1;
						if (activeCanvasInterval) {
							clearInterval(activeCanvasInterval);
							activeCanvasInterval = null;
						}
						origStop();
					};
				}
				return stream;
			};
		};

		install();
	});
}

async function startDisposableJourneyStack(options: {
	webPort: number;
	apiPort: number;
	aiPort: number;
}): Promise<DisposableJourneyStack> {
	const { webPort, apiPort, aiPort } = options;
	const internalToken = 'test-internal-token-p0-07-journey-disposable';
	const engineInstanceId = 'eng-sim-fixture-p0-07';
	const modelVersion = 'ppe-sim-fixture-v1';

	const receivedFrames: ReceivedAiFrame[] = [];
	const startedSessionKeys: string[] = [];
	const stoppedSessionKeys: string[] = [];

	// Test-only external AI boundary implementing /internal/health, /internal/v1/health,
	// /internal/v1/model-info, /internal/v1/sessions/start, /internal/v1/sessions/stop,
	// /internal/v1/tracks/reset, /internal/v1/infer, and /internal/v1/detect.
	const aiServer = http.createServer(async (req, res) => {
		const url = req.url ?? '/';
		const token = req.headers['x-internal-token'];
		if (token !== internalToken) {
			res.writeHead(403, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					error: { code: 'FORBIDDEN', message: 'Internal token salah.' }
				})
			);
			return;
		}

		const chunks: Buffer[] = [];
		for await (const chunk of req) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		}
		const rawBody = Buffer.concat(chunks);

		if (
			req.method === 'GET' &&
			(url.startsWith('/internal/health') || url.startsWith('/internal/v1/health'))
		) {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					status: 'ok',
					ready: true,
					mode: 'simulated',
					model_version: modelVersion,
					supported_violations: ['NO_HELMET', 'NO_VEST'],
					engine_instance_id: engineInstanceId
				})
			);
			return;
		}

		if (req.method === 'GET' && url.startsWith('/internal/v1/model-info')) {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					ready: true,
					model_version: modelVersion,
					mode: 'simulated',
					supported_violations: ['NO_HELMET', 'NO_VEST'],
					engine_instance_id: engineInstanceId
				})
			);
			return;
		}

		if (
			req.method === 'POST' &&
			(url.startsWith('/internal/v1/sessions/start') ||
				url.startsWith('/internal/v1/tracks/reset'))
		) {
			const parsed = rawBody.length > 0 ? (JSON.parse(rawBody.toString('utf8')) as { session_key?: string }) : {};
			const sessionKey = parsed.session_key ?? 'unknown';
			startedSessionKeys.push(sessionKey);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ session_key: sessionKey, active: true }));
			return;
		}

		if (req.method === 'POST' && url.startsWith('/internal/v1/sessions/stop')) {
			const parsed = rawBody.length > 0 ? (JSON.parse(rawBody.toString('utf8')) as { session_key?: string }) : {};
			const sessionKey = parsed.session_key ?? 'unknown';
			stoppedSessionKeys.push(sessionKey);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ session_key: sessionKey, active: false }));
			return;
		}

		if (
			req.method === 'POST' &&
			(url.startsWith('/internal/v1/infer') || url.startsWith('/internal/v1/detect'))
		) {
			const webReq = new Request(`http://127.0.0.1:${aiPort}${url}`, {
				method: 'POST',
				headers: {
					'content-type': String(req.headers['content-type'] ?? '')
				},
				body: rawBody
			});
			const formData = await webReq.formData();
			const sessionKey = String(formData.get('session_key') ?? '');
			const frameSequence = Number(formData.get('frame_sequence') ?? '1');
			const capturedAt = String(formData.get('captured_at') ?? '');
			const sampleElapsedMs = Number(formData.get('sample_elapsed_ms') ?? '0');
			const reportedSha256 = String(formData.get('sha256') ?? '').toLowerCase();
			const frameFile = formData.get('frame') as File | null;
			const jpegBytes = frameFile
				? Buffer.from(await frameFile.arrayBuffer())
				: Buffer.alloc(0);
			const computedSha256 = crypto.createHash('sha256').update(jpegBytes).digest('hex');

			if (computedSha256 !== reportedSha256) {
				res.writeHead(422, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						error: { code: 'SHA256_MISMATCH', message: 'sha256 tidak cocok dengan frame.' }
					})
				);
				return;
			}

			const { width, height } = readJpegDimensions(jpegBytes);
			receivedFrames.push({
				sessionKey,
				frameSequence,
				capturedAt,
				sampleElapsedMs,
				reportedSha256,
				computedSha256,
				jpegBytes,
				width,
				height
			});

			// Return two tracked persons with positive NO_HELMET (track 101) and positive NO_VEST (track 202)
			// so Go's 2-of-3 temporal confirmation engine confirms both on frame_sequence=2.
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					session_key: sessionKey,
					engine_instance_id: engineInstanceId,
					frame_sequence: frameSequence,
					mode: 'simulated',
					model_version: modelVersion,
					width,
					height,
					inference_ms: 38,
					persons: [
						{
							track_id: 101,
							confidence: 0.94,
							bbox: [0.2, 0.1, 0.6, 0.95],
							ppe: [
								{
									type: 'NO_HELMET',
									state: 'positive',
									confidence: 0.91,
									bbox: [0.31, 0.11, 0.45, 0.29]
								}
							]
						},
						{
							track_id: 202,
							confidence: 0.91,
							bbox: [0.5, 0.12, 0.8, 0.94],
							ppe: [
								{
									type: 'NO_VEST',
									state: 'positive',
									confidence: 0.87,
									bbox: [0.55, 0.32, 0.74, 0.68]
								}
							]
						}
					]
				})
			);
			return;
		}

		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }));
	});

	await new Promise<void>((resolve, reject) => {
		aiServer.once('error', reject);
		aiServer.listen(aiPort, '127.0.0.1', () => resolve());
	});

	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'k3-p0-07-'));
	const dbPath = path.join(tempRoot, 'k3.sqlite');
	const evidenceDir = path.join(tempRoot, 'evidence');
	fs.mkdirSync(evidenceDir, { recursive: true });

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
		AI_BASE_URL: `http://127.0.0.1:${aiPort}`,
		AI_INTERNAL_TOKEN: internalToken,
		AI_TIMEOUT_MS: '1000',
		FRAME_TOTAL_DEADLINE_MS: '2500',
		FRAME_MAX_BYTES: '1048576',
		FRAME_MAX_PIXELS: '1000000',
		FRAME_TARGET_FPS: '1',
		CONFIRM_HITS: '2',
		CONFIRM_MAX_FRAMES: '3',
		CONFIRM_WINDOW_MS: '2000',
		TRACK_TIMEOUT_MS: '5000',
		SESSION_IDLE_TIMEOUT_MS: '15000',
		AI_MODE: 'simulated',
		ALLOW_MANUAL_FALLBACK: 'false',
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

	const runtimeEnv = { ...goEnv };
	delete runtimeEnv.SEED_PASSWORD;

	let apiProc: ChildProcess | null = spawn(apiBin, [], {
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

	const restartBackend = async () => {
		if (apiProc && !apiProc.killed) {
			const exited = new Promise<void>((resolve) => {
				apiProc?.once('exit', () => resolve());
				setTimeout(resolve, 2000);
			});
			try {
				apiProc.kill();
			} catch {
				// ignore
			}
			await exited;
		}
		apiProc = spawn(apiBin, [], {
			cwd: backendDir,
			env: runtimeEnv,
			stdio: 'inherit'
		});
		await waitForHttpReady(`http://127.0.0.1:${apiPort}/api/v1/health`);
		await waitForHttpReady(`${baseUrl}/api/v1/health`);
	};

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
		await new Promise<void>((resolve) => {
			aiServer.close(() => resolve());
		});
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
		aiPort,
		receivedFrames,
		startedSessionKeys,
		stoppedSessionKeys,
		restartBackend,
		stop
	};
}

async function assertNoHorizontalOverflow(page: Page, contextLabel: string) {
	const metrics = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth
	}));
	expect(
		metrics.scrollWidth,
		`Horizontal overflow detected on ${contextLabel}: scrollWidth=${metrics.scrollWidth} > clientWidth=${metrics.clientWidth}`
	).toBeLessThanOrEqual(metrics.clientWidth);
}

test.describe('P0-07: Perjalanan inspeksi terintegrasi penuh melalui Go API, SQLite, bukti JPEG asli, dan batas AI eksternal', () => {
	let stack: DisposableJourneyStack;

	test.beforeAll(async () => {
		stack = await startDisposableJourneyStack({
			webPort: Number(process.env.TEST_JOURNEY_STACK_WEB_PORT ?? '45175'),
			apiPort: Number(process.env.TEST_JOURNEY_STACK_API_PORT ?? '48085'),
			aiPort: Number(process.env.TEST_JOURNEY_STACK_AI_PORT ?? '48009')
		});
	});

	test.afterAll(async () => {
		if (stack) {
			await stack.stop();
		}
	});

	test('login -> proyek/zona UI -> monitoring kamera -> 2-of-3 konfirmasi temporal Go -> bukti asli SHA256 -> review/koreksi & tindak lanjut -> laporan TEMPLATE edit/ack/approve & lock -> dashboard terpisah -> tahan restart proses Go & reload', async ({
		page
	}) => {
		test.setTimeout(90_000);
		fs.mkdirSync(DEFAULT_CAPTURE_DIR, { recursive: true });

		// Ensure ZERO browser route mocking of Go API endpoints in this principal integrated journey.
		const observedRequestIds: Record<string, string | null> = {};
		page.on('response', (resp) => {
			const url = resp.url();
			if (url.includes('/api/v1/')) {
				const reqId = resp.headers()['x-request-id'] ?? null;
				const pathOnly = new URL(url).pathname;
				observedRequestIds[`${resp.request().method()} ${pathOnly}`] = reqId;
			}
		});

		await installFakeCamera(page);
		await page.setViewportSize({ width: 1280, height: 800 });

		// 1. Login through real browser UI
		await page.goto(`${stack.baseUrl}/`);
		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('heading', { name: /Masuk Petugas K3/i })).toBeVisible();

		await page.getByLabel(/Username/i).fill(TEST_USERNAME);
		await page.getByLabel(/Password/i).fill(TEST_PASSWORD);
		await page.getByRole('button', { name: /Masuk/i }).click();

		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByTestId('officer-identity')).toContainText('Petugas: Anisa');
		await expect(page.getByText(/SIMULASI/i).first()).toBeVisible();
		await expect(page.getByText(/Siap/i).first()).toBeVisible();

		// 2. Create Project & Zone through the real UI
		const primaryNav = page.getByRole('navigation', { name: /Navigasi utama/i });
		await primaryNav.getByRole('link', { name: /Proyek & Zona/i }).click();
		await expect(page).toHaveURL(/\/projects$/);
		await expect(page.getByRole('heading', { name: /Manajemen Proyek & Zona/i })).toBeVisible();

		const projectName = 'Proyek Gedung Utama P0-07';
		const zoneName = 'Zona Perancah Lantai 3';

		await page.getByLabel(/^Nama Proyek/i).fill(projectName);
		await page.getByLabel(/Lokasi/i).fill('Malang');
		await page
			.getByLabel(/Deskripsi Proyek/i)
			.fill('Proyek uji penerimaan terintegrasi penuh P0-07.');
		await page.getByRole('button', { name: /Tambah Proyek/i }).click();

		const projectCard = page.locator('[data-testid="project-item"]', { hasText: projectName });
		await expect(projectCard).toBeVisible();

		await projectCard.getByRole('link', { name: /Kelola Zona|Detail/i }).click();
		await expect(page).toHaveURL(/\/projects\/1$/);
		await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

		await page.getByLabel(/^Nama Zona/i).fill(zoneName);
		await page.getByLabel(/Deskripsi Zona/i).fill('Area struktur timur untuk inspeksi APD.');
		await page.getByRole('button', { name: /Tambah Zona/i }).click();

		const zoneCard = page.locator('[data-testid="zone-item"]', { hasText: zoneName });
		await expect(zoneCard).toBeVisible();

		// 3. Navigate to Monitoring, select persisted records, start fake-camera session (video-only),
		//    send real JPEG frames through Go to external AI fixture, and wait for Go 2-of-3 temporal findings
		await primaryNav.getByRole('link', { name: /Monitoring/i }).click();
		await expect(page).toHaveURL(/\/monitoring$/);
		await expect(
			page.getByRole('heading', { name: /Monitoring Kamera & Sesi Inspeksi/i })
		).toBeVisible();

		const projectSelect = page.getByLabel(/Proyek Aktif/i);
		const zoneSelect = page.getByLabel(/Zona Inspeksi Aktif/i);
		await expect(projectSelect).toContainText(projectName);
		await expect(zoneSelect).toContainText(zoneName);

		// Permanent simulated provenance & readiness from real Go /api/v1/system/status
		await expect(page.getByTestId('simulated-mode-banner')).toBeVisible();
		await expect(page.getByTestId('monitoring-mode-value')).toHaveText('SIMULASI');
		await expect(page.getByTestId('monitoring-readiness-value')).toContainText(
			'Siap (ppe-sim-fixture-v1)'
		);
		await expect(page.getByTestId('category-no-helmet')).toHaveAttribute('data-supported', 'true');
		await expect(page.getByTestId('category-no-vest')).toHaveAttribute('data-supported', 'true');

		await page.getByTestId('start-monitoring-btn').click();
		await expect(page.getByTestId('stop-monitoring-btn')).toBeVisible();

		// Verify camera permission requested after user gesture with audio: false
		const cameraCheck = await page.evaluate(() => {
			const w = window as unknown as {
				__fakeCameraCalls: MediaStreamConstraints[];
				__fakeTracksStopped: number;
			};
			return {
				calls: w.__fakeCameraCalls,
				stopped: w.__fakeTracksStopped
			};
		});
		expect(cameraCheck.calls.length).toBe(1);
		expect(cameraCheck.calls[0]?.audio).toBe(false);

		// Wait for Frame #1 and Frame #2 to be processed by real Go temporal confirmation (2 hits in 3 frames <= 2000ms)
		await expect(page.getByTestId('captured-finding-1')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId('captured-finding-2')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId('captured-events-count')).toHaveText('2 temuan');

		// Verify separate inferred snapshot overlay vs live video preview (zero bbox on live video)
		await expect(page.getByTestId('inference-snapshot-stage')).toBeVisible();
		await expect(page.getByTestId('snapshot-overlay-layer')).toBeVisible();
		await expect(page.locator('[data-testid="snapshot-overlay-layer"] .person-bbox')).toHaveCount(2);
		await expect(page.locator('[data-testid="snapshot-overlay-layer"] .obs-bbox')).toHaveCount(2);
		const liveVideoOverlayCount = await page
			.locator('.video-container .bbox, .video-container .overlay-layer')
			.count();
		expect(liveVideoOverlayCount).toBe(0);

		// Verify finding links on Monitoring page
		await expect(page.getByTestId('open-finding-link-1')).toHaveAttribute('href', '/findings/1');
		await expect(page.getByTestId('open-finding-link-2')).toHaveAttribute('href', '/findings/2');

		// Capture Monitoring screenshots at 1280x800 and 390x844 while snapshot + captures are visible
		await assertNoHorizontalOverflow(page, 'monitoring-1280x800');
		const monitoringDesktopScreenshot = await page.screenshot({
			path: path.join(DEFAULT_CAPTURE_DIR, 'monitoring-1280x800.png'),
			fullPage: false
		});
		const monitoringDesktopScreenshotSha256 = crypto
			.createHash('sha256')
			.update(monitoringDesktopScreenshot)
			.digest('hex');

		await page.setViewportSize({ width: 390, height: 844 });
		await assertNoHorizontalOverflow(page, 'monitoring-390x844');
		await page.screenshot({
			path: path.join(DEFAULT_CAPTURE_DIR, 'monitoring-390x844.png'),
			fullPage: false
		});
		await page.setViewportSize({ width: 1280, height: 800 });

		// Stop monitoring session through the UI
		await page.getByTestId('stop-monitoring-btn').click();
		await expect(page.getByTestId('start-monitoring-btn')).toBeVisible();
		await expect(page.getByTestId('monitoring-status-banner')).toContainText(/dihentikan/i);
		await expect(page.getByTestId('session-history-list')).toContainText('stopped');
		await expect(page.getByTestId('session-history-list')).toContainText('user_stop');

		const tracksStoppedAfterStop = await page.evaluate(() => {
			const w = window as unknown as { __fakeTracksStopped: number };
			return w.__fakeTracksStopped;
		});
		expect(tracksStoppedAfterStop).toBeGreaterThanOrEqual(1);
		expect(stack.startedSessionKeys.length).toBe(1);
		expect(stack.stoppedSessionKeys.length).toBeGreaterThanOrEqual(1);

		// 4. Compare stored original evidence SHA-256 to the exact fixture-received triggering JPEG (Frame #2),
		//    and prove it is NOT a screenshot of the browser page.
		const triggeringFrame = stack.receivedFrames.find((f) => f.frameSequence === 2);
		expect(triggeringFrame).toBeDefined();
		expect(triggeringFrame!.width).toBe(640);
		expect(triggeringFrame!.height).toBe(480);

		const evidenceApiCheck = await page.evaluate(async () => {
			const f1Res = await fetch('/api/v1/findings/1', { credentials: 'same-origin' });
			const f1Json = await f1Res.json();
			const evRes = await fetch('/api/v1/findings/1/evidence', { credentials: 'same-origin' });
			const evBuf = await evRes.arrayBuffer();
			return {
				findingStatus: f1Res.status,
				findingRequestId: f1Res.headers.get('x-request-id'),
				findingData: f1Json.data as {
					id: number;
					frame_sequence: number;
					frame_width: number;
					frame_height: number;
					evidence_sha256: string;
					mode: string;
					detected_violation: string;
					violation_type: string;
					track_key: string;
				},
				evidenceStatus: evRes.status,
				evidenceRequestId: evRes.headers.get('x-request-id'),
				evidenceContentType: evRes.headers.get('content-type'),
				evidenceBytes: Array.from(new Uint8Array(evBuf))
			};
		});

		expect(evidenceApiCheck.findingStatus).toBe(200);
		expect(evidenceApiCheck.evidenceStatus).toBe(200);
		expect(evidenceApiCheck.evidenceContentType).toBe('image/jpeg');
		expect(evidenceApiCheck.findingData.frame_sequence).toBe(2);
		expect(evidenceApiCheck.findingData.frame_width).toBe(640);
		expect(evidenceApiCheck.findingData.frame_height).toBe(480);
		expect(evidenceApiCheck.findingData.mode).toBe('simulated');

		const storedEvidenceBytes = Buffer.from(evidenceApiCheck.evidenceBytes);
		const storedEvidenceSha256 = crypto
			.createHash('sha256')
			.update(storedEvidenceBytes)
			.digest('hex');

		// Exact byte-for-byte and SHA-256 match between fixture-received triggering JPEG and Go-stored evidence
		expect(storedEvidenceSha256).toBe(triggeringFrame!.computedSha256);
		expect(evidenceApiCheck.findingData.evidence_sha256).toBe(triggeringFrame!.computedSha256);
		expect(Buffer.compare(storedEvidenceBytes, triggeringFrame!.jpegBytes)).toBe(0);
		// Must not be a page screenshot
		expect(storedEvidenceSha256).not.toBe(monitoringDesktopScreenshotSha256);

		// 5. Navigate via the Monitoring finding link to /findings/1, review/correct, and record follow-up
		await page.getByTestId('open-finding-link-1').click();
		await expect(page).toHaveURL(/\/findings\/1$/);
		await expect(page.getByRole('heading', { name: /Detail Temuan #1/i })).toBeVisible();

		await expect(page.getByTestId('finding-evidence-img')).toBeVisible();
		await expect(page.getByTestId('finding-bbox-overlay')).toBeVisible();
		await expect(page.getByTestId('immutable-detected-violation')).toContainText('NO_HELMET');
		await expect(page.getByTestId('temporary-track-reference')).toContainText('101:1');
		await expect(page.getByTestId('temporary-track-reference')).toContainText(
			/bukan identitas pekerja/i
		);

		// Keyboard focus & dialog behavior on evidence preview modal
		const zoomBtn = page.getByRole('button', { name: /Perbesar Bukti/i });
		await zoomBtn.focus();
		await page.keyboard.press('Enter');
		const previewDialog = page.getByRole('dialog', { name: /Pratinjau Penuh Foto Bukti/i });
		await expect(previewDialog).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(previewDialog).toBeHidden();

		// Confirm Finding #1 first (version 1 -> 2)
		await page
			.getByLabel(/Catatan Verifikasi/i)
			.fill('Terverifikasi pekerja pada perancah lantai 3 tidak mengenakan helm.');
		await page.getByRole('button', { name: /Konfirmasi Temuan/i }).click();
		await expect(page.getByTestId('verification-status-badge')).toContainText(/Terkonfirmasi/i);
		await expect(page.getByTestId('finding-version-badge')).toContainText('Versi #2');

		// Officer correction before report approval: update final category to NO_VEST while model indication stays NO_HELMET (version 2 -> 3)
		await page.getByLabel(/Jenis Hasil Petugas/i).selectOption('NO_VEST');
		await page
			.getByLabel(/Catatan Verifikasi/i)
			.fill(
				'Koreksi petugas sebelum laporan: helm tertutup bayangan namun rompi reflektif belum dikancingkan.'
			);
		await page.getByRole('button', { name: /Simpan Kategori \/ Catatan Saja/i }).click();
		await expect(page.getByTestId('finding-version-badge')).toContainText('Versi #3');
		await expect(page.getByTestId('immutable-detected-violation')).toContainText('NO_HELMET');
		await expect(page.getByTestId('final-violation-type')).toContainText('NO_VEST');

		// Record follow-up on Confirmed Finding #1: mark completed with required notes (version 3 -> 4)
		await page.getByLabel(/Status Tindak Lanjut/i).selectOption('completed');
		await page
			.getByLabel(/Catatan Tindak Lanjut/i)
			.fill('Petugas lapangan telah menyerahkan APD lengkap dan memastikan terpakai.');
		await page.getByRole('button', { name: /Simpan Tindak Lanjut/i }).click();
		await expect(page.getByTestId('action-status-badge')).toContainText(/Selesai/i);
		await expect(page.getByTestId('finding-version-badge')).toContainText('Versi #4');

		// Capture Findings detail screenshots at 1280x800 and 390x844
		await assertNoHorizontalOverflow(page, 'findings-detail-1280x800');
		await page.screenshot({
			path: path.join(DEFAULT_CAPTURE_DIR, 'findings-1280x800.png'),
			fullPage: false
		});
		await page.setViewportSize({ width: 390, height: 844 });
		await assertNoHorizontalOverflow(page, 'findings-detail-390x844');
		await page.screenshot({
			path: path.join(DEFAULT_CAPTURE_DIR, 'findings-390x844.png'),
			fullPage: false
		});
		await page.setViewportSize({ width: 1280, height: 800 });

		// Navigate to /findings gallery and reject Finding #2 with required notes (version 1 -> 2)
		await primaryNav.getByRole('link', { name: /Temuan/i }).click();
		await expect(page).toHaveURL(/\/findings$/);
		await expect(page.getByTestId('findings-total-count')).toHaveText('2');

		await page.getByRole('link', { name: /Buka Temuan #2/i }).click();
		await expect(page).toHaveURL(/\/findings\/2$/);
		await page
			.getByLabel(/Catatan Verifikasi/i)
			.fill('Ditolak petugas: pekerja sedang berada di luar batas area wajib rompi.');
		await page.getByRole('button', { name: /Tolak Temuan/i }).click();
		await expect(page.getByTestId('verification-status-badge')).toContainText(/Ditolak/i);
		await expect(page.getByTestId('finding-version-badge')).toContainText('Versi #2');

		// 6. Navigate to /reports, select eligible closed session #1, create explicit TEMPLATE draft,
		//    edit title & narrative, human-acknowledge review, approve, and verify source/report lock
		await primaryNav.getByRole('link', { name: /Laporan/i }).click();
		await expect(page).toHaveURL(/\/reports$/);
		await expect(page.getByRole('heading', { name: /Laporan Inspeksi K3/i })).toBeVisible();

		await page.getByTestId('create-session-select').selectOption('1');
		await expect(page.getByTestId('session-eligibility-status')).toHaveAttribute(
			'data-eligible',
			'true'
		);

		await page.getByRole('radio', { name: /Draft Template Terstruktur/i }).check();
		await page.getByTestId('submit-create-template').click();

		await expect(page).toHaveURL(/\/reports\/1$/);
		await expect(page.getByTestId('report-status-badge')).toContainText(/Draft/i);
		await expect(page.getByTestId('report-provenance-badge')).toContainText(
			/Provenance: TEMPLATE/i
		);
		await expect(page.getByTestId('report-fresh-badge')).toBeVisible();
		await expect(page.getByTestId('report-version-badge')).toContainText('Versi #1');

		// Verify historical source snapshot includes confirmed Finding #1 ([F-1]) and excludes rejected Finding #2
		await expect(page.getByTestId('report-snapshot-section')).toContainText(projectName);
		await expect(page.getByTestId('report-snapshot-section')).toContainText(zoneName);
		await expect(page.getByTestId('snapshot-finding-1')).toContainText('[F-1]');
		await expect(page.getByTestId('snapshot-finding-2')).toHaveCount(0);

		// Edit report title and plain-text narrative (version 1 -> 2)
		const approvedTitle = 'Laporan Inspeksi Sesi S-1 Zona Perancah Lantai 3 (Disetujui)';
		const approvedContent =
			'Proyek: Proyek Gedung Utama P0-07\nZona: Zona Perancah Lantai 3\n\nRingkasan: 1 temuan terkonfirmasi [F-1] telah ditindaklanjuti selesai di lapangan.';
		await page.getByLabel(/Judul Laporan/i).fill(approvedTitle);
		await page.getByLabel(/^Isi Narasi Laporan/i).fill(approvedContent);
		await page.getByTestId('save-report-narrative-btn').click();
		await expect(page.getByTestId('report-version-badge')).toContainText('Versi #2');

		// Human review acknowledgement & approval (version 2 -> 3)
		await page.getByTestId('review-acknowledged-checkbox').check();
		await page.getByTestId('approve-report-btn').click();

		await expect(page.getByTestId('report-status-badge')).toContainText(/Disetujui/i);
		await expect(page.getByTestId('approved-report-locked-banner')).toBeVisible();
		await expect(page.getByTestId('approved-readonly-view')).toBeVisible();
		await expect(page.getByTestId('approved-report-title')).toHaveText(approvedTitle);
		await expect(page.getByTestId('report-version-badge')).toContainText('Versi #3');

		// Capture Reports screenshots at 1280x800 and 390x844
		await assertNoHorizontalOverflow(page, 'reports-detail-1280x800');
		await page.screenshot({
			path: path.join(DEFAULT_CAPTURE_DIR, 'reports-1280x800.png'),
			fullPage: false
		});
		await page.setViewportSize({ width: 390, height: 844 });
		await assertNoHorizontalOverflow(page, 'reports-detail-390x844');
		await page.screenshot({
			path: path.join(DEFAULT_CAPTURE_DIR, 'reports-390x844.png'),
			fullPage: false
		});
		await page.setViewportSize({ width: 1280, height: 800 });

		// Verify source finding lock via the report snapshot link -> /findings/1
		await page.getByTestId('snapshot-finding-link-1').click();
		await expect(page).toHaveURL(/\/findings\/1$/);
		await page
			.getByLabel(/Catatan Verifikasi/i)
			.fill('Percobaan mengubah temuan setelah laporan disetujui');
		await page.getByRole('button', { name: /Simpan Kategori \/ Catatan Saja/i }).click();
		await expect(page.getByTestId('finding-mutation-error')).toHaveAttribute(
			'data-error-code',
			'REPORT_LOCKED'
		);
		await expect(page.getByTestId('approved-report-lock-banner')).toBeVisible();

		// 7. Navigate to Dashboard ('/') and verify mode separation (real = 0, simulated = 1 session, 1 confirmed, 1 rejected, 0 open actions)
		await primaryNav.getByRole('link', { name: /^Dashboard$/i }).click();
		await expect(page).toHaveURL(/\/$/);

		// Default mode is 'real' -> simulated session & findings must NOT appear in real totals
		await expect(page.getByLabel(/Mode Data/i)).toHaveValue('real');
		await expect(page.getByTestId('metric-sessions')).toHaveText('0');
		await expect(page.getByTestId('metric-findings-pending')).toHaveText('0');
		await expect(page.getByTestId('metric-findings-confirmed')).toHaveText('0');
		await expect(page.getByTestId('metric-findings-rejected')).toHaveText('0');
		await expect(page.getByTestId('metric-actions-open')).toHaveText('0');

		// Switch Mode Data to 'simulated' -> shows exact persisted simulated totals
		await page.getByLabel(/Mode Data/i).selectOption('simulated');
		await expect(page.getByTestId('metric-sessions')).toHaveText('1');
		await expect(page.getByTestId('metric-findings-pending')).toHaveText('0');
		await expect(page.getByTestId('metric-findings-confirmed')).toHaveText('1');
		await expect(page.getByTestId('metric-findings-rejected')).toHaveText('1');
		await expect(page.getByTestId('metric-actions-open')).toHaveText('0');

		// Capture Dashboard screenshots at 1280x800 and 390x844
		await assertNoHorizontalOverflow(page, 'dashboard-1280x800');
		await page.screenshot({
			path: path.join(DEFAULT_CAPTURE_DIR, 'dashboard-1280x800.png'),
			fullPage: false
		});
		await page.setViewportSize({ width: 390, height: 844 });
		await assertNoHorizontalOverflow(page, 'dashboard-390x844');
		await page.screenshot({
			path: path.join(DEFAULT_CAPTURE_DIR, 'dashboard-390x844.png'),
			fullPage: false
		});
		await page.setViewportSize({ width: 1280, height: 800 });

		// 8. Restart the Go backend process against the same disposable SQLite DB & evidence directory,
		//    reload the browser, and verify persistence through UI and public HTTP API (NO DB side channel!)
		await stack.restartBackend();

		await page.reload();
		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByTestId('officer-identity')).toContainText('Petugas: Anisa');

		await page.getByLabel(/Mode Data/i).selectOption('simulated');
		await expect(page.getByTestId('metric-sessions')).toHaveText('1');
		await expect(page.getByTestId('metric-findings-confirmed')).toHaveText('1');
		await expect(page.getByTestId('metric-findings-rejected')).toHaveText('1');

		// Verify persisted finding & original evidence bytes survive Go backend restart
		await primaryNav.getByRole('link', { name: /Temuan/i }).click();
		await expect(page).toHaveURL(/\/findings$/);
		await expect(page.getByTestId('findings-total-count')).toHaveText('2');
		await page.getByRole('link', { name: /Buka Temuan #1/i }).click();
		await expect(page).toHaveURL(/\/findings\/1$/);
		await expect(page.getByTestId('verification-status-badge')).toContainText(/Terkonfirmasi/i);
		await expect(page.getByTestId('action-status-badge')).toContainText(/Selesai/i);
		await expect(page.getByTestId('finding-version-badge')).toContainText('Versi #4');

		const postRestartEvidenceSha256 = await page.evaluate(async () => {
			const res = await fetch('/api/v1/findings/1/evidence', { credentials: 'same-origin' });
			if (res.status !== 200) return `HTTP_${res.status}`;
			const buf = await res.arrayBuffer();
			const hashBuf = await crypto.subtle.digest('SHA-256', buf);
			return Array.from(new Uint8Array(hashBuf))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
		});
		expect(postRestartEvidenceSha256).toBe(triggeringFrame!.computedSha256);

		// Verify persisted approved report & snapshot survive Go backend restart
		await primaryNav.getByRole('link', { name: /Laporan/i }).click();
		await expect(page).toHaveURL(/\/reports$/);
		await expect(page.getByTestId('reports-total-count')).toHaveText('1');
		await page.getByTestId('report-card-1').getByRole('link', { name: /Buka Laporan/i }).click();
		await expect(page).toHaveURL(/\/reports\/1$/);
		await expect(page.getByTestId('report-status-badge')).toContainText(/Disetujui/i);
		await expect(page.getByTestId('approved-report-title')).toHaveText(approvedTitle);
		await expect(page.getByTestId('snapshot-finding-1')).toContainText('[F-1]');

		// Write machine-readable acceptance summary to the untracked capture directory for documentation
		fs.writeFileSync(
			path.join(DEFAULT_CAPTURE_DIR, 'journey-evidence-summary.json'),
			JSON.stringify(
				{
					mode: 'simulated',
					modelVersion: 'ppe-sim-fixture-v1',
					engineInstanceId: 'eng-sim-fixture-p0-07',
					triggeringFrameSequence: triggeringFrame!.frameSequence,
					triggeringJpegWidth: triggeringFrame!.width,
					triggeringJpegHeight: triggeringFrame!.height,
					triggeringJpegByteLength: triggeringFrame!.jpegBytes.length,
					triggeringJpegSha256: triggeringFrame!.computedSha256,
					storedEvidenceSha256,
					postRestartEvidenceSha256,
					monitoringDesktopScreenshotSha256,
					observedRequestIds
				},
				null,
				2
			)
		);
	});

	test('phone responsive adaptation across 320, 375, 390, 430, landscape 844x390, and desktop 1280 with touch emulation and long populated content', async ({
		browser
	}) => {
		test.setTimeout(120_000);
		const capturePhase = process.env.TEST_PHONE_CAPTURE_PHASE ?? 'after';
		const phoneCaptureDir = path.join(frontendDir, 'test-results', 'phone-responsive', capturePhase);
		fs.mkdirSync(phoneCaptureDir, { recursive: true });

		const context = await browser.newContext({
			viewport: { width: 390, height: 844 },
			hasTouch: true,
			isMobile: true
		});
		const page = await context.newPage();
		await installFakeCamera(page);

		const auditResults: Array<{
			route: string;
			viewport: string;
			scrollWidth: number;
			clientWidth: number;
			overflowPx: number;
			smallTouchTargets: string[];
			smallFormFonts: string[];
			outOfBoundsControls: string[];
		}> = [];

		async function auditViewport(
			routeLabel: string,
			width: number,
			height: number,
			screenshotSlug?: string
		) {
			await page.setViewportSize({ width, height });
			const vpLabel = `${width}x${height}`;
			const res = await page.evaluate(() => {
				const vw = document.documentElement.clientWidth;
				const sw = document.documentElement.scrollWidth;
				const isPhone = vw <= 480;

				const smallTouchTargets: string[] = [];
				const smallFormFonts: string[] = [];
				const outOfBoundsControls: string[] = [];

				const controls = Array.from(
					document.querySelectorAll<HTMLElement>(
						'button:not([disabled]), nav[aria-label="Navigasi utama"] a, input:not([type="hidden"]), select, textarea, .open-detail-link, .action-link, .secondary-link'
					)
				);

				for (const el of controls) {
					const style = window.getComputedStyle(el);
					if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
						continue;
					}
					const rect = el.getBoundingClientRect();
					if (rect.width === 0 || rect.height === 0) continue;

					const label = (
						el.getAttribute('aria-label') ||
						el.getAttribute('data-testid') ||
						el.id ||
						el.textContent?.trim().slice(0, 32) ||
						el.tagName
					).replace(/\s+/g, ' ');

					if (rect.left < -1 || rect.right > vw + 1) {
						outOfBoundsControls.push(
							`${el.tagName.toLowerCase()}[${label}](left=${Math.round(rect.left)},right=${Math.round(rect.right)},vw=${vw})`
						);
					}

					const tag = el.tagName.toLowerCase();
					const type = (el as HTMLInputElement).type?.toLowerCase();
					const isCheckboxOrRadio =
						tag === 'input' && (type === 'checkbox' || type === 'radio');

					if (isPhone && !isCheckboxOrRadio && rect.height < 43.5) {
						smallTouchTargets.push(
							`${tag}[${label}](h=${Math.round(rect.height * 10) / 10}px,w=${Math.round(rect.width)}px)`
						);
					}

					if (
						isPhone &&
						(tag === 'input' || tag === 'select' || tag === 'textarea') &&
						!isCheckboxOrRadio
					) {
						const fontSize = parseFloat(style.fontSize);
						if (fontSize < 15.9) {
							smallFormFonts.push(`${tag}[${label}](font=${fontSize}px)`);
						}
					}
				}

				return {
					scrollWidth: sw,
					clientWidth: vw,
					overflowPx: Math.max(0, sw - vw),
					smallTouchTargets,
					smallFormFonts,
					outOfBoundsControls
				};
			});

			auditResults.push({
				route: routeLabel,
				viewport: vpLabel,
				...res
			});

			if (screenshotSlug) {
				await page.screenshot({
					path: path.join(phoneCaptureDir, `${screenshotSlug}-${vpLabel}.png`),
					fullPage: false
				});
			}

			return res;
		}

		try {
			// 1. Login page at 320, 375, 390, 430
			await page.goto(`${stack.baseUrl}/login`);
			await expect(page.getByRole('heading', { name: /Masuk Petugas K3/i })).toBeVisible();
			for (const w of [320, 375, 390, 430]) {
				await auditViewport('/login', w, 844, w === 320 || w === 390 ? 'login' : undefined);
			}

			// Real touch tap login at 320x568
			await page.setViewportSize({ width: 320, height: 568 });
			await page.getByLabel(/Username/i).tap();
			await page.getByLabel(/Username/i).fill(TEST_USERNAME);
			await page.getByLabel(/Password/i).tap();
			await page.getByLabel(/Password/i).fill(TEST_PASSWORD);
			await page.getByRole('button', { name: /Masuk/i }).tap();

			await expect(page).toHaveURL(/\/$/);
			await expect(page.getByTestId('officer-identity')).toContainText('Petugas: Anisa');

			// 2. Dashboard at 320, 375, 390, 430, 844x390 landscape, 1280x800 desktop
			await page.getByLabel(/Mode Data/i).selectOption('simulated');
			await expect(page.getByTestId('metric-sessions')).toHaveText('1');
			for (const [w, h] of [
				[320, 568],
				[375, 812],
				[390, 844],
				[430, 932],
				[844, 390],
				[1280, 800]
			] as const) {
				await auditViewport(
					'/',
					w,
					h,
					w === 320 || w === 390 || w === 844 || w === 1280 ? 'dashboard' : undefined
				);
			}

			// 3. Tap primary nav to /projects, create a project with a long valid name & location, test inline edit
			await page.setViewportSize({ width: 320, height: 568 });
			const primaryNav = page.getByRole('navigation', { name: /Navigasi utama/i });
			await primaryNav.getByRole('link', { name: /Proyek & Zona/i }).tap();
			await expect(page).toHaveURL(/\/projects$/);

			const longProjectName =
				'Proyek Pembangunan Struktur Menara Terpadu Sektor Timur Blok K3-konstruksi-panjang-sekali-2026';
			const longLocation =
				'Kawasan Industri Terpadu Koridor SelatanKavling108B-TanpaSpasiPanjangSekali, Malang, Jawa Timur';
			await page.getByLabel(/^Nama Proyek/i).fill(longProjectName);
			await page.getByLabel(/Lokasi/i).fill(longLocation);
			await page
				.getByLabel(/Deskripsi Proyek/i)
				.fill(
					'Deskripsi panjang untuk pengujian pembungkusan teks pada kartu proyek di layar ponsel sempit 320px beserta token_identitas_panjang_tanpa_spasi_1234567890abcdef.'
				);
			await page.getByRole('button', { name: /Tambah Proyek/i }).tap();

			const longProjCard = page.locator('[data-testid="project-item"]', {
				hasText: longProjectName
			});
			await expect(longProjCard).toBeVisible();

			// Open inline edit on the project card to audit the edit form on phone widths
			await longProjCard.getByRole('button', { name: /^Edit$/i }).tap();
			await expect(
				longProjCard.getByRole('button', { name: /Simpan Perubahan Proyek/i })
			).toBeVisible();

			for (const [w, h] of [
				[320, 568],
				[375, 812],
				[390, 844],
				[430, 932]
			] as const) {
				await auditViewport('/projects', w, h, w === 320 || w === 390 ? 'projects' : undefined);
			}
			await page.setViewportSize({ width: 320, height: 568 });
			await longProjCard.getByRole('button', { name: /^Batal$/i }).click();

			// 4. Open /projects/[id] detail & zone forms with long zone name
			const firstProjCard = page.locator('[data-testid="project-item"]').first();
			await firstProjCard.getByRole('link', { name: /Kelola Zona & Detail/i }).click();
			await expect(page).toHaveURL(/\/projects\/\d+$/);

			const longZoneName =
				'Zona Perancah Eksterior Sisi Utara Koridor-Utama-Lantai-04-Sektor-Inspeksi-APD';
			await page.getByLabel(/^Nama Zona/i).fill(longZoneName);
			await page
				.getByLabel(/Deskripsi Zona/i)
				.fill(
					'Area pengamatan perancah dengan jalur akses sempit dan pemeriksaan helm/rompi berkala.'
				);
			await page.getByRole('button', { name: /Tambah Zona/i }).click();
			const longZoneCard = page.locator('[data-testid="zone-item"]', { hasText: longZoneName });
			await expect(longZoneCard).toBeVisible();

			await longZoneCard.getByRole('button', { name: /Edit Zona/i }).click();
			await expect(
				longZoneCard.getByRole('button', { name: /Simpan Perubahan Zona/i })
			).toBeVisible();
			for (const [w, h] of [
				[320, 568],
				[375, 812],
				[390, 844],
				[430, 932]
			] as const) {
				await auditViewport(
					'/projects/[id]',
					w,
					h,
					w === 320 || w === 390 ? 'project-detail' : undefined
				);
			}
			await page.setViewportSize({ width: 320, height: 568 });
			await longZoneCard.getByRole('button', { name: /^Batal$/i }).click();

			// 5. Navigate via touch to /monitoring, verify selectors, live video, snapshot overlay, capture cards, and session history on phone
			await page.setViewportSize({ width: 320, height: 568 });
			await page.evaluate(() => window.scrollTo(0, 0));
			await primaryNav.getByRole('link', { name: /Monitoring/i }).tap();
			await expect(page).toHaveURL(/\/monitoring$/);
			// Select Project #1 and Zone #1 so session history is visible and we can start a live session on phone
			await page.getByLabel(/Proyek Aktif/i).selectOption('1');
			await expect(page.getByTestId('session-history-list')).toBeVisible();
			await page.getByLabel(/Zona Inspeksi Aktif/i).selectOption('1');

			// Start live monitoring session on phone to audit live video + SnapshotOverlay + captured finding cards
			await page.getByTestId('start-monitoring-btn').tap();
			await expect(page.getByTestId('active-session-badge')).toContainText('active', {
				timeout: 15_000
			});
			await expect(page.getByTestId('captured-events-list')).toBeVisible({ timeout: 25_000 });

			for (const [w, h] of [
				[320, 568],
				[375, 812],
				[390, 844],
				[430, 932],
				[844, 390]
			] as const) {
				await auditViewport(
					'/monitoring',
					w,
					h,
					w === 320 || w === 390 || w === 844 ? 'monitoring-active' : undefined
				);
			}

			await page.setViewportSize({ width: 320, height: 568 });
			await page.getByTestId('stop-monitoring-btn').tap();
			await expect(page.getByTestId('monitoring-status-banner')).toContainText('dihentikan', {
				timeout: 10_000
			});

			// 6. Navigate via touch to /findings gallery + expand manual form
			await page.setViewportSize({ width: 320, height: 568 });
			await page.evaluate(() => window.scrollTo(0, 0));
			await primaryNav.getByRole('link', { name: /Temuan/i }).tap();
			await expect(page).toHaveURL(/\/findings$/);
			await expect(page.getByTestId('finding-card-1')).toBeVisible();
			await expect(page.getByTestId('finding-card-2')).toBeVisible();

			// Expand ManualFindingForm to verify manual form responsiveness too
			await page.getByRole('button', { name: /Tambah Temuan Manual/i }).tap();
			await expect(page.getByLabel(/Jenis Indikasi APD/i)).toBeVisible();

			for (const [w, h] of [
				[320, 568],
				[375, 812],
				[390, 844],
				[430, 932],
				[844, 390],
				[1280, 800]
			] as const) {
				await auditViewport(
					'/findings',
					w,
					h,
					w === 320 || w === 390 || w === 1280 ? 'findings-gallery' : undefined
				);
			}

			// 7. Open /findings/1 detail & test full-image modal on phone 320px and 390px, and confirm the new session #2 finding for draft report testing
			await page.setViewportSize({ width: 320, height: 568 });
			await page.getByRole('link', { name: /Buka Temuan #1/i }).tap();
			await expect(page).toHaveURL(/\/findings\/1$/);
			await expect(page.getByTestId('finding-evidence-img')).toBeVisible();

			for (const [w, h] of [
				[320, 568],
				[375, 812],
				[390, 844],
				[430, 932]
			] as const) {
				await auditViewport(
					'/findings/1',
					w,
					h,
					w === 320 || w === 390 ? 'finding-detail' : undefined
				);
			}

			// Open full-image modal on 320x568, verify dialog bounds and close button
			await page.setViewportSize({ width: 320, height: 568 });
			await page.getByRole('button', { name: /Perbesar Bukti/i }).tap();
			const modalDialog = page.getByRole('dialog', { name: /Pratinjau Penuh Foto Bukti/i });
			await expect(modalDialog).toBeVisible();
			await auditViewport('/findings/1#modal', 320, 568, 'finding-modal');
			await auditViewport('/findings/1#modal', 844, 390, 'finding-modal-landscape');
			await page.setViewportSize({ width: 320, height: 568 });
			await modalDialog.getByRole('button', { name: /Tutup Pratinjau/i }).tap();
			await expect(modalDialog).toBeHidden();

			// Also confirm finding #3 (from session #2) via touch so session #2 is eligible for a draft report
			await page.goto(`${stack.baseUrl}/findings/3`);
			await expect(page.getByTestId('finding-evidence-img')).toBeVisible();
			await page
				.getByLabel(/Catatan Verifikasi/i)
				.fill('Dikonfirmasi melalui layar ponsel 320px untuk pembuatan draft laporan sesi ke-2.');
			await page.getByRole('button', { name: /Konfirmasi Temuan/i }).tap();
			await expect(page.getByTestId('verification-status-badge')).toContainText('Terkonfirmasi');

			// 8. Navigate via touch to /reports list + create form (including manual report inputs & gemini info)
			await page.evaluate(() => window.scrollTo(0, 0));
			await primaryNav.getByRole('link', { name: /Laporan/i }).tap();
			await expect(page).toHaveURL(/\/reports$/);
			await expect(page.getByTestId('report-card-1')).toBeVisible();

			// Switch to manual mode to expose manual title/content inputs
			await page.getByRole('radio', { name: /Draft Tulis Manual Petugas/i }).check();
			await expect(page.getByTestId('manual-report-inputs')).toBeVisible();

			for (const [w, h] of [
				[320, 568],
				[375, 812],
				[390, 844],
				[430, 932]
			] as const) {
				await auditViewport('/reports', w, h, w === 320 || w === 390 ? 'reports-list' : undefined);
			}

			// Switch to gemini mode to audit long request_key / info box
			await page.getByRole('radio', { name: /Generasi Narasi Gemini Backend/i }).check();
			await auditViewport('/reports#gemini', 320, 568);

			// Create a draft report on phone for Session #2 to also audit /reports/[id] draft editor + regenerate dialog + approval form
			await page.getByRole('radio', { name: /Draft Template Terstruktur/i }).check();
			await page.getByTestId('create-session-select').selectOption('2');
			await page.getByTestId('submit-create-template').tap();
			await expect(page).toHaveURL(/\/reports\/\d+$/);
			await expect(page.getByTestId('save-report-narrative-btn')).toBeVisible();
			// Open regenerate confirmation dialog on phone to audit its bounds too
			await page.getByTestId('open-regenerate-confirm-btn').tap();
			await expect(page.getByTestId('regenerate-confirm-dialog')).toBeVisible();
			await auditViewport('/reports/draft', 320, 568, 'report-draft');
			await auditViewport('/reports/draft', 390, 844, 'report-draft');

			// Go back to /reports and open /reports/1 (approved state with SHA-256 source_hash and snapshot findings)
			await page.evaluate(() => window.scrollTo(0, 0));
			await primaryNav.getByRole('link', { name: /Laporan/i }).tap();
			await expect(page).toHaveURL(/\/reports$/);
			await page.getByTestId('open-report-link-1').tap();
			await expect(page).toHaveURL(/\/reports\/1$/);
			await expect(page.getByTestId('detail-source-hash')).toBeVisible();

			for (const [w, h] of [
				[320, 568],
				[375, 812],
				[390, 844],
				[430, 932],
				[844, 390],
				[1280, 800]
			] as const) {
				await auditViewport(
					'/reports/1',
					w,
					h,
					w === 320 || w === 390 || w === 1280 ? 'report-detail' : undefined
				);
			}

			// Assertions: every audited route/viewport must have zero horizontal overflow,
			// no out-of-bounds controls, >=44px touch targets on phone, and >=16px form inputs on phone
			const overflows = auditResults.filter((r) => r.overflowPx > 0);
			const outOfBounds = auditResults.filter((r) => r.outOfBoundsControls.length > 0);
			const smallTouches = auditResults.filter((r) => r.smallTouchTargets.length > 0);
			const smallFonts = auditResults.filter((r) => r.smallFormFonts.length > 0);

			expect(overflows, `Horizontal overflows found: ${JSON.stringify(overflows)}`).toEqual([]);
			expect(outOfBounds, `Out-of-bounds controls found: ${JSON.stringify(outOfBounds)}`).toEqual(
				[]
			);
			expect(
				smallTouches,
				`Touch targets < 44px on phone: ${JSON.stringify(smallTouches.map((s) => ({ route: s.route, vp: s.viewport, items: s.smallTouchTargets })))}`
			).toEqual([]);
			expect(
				smallFonts,
				`Form inputs < 16px on phone: ${JSON.stringify(smallFonts.map((s) => ({ route: s.route, vp: s.viewport, items: s.smallFormFonts })))}`
			).toEqual([]);
		} finally {
			fs.writeFileSync(
				path.join(phoneCaptureDir, 'responsive-audit.json'),
				JSON.stringify(auditResults, null, 2)
			);
			try {
				await context.close();
			} catch {
				// ignore if already closed on timeout
			}
		}
	});
});

