<script lang="ts">
	import Icon from '#lib/shared/presentation/Icon.svelte';
	import { onMount } from 'svelte';
	import { isApiError } from '#lib/shared/errors';
	import { authSession } from '#lib/app/auth';
	import { dashboardWorkflow } from '#lib/app/dashboard';
	import type { DashboardSummary } from '../domain/types';
	import type { Project, Zone } from '#lib/features/projects/domain';
	import type { SystemMode, ViolationType } from '#lib/shared/domain/types';

	const ALL_CATEGORIES: Array<{ code: ViolationType; label: string; description: string }> = [
		{
			code: 'NO_HELMET',
			label: 'Tanpa helm',
			description: 'Deteksi kepala terlihat tanpa pelindung helm proyek.'
		},
		{
			code: 'NO_VEST',
			label: 'Tanpa rompi',
			description: 'Deteksi torso terlihat tanpa rompi keselamatan.'
		}
	];

	const status = $derived(authSession.systemStatus);

	// Dashboard summary & filters state
	let summary = $state<DashboardSummary | null>(null);
	let summaryLoading = $state(true);
	let summaryError = $state<string | null>(null);
	let dateValidationError = $state<string | null>(null);

	let filterMode = $state<SystemMode>('real');
	let filterProjectId = $state<string>('');
	let filterZoneId = $state<string>('');
	let filterFromDate = $state<string>('');
	let filterToDate = $state<string>('');

	// Lookup options from persisted master data
	let projects = $state<Project[]>([]);
	let zones = $state<Zone[]>([]);
	let loadingLookups = $state(false);
	let loadingZones = $state(false);
	let lookupError = $state<string | null>(null);

	const configuredTimezone = $derived(summary?.timezone || 'Asia/Jakarta');

	const summaryTotalFindings = $derived(
		summary ? summary.findings_pending + summary.findings_confirmed + summary.findings_rejected : 0
	);

	const summaryModeBadge = $derived.by(() => {
		const m = summary?.mode ?? filterMode;
		if (m === 'real') {
			return {
				label: 'Data nyata',
				tone: 'ok' as const,
				note: 'Hanya data inspeksi nyata. Data simulasi dan manual ditampilkan terpisah.'
			};
		}
		if (m === 'simulated') {
			return {
				label: 'Data simulasi',
				tone: 'warn' as const,
				note: 'Data simulasi untuk pengujian, bukan hasil inspeksi nyata.'
			};
		}
		return {
			label: 'Data manual',
			tone: 'warn' as const,
			note: 'Observasi yang dicatat petugas tanpa deteksi otomatis.'
		};
	});

	const modeDisplay = $derived.by(() => {
		if (!status) return { label: 'Memuat...', code: '-', detail: 'Mengambil konfigurasi server.' };
		if (status.mode === 'real') {
			return {
				label: 'NYATA',
				code: 'real',
				detail: 'Inferensi model YOLO + ByteTrack pada layanan AI lokal.'
			};
		}
		if (status.mode === 'simulated') {
			return {
				label: 'SIMULASI',
				code: 'simulated',
				detail: 'Inferensi fixture deterministik untuk uji alur; bukan deteksi kamera nyata.'
			};
		}
		return {
			label: 'MANUAL',
			code: 'manual',
			detail: 'Pencatatan observasi manual petugas tanpa inferensi otomatis.'
		};
	});

	const aiReadinessDisplay = $derived.by(() => {
		if (!status) {
			return {
				badge: 'Memeriksa...',
				tone: 'warn' as const,
				summary: 'Memeriksa layanan deteksi otomatis.'
			};
		}
		if (status.mode === 'manual') {
			return {
				badge: 'Siap (Mode Manual)',
				tone: 'ok' as const,
				summary: 'Temuan dicatat dari foto yang diunggah petugas.'
			};
		}
		if (status.ai_ready) {
			return {
				badge: 'Siap',
				tone: 'ok' as const,
				summary: 'Deteksi otomatis siap digunakan.'
			};
		}
		return {
			badge: 'Belum Siap',
			tone: 'warn' as const,
			summary: status.ai_reachable
				? 'Model belum siap. Hubungi operator untuk mengaktifkan deteksi.'
				: 'Deteksi otomatis belum tersedia. Proyek, temuan, dan laporan tetap bisa dibuka.'
		};
	});

	// Monotonic request sequence tokens to ignore stale responses
	let projectsReqSeq = 0;
	let zonesReqSeq = 0;
	let summaryReqSeq = 0;

	onMount(() => {
		void initializeDashboard();
	});

	async function initializeDashboard() {
		await Promise.all([loadProjectOptions(), loadSummary()]);
	}

	async function loadProjectOptions() {
		const seq = ++projectsReqSeq;
		loadingLookups = true;
		lookupError = null;
		try {
			const res = await dashboardWorkflow.loadProjects();
			if (seq !== projectsReqSeq) return;
			projects = res;
		} catch (err) {
			if (seq !== projectsReqSeq) return;
			lookupError = isApiError(err) ? err.message : 'Gagal memuat daftar proyek untuk filter.';
		} finally {
			if (seq === projectsReqSeq) {
				loadingLookups = false;
			}
		}
	}

	async function handleProjectFilterChange() {
		const zSeq = ++zonesReqSeq;
		filterZoneId = '';
		zones = [];
		lookupError = null;
		const pid = Number(filterProjectId);
		if (Number.isFinite(pid) && pid > 0) {
			loadingZones = true;
			void loadSummary();
			try {
				const res = await dashboardWorkflow.loadZones(pid);
				if (zSeq !== zonesReqSeq || Number(filterProjectId) !== pid) return;
				zones = res;
			} catch (err) {
				if (zSeq !== zonesReqSeq || Number(filterProjectId) !== pid) return;
				lookupError = isApiError(err)
					? err.message
					: 'Gagal memuat daftar zona untuk proyek terpilih.';
			} finally {
				if (zSeq === zonesReqSeq) {
					loadingZones = false;
				}
			}
		} else {
			loadingZones = false;
			await loadSummary();
		}
	}

	async function loadSummary() {
		const seq = ++summaryReqSeq;
		dateValidationError = null;
		if (filterFromDate && filterToDate && filterFromDate > filterToDate) {
			summaryLoading = false;
			dateValidationError = 'Tanggal mulai tidak boleh melebihi tanggal akhir.';
			return;
		}

		summaryLoading = true;
		summaryError = null;
		try {
			const nextSummary = await dashboardWorkflow.fetchSummary({
				mode: filterMode,
				projectId: filterProjectId,
				zoneId: filterZoneId,
				fromDate: filterFromDate,
				toDate: filterToDate,
				timeZone: summary?.timezone
			});
			if (seq !== summaryReqSeq) return;
			summary = nextSummary;
		} catch (err) {
			if (seq !== summaryReqSeq) return;
			summaryError = isApiError(err)
				? err.message
				: 'Gagal memuat ringkasan dashboard dari server backend.';
		} finally {
			if (seq === summaryReqSeq) {
				summaryLoading = false;
			}
		}
	}

	async function handleResetDashboardFilters() {
		zonesReqSeq++;
		loadingZones = false;
		lookupError = null;
		filterMode = 'real';
		filterProjectId = '';
		filterZoneId = '';
		filterFromDate = '';
		filterToDate = '';
		zones = [];
		dateValidationError = null;
		await loadSummary();
	}

	async function handleRefreshAll() {
		await Promise.all([authSession.refreshSystemStatus(), loadProjectOptions(), loadSummary()]);
	}
