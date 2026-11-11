import { apiData, apiNoContent } from '#lib/shared/http/client';
import type { AuthSessionPayload, SystemStatus, HealthStatus } from '../domain/types';
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
