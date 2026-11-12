<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import AppShell from '#lib/app/AppShell.svelte';
	import { authSession } from '#lib/app/auth';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(async () => {
		const status = await authSession.bootstrap();
		if (status === 'unauthenticated') {
			await goto('/login', { replaceState: true });
		}
	});

	$effect(() => {
		if (authSession.status === 'unauthenticated') {
			void goto('/login', { replaceState: true });
		}
	});

	async function retryBootstrap() {
		const status = await authSession.bootstrap(true);
		if (status === 'unauthenticated') {
			await goto('/login', { replaceState: true });
		}
	}
</script>

{#if authSession.status === 'idle' || authSession.status === 'checking'}
	<main class="bootstrap-screen" aria-busy="true">
		<section class="bootstrap-panel" role="status" aria-live="polite">
			<h1>Memeriksa akun...</h1>
		</section>
	</main>
{:else if authSession.status === 'error'}
	<main class="bootstrap-screen">
		<section class="bootstrap-panel error" role="alert">
			<h1>Server belum terhubung</h1>
			<p>
				{authSession.bootstrapError ?? 'Coba lagi. Kalau masih gagal, hubungi operator.'}
			</p>
			<div class="recovery-actions">
				<button type="button" class="retry-btn" onclick={retryBootstrap}> Coba lagi </button>
				<a href="/login" class="login-link">Masuk lagi</a>
			</div>
		</section>
	</main>
{:else if authSession.status === 'authenticated' && authSession.user}
	<AppShell>
		{@render children()}
	</AppShell>
{/if}

<style>
	.bootstrap-screen {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem 1rem;
	}

	.bootstrap-panel {
		width: 100%;
		max-width: 480px;
		background: var(--bg-surface);
		border: 1px solid var(--border-strong);
		border-radius: 12px;
		padding: 1.75rem;
	}

	.bootstrap-panel.error {
		border-color: var(--status-err-border);
		background: var(--status-err-bg);
		color: var(--status-err-ink);
	}

	.bootstrap-panel h1 {
		margin: 0 0 0.5rem 0;
		font-size: 1.25rem;
	}

	.bootstrap-panel p {
		margin: 0;
		font-size: 0.9375rem;
		color: var(--ink-secondary);
	}

	.bootstrap-panel.error h1,
	.bootstrap-panel.error p {
		color: var(--status-err-ink);
	}

	.recovery-actions {
		margin-top: 1.25rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}

	.retry-btn {
		padding: 0.5rem 0.9rem;
		border-radius: 8px;
		border: 1px solid var(--status-err-ink);
		background: var(--bg-surface);
		color: var(--status-err-ink);
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.login-link {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--status-err-ink);
	}
</style>
