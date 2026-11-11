import {
	isApiError,
	loginApi,
	logoutApi,
	meApi,
	onUnauthorized,
	setCsrfToken,
	systemStatusApi
} from '#lib/api/client';
import type { SystemStatus, User } from '#lib/types/api';

export type AuthBootstrapStatus =
	| 'idle'
	| 'checking'
	| 'authenticated'
	| 'unauthenticated'
	| 'error';

class AuthSessionStore {
	status = $state<AuthBootstrapStatus>('idle');
	user = $state<User | null>(null);
	csrfToken = $state<string | null>(null);
	systemStatus = $state<SystemStatus | null>(null);
	systemStatusLoading = $state(false);
	systemStatusError = $state<string | null>(null);
	bootstrapError = $state<string | null>(null);
	sessionNotice = $state<string | null>(null);

	private inflightBootstrap: Promise<AuthBootstrapStatus> | null = null;
	private beforeLogoutCallback: (() => Promise<void>) | null = null;

	constructor() {
		onUnauthorized(() => {
			this.clearSession('Sesi Anda telah berakhir. Silakan masuk kembali.');
		});
	}

	registerBeforeLogout(callback: (() => Promise<void>) | null): () => void {
		this.beforeLogoutCallback = callback;
		return () => {
			if (this.beforeLogoutCallback === callback) {
				this.beforeLogoutCallback = null;
			}
		};
	}

	clearSession(notice: string | null = null): void {
		setCsrfToken(null);
		this.user = null;
		this.csrfToken = null;
		this.systemStatus = null;
		this.systemStatusLoading = false;
		this.systemStatusError = null;
		this.bootstrapError = null;
		this.sessionNotice = notice;
		this.status = 'unauthenticated';
	}

	async bootstrap(force = false): Promise<AuthBootstrapStatus> {
		if (!force && (this.status === 'authenticated' || this.status === 'unauthenticated')) {
			return this.status;
		}
		if (this.inflightBootstrap && !force) {
			return this.inflightBootstrap;
		}

		this.status = 'checking';
		this.bootstrapError = null;

		const run = (async (): Promise<AuthBootstrapStatus> => {
			try {
				const session = await meApi();
				setCsrfToken(session.csrf_token);
				this.user = session.user;
				this.csrfToken = session.csrf_token;
				this.sessionNotice = null;
				this.status = 'authenticated';
				await this.refreshSystemStatus();
				return 'authenticated';
			} catch (err) {
				if (isApiError(err) && err.status === 401) {
					this.clearSession(this.sessionNotice);
					return 'unauthenticated';
				}
				setCsrfToken(null);
				this.user = null;
				this.csrfToken = null;
				this.systemStatus = null;
				this.bootstrapError = isApiError(err)
					? err.message
					: 'Gagal memeriksa sesi ke server backend.';
				this.status = 'error';
				return 'error';
			} finally {
				this.inflightBootstrap = null;
			}
		})();

		this.inflightBootstrap = run;
		return run;
	}

	async login(username: string, password: string): Promise<User> {
		const session = await loginApi(username, password);
		setCsrfToken(session.csrf_token);
		this.user = session.user;
		this.csrfToken = session.csrf_token;
		this.bootstrapError = null;
		this.sessionNotice = null;
		this.status = 'authenticated';
		await this.refreshSystemStatus();
		return session.user;
	}

	async refreshSystemStatus(): Promise<SystemStatus | null> {
		if (this.status !== 'authenticated') {
			return null;
		}
		this.systemStatusLoading = true;
		this.systemStatusError = null;
		try {
			const status = await systemStatusApi();
			this.systemStatus = status;
			return status;
		} catch (err) {
			this.systemStatusError = isApiError(err)
				? err.message
				: 'Gagal memuat status kesiapan sistem.';
			return null;
		} finally {
			this.systemStatusLoading = false;
		}
	}

	async logout(): Promise<void> {
		if (this.beforeLogoutCallback) {
			try {
				await this.beforeLogoutCallback();
			} catch {
				// Best-effort pre-logout cleanup: never block logout on stop failure
			}
		}

		try {
			await logoutApi();
			this.clearSession(null);
		} catch (err) {
			if (isApiError(err) && err.status === 401) {
				this.clearSession(null);
				return;
			}
			throw err;
		}
	}
}

export const authSession = new AuthSessionStore();
