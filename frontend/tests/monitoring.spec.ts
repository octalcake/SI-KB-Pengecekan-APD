import { expect, test, type Page } from '@playwright/test';
import {
	classifyMonitoringError,
	computeAspectPreservingSize,
	createMonitoringApi,
	scaleNormalizedBBox,
	shouldStopSamplingOnError
} from '../src/lib/monitoring/api';
import {
	createCaptureLoop,
	DEFAULT_CAMERA_CONSTRAINTS
} from '../src/lib/monitoring/capture';

const TEST_USERNAME = process.env.TEST_SEED_USERNAME ?? 'petugas';
const TEST_PASSWORD = process.env.TEST_SEED_PASSWORD ?? 'K3-Disp0sable-Test-Pass!2026';

async function installFakeCamera(page: Page) {
	await page.addInitScript(() => {
		const w = window as unknown as {
			__fakeCameraCalls: MediaStreamConstraints[];
			__fakeTracksStopped: number;
			__triggerCameraEnded: () => void;
		};
		w.__fakeCameraCalls = [];
		w.__fakeTracksStopped = 0;

		let activeCanvasInterval: ReturnType<typeof setInterval> | null = null;
		let activeVideoTrack: MediaStreamTrack | null = null;

		w.__triggerCameraEnded = () => {
			if (activeVideoTrack) {
				activeVideoTrack.dispatchEvent(new Event('ended'));
			}
		};

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
					ctx.fillStyle = '#1e293b';
					ctx.fillRect(0, 0, 640, 480);
					ctx.fillStyle = '#ea580c';
					ctx.fillRect(140, 60, 220, 360);
					ctx.fillStyle = '#ffffff';
					ctx.font = '20px sans-serif';
					ctx.fillText(`K3 Fake Camera Frame ${tick}`, 24, 40);
				};
				drawFrame();
				activeCanvasInterval = setInterval(drawFrame, 100);

				const stream = canvas.captureStream(10);
				for (const track of stream.getTracks()) {
					activeVideoTrack = track;
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

async function loginAndPrepareProjectZone(page: Page) {
	await page.goto('/');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('heading', { name: /Masuk Petugas K3/i })).toBeVisible();
	await page.getByLabel(/Username/i).fill(TEST_USERNAME);
	await page.getByLabel(/Password/i).fill(TEST_PASSWORD);
	await page.getByRole('button', { name: /Masuk/i }).click();
	await expect(page).toHaveURL(/\/$/);

	// Create an active project and zone through real Go API using the authenticated session CSRF token
	await page.evaluate(async () => {
		const meRes = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
		const meJson = await meRes.json();
		const csrf = meJson.data.csrf_token as string;

		const projRes = await fetch('/api/v1/projects', {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'X-CSRF-Token': csrf
			},
			body: JSON.stringify({
				name: 'Proyek Gedung Utama K3',
				location: 'Malang',
				description: 'Proyek uji integrasi monitoring'
			})
		});
		const projJson = await projRes.json();
		const projectId = projJson.data.id as number;

		await fetch(`/api/v1/projects/${projectId}/zones`, {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'X-CSRF-Token': csrf
			},
			body: JSON.stringify({
				name: 'Area Struktur Lantai 2',
				description: 'Zona pengamatan kamera'
			})
		});
	});
}

