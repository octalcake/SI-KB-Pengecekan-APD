<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		canApproveReport,
		createReportRequests,
		deleteReportApi,
		getReportApi,
		updateReportApi
	} from '#lib/app/reports';
	import {
		formatActionStatusLabel,
		formatGeneratedByLabel,
		formatGeneratedByShortLabel,
		formatJakartaDateTime,
		formatModeLabel,
		formatReportStatusLabel,
		formatViolationLabel,
		parseReportApiError,
		type ParsedReportError
	} from './format';
	import type { Report } from '../domain/types';

	interface Props {
		reportId: number;
	}

	let { reportId }: Props = $props();

	const requests = createReportRequests();

	let report = $state<Report | null>(null);
	let loading = $state<boolean>(true);
	let loadError = $state<ParsedReportError | null>(null);

	// Editable plain-text narrative state (preserved across failed mutations!)
	let formTitle = $state<string>('');
	let formContent = $state<string>('');
	let dirtyByOfficer = $state<boolean>(false);

	// Approval acknowledgement checkbox
	let reviewAcknowledged = $state<boolean>(false);

	// Retained operation key per version for POST /reports/{id}/regenerate idempotency & lost-response recovery
	let retainedRegenerateKey = $state<string | null>(null);
	let retainedRegenerateVersion = $state<number | null>(null);

	// Modal / confirmation toggles
	let showRegenerateConfirm = $state<boolean>(false);
	let showDeleteConfirm = $state<boolean>(false);

	// Busy flags
	let savingEdit = $state<boolean>(false);
	let regenerating = $state<boolean>(false);
	let approving = $state<boolean>(false);
	let deletingReport = $state<boolean>(false);

	let mutationError = $state<ParsedReportError | null>(null);
	let mutationSuccess = $state<string | null>(null);

	const isApproved = $derived(report?.status === 'approved');
	const isStale = $derived(Boolean(report?.is_stale));

	const hasUnsavedChanges = $derived.by(() => {
		if (!report) return false;
		return dirtyByOfficer || formTitle !== report.title || formContent !== report.content;
	});

	function syncFormFromReport(data: Report, forceOverwrite = false) {
		if (!dirtyByOfficer || forceOverwrite) {
			formTitle = data.title ?? '';
			formContent = data.content ?? '';
			dirtyByOfficer = false;
		}
	}

	function getOrMintRegenerateKey(version: number): string {
		const fresh = requests.regenerateKey(reportId, version);
		retainedRegenerateKey = fresh;
		retainedRegenerateVersion = version;
		return fresh;
	}

	function resetRegenerateKey(version: number) {
		retainedRegenerateKey = requests.regenerateKey(reportId, version);
		retainedRegenerateVersion = version;
	}

	async function loadDetail(id: number, forceSyncForm = false) {
		if (!Number.isFinite(id) || id <= 0) {
			loading = false;
			loadError = {
				status: 404,
				code: 'NOT_FOUND',
				title: 'Laporan tidak ditemukan',
				message: 'Buka laporan dari halaman Laporan.',
				fieldErrors: {},
				requestId: null,
				isUnauthorized: false,
				isForbidden: false,
				isSessionStillActive: false,
				isNoConfirmedFindings: false,
				isReportExists: false,
				isGeminiUnavailable: false,
				isInvalidGeminiOutput: false,
				isSourceChanged: false,
				isIdempotencyConflict: false,
				isRequestKeyExpired: false,
				isVersionConflict: false,
				isStaleReport: false,
				isReportLocked: false,
				isNetworkError: false
			};
			return;
		}

		loading = true;
		loadError = null;
		try {
			const data = await getReportApi(id);
			report = data;
			syncFormFromReport(data, forceSyncForm);
		} catch (err) {
			loadError = parseReportApiError(err, `Gagal memuat detail laporan #${id}.`);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const id = reportId;
		requests.clear();
		dirtyByOfficer = false;
		reviewAcknowledged = false;
		retainedRegenerateKey = null;
		retainedRegenerateVersion = null;
		showRegenerateConfirm = false;
		showDeleteConfirm = false;
		mutationError = null;
		mutationSuccess = null;
		void loadDetail(id, true);
	});

	async function reloadPreservingUnsavedInput() {
		if (!report) return;
		mutationError = null;
		try {
			const fresh = await getReportApi(report.id);
			report = fresh;
			if (retainedRegenerateVersion !== null && retainedRegenerateVersion !== fresh.version) {
				retainedRegenerateKey = null;
				retainedRegenerateVersion = null;
			}
			mutationSuccess = 'Data terbaru dimuat. Suntinganmu belum hilang.';
		} catch (err) {
			mutationError = parseReportApiError(err, 'Gagal memuat ulang versi terbaru laporan.');
		}
	}

	async function handleSaveNarrative(event: SubmitEvent) {
		event.preventDefault();
		if (!report || savingEdit) return;
		mutationError = null;
		mutationSuccess = null;

		const trimmedTitle = formTitle.trim();
		const trimmedContent = formContent.trim();
		const localFields: Record<string, string> = {};
		if (trimmedTitle.length < 1 || trimmedTitle.length > 200) {
			localFields.title = 'Judul laporan wajib diisi (1–200 karakter).';
		}
		if (trimmedContent.length < 1 || trimmedContent.length > 20000) {
			localFields.content = 'Isi laporan wajib diisi (1–20.000 karakter).';
		}
		if (Object.keys(localFields).length > 0) {
			mutationError = {
				status: 422,
				code: 'VALIDATION_ERROR',
				title: 'Periksa isian laporan',
				message: Object.values(localFields)[0],
				fieldErrors: localFields,
				requestId: null,
				isUnauthorized: false,
				isForbidden: false,
				isSessionStillActive: false,
				isNoConfirmedFindings: false,
				isReportExists: false,
				isGeminiUnavailable: false,
				isInvalidGeminiOutput: false,
				isSourceChanged: false,
				isIdempotencyConflict: false,
				isRequestKeyExpired: false,
				isVersionConflict: false,
				isStaleReport: false,
				isReportLocked: false,
				isNetworkError: false
			};
			return;
		}

		savingEdit = true;
		try {
			const updated = await updateReportApi(report.id, {
				version: report.version,
				title: trimmedTitle,
				content: trimmedContent
			});
			report = updated;
			syncFormFromReport(updated, true);
			mutationSuccess = updated.is_stale
				? `Teks tersimpan. Temuan sumber masih berubah; buat ulang draf sebelum disetujui.`
				: 'Laporan tersimpan.';
		} catch (err) {
			mutationError = parseReportApiError(err, 'Laporan belum tersimpan. Coba lagi.');
		} finally {
			savingEdit = false;
		}
	}

	async function handleConfirmRegenerate() {
		if (!report || regenerating) return;
		mutationError = null;
		mutationSuccess = null;

		getOrMintRegenerateKey(report.version);
		regenerating = true;
		try {
			const updated = await requests.regenerate(report);
			report = updated;
			syncFormFromReport(updated, true);
			showRegenerateConfirm = false;
			reviewAcknowledged = false;
			mutationSuccess = `Draf #${updated.id} sudah diperbarui dari temuan terbaru.`;
		} catch (err) {
			const parsed = parseReportApiError(err, 'Draf belum bisa dibuat ulang. Coba lagi.');
			mutationError = parsed;
			showRegenerateConfirm = false;
			if (
				parsed.isSourceChanged ||
				parsed.isIdempotencyConflict ||
				parsed.isRequestKeyExpired ||
				parsed.isVersionConflict
			) {
				resetRegenerateKey(report.version);
			}
			// Note: formTitle and formContent are intentionally NOT overwritten so officer's unsaved draft edits survive Gemini/external failure!
		} finally {
			regenerating = false;
		}
	}

	async function handleApproveReport() {
		if (!report || approving || !canApproveReport(report, reviewAcknowledged)) return;
		mutationError = null;
		mutationSuccess = null;

		approving = true;
		try {
			const updated = await requests.approve(report, reviewAcknowledged);
			if (!updated) return;
			report = updated;
			syncFormFromReport(updated, true);
			mutationSuccess = `Laporan #${updated.id} disetujui. Laporan dan temuannya sekarang terkunci.`;
		} catch (err) {
			mutationError = parseReportApiError(err, 'Gagal menyetujui laporan.');
		} finally {
			approving = false;
		}
	}

	async function handleDeleteDraft() {
		if (!report || deletingReport) return;
		mutationError = null;
		mutationSuccess = null;

		deletingReport = true;
		try {
			await deleteReportApi(report.id, report.version);
			await goto('/reports');
		} catch (err) {
			mutationError = parseReportApiError(err, 'Draf belum bisa dihapus. Coba lagi.');
			showDeleteConfirm = false;
		} finally {
			deletingReport = false;
		}
	}
