<script lang="ts">
	import { page } from '$app/state';
	import Icon from '#lib/shared/presentation/Icon.svelte';
	import { onMount } from 'svelte';
	import FindingEvidenceViewer from './FindingEvidenceViewer.svelte';
	import ManualFindingForm from './ManualFindingForm.svelte';
	import { listFindingsApi, loadGalleryLookups, listZonesLookupApi } from '#lib/app/findings';
	import {
		formatActionStatusLabel,
		formatJakartaDateTime,
		formatModeLabel,
		formatSourceLabel,
		formatVerificationStatusLabel,
		formatViolationShortLabel,
		localFilterDateToUtcRfc3339,
		parseFindingApiError,
		type ParsedFindingError
	} from './format';
	import type {
		ActionStatus,
		Finding,
		FindingFilterParams,
		FindingPageMeta,
		ProjectLookup,
		SessionLookup,
		VerificationStatus,
		ViolationType,
		ZoneLookup
	} from '../domain/types';

	let projects = $state<ProjectLookup[]>([]);
	let zonesByProject = $state<Record<number, ZoneLookup[]>>({});
	let sessions = $state<SessionLookup[]>([]);

	// Filter form state
	let filterProjectId = $state<number>(0);
	let filterZoneId = $state<number>(0);
	let filterSessionId = $state<number>(0);
	let filterViolationType = $state<ViolationType | ''>('');
	let filterVerificationStatus = $state<VerificationStatus | ''>('');
	let filterActionStatus = $state<ActionStatus | ''>('');
	let filterFromDate = $state<string>('');
	let filterToDate = $state<string>('');
	let filterSort = $state<'id' | 'captured_at'>('id');
	let pageSize = $state<number>(20);
	let currentPage = $state<number>(1);

	// List state
	let findings = $state<Finding[]>([]);
	let pageMeta = $state<FindingPageMeta>({ page: 1, page_size: 20, total: 0 });
	let loading = $state<boolean>(true);
	let errorState = $state<ParsedFindingError | null>(null);

	const availableZones = $derived.by(() => {
		if (filterProjectId > 0) {
			return zonesByProject[filterProjectId] ?? [];
		}
		const all: ZoneLookup[] = [];
		for (const list of Object.values(zonesByProject)) {
			all.push(...list);
		}
		return all;
	});

	const availableSessions = $derived.by(() => {
		return sessions.filter((s) => {
			if (filterProjectId > 0 && s.project_id !== filterProjectId) return false;
			if (filterZoneId > 0 && s.zone_id !== filterZoneId) return false;
			return true;
		});
	});

	const totalPages = $derived(
		Math.max(1, Math.ceil((pageMeta.total || 0) / (pageMeta.page_size || 20)))
	);

	function projectName(projectId: number): string {
		return projects.find((p) => p.id === projectId)?.name ?? `Proyek #${projectId}`;
	}

	function zoneName(projectId: number, zoneId: number): string {
		const list = zonesByProject[projectId] ?? [];
		return list.find((z) => z.id === zoneId)?.name ?? `Zona #${zoneId}`;
	}

	async function ensureZonesLoaded(projectId: number): Promise<void> {
		if (projectId <= 0 || zonesByProject[projectId]) return;
		try {
			const res = await listZonesLookupApi(projectId, 100);
			zonesByProject = {
				...zonesByProject,
				[projectId]: res.data
			};
		} catch {
			// non-fatal lookup failure
		}
	}

	async function loadLookups(): Promise<void> {
		try {
			const lookups = await loadGalleryLookups();
			projects = lookups.projects;
			sessions = lookups.sessions;
			zonesByProject = lookups.zonesByProject;
		} catch {
			// Lookup errors do not block main findings query error reporting
		}
	}

	function buildCurrentFilter(pageOverride?: number): FindingFilterParams {
		const fromUtc = filterFromDate ? localFilterDateToUtcRfc3339(filterFromDate, 'from') : '';
		const toUtc = filterToDate ? localFilterDateToUtcRfc3339(filterToDate, 'to') : '';
		return {
			project_id: filterProjectId > 0 ? filterProjectId : undefined,
			zone_id: filterZoneId > 0 ? filterZoneId : undefined,
			session_id: filterSessionId > 0 ? filterSessionId : undefined,
			violation_type: filterViolationType || undefined,
			verification_status: filterVerificationStatus || undefined,
			action_status: filterActionStatus || undefined,
			from: fromUtc || undefined,
			to: toUtc || undefined,
			sort: filterSort,
			page: pageOverride ?? currentPage,
			page_size: pageSize
		};
	}

	async function loadFindings(pageOverride?: number): Promise<void> {
		const targetPage = pageOverride ?? currentPage;
		loading = true;
		errorState = null;

		try {
			const res = await listFindingsApi(buildCurrentFilter(targetPage));
			findings = res.data;
			pageMeta = res.meta;
			currentPage = res.meta.page;
		} catch (err) {
			errorState = parseFindingApiError(err, 'Gagal memuat daftar temuan dari server Go.');
		} finally {
			loading = false;
		}
	}

	async function handleProjectFilterChange(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		const pid = Number(select.value) || 0;
		filterProjectId = pid;
		filterZoneId = 0;
		filterSessionId = 0;
		if (pid > 0) {
			await ensureZonesLoaded(pid);
		}
	}

	function handleZoneFilterChange(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		filterZoneId = Number(select.value) || 0;
		filterSessionId = 0;
	}

	async function handleFilterSubmit(event: SubmitEvent) {
		event.preventDefault();
		currentPage = 1;
		await loadFindings(1);
	}

	async function handleResetFilters() {
		filterProjectId = 0;
		filterZoneId = 0;
		filterSessionId = 0;
		filterViolationType = '';
		filterVerificationStatus = '';
		filterActionStatus = '';
		filterFromDate = '';
		filterToDate = '';
		filterSort = 'id';
		currentPage = 1;
		await loadFindings(1);
	}

	async function goToPage(pageNumber: number) {
		if (pageNumber < 1 || pageNumber > totalPages || pageNumber === currentPage) return;
		currentPage = pageNumber;
		await loadFindings(pageNumber);
	}

	function handleManualCreated() {
		// Prepend or reload page 1
		void loadFindings(1);
	}

	function handleManualSessionCreated(newSession: SessionLookup) {
		sessions = [newSession, ...sessions.filter((s) => s.id !== newSession.id)];
	}

	onMount(async () => {
		const verification = page.url.searchParams.get('verification_status');
		if (verification === 'pending' || verification === 'confirmed' || verification === 'rejected') {
			filterVerificationStatus = verification;
		}
		await Promise.all([loadLookups(), loadFindings(1)]);
	});
