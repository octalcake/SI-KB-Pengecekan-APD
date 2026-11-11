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
