import { isFindingApiError, type SharedApiErrorLike } from './api';
import type {
	ActionStatus,
	BBox,
	FindingSource,
	SystemMode,
	VerificationStatus,
	ViolationType
} from './types';

export function formatViolationLabel(type: ViolationType | string | null | undefined): string {
	if (type === 'NO_HELMET') return 'Indikasi Tanpa Helm (NO_HELMET)';
	if (type === 'NO_VEST') return 'Indikasi Tanpa Rompi (NO_VEST)';
	if (!type) return 'Tidak ada deteksi otomatis';
	return String(type);
}

export function formatViolationShortLabel(type: ViolationType | string | null | undefined): string {
	if (type === 'NO_HELMET') return 'Tanpa Helm';
	if (type === 'NO_VEST') return 'Tanpa Rompi';
	if (!type) return 'Manual / Kosong';
	return String(type);
}

export function formatVerificationStatusLabel(status: VerificationStatus | string): string {
	switch (status) {
		case 'pending':
			return 'Menunggu Verifikasi';
		case 'confirmed':
			return 'Terkonfirmasi';
		case 'rejected':
			return 'Ditolak';
		default:
			return status;
	}
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
			return status;
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

export function formatSourceLabel(source: FindingSource | string): string {
	if (source === 'auto') return 'Otomatis (Konfirmasi Temporal)';
	if (source === 'manual') return 'Observasi Manual Petugas';
	return String(source);
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

/**
 * Converts a local date string `YYYY-MM-DD` (or `YYYY-MM-DDTHH:mm`) in Asia/Jakarta (+07:00)
 * to a UTC RFC3339 timestamp with `Z` suffix as required by Go `timeParam` (SRS §9.1).
 * `from` is inclusive (`00:00:00.000+07:00`), `to` is exclusive next-day start (`00:00:00.000+07:00` + 1 day) when date-only.
 */
export function localFilterDateToUtcRfc3339(
	value: string,
	bound: 'from' | 'to'
): string {
	const trimmed = value.trim();
	if (!trimmed) return '';

	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		const startJakarta = new Date(`${trimmed}T00:00:00.000+07:00`);
		if (Number.isNaN(startJakarta.getTime())) return '';
		if (bound === 'to') {
			const nextDay = new Date(startJakarta.getTime() + 24 * 60 * 60 * 1000);
			return nextDay.toISOString();
		}
		return startJakarta.toISOString();
	}

	if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
		const withSec = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
		const dt = new Date(`${withSec}+07:00`);
		if (Number.isNaN(dt.getTime())) return '';
		return dt.toISOString();
	}

	const parsed = new Date(trimmed);
	if (Number.isNaN(parsed.getTime())) return trimmed;
	return parsed.toISOString();
}

export function normalizeBBox(raw: unknown): BBox | null {
	if (!Array.isArray(raw) || raw.length !== 4) return null;
	const nums = raw.map((n) => Number(n));
	if (nums.some((n) => !Number.isFinite(n))) return null;
	const [xMin, yMin, xMax, yMax] = nums;
	if (xMin < 0 || yMin < 0 || xMax > 1 || yMax > 1 || xMin >= xMax || yMin >= yMax) {
		return null;
	}
	return [xMin, yMin, xMax, yMax];
}

export function bboxToPercentStyle(bbox: BBox): string {
	const [xMin, yMin, xMax, yMax] = bbox;
	const left = (xMin * 100).toFixed(2);
	const top = (yMin * 100).toFixed(2);
	const width = ((xMax - xMin) * 100).toFixed(2);
	const height = ((yMax - yMin) * 100).toFixed(2);
	return `left: ${left}%; top: ${top}%; width: ${width}%; height: ${height}%;`;
}

export function formatConfidenceScore(confidence: number | null | undefined): string {
	if (confidence === null || confidence === undefined || !Number.isFinite(confidence)) {
		return 'Tidak ada (pencatatan manual)';
	}
	return `${(confidence * 100).toFixed(1)}% (${confidence.toFixed(2)} — skor indikasi model, bukan kepastian pelanggaran)`;
}

