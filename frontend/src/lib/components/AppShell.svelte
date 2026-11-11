<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authSession } from '#lib/auth/session.svelte';
	import { isApiError } from '#lib/api/client';
	import type { Snippet } from 'svelte';

	interface NavItem {
		label: string;
		href?: string;
		disabledReason?: string;
	}

	interface Props {
		children: Snippet;
		navItems?: NavItem[];
	}

	const defaultNavItems: NavItem[] = [
		{ label: 'Dashboard', href: '/' },
		{ label: 'Proyek & Zona', href: '/projects' },
		{ label: 'Monitoring', href: '/monitoring' },
		{ label: 'Temuan', href: '/findings' },
		{ label: 'Laporan', href: '/reports' }
	];

	let { children, navItems = defaultNavItems }: Props = $props();

	let loggingOut = $state(false);
	let logoutError = $state<string | null>(null);

	const modeLabel = $derived.by(() => {
		const mode = authSession.systemStatus?.mode;
		if (mode === 'real') return 'NYATA';
		if (mode === 'simulated') return 'SIMULASI';
		if (mode === 'manual') return 'MANUAL';
		return 'MEMUAT';
	});

	const readinessBadge = $derived.by(() => {
		if (authSession.systemStatusLoading && !authSession.systemStatus) {
			return { text: 'Memeriksa kesiapan...', tone: 'warn' as const };
		}
		if (authSession.systemStatusError && !authSession.systemStatus) {
			return { text: 'Status sistem gagal dimuat', tone: 'err' as const };
		}
		const st = authSession.systemStatus;
		if (!st) {
			return { text: 'Status belum tersedia', tone: 'warn' as const };
		}
		if (st.ai_ready) {
			return {
				text: st.mode === 'manual' ? 'Siap (Mode Manual)' : 'Model Siap',
				tone: 'ok' as const
			};
		}
		return { text: 'Model Belum Siap', tone: 'warn' as const };
	});

	async function handleLogout() {
		if (loggingOut) return;
		loggingOut = true;
		logoutError = null;
		try {
			await authSession.logout();
			await goto('/login', { replaceState: true });
		} catch (err) {
			logoutError = isApiError(err) ? err.message : 'Gagal keluar dari sesi. Silakan coba lagi.';
		} finally {
			loggingOut = false;
		}
	}
</script>

<a class="skip-link" href="#workspace-main">Lewati ke konten utama</a>

