<script lang="ts">
	import { authSession } from '#lib/app/auth';
	import {
		createManualFindingApi,
		createManualSessionApi
	} from '#lib/app/findings';
	import {
		formatJakartaDateTime,
		parseFindingApiError,
		type ParsedFindingError
	} from './format';
	import type {
		Finding,
		ProjectLookup,
		SessionLookup,
		ViolationType,
		ZoneLookup
	} from '../domain/types';

	interface Props {
		projects: ProjectLookup[];
		zonesByProject: Record<number, ZoneLookup[]>;
		sessions: SessionLookup[];
		onCreated?: (finding: Finding) => void;
		onEnsureZonesLoaded?: (projectId: number) => Promise<void>;
		onSessionCreated?: (session: SessionLookup) => void;
	}

	let {
		projects,
		zonesByProject,
		sessions,
		onCreated,
		onEnsureZonesLoaded,
		onSessionCreated
	}: Props = $props();

	let expanded = $state(false);
	let selectedSessionId = $state<number>(0);
	let violationType = $state<ViolationType>('NO_HELMET');
	let notes = $state('');
	let selectedFile = $state<File | null>(null);
	let fileInputKey = $state(0);

	let submitting = $state(false);
	let errorState = $state<ParsedFindingError | null>(null);
	let createdFinding = $state<Finding | null>(null);

	// Optional helper to create a closed manual session when the server is in manual mode
	let newSessionProjectId = $state<number>(0);
	let newSessionZoneId = $state<number>(0);
	let creatingSession = $state(false);
	let createSessionError = $state<ParsedFindingError | null>(null);

	const systemMode = $derived(authSession?.systemStatus?.mode ?? null);

	const eligibleManualSessions = $derived(
		sessions.filter(
			(s) => s.mode === 'manual' && (s.status === 'stopped' || s.status === 'interrupted')
		)
	);

	const activeProjects = $derived(projects.filter((p) => p.status === 'active'));
	const activeZonesForNewSession = $derived(
		(zonesByProject[newSessionProjectId] ?? []).filter((z) => z.status === 'active')
	);

	$effect(() => {
		if(eligibleManualSessions.length > 0 && selectedSessionId === 0) {
			selectedSessionId = eligibleManualSessions[0].id;
		}
	});

	function projectName(projectId: number): string {
		return projects.find((p) => p.id === projectId)?.name ?? `Proyek #${projectId}`;
	}

	function zoneName(projectId: number, zoneId: number): string {
		const list = zonesByProject[projectId] ?? [];
		return list.find((z) => z.id === zoneId)?.name ?? `Zona #${zoneId}`;
	}

	async function handleNewSessionProjectChange(event: Event) {
		const target = event.currentTarget as HTMLSelectElement;
		const pid = Number(target.value) || 0;
		newSessionProjectId = pid;
		newSessionZoneId = 0;
		if(pid > 0 && onEnsureZonesLoaded) {
			await onEnsureZonesLoaded(pid);
		}
	}

	async function handleCreateManualSession(event: SubmitEvent) {
		event.preventDefault();
		if(creatingSession) return;
		createSessionError = null;

		if(newSessionProjectId <= 0 || newSessionZoneId <= 0) {
			createSessionError = {
				status: 422,
				code: 'VALIDATION_ERROR',
				title: 'Proyek dan Zona Wajib Dipilih',
				message: 'Pilih proyek aktif dan zona aktif untuk membuat sesi mode manual.',
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

		creatingSession = true;
		try {
			const sess = await createManualSessionApi({
				project_id: newSessionProjectId,
				zone_id: newSessionZoneId
			});
			selectedSessionId = sess.id;
			onSessionCreated?.(sess);
		} catch(err) {
			createSessionError = parseFindingApiError(
				err,
				'Gagal membuat sesi mode manual.'
			);
		} finally {
			creatingSession = false;
		}
	}

	function handleFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		selectedFile = input.files && input.files.length > 0 ? input.files[0] : null;
	}

	async function handleSubmitManual(event: SubmitEvent) {
		event.preventDefault();
		if(submitting) return;
		errorState = null;
		createdFinding = null;

		const localFields: Record<string, string> = {};
		if(selectedSessionId <= 0) {
			localFields.session_id = 'Sesi mode manual yang sudah ditutup wajib dipilih.';
		}
		if(!selectedFile) {
			localFields.evidence = 'File foto bukti JPEG wajib dipilih.';
		}
		if(notes.trim().length > 2000) {
			localFields.notes = 'Catatan observasi manual maksimal 2.000 karakter.';
		}

		if(Object.keys(localFields).length > 0) {
			errorState = {
				status: 422,
				code: 'VALIDATION_ERROR',
				title: 'Validasi Input Manual Gagal',
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

		submitting = true;
		try {
			const finding = await createManualFindingApi({
				session_id: selectedSessionId,
				violation_type: violationType,
				notes: notes.trim(),
				evidence: selectedFile!
			});
			createdFinding = finding;
			notes = '';
			selectedFile = null;
			fileInputKey += 1;
			onCreated?.(finding);
		} catch(err) {
			// Preserve unsaved input on error!
			errorState = parseFindingApiError(
				err,
				'Gagal menyimpan temuan manual.'
			);
		} finally {
			submitting = false;
		}
	}
</script>

<section class="manual-panel" aria-labelledby="manual-fallback-heading">
	<div class="manual-header">
		<div>
			<div class="header-badges">
				<span class="prov-badge">FALLBACK MANUAL</span>
				{#if systemMode}
					<span class="mode-info">
						Mode Server Saat Ini: <strong>{systemMode.toUpperCase()}</strong>
					</span>
				{/if}
			</div>
			<h2 id="manual-fallback-heading" class="manual-title">
				Pencatatan Bukti Temuan Manual (Tanpa Inferensi AI)
			</h2>
			<p class="manual-desc">
				Digunakan hanya ketika server mengaktifkan <code>ALLOW_MANUAL_FALLBACK</code> dan terdapat sesi bermode
				<code>manual</code> yang sudah ditutup (<code>stopped</code>/<code>interrupted</code>). Catatan manual diberi label provenance
				<strong>manual</strong> permanen dan tidak pernah diklaim sebagai hasil deteksi model YOLO.
			</p>
		</div>

		<button
			type="button"
			class="toggle-btn"
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}
		>
			{expanded ? 'Tutup Formulir Manual' : 'Tambah Temuan Manual'}
		</button>
	</div>

	{#if expanded}
		<div class="manual-body">
			{#if eligibleManualSessions.length === 0}
				<div class="empty-manual-sessions" role="status">
					<strong>Belum ada sesi mode manual yang ditutup.</strong>
					<p>
						Temuan manual hanya diterima oleh backend pada sesi dengan <code>mode="manual"</code> dan status
						<code>stopped</code> atau <code>interrupted</code>.
						{#if systemMode && systemMode !== 'manual'}
							Server saat ini berjalan pada mode <strong>{systemMode.toUpperCase()}</strong>, sehingga pembuatan sesi manual baru akan ditolak kecuali server dikonfigurasi ke <code>AI_MODE=manual</code>.
						{/if}
					</p>

					{#if activeProjects.length > 0}
						<form class="create-manual-session-form" onsubmit={handleCreateManualSession}>
							<h3>Buat Sesi Pencatatan Manual (Khusus Mode Server Manual)</h3>
							<div class="session-grid">
								<div class="field-group">
									<label for="manual-new-sess-project">Proyek Aktif</label>
									<select
										id="manual-new-sess-project"
										value={newSessionProjectId}
										onchange={handleNewSessionProjectChange}
									>
										<option value={0}>-- Pilih Proyek --</option>
										{#each activeProjects as p (p.id)}
											<option value={p.id}>{p.name} ({p.location || 'Tanpa lokasi'})</option>
										{/each}
									</select>
								</div>

								<div class="field-group">
									<label for="manual-new-sess-zone">Zona Aktif</label>
									<select
										id="manual-new-sess-zone"
										bind:value={newSessionZoneId}
										disabled={newSessionProjectId <= 0}
									>
										<option value={0}>-- Pilih Zona --</option>
										{#each activeZonesForNewSession as z (z.id)}
											<option value={z.id}>{z.name}</option>
										{/each}
									</select>
								</div>

								<div class="field-actions">
									<button type="submit" class="secondary-btn" disabled={creatingSession}>
										{creatingSession ? 'Membuat Sesi...' : 'Buat Sesi Manual Tertutup'}
									</button>
								</div>
							</div>

							{#if createSessionError}
								<div class="alert-box error" role="alert">
									<strong>{createSessionError.title}:</strong>
									<span>{createSessionError.message}</span>
								</div>
							{/if}
						</form>
					{/if}
				</div>
			{/if}

			{#if errorState}
				<div
					class="alert-box error"
					role="alert"
					data-testid="manual-finding-error"
					data-error-code={errorState.code}
				>
					<div class="alert-header">
						<strong>{errorState.title}</strong>
						<span class="code-pill">{errorState.code}</span>
					</div>
					<p>{errorState.message}</p>
					<p class="preserve-note">
						Input formulir Anda tetap dipertahankan di layar.
					</p>
				</div>
			{/if}

			{#if createdFinding}
				<div class="alert-box success" role="status" data-testid="manual-finding-success">
					<strong>Temuan manual #{createdFinding.id} berhasil disimpan (Provenance: MANUAL).</strong>
					<p>
						Status awal adalah <em>Menunggu Verifikasi</em> tanpa nilai confidence atau track ID model.
						<a href={`/findings/${createdFinding.id}`}>Buka Detail Temuan #{createdFinding.id}</a>
					</p>
				</div>
			{/if}

			<form class="manual-form" onsubmit={handleSubmitManual} novalidate>
				<div class="form-grid">
					<div class="field-group">
						<label for="manual-session-id">Sesi Mode Manual (Tertutup) *</label>
						<select
							id="manual-session-id"
							name="session_id"
							bind:value={selectedSessionId}
							aria-invalid={Boolean(errorState?.fieldErrors.session_id)}
						>
							<option value={0}>-- Pilih Sesi Mode Manual --</option>
							{#each eligibleManualSessions as sess (sess.id)}
								<option value={sess.id}>
									Sesi #{sess.id} — {projectName(sess.project_id)} / {zoneName(sess.project_id, sess.zone_id)} ({sess.status}, {formatJakartaDateTime(sess.started_at)})
								</option>
							{/each}
						</select>
						{#if errorState?.fieldErrors.session_id}
							<span class="field-error">{errorState.fieldErrors.session_id}</span>
						{/if}
					</div>

					<div class="field-group">
						<label for="manual-violation-type">Jenis Indikasi APD *</label>
						<select
							id="manual-violation-type"
							name="violation_type"
							bind:value={violationType}
							aria-invalid={Boolean(errorState?.fieldErrors.violation_type)}
						>
							<option value="NO_HELMET">Indikasi Tanpa Helm (NO_HELMET)</option>
							<option value="NO_VEST">Indikasi Tanpa Rompi (NO_VEST)</option>
						</select>
						{#if errorState?.fieldErrors.violation_type}
							<span class="field-error">{errorState.fieldErrors.violation_type}</span>
						{/if}
					</div>
				</div>

				<div class="field-group">
					<label for="manual-evidence-file">Foto Bukti JPEG (Maks. 1 MiB, Maks. 1 MP) *</label>
					{#key fileInputKey}
						<input
							id="manual-evidence-file"
							name="evidence"
							type="file"
							accept="image/jpeg,.jpg,.jpeg"
							onchange={handleFileChange}
							aria-invalid={Boolean(errorState?.fieldErrors.evidence)}
						/>
					{/key}
					{#if selectedFile}
						<span class="file-hint">
							File dipilih: <strong>{selectedFile.name}</strong> ({(selectedFile.size / 1024).toFixed(1)} KiB)
						</span>
					{/if}
					{#if errorState?.fieldErrors.evidence}
						<span class="field-error">{errorState.fieldErrors.evidence}</span>
					{/if}
				</div>

				<div class="field-group">
					<label for="manual-notes">Catatan Observasi Manual Petugas</label>
					<textarea
						id="manual-notes"
						name="notes"
						rows="3"
						maxlength="2000"
						placeholder="Tuliskan lokasi pengamatan dan rincian visual mengapa foto ini dicatat secara manual..."
						bind:value={notes}
						aria-invalid={Boolean(errorState?.fieldErrors.notes)}
					></textarea>
					{#if errorState?.fieldErrors.notes}
						<span class="field-error">{errorState.fieldErrors.notes}</span>
					{/if}
				</div>

				<div class="form-footer">
					<span class="disclaimer">
						Provenance tersimpan sebagai <code>source="manual"</code>, <code>mode="manual"</code>, <code>confidence=null</code>, <code>track_key=null</code>.
					</span>
					<button type="submit" class="submit-btn" disabled={submitting}>
						{submitting ? 'Menyimpan Bukti Manual...' : 'Simpan Temuan Manual'}
					</button>
				</div>
			</form>
		</div>
	{/if}
</section>

<style>
	.manual-panel {
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-strong, #c9c3b6);
		border-radius: 10px;
		padding: 1.15rem 1.25rem;
	}

	.manual-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.header-badges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.35rem;
	}

	.prov-badge {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
		background: var(--status-warn-bg, #fffbeb);
		color: var(--status-warn-ink, #92400e);
		border: 1px solid var(--status-warn-border, #fcd34d);
	}

	.mode-info {
		font-size: 0.78rem;
		color: var(--ink-secondary, #4a453d);
	}

	.manual-title {
		margin: 0;
		font-size: 1.05rem;
	}

	.manual-desc {
		margin: 0.3rem 0 0 0;
		font-size: 0.85rem;
		color: var(--ink-secondary, #4a453d);
	}

	.toggle-btn {
		padding: 0.5rem 0.9rem;
		border-radius: 7px;
		border: 1px solid var(--border-strong, #c9c3b6);
		background: var(--bg-subtle, #ece9e1);
		color: var(--ink-primary, #1c1a17);
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.manual-body {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border-default, #dcd7cb);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.empty-manual-sessions {
		padding: 0.9rem 1rem;
		border-radius: 8px;
		background: var(--bg-subtle, #ece9e1);
		border: 1px solid var(--border-default, #dcd7cb);
		font-size: 0.85rem;
	}

	.empty-manual-sessions p {
		margin: 0.3rem 0 0 0;
		color: var(--ink-secondary, #4a453d);
	}

	.create-manual-session-form {
		margin-top: 0.85rem;
		padding-top: 0.85rem;
		border-top: 1px dashed var(--border-strong, #c9c3b6);
	}

	.create-manual-session-form h3 {
		margin: 0 0 0.6rem 0;
		font-size: 0.9rem;
	}

	.session-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
		gap: 0.75rem;
		align-items: end;
	}

	.manual-form {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
		gap: 0.85rem;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	.field-group label {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--ink-primary, #1c1a17);
	}

	.field-group select,
	.field-group input[type='file'],
	.field-group textarea {
		width: 100%;
		min-width: 0;
		padding: 0.5rem 0.65rem;
		border-radius: 6px;
		border: 1px solid var(--border-strong, #c9c3b6);
		background: var(--bg-surface, #ffffff);
		font-size: 0.875rem;
	}

	.field-error {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--status-err-ink, #991b1b);
	}

	.file-hint {
		font-size: 0.78rem;
		color: var(--ink-secondary, #4a453d);
		overflow-wrap: anywhere;
	}

	.form-footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding-top: 0.35rem;
	}

	.disclaimer {
		font-size: 0.78rem;
		color: var(--ink-muted, #655e53);
	}

	.submit-btn,
	.secondary-btn {
		padding: 0.55rem 1rem;
		border-radius: 7px;
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.submit-btn {
		background: var(--accent-primary, #9a3412);
		border: 1px solid var(--accent-primary, #9a3412);
		color: #ffffff;
	}

	.secondary-btn {
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-strong, #c9c3b6);
		color: var(--ink-primary, #1c1a17);
	}

	.alert-box {
		padding: 0.85rem 1rem;
		border-radius: 8px;
		font-size: 0.85rem;
	}

	.alert-box.error {
		background: var(--status-err-bg, #fef2f2);
		border: 1px solid var(--status-err-border, #fca5a5);
		color: var(--status-err-ink, #991b1b);
	}

	.alert-box.success {
		background: var(--status-ok-bg, #ecfdf5);
		border: 1px solid var(--status-ok-border, #6ee7b7);
		color: var(--status-ok-ink, #065f46);
	}

	.alert-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.code-pill {
		font-family: monospace;
		font-size: 0.75rem;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.06);
	}

	.preserve-note {
		margin: 0.3rem 0 0 0;
		font-size: 0.78rem;
		font-style: italic;
	}

	@media (max-width: 640px) {
		.toggle-btn,
		.submit-btn,
		.secondary-btn {
			width: 100%;
			min-height: 2.75rem;
		}
	}
</style>
