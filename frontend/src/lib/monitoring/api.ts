import type {
	FrameResult,
	MonitoringErrorState,
	MonitoringProject,
	MonitoringSession,
	MonitoringZone,
	NormalizedBBox,
	SendFrameInput,
	SessionStatus,
	StartSessionInput,
	StopReason
} from './types.ts';

export interface MonitoringHttpClient {
	apiData<T>(path: string, options?: Record<string, unknown>): Promise<T>;
	apiList<T>(
		path: string,
		options?: Record<string, unknown>
	): Promise<{ data: T[]; meta: { page: number; page_size: number; total: number } }>;
}

export interface MonitoringApi {
	listActiveProjects(): Promise<MonitoringProject[]>;
	listActiveZones(projectId: number): Promise<MonitoringZone[]>;
	listSessions(params?: {
		projectId?: number;
		zoneId?: number;
		status?: SessionStatus;
		page?: number;
		pageSize?: number;
	}): Promise<{ data: MonitoringSession[]; meta: { page: number; page_size: number; total: number } }>;
	getSession(sessionId: number): Promise<MonitoringSession>;
	startSession(input: StartSessionInput): Promise<MonitoringSession>;
	sendFrame(input: SendFrameInput): Promise<FrameResult>;
	stopSession(sessionId: number, reason?: StopReason): Promise<MonitoringSession>;
}

/**
 * Computes aspect-preserving dimensions bounded by maxWidth and maxHeight (SRS §6.1: max 640x480).
 */
export function computeAspectPreservingSize(
	sourceWidth: number,
	sourceHeight: number,
	maxWidth = 640,
	maxHeight = 480
): { width: number; height: number } {
	const safeW = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : maxWidth;
	const safeH = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : maxHeight;
	const scale = Math.min(1, maxWidth / safeW, maxHeight / safeH);
	const width = Math.max(1, Math.round(safeW * scale));
	const height = Math.max(1, Math.round(safeH * scale));
	return { width, height };
}

/**
 * Converts normalized [x_min, y_min, x_max, y_max] (0..1) on the original sampled JPEG
 * into pixel coordinates for an overlay matching the exact inferred snapshot aspect ratio (SRS §9.5).
 */
export function scaleNormalizedBBox(
	bbox: NormalizedBBox,
	displayWidth: number,
	displayHeight: number
): { left: number; top: number; width: number; height: number } {
	const [xMin, yMin, xMax, yMax] = bbox;
	const clampedXMin = Math.max(0, Math.min(1, xMin));
	const clampedYMin = Math.max(0, Math.min(1, yMin));
	const clampedXMax = Math.max(clampedXMin, Math.min(1, xMax));
	const clampedYMax = Math.max(clampedYMin, Math.min(1, yMax));

	return {
		left: clampedXMin * displayWidth,
		top: clampedYMin * displayHeight,
		width: (clampedXMax - clampedXMin) * displayWidth,
		height: (clampedYMax - clampedYMin) * displayHeight
	};
}

/**
 * Creates the monitoring API consumer bound to the shared #lib apiData/apiList interface.
 */
