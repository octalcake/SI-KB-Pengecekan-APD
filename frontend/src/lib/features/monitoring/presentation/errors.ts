import type { MonitoringErrorState } from '../domain/types';
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
				title: 'Kamera sedang dipakai',
				message: 'Masih ada inspeksi yang berjalan.',
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint: 'Akhiri inspeksi di tab lain sebelum memulai sesi baru.'
			};
		case 'MODEL_NOT_READY':
			return {
				code,
				title: 'Model belum siap',
				message: 'Deteksi otomatis belum bisa dimulai.',
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint: 'Hubungi operator untuk menyiapkan model, lalu coba lagi.'
			};
		case 'AI_UNAVAILABLE':
		case 'AI_TIMEOUT':
			return {
				code,
				title: 'Deteksi belum tersedia',
				message: 'Layanan deteksi belum bisa dihubungi.',
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint: 'Hubungi operator untuk memeriksa layanan deteksi, lalu mulai inspeksi lagi.'
			};
		case 'TRACKER_RESET':
			return {
				code,
				title: 'Pelacakan terputus',
				message: 'Layanan deteksi dimulai ulang.',
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint: 'Mulai inspeksi baru untuk melanjutkan.'
			};
		case 'SESSION_NOT_ACTIVE':
			return {
				code,
				title: 'Inspeksi sudah berakhir',
				message: 'Sesi ini sudah ditutup.',
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint: 'Mulai inspeksi baru untuk melanjutkan.'
			};
		case 'STORAGE_ERROR':
			return {
				code,
				title: 'Foto belum tersimpan',
				message: 'Foto bukti gagal disimpan.',
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint: 'Inspeksi dihentikan. Hubungi operator sebelum mencoba lagi.'
			};
		case 'FRAME_TOO_FAST':
			return {
				code,
				title: 'Pengiriman terlalu cepat',
				message: 'Pengiriman foto dijeda sebentar.',
				status,
				requestId,
				retryAfterSec: retryAfterSec ?? 1,
				terminal: false,
				recoveryHint: `Pengiriman dilanjutkan dalam ${retryAfterSec ?? 1} detik.`
			};
		case 'FRAME_SEQUENCE_CONFLICT':
		case 'FRAME_TOO_OLD':
		case 'FRAME_STALE':
			return {
				code,
				title: 'Foto terlambat diterima',
				message: 'Foto ini tidak digunakan.',
				status,
				requestId,
				retryAfterSec: null,
				terminal: false,
				recoveryHint: 'Foto ini dilewati. Foto berikutnya akan dikirim otomatis.'
			};
		case 'UNSUPPORTED_MEDIA_TYPE':
		case 'INVALID_IMAGE':
		case 'PAYLOAD_TOO_LARGE':
		case 'IMAGE_TOO_LARGE':
			return {
				code,
				title: 'Foto tidak bisa diproses',
				message: 'Ukuran atau format foto tidak sesuai.',
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint:
					'Kamera harus mengirim foto JPEG maksimal 640 x 480 piksel dan 1 MiB. Hubungi operator untuk memeriksanya.'
			};
		case 'MODEL_ERROR':
		case 'INVALID_AI_OUTPUT':
			return {
				code,
				title: 'Deteksi foto gagal',
				message: 'Hasil deteksi foto ini tidak bisa digunakan.',
				status,
				requestId,
				retryAfterSec: null,
				terminal: false,
				recoveryHint: 'Hasil foto ini tidak digunakan. Kamera akan mencoba foto berikutnya.'
			};
		case 'UNAUTHORIZED':
		case 'FORBIDDEN':
		case 'CSRF_INVALID':
			return {
				code,
				title: 'Akses kamera ditolak',
				message: 'Akun ini belum bisa memakai sesi kamera.',
				status,
				requestId,
				retryAfterSec: null,
				terminal: true,
				recoveryHint: 'Masuk lagi dan pastikan sesi ini milik akunmu.'
			};
		default: {
			const isNetwork =
				Boolean(candidate.isNetworkError) || status === 0 || code === 'BACKEND_UNREACHABLE';
			return {
				code,
				title: code.startsWith('CAMERA_')
					? 'Kamera belum bisa dibuka'
					: isNetwork
						? 'Koneksi ke server terputus'
						: 'Inspeksi mengalami kendala',
				message: rawMessage,
				status,
				requestId,
				retryAfterSec: null,
				terminal: isNetwork || TERMINAL_ERROR_CODES.has(code) || status === 401 || status === 403,
				recoveryHint: code.startsWith('CAMERA_')
					? 'Periksa kamera dan izinnya, lalu coba lagi.'
					: isNetwork
						? 'Inspeksi dihentikan. Cek koneksi, lalu mulai lagi.'
						: 'Coba mulai inspeksi lagi. Kalau masih gagal, hubungi operator.'
			};
		}
	}
}

export function shouldStopSamplingOnError(state: MonitoringErrorState): boolean {
	return state.terminal;
}
