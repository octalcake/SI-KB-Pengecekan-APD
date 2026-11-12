<script lang="ts">
	import Icon from '#lib/shared/presentation/Icon.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { isApiError } from '#lib/shared/errors';
	import { authSession } from '#lib/app/auth';

	let username = $state('');
	let password = $state('');
	let showPassword = $state(false);
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
		if (authSession.status === 'idle') {
			const status = await authSession.bootstrap();
			if (status === 'authenticated') {
				await goto('/', { replaceState: true });
			}
		} else if (authSession.status === 'authenticated') {
			await goto('/', { replaceState: true });
		}
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (controlsDisabled) return;

		const trimmedUser = username.trim();
		const nextFieldErrors: { username?: string; password?: string } = {};
		if (!trimmedUser) {
			nextFieldErrors.username = 'Isi nama pengguna.';
		}
		if (!password) {
			nextFieldErrors.password = 'Isi kata sandi.';
		}
		fieldErrors = nextFieldErrors;
		if (nextFieldErrors.username || nextFieldErrors.password) {
			return;
		}

		submitting = true;
		submitError = null;
		try {
			await authSession.login(trimmedUser, password);
			password = '';
			await goto('/', { replaceState: true });
		} catch (err) {
			if (isApiError(err)) {
				if (err.status === 401 || err.code === 'INVALID_CREDENTIALS') {
					submitError = {
						kind: 'credentials',
						title: 'Belum bisa masuk',
						message: 'Nama pengguna atau kata sandi salah. Coba cek lagi.'
					};
				} else if (err.status === 429 || err.code === 'RATE_LIMITED') {
					const waitNote = err.retryAfter
						? `Tunggu ${err.retryAfter} detik, lalu coba lagi.`
						: 'Tunggu sebentar, lalu coba lagi.';
					submitError = {
						kind: 'rate_limit',
						title: 'Terlalu banyak percobaan',
						message: waitNote
					};
				} else if (err.isNetworkError || err.code === 'BACKEND_UNREACHABLE' || err.status >= 500) {
					submitError = {
						kind: 'backend',
						title: 'Server belum terhubung',
						message: 'Coba lagi. Kalau masih gagal, hubungi operator.'
					};
				} else {
					submitError = {
						kind: 'general',
						title: 'Belum bisa masuk',
						message: err.message
					};
				}
			} else {
				submitError = {
					kind: 'backend',
					title: 'Server belum terhubung',
					message: 'Coba lagi. Kalau masih gagal, hubungi operator.'
				};
			}
		} finally {
			submitting = false;
		}
	}

	async function retryBootstrap() {
		submitError = null;
		const status = await authSession.bootstrap(true);
		if (status === 'authenticated') {
			await goto('/', { replaceState: true });
		}
	}
</script>

<svelte:head>
	<title>Masuk — Inspeksi K3 Konstruksi</title>
</svelte:head>