export function translateFieldError(field: string, reason: string): string {
	const r = reason.trim().toLowerCase();
	if (field === 'notes') {
		if (r.includes('required when rejected')) {
			return 'Alasan penolakan wajib diisi pada catatan verifikasi.';
		}
		if (r.includes('reason required to correct')) {
			return 'Catatan alasan koreksi wajib diisi saat mengubah keputusan verifikasi sebelumnya.';
		}
		if (r.includes('max') || r.includes('2000')) {
			return 'Catatan verifikasi maksimal 2.000 karakter.';
		}
		return `Catatan verifikasi tidak valid (${reason}).`;
	}
	if (field === 'action_notes') {
		if (r.includes('required when completed')) {
			return 'Catatan tindak lanjut wajib diisi sebelum menandai tindak lanjut selesai.';
		}
		if (r.includes('max') || r.includes('2000')) {
			return 'Catatan tindak lanjut maksimal 2.000 karakter.';
		}
		return `Catatan tindak lanjut tidak valid (${reason}).`;
	}
	if (field === 'violation_type') {
		return 'Jenis indikasi APD wajib dipilih (NO_HELMET atau NO_VEST).';
	}
	if (field === 'verification_status') {
		return 'Status keputusan verifikasi harus Dikonfirmasi atau Ditolak.';
	}
	if (field === 'action_status') {
		return 'Status tindak lanjut tidak valid.';
	}
	if (field === 'session_id') {
		return 'Sesi mode manual yang sudah ditutup wajib dipilih.';
	}
	if (field === 'evidence') {
		return 'File foto bukti JPEG wajib dilampirkan.';
	}
	if (field === 'version') {
		return 'Versi data (version) wajib disertakan untuk mencegah konflik perubahan.';
	}
	return `${field}: ${reason}`;
}

export interface ParsedFindingError {
	status: number;
	code: string;
	title: string;
	message: string;
	fieldErrors: Record<string, string>;
	requestId: string | null;
	isUnauthorized: boolean;
	isForbidden: boolean;
	isManualFallbackDisabled: boolean;
	isEvidenceMissing: boolean;
	isVersionConflict: boolean;
	isReportLocked: boolean;
	isFindingConfirmedDeleteLock: boolean;
	isActionRequiresConfirmed: boolean;
	isSessionNotManual: boolean;
	isNetworkError: boolean;
	isSharedFoundationMissing: boolean;
}

