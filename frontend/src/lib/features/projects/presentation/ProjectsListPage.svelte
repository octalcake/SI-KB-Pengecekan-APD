<script lang="ts">
	import Icon from '#lib/shared/presentation/Icon.svelte';
	import { onMount } from 'svelte';
	import { isApiError } from '#lib/shared/errors';
	import {
		createProjectApi,
		deleteProjectApi,
		getProjectApi,
		listProjectsApi,
		updateProjectApi
	} from '#lib/app/projects';
	import { formatIndonesianDateTime, translateFieldError } from './format';
	import type { Project, RecordStatus } from '../domain/types';
	import type { PageMeta } from '#lib/shared/envelopes';

	// List & Filter state
	let projects = $state<Project[]>([]);
	let meta = $state<PageMeta>({ page: 1, page_size: 10, total: 0 });
	let searchInput = $state('');
	let appliedSearch = $state('');
	let statusFilter = $state<RecordStatus | ''>('');
	let currentPage = $state(1);
	let pageSize = $state(10);
	let loadingList = $state(true);
	let listError = $state<string | null>(null);

	// Create form state
	let createName = $state('');
	let createLocation = $state('');
	let createDescription = $state('');
	let creating = $state(false);
	let createFieldErrors = $state<Record<string, string>>({});
	let createGeneralError = $state<string | null>(null);

	// Notice / feedback banner
	let actionNotice = $state<string | null>(null);

	// Edit state (inline per project)
	let editingProjectId = $state<number | null>(null);
	let editVersion = $state<number>(1);
	let editName = $state('');
	let editLocation = $state('');
	let editDescription = $state('');
	let editStatus = $state<RecordStatus>('active');
	let editSaving = $state(false);
	let editFieldErrors = $state<Record<string, string>>({});
	let editGeneralError = $state<string | null>(null);
	let editVersionConflict = $state<{
		message: string;
		serverSnapshot: Project | null;
	} | null>(null);
	let editSessionConflict = $state<string | null>(null);

	// Delete confirmation & conflict recovery state
	let confirmingDeleteId = $state<number | null>(null);
	let deletingId = $state<number | null>(null);
	let referenceConflict = $state<{
		project: Project;
		message: string;
	} | null>(null);
	let sessionActiveConflict = $state<{
		project: Project;
		message: string;
	} | null>(null);
	let archivingId = $state<number | null>(null);

	const totalPages = $derived(Math.max(1, Math.ceil(meta.total / meta.page_size)));

	onMount(() => {
		void loadProjects();
	});

	async function loadProjects() {
		loadingList = true;
		listError = null;
		try {
			const res = await listProjectsApi({
				q: appliedSearch,
				status: statusFilter,
				page: currentPage,
				page_size: pageSize
			});
			projects = res.data;
			meta = res.meta;
		} catch (err) {
			listError = isApiError(err) ? err.message : 'Gagal memuat daftar proyek dari server backend.';
		} finally {
			loadingList = false;
		}
	}

	async function handleFilterSubmit(event: SubmitEvent) {
		event.preventDefault();
		appliedSearch = searchInput.trim();
		currentPage = 1;
		await loadProjects();
	}

	async function handleResetFilter() {
		searchInput = '';
		appliedSearch = '';
		statusFilter = '';
		currentPage = 1;
		await loadProjects();
	}

	async function handlePageChange(nextPage: number) {
		if (nextPage < 1 || nextPage > totalPages || nextPage === currentPage) return;
		currentPage = nextPage;
		await loadProjects();
	}

	function validateProjectFields(name: string, location: string, description: string) {
		const errs: Record<string, string> = {};
		const trimmedName = name.trim();
		if (!trimmedName) {
			errs.name = 'Nama wajib diisi.';
		} else if ([...trimmedName].length > 120) {
			errs.name = 'Nama maksimal 120 karakter.';
		}
		if ([...location.trim()].length > 200) {
			errs.location = 'Lokasi maksimal 200 karakter.';
		}
		if ([...description.trim()].length > 2000) {
			errs.description = 'Deskripsi maksimal 2.000 karakter.';
		}
		return errs;
	}

	async function handleCreateProject(event: SubmitEvent) {
		event.preventDefault();
		if (creating) return;

		actionNotice = null;
		createGeneralError = null;
		const clientErrs = validateProjectFields(createName, createLocation, createDescription);
		createFieldErrors = clientErrs;
		if (Object.keys(clientErrs).length > 0) return;

		creating = true;
		try {
			await createProjectApi({
				name: createName.trim(),
				location: createLocation.trim(),
				description: createDescription.trim()
			});
			createName = '';
			createLocation = '';
			createDescription = '';
			createFieldErrors = {};
			actionNotice = `Proyek ditambahkan.`;
			currentPage = 1;
			await loadProjects();
		} catch (err) {
			if (isApiError(err)) {
				if (err.status === 422 && Object.keys(err.fields).length > 0) {
					const mapped: Record<string, string> = {};
					for (const [k, v] of Object.entries(err.fields)) {
						mapped[k] = translateFieldError(k, v);
					}
					createFieldErrors = mapped;
				}
				createGeneralError = err.message;
			} else {
				createGeneralError = 'Gagal menyimpan proyek baru. Periksa koneksi backend.';
			}
		} finally {
			creating = false;
		}
	}

	function startEditProject(project: Project) {
		editingProjectId = project.id;
		editVersion = project.version;
		editName = project.name;
		editLocation = project.location;
		editDescription = project.description;
		editStatus = project.status;
		editFieldErrors = {};
		editGeneralError = null;
		editVersionConflict = null;
		editSessionConflict = null;
		confirmingDeleteId = null;
	}

	function cancelEditProject() {
		editingProjectId = null;
		editFieldErrors = {};
		editGeneralError = null;
		editVersionConflict = null;
		editSessionConflict = null;
	}

	async function handleSaveEditProject(event: SubmitEvent) {
		event.preventDefault();
		if (editingProjectId === null || editSaving) return;

		actionNotice = null;
		editGeneralError = null;
		editSessionConflict = null;
		const clientErrs = validateProjectFields(editName, editLocation, editDescription);
		editFieldErrors = clientErrs;
		if (Object.keys(clientErrs).length > 0) return;

		editSaving = true;
		try {
			await updateProjectApi(editingProjectId, {
				version: editVersion,
				name: editName.trim(),
				location: editLocation.trim(),
				description: editDescription.trim(),
				status: editStatus
			});
			editingProjectId = null;
			editVersionConflict = null;
			actionNotice = `Proyek tersimpan.`;
			await loadProjects();
		} catch (err) {
			if (isApiError(err)) {
				if (err.status === 409 && err.code === 'VERSION_CONFLICT') {
					// Preserve unsaved input and offer reload
					editVersionConflict = {
						message: err.message,
						serverSnapshot: null
					};
				} else if (err.status === 409 && err.code === 'SESSION_ACTIVE') {
					editSessionConflict = err.message;
				} else if (err.status === 422 && Object.keys(err.fields).length > 0) {
					const mapped: Record<string, string> = {};
					for (const [k, v] of Object.entries(err.fields)) {
						mapped[k] = translateFieldError(k, v);
					}
					editFieldErrors = mapped;
					editGeneralError = err.message;
				} else {
					editGeneralError = err.message;
				}
			} else {
				editGeneralError = 'Gagal memperbarui proyek.';
			}
		} finally {
			editSaving = false;
		}
	}

	async function reloadConflictedProject() {
		if (editingProjectId === null) return;
		try {
			const latest = await getProjectApi(editingProjectId);
			editVersion = latest.version;
			editVersionConflict = null;
			actionNotice = `Data terbaru dimuat. Isianmu belum hilang.`;
			projects = projects.map((p) => (p.id === latest.id ? latest : p));
		} catch (err) {
			editGeneralError = isApiError(err) ? err.message : 'Gagal memuat ulang data proyek terbaru.';
		}
	}

	async function handleArchiveProject(project: Project, targetStatus: RecordStatus = 'archived') {
		if (archivingId !== null) return;
		archivingId = project.id;
		actionNotice = null;
		sessionActiveConflict = null;
		try {
			await updateProjectApi(project.id, {
				version: project.version,
				status: targetStatus
			});
			if (referenceConflict?.project.id === project.id) {
				referenceConflict = null;
			}
			actionNotice =
				targetStatus === 'archived' ? `Proyek diarsipkan.` : `Proyek diaktifkan kembali.`;
			await loadProjects();
		} catch (err) {
			if (isApiError(err) && err.status === 409 && err.code === 'SESSION_ACTIVE') {
				sessionActiveConflict = {
					project,
					message: err.message
				};
			} else if (isApiError(err) && err.status === 409 && err.code === 'VERSION_CONFLICT') {
				listError = err.message;
				await loadProjects();
			} else {
				listError = isApiError(err) ? err.message : 'Gagal mengubah status arsip proyek.';
			}
		} finally {
			archivingId = null;
		}
	}

	async function handleDeleteProject(project: Project) {
		if (deletingId !== null) return;
		deletingId = project.id;
		actionNotice = null;
		referenceConflict = null;
		sessionActiveConflict = null;
		try {
			await deleteProjectApi(project.id, project.version);
			confirmingDeleteId = null;
			actionNotice = `Proyek dihapus.`;
			await loadProjects();
		} catch (err) {
			confirmingDeleteId = null;
			if (isApiError(err) && err.status === 409 && err.code === 'PROJECT_IN_USE') {
				referenceConflict = {
					project,
					message: err.message
				};
			} else {
				listError = isApiError(err) ? err.message : 'Gagal menghapus proyek.';
			}
		} finally {
			deletingId = null;
		}
	}
