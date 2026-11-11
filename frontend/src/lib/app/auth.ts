import { createAuthWorkflow } from '#lib/features/auth/application/auth-workflow';
import { createAuthSessionStore } from '#lib/features/auth/presentation/session.svelte';
import { loginApi, meApi, logoutApi, systemStatusApi, healthApi } from '#lib/features/auth/infrastructure/http-adapter';
import { setCsrfToken, onUnauthorized } from '#lib/shared/http/client';

export const authSession = createAuthSessionStore(createAuthWorkflow({
	login: loginApi, me: meApi, logout: logoutApi, getSystemStatus: systemStatusApi, getHealth: healthApi
}, { setCsrfToken, onUnauthorized }));
