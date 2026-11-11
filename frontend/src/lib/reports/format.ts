import { isReportApiError, type SharedApiErrorLike } from './api';
import type {
	ActionStatus,
	ReportGeneratedBy,
	ReportStatus,
	SessionStatus,
	SystemMode,
	ViolationType
} from './types';

export function formatReportStatusLabel(status: ReportStatus | string): string {
	switch (status) {
		case 'draft':
			return 'Draft (Belum Disetujui)';
		case 'approved':
			return 'Disetujui (Terkunci)';
		default:
			return String(status);
	}
}

export function formatReportStatusShortLabel(status: ReportStatus | string): string {
	switch (status) {
		case 'draft':
			return 'Draft';
		case 'approved':
			return 'Disetujui';
		default:
			return String(status);
	}
}

export function formatGeneratedByLabel(generatedBy: ReportGeneratedBy | string): string {
	switch (generatedBy) {
		case 'gemini':
			return 'Dihasilkan Gemini (Teks Terkonfirmasi Ter-sanitasi)';
		case 'template':
			return 'Draft Template Aplikasi (Bukan Output Gemini)';
		case 'manual':
			return 'Draft Manual Petugas (Bukan Output Gemini)';
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
			return 'Aktif (Belum Ditutup)';
		case 'stopped':
			return 'Selesai Ditutup (Stopped)';
		case 'interrupted':
			return 'Terhenti (Interrupted)';
		default:
			return String(status);
	}
}

export function formatViolationLabel(type: ViolationType | string | null | undefined): string {
	if (type === 'NO_HELMET') return 'Indikasi Tanpa Helm (NO_HELMET)';
	if (type === 'NO_VEST') return 'Indikasi Tanpa Rompi (NO_VEST)';
	if (!type) return 'Tidak diketahui';
	return String(type);
}

