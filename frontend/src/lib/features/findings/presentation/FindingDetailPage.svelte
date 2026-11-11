<script lang="ts">
	import { goto } from '$app/navigation';
	import FindingEvidenceViewer from './FindingEvidenceViewer.svelte';
	import {
		deleteFindingApi,
		getFindingApi,
		loadFindingContextLookups,
		reviewFindingApi
	} from '#lib/app/findings';
	import {
		formatActionStatusLabel,
		formatConfidenceScore,
		formatJakartaDateTime,
		formatModeLabel,
		formatSourceLabel,
		formatVerificationStatusLabel,
		formatViolationLabel,
		parseFindingApiError,
		type ParsedFindingError
	} from './format';
	import type {
		ActionStatus,
		Finding,
		ProjectLookup,
		SessionLookup,
		ViolationType,
		ZoneLookup
	} from '../domain/types';

	interface Props {
		findingId: number;
	}

	let { findingId }: Props = $props();

	let finding = $state<Finding | null>(null);
	let projectLookup = $state<ProjectLookup | null>(null);
	let zoneLookup = $state<ZoneLookup | null>(null);
	let sessionLookup = $state<SessionLookup | null>(null);

	let loading = $state<boolean>(true);
	let loadError = $state<ParsedFindingError | null>(null);

	// Editable review state (preserved across failed mutations!)
	let formViolationType = $state<ViolationType>('NO_HELMET');
	let formNotes = $state<string>('');
	let formActionStatus = $state<ActionStatus>('pending');
	let formActionNotes = $state<string>('');
	let dirtyByOfficer = $state<boolean>(false);

	// Operation status & error banners
	let savingReview = $state<boolean>(false);
	let savingAction = $state<boolean>(false);
	let deletingFinding = $state<boolean>(false);
	let showDeleteConfirm = $state<boolean>(false);

	let mutationError = $state<ParsedFindingError | null>(null);
	let mutationSuccess = $state<string | null>(null);
	let isLockedByApprovedReport = $state<boolean>(false);

	const canSubmitAction = $derived(
		finding !== null &&
		finding.verification_status === 'confirmed' &&
		!isLockedByApprovedReport
	);

	const canDeleteFinding = $derived(
		finding !== null &&
		finding.verification_status !== 'confirmed' &&
		!isLockedByApprovedReport
	);

	const deleteDisabledReason = $derived.by(() => {
		if(!finding) return '';
		if(isLockedByApprovedReport) {
			return 'Terkunci oleh laporan yang sudah disetujui (REPORT_LOCKED).';
		}
		if(finding.verification_status === 'confirmed') {
			return 'Temuan Terkonfirmasi tidak dapat dihapus langsung; koreksi menjadi Ditolak dengan catatan alasan terlebih dahulu.';
		}
		return '';
	});

	function syncFormFromFinding(data: Finding, forceOverwrite = false) {
		if(!dirtyByOfficer || forceOverwrite) {
			formViolationType = data.violation_type;
			formNotes = data.notes ?? '';
			formActionStatus = data.action_status;
			formActionNotes = data.action_notes ?? '';
			dirtyByOfficer = false;
		}
	}

	async function loadContextLookups(data: Finding) {
		const context = await loadFindingContextLookups(data);
		if(findingId !== data.id) return;
		projectLookup = context.projectLookup;
		zoneLookup = context.zoneLookup;
		sessionLookup = context.sessionLookup;
	}

	async function loadDetail(id: number, forceSyncForm = false) {
		if(!Number.isFinite(id) || id <= 0) {
			loading = false;
			loadError = {
				status: 404,
				code: 'NOT_FOUND',
				title: 'ID Temuan Tidak Valid (404)',
				message: 'ID temuan harus berupa bilangan bulat positif.',
				fieldErrors: {},
				requestId: null,
				isUnauthorized: false,
				isForbidden: false,
				isManualFallbackDisabled: false,
				isEvidenceMissing: false,
				isVersionConflict: false,
				isReportLocked: false,
				isFindingConfirmedDeleteLock: false,
				isActionRequiresConfirmed: false,
				isSessionNotManual: false,
				isNetworkError: false,
				isSharedFoundationMissing: false
			};
			return;
		}

		loading = true;
		loadError = null;
		try {
			const data = await getFindingApi(id);
			finding = data;
			syncFormFromFinding(data, forceSyncForm);
			void loadContextLookups(data);
		} catch(err) {
			loadError = parseFindingApiError(
				err,
				`Gagal memuat detail temuan #${id}.`
			);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const id = findingId;
		dirtyByOfficer = false;
		mutationError = null;
		mutationSuccess = null;
		isLockedByApprovedReport = false;
		showDeleteConfirm = false;
		void loadDetail(id, true);
	});

	async function reloadPreservingUnsavedInput() {
		if(!finding) return;
		mutationError = null;
		try {
			const fresh = await getFindingApi(finding.id);
			finding = fresh;
			mutationSuccess = `Data terbaru versi #${fresh.version} berhasil dimuat ulang. Input yang sedang Anda ketik tetap dipertahankan di formulir.`;
		} catch(err) {
			mutationError = parseFindingApiError(
				err,
				'Gagal memuat ulang versi terbaru temuan.'
			);
		}
	}

	async function submitReviewDecision(targetStatus: 'confirmed' | 'rejected') {
		if(!finding || savingReview || isLockedByApprovedReport) return;
		mutationError = null;
		mutationSuccess = null;

		const trimmedNotes = formNotes.trim();
		const isCorrection =
			finding.verification_status !== 'pending' &&
			finding.verification_status !== targetStatus;

		const localFields: Record<string, string> = {};
		if(targetStatus === 'rejected' && trimmedNotes.length === 0) {
			localFields.notes = 'Alasan penolakan wajib diisi pada catatan verifikasi.';
		} else if(isCorrection && trimmedNotes.length === 0) {
			localFields.notes =
				'Catatan alasan koreksi wajib diisi saat mengubah keputusan verifikasi sebelumnya.';
		} else if(trimmedNotes.length > 2000) {
			localFields.notes = 'Catatan verifikasi maksimal 2.000 karakter.';
		}

		if(Object.keys(localFields).length > 0) {
			mutationError = {
				status: 422,
				code: 'VALIDATION_ERROR',
				title: 'Validasi Verifikasi Gagal (422)',
				message: Object.values(localFields)[0],
				fieldErrors: localFields,
				requestId: null,
				isUnauthorized: false,
				isForbidden: false,
				isManualFallbackDisabled: false,
				isEvidenceMissing: false,
				isVersionConflict: false,
				isReportLocked: false,
				isFindingConfirmedDeleteLock: false,
				isActionRequiresConfirmed: false,
				isSessionNotManual: false,
				isNetworkError: false,
				isSharedFoundationMissing: false
			};
			return;
		}

		savingReview = true;
		try {
			const updated = await reviewFindingApi(finding.id, {
				version: finding.version,
				verification_status: targetStatus,
				violation_type: formViolationType,
				notes: trimmedNotes
			});
			finding = updated;
			syncFormFromFinding(updated, true);
			mutationSuccess =
				targetStatus === 'confirmed'
					? `Temuan #${updated.id} berhasil dikonfirmasi (versi #${updated.version}).`
					: `Temuan #${updated.id} berhasil ditolak dengan alasan tercatat (versi #${updated.version}).`;
		} catch(err) {
			const parsed = parseFindingApiError(
				err,
				'Gagal menyimpan keputusan verifikasi.'
			);
			if(parsed.isReportLocked) {
				isLockedByApprovedReport = true;
			}
			mutationError = parsed;
		} finally {
			savingReview = false;
		}
	}

	async function handleSaveCorrectionOrNotesOnly(event: SubmitEvent) {
		event.preventDefault();
		if(!finding || savingReview || isLockedByApprovedReport) return;
		mutationError = null;
		mutationSuccess = null;

		const trimmedNotes = formNotes.trim();
		const localFields: Record<string, string> = {};
		if(finding.verification_status === 'rejected' && trimmedNotes.length === 0) {
			localFields.notes = 'Alasan penolakan wajib diisi pada catatan verifikasi.';
		} else if(trimmedNotes.length > 2000) {
			localFields.notes = 'Catatan verifikasi maksimal 2.000 karakter.';
		}

		if(Object.keys(localFields).length > 0) {
			mutationError = {
				status: 422,
				code: 'VALIDATION_ERROR',
				title: 'Validasi Catatan / Kategori Gagal (422)',
				message: Object.values(localFields)[0],
				fieldErrors: localFields,
				requestId: null,
				isUnauthorized: false,
				isForbidden: false,
				isManualFallbackDisabled: false,
				isEvidenceMissing: false,
				isVersionConflict: false,
				isReportLocked: false,
				isFindingConfirmedDeleteLock: false,
				isActionRequiresConfirmed: false,
				isSessionNotManual: false,
				isNetworkError: false,
				isSharedFoundationMissing: false
			};
			return;
		}

		savingReview = true;
		try {
			const updated = await reviewFindingApi(finding.id, {
				version: finding.version,
				violation_type: formViolationType,
				notes: trimmedNotes
			});
			finding = updated;
			syncFormFromFinding(updated, true);
			mutationSuccess = `Kategori akhir dan catatan verifikasi temuan #${updated.id} berhasil diperbarui (versi #${updated.version}).`;
		} catch(err) {
			const parsed = parseFindingApiError(
				err,
				'Gagal memperbarui kategori atau catatan verifikasi.'
			);
			if(parsed.isReportLocked) {
				isLockedByApprovedReport = true;
			}
			mutationError = parsed;
		} finally {
			savingReview = false;
		}
	}

	async function handleSaveFollowUp(event: SubmitEvent) {
		event.preventDefault();
		if(!finding || savingAction || isLockedByApprovedReport) return;
		mutationError = null;
		mutationSuccess = null;

		if(finding.verification_status !== 'confirmed') {
			mutationError = {
				status: 422,
				code: 'ACTION_REQUIRES_CONFIRMED',
				title: 'Tindak Lanjut Membutuhkan Konfirmasi (422)',
				message: 'Tindak lanjut hanya untuk temuan yang dikonfirmasi.',
				fieldErrors: {},
				requestId: null,
				isUnauthorized: false,
				isForbidden: false,
				isManualFallbackDisabled: false,
				isEvidenceMissing: false,
				isVersionConflict: false,
				isReportLocked: false,
				isFindingConfirmedDeleteLock: false,
				isActionRequiresConfirmed: true,
				isSessionNotManual: false,
				isNetworkError: false,
				isSharedFoundationMissing: false
			};
			return;
		}

		const trimmedActionNotes = formActionNotes.trim();
		const localFields: Record<string, string> = {};
		if(formActionStatus === 'completed' && trimmedActionNotes.length === 0) {
			localFields.action_notes =
				'Catatan tindak lanjut wajib diisi sebelum menandai tindak lanjut selesai.';
		} else if(trimmedActionNotes.length > 2000) {
			localFields.action_notes = 'Catatan tindak lanjut maksimal 2.000 karakter.';
		}

		if(Object.keys(localFields).length > 0) {
			mutationError = {
				status: 422,
				code: 'VALIDATION_ERROR',
				title: 'Validasi Tindak Lanjut Gagal (422)',
				message: Object.values(localFields)[0],
				fieldErrors: localFields,
				requestId: null,
				isUnauthorized: false,
				isForbidden: false,
				isManualFallbackDisabled: false,
				isEvidenceMissing: false,
				isVersionConflict: false,
				isReportLocked: false,
				isFindingConfirmedDeleteLock: false,
				isActionRequiresConfirmed: false,
				isSessionNotManual: false,
				isNetworkError: false,
				isSharedFoundationMissing: false
			};
			return;
		}

		savingAction = true;
		try {
			const updated = await reviewFindingApi(finding.id, {
				version: finding.version,
				action_status: formActionStatus,
				action_notes: trimmedActionNotes
			});
			finding = updated;
			syncFormFromFinding(updated, true);
			mutationSuccess = `Status tindak lanjut temuan #${updated.id} berhasil disimpan sebagai "${formatActionStatusLabel(updated.action_status)}" (versi #${updated.version}).`;
		} catch(err) {
			const parsed = parseFindingApiError(
				err,
				'Gagal menyimpan tindak lanjut temuan.'
			);
			if(parsed.isReportLocked) {
				isLockedByApprovedReport = true;
			}
			mutationError = parsed;
		} finally {
			savingAction = false;
		}
	}

	async function handleConfirmSoftDelete() {
		if(!finding || deletingFinding || isLockedByApprovedReport) return;
		mutationError = null;
		mutationSuccess = null;

		deletingFinding = true;
		try {
			await deleteFindingApi(finding.id, finding.version);
			await goto('/findings');
		} catch(err) {
			const parsed = parseFindingApiError(
				err,
				'Gagal menghapus temuan.'
			);
			if(parsed.isReportLocked) {
				isLockedByApprovedReport = true;
			}
			mutationError = parsed;
			showDeleteConfirm = false;
		} finally {
			deletingFinding = false;
		}
	}
