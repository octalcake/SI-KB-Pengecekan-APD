import type { SystemMode, ViolationType } from '#lib/shared/domain/types';
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

export type AuthBootstrapStatus = 'idle' | 'checking' | 'authenticated' | 'unauthenticated' | 'error';