</script>

<svelte:head>
	<title>Proyek & zona — Inspeksi K3</title>
</svelte:head>

<div class="projects-stack">
	<header class="page-header">
		<div>
			<h1>Proyek & zona</h1>
		</div>
	</header>

	{#if actionNotice}
		<div class="banner ok" role="status">
			<span>{actionNotice}</span>
			<button type="button" class="dismiss-btn" onclick={() => (actionNotice = null)}>
				Tutup
			</button>
		</div>
	{/if}

	{#if referenceConflict}
		<div class="banner warn" role="alert" data-error-kind="reference-conflict">
			<div class="banner-body">
				<strong>Data masih digunakan</strong>
				<p>
					Proyek <strong>{referenceConflict.project.name}</strong> tidak dapat dihapus: {referenceConflict.message}
				</p>
			</div>
			<div class="banner-actions">
				{#if referenceConflict.project.status !== 'archived'}
					<button
						type="button"
						class="primary-btn"
						onclick={() =>
							referenceConflict && handleArchiveProject(referenceConflict.project, 'archived')}
						disabled={archivingId === referenceConflict.project.id}
					>
						{archivingId === referenceConflict.project.id ? 'Mengarsipkan...' : 'Arsipkan'}
					</button>
				{/if}
				<button type="button" class="secondary-btn" onclick={() => (referenceConflict = null)}>
					Tutup
				</button>
			</div>
		</div>
	{/if}

	{#if sessionActiveConflict}
		<div class="banner err" role="alert" data-error-kind="session-active-conflict">
			<div class="banner-body">
				<strong>Inspeksi masih berjalan</strong>
				<p>
					Proyek <strong>{sessionActiveConflict.project.name}</strong>: {sessionActiveConflict.message}
				</p>
			</div>
			<button type="button" class="secondary-btn" onclick={() => (sessionActiveConflict = null)}>
				Tutup
			</button>
		</div>
	{/if}

	<details class="create-disclosure">
		<summary class="create-trigger"><Icon name="plus" size={18} />Tambah proyek</summary>
		<section class="panel" aria-labelledby="create-project-heading">
			<h2 id="create-project-heading">Proyek baru</h2>

			{#if createGeneralError}
				<div class="banner err" role="alert">
					<span>{createGeneralError}</span>
				</div>
			{/if}

			<form class="project-form" onsubmit={handleCreateProject} novalidate>
				<div class="form-grid">
					<div class="field-group">
						<label for="create-project-name">Nama proyek <span class="req">*</span></label>
						<input
							id="create-project-name"
							name="name"
							type="text"
							maxlength="120"
							placeholder="Contoh: Pembangunan Gedung A"
							bind:value={createName}
							aria-invalid={createFieldErrors.name ? 'true' : undefined}
							aria-describedby={createFieldErrors.name ? 'create-name-error' : undefined}
							disabled={creating}
							required
						/>
						{#if createFieldErrors.name}
							<p id="create-name-error" class="field-error">{createFieldErrors.name}</p>
						{/if}
					</div>

					<div class="field-group">
						<label for="create-project-location">Lokasi</label>
						<input
							id="create-project-location"
							name="location"
							type="text"
							maxlength="200"
							placeholder="Contoh: Malang, Jawa Timur"
							bind:value={createLocation}
							aria-invalid={createFieldErrors.location ? 'true' : undefined}
							aria-describedby={createFieldErrors.location ? 'create-location-error' : undefined}
							disabled={creating}
						/>
						{#if createFieldErrors.location}
							<p id="create-location-error" class="field-error">{createFieldErrors.location}</p>
						{/if}
					</div>
				</div>

				<div class="field-group">
					<label for="create-project-description">Deskripsi proyek</label>
					<textarea
						id="create-project-description"
						name="description"
						rows="2"
						maxlength="2000"
						placeholder="Ringkasan lingkup pekerjaan konstruksi atau catatan lokasi..."
						bind:value={createDescription}
						aria-invalid={createFieldErrors.description ? 'true' : undefined}
						aria-describedby={createFieldErrors.description ? 'create-desc-error' : undefined}
						disabled={creating}
					></textarea>
					{#if createFieldErrors.description}
						<p id="create-desc-error" class="field-error">{createFieldErrors.description}</p>
					{/if}
				</div>

				<div class="form-actions">
					<button type="submit" class="primary-btn" disabled={creating}>
						{creating ? 'Menyimpan...' : 'Tambah Proyek'}
					</button>
				</div>
			</form>
		</section>
	</details>

	<section class="panel" aria-labelledby="project-list-heading">
		<div class="list-header">
			<div>
				<h2 id="project-list-heading">Daftar proyek</h2>
			</div>
		</div>

		<form class="filter-bar" onsubmit={handleFilterSubmit}>
			<div class="field-group filter-search">
				<label for="filter-project-q">Cari proyek</label>
				<input
					id="filter-project-q"
					type="search"
					placeholder="Ketik sebagian nama proyek..."
					bind:value={searchInput}
				/>
			</div>

			<div class="field-group">
				<label for="filter-project-status">Status proyek</label>
				<select
					id="filter-project-status"
					bind:value={statusFilter}
					onchange={() => {
						currentPage = 1;
						void loadProjects();
					}}
				>
					<option value="">Semua status</option>
					<option value="active">Aktif</option>
					<option value="archived">Diarsipkan</option>
				</select>
			</div>

			<div class="filter-buttons">
				<button type="submit" class="secondary-btn" disabled={loadingList}> Terapkan </button>
				<button
					type="button"
					class="secondary-btn"
					onclick={handleResetFilter}
					disabled={loadingList && !appliedSearch && !statusFilter}
				>
					Reset filter
				</button>
			</div>
		</form>

		{#if listError}
			<div class="banner err" role="alert" data-error-kind="backend">
				<div class="banner-body">
					<strong>Gagal Memuat Daftar proyek:</strong>
					<p>{listError}</p>
				</div>
				<button type="button" class="secondary-btn" onclick={loadProjects}> Coba lagi </button>
			</div>
		{:else if loadingList}
			<div class="state-box" role="status" aria-busy="true">
				<p>Memuat proyek...</p>
			</div>
		{:else if projects.length === 0}
			<div class="state-box empty" role="status">
				{#if appliedSearch || statusFilter}
					<p>
						<strong>Proyek tidak ditemukan.</strong> Ubah pencarian atau reset filter.
					</p>
				{:else}
					<p>
						<strong>Belum ada proyek.</strong> Tambahkan proyek untuk mulai inspeksi.
					</p>
				{/if}
			</div>
		{:else}
			<ul class="project-list">
				{#each projects as project (project.id)}
					<li class="project-card" data-testid="project-item" data-status={project.status}>
						<div class="project-card-main">
							<div class="project-title-row">
								<a href="/projects/{project.id}" class="project-title-link">
									{project.name}
								</a>
								<span
									class="status-badge"
									data-tone={project.status === 'active' ? 'ok' : 'neutral'}
								>
									{project.status === 'active' ? 'Aktif' : 'Diarsipkan'}
								</span>
								<span class="version-pill">v{project.version}</span>
							</div>

							<div class="project-meta">
								<span><strong>ID:</strong> #{project.id}</span>
								<span><strong>Lokasi:</strong> {project.location || 'Tidak ditentukan'}</span>
								<span>
									<strong>Diperbarui:</strong>
									{formatIndonesianDateTime(project.updated_at)} WIB
								</span>
							</div>

							{#if project.description}
								<p class="project-desc">{project.description}</p>
							{/if}
						</div>

						<div class="project-card-actions">
							<a href="/projects/{project.id}" class="action-link"> Buka proyek </a>
							<button type="button" class="secondary-btn" onclick={() => startEditProject(project)}>
								Edit
							</button>
							{#if project.status === 'active'}
								<button
									type="button"
									class="secondary-btn"
									onclick={() => handleArchiveProject(project, 'archived')}
									disabled={archivingId === project.id}
								>
									{archivingId === project.id ? 'Mengarsipkan...' : 'Arsipkan'}
								</button>
							{:else}
								<button
									type="button"
									class="secondary-btn"
									onclick={() => handleArchiveProject(project, 'active')}
									disabled={archivingId === project.id}
								>
									{archivingId === project.id ? 'Mengaktifkan...' : 'Aktifkan'}
								</button>
							{/if}

							{#if confirmingDeleteId === project.id}
								<div
									class="delete-confirm-inline"
									role="group"
									aria-label="Konfirmasi hapus proyek"
								>
									<span class="confirm-note"
										>Hapus proyek ini? Tindakan ini tidak bisa dibatalkan.</span
									>
									<button
										type="button"
										class="danger-btn"
										onclick={() => handleDeleteProject(project)}
										disabled={deletingId === project.id}
									>
										{deletingId === project.id ? 'Menghapus...' : 'Hapus'}
									</button>
									<button
										type="button"
										class="secondary-btn"
										onclick={() => (confirmingDeleteId = null)}
									>
										Batal
									</button>
								</div>
							{:else}
								<button
									type="button"
									class="danger-outline-btn"
									onclick={() => (confirmingDeleteId = project.id)}
								>
									Hapus
								</button>
							{/if}
						</div>

						{#if editingProjectId === project.id}
							<div class="inline-edit-panel">
								<h3>Edit proyek</h3>

								{#if editVersionConflict}
									<div class="banner warn" role="alert" data-error-kind="version-conflict">
										<div class="banner-body">
											<strong>Data sudah berubah</strong>
											<p>
												{editVersionConflict.message} Isianmu belum hilang. Ambil data terbaru, lalu
												simpan lagi.
											</p>
										</div>
										<button type="button" class="primary-btn" onclick={reloadConflictedProject}>
											Ambil data terbaru
										</button>
									</div>
								{/if}

								{#if editSessionConflict}
									<div class="banner err" role="alert" data-error-kind="session-active-conflict">
										<strong>Inspeksi masih berjalan</strong>
										{editSessionConflict}
									</div>
								{/if}

								{#if editGeneralError}
									<div class="banner err" role="alert">
										<span>{editGeneralError}</span>
									</div>
								{/if}

								<form class="project-form" onsubmit={handleSaveEditProject} novalidate>
									<div class="form-grid">
										<div class="field-group">
											<label for="edit-project-name-{project.id}"
												>Edit Nama proyek <span class="req">*</span></label
											>
											<input
												id="edit-project-name-{project.id}"
												type="text"
												maxlength="120"
												bind:value={editName}
												aria-invalid={editFieldErrors.name ? 'true' : undefined}
												disabled={editSaving}
												required
											/>
											{#if editFieldErrors.name}
												<p class="field-error">{editFieldErrors.name}</p>
											{/if}
										</div>

										<div class="field-group">
											<label for="edit-project-location-{project.id}">Edit Lokasi Proyek</label>
											<input
												id="edit-project-location-{project.id}"
												type="text"
												maxlength="200"
												bind:value={editLocation}
												aria-invalid={editFieldErrors.location ? 'true' : undefined}
												disabled={editSaving}
											/>
											{#if editFieldErrors.location}
												<p class="field-error">{editFieldErrors.location}</p>
											{/if}
										</div>

										<div class="field-group">
											<label for="edit-project-status-{project.id}">Status proyek</label>
											<select
												id="edit-project-status-{project.id}"
												bind:value={editStatus}
												disabled={editSaving}
											>
												<option value="active">Aktif</option>
												<option value="archived">Diarsipkan</option>
											</select>
										</div>
									</div>

									<div class="field-group">
										<label for="edit-project-desc-{project.id}">Edit Deskripsi proyek</label>
										<textarea
											id="edit-project-desc-{project.id}"
											rows="2"
											maxlength="2000"
											bind:value={editDescription}
											disabled={editSaving}
										></textarea>
										{#if editFieldErrors.description}
											<p class="field-error">{editFieldErrors.description}</p>
										{/if}
									</div>

									<div class="form-actions">
										<button type="submit" class="primary-btn" disabled={editSaving}>
											{editSaving ? 'Menyimpan...' : 'Simpan proyek'}
										</button>
										<button
											type="button"
											class="secondary-btn"
											onclick={cancelEditProject}
											disabled={editSaving}
										>
											Batal
										</button>
									</div>
								</form>
							</div>
						{/if}
					</li>
				{/each}
			</ul>

			<div class="pagination-bar" aria-label="Navigasi halaman proyek">
				<span class="pagination-summary">
					Halaman <strong>{meta.page}</strong> dari <strong>{totalPages}</strong> • Total
					<strong>{meta.total}</strong> proyek
				</span>
				<div class="pagination-controls">
					<button
						type="button"
						class="secondary-btn"
						onclick={() => handlePageChange(currentPage - 1)}
						disabled={currentPage <= 1 || loadingList}
					>
						Sebelumnya
					</button>
					<button
						type="button"
						class="secondary-btn"
						onclick={() => handlePageChange(currentPage + 1)}
						disabled={currentPage >= totalPages || loadingList}
					>
						Berikutnya
					</button>
				</div>
			</div>
		{/if}
	</section>
</div>

<style>
	.create-disclosure {
		align-self: stretch;
	}
	.create-trigger {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: fit-content;
		margin-left: 0;
		margin-top: 0;
		min-height: 40px;
		padding: 0.55rem 1rem;
		border-radius: 6px;
		background: var(--accent-primary);
		color: #fff;
		font-size: 0.875rem;
		font-weight: 600;
		list-style: none;
	}
	.create-trigger::-webkit-details-marker {
		display: none;
	}
	.create-trigger:hover {
		background: var(--accent-hover);
	}
	.create-disclosure[open] .create-trigger {
		margin-bottom: 1.25rem;
	}
	.create-disclosure > .panel {
		margin-top: 1rem;
	}
	@media (max-width: 1100px) {
		.create-trigger {
			margin-top: 0;
			margin-left: 0;
		}
	}

	.projects-stack {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.page-header {
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border-default);
	}

	.page-header h1 {
		margin: 0 0 0.35rem 0;
		font-size: 1.5rem;
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

	.panel h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	.banner {
		padding: 0.85rem 1rem;
		border-radius: 8px;
		font-size: 0.875rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.banner.ok {
		background: var(--status-ok-bg);
		border: 1px solid var(--status-ok-border);
		color: var(--status-ok-ink);
	}

	.banner.warn {
		background: var(--status-warn-bg);
		border: 1px solid var(--status-warn-border);
		color: var(--status-warn-ink);
	}

	.banner.err {
		background: var(--status-err-bg);
		border: 1px solid var(--status-err-border);
		color: var(--status-err-ink);
	}

	.banner-body p {
		margin: 0.25rem 0 0 0;
	}

	.banner-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.project-form {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
		gap: 0.875rem;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	.field-group label {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--ink-primary);
	}

	.req {
		color: var(--status-err-ink);
	}

	.field-group input,
	.field-group select,
	.field-group textarea {
		width: 100%;
		min-width: 0;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-strong);
		background: var(--bg-surface);
		font-size: 0.9375rem;
	}

	.field-group input[aria-invalid='true'],
	.field-group textarea[aria-invalid='true'] {
		border-color: var(--status-err-ink);
	}

	.field-error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--status-err-ink);
		font-weight: 500;
	}

	.form-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.625rem;
	}

	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.75rem;
		padding: 0.875rem;
		background: var(--bg-subtle);
		border-radius: 8px;
		border: 1px solid var(--border-default);
	}

	.filter-search {
		flex: 1 1 240px;
	}

	.filter-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.project-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.project-card {
		border: 1px solid var(--border-default);
		border-radius: 10px;
		padding: 1rem 1.125rem;
		background: var(--bg-surface);
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		min-width: 0;
	}

	.project-card-main {
		min-width: 0;
	}

	.project-card[data-status='archived'] {
		background: var(--bg-subtle);
	}

	.project-title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.project-title-link {
		font-size: 1.0625rem;
		font-weight: 700;
		color: var(--ink-primary);
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	.project-title-link:hover {
		color: var(--accent-primary);
		text-decoration: underline;
	}

	.status-badge {
		padding: 0.15rem 0.55rem;
		border-radius: 6px;
		font-size: 0.75rem;
		font-weight: 600;
		border: 1px solid var(--border-default);
		background: var(--bg-subtle);
		color: var(--ink-secondary);
	}

	.status-badge[data-tone='ok'] {
		background: var(--status-ok-bg);
		border-color: var(--status-ok-border);
		color: var(--status-ok-ink);
	}

	.version-pill {
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--ink-muted);
		background: var(--bg-subtle);
		padding: 0.1rem 0.45rem;
		border-radius: 4px;
		border: 1px solid var(--border-default);
	}

	.project-meta {
		margin-top: 0.35rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
		font-size: 0.8125rem;
		color: var(--ink-secondary);
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}

	.project-desc {
		margin: 0.5rem 0 0 0;
		font-size: 0.875rem;
		color: var(--ink-primary);
		overflow-wrap: anywhere;
	}

	.project-card-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding-top: 0.65rem;
		border-top: 1px solid var(--border-default);
	}

	.action-link {
		padding: 0.4rem 0.8rem;
		border-radius: 6px;
		background: var(--accent-surface);
		border: 1px solid var(--accent-border);
		color: var(--accent-primary);
		font-size: 0.8125rem;
		font-weight: 600;
		text-decoration: none;
	}

	.action-link:hover {
		background: var(--accent-surface);
	}

	.inline-edit-panel {
		margin-top: 0.25rem;
		padding: 1rem;
		border-radius: 8px;
		background: var(--bg-surface);
		border: 1px solid var(--border-strong);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	.inline-edit-panel h3 {
		margin: 0;
		font-size: 0.9375rem;
	}

	.delete-confirm-inline {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		background: var(--status-err-bg);
		border: 1px solid var(--status-err-border);
	}

	.confirm-note {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--status-err-ink);
	}

	.primary-btn {
		padding: 0.45rem 0.9rem;
		border-radius: 6px;
		border: 1px solid var(--accent-primary);
		background: var(--accent-primary);
		color: #ffffff;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
	}

	.primary-btn:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.secondary-btn,
	.dismiss-btn {
		padding: 0.42rem 0.8rem;
		border-radius: 6px;
		border: 1px solid var(--border-strong);
		background: var(--bg-surface);
		color: var(--ink-primary);
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
	}

	.secondary-btn:hover:not(:disabled),
	.dismiss-btn:hover:not(:disabled) {
		background: var(--bg-subtle);
	}

	.danger-outline-btn {
		padding: 0.42rem 0.8rem;
		border-radius: 6px;
		border: 1px solid var(--status-err-border);
		background: var(--bg-surface);
		color: var(--status-err-ink);
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
	}

	.danger-btn {
		padding: 0.42rem 0.8rem;
		border-radius: 6px;
		border: 1px solid var(--status-err-ink);
		background: var(--status-err-ink);
		color: #ffffff;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.state-box {
		padding: 1.25rem;
		border-radius: 8px;
		border: 1px solid var(--border-default);
		background: var(--bg-subtle);
		font-size: 0.9375rem;
		color: var(--ink-secondary);
	}

	.state-box p {
		margin: 0;
	}

	.pagination-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border-default);
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
	}

	.pagination-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	@media (max-width: 720px) {
		.panel {
			padding: 1rem;
		}

		.filter-bar {
			flex-direction: column;
			align-items: stretch;
		}

		.filter-search {
			flex: 1 1 auto;
		}

		.filter-buttons {
			width: 100%;
		}

		.filter-buttons > button {
			flex: 1 1 120px;
		}

		.project-card {
			padding: 0.9rem;
		}

		.project-card-actions > .action-link {
			width: 100%;
		}

		.project-card-actions > button {
			flex: 1 1 auto;
		}

		.inline-edit-panel {
			padding: 0.85rem;
		}

		.form-actions > button {
			flex: 1 1 140px;
		}

		.pagination-controls {
			width: 100%;
		}

		.pagination-controls > button {
			flex: 1 1 120px;
		}
	}
</style>