<main class="login-page">
	<aside class="login-intro">
		<a class="login-brand" href="/login"
			><Icon name="shield" size={32} /><span>Inspeksi K3<span class="brand-dot">.</span></span></a
		>
		<div class="intro-content">
			<h2>Inspeksi APD<br />di lapangan</h2>
			<p>Periksa penggunaan helm dan rompi, lalu catat temuan di lokasi proyek.</p>
		</div>
	</aside>
	<div class="login-form-region">
		<section class="login-panel" aria-labelledby="login-heading">
			<header class="login-header">
				<h1 id="login-heading">Masuk</h1>
			</header>

			{#if (!ready || authSession.status === 'checking') && !submitting}
				<div class="status-banner checking" role="status" aria-live="polite">Memeriksa akun...</div>
			{/if}

			{#if authSession.sessionNotice}
				<div class="status-banner warn" role="status">
					{authSession.sessionNotice}
				</div>
			{/if}

			{#if authSession.status === 'error' && authSession.bootstrapError && !submitError}
				<div class="status-banner err" role="alert" data-error-kind="backend">
					<div class="banner-content">
						<strong>Server belum terhubung</strong>
						<p>{authSession.bootstrapError}</p>
					</div>
					<button type="button" class="secondary-button" onclick={retryBootstrap}>
						Coba lagi
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
					<label for="login-username">Nama pengguna</label>
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
					<label for="login-password">Kata sandi</label>
					<div class="password-input">
						<input
							id="login-password"
							name="password"
							type={showPassword ? 'text' : 'password'}
							autocomplete="current-password"
							bind:value={password}
							aria-invalid={fieldErrors.password ? 'true' : undefined}
							aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
							disabled={controlsDisabled}
							required
						/>
						<button
							type="button"
							class="password-toggle"
							onclick={() => (showPassword = !showPassword)}
							aria-pressed={showPassword}
							aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
							>{showPassword ? 'Sembunyikan' : 'Tampilkan'}</button
						>
					</div>
					{#if fieldErrors.password}
						<p id="login-password-error" class="field-error">{fieldErrors.password}</p>
					{/if}
				</div>

				<button type="submit" class="primary-button" disabled={controlsDisabled}>
					{submitting ? 'Sedang masuk...' : 'Masuk'}
				</button>
			</form>

			<footer class="login-footer">
				<p>Belum punya akun? Hubungi operator.</p>
			</footer>
		</section>
	</div>
</main>

<style>
	.login-page {
		min-height: 100svh;
		display: grid;
		grid-template-columns: minmax(360px, 43%) minmax(0, 1fr);
		background: var(--bg-surface);
	}
	.login-intro {
		background: var(--nav-ground);
		color: var(--ink-secondary);
		padding: 3rem 3.5rem;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 4rem;
	}
	.login-brand {
		display: flex;
		gap: 0.85rem;
		align-items: center;
		color: var(--ink-primary);
		text-decoration: none;
	}
	.login-brand > span {
		font-size: 1.4rem;
		font-weight: 600;
		letter-spacing: -0.04em;
		line-height: 1.3;
	}
	.brand-dot {
		color: var(--accent-clay);
	}
	.intro-content {
		padding-bottom: 2rem;
	}
	.intro-content h2 {
		font-size: 2.6rem;
		line-height: 1.25;
		font-weight: 500;
		color: var(--ink-primary);
		margin: 0 0 1.5rem;
	}
	.intro-content p {
		font-size: 0.95rem;
		line-height: 1.8;
		margin-bottom: 2.25rem;
		max-width: 34ch;
	}
	.login-form-region {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4rem 2.5rem;
	}
	.login-panel {
		width: 100%;
		max-width: 380px;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.login-header {
		margin-bottom: 0.75rem;
	}
	.login-header h1 {
		margin: 0 0 0.7rem;
		font-size: 1.8rem;
		font-weight: 650;
	}
	.status-banner {
		padding: 0.85rem 1rem;
		border-radius: 6px;
		font-size: 0.83rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.checking {
		background: var(--bg-subtle);
		color: var(--ink-secondary);
	}
	.warn {
		background: var(--status-warn-bg);
		color: var(--status-warn-ink);
	}
	.err {
		background: var(--status-err-bg);
		color: var(--status-err-ink);
	}
	.banner-content p {
		margin: 0.3rem 0 0;
	}
	.login-form {
		display: flex;
		flex-direction: column;
		gap: 1.35rem;
	}
	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.field-group label {
		font-size: 0.83rem;
		font-weight: 550;
	}
	.field-group input {
		width: 100%;
		min-height: 46px;
		padding: 0.65rem 0.85rem;
		border: 1px solid var(--border-strong);
		border-radius: 6px;
		background: var(--bg-surface);
		font-size: 1rem;
	}
	.field-group input[aria-invalid='true'] {
		border-color: var(--status-err-ink);
	}
	.field-group input:disabled {
		background: var(--bg-subtle);
	}
	.password-input {
		position: relative;
	}
	.password-input input {
		padding-right: 7rem;
	}
	.password-toggle {
		position: absolute;
		right: 0.3rem;
		top: 1px;
		bottom: 1px;
		min-height: 44px;
		padding: 0 0.6rem;
		border: 0;
		background: transparent;
		color: var(--ink-secondary);
		font-size: 0.75rem;
		border-radius: 4px;
	}
	.password-toggle:hover {
		background: var(--bg-subtle);
	}
	.field-error {
		margin: 0;
		font-size: 0.78rem;
		color: var(--status-err-ink);
	}
	.primary-button {
		margin-top: 0.5rem;
		width: 100%;
		min-height: 46px;
		border: 1px solid var(--accent-primary);
		border-radius: 6px;
		color: #fff;
		background: var(--accent-primary);
		font-size: 0.9rem;
		font-weight: 600;
	}
	.primary-button:hover:not(:disabled) {
		background: var(--accent-hover);
	}
	.primary-button:disabled {
		opacity: 0.55;
	}
	.secondary-button {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--status-err-border);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--status-err-ink);
		font-size: 0.8rem;
	}
	.login-footer {
		margin-top: 0.5rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--border-default);
	}
	.login-footer p {
		font-size: 0.75rem;
		line-height: 1.7;
		color: var(--ink-muted);
		margin: 0;
	}
	@media (max-width: 900px) {
		.login-intro {
			padding: 2.5rem 2rem;
		}
		.intro-content h2 {
			font-size: 2.1rem;
		}
	}
	@media (max-width: 680px) {
		.login-page {
			display: flex;
			flex-direction: column;
		}
		.login-intro {
			padding: 2rem 1.5rem;
			gap: 0;
		}
		.login-brand > span {
			font-size: 1.25rem;
		}
		.intro-content,
		.login-form-region {
			align-items: flex-start;
			padding: 3rem 1.5rem max(2rem, env(safe-area-inset-bottom));
		}
		.login-header h1 {
			font-size: 1.65rem;
		}
		.password-toggle {
			min-height: 40px;
		}
	}
</style>