export function parseFindingApiError(
	err: unknown,
	fallbackMessage = 'Terjadi kesalahan saat memproses permintaan temuan.'
): ParsedFindingError {
	if (!isFindingApiError(err)) {
		return {
			status: 0,
			code: 'UNKNOWN_ERROR',
			title: 'Kesalahan Aplikasi',
			message: err instanceof Error && err.message ? err.message : fallbackMessage,
			fieldErrors: {},
			requestId: null,
			isUnauthorized: false,
			isForbidden: false,
			isManualFallbackDisabled: false,
			isEvidenceMissing: false,
			isVersionConflict: false,
			isReportLocked: false,
			isFindingConfirmedDeleteLock: false,
			isActionRequiresConfirmed: false,
			isSessionNotManual: false,
			isNetworkError: false,
			isSharedFoundationMissing: false
		};
	}

	const apiErr: SharedApiErrorLike = err;
	const fieldErrors: Record<string, string> = {};
	if (apiErr.fields) {
		for (const [key, val] of Object.entries(apiErr.fields)) {
			fieldErrors[key] = translateFieldError(key, val);
		}
	}

	const code = apiErr.code || `HTTP_${apiErr.status}`;
	const isUnauthorized = apiErr.status === 401;
	const isManualFallbackDisabled =
		apiErr.status === 403 && code === 'MANUAL_FALLBACK_DISABLED';
	const isForbidden = apiErr.status === 403;
	const isEvidenceMissing = apiErr.status === 410 || code === 'EVIDENCE_MISSING';
	const isVersionConflict = apiErr.status === 409 && code === 'VERSION_CONFLICT';
	const isReportLocked = apiErr.status === 409 && code === 'REPORT_LOCKED';
	const isFindingConfirmedDeleteLock =
		apiErr.status === 409 && code === 'FINDING_CONFIRMED';
	const isActionRequiresConfirmed =
		apiErr.status === 422 && code === 'ACTION_REQUIRES_CONFIRMED';
	const isSessionNotManual = apiErr.status === 422 && code === 'SESSION_NOT_MANUAL';
	const isNetworkError = Boolean(apiErr.isNetworkError || apiErr.status === 0 || code === 'BACKEND_UNREACHABLE');
	const isSharedFoundationMissing = code === 'SHARED_FOUNDATION_MISSING';

	let title = 'Permintaan Gagal';
	let message = apiErr.message || fallbackMessage;

	if (isSharedFoundationMissing) {
		title = 'Prasyarat Modul Fondasi Belum Terintegrasi';
	} else if (isNetworkError) {
		title = 'Layanan Backend Tidak Terjangkau';
		message =
			apiErr.message ||
			'Tidak dapat terhubung ke server Go (/api/v1). Input Anda tetap tersimpan di layar; periksa koneksi atau proses backend lalu coba lagi.';
	} else if (isUnauthorized) {
		title = 'Sesi Autentikasi Berakhir (401)';
		message =
			'Sesi login Anda tidak valid atau telah berakhir. Catatan yang belum disimpan tetap ada di halaman ini; silakan masuk kembali.';
	} else if (isManualFallbackDisabled) {
		title = 'Pencatatan Manual Dinonaktifkan Server (403)';
		message =
			apiErr.message ||
			'Fitur pencatatan temuan manual tidak diaktifkan pada konfigurasi server (ALLOW_MANUAL_FALLBACK=false).';
	} else if (isForbidden) {
		title = 'Akses Ditolak (403)';
		message =
			apiErr.message ||
			'Permintaan ditolak oleh server (token CSRF tidak cocok atau hak akses tidak terpenuhi).';
	} else if (isEvidenceMissing) {
		title = 'File Bukti Asli Tidak Ditemukan (410)';
		message =
			apiErr.message ||
			'File foto bukti asli tidak ditemukan di penyimpanan server (EVIDENCE_MISSING). Sistem tidak mengganti foto yang hilang dengan gambar lain.';
	} else if (isVersionConflict) {
		title = 'Konflik Versi Data (409 VERSION_CONFLICT)';
		message =
			'Data temuan ini telah diubah di tab atau proses lain. Input Anda dipertahankan di formulir; muat ulang data terbaru sebelum menyimpan ulang.';
	} else if (isReportLocked) {
		title = 'Terkunci oleh Laporan Disetujui (409 REPORT_LOCKED)';
		message =
			apiErr.message ||
			'Temuan ini sudah menjadi bagian dari snapshot laporan inspeksi yang telah disetujui (approved) dan tidak dapat diubah atau dihapus.';
	} else if (isFindingConfirmedDeleteLock) {
		title = 'Temuan Terkonfirmasi Tidak Dapat Dihapus Langsung (409)';
		message =
			apiErr.message ||
			'Temuan berstatus Terkonfirmasi harus dikoreksi menjadi Ditolak terlebih dahulu dengan alasan sebelum dapat dihapus.';
	} else if (isActionRequiresConfirmed) {
		title = 'Tindak Lanjut Membutuhkan Konfirmasi (422)';
		message =
			apiErr.message ||
			'Tindak lanjut hanya dapat dicatat untuk temuan yang sudah berstatus Terkonfirmasi.';
	} else if (isSessionNotManual) {
		title = 'Sesi Tidak Memenuhi Syarat Manual (422)';
		message =
			apiErr.message ||
			'Temuan manual hanya dapat ditambahkan ke sesi bermode manual yang sudah ditutup (stopped/interrupted).';
	} else if (apiErr.status === 422 || code === 'VALIDATION_ERROR') {
		title = 'Validasi Input Gagal (422)';
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
		isManualFallbackDisabled,
		isEvidenceMissing,
		isVersionConflict,
		isReportLocked,
		isFindingConfirmedDeleteLock,
		isActionRequiresConfirmed,
		isSessionNotManual,
		isNetworkError,
		isSharedFoundationMissing
	};
}
