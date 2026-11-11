import {
	classifyMonitoringError,
	computeAspectPreservingSize,
	shouldStopSamplingOnError
} from './api.ts';
import type {
	CapturedEventItem,
	FrameResult,
	InferredSnapshot,
	MonitoringErrorState,
	SendFrameInput,
	StopReason
} from './types.ts';

/**
 * SRS §6.1: Browser requests video only (no audio) with ideal 640x480.
 */
export const DEFAULT_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
	video: {
		width: { ideal: 640 },
		height: { ideal: 480 }
	},
	audio: false
};

export const JPEG_QUALITY = 0.7;
export const MAX_JPEG_WIDTH = 640;
export const MAX_JPEG_HEIGHT = 480;
export const TARGET_SAMPLE_FPS = 1;
export const SERVER_IDLE_TIMEOUT_SECONDS = 15;

export interface SampledJpegFrame {
	blob: Blob;
	width: number;
	height: number;
	objectUrl: string;
}

/**
 * Requests user-initiated camera access with video-only constraints (SRS §6.1).
 */
export async function requestUserCameraStream(
	mediaDevices: MediaDevices | undefined = typeof navigator !== 'undefined'
		? navigator.mediaDevices
		: undefined
): Promise<MediaStream> {
	if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
		throw {
			status: 0,
			code: 'CAMERA_UNSUPPORTED',
			message:
				'Browser tidak mendukung akses kamera (getUserMedia). Gunakan konteks aman (localhost/HTTPS) pada browser modern.'
		};
	}

	try {
		return await mediaDevices.getUserMedia(DEFAULT_CAMERA_CONSTRAINTS);
	} catch (err) {
		const domErr = err as { name?: string; message?: string };
		const name = domErr?.name ?? '';
		if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
			throw {
				status: 0,
				code: 'CAMERA_DENIED',
				message:
					'Izin akses kamera ditolak oleh pengguna atau pengaturan browser. Izinkan kamera untuk memulai sesi monitoring.'
			};
		}
		if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
			throw {
				status: 0,
				code: 'CAMERA_NOT_FOUND',
				message:
					'Perangkat kamera tidak ditemukan. Pastikan webcam terpasang dengan benar lalu coba lagi.'
			};
		}
		if (name === 'NotReadableError' || name === 'TrackStartError') {
			throw {
				status: 0,
				code: 'CAMERA_DEVICE_BUSY',
				message:
					'Kamera sedang digunakan oleh aplikasi lain atau mengalami gangguan perangkat keras.'
			};
		}
		throw {
			status: 0,
			code: 'CAMERA_ERROR',
			message: domErr?.message || 'Gagal membuka perangkat kamera.'
		};
	}
}

/**
 * Releases all media tracks immediately and detaches any bound video element.
 */
export function releaseMediaStream(
	stream: MediaStream | null | undefined,
	videoEl?: HTMLVideoElement | null
): void {
	if (stream) {
		for (const track of stream.getTracks()) {
			try {
				track.stop();
			} catch {
				// ignore track stop errors
			}
		}
	}
	if (videoEl) {
		try {
			videoEl.pause();
			videoEl.srcObject = null;
		} catch {
			// ignore video element detach errors
		}
	}
}

/**
 * Samples a single aspect-preserving JPEG (max 640x480, quality 0.7) from a live HTMLVideoElement.
 * Preview mirroring never alters the sampled evidence coordinates.
 */
export async function sampleVideoElementJpeg(
	videoEl: HTMLVideoElement,
	canvasEl?: HTMLCanvasElement
): Promise<SampledJpegFrame> {
	const rawWidth = videoEl.videoWidth || MAX_JPEG_WIDTH;
	const rawHeight = videoEl.videoHeight || MAX_JPEG_HEIGHT;
	const { width, height } = computeAspectPreservingSize(
		rawWidth,
		rawHeight,
		MAX_JPEG_WIDTH,
		MAX_JPEG_HEIGHT
	);

	const canvas = canvasEl ?? document.createElement('canvas');
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;

	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw {
			status: 0,
			code: 'CANVAS_UNAVAILABLE',
			message: 'Tidak dapat menginisialisasi konteks canvas 2D untuk sampling JPEG.'
		};
	}

	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.drawImage(videoEl, 0, 0, width, height);
	ctx.restore();

	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(b) => {
				if (b) {
					resolve(b);
				} else {
					reject({
						status: 0,
						code: 'JPEG_ENCODE_FAILED',
						message: 'Gagal mengenkode frame video ke format image/jpeg.'
					});
				}
			},
			'image/jpeg',
			JPEG_QUALITY
		);
	});

	const objectUrl =
		typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
			? URL.createObjectURL(blob)
			: '';

	return {
		blob,
		width,
		height,
		objectUrl
	};
}

