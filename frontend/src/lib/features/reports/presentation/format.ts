import {
	isApiError as isReportApiError,
	type ApiError as SharedApiErrorLike
} from '#lib/shared/errors';
import type {
	ActionStatus,
	ReportGeneratedBy,
	ReportStatus,
	SessionStatus,
	SystemMode,
	ViolationType
} from '../domain/types';

export function formatReportStatusLabel(status: ReportStatus | string): string {
	switch (status) {
		case 'draft':
			return 'Draf';
		case 'approved':
			return 'Disetujui · terkunci';
		default:
			return String(status);
	}
}

export function formatReportStatusShortLabel(status: ReportStatus | string): string {
	switch (status) {
		case 'draft':
			return 'Draf';
		case 'approved':
			return 'Disetujui';
		default:
			return String(status);
	}
}

export function formatGeneratedByLabel(generatedBy: ReportGeneratedBy | string): string {
	switch (generatedBy) {
		case 'gemini':
			return 'Gemini';
		case 'template':
			return 'Templat aplikasi';
		case 'manual':
			return 'Ditulis petugas';
		default:
			return String(generatedBy);
	}
}

export function formatGeneratedByShortLabel(generatedBy: ReportGeneratedBy | string): string {
	switch (generatedBy) {
		case 'gemini':
			return 'GEMINI';
		case 'template':
			return 'TEMPLATE';
		case 'manual':
			return 'MANUAL';
		default:
			return String(generatedBy).toUpperCase();
	}
}

export function formatModeLabel(mode: SystemMode | string): string {
	switch (mode) {
		case 'real':
			return 'NYATA';
		case 'simulated':
			return 'SIMULASI';
		case 'manual':
			return 'MANUAL';
		default:
			return String(mode).toUpperCase();
	}
}

export function formatSessionStatusLabel(status: SessionStatus | string): string {
	switch (status) {
		case 'active':
			return 'Masih berjalan';
		case 'stopped':
			return 'Selesai';
		case 'interrupted':
			return 'Terhenti';
		default:
			return String(status);
	}
}

export function formatViolationLabel(type: ViolationType | string | null | undefined): string {
	if (type === 'NO_HELMET') return 'Indikasi tanpa helm';
	if (type === 'NO_VEST') return 'Indikasi tanpa rompi';
	if (!type) return 'Tidak diketahui';
	return String(type);
}

export function formatActionStatusLabel(status: ActionStatus | string): string {
	switch (status) {
		case 'pending':
			return 'Belum ditindaklanjuti';
		case 'in_progress':
			return 'Dalam proses';
		case 'completed':
			return 'Selesai';
		default:
			return String(status);
	}
}

const jakartaFormatter = new Intl.DateTimeFormat('id-ID', {
	timeZone: 'Asia/Jakarta',
	year: 'numeric',
	month: 'short',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hour12: false
});

export function formatJakartaDateTime(iso: string | null | undefined): string {
	if (!iso) return '—';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return `${jakartaFormatter.format(date)} WIB`;
}

export function translateReportFieldError(field: string, reason: string): string {
	const r = reason.trim().toLowerCase();
	if (field === 'session_id') {
		return 'Pilih sesi yang sudah selesai dan punya temuan terkonfirmasi.';
	}
	if (field === 'request_key') {
		return 'Permintaan belum lengkap. Coba ulang dari halaman Laporan.';
	}
	if (field === 'title') {
		if (r.includes('max') || r.includes('200')) {
			return 'Judul laporan wajib diisi (1–200 karakter).';
		}
		return `Judul laporan wajib diisi (1–200 karakter).`;
	}
	if (field === 'content') {
		if (r.includes('max') || r.includes('20000')) {
			return 'Isi laporan wajib diisi (1–20.000 karakter).';
		}
		return 'Isi laporan wajib diisi (1–20.000 karakter).';
	}
	if (field === 'use_template') {
		return 'Pilih templat atau tulis manual.';
	}
	if (field === 'review_acknowledged') {
		return 'Centang pernyataan setelah memeriksa isi laporan dan temuannya.';
	}
	if (field === 'version') {
		return 'Data laporan belum lengkap. Ambil data terbaru, lalu coba lagi.';
	}
	return `${field}: ${reason}`;
}

export interface ParsedReportError {
	status: number;
	code: string;
	title: string;
	message: string;
	fieldErrors: Record<string, string>;
	requestId: string | null;
	isUnauthorized: boolean;
	isForbidden: boolean;
	isSessionStillActive: boolean;
	isNoConfirmedFindings: boolean;
	isReportExists: boolean;
	isGeminiUnavailable: boolean;
	isInvalidGeminiOutput: boolean;
	isSourceChanged: boolean;
	isIdempotencyConflict: boolean;
	isRequestKeyExpired: boolean;
	isVersionConflict: boolean;
	isStaleReport: boolean;
	isReportLocked: boolean;
	isNetworkError: boolean;
}

