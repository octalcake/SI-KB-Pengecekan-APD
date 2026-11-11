import type {
	CapturedEventItem,
	FrameResult,
	InferredSnapshot,
	MonitoringErrorState,
	SendFrameInput,
	StopReason,
} from '../domain/types';
export interface SampledJpegFrame {
	blob: Blob;
	width: number;
	height: number;
	objectUrl: string;
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
	releaseCamera: () => void;
	revokeObjectUrl: (url: string) => void;
	classifyError: (error: unknown) => MonitoringErrorState;
	createAbortController: () => AbortController;
	schedule: (callback: () => void, intervalMs: number) => () => void;
	targetFps?: number;
	nowMonotonicMs: () => number;
	nowUtcIso: () => string;
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
	const nowMonotonic = options.nowMonotonicMs;
	const nowUtc = options.nowUtcIso;

	const startMonotonic = nowMonotonic();
	let intervalHandle: (() => void) | null = null;
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
		if(url?.startsWith('blob:')) {
			try {
				options.revokeObjectUrl(url);
			} catch {
				// URL cleanup must not interrupt capture or session shutdown.
			}
		}
	}

	async function tick(): Promise<CaptureTickResult> {
		if(!state.active) {
			return { skippedBusy: false, stopped: true };
		}

		// Single in-flight rule: skip busy tick immediately, never queue old frames
		if(state.inFlight) {
			state.skippedBusyTicks += 1;
			notify();
			return { skippedBusy: true };
		}

		const tickMono = nowMonotonic();
		if(state.backoffUntilMonotonicMs > tickMono) {
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
			if(!state.active) {
				revokeSnapshotUrl(sampled.objectUrl);
				return { skippedBusy: false, stopped: true };
			}

			abortController = options.createAbortController();
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
				Math.min(options.targetFps ?? 1, state.completedFrames / totalElapsedSec).toFixed(2)
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
			if(prevSnapshotUrl && prevSnapshotUrl !== sampled.objectUrl) {
				revokeSnapshotUrl(prevSnapshotUrl);
			}
			options.onSnapshot?.(nextSnapshot);

			if(Array.isArray(frameRes.events) && frameRes.events.length > 0) {
				const newItems: CapturedEventItem[] = frameRes.events.map((ev) => ({
					findingId: ev.finding_id,
					sessionId: frameRes.session_id,
					sequence: frameRes.frame_sequence,
					capturedAtUtc: frameRes.captured_at,
					evidenceUrl: ev.evidence_url,
					verificationStatus: ev.verification_status ?? 'pending',
					mode: frameRes.mode
				}));
				state.capturedEvents = [...newItems, ...state.capturedEvents];
				options.onEvents?.(newItems);
			}

			notify();
			return { skippedBusy: false, result: frameRes };
		} catch(err) {
			if(sampled?.objectUrl) {
				revokeSnapshotUrl(sampled.objectUrl);
			}
			if(!state.active) {
				return { skippedBusy: false, stopped: true };
			}

			const classified = options.classifyError(err);
			state.lastError = classified;

			if(classified.retryAfterSec && classified.retryAfterSec > 0) {
				state.backoffUntilMonotonicMs = nowMonotonic() + classified.retryAfterSec * 1000;
			}

			if(classified.terminal) {
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
		if(intervalHandle || !state.active) return;
		const fps = Math.max(1, options.targetFps ?? 1);
		const intervalMs = Math.round(1000 / fps);
		void tick();
		intervalHandle = options.schedule(() => {
			void tick();
		}, intervalMs);
	}

	async function stop(
		reason: StopReason = 'user_stop',
		callServerStop = true,
		terminalError: MonitoringErrorState | null = null
	): Promise<void> {
		if(stopPromise) {
			return stopPromise;
		}

		stopPromise = (async () => {
			state.active = false;
			if(terminalError) {
				state.lastError = terminalError;
			}
			if(intervalHandle) {
				intervalHandle();
				intervalHandle = null;
			}
			if(abortController) {
				try {
					abortController.abort();
				} catch {
					// ignore abort errors
				}
			}
			options.releaseCamera();
			notify();

			if(callServerStop) {
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
