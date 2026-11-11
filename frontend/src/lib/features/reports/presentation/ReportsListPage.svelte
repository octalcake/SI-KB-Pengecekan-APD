<script lang="ts">
	import { authSession } from '#lib/app/auth';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		loadReportContext,
		createReportRequests,
		createManualReportApi,




		listReportsApi,


	} from '#lib/app/reports';
	import {
		formatGeneratedByLabel,
		formatGeneratedByShortLabel,
		formatJakartaDateTime,
		formatModeLabel,
		formatReportStatusLabel,
		formatReportStatusShortLabel,
		formatSessionStatusLabel,
		parseReportApiError,
		type ParsedReportError
	} from './format';
	import type {
		ProjectLookup,
		Report,
		ReportFilterParams,
		ReportPageMeta,
		ReportStatus,
		SessionEligibilityInfo,
		SessionLookup,
		ZoneLookup
	} from '../domain/types';

	const auth = authSession;
	const requests = createReportRequests();

	let projects = $state<ProjectLookup[]>([]);
	let zonesByProject = $state<Record<number, ZoneLookup[]>>({});
	let sessions = $state<SessionLookup[]>([]);
	let confirmedCountsBySession = $state<Record<number, number>>({});
	let allReportsBySession = $state<Record<number, Report>>({});

	// Filter form state
	let filterProjectId = $state<number>(0);
	let filterSessionId = $state<number>(0);
	let filterStatus = $state<ReportStatus | ''>('');
	let pageSize = $state<number>(20);
	let currentPage = $state<number>(1);

	// List state
	let reports = $state<Report[]>([]);
	let pageMeta = $state<ReportPageMeta>({ page: 1, page_size: 20, total: 0 });
	let loading = $state<boolean>(true);
	let listError = $state<ParsedReportError | null>(null);

	// Create / Generate form state
	let selectedSessionId = $state<number>(0);
	let createMode = $state<'template' | 'manual' | 'gemini'>('template');
	let manualTitle = $state<string>('');
	let manualContent = $state<string>('');

	// Retained operation key per session for POST /reports/generate idempotency & lost-response recovery
	let retainedGenerateKey = $state<string | null>(null);
	let retainedGenerateSessionId = $state<number | null>(null);

	let submittingCreate = $state<boolean>(false);
	let createError = $state<ParsedReportError | null>(null);
	let createSuccess = $state<string | null>(null);
	let existingReportConflict = $state<Report | null>(null);

	const geminiConfigured = $derived(Boolean(auth.systemStatus?.gemini_configured));

	const availableSessionsForFilter = $derived.by(() => {
		if(filterProjectId > 0) {
			return sessions.filter((s) => s.project_id === filterProjectId);
		}
		return sessions;
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

	const sessionEligibilityList = $derived.by((): SessionEligibilityInfo[] => {
		return sessions.map((session) => {
			const pName = projectName(session.project_id);
			const zName = zoneName(session.project_id, session.zone_id);
			const confirmedCount = confirmedCountsBySession[session.id] ?? 0;
			const existingReport = allReportsBySession[session.id] ?? null;
			const isClosed = session.status !== 'active';

			let ineligibleReason: string | null = null;
			if(!isClosed) {
				ineligibleReason =
					'Sesi masih aktif — hentikan sesi monitoring terlebih dahulu (SESSION_STILL_ACTIVE).';
			} else if(confirmedCount <= 0) {
				ineligibleReason =
					'Belum ada temuan berstatus Terkonfirmasi petugas pada sesi ini (NO_CONFIRMED_FINDINGS).';
			} else if(existingReport) {
				ineligibleReason = `Sesi sudah memiliki Laporan #${existingReport.id} (${formatReportStatusShortLabel(existingReport.status)}) — maksimal 1 laporan aktif per sesi (REPORT_EXISTS).`;
			}

			return {
				session,
				projectName: pName,
				zoneName: zName,
				confirmedCount,
				existingReport,
				isClosed,
				isEligibleForNewReport: isClosed && confirmedCount > 0 && !existingReport,
				ineligibleReason
			};
		});
	});

	const selectedEligibility = $derived.by((): SessionEligibilityInfo | null => {
		if(selectedSessionId <= 0) return null;
		return sessionEligibilityList.find((e) => e.session.id === selectedSessionId) ?? null;
	});

	function getOrMintGenerateKey(sessionId: number): string {
		const fresh = requests.generateKey(sessionId);
		retainedGenerateKey = fresh;
		retainedGenerateSessionId = sessionId;
		return fresh;
	}

	function resetGenerateKeyForSession(sessionId: number, fresh = false) {
		retainedGenerateKey = requests.generateKey(sessionId, fresh);
		retainedGenerateSessionId = sessionId;
	}

	function handleSessionSelectChange(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		const nextSessionId = Number(select.value) || 0;
		const prevSessionId = selectedSessionId;
		selectedSessionId = nextSessionId;
		createError = null;
		createSuccess = null;
		existingReportConflict = null;
		if(nextSessionId !== prevSessionId) {
			// Changed input -> do not reuse operation key from a different session
			requests.clear();
			retainedGenerateKey = null;
			retainedGenerateSessionId = null;
		}
	}

	async function loadLookupsAndEligibility(): Promise<void> {
		try {
			const context = await loadReportContext();
			projects = context.projects;
			sessions = context.sessions;
			allReportsBySession = context.allReportsBySession;
			zonesByProject = context.zonesByProject;
			confirmedCountsBySession = context.confirmedCountsBySession;
			if(selectedSessionId === 0) selectedSessionId = context.firstEligibleSessionId;
		} catch {
			// Lookup errors do not mask main list error
		}
	}

	function buildCurrentFilter(pageOverride?: number): ReportFilterParams {
		return {
			project_id: filterProjectId > 0 ? filterProjectId : undefined,
			session_id: filterSessionId > 0 ? filterSessionId : undefined,
			status: filterStatus || undefined,
			page: pageOverride ?? currentPage,
			page_size: pageSize
		};
	}

	async function loadReports(pageOverride?: number): Promise<void> {
		const targetPage = pageOverride ?? currentPage;
		loading = true;
		listError = null;
		try {
			const res = await listReportsApi(buildCurrentFilter(targetPage));
			reports = res.data;
			pageMeta = res.meta;
			currentPage = res.meta.page;
		} catch(err) {
			listError = parseReportApiError(err, 'Gagal memuat daftar laporan dari server Go.');
		} finally {
			loading = false;
		}
	}

	async function handleFilterSubmit(event: SubmitEvent) {
		event.preventDefault();
		currentPage = 1;
		await loadReports(1);
	}

	async function handleResetFilters() {
		filterProjectId = 0;
		filterSessionId = 0;
		filterStatus = '';
		currentPage = 1;
		await loadReports(1);
	}

	async function goToPage(pageNumber: number) {
		if(pageNumber < 1 || pageNumber > totalPages || pageNumber === currentPage) return;
		currentPage = pageNumber;
		await loadReports(pageNumber);
	}

	async function lookupExistingReportForSession(sessionId: number): Promise<Report | null> {
		try {
			const res = await listReportsApi({ session_id: sessionId, page: 1, page_size: 1 });
			if(res.data.length > 0) {
				allReportsBySession = {
					...allReportsBySession,
					[sessionId]: res.data[0]
				};
				return res.data[0];
			}
		} catch {
			// ignore lookup failure
		}
		return allReportsBySession[sessionId] ?? null;
	}

	async function handleCreateTemplateOrManual(mode: 'template' | 'manual') {
		if(submittingCreate) return;
		createError = null;
		createSuccess = null;
		existingReportConflict = null;

		if(selectedSessionId <= 0) {
			createError = {
				status: 422,
				code: 'VALIDATION_ERROR',
				title: 'Validasi Input Laporan Gagal (422)',
				message: 'Pilih sesi monitoring terlebih dahulu.',
				fieldErrors: { session_id: 'Sesi monitoring wajib dipilih.' },
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

		if(mode === 'manual') {
			const trimmedTitle = manualTitle.trim();
			const trimmedContent = manualContent.trim();
			const fields: Record<string, string> = {};
			if(trimmedTitle.length < 1 || trimmedTitle.length > 200) {
				fields.title = 'Judul laporan manual wajib diisi (1–200 karakter).';
			}
			if(trimmedContent.length < 1 || trimmedContent.length > 20000) {
				fields.content = 'Isi narasi laporan manual wajib diisi (1–20.000 karakter).';
			}
			if(Object.keys(fields).length > 0) {
				createError = {
					status: 422,
					code: 'VALIDATION_ERROR',
					title: 'Validasi Input Laporan Gagal (422)',
					message: Object.values(fields)[0],
					fieldErrors: fields,
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
		}

		submittingCreate = true;
		try {
			const created = await createManualReportApi(
				mode === 'template'
					? {
						session_id: selectedSessionId,
						use_template: true
					}
					: {
						session_id: selectedSessionId,
						title: manualTitle.trim(),
						content: manualContent.trim(),
						use_template: false
					}
			);
			allReportsBySession = {
				...allReportsBySession,
				[created.session_id]: created
			};
			createSuccess =
				mode === 'template'
					? `Draft laporan Template #${created.id} berhasil dibuat untuk Sesi S-${created.session_id}.`
					: `Draft laporan Manual #${created.id} berhasil dibuat untuk Sesi S-${created.session_id}.`;
			await goto(`/reports/${created.id}`);
		} catch(err) {
			const parsed = parseReportApiError(
				err,
				mode === 'template'
					? 'Gagal membuat draft laporan template.'
					: 'Gagal membuat draft laporan manual.'
			);
			createError = parsed;
			if(parsed.isReportExists) {
				existingReportConflict = await lookupExistingReportForSession(selectedSessionId);
			}
		} finally {
			submittingCreate = false;
		}
	}

	async function handleGenerateGeminiDraft(forceFreshKey = false) {
		if(submittingCreate) return;
		createError = null;
		createSuccess = null;
		existingReportConflict = null;

		if(selectedSessionId <= 0) {
			createError = {
				status: 422,
				code: 'VALIDATION_ERROR',
				title: 'Validasi Input Laporan Gagal (422)',
				message: 'Pilih sesi monitoring terlebih dahulu.',
				fieldErrors: { session_id: 'Sesi monitoring wajib dipilih.' },
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

		if(forceFreshKey) {
			resetGenerateKeyForSession(selectedSessionId, true);
		}
		getOrMintGenerateKey(selectedSessionId);

		submittingCreate = true;
		try {
			const created = await requests.generate(selectedSessionId);
			allReportsBySession = {
				...allReportsBySession,
				[created.session_id]: created
			};
			createSuccess = `Draft laporan Gemini #${created.id} berhasil dibuat/dipulihkan untuk Sesi S-${created.session_id}.`;
			await goto(`/reports/${created.id}`);
		} catch(err) {
			const parsed = parseReportApiError(
				err,
				'Gagal membuat draft laporan melalui layanan Gemini.'
			);
			createError = parsed;
			if(parsed.isReportExists) {
				existingReportConflict = await lookupExistingReportForSession(selectedSessionId);
			} else if(parsed.isSourceChanged || parsed.isIdempotencyConflict || parsed.isRequestKeyExpired) {
				// Input/source changed so old key cannot be reused
				resetGenerateKeyForSession(selectedSessionId);
			}
		} finally {
			submittingCreate = false;
		}
	}

	onMount(async () => {
		await Promise.all([loadLookupsAndEligibility(), loadReports(1)]);
	});
</script>

<div class="reports-workspace">
	<header class="page-header">
		<div>
			<p class="eyebrow">MODUL PENYUSUNAN &amp; PERSETUJUAN LAPORAN INSPEKSI</p>
			<h1>Laporan Inspeksi K3</h1>
			<p class="subtitle">
				Buat draft laporan dari sesi monitoring tertutup yang memiliki temuan terkonfirmasi petugas, periksa snapshot sumber historis, sunting narasi teks biasa, dan kunci laporan melalui persetujuan eksplisit.
			</p>
		</div>
		<div class="header-badges">
			<div class="summary-chip" role="status" aria-live="polite">
				Total Laporan Terfilter: <strong data-testid="reports-total-count">{pageMeta.total}</strong>
			</div>
			<div
				class="gemini-readiness-chip"
				data-configured={geminiConfigured ? 'true' : 'false'}
				data-testid="gemini-readiness-chip"
			>
				Status Gemini Server:
				<strong>
					{geminiConfigured
						? 'Terkonfigurasi (Kredensial Terpasang — Kuota Live Diverifikasi Saat Pemanggilan)'
						: 'Tidak Dikonfigurasi / Nonaktif (Gunakan Template / Manual)'}
				</strong>
			</div>
		</div>
	</header>

	<section class="create-panel" aria-labelledby="create-report-heading">
		<div class="panel-header">
			<div>
				<h2 id="create-report-heading">Buat Laporan Baru dari Sesi Tertutup</h2>
				<p class="panel-desc">
					Laporan hanya menggunakan temuan berstatus <strong>Terkonfirmasi</strong> yang belum dihapus dari sesi yang sudah ditutup (<code>stopped</code> / <code>interrupted</code>). Satu sesi hanya dapat memiliki satu laporan aktif.
				</p>
			</div>
		</div>

		<div class="create-grid">
			<div class="form-field">
				<label for="create-session-select">Pilih Sesi Monitoring</label>
				<select
					id="create-session-select"
					data-testid="create-session-select"
					value={selectedSessionId}
					onchange={handleSessionSelectChange}
				>
					<option value={0}>— Pilih Sesi Monitoring —</option>
					{#each sessionEligibilityList as item (item.session.id)}
						<option value={item.session.id}>
							Sesi S-{item.session.id} — {item.projectName} / {item.zoneName} ({formatModeLabel(item.session.mode)}, {formatSessionStatusLabel(item.session.status)}, {item.confirmedCount} temuan terkonfirmasi){item.isEligibleForNewReport ? ' [Memenuhi Syarat]' : ' [Tidak Memenuhi Syarat Baru]'}
						</option>
					{/each}
				</select>
			</div>

			{#if selectedEligibility}
				<div
					class="eligibility-card"
					data-eligible={selectedEligibility.isEligibleForNewReport ? 'true' : 'false'}
					data-testid="session-eligibility-status"
				>
					<div class="eligibility-meta">
						<span><strong>Sesi:</strong> S-{selectedEligibility.session.id}</span>
						<span><strong>Proyek / Zona:</strong> {selectedEligibility.projectName} — {selectedEligibility.zoneName}</span>
						<span><strong>Mode Provenance:</strong> {formatModeLabel(selectedEligibility.session.mode)}</span>
						<span><strong>Status Sesi:</strong> {formatSessionStatusLabel(selectedEligibility.session.status)}</span>
						<span><strong>Temuan Terkonfirmasi:</strong> {selectedEligibility.confirmedCount}</span>
					</div>

					{#if selectedEligibility.isEligibleForNewReport}
						<p class="eligibility-ok">
							Sesi tertutup ini memenuhi syarat pembuatan laporan baru ({selectedEligibility.confirmedCount} temuan terkonfirmasi petugas siap masuk ke snapshot).
						</p>
					{:else if selectedEligibility.ineligibleReason}
						<p class="eligibility-warn">
							<strong>Perhatian Kelayakan Sesi:</strong> {selectedEligibility.ineligibleReason}
						</p>
						{#if selectedEligibility.existingReport}
							<div class="existing-report-action">
								<a
									href="/reports/{selectedEligibility.existingReport.id}"
									class="btn-secondary"
									data-testid="open-existing-session-report-link"
								>
									Buka Laporan Sesi Ini (#{selectedEligibility.existingReport.id} — {formatReportStatusShortLabel(selectedEligibility.existingReport.status)})
								</a>
							</div>
						{/if}
					{/if}
				</div>
			{/if}

			<fieldset class="method-fieldset">
				<legend>Metode Penyusunan Draft &amp; Provenance</legend>
				<div class="method-tabs" role="radiogroup" aria-label="Metode Penyusunan Draft">
					<label class="method-option" class:selected={createMode === 'template'}>
						<input
							type="radio"
							name="create_mode"
							value="template"
							checked={createMode === 'template'}
							onchange={() => {
								createMode = 'template';
								createError = null;
							}}
						/>
						<span class="method-title">Draft Template Terstruktur (<code>generated_by=template</code>)</span>
						<span class="method-sub">
							Menyusun draf terstruktur otomatis di server Go dari snapshot temuan terkonfirmasi tanpa memanggil Gemini. Jujur ditandai sebagai Template.
						</span>
					</label>

					<label class="method-option" class:selected={createMode === 'manual'}>
						<input
							type="radio"
							name="create_mode"
							value="manual"
							checked={createMode === 'manual'}
							onchange={() => {
								createMode = 'manual';
								createError = null;
							}}
						/>
						<span class="method-title">Draft Tulis Manual Petugas (<code>generated_by=manual</code>)</span>
						<span class="method-sub">
							Petugas menulis judul dan narasi laporan sendiri diiringi snapshot temuan terkonfirmasi. Jujur ditandai sebagai Manual.
						</span>
					</label>

					<label class="method-option" class:selected={createMode === 'gemini'}>
						<input
							type="radio"
							name="create_mode"
							value="gemini"
							checked={createMode === 'gemini'}
							onchange={() => {
								createMode = 'gemini';
								createError = null;
							}}
						/>
						<span class="method-title">Generasi Narasi Gemini Backend (<code>generated_by=gemini</code>)</span>
						<span class="method-sub">
							Memanggil <code>POST /api/v1/reports/generate</code> dengan <code>request_key</code> UUID. Hanya mengirimkan teks temuan terkonfirmasi yang telah disanitasi (tanpa foto/track_id).
						</span>
					</label>
				</div>
			</fieldset>

			{#if createMode === 'manual'}
				<div class="manual-inputs" data-testid="manual-report-inputs">
					<div class="form-field">
						<label for="manual-report-title">Judul Laporan Manual (1–200 karakter)</label>
						<input
							id="manual-report-title"
							type="text"
							maxlength="200"
							bind:value={manualTitle}
							placeholder="Contoh: Laporan Inspeksi K3 Sesi S-1 Gedung A"
						/>
						{#if createError?.fieldErrors?.title}
							<p class="field-error">{createError.fieldErrors.title}</p>
						{/if}
					</div>

					<div class="form-field">
						<label for="manual-report-content">Isi Narasi Laporan Manual (Teks Biasa, 1–20.000 karakter)</label>
						<textarea
							id="manual-report-content"
							rows="6"
							maxlength="20000"
							bind:value={manualContent}
							placeholder="Tuliskan ringkasan hasil verifikasi temuan APD dan tindak lanjut lapangan..."
						></textarea>
						{#if createError?.fieldErrors?.content}
							<p class="field-error">{createError.fieldErrors.content}</p>
						{/if}
					</div>
				</div>
			{:else if createMode === 'gemini'}
				<div class="gemini-info-box" data-testid="gemini-create-info">
					<p>
						<strong>Kunci Operasi Idempoten (UUID <code>request_key</code>):</strong>
						<code data-testid="active-generate-request-key">
							{retainedGenerateKey && retainedGenerateSessionId === selectedSessionId
								? retainedGenerateKey
								: '(dibuat otomatis saat tombol ditekan dan dipertahankan untuk pemulihan respons hilang)'}
						</code>
					</p>
					<p class="privacy-note">
						<strong>Jaminan Privasi &amp; Keamanan:</strong> Server Go hanya mengirimkan metadata teks temuan yang sudah dikonfirmasi petugas (email dan nomor telepon disamarkan menjadi <code>[disamarkan]</code>, tanpa foto bukti, tanpa <code>track_id</code>). Jika layanan Gemini gagal atau tidak tersedia (503/502), sistem tidak akan memalsukan keberhasilan dan Anda dapat beralih ke pembuatan Draft Template atau Manual.
					</p>
				</div>
			{/if}

			{#if createError}
				<div
					class="error-banner"
					role="alert"
					data-testid="report-create-error"
					data-error-code={createError.code}
				>
					<div class="error-header">
						<strong>{createError.title}</strong>
						<span class="error-code-pill">Kode: {createError.code}</span>
					</div>
					<p>{createError.message}</p>
					{#if createError.requestId}
						<p class="req-id">ID Permintaan: <code>{createError.requestId}</code></p>
					{/if}

					<div class="recovery-actions">
						{#if createError.isReportExists && existingReportConflict}
							<a
								href="/reports/{existingReportConflict.id}"
								class="btn-primary"
								data-testid="open-existing-report-on-conflict"
							>
								Buka Laporan yang Sudah Ada (#{existingReportConflict.id})
							</a>
						{/if}

						{#if createError.isNetworkError && createMode === 'gemini' && retainedGenerateKey}
							<button
								type="button"
								class="btn-secondary"
								onclick={() => handleGenerateGeminiDraft(false)}
								disabled={submittingCreate}
								data-testid="retry-lost-response-same-key"
							>
								Pulihkan / Coba Ulang dengan Kunci Operasi yang Sama ({retainedGenerateKey.slice(0, 8)}…)
							</button>
						{/if}

						{#if createError.isGeminiUnavailable || createError.isInvalidGeminiOutput}
							<button
								type="button"
								class="btn-secondary"
								onclick={() => {
									createMode = 'template';
									void handleCreateTemplateOrManual('template');
								}}
								disabled={submittingCreate}
								data-testid="fallback-create-template-button"
							>
								Buat Draft Template Sebagai Gantinya
							</button>
							<button
								type="button"
								class="btn-outline"
								onclick={() => {
									createMode = 'manual';
								}}
								disabled={submittingCreate}
							>
								Beralih ke Formulir Draft Manual
							</button>
						{/if}
					</div>
				</div>
			{/if}

			{#if createSuccess}
				<div class="success-banner" role="status" data-testid="report-create-success">
					{createSuccess}
				</div>
			{/if}

			<div class="create-actions">
				{#if createMode === 'template'}
					<button
						type="button"
						class="btn-primary"
						onclick={() => handleCreateTemplateOrManual('template')}
						disabled={submittingCreate}
						data-testid="submit-create-template"
					>
						{submittingCreate ? 'Membuat Draft Template...' : 'Buat Draft Template'}
					</button>
				{:else if createMode === 'manual'}
					<button
						type="button"
						class="btn-primary"
						onclick={() => handleCreateTemplateOrManual('manual')}
						disabled={submittingCreate}
						data-testid="submit-create-manual"
					>
						{submittingCreate ? 'Menyimpan Draft Manual...' : 'Buat Draft Manual'}
					</button>
				{:else}
					<button
						type="button"
						class="btn-primary"
						onclick={() => handleGenerateGeminiDraft(false)}
						disabled={submittingCreate}
						data-testid="submit-generate-gemini"
					>
						{submittingCreate
							? 'Menghubungi Gemini Backend...'
							: retainedGenerateKey && retainedGenerateSessionId === selectedSessionId
								? 'Lanjutkan / Pulihkan Generasi Gemini'
								: 'Buat Draft dengan Gemini'}
					</button>
				{/if}
			</div>
		</div>
	</section>

	<form class="filter-bar" onsubmit={handleFilterSubmit} aria-label="Filter Daftar Laporan">
		<div class="filter-grid">
			<div class="filter-field">
				<label for="filter-report-project">Proyek</label>
				<select
					id="filter-report-project"
					name="project_id"
					bind:value={filterProjectId}
					onchange={() => {
						filterSessionId = 0;
					}}
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
				<label for="filter-report-session">Sesi Monitoring</label>
				<select id="filter-report-session" name="session_id" bind:value={filterSessionId}>
					<option value={0}>Semua Sesi</option>
					{#each availableSessionsForFilter as sess (sess.id)}
						<option value={sess.id}>
							Sesi S-{sess.id} ({formatModeLabel(sess.mode)} — {formatSessionStatusLabel(sess.status)})
						</option>
					{/each}
				</select>
			</div>

			<div class="filter-field">
				<label for="filter-report-status">Status Laporan</label>
				<select id="filter-report-status" name="status" bind:value={filterStatus}>
					<option value="">Semua Status</option>
					<option value="draft">Draft (Belum Disetujui)</option>
					<option value="approved">Disetujui (Terkunci)</option>
				</select>
			</div>
		</div>

		<div class="filter-actions">
			<button type="submit" class="btn-primary" disabled={loading}>Terapkan Filter</button>
			<button type="button" class="btn-outline" onclick={handleResetFilters} disabled={loading}>
				Reset Filter
			</button>
		</div>
	</form>

	{#if listError}
		<div
			class="error-banner"
			role="alert"
			data-testid="reports-list-error"
			data-error-code={listError.code}
		>
			<div class="error-header">
				<strong>{listError.title}</strong>
				<span class="error-code-pill">Kode: {listError.code}</span>
			</div>
			<p>{listError.message}</p>
			<button type="button" class="btn-secondary" onclick={() => loadReports(currentPage)}>
				Coba Muat Ulang Daftar
			</button>
		</div>
	{:else if loading}
		<div class="state-box" role="status" aria-live="polite" data-testid="reports-loading">
			Memuat daftar laporan inspeksi dari server...
		</div>
	{:else if reports.length === 0}
		<div class="state-box empty" data-testid="reports-empty">
			<h2>Belum Ada Laporan Sesuai Filter</h2>
			<p>
				Belum ditemukan laporan untuk kombinasi filter saat ini. Pilih sesi monitoring tertutup yang memiliki temuan terkonfirmasi pada panel di atas untuk membuat laporan baru.
			</p>
		</div>
	{:else}
		<div class="reports-list" data-testid="reports-list">
			{#each reports as rep (rep.id)}
				<article
					class="report-card"
					data-testid="report-card-{rep.id}"
					data-status={rep.status}
					data-stale={rep.is_stale ? 'true' : 'false'}
				>
					<div class="card-top">
						<div class="card-badges">
							<span class="badge status-{rep.status}" data-testid="report-card-status-{rep.id}">
								{formatReportStatusLabel(rep.status)}
							</span>
							<span
								class="badge gen-{rep.generated_by}"
								data-testid="report-card-provenance-{rep.id}"
							>
								Provenance: {formatGeneratedByShortLabel(rep.generated_by)}
							</span>
							<span class="badge mode-{rep.snapshot?.mode ?? 'real'}">
								Mode Sesi: {formatModeLabel(rep.snapshot?.mode ?? 'real')}
							</span>
							{#if rep.is_stale}
								<span class="badge stale-badge" data-testid="report-card-stale-{rep.id}">
									STALE (Sumber Temuan Berubah)
								</span>
							{/if}
							<span class="version-pill">Versi #{rep.version}</span>
						</div>

						<span class="report-id-label">Laporan #{rep.id} • Sesi S-{rep.session_id}</span>
					</div>

					<h2 class="card-title">{rep.title}</h2>

					<div class="card-meta-grid">
						<div>
							<span class="meta-label">Proyek &amp; Zona Snapshot:</span>
							<strong>
								{rep.snapshot?.project?.name ?? projectName(rep.project_id)} — {rep.snapshot?.zone?.name ?? '—'}
							</strong>
						</div>
						<div>
							<span class="meta-label">Asal Penyusunan:</span>
							<span>{formatGeneratedByLabel(rep.generated_by)}</span>
						</div>
						<div>
							<span class="meta-label">Jumlah Temuan Snapshot:</span>
							<strong>{rep.source_finding_ids?.length ?? rep.snapshot?.findings?.length ?? 0} temuan terkonfirmasi</strong>
						</div>
						<div>
							<span class="meta-label">Diperbarui:</span>
							<span>{formatJakartaDateTime(rep.updated_at)}</span>
						</div>
					</div>

					<div class="card-footer">
						<div class="finding-refs">
							{#if (rep.source_finding_ids?.length ?? 0) > 0}
								<span class="refs-label">Referensi Temuan:</span>
								{#each rep.source_finding_ids as fid (fid)}
									<a href="/findings/{fid}" class="finding-ref-chip">F-{fid}</a>
								{/each}
							{/if}
						</div>

						<a
							href="/reports/{rep.id}"
							class="btn-primary"
							data-testid="open-report-link-{rep.id}"
						>
							Buka Laporan #{rep.id}
						</a>
					</div>
				</article>
			{/each}
		</div>

		{#if totalPages > 1}
			<nav class="pagination-bar" aria-label="Navigasi halaman laporan">
				<button
					type="button"
					class="btn-outline"
					onclick={() => goToPage(currentPage - 1)}
					disabled={currentPage <= 1 || loading}
				>
					Sebelumnya
				</button>
				<span class="page-indicator">
					Halaman <strong>{currentPage}</strong> dari <strong>{totalPages}</strong>
				</span>
				<button
					type="button"
					class="btn-outline"
					onclick={() => goToPage(currentPage + 1)}
					disabled={currentPage >= totalPages || loading}
				>
					Berikutnya
				</button>
			</nav>
		{/if}
	{/if}
</div>

<style>
	.reports-workspace {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.page-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border-default, #d0d7de);
	}

	.eyebrow {
		margin: 0 0 0.25rem;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--ink-secondary, #57606a);
	}

	h1 {
		margin: 0 0 0.35rem;
		font-size: 1.5rem;
		color: var(--ink-primary, #1f2328);
	}

	.subtitle {
		margin: 0;
		max-width: 70ch;
		font-size: 0.9375rem;
		color: var(--ink-secondary, #57606a);
		line-height: 1.5;
	}

	.header-badges {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.5rem;
	}

	.summary-chip,
	.gemini-readiness-chip {
		padding: 0.45rem 0.75rem;
		border-radius: 8px;
		font-size: 0.8125rem;
		border: 1px solid var(--border-default, #d0d7de);
		background: var(--bg-surface, #ffffff);
		color: var(--ink-primary, #1f2328);
	}

	.gemini-readiness-chip[data-configured='false'] {
		background: var(--status-warn-bg, #fff8c5);
		border-color: var(--status-warn-border, #d4a72c);
		color: var(--status-warn-ink, #7d4e00);
	}

	.create-panel,
	.filter-bar,
	.report-card,
	.state-box {
		background: var(--bg-surface, #ffffff);
		border: 1px solid var(--border-default, #d0d7de);
		border-radius: 10px;
		padding: 1.15rem 1.25rem;
		min-width: 0;
	}

	.panel-header h2 {
		margin: 0 0 0.25rem;
		font-size: 1.125rem;
	}

	.panel-desc {
		margin: 0 0 1rem;
		font-size: 0.875rem;
		color: var(--ink-secondary, #57606a);
	}

	.create-grid {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}

	.form-field,
	.filter-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}

	label,
	legend {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--ink-primary, #1f2328);
	}

	select,
	input[type='text'],
	textarea {
		width: 100%;
		min-width: 0;
		padding: 0.55rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--border-strong, #8c959f);
		background: var(--bg-surface, #ffffff);
		color: var(--ink-primary, #1f2328);
		font-size: 0.9375rem;
		font-family: inherit;
	}

	textarea {
		resize: vertical;
		line-height: 1.5;
	}

	.eligibility-card {
		padding: 0.85rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border-default, #d0d7de);
		background: var(--bg-subtle, #f6f8fa);
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}

	.eligibility-card[data-eligible='true'] {
		border-color: var(--status-ok-border, #2da44e);
		background: var(--status-ok-bg, #dafbe1);
		color: var(--status-ok-ink, #116329);
	}

	.eligibility-card[data-eligible='false'] {
		border-color: var(--status-warn-border, #d4a72c);
		background: var(--status-warn-bg, #fff8c5);
		color: var(--status-warn-ink, #7d4e00);
	}

	.eligibility-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
		margin-bottom: 0.5rem;
	}

	.eligibility-ok,
	.eligibility-warn {
		margin: 0;
	}

	.existing-report-action {
		margin-top: 0.65rem;
	}

	.method-fieldset {
		border: 1px solid var(--border-default, #d0d7de);
		border-radius: 8px;
		padding: 0.85rem 1rem;
		margin: 0;
		min-width: 0;
	}

	.method-tabs {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	.method-option {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-default, #d0d7de);
		background: var(--bg-subtle, #f6f8fa);
		cursor: pointer;
		font-weight: 400;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.method-option.selected {
		border-color: var(--accent-border, #0969da);
		background: var(--accent-surface, #ddf4ff);
	}

	.method-title {
		font-weight: 700;
		font-size: 0.875rem;
		color: var(--ink-primary, #1f2328);
	}

	.method-sub {
		font-size: 0.8125rem;
		color: var(--ink-secondary, #57606a);
		line-height: 1.4;
	}

	.manual-inputs {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.gemini-info-box {
		padding: 0.85rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border-default, #d0d7de);
		background: var(--bg-subtle, #f6f8fa);
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}

	.gemini-info-box p {
		margin: 0 0 0.4rem;
	}

	.gemini-info-box p:last-child {
		margin-bottom: 0;
	}

	.error-banner {
		padding: 0.9rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--status-err-border, #cf222e);
		background: var(--status-err-bg, #ffebe9);
		color: var(--status-err-ink, #a40e26);
		font-size: 0.875rem;
	}

	.error-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.35rem;
	}

	.error-code-pill {
		font-family: monospace;
		font-size: 0.75rem;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.08);
	}

	.recovery-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.65rem;
	}

	.success-banner {
		padding: 0.8rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--status-ok-border, #2da44e);
		background: var(--status-ok-bg, #dafbe1);
		color: var(--status-ok-ink, #116329);
		font-weight: 600;
		font-size: 0.875rem;
	}

	.field-error {
		margin: 0.2rem 0 0;
		font-size: 0.8125rem;
		color: var(--status-err-ink, #a40e26);
		font-weight: 600;
	}

	.filter-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
		gap: 0.85rem;
	}

	.filter-actions,
	.create-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		margin-top: 0.75rem;
	}

	.reports-list {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.report-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.card-top {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}

	.card-badges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.55rem;
		border-radius: 6px;
		font-size: 0.75rem;
		font-weight: 700;
		border: 1px solid var(--border-default, #d0d7de);
		background: var(--bg-subtle, #f6f8fa);
	}

	.badge.status-approved {
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

	.version-pill,
	.report-id-label {
		font-size: 0.8125rem;
		color: var(--ink-secondary, #57606a);
		font-variant-numeric: tabular-nums;
	}

	.card-title {
		margin: 0;
		font-size: 1.15rem;
		color: var(--ink-primary, #1f2328);
		overflow-wrap: anywhere;
	}

	.card-meta-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
		gap: 0.5rem 1rem;
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}

	.meta-label {
		display: block;
		font-size: 0.75rem;
		color: var(--ink-secondary, #57606a);
	}

	.card-footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding-top: 0.65rem;
		border-top: 1px solid var(--border-default, #d0d7de);
	}

	.finding-refs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}

	.refs-label {
		font-size: 0.8125rem;
		color: var(--ink-secondary, #57606a);
	}

	.finding-ref-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0.25rem 0.65rem;
		border-radius: 6px;
		font-size: 0.8125rem;
		font-weight: 600;
		background: var(--bg-subtle, #f6f8fa);
		border: 1px solid var(--border-default, #d0d7de);
		color: var(--accent-primary, #0969da);
		text-decoration: none;
	}

	.finding-ref-chip:hover {
		text-decoration: underline;
	}

	.btn-primary,
	.btn-secondary,
	.btn-outline {
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

	.btn-primary:disabled,
	.btn-secondary:disabled,
	.btn-outline:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.pagination-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 0.75rem;
	}

	@media (max-width: 768px) {
		.header-badges {
			align-items: flex-start;
		}
	}

	@media (max-width: 640px) {
		.create-panel,
		.filter-bar,
		.report-card,
		.state-box {
			padding: 0.95rem 1rem;
		}

		.method-fieldset {
			padding: 0.75rem;
		}

		.create-actions > button,
		.filter-actions > button,
		.card-footer > .btn-primary {
			width: 100%;
			min-height: 2.75rem;
		}
	}
</style>