</script>

<div class="detail-workspace">
	<nav class="breadcrumb-nav" aria-label="Breadcrumb">
		<a href="/findings" class="back-link">← Kembali ke Daftar Temuan</a>
	</nav>

	{#if loading}
		<section class="state-card loading" role="status" aria-live="polite">
			<h1>Memuat Detail Temuan #{findingId}...</h1>
			<p>Mengambil metadata bukti, provenance, dan status verifikasi dari server Go.</p>
		</section>
	{:else if loadError || !finding}
		<section
			class="state-card error"
			role="alert"
			data-testid="finding-detail-load-error"
			data-error-code={loadError?.code ?? 'NOT_FOUND'}
		>
			<h1>{loadError?.title ?? 'Temuan Tidak Ditemukan'}</h1>
			<p>{loadError?.message ?? `Data temuan #${findingId} tidak ditemukan atau telah dihapus.`}</p>
			<div class="error-actions">
				<button type="button" class="btn-secondary" onclick={() => loadDetail(findingId, true)}>
					Coba Lagi
				</button>
				<a href="/findings" class="btn-primary-link">Kembali ke Galeri Temuan</a>
			</div>
		</section>
	{:else}
		<header class="detail-header">
			<div>
				<div class="top-pills">
					<span class="pill-id">Temuan #{finding.id}</span>
					<span class="pill-mode" data-mode={finding.mode} data-testid="finding-mode-badge">
						Mode: <strong>{formatModeLabel(finding.mode)}</strong>
					</span>
					<span class="pill-source" data-source={finding.source} data-testid="finding-source-badge">
						Sumber: <strong>{formatSourceLabel(finding.source)}</strong>
					</span>
					<span class="pill-version" data-testid="finding-version-badge">
						Versi #{finding.version}
					</span>
				</div>
				<h1>Detail Temuan #{finding.id} — {formatViolationLabel(finding.violation_type)}</h1>
			</div>

			<div class="status-group">
				<div class="status-box">
					<span class="status-caption">Status Verifikasi Petugas</span>
					<span
						class="status-badge verif"
						data-status={finding.verification_status}
						data-testid="verification-status-badge"
					>
						{formatVerificationStatusLabel(finding.verification_status)}
					</span>
				</div>

				<div class="status-box">
					<span class="status-caption">Status Tindak Lanjut</span>
					<span
						class="status-badge action"
						data-status={finding.action_status}
						data-testid="action-status-badge"
					>
						{formatActionStatusLabel(finding.action_status)}
					</span>
				</div>
			</div>
		</header>

		{#if finding.mode === 'simulated'}
			<div class="provenance-notice simulated" role="status">
				<strong>PROVENANCE SIMULASI DETERMINISTIK:</strong> Temuan ini dihasilkan pada sesi mode
				<code>simulated</code> dan tetap dipisahkan dari statistik inspeksi kamera nyata.
			</div>
		{:else if finding.mode === 'manual' || finding.source === 'manual'}
			<div class="provenance-notice manual" role="status">
				<strong>PROVENANCE OBSERVASI MANUAL:</strong> Bukti foto dan catatan ini diunggah secara manual oleh petugas K3 pada sesi mode
				<code>manual</code> tanpa inferensi model YOLO.
			</div>
		{/if}

		{#if isLockedByApprovedReport}
			<div class="lock-banner" role="alert" data-testid="approved-report-lock-banner">
				<strong>TERKUNCI OLEH LAPORAN DISETUJUI (BR-08 / REPORT_LOCKED):</strong>
				Temuan ini telah menjadi bagian dari snapshot historis laporan inspeksi yang disetujui (approved). Seluruh keputusan verifikasi, kategori, catatan, tindak lanjut, dan penghapusan dikunci secara permanen untuk menjaga integritas laporan.
			</div>
		{/if}

		{#if mutationError}
			<section
				class="alert-banner error"
				role="alert"
				data-testid="finding-mutation-error"
				data-error-code={mutationError.code}
			>
				<div class="alert-top">
					<strong>{mutationError.title}</strong>
					<span class="code-tag">{mutationError.code}</span>
				</div>
				<p>{mutationError.message}</p>
				<p class="preserve-hint">
					Input catatan dan pilihan Anda tetap dipertahankan di formulir di bawah ini.
				</p>
				{#if mutationError.isVersionConflict}
					<div class="conflict-actions">
						<button
							type="button"
							class="btn-reload-conflict"
							onclick={reloadPreservingUnsavedInput}
						>
							Muat Ulang Data Terbaru (Pertahankan Input Saya)
						</button>
					</div>
				{/if}
			</section>
		{/if}

		{#if mutationSuccess}
			<section class="alert-banner success" role="status" data-testid="finding-mutation-success">
				<strong>Perubahan Tersimpan</strong>
				<p>{mutationSuccess}</p>
			</section>
		{/if}

		<div class="detail-grid">
			<!-- Left column: Original Full-Frame Evidence & Immutable Model Output -->
			<div class="evidence-column">
				<section class="panel-card" aria-labelledby="evidence-section-title">
					<h2 id="evidence-section-title" class="panel-title">
						Foto Bukti Asli Full-Frame
					</h2>
					<p class="panel-subtitle">
						Frame asli yang memicu event disimpan tanpa modifikasi piksel. Gunakan tombol di bawah gambar untuk mematikan/menampilkan overlay kotak deteksi atau memperbesar foto.
					</p>

					<FindingEvidenceViewer {finding} compact={false} defaultShowOverlay={true} />
				</section>

				<section class="panel-card" aria-labelledby="immutable-meta-title">
					<h2 id="immutable-meta-title" class="panel-title">
						Metadata Bukti &amp; Hasil Model (Immutable)
					</h2>
					<p class="panel-subtitle">
						Data di bawah ini adalah rekaman asli saat capture dan tidak pernah berubah meskipun petugas mengoreksi kategori akhir.
					</p>

					<dl class="meta-table" data-testid="immutable-metadata-list">
						<div class="meta-row">
							<dt>Proyek &amp; Zona</dt>
							<dd>
								{projectLookup ? projectLookup.name : `Proyek #${finding.project_id}`} —
								{zoneLookup ? zoneLookup.name : `Zona #${finding.zone_id}`}
							</dd>
						</div>

						<div class="meta-row">
							<dt>Sesi Monitoring</dt>
							<dd>
								Sesi #{finding.session_id}
								{#if sessionLookup}
									({sessionLookup.status}, sumber: <code>{sessionLookup.source}</code>)
								{/if}
							</dd>
						</div>

						<div class="meta-row">
							<dt>Indikasi Awal Model (Immutable)</dt>
							<dd data-testid="immutable-detected-violation">
								{#if finding.detected_violation}
									<strong>{formatViolationLabel(finding.detected_violation)}</strong>
								{:else}
									<span>Tidak ada (observasi manual petugas)</span>
								{/if}
							</dd>
						</div>

						<div class="meta-row">
							<dt>Kategori Akhir Petugas</dt>
							<dd data-testid="final-violation-type">
								<strong>{formatViolationLabel(finding.violation_type)}</strong>
							</dd>
						</div>

						<div class="meta-row">
							<dt>Skor Confidence Model</dt>
							<dd data-testid="model-confidence-score">
								{formatConfidenceScore(finding.confidence)}
							</dd>
						</div>

						<div class="meta-row">
							<dt>Referensi Track Sementara</dt>
							<dd data-testid="temporary-track-reference">
								{#if finding.track_key}
									<code>{finding.track_key}</code> (Raw Track ID: {finding.track_id ?? '—'})
									<span class="semantic-disclaimer">
										— ID episode sementara pada sesi ini, <strong>bukan identitas pekerja</strong>.
									</span>
								{:else}
									<span>Tidak ada track (temuan manual)</span>
								{/if}
							</dd>
						</div>

						<div class="meta-row">
							<dt>Versi Model &amp; Mode</dt>
							<dd>
								<code>{finding.model_version ?? 'tanpa-model (manual)'}</code> • Mode:
								<strong>{formatModeLabel(finding.mode)}</strong>
							</dd>
						</div>

						<div class="meta-row">
							<dt>Waktu Capture Frame</dt>
							<dd data-testid="finding-captured-at">
								{formatJakartaDateTime(finding.captured_at)}
								<span class="utc-sub">({finding.captured_at})</span>
							</dd>
						</div>

						<div class="meta-row">
							<dt>Waktu Diterima Server</dt>
							<dd>
								{formatJakartaDateTime(finding.received_at)}
							</dd>
						</div>

						<div class="meta-row">
							<dt>Integritas SHA-256 Bukti</dt>
							<dd>
								<code class="sha-code">{finding.evidence_sha256}</code>
							</dd>
						</div>

						{#if finding.verified_at}
							<div class="meta-row">
								<dt>Terakhir Diverifikasi</dt>
								<dd>
									Petugas ID #{finding.verified_by ?? '—'} pada {formatJakartaDateTime(finding.verified_at)}
								</dd>
							</div>
						{/if}
					</dl>
				</section>
			</div>

			<!-- Right column: Human Verification/Correction, Follow-up, and Soft Delete -->
			<div class="actions-column">
				<section class="panel-card" aria-labelledby="review-section-title">
					<h2 id="review-section-title" class="panel-title">
						Keputusan Verifikasi &amp; Koreksi Petugas K3
					</h2>
					<p class="panel-subtitle">
						Petugas K3 memeriksa bukti foto asli sebelum mengonfirmasi atau menolak temuan. Menolak temuan atau mengoreksi keputusan verifikasi lama wajib menyertakan alasan pada catatan verifikasi.
					</p>

					<form class="action-form" onsubmit={handleSaveCorrectionOrNotesOnly} novalidate>
						<div class="field-group">
							<label for="review-violation-type">Jenis Hasil Petugas (Kategori Akhir)</label>
							<select
								id="review-violation-type"
								name="violation_type"
								bind:value={formViolationType}
								onchange={() => (dirtyByOfficer = true)}
								disabled={savingReview || isLockedByApprovedReport}
								aria-invalid={Boolean(mutationError?.fieldErrors.violation_type)}
							>
								<option value="NO_HELMET">Tanpa Helm (NO_HELMET)</option>
								<option value="NO_VEST">Tanpa Rompi (NO_VEST)</option>
							</select>
							<span class="field-help">
								Mengubah kategori akhir tidak mengubah rekaman indikasi awal model (<code>{finding.detected_violation ?? 'manual'}</code>).
							</span>
							{#if mutationError?.fieldErrors.violation_type}
								<span class="field-error">{mutationError.fieldErrors.violation_type}</span>
							{/if}
						</div>

						<div class="field-group">
							<label for="review-notes">
								Catatan Verifikasi / Alasan Penolakan atau Koreksi
								{#if finding.verification_status !== 'pending'}
									(Wajib diisi bila mengubah status keputusan)
								{/if}
							</label>
							<textarea
								id="review-notes"
								name="notes"
								rows="4"
								maxlength="2000"
								placeholder="Tuliskan hasil pemeriksaan visual bukti foto asli atau alasan koreksi/penolakan..."
								bind:value={formNotes}
								oninput={() => (dirtyByOfficer = true)}
								disabled={savingReview || isLockedByApprovedReport}
								aria-invalid={Boolean(mutationError?.fieldErrors.notes)}
							></textarea>
							{#if mutationError?.fieldErrors.notes}
								<span class="field-error">{mutationError.fieldErrors.notes}</span>
							{/if}
						</div>

						<div class="decision-buttons">
							<button
								type="button"
								class="btn-confirm"
								disabled={savingReview || isLockedByApprovedReport}
								onclick={() => submitReviewDecision('confirmed')}
							>
								{savingReview
									? 'Menyimpan...'
									: finding.verification_status === 'confirmed'
										? 'Simpan & Pertahankan Konfirmasi'
										: 'Konfirmasi Temuan'}
							</button>

							<button
								type="button"
								class="btn-reject"
								disabled={savingReview || isLockedByApprovedReport}
								onclick={() => submitReviewDecision('rejected')}
							>
								{savingReview
									? 'Menyimpan...'
									: finding.verification_status === 'rejected'
										? 'Perbarui Catatan Penolakan'
										: 'Tolak Temuan'}
							</button>

							<button
								type="submit"
								class="btn-save-secondary"
								disabled={savingReview || isLockedByApprovedReport}
							>
								Simpan Kategori / Catatan Saja
							</button>
						</div>
					</form>
				</section>

				<section class="panel-card" aria-labelledby="followup-section-title">
					<h2 id="followup-section-title" class="panel-title">
						Tindak Lanjut Lapangan
					</h2>
					<p class="panel-subtitle">
						Tindak lanjut hanya tersedia untuk temuan yang berstatus <strong>Terkonfirmasi</strong>. Menandai tindak lanjut sebagai <strong>Selesai</strong> wajib menyertakan catatan tindakan.
					</p>

					{#if finding.verification_status !== 'confirmed'}
						<div class="disabled-reason-box" role="status" data-testid="followup-disabled-reason">
							<strong>Tindak lanjut belum dapat dicatat:</strong>
							Temuan saat ini berstatus <em>{formatVerificationStatusLabel(finding.verification_status)}</em>. Konfirmasi temuan di atas terlebih dahulu agar tindak lanjut dapat disimpan.
						</div>
					{/if}

					<form class="action-form" onsubmit={handleSaveFollowUp} novalidate>
						<div class="field-group">
							<label for="followup-action-status">Status Tindak Lanjut</label>
							<select
								id="followup-action-status"
								name="action_status"
								bind:value={formActionStatus}
								onchange={() => (dirtyByOfficer = true)}
								disabled={!canSubmitAction || savingAction}
								aria-invalid={Boolean(mutationError?.fieldErrors.action_status)}
							>
								<option value="pending">Belum Ditindaklanjuti (pending)</option>
								<option value="in_progress">Sedang Ditindaklanjuti (in_progress)</option>
								<option value="completed">Selesai (completed)</option>
							</select>
							{#if mutationError?.fieldErrors.action_status}
								<span class="field-error">{mutationError.fieldErrors.action_status}</span>
							{/if}
						</div>

						<div class="field-group">
							<label for="followup-action-notes">
								Catatan Tindak Lanjut {formActionStatus === 'completed' ? '*' : ''}
							</label>
							<textarea
								id="followup-action-notes"
								name="action_notes"
								rows="3"
								maxlength="2000"
								placeholder="Contoh: Petugas meminta penggunaan helm di lokasi dan memeriksa ulang langsung..."
								bind:value={formActionNotes}
								oninput={() => (dirtyByOfficer = true)}
								disabled={!canSubmitAction || savingAction}
								aria-invalid={Boolean(mutationError?.fieldErrors.action_notes)}
							></textarea>
							{#if mutationError?.fieldErrors.action_notes}
								<span class="field-error">{mutationError.fieldErrors.action_notes}</span>
							{/if}
						</div>

						<div class="followup-actions">
							<button
								type="submit"
								class="btn-save-followup"
								disabled={!canSubmitAction || savingAction}
							>
								{savingAction ? 'Menyimpan Tindak Lanjut...' : 'Simpan Tindak Lanjut'}
							</button>
						</div>
					</form>
				</section>

				<section class="panel-card danger-card" aria-labelledby="delete-section-title">
					<h2 id="delete-section-title" class="panel-title">
						Penghapusan Temuan (Soft Delete)
					</h2>
					<p class="panel-subtitle">
						Hanya temuan berstatus <code>pending</code> atau <code>rejected</code> yang belum masuk laporan disetujui yang boleh dihapus dari daftar. Tombstone tetap mempertahankan kunci deduplikasi episode.
					</p>

					{#if !canDeleteFinding}
						<p class="delete-lock-note" data-testid="delete-disabled-reason">
							<strong>Penghapusan dinonaktifkan:</strong> {deleteDisabledReason}
						</p>
					{/if}

					{#if !showDeleteConfirm}
						<button
							type="button"
							class="btn-delete-trigger"
							disabled={!canDeleteFinding || deletingFinding}
							onclick={() => (showDeleteConfirm = true)}
						>
							Hapus Temuan
						</button>
					{:else}
						<div class="delete-confirm-box" role="alertdialog" aria-label="Konfirmasi Hapus Temuan">
							<p>
								Apakah Anda yakin ingin menghapus temuan <strong>#{finding.id}</strong> (versi #{finding.version})? Temuan akan disembunyikan dari daftar dan hitungan dashboard.
							</p>
							<div class="confirm-buttons">
								<button
									type="button"
									class="btn-cancel-delete"
									disabled={deletingFinding}
									onclick={() => (showDeleteConfirm = false)}
								>
									Batal
								</button>
								<button
									type="button"
									class="btn-confirm-delete"
									disabled={deletingFinding}
									onclick={handleConfirmSoftDelete}
								>
									{deletingFinding ? 'Menghapus...' : 'Ya, Hapus Temuan'}
								</button>
							</div>
						</div>
					{/if}
				</section>
			</div>
		</div>
	{/if}
</div>

<style>
	.detail-workspace {
		display: flex;
		flex-direction: column;
		gap: 1.15rem;
	}

	.breadcrumb-nav {
		display: flex;
		align-items: center;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--accent-primary, #9a3412);
		text-decoration: none;
	}

	.back-link:hover {
		text-decoration: underline;
	}

	.detail-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding-bottom: 0.9rem;
		border-bottom: 1px solid var(--border-default, #dcd7cb);
		min-width: 0;
	}

	.top-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		margin-bottom: 0.45rem;
	}

	.pill-id,
	.pill-mode,
	.pill-source,
	.pill-version {
		font-size: 0.75rem;
		padding: 0.18rem 0.5rem;
		border-radius: 4px;
		background: var(--bg-subtle, #ece9e1);
		border: 1px solid var(--border-strong, #c9c3b6);
	}

	.pill-id {
		background: #1c1a17;
		color: #ffffff;
		border-color: #1c1a17;
		font-weight: 700;
	}

	.pill-mode[data-mode='simulated'],
	.pill-mode[data-mode='manual'] {
		background: var(--status-warn-bg, #fffbeb);
		color: var(--status-warn-ink, #92400e);
		border-color: var(--status-warn-border, #fcd34d);
	}

	.detail-header h1 {
		margin: 0;
		font-size: 1.4rem;
		overflow-wrap: anywhere;
	}

	.status-group {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		width: 100%;
	}

	.status-box {
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-strong, #c9c3b6);
		border-radius: 8px;
		padding: 0.5rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
		flex: 1 1 160px;
	}

	.status-caption {
		font-size: 0.72rem;
		color: var(--ink-muted, #655e53);
		font-weight: 600;
		text-transform: uppercase;
	}

	.status-badge {
		font-size: 0.85rem;
		font-weight: 700;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		display: inline-block;
	}

	.status-badge.verif[data-status='pending'] {
		background: var(--status-warn-bg, #fffbeb);
		color: var(--status-warn-ink, #92400e);
	}

	.status-badge.verif[data-status='confirmed'] {
		background: var(--status-ok-bg, #ecfdf5);
		color: var(--status-ok-ink, #065f46);
	}

	.status-badge.verif[data-status='rejected'] {
		background: var(--status-err-bg, #fef2f2);
		color: var(--status-err-ink, #991b1b);
	}

	.status-badge.action {
		background: var(--bg-subtle, #ece9e1);
		color: var(--ink-primary, #1c1a17);
	}

	.status-badge.action[data-status='completed'] {
		background: var(--status-ok-bg, #ecfdf5);
		color: var(--status-ok-ink, #065f46);
	}

	.provenance-notice {
		padding: 0.75rem 1rem;
		border-radius: 8px;
		font-size: 0.85rem;
		background: var(--status-warn-bg, #fffbeb);
		color: var(--status-warn-ink, #92400e);
		border: 1px solid var(--status-warn-border, #fcd34d);
	}

	.lock-banner {
		padding: 0.9rem 1.1rem;
		border-radius: 8px;
		background: var(--status-err-bg, #fef2f2);
		color: var(--status-err-ink, #991b1b);
		border: 1px solid var(--status-err-border, #fca5a5);
		font-size: 0.875rem;
	}

	.alert-banner {
		padding: 0.95rem 1.15rem;
		border-radius: 8px;
		font-size: 0.875rem;
	}

	.alert-banner.error {
		background: var(--status-err-bg, #fef2f2);
		color: var(--status-err-ink, #991b1b);
		border: 1px solid var(--status-err-border, #fca5a5);
	}

	.alert-banner.success {
		background: var(--status-ok-bg, #ecfdf5);
		color: var(--status-ok-ink, #065f46);
		border: 1px solid var(--status-ok-border, #6ee7b7);
	}

	.alert-top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.code-tag {
		font-family: monospace;
		font-size: 0.75rem;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.08);
	}

	.preserve-hint {
		margin: 0.35rem 0 0 0;
		font-size: 0.8rem;
		font-style: italic;
	}

	.conflict-actions {
		margin-top: 0.65rem;
	}

	.btn-reload-conflict {
		padding: 0.45rem 0.85rem;
		border-radius: 6px;
		border: 1px solid currentColor;
		background: #ffffff;
		color: inherit;
		font-weight: 600;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.detail-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
		gap: 1.25rem;
		align-items: start;
	}

	@media (max-width: 980px) {
		.detail-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.evidence-column,
	.actions-column {
		display: flex;
		flex-direction: column;
		gap: 1.15rem;
		min-width: 0;
	}

	.panel-card {
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-strong, #c9c3b6);
		border-radius: 10px;
		padding: 1.15rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		min-width: 0;
	}

	.panel-title {
		margin: 0;
		font-size: 1.05rem;
	}

	.panel-subtitle {
		margin: 0;
		font-size: 0.83rem;
		color: var(--ink-secondary, #4a453d);
	}

	.meta-table {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.84rem;
	}

	.meta-row {
		display: grid;
		grid-template-columns: 200px minmax(0, 1fr);
		gap: 0.75rem;
		padding-bottom: 0.45rem;
		border-bottom: 1px dashed var(--border-default, #dcd7cb);
	}

	@media (max-width: 640px) {
		.panel-card {
			padding: 0.95rem 1rem;
		}

		.meta-row {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.2rem;
		}

		.utc-sub {
			display: block;
			margin-left: 0;
		}

		.decision-buttons {
			flex-direction: column;
		}

		.decision-buttons > button,
		.btn-save-followup,
		.btn-delete-trigger,
		.confirm-buttons > button {
			width: 100%;
			min-height: 2.75rem;
		}

		.confirm-buttons {
			flex-direction: column;
		}
	}

	.meta-row dt {
		color: var(--ink-muted, #655e53);
		font-weight: 600;
	}

	.meta-row dd {
		margin: 0;
		color: var(--ink-primary, #1c1a17);
		min-width: 0;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.semantic-disclaimer {
		font-size: 0.78rem;
		color: var(--ink-secondary, #4a453d);
	}

	.utc-sub {
		font-size: 0.76rem;
		color: var(--ink-muted, #655e53);
		margin-left: 0.35rem;
	}

	.sha-code {
		font-size: 0.75rem;
		overflow-wrap: anywhere;
		word-break: break-all;
	}

	.action-form {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	.field-group label {
		font-size: 0.83rem;
		font-weight: 600;
	}

	.field-group select,
	.field-group textarea {
		width: 100%;
		min-width: 0;
		padding: 0.5rem 0.65rem;
		border-radius: 6px;
		border: 1px solid var(--border-strong, #c9c3b6);
		background: var(--bg-surface, #ffffff);
		font-size: 0.875rem;
	}

	.field-group select:disabled,
	.field-group textarea:disabled {
		background: var(--bg-subtle, #ece9e1);
		opacity: 0.75;
	}

	.field-help {
		font-size: 0.76rem;
		color: var(--ink-muted, #655e53);
		overflow-wrap: anywhere;
	}

	.field-error {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--status-err-ink, #991b1b);
	}

	.decision-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		padding-top: 0.25rem;
	}

	.btn-confirm,
	.btn-reject,
	.btn-save-secondary,
	.btn-save-followup,
	.btn-delete-trigger,
	.btn-confirm-delete,
	.btn-cancel-delete {
		padding: 0.52rem 0.95rem;
		border-radius: 7px;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-confirm {
		background: #065f46;
		border: 1px solid #065f46;
		color: #ffffff;
	}

	.btn-reject {
		background: #991b1b;
		border: 1px solid #991b1b;
		color: #ffffff;
	}

	.btn-save-secondary {
		background: var(--bg-subtle, #ece9e1);
		border: 1px solid var(--border-strong, #c9c3b6);
		color: var(--ink-primary, #1c1a17);
	}

	.btn-save-followup {
		background: var(--accent-primary, #9a3412);
		border: 1px solid var(--accent-primary, #9a3412);
		color: #ffffff;
	}

	.btn-confirm:disabled,
	.btn-reject:disabled,
	.btn-save-secondary:disabled,
	.btn-save-followup:disabled,
	.btn-delete-trigger:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.disabled-reason-box {
		padding: 0.7rem 0.85rem;
		border-radius: 6px;
		background: var(--status-warn-bg, #fffbeb);
		border: 1px solid var(--status-warn-border, #fcd34d);
		color: var(--status-warn-ink, #92400e);
		font-size: 0.82rem;
	}

	.danger-card {
		border-color: var(--status-err-border, #fca5a5);
	}

	.delete-lock-note {
		margin: 0;
		font-size: 0.82rem;
		color: var(--status-warn-ink, #92400e);
		background: var(--status-warn-bg, #fffbeb);
		padding: 0.55rem 0.75rem;
		border-radius: 6px;
	}

	.btn-delete-trigger {
		align-self: flex-start;
		background: var(--status-err-bg, #fef2f2);
		border: 1px solid var(--status-err-ink, #991b1b);
		color: var(--status-err-ink, #991b1b);
	}

	.delete-confirm-box {
		padding: 0.85rem;
		border-radius: 8px;
		background: var(--status-err-bg, #fef2f2);
		border: 1px solid var(--status-err-border, #fca5a5);
		color: var(--status-err-ink, #991b1b);
		font-size: 0.85rem;
	}

	.delete-confirm-box p {
		margin: 0 0 0.75rem 0;
	}

	.confirm-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	.btn-cancel-delete {
		background: #ffffff;
		border: 1px solid var(--border-strong, #c9c3b6);
		color: var(--ink-primary, #1c1a17);
	}

	.btn-confirm-delete {
		background: #991b1b;
		border: 1px solid #991b1b;
		color: #ffffff;
	}

	.state-card {
		padding: 1.5rem;
		border-radius: 10px;
		border: 1px solid var(--border-strong, #c9c3b6);
		background: var(--bg-surface, #ffffff);
	}

	.state-card.error {
		background: var(--status-err-bg, #fef2f2);
		border-color: var(--status-err-border, #fca5a5);
		color: var(--status-err-ink, #991b1b);
	}

	.error-actions {
		margin-top: 1rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}

	.btn-secondary {
		padding: 0.45rem 0.85rem;
		border-radius: 6px;
		border: 1px solid currentColor;
		background: #ffffff;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-primary-link {
		font-weight: 600;
		color: inherit;
	}
</style>
