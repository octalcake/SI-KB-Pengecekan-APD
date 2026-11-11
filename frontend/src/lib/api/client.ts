import type {
	ApiEnvelope,
	ApiErrorEnvelope,
	ApiListEnvelope,
	AuthSessionPayload,
	HealthStatus,
	SystemStatus
} from '#lib/types/api';

export const API_BASE = '/api/v1';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

let currentCsrfToken: string | null = null;
let unauthorizedListener: (() => void) | null = null;

export function getCsrfToken(): string | null {
	return currentCsrfToken;
}

export function setCsrfToken(token: string | null): void {
	currentCsrfToken = token;
}

export function onUnauthorized(listener: (() => void) | null): void {
	unauthorizedListener = listener;
}

export interface ApiErrorInit {
	status: number;
	code: string;
	message: string;
	fields?: Record<string, string>;
	requestId?: string | null;
	retryAfter?: number | null;
	isNetworkError?: boolean;
}

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly fields: Record<string, string>;
	readonly requestId: string | null;
	readonly retryAfter: number | null;
	readonly isNetworkError: boolean;

	constructor(init: ApiErrorInit) {
		super(init.message);
		this.name = 'ApiError';
		this.status = init.status;
		this.code = init.code;
		this.fields = init.fields ?? {};
		this.requestId = init.requestId ?? null;
		this.retryAfter = init.retryAfter ?? null;
		this.isNetworkError = init.isNetworkError ?? false;
	}
}

export function isApiError(err: unknown): err is ApiError {
	return err instanceof ApiError;
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
	body?: unknown;
	skipCsrf?: boolean;
	skipAuthInvalidation?: boolean;
}

function isBinaryOrFormBody(body: unknown): body is BodyInit {
	return (
		typeof body === 'string' ||
		body instanceof FormData ||
		body instanceof Blob ||
		body instanceof ArrayBuffer ||
		ArrayBuffer.isView(body) ||
		body instanceof URLSearchParams
	);
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
	const method = (options.method ?? 'GET').toUpperCase();
	const normalizedPath = path.startsWith('/') ? path : `/${path}`;
	const url = normalizedPath.startsWith(API_BASE) ? normalizedPath : `${API_BASE}${normalizedPath}`;

	const headers = new Headers(options.headers);
	if (MUTATING_METHODS.has(method) && !options.skipCsrf && currentCsrfToken) {
		headers.set('X-CSRF-Token', currentCsrfToken);
	}

	let bodyInit: BodyInit | undefined;
	if (options.body !== undefined && options.body !== null) {
		if (isBinaryOrFormBody(options.body)) {
			bodyInit = options.body;
		} else {
			if (!headers.has('Content-Type')) {
				headers.set('Content-Type', 'application/json');
			}
			bodyInit = JSON.stringify(options.body);
		}
	}

	let response: Response;
	try {
		response = await fetch(url, {
			...options,
			method,
			headers,
			body: bodyInit,
			credentials: 'same-origin'
		});
	} catch {
		throw new ApiError({
			status: 0,
			code: 'BACKEND_UNREACHABLE',
			message:
				'Layanan backend tidak dapat dihubungi. Pastikan server Go berjalan lalu coba lagi.',
			isNetworkError: true
		});
	}

	if (response.status === 204) {
		return undefined as T;
	}

	const rawText = await response.text();
	const headerRequestId = response.headers.get('X-Request-ID');
	const retryAfterHeader = response.headers.get('Retry-After');
	const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : null;

	let parsed: unknown = null;
	if (rawText.length > 0) {
		try {
			parsed = JSON.parse(rawText);
		} catch {
			parsed = null;
		}
	}

	if (!response.ok) {
		const errEnvelope =
			parsed && typeof parsed === 'object' && 'error' in parsed
				? (parsed as ApiErrorEnvelope).error
				: undefined;

		if (
			response.status === 401 &&
			!options.skipAuthInvalidation &&
			normalizedPath !== '/auth/login'
		) {
			setCsrfToken(null);
			unauthorizedListener?.();
		}

		if (errEnvelope && typeof errEnvelope.code === 'string') {
			throw new ApiError({
				status: response.status,
				code: errEnvelope.code,
				message: errEnvelope.message || `Permintaan gagal (HTTP ${response.status}).`,
				fields: errEnvelope.fields,
				requestId: errEnvelope.request_id ?? headerRequestId,
				retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
				isNetworkError: false
			});
		}

		const isProxyOrBackendDown = response.status >= 500 && !headerRequestId;
		throw new ApiError({
			status: response.status,
			code: isProxyOrBackendDown ? 'BACKEND_UNREACHABLE' : `HTTP_${response.status}`,
			message: isProxyOrBackendDown
				? 'Layanan backend tidak dapat dihubungi. Pastikan server Go berjalan lalu coba lagi.'
				: `Layanan mengembalikan kesalahan HTTP ${response.status}.`,
			requestId: headerRequestId,
			retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
			isNetworkError: isProxyOrBackendDown
		});
	}

	if (parsed === null) {
		throw new ApiError({
			status: response.status,
			code: 'INVALID_RESPONSE',
			message: 'Respons server bukan JSON yang valid.',
			requestId: headerRequestId
		});
	}

	return parsed as T;
}

export async function apiData<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
	const envelope = await apiRequest<ApiEnvelope<T>>(path, options);
	return envelope.data;
}

export async function apiList<T>(
	path: string,
	options: ApiRequestOptions = {}
): Promise<ApiListEnvelope<T>> {
	return apiRequest<ApiListEnvelope<T>>(path, options);
}

export async function apiNoContent(path: string, options: ApiRequestOptions = {}): Promise<void> {
	await apiRequest<void>(path, options);
}

export async function loginApi(username: string, password: string): Promise<AuthSessionPayload> {
	return apiData<AuthSessionPayload>('/auth/login', {
		method: 'POST',
		body: { username, password },
		skipCsrf: true,
		skipAuthInvalidation: true
	});
}

export async function meApi(): Promise<AuthSessionPayload> {
	return apiData<AuthSessionPayload>('/auth/me', {
		method: 'GET',
		skipAuthInvalidation: true
	});
}

export async function logoutApi(): Promise<void> {
	await apiNoContent('/auth/logout', {
		method: 'POST',
		skipAuthInvalidation: true
	});
}

export async function systemStatusApi(): Promise<SystemStatus> {
	return apiData<SystemStatus>('/system/status', {
		method: 'GET'
	});
}

export async function healthApi(): Promise<HealthStatus> {
	return apiData<HealthStatus>('/health', {
		method: 'GET',
		skipAuthInvalidation: true
	});
}
