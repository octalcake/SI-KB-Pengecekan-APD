import type { AuthWorkflow } from '../application/auth-workflow';
import type { AuthBootstrapStatus, SystemStatus, User } from '../domain/types';

export function createAuthSessionStore(workflow: AuthWorkflow) {
	let status = $state<AuthBootstrapStatus>('idle');
	let user = $state<User | null>(null);
	let csrfToken = $state<string | null>(null);
	let systemStatus = $state<SystemStatus | null>(null);
	let systemStatusLoading = $state(false);
	let systemStatusError = $state<string | null>(null);
	let bootstrapError = $state<string | null>(null);
	let sessionNotice = $state<string | null>(null);

	let inflightBootstrap: Promise<AuthBootstrapStatus> | null = null;
	let beforeLogoutCallback: (() => Promise<void>) | null = null;

	function clearSession(notice: string | null = null): void {
		workflow.hooks.setCsrfToken(null);
		user = null;
		csrfToken = null;
		systemStatus = null;
		systemStatusLoading = false;
		systemStatusError = null;
		bootstrapError = null;
		sessionNotice = notice;
		status = 'unauthenticated';
	}

	workflow.hooks.onUnauthorized(() => {
		clearSession('Sesi Anda telah berakhir. Silakan masuk kembali.');
	});

	async function refreshSystemStatus(): Promise<SystemStatus | null> {
		if(status !== 'authenticated') {
			return null;
		}
		systemStatusLoading = true;
		systemStatusError = null;
		try {
			const outcome = await workflow.runRefreshSystemStatus();
			if(outcome.ok) {
				systemStatus = outcome.systemStatus;
				return outcome.systemStatus;
			}
			systemStatusError = outcome.errorMessage;
			return null;
		} finally {
			systemStatusLoading = false;
		}
	}

	return {
		get status() {
			return status;
		},
		get user() {
			return user;
		},
		get csrfToken() {
			return csrfToken;
		},
		get systemStatus() {
			return systemStatus;
		},
		get systemStatusLoading() {
			return systemStatusLoading;
		},
		get systemStatusError() {
			return systemStatusError;
		},
		get bootstrapError() {
			return bootstrapError;
		},
		get sessionNotice() {
			return sessionNotice;
		},

		registerBeforeLogout(callback: (() => Promise<void>) | null): () => void {
			beforeLogoutCallback = callback;
			return () => {
				if(beforeLogoutCallback === callback) {
					beforeLogoutCallback = null;
				}
			};
		},

		clearSession,

		async bootstrap(force = false): Promise<AuthBootstrapStatus> {
			if(!force && (status === 'authenticated' || status === 'unauthenticated')) {
				return status;
			}
			if(inflightBootstrap && !force) {
				return inflightBootstrap;
			}

			status = 'checking';
			bootstrapError = null;

			const run = (async (): Promise<AuthBootstrapStatus> => {
				try {
					const outcome = await workflow.runBootstrap();
					if(outcome.status === 'authenticated') {
						user = outcome.user;
						csrfToken = outcome.csrfToken;
						sessionNotice = null;
						status = 'authenticated';
						await refreshSystemStatus();
						return 'authenticated';
					}
					if(outcome.status === 'unauthenticated') {
						clearSession(sessionNotice);
						return 'unauthenticated';
					}
					user = null;
					csrfToken = null;
					systemStatus = null;
					bootstrapError = outcome.errorMessage;
					status = 'error';
					return 'error';
				} finally {
					inflightBootstrap = null;
				}
			})();

			inflightBootstrap = run;
			return run;
		},

		async login(username: string, password: string): Promise<User> {
			const session = await workflow.runLogin(username, password);
			user = session.user;
			csrfToken = session.csrf_token;
			bootstrapError = null;
			sessionNotice = null;
			status = 'authenticated';
			await refreshSystemStatus();
			return session.user;
		},

		refreshSystemStatus,

		async logout(): Promise<void> {
			const outcome = await workflow.runLogout(beforeLogoutCallback);
			if(outcome.cleared) {
				clearSession(null);
				return;
			}
			throw outcome.error;
		}
	};
}