export function createMonitoringApi(client: MonitoringHttpClient): MonitoringApi {
	return {
		async listActiveProjects(): Promise<MonitoringProject[]> {
			const res = await client.apiList<MonitoringProject>(
				'/projects?status=active&page=1&page_size=100'
			);
			return res.data;
		},

		async listActiveZones(projectId: number): Promise<MonitoringZone[]> {
			const res = await client.apiList<MonitoringZone>(
				`/projects/${encodeURIComponent(String(projectId))}/zones?status=active&page=1&page_size=100`
			);
			return res.data;
		},

		async listSessions(params = {}) {
			const search = new URLSearchParams();
			if (params.projectId && params.projectId > 0) {
				search.set('project_id', String(params.projectId));
			}
			if (params.zoneId && params.zoneId > 0) {
				search.set('zone_id', String(params.zoneId));
			}
			if (params.status) {
				search.set('status', params.status);
			}
			search.set('page', String(params.page ?? 1));
			search.set('page_size', String(params.pageSize ?? 20));
			return client.apiList<MonitoringSession>(`/monitoring/sessions?${search.toString()}`);
		},

		async getSession(sessionId: number): Promise<MonitoringSession> {
			return client.apiData<MonitoringSession>(
				`/monitoring/sessions/${encodeURIComponent(String(sessionId))}`
			);
		},

		async startSession(input: StartSessionInput): Promise<MonitoringSession> {
			return client.apiData<MonitoringSession>('/monitoring/sessions', {
				method: 'POST',
				body: {
					project_id: input.project_id,
					zone_id: input.zone_id,
					source: input.source ?? 'browser_webcam'
				}
			});
		},

		async sendFrame(input: SendFrameInput): Promise<FrameResult> {
			const sequenceInt = Math.max(1, Math.trunc(input.sequence));
			const elapsedInt = Math.max(0, Math.round(input.sampleElapsedMs));
			return client.apiData<FrameResult>(
				`/monitoring/sessions/${encodeURIComponent(String(input.sessionId))}/frames`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'image/jpeg',
						'X-Frame-Sequence': String(sequenceInt),
						'X-Captured-At': input.capturedAtUtc,
						'X-Sample-Elapsed-Ms': String(elapsedInt)
					},
					body: input.jpeg,
					signal: input.signal
				}
			);
		},

		async stopSession(
			sessionId: number,
			reason: StopReason = 'user_stop'
		): Promise<MonitoringSession> {
			return client.apiData<MonitoringSession>(
				`/monitoring/sessions/${encodeURIComponent(String(sessionId))}/stop`,
				{
					method: 'POST',
					body: { reason }
				}
			);
		}
	};
}

interface ErrorLike {
	status?: number;
	code?: string;
	message?: string;
	requestId?: string | null;
	retryAfter?: number | null;
	isNetworkError?: boolean;
}

const TERMINAL_ERROR_CODES = new Set([
	'CAMERA_BUSY',
	'MODEL_NOT_READY',
	'AI_UNAVAILABLE',
	'AI_TIMEOUT',
	'TRACKER_RESET',
	'SESSION_NOT_ACTIVE',
	'STORAGE_ERROR',
	'UNAUTHORIZED',
	'FORBIDDEN',
	'CSRF_INVALID',
	'NOT_ACTIVE',
	'PROJECT_ZONE_MISMATCH',
	'BACKEND_UNREACHABLE'
]);

/**
 * Maps an API or transport error into a truthful Indonesian monitoring error state (SRS §5.4, §6.5, §9.1, §9.5).
 */