</script>

<div class="report-detail-workspace">
	<nav class="breadcrumb" aria-label="Breadcrumb">
		<a href="/reports">← Laporan</a>
	</nav>

	{#if loading}
		<div class="state-box" role="status" aria-live="polite" data-testid="report-detail-loading">
			Memuat detail laporan #{reportId}...
		</div>
	{:else if loadError}
		<div
			class="error-banner"
			role="alert"
			data-testid="report-load-error"
			data-error-code={loadError.code}
		>
			<div class="error-header">
				<strong>{loadError.title}</strong>
			</div>
			<p>{loadError.message}</p>
			<div class="recovery-actions">
				<button type="button" class="btn-secondary" onclick={() => loadDetail(reportId, false)}>
					Coba lagi
				</button>
				<a href="/reports" class="btn-outline">Kembali ke laporan</a>
			</div>
		</div>
	{:else if report}
		<header class="detail-header">
			<div>
				<h1>Laporan #{report.id}</h1>
			</div>

			<div class="header-badges">
				<span class="badge status-{report.status}" data-testid="report-status-badge">
					{formatReportStatusLabel(report.status)}
				</span>
				<span class="badge gen-{report.generated_by}" data-testid="report-provenance-badge">
					Dibuat dengan: {formatGeneratedByShortLabel(report.generated_by)}
				</span>
				<span class="badge mode-{report.snapshot?.mode ?? 'real'}" data-testid="report-mode-badge">
					Mode: {formatModeLabel(report.snapshot?.mode ?? 'real')}
				</span>
				{#if report.is_stale}
					<span class="badge stale-badge" data-testid="report-stale-badge"> Temuan berubah </span>
				{:else if report.status === 'draft'}
					<span class="badge fresh-badge" data-testid="report-fresh-badge"> Temuan sesuai </span>
				{/if}
				<span class="version-pill" data-testid="report-version-badge">
					Versi #{report.version}
				</span>
			</div>
		</header>

		{#if isApproved}
			<div class="locked-banner" role="status" data-testid="approved-report-locked-banner">
				<strong>Laporan sudah disetujui</strong>
				Disetujui petugas #{report.approved_by ?? '—'} pada {formatJakartaDateTime(
					report.approved_at
				)}. Laporan dan temuan di dalamnya tidak bisa diubah atau dihapus.
			</div>
		{/if}

		{#if report.is_stale && !isApproved}
			<div class="stale-banner" role="alert" data-testid="report-stale-warning-banner">
				<div class="stale-banner-head">
					<strong>Temuan sumber berubah</strong>
				</div>
				<p>
					Temuan sesi S-{report.session_id} berubah sejak draf dibuat.
					<strong>Menyimpan teks saja tidak memperbarui temuan dalam laporan.</strong>
					Buat ulang draf sebelum menyetujuinya.
				</p>
			</div>
		{/if}

		{#if mutationError}
			<div
				class="error-banner"
				role="alert"
				data-testid="report-mutation-error"
				data-error-code={mutationError.code}
			>
				<div class="error-header">
					<strong>{mutationError.title}</strong>
				</div>
				<p>{mutationError.message}</p>
				{#if mutationError.requestId}
					<p class="req-id">ID Permintaan: <code>{mutationError.requestId}</code></p>
				{/if}

				<div class="recovery-actions">
					{#if mutationError.isVersionConflict || mutationError.isRequestKeyExpired || mutationError.isSourceChanged}
						<button
							type="button"
							class="btn-secondary"
							onclick={reloadPreservingUnsavedInput}
							data-testid="reload-report-preserving-input"
						>
							Ambil data terbaru
						</button>
					{/if}

					{#if mutationError.isNetworkError && retainedRegenerateKey}
						<button
							type="button"
							class="btn-secondary"
							onclick={handleConfirmRegenerate}
							disabled={regenerating}
							data-testid="retry-regenerate-same-key"
						>
							Coba lagi
						</button>
					{/if}
				</div>
			</div>
		{/if}

		{#if mutationSuccess}
			<div class="success-banner" role="status" data-testid="report-mutation-success">
				{mutationSuccess}
			</div>
		{/if}

		<div class="detail-grid">
			<!-- Left column: Narrative Editor / Read-only View + Approval & Lifecycle Actions -->
			<section class="narrative-panel" aria-labelledby="narrative-heading">
				<div class="panel-top">
					<h2 id="narrative-heading">
						{isApproved ? 'Isi laporan' : 'Edit draf'}
					</h2>
					{#if hasUnsavedChanges && !isApproved}
						<span class="unsaved-pill" data-testid="unsaved-edits-indicator">
							Perubahan belum disimpan
						</span>
					{/if}
				</div>

				{#if isApproved}
					<div class="readonly-narrative-view" data-testid="approved-readonly-view">
						<div class="readonly-field">
							<span class="field-label">Judul:</span>
							<p class="readonly-title" data-testid="approved-report-title">{report.title}</p>
						</div>
						<div class="readonly-field">
							<span class="field-label">Isi laporan:</span>
							<pre
								class="readonly-content"
								data-testid="approved-report-content">{report.content}</pre>
						</div>
					</div>
				{:else}
					<form
						onsubmit={handleSaveNarrative}
						class="narrative-form"
						data-testid="report-edit-form"
					>
						<div class="form-field">
							<label for="report-title-input">Judul laporan (maks. 200 karakter)</label>
							<input
								id="report-title-input"
								type="text"
								maxlength="200"
								value={formTitle}
								oninput={(e) => {
									formTitle = (e.currentTarget as HTMLInputElement).value;
									dirtyByOfficer = true;
								}}
							/>
							{#if mutationError?.fieldErrors?.title}
								<p class="field-error">{mutationError.fieldErrors.title}</p>
							{/if}
						</div>

						<div class="form-field">
							<label for="report-content-input"> Isi laporan (maks. 20.000 karakter) </label>
							<textarea
								id="report-content-input"
								rows="14"
								maxlength="20000"
								value={formContent}
								oninput={(e) => {
									formContent = (e.currentTarget as HTMLTextAreaElement).value;
									dirtyByOfficer = true;
								}}
							></textarea>
							{#if mutationError?.fieldErrors?.content}
								<p class="field-error">{mutationError.fieldErrors.content}</p>
							{/if}
						</div>

						<div class="form-actions">
							<button
								type="submit"
								class="btn-primary"
								disabled={savingEdit}
								data-testid="save-report-narrative-btn"
							>
								{savingEdit ? 'Menyimpan...' : 'Simpan laporan'}
							</button>
						</div>
					</form>

					<hr class="section-divider" />

					<!-- Regeneration & Fresh Source Replacement Panel -->
					<div class="lifecycle-box" data-testid="regenerate-section">
						<h3>Buat ulang draf</h3>
						<p class="box-desc">
							Gemini menulis ulang judul dan isi dari temuan terbaru. Jika gagal, draf ini tetap
							tersimpan.
						</p>
						<p class="backend-limit-note" data-testid="non-gemini-stale-refresh-note">
							Tanpa Gemini, draf tidak bisa diperbarui langsung. Simpan catatan yang dibutuhkan
							sebelum menghapusnya, lalu buat draf baru di halaman <a href="/reports">Laporan</a>.
						</p>

						<div class="regen-buttons">
							<button
								type="button"
								class="btn-secondary"
								onclick={() => {
									showRegenerateConfirm = true;
								}}
								disabled={regenerating}
								data-testid="open-regenerate-confirm-btn"
							>
								Buat ulang dengan Gemini
							</button>
						</div>

						{#if showRegenerateConfirm}
							<div
								class="confirm-dialog"
								role="region"
								aria-label="Konfirmasi Regenerasi Gemini"
								data-testid="regenerate-confirm-dialog"
							>
								<h4>Ganti draf ini?</h4>
								<p>
									Judul dan isi akan diganti dengan hasil Gemini berdasarkan temuan terbaru dari
									sesi S-{report.session_id}.
									{#if hasUnsavedChanges}
										<strong class="warn-inline">
											Ada perubahan yang belum disimpan. Jika berhasil, perubahan itu akan diganti.
											Jika gagal, isianmu tetap ada.
										</strong>
									{/if}
								</p>
								<span hidden data-testid="regenerate-request-key"
									>{retainedRegenerateKey && retainedRegenerateVersion === report.version
										? retainedRegenerateKey
										: ''}</span
								>
								<div class="confirm-actions">
									<button
										type="button"
										class="btn-primary"
										onclick={handleConfirmRegenerate}
										disabled={regenerating}
										data-testid="confirm-regenerate-btn"
									>
										{regenerating ? 'Membuat ulang...' : 'Ganti draf'}
									</button>
									<button
										type="button"
										class="btn-outline"
										onclick={() => {
											showRegenerateConfirm = false;
										}}
										disabled={regenerating}
										data-testid="cancel-regenerate-btn"
									>
										Batal
									</button>
								</div>
							</div>
						{/if}
					</div>

					<hr class="section-divider" />

					<!-- Explicit Human Review Acknowledgement & Approval Panel -->
					<div class="lifecycle-box approval-box" data-testid="approval-section">
						<h3>Setujui laporan</h3>
						<p class="box-desc">
							Setelah disetujui, laporan dan semua temuan di dalamnya tidak bisa diubah atau
							dihapus.
						</p>

						<label class="ack-checkbox-label">
							<input
								type="checkbox"
								bind:checked={reviewAcknowledged}
								data-testid="review-acknowledged-checkbox"
							/>
							<span>
								Saya sudah memeriksa isi laporan dan semua temuan terkonfirmasi di dalamnya. Saya
								setuju mengunci laporan ini.
							</span>
						</label>
						{#if mutationError?.fieldErrors?.review_acknowledged}
							<p class="field-error">{mutationError.fieldErrors.review_acknowledged}</p>
						{/if}

						{#if isStale}
							<p class="field-error" data-testid="approve-disabled-reason">
								Temuan sumber berubah. Buat ulang draf sebelum menyetujuinya.
							</p>
						{:else if !reviewAcknowledged}
							<p class="helper-note" data-testid="approve-disabled-reason">
								Centang pernyataan di atas setelah selesai memeriksa.
							</p>
						{/if}

						<div class="approval-actions">
							<button
								type="button"
								class="btn-approve"
								onclick={handleApproveReport}
								disabled={approving || !canApproveReport(report, reviewAcknowledged)}
								data-testid="approve-report-btn"
							>
								{approving ? 'Menyetujui...' : 'Setujui dan kunci'}
							</button>

							<button
								type="button"
								class="btn-danger-outline"
								onclick={() => {
									showDeleteConfirm = true;
								}}
								disabled={deletingReport}
								data-testid="open-delete-report-btn"
							>
								Hapus draf
							</button>
						</div>

						{#if showDeleteConfirm}
							<div
								class="confirm-dialog danger"
								role="region"
								aria-label="Konfirmasi Hapus draf"
								data-testid="delete-report-confirm-dialog"
							>
								<h4>Hapus draf #{report.id}</h4>
								<p>
									Draf akan dihapus dari daftar. Temuan asli tetap tersimpan dan bisa dipakai untuk
									membuat laporan baru.
								</p>
								<div class="confirm-actions">
									<button
										type="button"
										class="btn-danger"
										onclick={handleDeleteDraft}
										disabled={deletingReport}
										data-testid="confirm-delete-report-btn"
									>
										{deletingReport ? 'Menghapus...' : 'Hapus draf'}
									</button>
									<button
										type="button"
										class="btn-outline"
										onclick={() => {
											showDeleteConfirm = false;
										}}
										disabled={deletingReport}
									>
										Batal
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</section>

			<!-- Right column: Provenance Metadata + Immutable Historical Source Snapshot & Linked Findings -->
			<aside class="snapshot-sidebar" aria-labelledby="snapshot-heading">
				<section class="sidebar-card" aria-labelledby="provenance-heading">
					<h2 id="provenance-heading">Detail laporan</h2>
					<dl class="meta-dl">
						<div>
							<dt>ID Laporan &amp; Versi</dt>
							<dd>#{report.id} (Versi #{report.version})</dd>
						</div>
						<div>
							<dt>Status Laporan</dt>
							<dd>{formatReportStatusLabel(report.status)}</dd>
						</div>
						<div>
							<dt>Metode penyusunan</dt>
							<dd data-testid="detail-generated-by">
								<strong>{formatGeneratedByLabel(report.generated_by)}</strong>
							</dd>
						</div>
						{#if report.generated_by === 'gemini'}
							<div>
								<dt>Model Gemini</dt>
								<dd data-testid="detail-gemini-model">
									<code>{report.gemini_model ?? '—'}</code> · Prompt:
									<code>{report.prompt_version ?? '—'}</code>
								</dd>
							</div>
						{/if}
						<div>
							<dt>Kesesuaian temuan</dt>
							<dd data-testid="detail-is-stale">
								{report.is_stale
									? 'Temuan berubah sejak draf dibuat'
									: 'Sesuai dengan temuan yang tersimpan'}
							</dd>
						</div>
						<div>
							<dt>SHA-256</dt>
							<dd>
								<code class="hash-code" data-testid="detail-source-hash">{report.source_hash}</code>
							</dd>
						</div>
						<div>
							<dt>Dibuat Pada</dt>
							<dd>
								{formatJakartaDateTime(report.created_at)} (Oleh Petugas #{report.created_by})
							</dd>
						</div>
						<div>
							<dt>Terakhir Diperbarui</dt>
							<dd>{formatJakartaDateTime(report.updated_at)}</dd>
						</div>
						{#if report.approved_at}
							<div>
								<dt>Disetujui Pada</dt>
								<dd data-testid="detail-approved-at">
									{formatJakartaDateTime(report.approved_at)} (Oleh Petugas #{report.approved_by ??
										'—'})
								</dd>
							</div>
						{/if}
					</dl>
				</section>

				<section
					class="sidebar-card"
					aria-labelledby="snapshot-heading"
					data-testid="report-snapshot-section"
				>
					<h2 id="snapshot-heading">Temuan dalam laporan</h2>
					<p class="snapshot-desc">
						Salinan temuan dari sesi <strong>S-{report.snapshot.session_id}</strong> saat laporan dibuat.
					</p>

					<div class="snapshot-header-box">
						<div>
							<strong>Proyek:</strong>
							{report.snapshot.project.name} (#{report.snapshot.project.id})
						</div>
						<div>
							<strong>Zona:</strong>
							{report.snapshot.zone.name} (#{report.snapshot.zone.id})
						</div>
						<div>
							<strong>Sesi &amp; Mode:</strong> S-{report.snapshot.session_id} ({formatModeLabel(
								report.snapshot.mode
							)})
						</div>
						<div>
							<strong>Jumlah temuan:</strong>
							{report.snapshot.findings.length} temuan terkonfirmasi
						</div>
					</div>

					<ul class="snapshot-findings-list" data-testid="snapshot-findings-list">
						{#each report.snapshot.findings as sf (sf.id)}
							<li class="snapshot-finding-item" data-testid="snapshot-finding-{sf.id}">
								<div class="sf-top">
									<strong>Temuan [F-{sf.id}]</strong>
									<span class="sf-version">Versi tersimpan #{sf.version}</span>
								</div>
								<div class="sf-meta">
									<span><strong>Kategori:</strong> {formatViolationLabel(sf.violation_type)}</span>
									<span
										><strong>Waktu Tangkap:</strong> {formatJakartaDateTime(sf.captured_at)}</span
									>
									<span
										><strong>Status tindak lanjut:</strong>
										{formatActionStatusLabel(sf.action_status)}</span
									>
								</div>
								<div class="sf-notes">
									<span class="note-label">Catatan pemeriksaan:</span>
									<p class="plain-text-note">{sf.notes || '—'}</p>
								</div>
								<div class="sf-notes">
									<span class="note-label">Catatan tindak lanjut:</span>
									<p class="plain-text-note">{sf.action_notes || 'Belum dicatat'}</p>
								</div>
								<div class="sf-link-row">
									<a
										href="/findings/{sf.id}"
										class="finding-link"
										data-testid="snapshot-finding-link-{sf.id}"
									>
										Buka temuan F-{sf.id} →
									</a>
								</div>
							</li>
						{/each}
					</ul>
				</section>
			</aside>
		</div>
	{/if}
</div>

<style>
	.report-detail-workspace {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.breadcrumb a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--accent-primary, #0969da);
		text-decoration: none;
	}

	.breadcrumb a:hover {
		text-decoration: underline;
	}

	.detail-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border-default, #d0d7de);
		min-width: 0;
	}

	h1 {
		margin: 0;
		font-size: 1.5rem;
		color: var(--ink-primary, #1f2328);
		overflow-wrap: anywhere;
	}

	.header-badges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.6rem;
		border-radius: 6px;
		font-size: 0.75rem;
		font-weight: 700;
		border: 1px solid var(--border-default, #d0d7de);
		background: var(--bg-subtle, #f6f8fa);
	}

	.badge.status-approved,
	.badge.fresh-badge {
		background: var(--status-ok-bg, #dafbe1);
		border-color: var(--status-ok-border, #2da44e);
		color: var(--status-ok-ink, #116329);
	}

	.badge.status-draft {
		background: var(--status-warn-bg, #fff8c5);
		border-color: var(--status-warn-border, #d4a72c);
		color: var(--status-warn-ink, #7d4e00);
	}

	.badge.stale-badge {
		background: var(--status-err-bg, #ffebe9);
		border-color: var(--status-err-border, #cf222e);
		color: var(--status-err-ink, #a40e26);
	}

	.version-pill {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--ink-secondary, #57606a);
	}

	.locked-banner {
		padding: 0.9rem 1.1rem;
		border-radius: 8px;
		border: 1px solid var(--status-ok-border, #2da44e);
		background: var(--status-ok-bg, #dafbe1);
		color: var(--status-ok-ink, #116329);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.stale-banner {
		padding: 0.95rem 1.1rem;
		border-radius: 8px;
		border: 1px solid var(--status-warn-border, #d4a72c);
		background: var(--status-warn-bg, #fff8c5);
		color: var(--status-warn-ink, #7d4e00);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.stale-banner p {
		margin: 0.35rem 0 0;
	}

	.error-banner {
		padding: 0.95rem 1.1rem;
		border-radius: 8px;
		border: 1px solid var(--status-err-border, #cf222e);
		background: var(--status-err-bg, #ffebe9);
		color: var(--status-err-ink, #a40e26);
		font-size: 0.875rem;
	}

	.error-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.35rem;
	}

	.recovery-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.65rem;
	}

	.success-banner {
		padding: 0.85rem 1.1rem;
		border-radius: 8px;
		border: 1px solid var(--status-ok-border, #2da44e);
		background: var(--status-ok-bg, #dafbe1);
		color: var(--status-ok-ink, #116329);
		font-size: 0.875rem;
		font-weight: 600;
	}

	.detail-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.95fr);
		gap: 1.25rem;
		align-items: start;
	}

	.narrative-panel,
	.sidebar-card,
	.state-box {
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-default, #d0d7de);
		border-radius: 10px;
		padding: 1.2rem 1.25rem;
		min-width: 0;
	}

	.snapshot-sidebar {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
	}

	.panel-top {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.panel-top h2,
	.sidebar-card h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	.unsaved-pill {
		font-size: 0.75rem;
		font-weight: 700;
		padding: 0.2rem 0.55rem;
		border-radius: 6px;
		background: var(--status-warn-bg, #fff8c5);
		border: 1px solid var(--status-warn-border, #d4a72c);
		color: var(--status-warn-ink, #7d4e00);
	}

	.narrative-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}

	label {
		font-size: 0.875rem;
		font-weight: 600;
	}

	input[type='text'],
	textarea {
		width: 100%;
		min-width: 0;
		padding: 0.6rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--border-strong, #8c959f);
		background: var(--bg-surface, #ffffff);
		color: var(--ink-primary, #1f2328);
		font-size: 0.9375rem;
		font-family: inherit;
	}

	textarea {
		resize: vertical;
		line-height: 1.55;
	}

	.form-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}

	.helper-note {
		font-size: 0.8125rem;
		color: var(--ink-secondary, #57606a);
	}

	.readonly-narrative-view {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}

	.field-label {
		display: block;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--ink-secondary, #57606a);
		margin-bottom: 0.25rem;
	}

	.readonly-title {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 700;
		padding: 0.65rem 0.85rem;
		border-radius: 6px;
		background: var(--bg-subtle, #f6f8fa);
		border: 1px solid var(--border-default, #d0d7de);
		overflow-wrap: anywhere;
	}

	.readonly-content {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
		font-family: inherit;
		font-size: 0.9375rem;
		line-height: 1.6;
		padding: 0.85rem 1rem;
		border-radius: 6px;
		background: var(--bg-subtle, #f6f8fa);
		border: 1px solid var(--border-default, #d0d7de);
	}

	.section-divider {
		border: none;
		border-top: 1px solid var(--border-default, #d0d7de);
		margin: 1.25rem 0;
	}

	.lifecycle-box h3 {
		margin: 0 0 0.35rem;
		font-size: 1rem;
	}

	.box-desc {
		margin: 0 0 0.85rem;
		font-size: 0.875rem;
		color: var(--ink-secondary, #57606a);
		line-height: 1.5;
	}

	.regen-buttons,
	.approval-actions,
	.confirm-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
	}

	.confirm-dialog {
		margin-top: 0.85rem;
		padding: 0.95rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--status-warn-border, #d4a72c);
		background: var(--status-warn-bg, #fff8c5);
		color: var(--status-warn-ink, #7d4e00);
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}

	.confirm-dialog.danger {
		border-color: var(--status-err-border, #cf222e);
		background: var(--status-err-bg, #ffebe9);
		color: var(--status-err-ink, #a40e26);
	}

	.confirm-dialog h4 {
		margin: 0 0 0.4rem;
		font-size: 0.9375rem;
	}

	.confirm-dialog p {
		margin: 0 0 0.65rem;
		line-height: 1.45;
	}

	.ack-checkbox-label {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.75rem 0.85rem;
		border-radius: 8px;
		border: 1px solid var(--border-default, #d0d7de);
		background: var(--bg-subtle, #f6f8fa);
		font-weight: 500;
		font-size: 0.875rem;
		line-height: 1.45;
		margin-bottom: 0.85rem;
		cursor: pointer;
	}

	.ack-checkbox-label input {
		margin-top: 0.2rem;
	}

	.meta-dl {
		margin: 0.85rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		font-size: 0.875rem;
	}

	.meta-dl dt {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--ink-secondary, #57606a);
	}

	.meta-dl dd {
		margin: 0.15rem 0 0;
		color: var(--ink-primary, #1f2328);
		overflow-wrap: anywhere;
	}

	.hash-code {
		display: inline-block;
		overflow-wrap: anywhere;
		word-break: break-all;
		font-size: 0.75rem;
		background: var(--bg-subtle, #f6f8fa);
		padding: 0.15rem 0.35rem;
		border-radius: 4px;
	}

	.snapshot-desc {
		margin: 0.5rem 0 0.75rem;
		font-size: 0.875rem;
		color: var(--ink-secondary, #57606a);
	}

	.snapshot-header-box {
		padding: 0.75rem 0.85rem;
		border-radius: 8px;
		background: var(--bg-subtle, #f6f8fa);
		border: 1px solid var(--border-default, #d0d7de);
		font-size: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: 0.85rem;
		overflow-wrap: anywhere;
	}

	.snapshot-findings-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.snapshot-finding-item {
		padding: 0.85rem;
		border-radius: 8px;
		border: 1px solid var(--border-default, #d0d7de);
		background: var(--bg-surface, #ffffff);
		font-size: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.sf-top {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.35rem;
	}

	.sf-version {
		font-size: 0.75rem;
		color: var(--ink-secondary, #57606a);
	}

	.sf-meta {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.note-label {
		display: block;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--ink-secondary, #57606a);
	}

	.plain-text-note {
		margin: 0.1rem 0 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
		background: var(--bg-subtle, #f6f8fa);
		padding: 0.4rem 0.55rem;
		border-radius: 4px;
	}

	.finding-link {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		font-weight: 600;
		color: var(--accent-primary, #0969da);
		text-decoration: none;
	}

	.finding-link:hover {
		text-decoration: underline;
	}

	.btn-primary,
	.btn-secondary,
	.btn-outline,
	.btn-approve,
	.btn-danger,
	.btn-danger-outline {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem 0.95rem;
		border-radius: 6px;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
		border: 1px solid transparent;
	}

	.btn-primary {
		background: var(--accent-primary, #0969da);
		color: #ffffff;
	}

	.btn-approve {
		background: #1a7f37;
		color: #ffffff;
	}

	.btn-secondary {
		background: var(--bg-surface, #ffffff);
		border-color: var(--border-strong, #8c959f);
		color: var(--ink-primary, #1f2328);
	}

	.btn-outline {
		background: transparent;
		border-color: var(--border-default, #d0d7de);
		color: var(--ink-primary, #1f2328);
	}

	.btn-danger {
		background: #cf222e;
		color: #ffffff;
	}

	.btn-danger-outline {
		background: transparent;
		border-color: #cf222e;
		color: #cf222e;
	}

	.btn-primary:disabled,
	.btn-secondary:disabled,
	.btn-outline:disabled,
	.btn-approve:disabled,
	.btn-danger:disabled,
	.btn-danger-outline:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.field-error {
		margin: 0.25rem 0 0;
		font-size: 0.8125rem;
		color: var(--status-err-ink, #a40e26);
		font-weight: 600;
	}

	@media (max-width: 960px) {
		.detail-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 640px) {
		.narrative-panel,
		.sidebar-card,
		.state-box {
			padding: 0.95rem 1rem;
		}

		.form-actions > button,
		.regen-buttons > button,
		.approval-actions > button,
		.confirm-actions > button {
			width: 100%;
			min-height: 2.75rem;
		}
	}
</style>
