<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { isApiError } from '#lib/shared/errors';
	import { authSession } from '#lib/app/auth';

	let username = $state('');
	let password = $state('');
	let submitting = $state(false);
	let ready = $state(false);
	const controlsDisabled = $derived(!ready || submitting || authSession.status === 'checking');
	let fieldErrors = $state<{ username?: string; password?: string }>({});
	let submitError = $state<{
		kind: 'credentials' | 'rate_limit' | 'backend' | 'general';
		title: string;
		message: string;
	} | null>(null);

	onMount(async () => {
		ready = true;
		if(authSession.status === 'idle') {
			const status = await authSession.bootstrap();
			if(status === 'authenticated') {
				await goto('/', { replaceState: true });
			}
		} else if(authSession.status === 'authenticated') {
			await goto('/', { replaceState: true });
		}
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if(controlsDisabled) return;

		const trimmedUser = username.trim();
		const nextFieldErrors: { username?: string; password?: string } = {};
		if(!trimmedUser) {
			nextFieldErrors.username = 'Username wajib diisi.';
		}
		if(!password) {
			nextFieldErrors.password = 'Password wajib diisi.';
		}
		fieldErrors = nextFieldErrors;
		if(nextFieldErrors.username || nextFieldErrors.password) {
			return;
		}

		submitting = true;
		submitError = null;
		try {
			await authSession.login(trimmedUser, password);
			password = '';
			await goto('/', { replaceState: true });
		} catch(err) {
			if(isApiError(err)) {
				if(err.status === 401 || err.code === 'INVALID_CREDENTIALS') {
					submitError = {
						kind: 'credentials',
						title: 'Kredensial Tidak Valid',
						message:
							err.message ||
							'Username atau password salah. Gunakan akun petugas K3 yang di-seed oleh operator lokal.'
					};
				} else if(err.status === 429 || err.code === 'RATE_LIMITED') {
					const waitNote = err.retryAfter ? ` Tunggu sekitar ${err.retryAfter} detik.` : '';
					submitError = {
						kind: 'rate_limit',
						title: 'Batas Percobaan Tercapai',
						message: `${err.message}${waitNote}`
					};
				} else if(err.isNetworkError || err.code === 'BACKEND_UNREACHABLE' || err.status >= 500) {
					submitError = {
						kind: 'backend',
						title: 'Layanan Backend Tidak Terjangkau',
						message:
							'Tidak dapat menghubungi server Go (/api/v1). Pastikan layanan backend sedang berjalan lalu coba masuk kembali.'
					};
				} else {
					submitError = {
						kind: 'general',
						title: 'Gagal Masuk',
						message: err.message
					};
				}
			} else {
				submitError = {
					kind: 'backend',
					title: 'Layanan Backend Tidak Terjangkau',
					message:
						'Tidak dapat menghubungi server Go (/api/v1). Pastikan layanan backend sedang berjalan lalu coba masuk kembali.'
				};
			}
		} finally {
			submitting = false;
		}
	}

	async function retryBootstrap() {
		submitError = null;
		const status = await authSession.bootstrap(true);
		if(status === 'authenticated') {
			await goto('/', { replaceState: true });
		}
	}
</script>

<svelte:head>
	<title>Masuk Petugas K3 — Inspeksi K3 Konstruksi</title>
</svelte:head>

<main class="login-page">
	<section class="login-panel" aria-labelledby="login-heading">
		<header class="login-header">
			<h1 id="login-heading">Masuk Petugas K3</h1>
			<p class="login-subtitle">
				Sistem Informasi Inspeksi K3 Konstruksi. Masuk menggunakan akun petugas lokal untuk mengakses ruang kerja inspeksi, verifikasi bukti, dan status kesiapan sistem.
			</p>
		</header>

		{#if (!ready || authSession.status === 'checking') && !submitting}
			<div class="status-banner checking" role="status" aria-live="polite">
				Memeriksa sesi aktif petugas K3...
			</div>
		{/if}

		{#if authSession.sessionNotice}
			<div class="status-banner warn" role="status">
				{authSession.sessionNotice}
			</div>
		{/if}

		{#if authSession.status === 'error' && authSession.bootstrapError && !submitError}
			<div class="status-banner err" role="alert" data-error-kind="backend">
				<div class="banner-content">
					<strong>Layanan Backend Tidak Terjangkau</strong>
					<p>{authSession.bootstrapError}</p>
				</div>
				<button type="button" class="secondary-button" onclick={retryBootstrap}>
					Coba Periksa Ulang
				</button>
			</div>
		{/if}

		{#if submitError}
			<div class="status-banner err" role="alert" data-error-kind={submitError.kind}>
				<div class="banner-content">
					<strong>{submitError.title}</strong>
					<p>{submitError.message}</p>
				</div>
			</div>
		{/if}

		<form class="login-form" method="POST" onsubmit={handleSubmit} novalidate>
			<div class="field-group">
				<label for="login-username">Username</label>
				<input
					id="login-username"
					name="username"
					type="text"
					autocomplete="username"
					bind:value={username}
					aria-invalid={fieldErrors.username ? 'true' : undefined}
					aria-describedby={fieldErrors.username ? 'login-username-error' : undefined}
					disabled={controlsDisabled}
					required
				/>
				{#if fieldErrors.username}
					<p id="login-username-error" class="field-error">{fieldErrors.username}</p>
				{/if}
			</div>

			<div class="field-group">
				<label for="login-password">Password</label>
				<input
					id="login-password"
					name="password"
					type="password"
					autocomplete="current-password"
					bind:value={password}
					aria-invalid={fieldErrors.password ? 'true' : undefined}
					aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
					disabled={controlsDisabled}
					required
				/>
				{#if fieldErrors.password}
					<p id="login-password-error" class="field-error">{fieldErrors.password}</p>
				{/if}
			</div>

			<button type="submit" class="primary-button" disabled={controlsDisabled}>
				{submitting ? 'Memverifikasi...' : 'Masuk'}
			</button>
		</form>

		<footer class="login-footer">
			<p>
				Akun petugas dikelola melalui perintah <code>seed</code> lokal. Sistem mendeteksi indikasi visual APD dan mewajibkan verifikasi manusia oleh petugas K3.
			</p>
		</footer>
	</section>
</main>

<style>
	.login-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem 1rem;
	}

	.login-panel {
		width: 100%;
		max-width: 460px;
		background: var(--bg-surface);
		border: 1px solid var(--border-strong);
		border-radius: 12px;
		padding: 2rem 1.75rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.login-header h1 {
		margin: 0 0 0.5rem 0;
		font-size: 1.5rem;
	}

	.login-subtitle {
		margin: 0;
		font-size: 0.9375rem;
		color: var(--ink-secondary);
	}

	.status-banner {
		padding: 0.75rem 0.9rem;
		border-radius: 8px;
		font-size: 0.875rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.status-banner.checking {
		background: var(--bg-subtle);
		border: 1px solid var(--border-default);
		color: var(--ink-secondary);
	}

	.status-banner.warn {
		background: var(--status-warn-bg);
		border: 1px solid var(--status-warn-border);
		color: var(--status-warn-ink);
	}

	.status-banner.err {
		background: var(--status-err-bg);
		border: 1px solid var(--status-err-border);
		color: var(--status-err-ink);
	}

	.banner-content p {
		margin: 0.25rem 0 0 0;
	}

	.login-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.field-group label {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--ink-primary);
	}

	.field-group input {
		padding: 0.55rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-strong);
		background: var(--bg-surface);
		font-size: 0.9375rem;
	}

	.field-group input[aria-invalid='true'] {
		border-color: var(--status-err-ink);
	}

	.field-group input:disabled {
		background: var(--bg-subtle);
		cursor: not-allowed;
	}

	.field-error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--status-err-ink);
		font-weight: 500;
	}

	.primary-button {
		margin-top: 0.25rem;
		padding: 0.65rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--accent-primary);
		background: var(--accent-primary);
		color: #ffffff;
		font-weight: 600;
		font-size: 0.9375rem;
		cursor: pointer;
	}

	.primary-button:hover:not(:disabled) {
		background: var(--accent-hover);
		border-color: var(--accent-hover);
	}

	.primary-button:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.secondary-button {
		padding: 0.4rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--status-err-ink);
		background: var(--bg-surface);
		color: var(--status-err-ink);
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
	}

	.login-footer {
		border-top: 1px solid var(--border-default);
		padding-top: 1rem;
	}

	.login-footer p {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--ink-secondary);
	}

	.login-footer code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.78rem;
		background: var(--bg-subtle);
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
	}

	@media (max-width: 640px) {
		.login-page {
			padding: max(1rem, env(safe-area-inset-top)) max(0.875rem, env(safe-area-inset-right))
				max(1.25rem, env(safe-area-inset-bottom)) max(0.875rem, env(safe-area-inset-left));
		}

		.login-panel {
			padding: 1.35rem 1.15rem;
		}

		.field-group input {
			min-height: 2.75rem;
			font-size: 1rem;
		}

		.primary-button,
		.secondary-button {
			min-height: 2.75rem;
			width: 100%;
		}
	}
</style>