export function parseReportApiError(
	err: unknown,
	fallbackMessage = 'Terjadi kesalahan saat memproses permintaan laporan.'
): ParsedReportError {
	if (!isReportApiError(err)) {
		return {
			status: 0,
			code: 'UNKNOWN_ERROR',
			title: 'Ada masalah di aplikasi',
			message: err instanceof Error && err.message ? err.message : fallbackMessage,
			fieldErrors: {},
			requestId: null,
			isUnauthorized: false,
			isForbidden: false,
			isSessionStillActive: false,
			isNoConfirmedFindings: false,
			isReportExists: false,
			isGeminiUnavailable: false,
			isInvalidGeminiOutput: false,
			isSourceChanged: false,
			isIdempotencyConflict: false,
			isRequestKeyExpired: false,
			isVersionConflict: false,
			isStaleReport: false,
			isReportLocked: false,
			isNetworkError: false
		};
	}

	const apiErr: SharedApiErrorLike = err;
	const fieldErrors: Record<string, string> = {};
	if (apiErr.fields) {
		for (const [key, val] of Object.entries(apiErr.fields)) {
			fieldErrors[key] = translateReportFieldError(key, val);
		}
	}

	const code = apiErr.code || `HTTP_${apiErr.status}`;
	const isUnauthorized = apiErr.status === 401;
	const isForbidden = apiErr.status === 403;
	const isSessionStillActive = apiErr.status === 409 && code === 'SESSION_STILL_ACTIVE';
	const isNoConfirmedFindings = apiErr.status === 422 && code === 'NO_CONFIRMED_FINDINGS';
	const isReportExists = apiErr.status === 409 && code === 'REPORT_EXISTS';
	const isGeminiUnavailable = apiErr.status === 503 && code === 'GEMINI_UNAVAILABLE';
	const isInvalidGeminiOutput = apiErr.status === 502 && code === 'INVALID_GEMINI_OUTPUT';
	const isSourceChanged = apiErr.status === 409 && code === 'SOURCE_CHANGED';
	const isIdempotencyConflict = apiErr.status === 409 && code === 'IDEMPOTENCY_CONFLICT';
	const isRequestKeyExpired = apiErr.status === 409 && code === 'REQUEST_KEY_EXPIRED';
	const isVersionConflict = apiErr.status === 409 && code === 'VERSION_CONFLICT';
	const isStaleReport = apiErr.status === 409 && code === 'STALE_REPORT';
	const isReportLocked = apiErr.status === 409 && code === 'REPORT_LOCKED';
	const isNetworkError = Boolean(
		apiErr.isNetworkError || apiErr.status === 0 || code === 'BACKEND_UNREACHABLE'
	);

	let title = 'Permintaan Gagal';
	let message = apiErr.message || fallbackMessage;

	if (isNetworkError) {
		title = 'Respons belum diterima';
		message =
			'Cek koneksi, lalu coba lagi. Isianmu belum hilang dan permintaan yang sama tidak akan membuat laporan ganda.';
	} else if (isUnauthorized) {
		title = 'Sesi sudah berakhir';
		message = 'Masuk lagi untuk melanjutkan. Perubahanmu masih ada di halaman ini.';
	} else if (isForbidden) {
		title = 'Akses ditolak';
		message = 'Masuk lagi, lalu coba ulang. Kalau masih ditolak, hubungi operator.';
	} else if (isSessionStillActive) {
		title = 'Inspeksi masih berjalan';
		message = 'Akhiri inspeksi ini dulu, lalu buat laporan.';
	} else if (isNoConfirmedFindings) {
		title = 'Belum ada temuan terkonfirmasi';
		message =
			'Periksa dan konfirmasi minimal satu temuan, lalu akhiri sesi sebelum membuat laporan.';
	} else if (isReportExists) {
		title = 'Laporan sudah dibuat';
		message = 'Buka laporan yang sudah ada. Satu sesi hanya bisa memiliki satu laporan aktif.';
	} else if (isGeminiUnavailable) {
		title = 'Gemini belum tersedia';
		message = 'Coba lagi nanti, gunakan templat, atau tulis manual. Draf yang ada tidak berubah.';
	} else if (isInvalidGeminiOutput) {
		title = 'Hasil Gemini belum bisa dipakai';
		message = 'Coba lagi, gunakan templat, atau tulis manual. Draf sebelumnya tetap tersimpan.';
	} else if (isSourceChanged) {
		title = 'Temuan sumber berubah';
		message =
			'Temuan berubah saat draf sedang dibuat. Ambil data terbaru, lalu coba lagi. Draf sebelumnya tetap tersimpan.';
	} else if (isIdempotencyConflict) {
		title = 'Permintaan sudah berubah';
		message = 'Data permintaan berubah. Pilih ulang sesi atau ambil data terbaru, lalu coba lagi.';
	} else if (isRequestKeyExpired) {
		title = 'Ada permintaan yang lebih baru';
		message =
			'Draf sudah dibuat ulang dari tempat lain. Ambil laporan terbaru sebelum melanjutkan.';
	} else if (isVersionConflict) {
		title = 'Laporan sudah diubah';
		message =
			'Laporan diubah dari tempat lain. Ambil data terbaru, lalu simpan lagi. Isianmu belum hilang.';
	} else if (isStaleReport) {
		title = 'Temuan sumber berubah';
		message = 'Temuan berubah sejak draf dibuat. Buat ulang draf sebelum menyetujuinya.';
	} else if (isReportLocked) {
		title = 'Laporan terkunci';
		message = 'Laporan sudah disetujui. Laporan tidak bisa diubah, dibuat ulang, atau dihapus.';
	} else if (apiErr.status === 422 || code === 'VALIDATION_ERROR') {
		title = 'Periksa isian laporan';
		const firstFieldMsg = Object.values(fieldErrors)[0];
		if (firstFieldMsg) {
			message = firstFieldMsg;
		}
	}

	return {
		status: apiErr.status,
		code,
		title,
		message,
		fieldErrors,
		requestId: apiErr.requestId,
		isUnauthorized,
		isForbidden,
		isSessionStillActive,
		isNoConfirmedFindings,
		isReportExists,
		isGeminiUnavailable,
		isInvalidGeminiOutput,
		isSourceChanged,
		isIdempotencyConflict,
		isRequestKeyExpired,
		isVersionConflict,
		isStaleReport,
		isReportLocked,
		isNetworkError
	};
}
