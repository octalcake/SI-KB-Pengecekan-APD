import { isApiError } from '#lib/shared/errors';
import type {
	AuthSessionPayload,
	HealthStatus,
	SystemStatus,
	User
} from '../domain/types';

export interface AuthApiContract {
	login(username: string, password: string): Promise<AuthSessionPayload>;
	me(): Promise<AuthSessionPayload>;
	logout(): Promise<void>;
	getSystemStatus(): Promise<SystemStatus>;
	getHealth(): Promise<HealthStatus>;
}

export interface AuthTransportHooks {
	setCsrfToken(token: string | null): void;
	onUnauthorized(listener: (() => void) | null): void;
}

export type BootstrapOutcome =
	| {
		status: 'authenticated';
		user: User;
		csrfToken: string;
	}
	| {
		status: 'unauthenticated';
	}
	| {
		status: 'error';
		errorMessage: string;
	};

export type SystemStatusOutcome =
	| {
		ok: true;
		systemStatus: SystemStatus;
	}
	| {
		ok: false;
		errorMessage: string;
	};

export type LogoutOutcome =
	| {
		cleared: true;
	}
	| {
		cleared: false;
		error: unknown;
	};

export interface AuthWorkflow {
	readonly hooks: AuthTransportHooks;
	runBootstrap(): Promise<BootstrapOutcome>;
	runLogin(username: string, password: string): Promise<AuthSessionPayload>;
	runRefreshSystemStatus(): Promise<SystemStatusOutcome>;
	runLogout(beforeLogout: (() => Promise<void>) | null): Promise<LogoutOutcome>;
}

export function createAuthWorkflow(
	api: AuthApiContract,
	hooks: AuthTransportHooks
): AuthWorkflow {
	return {
		hooks,
		async runBootstrap(): Promise<BootstrapOutcome> {
			try {
				const session = await api.me();
				hooks.setCsrfToken(session.csrf_token);
				return {
					status: 'authenticated',
					user: session.user,
					csrfToken: session.csrf_token
				};
			} catch(err) {
				hooks.setCsrfToken(null);
				if(isApiError(err) && err.status === 401) {
					return { status: 'unauthenticated' };
				}
				return {
					status: 'error',
					errorMessage: isApiError(err)
						? err.message
						: 'Gagal memeriksa sesi ke server backend.'
				};
			}
		},

		async runLogin(username: string, password: string): Promise<AuthSessionPayload> {
			const session = await api.login(username, password);
			hooks.setCsrfToken(session.csrf_token);
			return session;
		},

		async runRefreshSystemStatus(): Promise<SystemStatusOutcome> {
			try {
				const systemStatus = await api.getSystemStatus();
				return { ok: true, systemStatus };
			} catch(err) {
				return {
					ok: false,
					errorMessage: isApiError(err)
						? err.message
						: 'Gagal memuat status kesiapan sistem.'
				};
			}
		},

		async runLogout(beforeLogout: (() => Promise<void>) | null): Promise<LogoutOutcome> {
			if(beforeLogout) {
				try {
					await beforeLogout();
				} catch {
					// Best-effort pre-logout cleanup: never block logout on stop failure
				}
			}

			try {
				await api.logout();
				hooks.setCsrfToken(null);
				return { cleared: true };
			} catch(err) {
				if(isApiError(err) && err.status === 401) {
					hooks.setCsrfToken(null);
					return { cleared: true };
				}
				return { cleared: false, error: err };
			}
		}
	};
}