export function classifyMonitoringError(err: unknown): MonitoringErrorState {
	const candidate = (err && typeof err === 'object' ? err : {}) as ErrorLike;
	const status = typeof candidate.status === 'number' ? candidate.status : 0;
	const code =
		typeof candidate.code === 'string' && candidate.code.length > 0
			? candidate.code
			: status === 401
				? 'UNAUTHORIZED'
				: status === 403
					? 'FORBIDDEN'
					: status === 429
						? 'FRAME_TOO_FAST'
						: 'UNKNOWN_ERROR';
	const rawMessage =
		typeof candidate.message === 'string' && candidate.message.length > 0
			? candidate.message
			: 'Terjadi kesalahan saat berkomunikasi dengan server monitoring.';
	const requestId = candidate.requestId ?? null;
	const retryAfterSec =
		typeof candidate.retryAfter === 'number' && candidate.retryAfter > 0
			? candidate.retryAfter
			: status === 429
				? 1
				: null;

	switch (code) {
		case 'CAMERA_BUSY':
			return {
				code,
				title: 'Sesi Kamera Sedang Aktif',
				message: rawMessage,
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint:
					'Hanya satu sesi monitoring kamera aktif yang diizinkan secara global. Hentikan sesi aktif di tab lain atau muat ulang riwayat sesi.'
			};
		case 'MODEL_NOT_READY':
			return {
				code,
				title: 'Model AI Belum Siap',
				message: rawMessage,
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint:
					'Server menolak memulai sesi karena model pada mode aktif belum siap. Sistem tidak beralih diam-diam ke mode simulasi.'
			};
		case 'AI_UNAVAILABLE':
		case 'AI_TIMEOUT':
			return {
				code,
				title: 'Layanan AI Tidak Tersedia',
				message: rawMessage,
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint:
					'Pipeline inferensi Python FastAPI (/internal/v1/*) tidak merespons atau belum tersedia. Sampling dihentikan agar tidak menampilkan status aman palsu.'
			};
		case 'TRACKER_RESET':
			return {
				code,
				title: 'State Tracker AI Direset',
				message: rawMessage,
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint:
					'Proses layanan AI dimulai ulang di tengah sesi sehingga riwayat episode tracker tidak lagi kompatibel. Mulai sesi monitoring baru.'
			};
		case 'SESSION_NOT_ACTIVE':
			return {
				code,
				title: 'Sesi Tidak Lagi Aktif',
				message: rawMessage,
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint:
					'Sesi telah dihentikan atau diinterupsi oleh batas waktu idle server (15 detik). Mulai sesi baru untuk melanjutkan inspeksi.'
			};
		case 'STORAGE_ERROR':
			return {
				code,
				title: 'Gagal Menyimpan Bukti',
				message: rawMessage,
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint:
					'Server gagal menyimpan foto bukti atau temuan dan telah menghentikan sesi agar bukti tidak ambigu.'
			};
		case 'FRAME_TOO_FAST':
			return {
				code,
				title: 'Sampling Terlalu Cepat (HTTP 429)',
				message: rawMessage,
				status,
				requestId,
				retryAfterSec: retryAfterSec ?? 1,
				terminal: false,
				recoveryHint: `Pengiriman frame ditunda selama ${retryAfterSec ?? 1} detik sesuai batas Retry-After tanpa menumpuk antrean frame lama.`
			};
		case 'FRAME_SEQUENCE_CONFLICT':
		case 'FRAME_TOO_OLD':
		case 'FRAME_STALE':
			return {
				code,
				title: 'Urutan atau Waktu Frame Ditolak',
				message: rawMessage,
				status,
				requestId,
				retryAfterSec: null,
				terminal: false,
				recoveryHint:
					'Frame tersebut dilewati oleh server karena urutan atau keterlambatan melebihi batas. Tick berikutnya akan mengirim sampel baru.'
			};
		case 'UNSUPPORTED_MEDIA_TYPE':
		case 'INVALID_IMAGE':
		case 'PAYLOAD_TOO_LARGE':
		case 'IMAGE_TOO_LARGE':
			return {
				code,
				title: 'Format atau Ukuran Frame Tidak Valid',
				message: rawMessage,
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint:
					'Pastikan kamera menghasilkan JPEG valid maksimal 640×480 (≤ 1 MiB). Sampling dihentikan untuk mencegah pengiriman berulang yang gagal.'
			};
		case 'MODEL_ERROR':
		case 'INVALID_AI_OUTPUT':
			return {
				code,
				title: 'Inferensi Frame Gagal',
				message: rawMessage,
				status,
				requestId,
				retryAfterSec: null,
				terminal: false,
				recoveryHint:
					'Hasil AI untuk frame ini tidak valid dan tidak dihitung sebagai observasi. Sesi tetap dapat mencoba sampel berikutnya.'
			};
		case 'UNAUTHORIZED':
		case 'FORBIDDEN':
		case 'CSRF_INVALID':
			return {
				code,
				title: 'Sesi Autentikasi atau Hak Akses Tidak Valid',
				message: rawMessage,
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint:
					'Kamera telah dilepaskan. Silakan masuk kembali atau periksa kepemilikan sesi.'
			};
		default: {
			const isNetwork = Boolean(candidate.isNetworkError) || status === 0 || code === 'BACKEND_UNREACHABLE';
			return {
				code,
				title: isNetwork ? 'Koneksi ke Server Terputus' : 'Kesalahan Operasi Monitoring',
				message: rawMessage,
				status,
				requestId,
				retryAfterSec: null,
				terminal: isNetwork || TERMINAL_ERROR_CODES.has(code) || status === 401 || status === 403,
				recoveryHint: isNetwork
					? 'Koneksi ke backend Go terputus. Sampling dihentikan dan kamera dilepaskan.'
					: 'Periksa pesan kesalahan di atas lalu coba mulai ulang sesi bila diperlukan.'
			};
		}
	}
}

export function shouldStopSamplingOnError(state: MonitoringErrorState): boolean {
	return state.terminal;
}