export function formatActionStatusLabel(status: ActionStatus | string): string {
	switch (status) {
		case 'pending':
			return 'Belum Ditindaklanjuti';
		case 'in_progress':
			return 'Sedang Ditindaklanjuti';
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
		return 'Sesi monitoring yang sudah ditutup dan memiliki temuan terkonfirmasi wajib dipilih.';
	}
	if (field === 'request_key') {
		return 'Kunci operasi (request_key) harus berupa UUID v4 yang valid.';
	}
	if (field === 'title') {
		if (r.includes('max') || r.includes('200')) {
			return 'Judul laporan wajib diisi (1–200 karakter).';
		}
		return `Judul laporan wajib diisi (1–200 karakter).`;
	}
	if (field === 'content') {
		if (r.includes('max') || r.includes('20000')) {
			return 'Isi narasi laporan wajib diisi (1–20.000 karakter).';
		}
		return 'Isi narasi laporan wajib diisi (1–20.000 karakter).';
	}
	if (field === 'use_template') {
		return 'Pembuatan draft template tidak boleh digabungkan dengan input judul/isi manual.';
	}
	if (field === 'review_acknowledged') {
		return 'Anda wajib mencentang pernyataan bahwa narasi dan snapshot temuan telah ditinjau sebelum menyetujui laporan.';
	}
	if (field === 'version') {
		return 'Versi laporan (version) wajib disertakan untuk mencegah konflik perubahan.';
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
			title: 'Kesalahan Aplikasi',
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
		title = 'Layanan Backend Tidak Terjangkau / Respons Hilang';
		message =
			apiErr.message ||
			'Tidak dapat menerima respons dari server Go (/api/v1). Perubahan yang belum disimpan tetap ada di layar; kunci operasi (request_key) dipertahankan untuk pemulihan tanpa duplikasi.';
	} else if (isUnauthorized) {
		title = 'Sesi Autentikasi Berakhir (401)';
		message =
			'Sesi login Anda telah berakhir. Perubahan narasi yang belum disimpan tetap dipertahankan di layar; silakan masuk kembali.';
	} else if (isForbidden) {
		title = 'Akses Ditolak (403)';
		message =
			apiErr.message ||
			'Permintaan ditolak oleh server (token CSRF tidak cocok atau akses tidak diizinkan).';
	} else if (isSessionStillActive) {
		title = 'Sesi Monitoring Masih Aktif (409 SESSION_STILL_ACTIVE)';
		message =
			apiErr.message ||
			'Hentikan sesi monitoring terlebih dahulu sebelum membuat laporan untuk sesi ini.';
	} else if (isNoConfirmedFindings) {
		title = 'Belum Ada Temuan Terkonfirmasi (422 NO_CONFIRMED_FINDINGS)';
		message =
			apiErr.message ||
			'Laporan hanya dapat dibuat dari sesi tertutup yang memiliki minimal 1 temuan berstatus Terkonfirmasi petugas.';
	} else if (isReportExists) {
		title = 'Laporan untuk Sesi Ini Sudah Ada (409 REPORT_EXISTS)';
		message =
			apiErr.message ||
			'Sesi ini sudah memiliki laporan aktif. Satu sesi hanya boleh memiliki satu laporan aktif; buka laporan yang sudah ada.';
	} else if (isGeminiUnavailable) {
		title = 'Layanan Gemini Tidak Tersedia (503 GEMINI_UNAVAILABLE)';
		message =
			apiErr.message ||
			'Layanan Gemini tidak tersedia atau belum dikonfigurasi pada server. Draft yang ada tetap aman; Anda dapat mencoba lagi atau membuat draft Template / Manual secara eksplisit.';
	} else if (isInvalidGeminiOutput) {
		title = 'Output Gemini Tidak Valid (502 INVALID_GEMINI_OUTPUT)';
		message =
			apiErr.message ||
			'Output dari layanan Gemini tidak memenuhi struktur atau referensi temuan yang diwajibkan. Draft lama tetap dipertahankan; coba lagi atau gunakan draft Template / Manual.';
	} else if (isSourceChanged) {
		title = 'Sumber Temuan Berubah Saat Pembuatan Draft (409 SOURCE_CHANGED)';
		message =
			apiErr.message ||
			'Data temuan sumber berubah selama proses pembuatan narasi berlangsung. Draft lama dipertahankan; muat ulang dan coba lagi dengan kunci operasi baru.';
	} else if (isIdempotencyConflict) {
		title = 'Konflik Kunci Operasi Idempotensi (409 IDEMPOTENCY_CONFLICT)';
		message =
			apiErr.message ||
			'request_key sudah pernah digunakan dengan payload/input yang berbeda. Gunakan kunci operasi baru.';
	} else if (isRequestKeyExpired) {
		title = 'Kunci Operasi Sudah Digantikan (409 REQUEST_KEY_EXPIRED)';
		message =
			apiErr.message ||
			'request_key lama sudah digantikan oleh proses regenerate yang lebih baru. Muat ulang laporan terbaru.';
	} else if (isVersionConflict) {
		title = 'Konflik Versi Laporan (409 VERSION_CONFLICT)';
		message =
			'Laporan ini telah diubah di tab atau proses lain. Suntingan narasi Anda tetap dipertahankan di formulir; muat ulang versi terbaru sebelum menyimpan kembali.';
	} else if (isStaleReport) {
		title = 'Sumber Temuan Sudah Berubah / Stale (409 STALE_REPORT)';
		message =
			apiErr.message ||
			'Data temuan sumber pada sesi ini telah berubah sejak snapshot laporan dibuat. Laporan yang stale tidak dapat disetujui; lakukan Regenerate atau buat ulang draft terlebih dahulu.';
	} else if (isReportLocked) {
		title = 'Laporan Sudah Disetujui dan Terkunci (409 REPORT_LOCKED)';
		message =
			apiErr.message ||
			'Laporan yang telah disetujui bersifat permanen (immutable) dan tidak dapat diubah, di-regenerate, atau dihapus.';
	} else if (apiErr.status === 422 || code === 'VALIDATION_ERROR') {
		title = 'Validasi Input Laporan Gagal (422)';
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