<div class="shell-root">
	<header class="topbar">
		<div class="brand-group">
			<a href="/" class="brand-title">Inspeksi K3</a>
			<span class="mode-pill" data-mode={authSession.systemStatus?.mode ?? 'unknown'}>
				Mode: <strong>{modeLabel}</strong>
			</span>
			<span class="readiness-pill" data-tone={readinessBadge.tone}>
				{readinessBadge.text}
			</span>
		</div>

		<div class="officer-group">
			{#if authSession.user}
				<span class="officer-label" data-testid="officer-identity">
					Petugas: <strong>{authSession.user.display_name}</strong>
					<span class="officer-role">({authSession.user.role})</span>
				</span>
			{/if}
			<button
				type="button"
				class="logout-button"
				onclick={handleLogout}
				disabled={loggingOut}
			>
				{loggingOut ? 'Keluar...' : 'Keluar'}
			</button>
		</div>
	</header>

	{#if authSession.systemStatus?.mode === 'simulated'}
		<div class="provenance-banner simulated" role="status">
			<strong>MODE SIMULASI AKTIF:</strong> Seluruh hasil deteksi berasal dari simulasi deterministik, bukan inferensi model kamera nyata.
		</div>
	{:else if authSession.systemStatus?.mode === 'manual'}
		<div class="provenance-banner manual" role="status">
			<strong>MODE FALLBACK MANUAL AKTIF:</strong> Pencatatan menggunakan foto observasi manual petugas tanpa inferensi otomatis.
		</div>
	{/if}

	{#if logoutError}
		<div class="logout-alert" role="alert">
			<span>{logoutError}</span>
		</div>
	{/if}

	<div class="shell-body">
		<nav class="sidebar" aria-label="Navigasi utama">
			<ul class="nav-list">
				{#each navItems as item (item.label)}
					<li class="nav-item">
						{#if item.href}
							{@const isCurrent =
								item.href === '/'
									? page.url.pathname === '/'
									: page.url.pathname === item.href || page.url.pathname.startsWith(`${item.href}/`)}
							<a
								href={item.href}
								class="nav-link"
								class:active={isCurrent}
								aria-current={isCurrent ? 'page' : undefined}
							>
								{item.label}
							</a>
						{:else}
							<button
								type="button"
								class="nav-disabled"
								disabled
								title={item.disabledReason}
							>
								<span class="nav-disabled-label">{item.label}</span>
								{#if item.disabledReason}
									<span class="nav-disabled-reason">{item.disabledReason}</span>
								{/if}
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		</nav>

		<main id="workspace-main" class="workspace-main" tabindex="-1">
			{@render children()}
		</main>
	</div>
</div>

<style>
	.skip-link {
		position: absolute;
		left: -9999px;
		top: 0.5rem;
		z-index: 100;
		padding: 0.5rem 0.875rem;
		background: var(--bg-surface);
		color: var(--ink-primary);
		border: 2px solid var(--focus-ring);
		border-radius: 6px;
		font-weight: 600;
		text-decoration: none;
	}

	.skip-link:focus {
		left: 0.75rem;
	}

	.shell-root {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.topbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1.25rem;
		padding: 0.75rem 1.25rem;
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border-strong);
	}

	.brand-group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
	}

	.brand-title {
		font-size: 1.125rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--ink-primary);
		text-decoration: none;
	}

	.mode-pill,
	.readiness-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.6rem;
		border-radius: 6px;
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
		border: 1px solid var(--border-default);
		background: var(--bg-subtle);
		color: var(--ink-secondary);
	}

	.readiness-pill[data-tone='ok'] {
		background: var(--status-ok-bg);
		color: var(--status-ok-ink);
		border-color: var(--status-ok-border);
		font-weight: 600;
	}

	.readiness-pill[data-tone='warn'] {
		background: var(--status-warn-bg);
		color: var(--status-warn-ink);
		border-color: var(--status-warn-border);
		font-weight: 600;
	}

	.readiness-pill[data-tone='err'] {
		background: var(--status-err-bg);
		color: var(--status-err-ink);
		border-color: var(--status-err-border);
		font-weight: 600;
	}

	.officer-group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.875rem;
	}

	.officer-label {
		font-size: 0.9375rem;
		color: var(--ink-primary);
	}

	.officer-role {
		color: var(--ink-secondary);
		font-size: 0.8125rem;
	}

	.logout-button {
		padding: 0.4rem 0.85rem;
		border-radius: 6px;
		border: 1px solid var(--border-strong);
		background: var(--bg-surface);
		color: var(--ink-primary);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
	}

	.logout-button:hover:not(:disabled) {
		background: var(--bg-subtle);
		border-color: var(--ink-secondary);
	}

	.logout-button:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.provenance-banner {
		padding: 0.65rem 1.25rem;
		font-size: 0.875rem;
		border-bottom: 1px solid var(--status-warn-border);
		background: var(--status-warn-bg);
		color: var(--status-warn-ink);
	}

	.logout-alert {
		padding: 0.65rem 1.25rem;
		font-size: 0.875rem;
		border-bottom: 1px solid var(--status-err-border);
		background: var(--status-err-bg);
		color: var(--status-err-ink);
	}

	.shell-body {
		flex: 1;
		display: grid;
		grid-template-columns: 240px minmax(0, 1fr);
		min-height: 0;
	}

	.sidebar {
		background: var(--bg-surface);
		border-right: 1px solid var(--border-default);
		padding: 1rem 0.75rem;
	}

	.nav-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.nav-link {
		display: block;
		padding: 0.55rem 0.75rem;
		border-radius: 8px;
		text-decoration: none;
		font-weight: 600;
		font-size: 0.9375rem;
		color: var(--ink-primary);
		border: 1px solid transparent;
	}

	.nav-link:hover {
		background: var(--bg-subtle);
	}

	.nav-link.active {
		background: var(--accent-surface);
		color: var(--accent-primary);
		border-color: var(--accent-border);
	}

	.nav-disabled {
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink-muted);
		cursor: not-allowed;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.nav-disabled-label {
		font-size: 0.9375rem;
		font-weight: 500;
	}

	.nav-disabled-reason {
		font-size: 0.75rem;
		color: var(--ink-muted);
	}

	.workspace-main {
		padding: 1.5rem 1.75rem;
		max-width: 1200px;
		width: 100%;
	}

	@media (max-width: 900px) {
		.shell-body {
			grid-template-columns: 1fr;
		}

		.sidebar {
			border-right: none;
			border-bottom: 1px solid var(--border-default);
			padding: 0.75rem 1rem;
		}

		.nav-list {
			flex-direction: row;
			flex-wrap: wrap;
			gap: 0.5rem;
		}

		.nav-disabled {
			width: auto;
		}

		.workspace-main {
			padding: 1.25rem 1rem;
		}
	}
</style>
