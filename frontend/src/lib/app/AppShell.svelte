<script lang="ts">
	import Icon from '#lib/shared/presentation/Icon.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authSession } from '#lib/app/auth';
	import { isApiError } from '#lib/shared/errors';
	import type { Snippet } from 'svelte';

	interface NavItem {
		label: string;
		href?: string;
		icon?: string;
		disabledReason?: string;
	}

	interface Props {
		children: Snippet;
		navItems?: NavItem[];
	}

	const defaultNavItems: NavItem[] = [
		{ label: 'Beranda', href: '/', icon: 'dashboard' },
		{ label: 'Proyek & Zona', href: '/projects', icon: 'projects' },
		{ label: 'Monitoring', href: '/monitoring', icon: 'camera' },
		{ label: 'Temuan', href: '/findings', icon: 'findings' },
		{ label: 'Laporan', href: '/reports', icon: 'reports' }
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
			return { text: 'Memeriksa model...', tone: 'warn' as const };
		}
		if (authSession.systemStatusError && !authSession.systemStatus) {
			return { text: 'Status belum bisa dimuat', tone: 'err' as const };
		}
		const st = authSession.systemStatus;
		if (!st) {
			return { text: 'Status belum tersedia', tone: 'warn' as const };
		}
		if (st.ai_ready) {
			return {
				text: st.mode === 'manual' ? 'Pencatatan manual' : 'Model siap',
				tone: 'ok' as const
			};
		}
		return { text: 'Model belum siap', tone: 'warn' as const };
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
	<aside class="sidebar">
		<a href="/" class="brand" aria-label="Inspeksi K3 - Beranda">
			<Icon name="shield" size={29} />
			<span><strong>Inspeksi K3<span class="brand-dot">.</span></strong></span>
		</a>
		<nav aria-label="Navigasi utama">
			<ul class="nav-list">
				{#each navItems as item (item.label)}
					<li>
						{#if item.href}
							{@const isCurrent =
								item.href === '/'
									? page.url.pathname === '/'
									: page.url.pathname === item.href ||
										page.url.pathname.startsWith(`${item.href}/`)}
							<a
								href={item.href}
								class="nav-link"
								class:active={isCurrent}
								aria-current={isCurrent ? 'page' : undefined}
							>
								<Icon name={item.icon ?? 'dashboard'} size={19} /><span>{item.label}</span>
							</a>
						{:else}
							<button type="button" class="nav-link" disabled title={item.disabledReason}>
								<Icon name={item.icon ?? 'dashboard'} size={19} /><span>{item.label}</span>
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		</nav>
	</aside>
	<div class="main-column">
		<header class="topbar">
			<div class="breadcrumb">
				<span class="current-crumb"
					>{navItems.find((item) =>
						item.href === '/'
							? page.url.pathname === '/'
							: item.href && page.url.pathname.startsWith(item.href)
					)?.label ?? 'Inspeksi K3'}</span
				>
			</div>
			<div class="officer-group">
				{#if authSession.user}
					<span class="avatar" aria-hidden="true"
						>{authSession.user.display_name.charAt(0).toUpperCase()}</span
					>
					<span class="officer-label" data-testid="officer-identity"
						><span class="sr-only">Petugas:{' '}</span><strong
							>{authSession.user.display_name}</strong
						><small>Petugas K3</small></span
					>
				{/if}
				<button
					type="button"
					class="logout-button"
					onclick={handleLogout}
					disabled={loggingOut}
					aria-label={loggingOut ? 'Keluar...' : 'Keluar'}
					title="Keluar dari akun"><Icon name="logout" size={18} /></button
				>
			</div>
		</header>
		<div class="system-bar">
			<div class="system-context">
				<span class="mode-label">Mode <strong>{modeLabel}</strong></span><span
					class="context-separator"
					aria-hidden="true"
				></span><span class="readiness-label" data-tone={readinessBadge.tone}
					><span class="status-dot" aria-hidden="true"></span>{readinessBadge.text}</span
				>
			</div>
		</div>
		{#if authSession.systemStatus?.mode === 'simulated'}
			<div class="provenance-banner" role="status">
				<strong>Mode simulasi.</strong> Hasil ini bukan deteksi kamera nyata.
			</div>
		{:else if authSession.systemStatus?.mode === 'manual'}
			<div class="provenance-banner" role="status">
				<strong>Mode manual.</strong> Foto dicatat petugas, tanpa deteksi otomatis.
			</div>
		{/if}
		{#if logoutError}<div class="logout-alert" role="alert">{logoutError}</div>{/if}
		<main id="workspace-main" class="workspace-main" tabindex="-1">{@render children()}</main>
	</div>
</div>

<style>
	.skip-link {
		position: fixed;
		left: 1rem;
		top: -100px;
		z-index: 100;
		padding: 0.75rem 1rem;
		background: var(--bg-surface);
		color: var(--ink-primary);
		border: 2px solid var(--focus-ring);
		border-radius: 6px;
	}
	.skip-link:focus {
		top: 1rem;
	}
	.shell-root {
		min-height: 100vh;
	}
	.sidebar {
		position: fixed;
		inset: 0 auto 0 0;
		width: 224px;
		display: flex;
		flex-direction: column;
		padding: 2rem 1rem 1.25rem;
		background: var(--nav-ground);
		color: var(--nav-text);
		z-index: 30;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		margin: 0 0.6rem 3rem;
		color: var(--ink-primary);
		text-decoration: none;
	}
	.brand strong {
		display: block;
		font-size: 1.22rem;
		font-weight: 650;
		letter-spacing: -0.04em;
		line-height: 1.25;
	}
	.brand-dot {
		color: var(--accent-clay);
	}
	.nav-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.nav-link {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		width: 100%;
		min-height: 44px;
		padding: 0.7rem 0.8rem;
		border: 0;
		border-radius: 6px;
		color: var(--nav-text);
		background: transparent;
		text-decoration: none;
		font-size: 0.875rem;
		font-weight: 450;
		transition:
			color 150ms,
			background-color 150ms;
	}
	.nav-link:hover {
		background: var(--nav-hover);
		color: var(--ink-primary);
	}
	.nav-link.active {
		background: var(--nav-selected);
		color: var(--accent-hover);
		font-weight: 600;
	}
	.nav-link:focus-visible,
	.brand:focus-visible {
		outline-color: var(--focus-ring);
	}
	.nav-link:disabled {
		opacity: 0.5;
	}
	.main-column {
		margin-left: 224px;
		min-width: 0;
	}
	.topbar {
		height: 72px;
		padding: 0 2.5rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border-default);
	}
	.breadcrumb {
		display: flex;
		gap: 0.8rem;
		font-size: 0.8rem;
		color: var(--ink-muted);
	}
	.current-crumb {
		font-weight: 500;
		color: var(--ink-primary);
	}
	.officer-group {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.avatar {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--accent-surface);
		color: var(--accent-hover);
		font-size: 0.875rem;
		font-weight: 600;
	}
	.officer-label {
		display: flex;
		flex-direction: column;
		font-size: 0.8rem;
		line-height: 1.5;
	}
	.officer-label strong {
		font-weight: 600;
	}
	.officer-label small {
		color: var(--ink-muted);
		font-size: 0.66rem;
	}
	.logout-button {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		margin-left: 0.65rem;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--ink-secondary);
	}
	.logout-button:hover {
		background: var(--bg-subtle);
		color: var(--ink-primary);
	}
	.logout-button:disabled {
		opacity: 0.5;
	}
	.system-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.65rem 2.5rem;
		background: var(--bg-surface);
		font-size: 0.7rem;
		color: var(--ink-secondary);
	}
	.system-context {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.85rem;
	}
	.mode-label strong {
		font-weight: 550;
		margin-left: 0.2rem;
	}
	.context-separator {
		height: 12px;
		width: 1px;
		background: var(--border-default);
	}
	.readiness-label {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.readiness-label[data-tone='warn'] {
		color: var(--status-warn-ink);
	}
	.readiness-label[data-tone='err'] {
		color: var(--status-err-ink);
	}
	.readiness-label[data-tone='ok'] {
		color: var(--status-ok-ink);
	}
	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}
	.workspace-main {
		max-width: 1500px;
		width: 100%;
		padding: 2.25rem 2.5rem 3.5rem;
		min-width: 0;
		margin: 0 auto;
	}
	.workspace-main:focus {
		outline: none;
	}
	.provenance-banner,
	.logout-alert {
		padding: 0.65rem 2.5rem;
		background: var(--status-warn-bg);
		color: var(--status-warn-ink);
		font-size: 0.8rem;
		border-block: 1px solid var(--status-warn-border);
	}
	.logout-alert {
		background: var(--status-err-bg);
		color: var(--status-err-ink);
		border-color: var(--status-err-border);
	}
	@media (min-width: 1800px) {
		.workspace-main {
			padding-inline: 3rem;
		}
	}
	@media (max-width: 1100px) {
		.sidebar {
			width: 200px;
			padding-inline: 0.75rem;
		}
		.main-column {
			margin-left: 200px;
		}
		.topbar,
		.system-bar {
			padding-inline: 1.5rem;
		}
		.workspace-main {
			padding: 1.75rem 1.5rem 3rem;
		}
	}
	@media (max-width: 900px) {
		.sidebar {
			inset: auto 0 0;
			width: 100%;
			padding: 0.3rem max(0.35rem, env(safe-area-inset-right))
				max(0.3rem, env(safe-area-inset-bottom)) max(0.35rem, env(safe-area-inset-left));
			background: var(--bg-surface);
			border-top: 1px solid var(--border-default);
		}
		.brand {
			display: none;
		}
		.nav-list {
			display: grid;
			grid-template-columns: repeat(5, minmax(0, 1fr));
			gap: 0;
		}
		.nav-link {
			flex-direction: column;
			justify-content: center;
			gap: 0.3rem;
			min-height: 58px;
			padding: 0.35rem 0.1rem;
			font-size: 0.61rem;
			color: var(--ink-secondary);
			white-space: nowrap;
			border-radius: 6px;
		}
		.nav-link.active {
			background: var(--accent-surface);
			color: var(--accent-primary);
		}
		.nav-link:hover {
			background: var(--bg-subtle);
			color: var(--ink-primary);
		}
		.nav-link:focus-visible {
			outline-color: var(--focus-ring);
			outline-offset: -2px;
		}
		.main-column {
			margin-left: 0;
		}
		.topbar {
			height: 64px;
			padding: env(safe-area-inset-top) 1.1rem 0;
		}
		.current-crumb {
			font-size: 0.9rem;
			font-weight: 600;
		}
		.avatar {
			width: 30px;
			height: 30px;
			font-size: 0.8rem;
		}
		.officer-group {
			gap: 0.5rem;
		}
		.officer-label {
			font-size: 0.75rem;
		}
		.officer-label small {
			display: none;
		}
		.logout-button {
			margin-left: 0;
			width: 40px;
			min-height: 44px;
		}
		.system-bar {
			padding: 0.55rem 1.1rem;
			font-size: 0.66rem;
		}
		.system-context {
			gap: 0.65rem;
		}
		.workspace-main {
			padding: 1.6rem 1.1rem calc(6rem + env(safe-area-inset-bottom));
		}
		.provenance-banner,
		.logout-alert {
			padding: 0.6rem 1.1rem;
			font-size: 0.75rem;
		}
	}
</style>