</script>

<div class="findings-workspace">
	<header class="page-header">
		<div>
			<h1>Temuan</h1>
		</div>
		<div class="summary-chip" role="status" aria-live="polite">
			Total: <strong data-testid="findings-total-count">{pageMeta.total}</strong>
			<span class="unit-note">temuan, bukan pekerja unik</span>
		</div>
	</header>

	<form class="filter-bar" onsubmit={handleFilterSubmit} aria-label="Filter Galeri Temuan">
		<div class="filter-grid">
			<div class="filter-field">
				<label for="filter-project">Proyek</label>
				<select
					id="filter-project"
					name="project_id"
					value={filterProjectId}
					onchange={handleProjectFilterChange}
				>
					<option value={0}>Semua Proyek</option>
					{#each projects as proj (proj.id)}
						<option value={proj.id}>
							{proj.name} ({proj.status === 'archived' ? 'Arsip' : 'Aktif'})
						</option>
					{/each}
				</select>
			</div>
			<div class="filter-field">
				<label for="filter-violation">Kategori APD</label>
				<select id="filter-violation" name="violation_type" bind:value={filterViolationType}>
					<option value="">Semua</option>
					<option value="NO_HELMET">Tanpa helm</option>
					<option value="NO_VEST">Tanpa rompi</option>
				</select>
			</div>
			<div class="filter-field">
				<label for="filter-verification">Status pemeriksaan</label>
				<select
					id="filter-verification"
					name="verification_status"
					bind:value={filterVerificationStatus}
				>
					<option value="">Semua</option>
					<option value="pending">Menunggu</option>
					<option value="confirmed">Terkonfirmasi</option>
					<option value="rejected">Ditolak</option>
				</select>
			</div>
		</div>
		<details class="advanced-filters">
			<summary
				><Icon name="filter" size={16} />Filter lanjutan{filterZoneId ||
				filterSessionId ||
				filterActionStatus ||
				filterFromDate ||
				filterToDate ||
				filterSort !== 'id'
					? ' (aktif)'
					: ''}</summary
			>
			<div class="filter-grid">
				<div class="filter-field">
					<label for="filter-zone">Zona</label>
					<select
						id="filter-zone"
						name="zone_id"
						value={filterZoneId}
						onchange={handleZoneFilterChange}
					>
						<option value={0}>Semua Zona</option>
						{#each availableZones as z (z.id)}
							<option value={z.id}>
								{z.name} ({projectName(z.project_id)})
							</option>
						{/each}
					</select>
				</div>
				<div class="filter-field">
					<label for="filter-session">Sesi inspeksi</label>
					<select id="filter-session" name="session_id" bind:value={filterSessionId}>
						<option value={0}>Semua Sesi</option>
						{#each availableSessions as sess (sess.id)}
							<option value={sess.id}>
								Sesi #{sess.id} ({formatModeLabel(sess.mode)} • {sess.status})
							</option>
						{/each}
					</select>
				</div>
				<div class="filter-field">
					<label for="filter-action">Status tindak lanjut</label>
					<select id="filter-action" name="action_status" bind:value={filterActionStatus}>
						<option value="">Semua Tindak Lanjut</option>
						<option value="pending">Belum ditindaklanjuti</option>
						<option value="in_progress">Dalam proses</option>
						<option value="completed">Selesai</option>
					</select>
				</div>
				<div class="filter-field">
					<label for="filter-from">Dari Tanggal (WIB)</label>
					<input id="filter-from" name="from" type="date" bind:value={filterFromDate} />
				</div>
				<div class="filter-field">
					<label for="filter-to">Sampai Tanggal (WIB)</label>
					<input id="filter-to" name="to" type="date" bind:value={filterToDate} />
				</div>
				<div class="filter-field">
					<label for="filter-sort">Urutan</label>
					<select id="filter-sort" name="sort" bind:value={filterSort}>
						<option value="id">Terbaru dicatat</option>
						<option value="captured_at">Terbaru difoto</option>
					</select>
				</div>
			</div>
		</details>

		<div class="filter-actions">
			<div class="action-buttons">
				<button type="button" class="btn-reset" onclick={handleResetFilters}> Reset filter </button>
				<button type="submit" class="btn-apply" disabled={loading}>
					{loading ? 'Memuat...' : 'Terapkan'}
				</button>
			</div>
		</div>
	</form>

	<ManualFindingForm
		{projects}
		{zonesByProject}
		{sessions}
		onEnsureZonesLoaded={ensureZonesLoaded}
		onCreated={handleManualCreated}
		onSessionCreated={handleManualSessionCreated}
	/>

	{#if errorState}
		<section
			class="state-banner error"
			role="alert"
			data-testid="findings-list-error"
			data-error-code={errorState.code}
		>
			<div class="banner-top">
				<strong>{errorState.title}</strong>
			</div>
			<p>{errorState.message}</p>
			<div class="banner-actions">
				<button type="button" class="btn-retry" onclick={() => loadFindings(currentPage)}>
					Coba lagi
				</button>
				{#if errorState.isUnauthorized}
					<a href="/login" class="btn-link">Masuk lagi</a>
				{/if}
			</div>
		</section>
	{:else if loading}
		<section class="state-banner loading" role="status" aria-live="polite">
			<strong>Memuat temuan...</strong>
		</section>
	{:else if findings.length === 0}
		<section class="state-banner empty" role="status" data-testid="findings-empty-state">
			<Icon name="findings" size={30} />
			<strong>Belum ada temuan</strong>
			<p>Coba ubah filter atau mulai inspeksi baru. Hasil kosong bukan jaminan lokasi aman.</p>
			<div class="banner-actions">
				<button type="button" class="btn-reset" onclick={handleResetFilters}>
					Tampilkan semua
				</button>
			</div>
		</section>
	{:else}
		<section class="gallery-grid" aria-label="Galeri Kartu Temuan">
			{#each findings as item (item.id)}
				<article
					class="finding-card"
					data-testid={`finding-card-${item.id}`}
					data-verification={item.verification_status}
					data-mode={item.mode}
				>
					<div class="card-thumb">
						<FindingEvidenceViewer finding={item} compact={true} defaultShowOverlay={true} />
					</div>

					<div class="card-body">
						<div class="card-badges">
							<span class="id-badge">#{item.id}</span>
							<span class="mode-badge" data-mode={item.mode}>
								Mode: {formatModeLabel(item.mode)}
							</span>
							<span class="verif-badge" data-status={item.verification_status}>
								{formatVerificationStatusLabel(item.verification_status)}
							</span>
							<span class="action-badge" data-status={item.action_status}>
								Tindakan: {formatActionStatusLabel(item.action_status)}
							</span>
						</div>

						<h2 class="card-title">
							Indikasi {formatViolationShortLabel(item.violation_type)}
						</h2>

						{#if item.detected_violation && item.detected_violation !== item.violation_type}
							<p class="correction-note">
								Indikasi awal model: <code>{item.detected_violation}</code> → Dikoreksi petugas
								menjadi
								<strong>{item.violation_type}</strong>
							</p>
						{/if}

						<dl class="card-meta">
							<div>
								<dt>Lokasi</dt>
								<dd>{projectName(item.project_id)} — {zoneName(item.project_id, item.zone_id)}</dd>
							</div>
							<div>
								<dt>Sesi &amp; Sumber</dt>
								<dd>Sesi #{item.session_id} • {formatSourceLabel(item.source)}</dd>
							</div>
							<div>
								<dt>Waktu foto</dt>
								<dd>{formatJakartaDateTime(item.captured_at)}</dd>
							</div>
							<div>
								<dt>Hasil deteksi</dt>
								<dd>
									{#if item.track_key}
										Track sementara <code>{item.track_key}</code>
									{:else}
										Tanpa track (manual)
									{/if}
									•
									{#if item.confidence !== null && item.confidence !== undefined}
										Skor {(item.confidence * 100).toFixed(0)}%
									{:else}
										Skor tidak tersedia
									{/if}
								</dd>
							</div>
						</dl>

						{#if item.notes}
							<p class="card-notes">
								<strong>Catatan:</strong>
								{item.notes}
							</p>
						{/if}

						<div class="card-footer">
							<a
								href={`/findings/${item.id}`}
								class="open-detail-link"
								aria-label={`Buka Temuan #${item.id}`}
							>
								Buka Temuan #{item.id}
							</a>
						</div>
					</div>
				</article>
			{/each}
		</section>

		<nav class="pagination-bar" aria-label="Navigasi Halaman Temuan">
			<div class="page-summary">
				Halaman <strong>{pageMeta.page}</strong> dari <strong>{totalPages}</strong>
				({pageMeta.total} temuan)
			</div>
			<div class="page-controls">
				<button
					type="button"
					class="page-btn"
					disabled={pageMeta.page <= 1 || loading}
					onclick={() => goToPage(pageMeta.page - 1)}
				>
					Sebelumnya
				</button>
				<button
					type="button"
					class="page-btn"
					disabled={pageMeta.page >= totalPages || loading}
					onclick={() => goToPage(pageMeta.page + 1)}
				>
					Berikutnya
				</button>
			</div>
		</nav>
	{/if}
</div>

<style>
	.filter-actions {
		grid-column: 2;
		justify-self: end;
	}
	@media (max-width: 720px) {
		.filter-bar .filter-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.filter-bar > .filter-grid > .filter-field:first-child {
			grid-column: 1 / -1;
		}
		.filter-bar {
			grid-template-columns: minmax(0, 1fr);
		}
		.filter-actions {
			grid-column: 1;
			width: 100%;
		}
	}
	.advanced-filters {
		margin-top: 0;
		font-size: 0.8rem;
		color: var(--ink-secondary);
	}
	.advanced-filters summary {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 36px;
		width: fit-content;
		list-style: none;
	}
	.advanced-filters summary::-webkit-details-marker {
		display: none;
	}
	.advanced-filters summary:hover {
		color: var(--accent-primary);
	}
	.advanced-filters[open] {
		grid-column: 1 / -1;
	}
	.advanced-filters[open] .filter-grid {
		margin-top: 0.75rem;
	}
	.state-banner.empty {
		text-align: center;
		padding: 3rem 1.5rem;
		display: flex;
		align-items: center;
		flex-direction: column;
		gap: 0.85rem;
	}
	.state-banner.empty > :global(svg) {
		color: var(--ink-muted);
		margin-bottom: 0.35rem;
	}
	.state-banner.empty p {
		margin: 0;
		max-width: 55ch;
		font-size: 0.875rem;
	}

	.findings-workspace {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.page-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border-default, #dcd7cb);
	}

	.page-header h1 {
		margin: 0;
		font-size: 1.5rem;
	}

	.summary-chip {
		font-size: 0.8rem;
		color: var(--ink-secondary);
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.unit-note {
		font-size: 0.75rem;
		color: var(--ink-muted, #655e53);
	}

	.filter-bar {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		padding: 1.1rem 1.25rem;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.75rem;
		min-width: 0;
	}

	.filter-grid {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.8rem;
	}

	.filter-field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	.filter-field label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--ink-primary, #1c1a17);
	}

	.filter-field select,
	.filter-field input {
		width: 100%;
		min-width: 0;
		padding: 0.45rem 0.6rem;
		border-radius: 6px;
		border: 1px solid var(--border-strong, #c9c3b6);
		background: var(--bg-surface, #ffffff);
		font-size: 0.85rem;
	}

	.filter-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding-top: 0.65rem;
		border-top: 1px solid var(--border-default, #dcd7cb);
	}

	.action-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	.btn-reset,
	.btn-apply,
	.btn-retry {
		padding: 0.5rem 0.95rem;
		border-radius: 7px;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-reset {
		background: var(--bg-subtle, #ece9e1);
		border: 1px solid var(--border-strong, #c9c3b6);
		color: var(--ink-primary, #1c1a17);
	}

	.btn-apply {
		background: var(--accent-primary, #9a3412);
		border: 1px solid var(--accent-primary, #9a3412);
		color: #ffffff;
	}

	.btn-retry {
		background: #ffffff;
		border: 1px solid currentColor;
		color: inherit;
	}

	.state-banner {
		padding: 1.25rem;
		border-radius: 10px;
		border: 1px solid var(--border-strong, #c9c3b6);
		background: var(--bg-surface, #ffffff);
	}

	.state-banner.error {
		background: var(--status-err-bg, #fef2f2);
		border-color: var(--status-err-border, #fca5a5);
		color: var(--status-err-ink, #991b1b);
	}

	.banner-top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.banner-actions {
		margin-top: 0.75rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}

	.gallery-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
		gap: 1.1rem;
	}

	.finding-card {
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-strong, #c9c3b6);
		border-radius: 10px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.card-thumb {
		padding: 0.75rem 0.75rem 0 0.75rem;
	}

	.card-body {
		padding: 0.9rem 1rem 1rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		flex: 1;
		min-width: 0;
	}

	.card-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}

	.id-badge,
	.mode-badge,
	.verif-badge,
	.action-badge {
		font-size: 0.72rem;
		font-weight: 700;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
	}

	.id-badge {
		background: #1c1a17;
		color: #ffffff;
	}

	.mode-badge {
		background: var(--bg-subtle, #ece9e1);
		color: var(--ink-primary, #1c1a17);
		border: 1px solid var(--border-strong, #c9c3b6);
	}

	.mode-badge[data-mode='simulated'],
	.mode-badge[data-mode='manual'] {
		background: var(--status-warn-bg, #fffbeb);
		color: var(--status-warn-ink, #92400e);
		border-color: var(--status-warn-border, #fcd34d);
	}

	.verif-badge[data-status='pending'] {
		background: var(--status-warn-bg, #fffbeb);
		color: var(--status-warn-ink, #92400e);
		border: 1px solid var(--status-warn-border, #fcd34d);
	}

	.verif-badge[data-status='confirmed'] {
		background: var(--status-ok-bg, #ecfdf5);
		color: var(--status-ok-ink, #065f46);
		border: 1px solid var(--status-ok-border, #6ee7b7);
	}

	.verif-badge[data-status='rejected'] {
		background: var(--status-err-bg, #fef2f2);
		color: var(--status-err-ink, #991b1b);
		border: 1px solid var(--status-err-border, #fca5a5);
	}

	.action-badge {
		background: var(--bg-subtle, #ece9e1);
		color: var(--ink-secondary, #4a453d);
	}

	.action-badge[data-status='completed'] {
		background: var(--status-ok-bg, #ecfdf5);
		color: var(--status-ok-ink, #065f46);
	}

	.card-title {
		margin: 0;
		font-size: 1.05rem;
		overflow-wrap: anywhere;
	}

	.correction-note {
		margin: 0;
		font-size: 0.78rem;
		color: var(--status-warn-ink, #92400e);
	}

	.card-meta {
		margin: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.3rem;
		font-size: 0.8rem;
	}

	.card-meta div {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.25rem 0.5rem;
		border-bottom: 1px dashed var(--border-default, #dcd7cb);
		padding-bottom: 0.2rem;
	}

	.card-meta dt {
		color: var(--ink-muted, #655e53);
		font-weight: 600;
	}

	.card-meta dd {
		margin: 0;
		text-align: right;
		color: var(--ink-primary, #1c1a17);
		overflow-wrap: anywhere;
	}

	.card-notes {
		margin: 0;
		font-size: 0.8rem;
		color: var(--ink-secondary, #4a453d);
		background: var(--bg-subtle, #ece9e1);
		padding: 0.45rem 0.6rem;
		border-radius: 6px;
		overflow-wrap: anywhere;
	}

	.card-footer {
		margin-top: auto;
		padding-top: 0.5rem;
		display: flex;
		justify-content: flex-end;
	}

	.open-detail-link {
		display: inline-block;
		padding: 0.45rem 0.85rem;
		border-radius: 6px;
		background: var(--accent-primary, #9a3412);
		color: #ffffff;
		text-decoration: none;
		font-size: 0.83rem;
		font-weight: 600;
	}

	.open-detail-link:hover {
		background: var(--accent-hover, #7c2d12);
	}

	.pagination-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.85rem 1.1rem;
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-strong, #c9c3b6);
		border-radius: 8px;
	}

	.page-summary {
		font-size: 0.85rem;
		color: var(--ink-secondary, #4a453d);
	}

	.page-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.page-btn {
		padding: 0.4rem 0.8rem;
		border-radius: 6px;
		border: 1px solid var(--border-strong, #c9c3b6);
		background: var(--bg-surface, #ffffff);
		font-size: 0.83rem;
		font-weight: 600;
		cursor: pointer;
	}

	.page-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 640px) {
		.filter-bar {
			background: var(--bg-surface);
			border: 1px solid var(--border-default);
			border-radius: 12px;
			padding: 1.1rem 1.25rem;
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 0.75rem;
			min-width: 0;
		}

		.action-buttons {
			width: 100%;
		}

		.action-buttons > button {
			flex: 1 1 120px;
		}

		.gallery-grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.card-footer {
			justify-content: stretch;
		}

		.open-detail-link {
			width: 100%;
			text-align: center;
		}

		.page-controls {
			width: 100%;
		}

		.page-controls > button {
			flex: 1 1 120px;
		}
	}
	@media (max-width: 720px) {
		.advanced-filters .filter-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 360px) {
		.filter-bar > .filter-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