</script>

<svelte:head><title>Beranda - Inspeksi K3</title></svelte:head>

<div class="workspace-stack">
	<header class="workspace-header">
		<div>
			<h1>Beranda</h1>
		</div>
		<a href="/monitoring" class="button-primary"><Icon name="camera" size={18} />Mulai inspeksi</a>
	</header>

	<section class="overview" aria-labelledby="dashboard-summary-heading">
		<div class="section-heading">
			<h2 id="dashboard-summary-heading">Ringkasan inspeksi</h2>
			<span class="mode-tag" data-testid="summary-mode-badge" data-tone={summaryModeBadge.tone}
				>{summaryModeBadge.label}</span
			>
		</div>
		<form
			class="filter-row"
			aria-label="Filter ringkasan dashboard"
			onsubmit={(e) => {
				e.preventDefault();
				void loadSummary();
			}}
		>
			<div class="field-group">
				<label for="dashboard-filter-mode">Jenis data</label><select
					id="dashboard-filter-mode"
					bind:value={filterMode}
					onchange={() => void loadSummary()}
					><option value="real">Nyata</option><option value="simulated">Simulasi</option><option
						value="manual">Manual</option
					></select
				>
			</div>
			<div class="field-group">
				<label for="dashboard-filter-project">Proyek</label><select
					id="dashboard-filter-project"
					bind:value={filterProjectId}
					onchange={() => void handleProjectFilterChange()}
					disabled={loadingLookups}
					><option value="">Semua proyek</option>{#each projects as proj (proj.id)}<option
							value={String(proj.id)}
							>{proj.name}{proj.status === 'archived' ? ' (Diarsipkan)' : ''}</option
						>{/each}</select
				>
			</div>
			<div class="field-group">
				<label for="dashboard-filter-zone">Zona</label><select
					id="dashboard-filter-zone"
					bind:value={filterZoneId}
					onchange={() => void loadSummary()}
					disabled={!filterProjectId || loadingZones}
					><option value="">{!filterProjectId ? 'Pilih proyek dahulu' : 'Semua zona'}</option
					>{#each zones as z (z.id)}<option value={String(z.id)}
							>{z.name}{z.status === 'archived' ? ' (Diarsipkan)' : ''}</option
						>{/each}</select
				>
			</div>
			<details class="period-filter">
				<summary class="period-trigger"
					><Icon name="filter" size={16} />Periode{filterFromDate || filterToDate
						? ' (aktif)'
						: ''}</summary
				>
				<div class="period-fields">
					<div class="field-group">
						<label for="dashboard-filter-from">Dari tanggal ({configuredTimezone})</label><input
							id="dashboard-filter-from"
							type="date"
							bind:value={filterFromDate}
							onchange={() => void loadSummary()}
						/>
					</div>
					<div class="field-group">
						<label for="dashboard-filter-to">Sampai tanggal ({configuredTimezone})</label><input
							id="dashboard-filter-to"
							type="date"
							bind:value={filterToDate}
							onchange={() => void loadSummary()}
						/>
					</div>
				</div>
			</details>
			<button type="button" class="button-quiet reset-button" onclick={handleResetDashboardFilters}
				>Reset filter</button
			>
		</form>
		{#if lookupError}<div class="inline-message warning" role="alert">{lookupError}</div>{/if}
		{#if dateValidationError}<div
				class="inline-message error"
				role="alert"
				data-error-kind="validation"
			>
				{dateValidationError}
			</div>{/if}
		{#if summaryError}
			<div class="inline-message error" role="alert" data-error-kind="backend">
				<span><strong>Ringkasan belum bisa dimuat.</strong> {summaryError}</span><button
					type="button"
					class="button-secondary"
					onclick={loadSummary}>Coba lagi</button
				>
			</div>
		{:else if summaryLoading && !summary}
			<div class="metrics-loading" role="status" aria-busy="true">
				<span class="sr-only">Memuat ringkasan inspeksi...</span
				>{#each [1, 2, 3, 4, 5] as item (item)}<div class="skeleton-metric">
						<span></span><strong></strong>
					</div>{/each}
			</div>
		{:else if summary}
			<div class="metrics-strip" aria-busy={summaryLoading}>
				<div class="metric">
					<span>Sesi inspeksi</span><strong data-testid="metric-sessions">{summary.sessions}</strong
					>
				</div>
				<div class="metric">
					<span>Belum diperiksa</span><strong data-testid="metric-findings-pending"
						>{summary.findings_pending}</strong
					>
				</div>
				<div class="metric">
					<span>Terkonfirmasi</span><strong data-testid="metric-findings-confirmed"
						>{summary.findings_confirmed}</strong
					>
				</div>
				<div class="metric">
					<span>Ditolak</span><strong data-testid="metric-findings-rejected"
						>{summary.findings_rejected}</strong
					>
				</div>
				<div class="metric">
					<span>Belum ditindaklanjuti</span><strong data-testid="metric-actions-open"
						>{summary.confirmed_actions_open}</strong
					>
				</div>
			</div>
			<p class="count-note" data-testid="dashboard-summary-meta">
				Jumlah temuan, <strong>bukan jumlah pekerja unik</strong>. Waktu: {summary.timezone}.
			</p>
		{/if}
	</section>

	<div class="dashboard-columns">
		<section class="attention-panel" aria-labelledby="attention-heading">
			<div class="section-heading">
				<h2 id="attention-heading">Lanjutkan pekerjaan</h2>
				<Icon name="findings" size={18} />
			</div>
			{#if summary && summary.sessions === 0 && summaryTotalFindings === 0}
				<div class="first-inspection">
					<h3>
						{projects.length === 0 ? 'Belum ada proyek' : 'Belum ada inspeksi'}
					</h3>
					<p>
						{projects.length === 0
							? 'Tambah proyek dan zona sebelum mulai inspeksi.'
							: 'Coba ubah filter atau mulai inspeksi baru.'}
					</p>
					<a href={projects.length === 0 ? '/projects' : '/monitoring'} class="button-secondary"
						>{projects.length === 0 ? 'Tambah proyek & zona' : 'Buka monitoring'}<Icon
							name="arrow"
							size={16}
						/></a
					>
				</div>
			{/if}
			<a class="agenda-row" href="/findings?verification_status=pending"
				><Icon name="clock" size={20} /><span><strong>Periksa temuan</strong></span><Icon
					name="chevron"
					size={15}
				/></a
			>
			<a class="agenda-row" href="/findings?verification_status=confirmed"
				><Icon name="check" size={20} /><span><strong>Catat tindak lanjut</strong></span><Icon
					name="chevron"
					size={15}
				/></a
			>
			<a class="agenda-row" href="/reports"
				><Icon name="reports" size={20} /><span><strong>Buat laporan</strong></span><Icon
					name="chevron"
					size={15}
				/></a
			>
		</section>

		<section class="readiness-panel" aria-labelledby="readiness-heading">
			<div class="section-heading">
				<h2 id="readiness-heading">Status deteksi</h2>
				<span class="status-label" data-tone={aiReadinessDisplay.tone}
					><span class="status-dot"></span>{aiReadinessDisplay.badge}</span
				>
			</div>
			{#if authSession.systemStatusError}<div class="inline-message error" role="alert">
					<strong>Gagal memuat status sistem.</strong>
					{authSession.systemStatusError}
				</div>{:else}<p class="readiness-summary">{aiReadinessDisplay.summary}</p>{/if}
			<div class="category-heading">Kategori deteksi</div>
			<ul class="category-list" aria-label="Cakupan kategori APD otomatis">
				{#each ALL_CATEGORIES as cat (cat.code)}{@const supported =
						status?.supported_violations.includes(cat.code) ?? false}
					<li data-supported={supported}>
						<span>{cat.label}</span><strong data-supported={supported}
							>{supported ? 'Aktif' : 'Tidak aktif'}</strong
						>
					</li>{/each}
			</ul>
			<details class="system-details">
				<summary>Detail sistem</summary>
				<dl>
					<div>
						<dt>Mode operasi</dt>
						<dd>{modeDisplay.label} ({modeDisplay.code})</dd>
					</div>
					<div>
						<dt>Layanan AI</dt>
						<dd>
							{status
								? status.ai_reachable
									? 'Terjangkau'
									: 'Tidak terjangkau'
								: 'Belum diketahui'}
						</dd>
					</div>
					<div>
						<dt>Versi model</dt>
						<dd>{status?.model_version ?? 'Belum tersedia'}</dd>
					</div>
					<div>
						<dt>Draft Gemini</dt>
						<dd>
							{status?.gemini_configured
								? 'Terhubung; kuota dicek saat digunakan'
								: 'Belum diaktifkan. Gunakan templat atau tulis manual.'}
						</dd>
					</div>
				</dl>
			</details>
			<button
				type="button"
				class="button-quiet refresh-button"
				onclick={handleRefreshAll}
				disabled={authSession.systemStatusLoading || summaryLoading}
				><Icon name="refresh" size={15} />{authSession.systemStatusLoading || summaryLoading
					? 'Memperbarui...'
					: 'Cek lagi'}</button
			>
		</section>
	</div>
	<footer class="workspace-note">
		<Icon name="info" size={17} />
		<p>Periksa foto sebelum mengonfirmasi temuan. Hasil deteksi bukan jaminan lokasi aman.</p>
	</footer>
</div>

<style>
	.workspace-stack {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}
	.workspace-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
	}
	.overview {
		min-width: 0;
	}
	.section-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.2rem;
	}
	.section-heading h2 {
		margin: 0;
		font-size: 1rem;
	}
	.section-heading > :global(svg) {
		color: var(--ink-muted);
	}
	.mode-tag {
		font-size: 0.75rem;
		font-weight: 550;
		color: var(--ink-secondary);
		background: var(--bg-subtle);
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
	}
	.mode-tag[data-tone='warn'] {
		color: var(--status-warn-ink);
		background: var(--status-warn-bg);
	}
	.filter-row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.85rem;
		margin-bottom: 1.5rem;
	}
	.field-group {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 135px;
	}
	.field-group label {
		font-size: 0.75rem;
	}
	.field-group input,
	.field-group select {
		width: 100%;
		min-height: 40px;
		padding: 0.5rem 0.7rem;
	}
	.period-filter {
		flex-basis: auto;
	}
	.period-filter:not([open]) .period-fields {
		display: none;
	}
	.period-filter[open] {
		flex-basis: 100%;
		order: 2;
	}
	.period-trigger {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 40px;
		padding: 0.5rem 0.7rem;
		font-size: 0.8rem;
		color: var(--ink-secondary);
		border: 1px solid var(--border-strong);
		border-radius: 6px;
		background: var(--bg-surface);
		list-style: none;
	}
	.period-trigger::-webkit-details-marker {
		display: none;
	}
	.period-filter[open] .period-trigger {
		width: fit-content;
		margin-bottom: 0.75rem;
	}
	.period-fields {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		padding-bottom: 0.5rem;
	}
	.reset-button {
		font-size: 0.75rem;
	}
	.metrics-strip,
	.metrics-loading {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		padding: 1.5rem 0;
		border-block: 1px solid var(--border-default);
	}
	.metric {
		padding: 0 1.2rem;
		border-right: 1px solid var(--border-default);
		display: flex;
		flex-direction: column;
	}
	.metric:first-child {
		padding-left: 0;
	}
	.metric:last-child {
		padding-right: 0;
		border-right: 0;
	}
	.metric > span {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--ink-secondary);
	}
	.metric strong {
		margin: 0.35rem 0 0.25rem;
		font-size: 2.1rem;
		font-weight: 550;
		line-height: 1.3;
		letter-spacing: -0.04em;
		font-variant-numeric: tabular-nums;
	}
	.count-note {
		max-width: none;
		margin: 0.7rem 0 0;
		font-size: 0.75rem;
		color: var(--ink-muted);
	}
	.count-note strong {
		font-weight: 500;
	}
	.dashboard-columns {
		display: grid;
		grid-template-columns: minmax(0, 1.3fr) minmax(310px, 1fr);
		gap: 1.5rem;
	}
	.attention-panel,
	.readiness-panel {
		padding: 1.5rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius);
	}
	.first-inspection {
		padding-bottom: 1.25rem;
	}
	.first-inspection h3 {
		font-size: 1.1rem;
		margin: 0 0 0.5rem;
	}
	.first-inspection p {
		margin: 0 0 1rem;
		color: var(--ink-secondary);
		font-size: 0.85rem;
		line-height: 1.7;
	}
	.agenda-row {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 1.15rem 0;
		border-top: 1px solid var(--border-default);
		text-decoration: none;
		color: var(--ink-secondary);
	}
	.agenda-row:last-child {
		padding-bottom: 0;
	}
	.agenda-row > span:first-of-type {
		flex: 1;
	}
	.agenda-row strong,
	.agenda-row strong {
		font-size: 0.85rem;
		color: var(--ink-primary);
		font-weight: 550;
	}
	.agenda-row:hover strong {
		color: var(--accent-primary);
	}
	.status-label {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.75rem;
		white-space: nowrap;
		color: var(--status-warn-ink);
	}
	.status-label[data-tone='ok'] {
		color: var(--status-ok-ink);
	}
	.status-label[data-tone='err'] {
		color: var(--status-err-ink);
	}
	.status-dot {
		width: 6px;
		height: 6px;
		background: currentColor;
		border-radius: 50%;
	}
	.readiness-summary {
		margin: 0 0 1.4rem;
		font-size: 0.83rem;
		color: var(--ink-secondary);
		line-height: 1.7;
	}
	.category-heading {
		font-size: 0.75rem;
		font-weight: 550;
		margin-bottom: 0.55rem;
	}
	.category-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.category-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.65rem 0;
		border-bottom: 1px solid var(--border-default);
		font-size: 0.75rem;
		color: var(--ink-secondary);
	}
	.category-list strong {
		font-size: 0.75rem;
		font-weight: 500;
		white-space: nowrap;
	}
	.category-list strong[data-supported='true'] {
		color: var(--status-ok-ink);
	}
	.system-details {
		margin-top: 1.1rem;
		font-size: 0.75rem;
		color: var(--ink-secondary);
	}
	.system-details summary {
		padding-block: 0.25rem;
	}
	.system-details dl {
		margin: 0.75rem 0;
	}
	.system-details dl div {
		display: grid;
		grid-template-columns: 110px minmax(0, 1fr);
		gap: 0.5rem;
		padding: 0.45rem 0;
	}
	.system-details dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.refresh-button {
		margin: 0.8rem 0 -0.4rem -0.6rem;
		padding-inline: 0.6rem;
		font-size: 0.72rem;
	}
	.workspace-note {
		display: flex;
		gap: 0.65rem;
		align-items: flex-start;
		color: var(--ink-muted);
		padding-top: 0.25rem;
	}
	.workspace-note p {
		margin: 0;
		font-size: 0.73rem;
		max-width: 100ch;
	}
	.inline-message {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.85rem 1rem;
		margin-bottom: 1rem;
		border-radius: 6px;
		font-size: 0.85rem;
	}
	.inline-message.error {
		background: var(--status-err-bg);
		color: var(--status-err-ink);
	}
	.inline-message.warning {
		background: var(--status-warn-bg);
		color: var(--status-warn-ink);
	}
	.skeleton-metric {
		padding: 0 1rem;
	}
	.skeleton-metric span,
	.skeleton-metric strong {
		display: block;
		height: 10px;
		width: 70%;
		background: var(--bg-subtle);
		border-radius: 3px;
	}
	.skeleton-metric strong {
		height: 35px;
		width: 35%;
		margin-top: 1rem;
	}
	@media (max-width: 1150px) {
		.dashboard-columns {
			grid-template-columns: 1fr;
		}
		.metric {
			padding-inline: 0.8rem;
		}
	}
	@media (max-width: 760px) {
		.workspace-stack {
			gap: 1.7rem;
		}
		.workspace-header {
			align-items: flex-start;
			flex-direction: column;
			gap: 1rem;
		}
		.workspace-header > a {
			width: 100%;
		}
		.section-heading {
			margin-bottom: 1rem;
		}
		.mode-tag {
			font-size: 0.7rem;
		}
		.filter-row {
			gap: 0.75rem;
			margin-bottom: 1.2rem;
		}
		.field-group {
			flex-basis: calc(50% - 0.5rem);
			min-width: 0;
		}
		.filter-row > .field-group:nth-child(3) {
			flex-basis: 100%;
		}
		.period-filter {
			flex: 1;
		}
		.period-trigger {
			min-height: 44px;
		}
		.period-filter[open] {
			flex-basis: 100%;
		}
		.period-fields {
			flex-direction: column;
		}
		.metrics-strip,
		.metrics-loading {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			padding: 0;
		}
		.metric {
			padding: 1rem 0.5rem;
			border: 0;
			border-bottom: 1px solid var(--border-default);
		}
		.metric:first-child {
			padding-left: 0.5rem;
		}
		.metric:nth-child(odd) {
			border-right: 1px solid var(--border-default);
		}
		.metric:nth-child(even) {
			padding-left: 1.2rem;
		}
		.metric:last-child {
			grid-column: 1 / -1;
			border: 0;
			padding-left: 0.5rem;
		}
		.metric strong {
			font-size: 1.9rem;
		}
		.count-note {
			line-height: 1.7;
		}
		.dashboard-columns {
			gap: 1rem;
		}
		.attention-panel,
		.readiness-panel {
			padding: 1.15rem;
		}
		.agenda-row {
			gap: 0.65rem;
		}
		.category-list li {
			font-size: 0.75rem;
		}
		.inline-message {
			flex-wrap: wrap;
		}
	}
</style>
