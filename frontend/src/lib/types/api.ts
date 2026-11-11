export type SystemMode = 'real' | 'simulated' | 'manual';

export type ViolationType = 'NO_HELMET' | 'NO_VEST';

export interface User {
	id: number;
	display_name: string;
	role: string;
}

export interface AuthSessionPayload {
	user: User;
	csrf_token: string;
}

export interface SystemStatus {
	mode: SystemMode;
	ai_reachable: boolean;
	ai_ready: boolean;
	model_version: string | null;
	supported_violations: ViolationType[];
	gemini_configured: boolean;
}

export interface HealthStatus {
	status: string;
}

export interface PageMeta {
	page: number;
	page_size: number;
	total: number;
}

export interface ApiEnvelope<T> {
	data: T;
}

export interface ApiListEnvelope<T> {
	data: T[];
	meta: PageMeta;
}

export interface ApiErrorBody {
	code: string;
	message: string;
	fields?: Record<string, string>;
	request_id?: string;
}

export interface ApiErrorEnvelope {
	error: ApiErrorBody;
}