export interface CaptureLoopState {
	active: boolean;
	inFlight: boolean;
	sequence: number;
	skippedBusyTicks: number;
	completedFrames: number;
	startedAtMonotonicMs: number;
	backoffUntilMonotonicMs: number;
	effectiveFps: number;
	latestSnapshot: InferredSnapshot | null;
	capturedEvents: CapturedEventItem[];
	lastError: MonitoringErrorState | null;
}

export interface CaptureTickResult {
	skippedBusy: boolean;
	skippedBackoff?: boolean;
	stopped?: boolean;
	result?: FrameResult;
	error?: MonitoringErrorState;
}

export interface CreateCaptureLoopOptions {
	sessionId: number;
	stream: MediaStream | null;
	videoEl?: HTMLVideoElement | null;
	targetFps?: number;
	nowMonotonicMs?: () => number;
	nowUtcIso?: () => string;
	sampleJpeg: () => Promise<SampledJpegFrame>;
	sendFrame: (input: SendFrameInput) => Promise<FrameResult>;
	stopSession: (sessionId: number, reason?: StopReason) => Promise<unknown>;
	onStateChange?: (state: CaptureLoopState) => void;
	onSnapshot?: (snapshot: InferredSnapshot) => void;
	onEvents?: (events: CapturedEventItem[]) => void;
	onTerminalStop?: (reason: string, error: MonitoringErrorState | null) => void;
}

/**
 * Deterministic single-in-flight capture controller (SRS §6.1, §6.5, §9.5).
 * - Targets 1 FPS
 * - Allows at most 1 request in flight; skips busy ticks without queueing old frames
 * - Sends sequence (1..N), UTC ISO timestamp, and monotonic sample_elapsed_ms
 * - Respects 429 Retry-After without queuing stale frames
 * - Releases camera tracks and sends best-effort stop on explicit stop, hidden tab, route leave, logout, or terminal error
 */
