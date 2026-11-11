<script lang="ts">
	import { authSession } from '#lib/auth/session.svelte';
	import type { ViolationType } from '#lib/types/api';

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

	async function handleRefreshStatus() {
		await authSession.refreshSystemStatus();
	}
</script>

<svelte:head>
	<title>Ruang Kerja Inspeksi K3 — Status & Kesiapan Sistem</title>
</svelte:head>

<div class="workspace-stack">
	<header class="workspace-header">
		<div>
			<h1>Ruang Kerja Inspeksi K3</h1>
			<p class="lead">
				Status autentikasi petugas dan kesiapan aktual layanan lokal berdasarkan pemeriksaan langsung ke server Go.
			</p>
		</div>
		<button
			type="button"
			class="refresh-button"
			onclick={handleRefreshStatus}
			disabled={authSession.systemStatusLoading}
		>
			{authSession.systemStatusLoading ? 'Memperbarui...' : 'Perbarui Status Sistem'}
		</button>
	</header>

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

	.refresh-button {
		padding: 0.5rem 0.9rem;
		border-radius: 8px;
		border: 1px solid var(--border-strong);
		background: var(--bg-surface);
		color: var(--ink-primary);
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.refresh-button:hover:not(:disabled) {
		background: var(--bg-subtle);
	}

	.refresh-button:disabled {
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

	.panel {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		padding: 1.25rem 1.5rem;
	}

	.panel-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.panel h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	.panel-summary {
		margin: 0.35rem 0 1rem 0;
		font-size: 0.9375rem;
		color: var(--ink-secondary);
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
		margin: 0.5rem 0 0 0;
		font-size: 0.875rem;
		color: var(--ink-secondary);
	}

	@media (max-width: 720px) {
		.spec-row {
			grid-template-columns: 1fr;
			gap: 0.25rem;
		}
	}
</style>