test('contract helper assertions: aspect-preserving 640x480 sizing, bbox scaling, API headers, and single-in-flight loop', async () => {
	expect(computeAspectPreservingSize(1280, 720, 640, 480)).toEqual({
		width: 640,
		height: 360
	});
	expect(computeAspectPreservingSize(480, 960, 640, 480)).toEqual({
		width: 240,
		height: 480
	});

	const scaled = scaleNormalizedBBox([0.2, 0.1, 0.6, 0.95], 640, 480);
	expect(Math.round(scaled.left)).toBe(128);
	expect(Math.round(scaled.top)).toBe(48);
	expect(Math.round(scaled.width)).toBe(256);
	expect(Math.round(scaled.height)).toBe(408);

	expect(DEFAULT_CAMERA_CONSTRAINTS).toEqual({
		video: { width: { ideal: 640 }, height: { ideal: 480 } },
		audio: false
	});

	const calls: Array<{ path: string; options: Record<string, unknown> }> = [];
	const api = createMonitoringApi({
		async apiData<T>(path: string, options: Record<string, unknown> = {}) {
			calls.push({ path, options });
			return {} as T;
		},
		async apiList<T>(path: string, options: Record<string, unknown> = {}) {
			calls.push({ path, options });
			return { data: [] as T[], meta: { page: 1, page_size: 20, total: 0 } };
		}
	});

	const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
	await api.sendFrame({
		sessionId: 15,
		sequence: 3,
		capturedAtUtc: '2026-11-11T02:15:22.000Z',
		sampleElapsedMs: 2000,
		jpeg: bytes
	});
	expect(calls[0]?.path).toBe('/monitoring/sessions/15/frames');
	expect(calls[0]?.options.headers).toEqual({
		'Content-Type': 'image/jpeg',
		'X-Frame-Sequence': '3',
		'X-Captured-At': '2026-11-11T02:15:22.000Z',
		'X-Sample-Elapsed-Ms': '2000'
	});

	const errReset = classifyMonitoringError({
		status: 503,
		code: 'TRACKER_RESET',
		message: 'Tracker direset'
	});
	expect(shouldStopSamplingOnError(errReset)).toBe(true);

	const errRate = classifyMonitoringError({
		status: 429,
		code: 'FRAME_TOO_FAST',
		message: 'Terlalu cepat',
		retryAfter: 2
	});
	expect(shouldStopSamplingOnError(errRate)).toBe(false);
	expect(errRate.retryAfterSec).toBe(2);

	// Verify single-in-flight without queue
	let inFlight = 0;
	let releaseFirstFrame: (() => void) | null = null;
	const sentSeqs: number[] = [];
	const loop = createCaptureLoop({
		sessionId: 10,
		stream: null,
		nowMonotonicMs: () => 1000,
		nowUtcIso: () => '2026-11-11T02:15:22.000Z',
		sampleJpeg: async () => ({
			blob: new Blob([bytes], { type: 'image/jpeg' }),
			width: 640,
			height: 480,
			objectUrl: ''
		}),
		sendFrame: async (input) => {
			inFlight += 1;
			sentSeqs.push(input.sequence);
			await new Promise<void>((r) => {
				releaseFirstFrame = r;
			});
			inFlight -= 1;
			return {
				session_id: 10,
				frame_sequence: input.sequence,
				captured_at: input.capturedAtUtc,
				received_at: input.capturedAtUtc,
				width: 640,
				height: 480,
				inference_ms: 50,
				model_version: 'ppe-demo-v1',
				mode: 'real',
				tracks: [],
				events: []
			};
		},
		stopSession: async () => ({})
	});

	const p1 = loop.tick();
	await new Promise((r) => setTimeout(r, 15));
	expect(inFlight).toBe(1);

	const p2 = await loop.tick();
	expect(p2.skippedBusy).toBe(true);
	expect(loop.getState().skippedBusyTicks).toBe(1);

	releaseFirstFrame!();
	await p1;
	expect(sentSeqs).toEqual([1]);
});

