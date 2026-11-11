<script lang="ts">
	import { onMount } from 'svelte';
	import { isApiError } from '#lib/api/client';
	import { authSession } from '#lib/auth/session.svelte';
	import {
		dashboardSummaryApi,
		localDateRangeToUtcInterval,
		type DashboardSummary
	} from '#lib/dashboard/api';
	import { listProjectsApi, listZonesApi, type Project, type Zone } from '#lib/projects/api';
	import type { SystemMode, ViolationType } from '#lib/types/api';

	const ALL_CATEGORIES: Array<{ code: ViolationType; label: string; description: string }> = [
		{
			code: 'NO_HELMET',
			label: 'Indikasi Tanpa Helm (NO_HELMET)',
			description: 'Deteksi kepala terlihat tanpa pelindung helm proyek.'
		},
		{
			code: 'NO_VEST',
			label: 'Indikasi Tanpa Rompi (NO_VEST)',
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
		summary
			? summary.findings_pending + summary.findings_confirmed + summary.findings_rejected
			: 0
	);

	const summaryModeBadge = $derived.by(() => {
		const m = summary?.mode ?? filterMode;
		if (m === 'real') {
			return {
				label: 'MODE NYATA (real)',
				tone: 'ok' as const,
				note: 'Menampilkan statistik sesi & temuan dari inferensi model nyata saja (tidak dicampur simulasi/manual).'
			};
		}
		if (m === 'simulated') {
			return {
				label: 'MODE SIMULASI (simulated)',
				tone: 'warn' as const,
				note: 'Menampilkan hasil simulasi deterministik secara terpisah; bukan aktivitas inspeksi kamera nyata.'
			};
		}
		return {
			label: 'MODE MANUAL (manual)',
			tone: 'warn' as const,
			note: 'Menampilkan pencatatan observasi manual petugas secara terpisah tanpa inferensi otomatis.'
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
				summary: 'Sedang memeriksa kesiapan layanan AI melalui backend Go.'
			};
		}
		if (status.mode === 'manual') {
			return {
				badge: 'Siap (Mode Manual)',
				tone: 'ok' as const,
				summary: 'Mode manual tidak memerlukan model inferensi aktif.'
			};
		}
		if (status.ai_ready) {
			return {
				badge: 'Siap',
				tone: 'ok' as const,
				summary: 'Layanan AI terjangkau dan model siap menerima sampel frame sesi.'
			};
		}
		return {
			badge: 'Belum Siap',
			tone: 'warn' as const,
			summary: status.ai_reachable
				? 'Layanan AI terjangkau, tetapi bobot model atau mode belum siap. Sesi monitoring otomatis belum dapat dimulai.'
				: 'Layanan inferensi AI tidak terjangkau atau belum siap. CRUD data tetap dapat digunakan, namun sesi monitoring kamera otomatis akan ditolak (503).'
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
			const res = await listProjectsApi({ page: 1, page_size: 100 });
			if (seq !== projectsReqSeq) return;
			projects = res.data;
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
				const res = await listZonesApi(pid, { page: 1, page_size: 100 });
				if (zSeq !== zonesReqSeq || Number(filterProjectId) !== pid) return;
				zones = res.data;
			} catch (err) {
				if (zSeq !== zonesReqSeq || Number(filterProjectId) !== pid) return;
				lookupError = isApiError(err) ? err.message : 'Gagal memuat daftar zona untuk proyek terpilih.';
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
			const tz = summary?.timezone || 'Asia/Jakarta';
			const interval = localDateRangeToUtcInterval(filterFromDate, filterToDate, tz);
			const pid = filterProjectId ? Number(filterProjectId) : undefined;
			const zid = filterZoneId ? Number(filterZoneId) : undefined;

			const nextSummary = await dashboardSummaryApi({
				mode: filterMode,
				project_id: pid && pid > 0 ? pid : undefined,
				zone_id: zid && zid > 0 ? zid : undefined,
				from: interval.from,
				to: interval.to
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

<svelte:head>
	<title>Dashboard & Ruang Kerja Inspeksi K3</title>
</svelte:head>

<div class="workspace-stack">
	<header class="workspace-header">
		<div>
			<h1>Ruang Kerja Inspeksi K3</h1>
			<p class="lead">
				Ringkasan statistik inspeksi terfilter berdasarkan data persisten serta status kesiapan aktual layanan lokal.
			</p>
		</div>
		<div class="header-actions">
			<a href="/projects" class="secondary-link">Kelola Proyek & Zona</a>
			<button
				type="button"
				class="refresh-button"
				onclick={handleRefreshAll}
				disabled={authSession.systemStatusLoading || summaryLoading}
			>
				{authSession.systemStatusLoading || summaryLoading
					? 'Memperbarui...'
					: 'Perbarui Status Sistem'}
			</button>
		</div>
	</header>

	<section class="panel" aria-labelledby="dashboard-summary-heading">
		<div class="panel-header">
			<div>
				<h2 id="dashboard-summary-heading">Ringkasan Dashboard Inspeksi</h2>
				<p class="panel-summary">
					{summaryModeBadge.note}
				</p>
			</div>
			<span class="status-tag" data-tone={summaryModeBadge.tone} data-testid="summary-mode-badge">
				{summaryModeBadge.label}
			</span>
		</div>

		<form
			class="filter-grid"
			aria-label="Filter ringkasan dashboard"
			onsubmit={(e) => {
				e.preventDefault();
				void loadSummary();
			}}
		>
			<div class="field-group">
				<label for="dashboard-filter-mode">Mode Data</label>
				<select
					id="dashboard-filter-mode"
					bind:value={filterMode}
					onchange={() => void loadSummary()}
				>
					<option value="real">Nyata (real)</option>
					<option value="simulated">Simulasi (simulated)</option>
					<option value="manual">Manual (manual)</option>
				</select>
			</div>

			<div class="field-group">
				<label for="dashboard-filter-project">Filter Proyek</label>
				<select
					id="dashboard-filter-project"
					bind:value={filterProjectId}
					onchange={() => void handleProjectFilterChange()}
					disabled={loadingLookups}
				>
					<option value="">Semua Proyek</option>
					{#each projects as proj (proj.id)}
						<option value={String(proj.id)}>
							{proj.name}{proj.status === 'archived' ? ' (Diarsipkan)' : ''}
						</option>
					{/each}
				</select>
			</div>

			<div class="field-group">
				<label for="dashboard-filter-zone">Filter Zona</label>
				<select
					id="dashboard-filter-zone"
					bind:value={filterZoneId}
					onchange={() => void loadSummary()}
					disabled={!filterProjectId || loadingZones}
					title={!filterProjectId ? 'Pilih proyek terlebih dahulu untuk memfilter zona' : undefined}
				>
					<option value="">
						{!filterProjectId ? 'Semua Zona (Pilih proyek dulu)' : 'Semua Zona pada Proyek'}
					</option>
					{#each zones as z (z.id)}
						<option value={String(z.id)}>
							{z.name}{z.status === 'archived' ? ' (Diarsipkan)' : ''}
						</option>
					{/each}
				</select>
			</div>

			<div class="field-group">
				<label for="dashboard-filter-from">Dari Tanggal ({configuredTimezone})</label>
				<input
					id="dashboard-filter-from"
					type="date"
					bind:value={filterFromDate}
					onchange={() => void loadSummary()}
				/>
			</div>

			<div class="field-group">
				<label for="dashboard-filter-to">Sampai Tanggal ({configuredTimezone})</label>
				<input
					id="dashboard-filter-to"
					type="date"
					bind:value={filterToDate}
					onchange={() => void loadSummary()}
				/>
			</div>

			<div class="filter-actions">
				<button
					type="button"
					class="secondary-button"
					onclick={handleResetDashboardFilters}
					disabled={
						summaryLoading &&
						filterMode === 'real' &&
						!filterProjectId &&
						!filterZoneId &&
						!filterFromDate &&
						!filterToDate
					}
				>
					Reset Filter
				</button>
			</div>
		</form>

		{#if lookupError}
			<div class="warn-banner" role="alert">
				<strong>Catatan Filter:</strong> {lookupError}
			</div>
		{/if}

		{#if dateValidationError}
			<div class="error-banner" role="alert" data-error-kind="validation">
				<strong>Rentang Tanggal Tidak Valid:</strong> {dateValidationError}
			</div>
		{/if}

		{#if summaryError}
			<div class="error-banner" role="alert" data-error-kind="backend">
				<div class="banner-row">
					<div>
						<strong>Gagal Memuat Ringkasan Dashboard:</strong> {summaryError}
					</div>
					<button type="button" class="secondary-button" onclick={loadSummary}>
						Coba Lagi
					</button>
				</div>
			</div>
		{:else if summaryLoading && !summary}
			<div class="state-box" role="status" aria-busy="true">
				Memuat angka ringkasan dashboard dari server...
			</div>
		{:else if summary}
			<div class="metrics-grid" aria-busy={summaryLoading ? 'true' : undefined}>
				<article class="metric-card">
					<span class="metric-label">Sesi Inspeksi</span>
					<strong class="metric-value" data-testid="metric-sessions">{summary.sessions}</strong>
					<span class="metric-hint">Dihitung berdasarkan waktu mulai sesi (started_at)</span>
				</article>

				<article class="metric-card">
					<span class="metric-label">Temuan Menunggu Review</span>
					<strong class="metric-value" data-testid="metric-findings-pending">
						{summary.findings_pending}
					</strong>
					<span class="metric-hint">Status verifikasi pending (captured_at)</span>
				</article>

				<article class="metric-card">
					<span class="metric-label">Temuan Terkonfirmasi</span>
					<strong class="metric-value" data-testid="metric-findings-confirmed">
						{summary.findings_confirmed}
					</strong>
					<span class="metric-hint">Diverifikasi positif oleh petugas K3</span>
				</article>

				<article class="metric-card">
					<span class="metric-label">Temuan Ditolak</span>
					<strong class="metric-value" data-testid="metric-findings-rejected">
						{summary.findings_rejected}
					</strong>
					<span class="metric-hint">Indikasi palsu/ditolak setelah pemeriksaan bukti</span>
				</article>

				<article class="metric-card highlight">
					<span class="metric-label">Tindakan Terbuka</span>
					<strong class="metric-value" data-testid="metric-actions-open">
						{summary.confirmed_actions_open}
					</strong>
					<span class="metric-hint">Temuan confirmed dengan tindak lanjut belum selesai</span>
				</article>
			</div>

			{#if summary.sessions === 0 && summaryTotalFindings === 0}
				<div class="state-box empty" role="status">
					<strong>Belum ada sesi atau temuan yang tercatat untuk filter ini.</strong>
					<span>
						Pastikan proyek dan zona aktif telah disiapkan di halaman <a href="/projects">Proyek & Zona</a> sebelum memulai sesi inspeksi.
					</span>
				</div>
			{/if}

			<div class="summary-meta-note" data-testid="dashboard-summary-meta">
				<span>
					<strong>Satuan hitung (<code>{summary.count_unit}</code>):</strong> Jumlah catatan temuan (<em>finding</em>), <strong>bukan jumlah pekerja unik</strong>.
				</span>
				<span>
					<strong>Zona waktu tampilan:</strong> <code>{summary.timezone}</code> (batas tanggal filter lokal dikonversi ke interval UTC).
				</span>
				<span>
					<strong>Mode ringkasan:</strong> <code>{summary.mode}</code> (data nyata, simulasi, dan manual tidak pernah digabung).
				</span>
			</div>
		{/if}
	</section>

	{#if authSession.systemStatusError}
		<div class="error-banner" role="alert">
			<strong>Gagal memuat status sistem:</strong> {authSession.systemStatusError}
		</div>
	{/if}

	<section class="panel" aria-labelledby="readiness-heading">
		<div class="panel-header">
			<h2 id="readiness-heading">Kesiapan Sistem & Provenance</h2>
			<span class="status-tag" data-tone={aiReadinessDisplay.tone}>
				{aiReadinessDisplay.badge}
			</span>
		</div>

		<p class="panel-summary">{aiReadinessDisplay.summary}</p>

		<dl class="spec-grid">
			<div class="spec-row">
				<dt>Petugas Aktif</dt>
				<dd>
					<strong>{authSession.user?.display_name ?? '-'}</strong>
					<span class="muted">
						(ID #{authSession.user?.id ?? '-'} • peran: {authSession.user?.role ?? '-'})
					</span>
				</dd>
			</div>

			<div class="spec-row">
				<dt>Mode Operasi Server</dt>
				<dd>
					<strong>{modeDisplay.label}</strong>
					<code>{modeDisplay.code}</code>
					<span class="block-note">{modeDisplay.detail}</span>
				</dd>
			</div>

			<div class="spec-row">
				<dt>Keterjangkauan Layanan AI</dt>
				<dd>
					{#if status}
						<strong>{status.ai_reachable ? 'Terjangkau' : 'Tidak Terjangkau'}</strong>
						<span class="muted">
							({status.ai_ready ? 'Siap' : 'Belum Siap'})
						</span>
					{:else}
						<span class="muted">Memuat...</span>
					{/if}
				</dd>
			</div>

			<div class="spec-row">
				<dt>Versi Model Deteksi</dt>
				<dd>
					{#if status?.model_version}
						<code>{status.model_version}</code>
					{:else}
						<span class="muted">Belum dimuat / tidak tersedia</span>
					{/if}
				</dd>
			</div>

			<div class="spec-row">
				<dt>Layanan Draft Laporan Gemini</dt>
				<dd>
					{#if status?.gemini_configured}
						<strong>Terkonfigurasi</strong>
						<span class="block-note">
							Kunci API tersedia di backend; ketersediaan kuota tetap diverifikasi saat pembuatan draft laporan.
						</span>
					{:else}
						<strong>Tidak Dikonfigurasi</strong>
						<span class="block-note">
							Pembuatan narasi otomatis Gemini nonaktif; gunakan pembuatan draft template atau manual.
						</span>
					{/if}
				</dd>
			</div>
		</dl>
	</section>

	<section class="panel" aria-labelledby="categories-heading">
		<h2 id="categories-heading">Cakupan Kategori APD Otomatis</h2>
		<p class="panel-summary">
			Kategori yang tidak tercantum pada manifest model dinonaktifkan agar antarmuka tidak mengklaim cakupan deteksi otomatis yang belum ada.
		</p>

		<ul class="category-list">
			{#each ALL_CATEGORIES as cat (cat.code)}
				{@const supported = status?.supported_violations.includes(cat.code) ?? false}
				<li class="category-row" data-supported={supported}>
					<div class="category-info">
						<strong>{cat.label}</strong>
						<span>{cat.description}</span>
					</div>
					<span class="status-tag" data-tone={supported ? 'ok' : 'neutral'}>
						{supported ? 'Didukung Otomatis' : 'Tidak Aktif / Belum Didukung'}
					</span>
				</li>
			{/each}
		</ul>
	</section>

	<section class="panel notice-panel" aria-labelledby="principles-heading">
		<h2 id="principles-heading">Prinsip Operasional Inspeksi K3</h2>
		<p>
			Sistem mendeteksi <strong>indikasi visual</strong>, bukan membuktikan pelanggaran hukum atau memastikan keselamatan seluruh lokasi. <strong>Tracking ID sementara bukan identitas pekerja.</strong> Petugas K3 wajib memeriksa bukti foto asli sebelum mengonfirmasi atau menolak setiap temuan.
		</p>
	</section>
</div>

<style>
	.workspace-stack {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.workspace-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border-default);
	}

	.workspace-header h1 {
		margin: 0 0 0.35rem 0;
		font-size: 1.5rem;
	}

	.lead {
		margin: 0;
		font-size: 0.9375rem;
		color: var(--ink-secondary);
	}

	.header-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
	}

	.secondary-link {
		padding: 0.5rem 0.9rem;
		border-radius: 8px;
		border: 1px solid var(--accent-border);
		background: var(--accent-surface);
		color: var(--accent-primary);
		font-weight: 600;
		font-size: 0.875rem;
		text-decoration: none;
	}

	.secondary-link:hover {
		background: #fed7aa;
	}

	.refresh-button,
	.secondary-button {
		padding: 0.5rem 0.9rem;
		border-radius: 8px;
		border: 1px solid var(--border-strong);
		background: var(--bg-surface);
		color: var(--ink-primary);
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.refresh-button:hover:not(:disabled),
	.secondary-button:hover:not(:disabled) {
		background: var(--bg-subtle);
	}

	.refresh-button:disabled,
	.secondary-button:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.error-banner {
		padding: 0.75rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--status-err-border);
		background: var(--status-err-bg);
		color: var(--status-err-ink);
		font-size: 0.875rem;
	}

	.warn-banner {
		padding: 0.75rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--status-warn-border);
		background: var(--status-warn-bg);
		color: var(--status-warn-ink);
		font-size: 0.875rem;
	}

	.banner-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.panel {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		padding: 1.25rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.panel-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.panel h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	.panel-summary {
		margin: 0.25rem 0 0 0;
		font-size: 0.9375rem;
		color: var(--ink-secondary);
	}

	.filter-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(185px, 1fr));
		gap: 0.75rem;
		align-items: end;
		padding: 0.875rem;
		border-radius: 8px;
		background: var(--bg-subtle);
		border: 1px solid var(--border-default);
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.field-group label {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--ink-primary);
	}

	.field-group select,
	.field-group input {
		padding: 0.45rem 0.65rem;
		border-radius: 6px;
		border: 1px solid var(--border-strong);
		background: var(--bg-surface);
		font-size: 0.875rem;
	}

	.field-group select:disabled {
		background: var(--bg-subtle);
		color: var(--ink-muted);
		cursor: not-allowed;
	}

	.filter-actions {
		display: flex;
		align-items: center;
	}

	.metrics-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.75rem;
	}

	.metric-card {
		padding: 1rem;
		border-radius: 10px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface);
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.metric-card.highlight {
		border-color: var(--accent-border);
		background: var(--accent-surface);
	}

	.metric-label {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--ink-secondary);
	}

	.metric-value {
		font-size: 1.75rem;
		line-height: 1.15;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--ink-primary);
	}

	.metric-hint {
		font-size: 0.75rem;
		color: var(--ink-muted);
	}

	.state-box {
		padding: 1rem;
		border-radius: 8px;
		border: 1px solid var(--border-default);
		background: var(--bg-subtle);
		font-size: 0.875rem;
		color: var(--ink-secondary);
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.summary-meta-note {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border-default);
		font-size: 0.8125rem;
		color: var(--ink-secondary);
	}

	.summary-meta-note code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.78rem;
		background: var(--bg-subtle);
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
	}

	.status-tag {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.65rem;
		border-radius: 6px;
		font-size: 0.8125rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		border: 1px solid var(--border-default);
		background: var(--bg-subtle);
		color: var(--ink-secondary);
	}

	.status-tag[data-tone='ok'] {
		background: var(--status-ok-bg);
		border-color: var(--status-ok-border);
		color: var(--status-ok-ink);
	}

	.status-tag[data-tone='warn'] {
		background: var(--status-warn-bg);
		border-color: var(--status-warn-border);
		color: var(--status-warn-ink);
	}

	.spec-grid {
		margin: 0;
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--border-default);
	}

	.spec-row {
		display: grid;
		grid-template-columns: 240px minmax(0, 1fr);
		gap: 0.75rem 1.25rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--border-default);
		font-size: 0.9375rem;
	}

	.spec-row:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.spec-row dt {
		font-weight: 600;
		color: var(--ink-secondary);
	}

	.spec-row dd {
		margin: 0;
		color: var(--ink-primary);
		font-variant-numeric: tabular-nums;
	}

	.spec-row code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.8125rem;
		background: var(--bg-subtle);
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		margin-left: 0.35rem;
	}

	.muted {
		color: var(--ink-secondary);
	}

	.block-note {
		display: block;
		margin-top: 0.2rem;
		font-size: 0.8125rem;
		color: var(--ink-secondary);
	}

	.category-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--border-default);
	}

	.category-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--border-default);
	}

	.category-row:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.category-info {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.category-info strong {
		font-size: 0.9375rem;
	}

	.category-info span {
		font-size: 0.8125rem;
		color: var(--ink-secondary);
	}

	.notice-panel {
		background: var(--bg-subtle);
	}

	.notice-panel p {
		margin: 0;
		font-size: 0.875rem;
		color: var(--ink-secondary);
	}

	@media (max-width: 720px) {
		.panel {
			padding: 1rem;
		}

		.spec-row {
			grid-template-columns: 1fr;
			gap: 0.25rem;
		}
	}
</style>