export function createCaptureLoop(options: CreateCaptureLoopOptions) {
	const nowMonotonic =
		options.nowMonotonicMs ??
		(() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
	const nowUtc = options.nowUtcIso ?? (() => new Date().toISOString());

	const startMonotonic = nowMonotonic();
	let intervalHandle: ReturnType<typeof setInterval> | null = null;
	let abortController: AbortController | null = null;
	let stopPromise: Promise<void> | null = null;

	const state: CaptureLoopState = {
		active: true,
		inFlight: false,
		sequence: 0,
		skippedBusyTicks: 0,
		completedFrames: 0,
		startedAtMonotonicMs: startMonotonic,
		backoffUntilMonotonicMs: 0,
		effectiveFps: 0,
		latestSnapshot: null,
		capturedEvents: [],
		lastError: null
	};

	function notify() {
		options.onStateChange?.({
			...state,
			capturedEvents: [...state.capturedEvents]
		});
	}

	function revokeSnapshotUrl(url: string | null | undefined) {
		if (
			url &&
			url.startsWith('blob:') &&
			typeof URL !== 'undefined' &&
			typeof URL.revokeObjectURL === 'function'
		) {
			try {
				URL.revokeObjectURL(url);
			} catch {
				// ignore revoke errors
			}
		}
	}

	async function tick(): Promise<CaptureTickResult> {
		if (!state.active) {
			return { skippedBusy: false, stopped: true };
		}

		// Single in-flight rule: skip busy tick immediately, never queue old frames
		if (state.inFlight) {
			state.skippedBusyTicks += 1;
			notify();
			return { skippedBusy: true };
		}

		const tickMono = nowMonotonic();
		if (state.backoffUntilMonotonicMs > tickMono) {
			return { skippedBusy: false, skippedBackoff: true };
		}

		state.inFlight = true;
		state.sequence += 1;
		const currentSequence = state.sequence;
		const elapsedMs = Math.max(0, Math.round(tickMono - state.startedAtMonotonicMs));
		const capturedAtUtc = nowUtc();
		notify();

		let sampled: SampledJpegFrame | null = null;
		try {
			sampled = await options.sampleJpeg();
			if (!state.active) {
				revokeSnapshotUrl(sampled.objectUrl);
				return { skippedBusy: false, stopped: true };
			}

			abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
			const frameRes = await options.sendFrame({
				sessionId: options.sessionId,
				sequence: currentSequence,
				capturedAtUtc,
				sampleElapsedMs: elapsedMs,
				jpeg: sampled.blob,
				signal: abortController?.signal
			});

			const completedMono = nowMonotonic();
			const totalElapsedSec = Math.max(0.001, (completedMono - state.startedAtMonotonicMs) / 1000);
			state.completedFrames += 1;
			state.effectiveFps = Number(
				Math.min(options.targetFps ?? TARGET_SAMPLE_FPS, state.completedFrames / totalElapsedSec).toFixed(2)
			);
			state.lastError = null;

			const prevSnapshotUrl = state.latestSnapshot?.jpegUrl;
			const nextSnapshot: InferredSnapshot = {
				sequence: frameRes.frame_sequence,
				capturedAtUtc: frameRes.captured_at,
				receivedAtUtc: frameRes.received_at,
				completedAtMonotonicMs: completedMono,
				jpegUrl: sampled.objectUrl,
				width: frameRes.width,
				height: frameRes.height,
				inferenceMs: frameRes.inference_ms,
				modelVersion: frameRes.model_version,
				mode: frameRes.mode,
				tracks: frameRes.tracks ?? [],
				events: frameRes.events ?? []
			};
			state.latestSnapshot = nextSnapshot;
			if (prevSnapshotUrl && prevSnapshotUrl !== sampled.objectUrl) {
				revokeSnapshotUrl(prevSnapshotUrl);
			}
			options.onSnapshot?.(nextSnapshot);

			if (Array.isArray(frameRes.events) && frameRes.events.length > 0) {
				const newItems: CapturedEventItem[] = frameRes.events.map((ev) => {
					const firstPositiveTrack = (frameRes.tracks ?? []).find((t) =>
						t.observations?.some((o) => o.state === 'positive')
					);
					const firstPosObs = firstPositiveTrack?.observations?.find(
						(o) => o.state === 'positive'
					);
					return {
						findingId: ev.finding_id,
						sessionId: frameRes.session_id,
						sequence: frameRes.frame_sequence,
						capturedAtUtc: frameRes.captured_at,
						evidenceUrl: ev.evidence_url,
						verificationStatus: ev.verification_status ?? 'pending',
						mode: frameRes.mode,
						trackKey: firstPositiveTrack?.track_key ?? null,
						detectedViolation: firstPosObs?.type ?? null
					};
				});
				state.capturedEvents = [...newItems, ...state.capturedEvents];
				options.onEvents?.(newItems);
			}

			notify();
			return { skippedBusy: false, result: frameRes };
		} catch (err) {
			if (sampled?.objectUrl) {
				revokeSnapshotUrl(sampled.objectUrl);
			}
			if (!state.active) {
				return { skippedBusy: false, stopped: true };
			}

			const classified = classifyMonitoringError(err);
			state.lastError = classified;

			if (classified.retryAfterSec && classified.retryAfterSec > 0) {
				state.backoffUntilMonotonicMs = nowMonotonic() + classified.retryAfterSec * 1000;
			}

			if (shouldStopSamplingOnError(classified)) {
				await stop('user_stop', false, classified);
				options.onTerminalStop?.(classified.code, classified);
			} else {
				notify();
			}

			return { skippedBusy: false, error: classified };
		} finally {
			abortController = null;
			state.inFlight = false;
			notify();
		}
	}

	function startTimer() {
		if (intervalHandle || !state.active) return;
		const fps = Math.max(1, options.targetFps ?? TARGET_SAMPLE_FPS);
		const intervalMs = Math.round(1000 / fps);
		void tick();
		intervalHandle = setInterval(() => {
			void tick();
		}, intervalMs);
	}

	async function stop(
		reason: StopReason = 'user_stop',
		callServerStop = true,
		terminalError: MonitoringErrorState | null = null
	): Promise<void> {
		if (stopPromise) {
			return stopPromise;
		}

		stopPromise = (async () => {
			state.active = false;
			if (terminalError) {
				state.lastError = terminalError;
			}
			if (intervalHandle) {
				clearInterval(intervalHandle);
				intervalHandle = null;
			}
			if (abortController) {
				try {
					abortController.abort();
				} catch {
					// ignore abort errors
				}
			}
			releaseMediaStream(options.stream, options.videoEl);
			notify();

			if (callServerStop) {
				try {
					await options.stopSession(options.sessionId, reason);
				} catch {
					// Best-effort stop: server 15-second idle timeout remains the backstop
				}
			}
		})();

		return stopPromise;
	}

	function destroy() {
		revokeSnapshotUrl(state.latestSnapshot?.jpegUrl);
	}

	return {
		startTimer,
		tick,
		stop,
		destroy,
		getState(): CaptureLoopState {
			return { ...state, capturedEvents: [...state.capturedEvents] };
		}
	};
}