test('browser /monitoring journey: real Go project/zone lookup, truthful 503 AI_UNAVAILABLE camera release, labeled fixture frame/overlay/finding links, and lifecycle stops', async ({
	page
}) => {
	await installFakeCamera(page);
	await loginAndPrepareProjectZone(page);

	const monitoringNavLink = page
		.getByRole('navigation', { name: /Navigasi utama/i })
		.getByRole('link', { name: 'Monitoring' });
	await expect(monitoringNavLink).toHaveAttribute('href', '/monitoring');
	await monitoringNavLink.click();
	await expect(page).toHaveURL(/\/monitoring$/);
	await expect(monitoringNavLink).toHaveAttribute('aria-current', 'page');
	await expect(page.getByRole('heading', { name: /Monitoring Kamera & Sesi Inspeksi/i })).toBeVisible();

	// 1. Verify persisted project & zone choices loaded from real Go SQLite
	const projectSelect = page.getByLabel(/Proyek Aktif/i);
	const zoneSelect = page.getByLabel(/Zona Inspeksi Aktif/i);
	await expect(projectSelect).toContainText('Proyek Gedung Utama K3');
	await expect(zoneSelect).toContainText('Area Struktur Lantai 2');

	// 2. Verify actual server readiness (Go reports mode=real, ai_ready=false because Python /internal/v1/* is unimplemented)
	await expect(page.getByTestId('monitoring-mode-value')).toHaveText('NYATA');
	await expect(page.getByTestId('ai-not-ready-banner')).toBeVisible();
	await expect(page.getByTestId('ai-not-ready-banner')).toContainText(/AI_UNAVAILABLE/i);

	// 3. Click "Mulai Monitoring" against real unchanged Go backend:
	//    - Requests video-only getUserMedia (audio: false)
	//    - Go returns 503 AI_UNAVAILABLE because Python inference endpoints do not exist
	//    - Frontend truthfully shows AI_UNAVAILABLE, releases camera track immediately, and never switches to simulation
	await page.getByTestId('start-monitoring-btn').click();

	const errorAlert = page.getByTestId('monitoring-error-alert');
	await expect(errorAlert).toBeVisible();
	await expect(errorAlert).toHaveAttribute('data-error-code', 'AI_UNAVAILABLE');
	await expect(errorAlert).toContainText(/Layanan AI Tidak Tersedia/i);
	await expect(page.getByTestId('monitoring-mode-value')).toHaveText('NYATA');
	await expect(page.getByTestId('simulated-mode-banner')).toHaveCount(0);

	const cameraStateAfter503 = await page.evaluate(() => {
		const w = window as unknown as {
			__fakeCameraCalls: MediaStreamConstraints[];
			__fakeTracksStopped: number;
		};
		return {
			calls: w.__fakeCameraCalls,
			stopped: w.__fakeTracksStopped
		};
	});
	expect(cameraStateAfter503.calls.length).toBe(1);
	expect(cameraStateAfter503.calls[0]?.audio).toBe(false);
	expect(cameraStateAfter503.stopped).toBeGreaterThanOrEqual(1);

	// 4. Test CAMERA_BUSY (409) recovery state when another global session is active
	await page.route('/api/v1/monitoring/sessions', async (route) => {
		if (route.request().method() === 'POST') {
			await route.fulfill({
				status: 409,
				contentType: 'application/json',
				body: JSON.stringify({
					error: {
						code: 'CAMERA_BUSY',
						message: 'Sudah ada sesi monitoring aktif.',
						request_id: 'req-busy-409'
					}
				})
			});
			return;
		}
		await route.continue();
	});

	await page.getByTestId('start-monitoring-btn').click();
	await expect(errorAlert).toHaveAttribute('data-error-code', 'CAMERA_BUSY');
	await expect(errorAlert).toContainText(/Sesi Kamera Sedang Aktif/i);
	await expect(errorAlert).toContainText(/req-busy-409/i);
	await page.unroute('/api/v1/monitoring/sessions');

	// 5. Labeled test-only deterministic inference boundary to verify:
	//    - Binary JPEG frame transport + exact headers (X-Frame-Sequence, X-Captured-At, X-Sample-Elapsed-Ms, X-CSRF-Token)
	//    - Separate inferred JPEG snapshot with normalized [x_min,y_min,x_max,y_max] overlays (and NO boxes on live video)
	//    - Captured event item & link to /findings/{id}
	//    - Hidden-tab and explicit stop lifecycle cleanup
	const receivedFrames: Array<{
		contentType: string | null;
		csrf: string | null;
		sequence: string | null;
		capturedAt: string | null;
		elapsedMs: string | null;
		byteLength: number;
		hasJpegMagic: boolean;
	}> = [];
	const receivedStops: Array<{ reason: string }> = [];

	await page.route('/api/v1/monitoring/sessions', async (route) => {
		if (route.request().method() === 'POST') {
			await route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify({
					data: {
						id: 77,
						project_id: 1,
						zone_id: 1,
						started_by: 1,
						source: 'browser_webcam',
						status: 'active',
						mode: 'simulated',
						model_version: 'test-fixture-v1',
						supported_violations: ['NO_HELMET', 'NO_VEST'],
						started_at: '2026-11-11T02:15:00.000Z',
						ended_at: null,
						end_reason: null,
						last_frame_at: null,
						config: {
							sample_fps: 1,
							confirm_hits: 2,
							confirm_max_frames: 3,
							confirm_window_ms: 2000,
							track_timeout_ms: 5000,
							supported_violations: ['NO_HELMET', 'NO_VEST']
						}
					}
				})
			});
			return;
		}
		await route.continue();
	});

	await page.route('/api/v1/monitoring/sessions/77/frames', async (route) => {
		const req = route.request();
		const headers = req.headers();
		const postBuffer = req.postDataBuffer() ?? Buffer.alloc(0);
		receivedFrames.push({
			contentType: headers['content-type'] ?? null,
			csrf: headers['x-csrf-token'] ?? null,
			sequence: headers['x-frame-sequence'] ?? null,
			capturedAt: headers['x-captured-at'] ?? null,
			elapsedMs: headers['x-sample-elapsed-ms'] ?? null,
			byteLength: postBuffer.length,
			hasJpegMagic:
				postBuffer.length > 3 &&
				postBuffer[0] === 0xff &&
				postBuffer[1] === 0xd8 &&
				postBuffer[2] === 0xff
		});

		const seqNum = Number(headers['x-frame-sequence'] ?? '1');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				data: {
					session_id: 77,
					frame_sequence: seqNum,
					captured_at: headers['x-captured-at'] ?? '2026-11-11T02:15:22.000Z',
					received_at: '2026-11-11T02:15:22.020Z',
					width: 640,
					height: 480,
					inference_ms: 145,
					model_version: 'test-fixture-v1',
					mode: 'simulated',
					tracks: [
						{
							track_id: 17,
							track_key: '17:1',
							person_confidence: 0.93,
							person_bbox: [0.2, 0.1, 0.6, 0.95],
							observations: [
								{
									type: 'NO_HELMET',
									state: 'positive',
									confidence: 0.89,
									bbox: [0.31, 0.11, 0.45, 0.29]
								}
							]
						},
						{
							track_id: 21,
							track_key: '21:1',
							person_confidence: 0.91,
							person_bbox: [0.62, 0.12, 0.92, 0.94],
							observations: [
								{
									type: 'NO_VEST',
									state: 'positive',
									confidence: 0.87,
									bbox: [0.65, 0.35, 0.88, 0.72]
								}
							]
						}
					],
					events:
						seqNum === 1
							? [
									{
										type: 'finding_created',
										finding_id: 105,
										verification_status: 'pending',
										evidence_url: '/api/v1/findings/105/evidence'
									},
									{
										type: 'finding_created',
										finding_id: 106,
										verification_status: 'pending',
										evidence_url: '/api/v1/findings/106/evidence'
									}
								]
							: []
				}
			})
		});
	});

	// Protected evidence thumbnail endpoints for findings #105 (200 JPEG) and #106 (410 EVIDENCE_MISSING)
	const validJpegBuf = Buffer.from(
		'/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
		'base64'
	);
	await page.route('/api/v1/findings/105/evidence', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'image/jpeg',
			body: validJpegBuf
		});
	});
	await page.route('/api/v1/findings/106/evidence', async (route) => {
		await route.fulfill({
			status: 410,
			contentType: 'application/json',
			body: JSON.stringify({
				error: {
					code: 'EVIDENCE_MISSING',
					message: 'File bukti JPEG untuk temuan #106 tidak ditemukan di penyimpanan.',
					request_id: 'req-ev-410'
				}
			})
		});
	});

	await page.route('/api/v1/monitoring/sessions/77/stop', async (route) => {
		const body = route.request().postDataJSON() as { reason?: string };
		receivedStops.push({ reason: body?.reason ?? '' });
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				data: {
					id: 77,
					project_id: 1,
					zone_id: 1,
					started_by: 1,
					source: 'browser_webcam',
					status: 'stopped',
					mode: 'simulated',
					model_version: 'test-fixture-v1',
					supported_violations: ['NO_HELMET', 'NO_VEST'],
					started_at: '2026-11-11T02:15:00.000Z',
					ended_at: '2026-11-11T02:15:10.000Z',
					end_reason: body?.reason ?? 'user_stop',
					last_frame_at: '2026-11-11T02:15:02.000Z',
					config: {
						sample_fps: 1,
						confirm_hits: 2,
						confirm_max_frames: 3,
						confirm_window_ms: 2000,
						track_timeout_ms: 5000
					}
				}
			})
		});
	});

	await page.getByTestId('start-monitoring-btn').click();

	// Simulated provenance banner is visible and permanent during simulated session
	await expect(page.getByTestId('simulated-mode-banner')).toBeVisible();
	await expect(page.getByTestId('inference-snapshot-stage')).toBeVisible();
	await expect(page.getByTestId('snapshot-overlay-layer')).toBeVisible();

	// Verify live preview video container has NO bounding box overlay elements inside it
	const liveVideoOverlayCount = await page
		.locator('.video-container .bbox, .video-container .overlay-layer')
		.count();
	expect(liveVideoOverlayCount).toBe(0);

	// Verify normalized bbox overlay is rendered on the inferred JPEG snapshot stage for both tracks
	await expect(page.locator('[data-testid="snapshot-overlay-layer"] .person-bbox')).toHaveCount(2);
	await expect(page.locator('[data-testid="snapshot-overlay-layer"] .obs-bbox')).toHaveCount(2);
	await expect(page.getByTestId('snapshot-meta-bar')).toContainText('Sequence: #1');

	// Verify captured event cards (#105 and #106) do NOT guess unassociated trackKey or detectedViolation
	const card105 = page.getByTestId('captured-finding-105');
	const card106 = page.getByTestId('captured-finding-106');
	await expect(card105).toBeVisible();
	await expect(card106).toBeVisible();
	await expect(card105).toContainText('Temuan #105');
	await expect(card106).toContainText('Temuan #106');
	await expect(card105).not.toContainText('17:1');
	await expect(card106).not.toContainText('17:1');
	await expect(card106).not.toContainText('Tanpa Helm');

	// Verify protected evidence thumbnail states: #105 renders blob: image, #106 renders 410 EVIDENCE_MISSING error without placeholder photo
	const thumbImg105 = page.getByTestId('capture-thumb-img-105');
	await expect(thumbImg105).toBeVisible();
	await expect(thumbImg105).toHaveAttribute('src', /^blob:/);

	const thumbErr106 = page.getByTestId('capture-thumb-error-106');
	await expect(thumbErr106).toBeVisible();
	await expect(thumbErr106).toHaveAttribute('data-error-code', 'EVIDENCE_MISSING');
	await expect(thumbErr106).toContainText(/410 EVIDENCE_MISSING/i);
	await expect(page.getByTestId('capture-thumb-img-106')).toHaveCount(0);

	const findingLink = page.getByTestId('open-finding-link-105');
	await expect(findingLink).toHaveAttribute('href', '/findings/105');

	// Verify exact frame request headers and binary JPEG signature
	expect(receivedFrames.length).toBeGreaterThanOrEqual(1);
	const firstFrame = receivedFrames[0]!;
	expect(firstFrame.contentType).toBe('image/jpeg');
	expect(firstFrame.csrf).toBeTruthy();
	expect(firstFrame.sequence).toBe('1');
	expect(firstFrame.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
	expect(Number(firstFrame.elapsedMs)).toBeGreaterThanOrEqual(0);
	expect(firstFrame.hasJpegMagic).toBe(true);

	// 6. Stop session explicitly via button -> releases media tracks and sends reason='user_stop'
	await page.getByTestId('stop-monitoring-btn').click();
	await expect(page.getByTestId('start-monitoring-btn')).toBeVisible();
	expect(receivedStops.some((s) => s.reason === 'user_stop')).toBe(true);

	// 7. Start again and verify hidden tab (visibilitychange -> hidden) stops sampling and sends reason='page_hidden'
	await page.getByTestId('start-monitoring-btn').click();
	await expect(page.getByTestId('stop-monitoring-btn')).toBeVisible();

	await page.evaluate(() => {
		Object.defineProperty(document, 'visibilityState', {
			value: 'hidden',
			configurable: true
		});
		document.dispatchEvent(new Event('visibilitychange'));
	});

	await expect(page.getByTestId('start-monitoring-btn')).toBeVisible();
	await expect(page.getByTestId('monitoring-status-banner')).toContainText(/tab disembunyikan/i);
	expect(receivedStops.some((s) => s.reason === 'page_hidden')).toBe(true);

	// Restore visibilityState to 'visible'
	await page.evaluate(() => {
		Object.defineProperty(document, 'visibilityState', {
			value: 'visible',
			configurable: true
		});
	});

	// 8. Start again and verify TRACKER_RESET (503) interrupts the session and releases the camera
	await page.unroute('/api/v1/monitoring/sessions/77/frames');
	await page.route('/api/v1/monitoring/sessions/77/frames', async (route) => {
		await route.fulfill({
			status: 503,
			contentType: 'application/json',
			body: JSON.stringify({
				error: {
					code: 'TRACKER_RESET',
					message: 'Layanan AI dimulai ulang; mulai sesi baru.',
					request_id: 'req-tracker-reset'
				}
			})
		});
	});

	await page.getByTestId('start-monitoring-btn').click();
	await expect(errorAlert).toBeVisible();
	await expect(errorAlert).toHaveAttribute('data-error-code', 'TRACKER_RESET');
	await expect(errorAlert).toContainText(/State Tracker AI Direset/i);
	await expect(page.getByTestId('start-monitoring-btn')).toBeVisible();

	// 9. Verify active-camera logout ordering & failure recovery (Spec #4):
	//    - Start active camera session
	//    - First logout attempt fails (500): session/stop was awaited BEFORE logout, camera released,
	//      but authenticated state (Petugas: Anisa) is retained and error is displayed so officer can retry
	//    - Second logout attempt succeeds (204): redirects to /login with NO false expired-session banner
	await page.unroute('/api/v1/monitoring/sessions/77/frames');
	await page.route('/api/v1/monitoring/sessions/77/frames', async (route) => {
		const headers = route.request().headers();
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				data: {
					session_id: 77,
					frame_sequence: Number(headers['x-frame-sequence'] ?? '1'),
					captured_at: headers['x-captured-at'] ?? '2026-11-11T02:15:22.000Z',
					received_at: '2026-11-11T02:15:22.020Z',
					width: 640,
					height: 480,
					inference_ms: 80,
					model_version: 'test-fixture-v1',
					mode: 'simulated',
					tracks: [],
					events: []
				}
			})
		});
	});

	const callSequence: string[] = [];
	await page.unroute('/api/v1/monitoring/sessions/77/stop');
	await page.route('/api/v1/monitoring/sessions/77/stop', async (route) => {
		callSequence.push('session_stop');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				data: {
					id: 77,
					project_id: 1,
					zone_id: 1,
					started_by: 1,
					source: 'browser_webcam',
					status: 'stopped',
					mode: 'simulated',
					model_version: 'test-fixture-v1',
					supported_violations: ['NO_HELMET', 'NO_VEST'],
					started_at: '2026-11-11T02:15:00.000Z',
					ended_at: '2026-11-11T02:15:10.000Z',
					end_reason: 'user_stop',
					last_frame_at: '2026-11-11T02:15:02.000Z',
					config: {
						sample_fps: 1,
						confirm_hits: 2,
						confirm_max_frames: 3,
						confirm_window_ms: 2000,
						track_timeout_ms: 5000
					}
				}
			})
		});
	});

	let logoutAttempts = 0;
	await page.route('/api/v1/auth/logout', async (route) => {
		logoutAttempts += 1;
		callSequence.push(`auth_logout_${logoutAttempts}`);
		if (logoutAttempts === 1) {
			await route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({
					error: {
						code: 'INTERNAL_ERROR',
						message: 'Gagal menghapus sesi di server sementara.',
						request_id: 'req-logout-500'
					}
				})
			});
			return;
		}
		await route.continue();
	});

	await page.getByTestId('start-monitoring-btn').click();
	await expect(page.getByTestId('stop-monitoring-btn')).toBeVisible();

	const stoppedBeforeLogout = await page.evaluate(() => {
		return (window as unknown as { __fakeTracksStopped: number }).__fakeTracksStopped;
	});

	// Click Keluar while camera session is active (attempt 1 -> 500 failure)
	await page.getByRole('button', { name: /Keluar/i }).click();

	// Stop was called BEFORE auth/logout, camera tracks were stopped, and user remains authenticated with visible error
	await expect(
		page.getByRole('alert').filter({ hasText: /Gagal menghapus sesi di server sementara/i })
	).toBeVisible();
	await expect(page).toHaveURL(/\/monitoring$/);
	await expect(page.getByText(/Petugas:\s*Anisa/i)).toBeVisible();
	expect(callSequence).toEqual(['session_stop', 'auth_logout_1']);

	const stoppedAfterFailedLogout = await page.evaluate(() => {
		return (window as unknown as { __fakeTracksStopped: number }).__fakeTracksStopped;
	});
	expect(stoppedAfterFailedLogout).toBeGreaterThan(stoppedBeforeLogout);

	// Retry Keluar (attempt 2 -> real Go 204 logout)
	await page.getByRole('button', { name: /Keluar/i }).click();
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByText(/Sesi Anda telah berakhir/i)).toHaveCount(0);
});
