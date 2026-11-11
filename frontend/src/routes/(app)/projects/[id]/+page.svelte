<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { isApiError } from '#lib/api/client';
	import {
		createZoneApi,
		deleteProjectApi,
		deleteZoneApi,
		formatIndonesianDateTime,
		getProjectApi,
		getZoneApi,
		listZonesApi,
		translateFieldError,
		updateProjectApi,
		updateZoneApi,
		type Project,
		type RecordStatus,
		type Zone
	} from '#lib/projects/api';
	import type { PageMeta } from '#lib/types/api';

	const projectId = $derived(Number(page.params.id));

	let project = $state<Project | null>(null);
	let loadingProject = $state(true);
	let projectLoadError = $state<string | null>(null);

	// Zones state
	let zones = $state<Zone[]>([]);
	let zonesMeta = $state<PageMeta>({ page: 1, page_size: 10, total: 0 });
	let zoneStatusFilter = $state<RecordStatus | ''>('');
	let zonePage = $state(1);
	let zonePageSize = $state(10);
	let loadingZones = $state(true);
	let zonesLoadError = $state<string | null>(null);

	// Feedback banner
	let actionNotice = $state<string | null>(null);

	// Project Edit state
	let editingProject = $state(false);
	let projEditVersion = $state<number>(1);
	let projEditName = $state('');
	let projEditLocation = $state('');
	let projEditDescription = $state('');
	let projEditStatus = $state<RecordStatus>('active');
	let projEditSaving = $state(false);
	let projEditFieldErrors = $state<Record<string, string>>({});
	let projEditGeneralError = $state<string | null>(null);
	let projVersionConflict = $state<string | null>(null);

	// Project Delete / Archive state
	let confirmingProjectDelete = $state(false);
	let deletingProject = $state(false);
	let archivingProject = $state(false);

	// Shared conflict banners on detail page (project or zone)
	let referenceConflict = $state<{
		kind: 'project' | 'zone';
		targetId: number;
		targetVersion: number;
		targetName: string;
		message: string;
	} | null>(null);

	let sessionActiveConflict = $state<{
		targetName: string;
		message: string;
	} | null>(null);

	// Create Zone state
	let createZoneName = $state('');
	let createZoneDesc = $state('');
	let creatingZone = $state(false);
	let createZoneFieldErrors = $state<Record<string, string>>({});
	let createZoneError = $state<string | null>(null);

	// Edit Zone state
	let editingZoneId = $state<number | null>(null);
	let zoneEditVersion = $state<number>(1);
	let zoneEditName = $state('');
	let zoneEditDesc = $state('');
	let zoneEditStatus = $state<RecordStatus>('active');
	let zoneEditSaving = $state(false);
	let zoneEditFieldErrors = $state<Record<string, string>>({});
	let zoneEditError = $state<string | null>(null);
	let zoneVersionConflict = $state<string | null>(null);

	// Zone Delete / Archive state
	let confirmingZoneDeleteId = $state<number | null>(null);
	let deletingZoneId = $state<number | null>(null);
	let archivingZoneId = $state<number | null>(null);

	const totalZonePages = $derived(Math.max(1, Math.ceil(zonesMeta.total / zonesMeta.page_size)));

	$effect(() => {
		const id = projectId;
		if (Number.isFinite(id) && id > 0) {
			void loadAll(id);
		} else {
			loadingProject = false;
			projectLoadError = 'ID proyek tidak valid.';
		}
	});

	async function loadAll(id = projectId) {
		await Promise.all([loadProject(id), loadZones(id)]);
	}

	async function loadProject(id = projectId) {
		loadingProject = true;
		projectLoadError = null;
		try {
			project = await getProjectApi(id);
		} catch (err) {
			projectLoadError = isApiError(err)
				? err.message
				: 'Gagal memuat detail proyek dari server.';
		} finally {
			loadingProject = false;
		}
	}

	async function loadZones(id = projectId) {
		loadingZones = true;
		zonesLoadError = null;
		try {
			const res = await listZonesApi(id, {
				status: zoneStatusFilter,
				page: zonePage,
				page_size: zonePageSize
			});
			zones = res.data;
			zonesMeta = res.meta;
		} catch (err) {
			zonesLoadError = isApiError(err) ? err.message : 'Gagal memuat daftar zona proyek.';
		} finally {
			loadingZones = false;
		}
	}

	function openProjectEdit() {
		if (!project) return;
		editingProject = true;
		projEditVersion = project.version;
		projEditName = project.name;
		projEditLocation = project.location;
		projEditDescription = project.description;
		projEditStatus = project.status;
		projEditFieldErrors = {};
		projEditGeneralError = null;
		projVersionConflict = null;
		confirmingProjectDelete = false;
	}

	function cancelProjectEdit() {
		editingProject = false;
		projEditFieldErrors = {};
		projEditGeneralError = null;
		projVersionConflict = null;
	}

	async function handleSaveProjectEdit(event: SubmitEvent) {
		event.preventDefault();
		if (!project || projEditSaving) return;

		actionNotice = null;
		projEditGeneralError = null;
		sessionActiveConflict = null;

		const errs: Record<string, string> = {};
		const trimmedName = projEditName.trim();
		if (!trimmedName) {
			errs.name = 'Nama wajib diisi.';
		} else if ([...trimmedName].length > 120) {
			errs.name = 'Nama maksimal 120 karakter.';
		}
		if ([...projEditLocation.trim()].length > 200) {
			errs.location = 'Lokasi maksimal 200 karakter.';
		}
		if ([...projEditDescription.trim()].length > 2000) {
			errs.description = 'Deskripsi maksimal 2.000 karakter.';
		}
		projEditFieldErrors = errs;
		if (Object.keys(errs).length > 0) return;

		projEditSaving = true;
		try {
			const updated = await updateProjectApi(project.id, {
				version: projEditVersion,
				name: trimmedName,
				location: projEditLocation.trim(),
				description: projEditDescription.trim(),
				status: projEditStatus
			});
			project = updated;
			editingProject = false;
			projVersionConflict = null;
			actionNotice = `Proyek "${updated.name}" (v${updated.version}) berhasil diperbarui.`;
		} catch (err) {
			if (isApiError(err)) {
				if (err.status === 409 && err.code === 'VERSION_CONFLICT') {
					projVersionConflict = err.message;
				} else if (err.status === 409 && err.code === 'SESSION_ACTIVE') {
					sessionActiveConflict = {
						targetName: project.name,
						message: err.message
					};
				} else if (err.status === 422 && Object.keys(err.fields).length > 0) {
					const mapped: Record<string, string> = {};
					for (const [k, v] of Object.entries(err.fields)) {
						mapped[k] = translateFieldError(k, v);
					}
					projEditFieldErrors = mapped;
					projEditGeneralError = err.message;
				} else {
					projEditGeneralError = err.message;
				}
			} else {
				projEditGeneralError = 'Gagal menyimpan perubahan proyek.';
			}
		} finally {
			projEditSaving = false;
		}
	}

	async function reloadConflictedProject() {
		if (!project) return;
		try {
			const latest = await getProjectApi(project.id);
			project = latest;
			projEditVersion = latest.version;
			projVersionConflict = null;
			actionNotice = `Versi terbaru proyek (v${latest.version}) telah dimuat dari server. Input Anda tetap dipertahankan.`;
		} catch (err) {
			projEditGeneralError = isApiError(err)
				? err.message
				: 'Gagal memuat ulang versi proyek terbaru.';
		}
	}

	async function handleArchiveProject(targetStatus: RecordStatus = 'archived') {
		if (!project || archivingProject) return;
		archivingProject = true;
		actionNotice = null;
		sessionActiveConflict = null;
		try {
			const updated = await updateProjectApi(project.id, {
				version: project.version,
				status: targetStatus
			});
			project = updated;
			if (referenceConflict?.kind === 'project') {
				referenceConflict = null;
			}
			actionNotice =
				targetStatus === 'archived'
					? `Proyek "${updated.name}" berhasil diarsipkan.`
					: `Proyek "${updated.name}" berhasil diaktifkan kembali.`;
		} catch (err) {
			if (isApiError(err) && err.status === 409 && err.code === 'SESSION_ACTIVE') {
				sessionActiveConflict = {
					targetName: project.name,
					message: err.message
				};
			} else if (isApiError(err) && err.status === 409 && err.code === 'VERSION_CONFLICT') {
				projVersionConflict = err.message;
				await loadProject();
			} else {
				projectLoadError = isApiError(err) ? err.message : 'Gagal mengubah status arsip proyek.';
			}
		} finally {
			archivingProject = false;
		}
	}

	async function handleDeleteProject() {
		if (!project || deletingProject) return;
		deletingProject = true;
		actionNotice = null;
		referenceConflict = null;
		sessionActiveConflict = null;
		try {
			await deleteProjectApi(project.id, project.version);
			await goto('/projects');
		} catch (err) {
			confirmingProjectDelete = false;
			if (isApiError(err) && err.status === 409 && err.code === 'PROJECT_IN_USE') {
				referenceConflict = {
					kind: 'project',
					targetId: project.id,
					targetVersion: project.version,
					targetName: project.name,
					message: err.message
				};
			} else {
				projectLoadError = isApiError(err) ? err.message : 'Gagal menghapus proyek.';
			}
		} finally {
			deletingProject = false;
		}
	}

	async function handleCreateZone(event: SubmitEvent) {
		event.preventDefault();
		if (!project || creatingZone) return;

		actionNotice = null;
		createZoneError = null;
		const errs: Record<string, string> = {};
		const trimmedName = createZoneName.trim();
		if (!trimmedName) {
			errs.name = 'Nama zona wajib diisi.';
		} else if ([...trimmedName].length > 120) {
			errs.name = 'Nama zona maksimal 120 karakter.';
		}
		if ([...createZoneDesc.trim()].length > 2000) {
			errs.description = 'Deskripsi zona maksimal 2.000 karakter.';
		}
		createZoneFieldErrors = errs;
		if (Object.keys(errs).length > 0) return;

		creatingZone = true;
		try {
			const created = await createZoneApi(project.id, {
				name: trimmedName,
				description: createZoneDesc.trim()
			});
			createZoneName = '';
			createZoneDesc = '';
			createZoneFieldErrors = {};
			actionNotice = `Zona "${created.name}" berhasil ditambahkan ke proyek ini.`;
			zonePage = 1;
			await loadZones(project.id);
		} catch (err) {
			if (isApiError(err)) {
				if (err.status === 422 && Object.keys(err.fields).length > 0) {
					const mapped: Record<string, string> = {};
					for (const [k, v] of Object.entries(err.fields)) {
						mapped[k] = translateFieldError(k, v);
					}
					createZoneFieldErrors = mapped;
				}
				createZoneError = err.message;
			} else {
				createZoneError = 'Gagal menambahkan zona baru.';
			}
		} finally {
			creatingZone = false;
		}
	}

	function startEditZone(zone: Zone) {
		editingZoneId = zone.id;
		zoneEditVersion = zone.version;
		zoneEditName = zone.name;
		zoneEditDesc = zone.description;
		zoneEditStatus = zone.status;
		zoneEditFieldErrors = {};
		zoneEditError = null;
		zoneVersionConflict = null;
		confirmingZoneDeleteId = null;
	}

	function cancelEditZone() {
		editingZoneId = null;
		zoneEditFieldErrors = {};
		zoneEditError = null;
		zoneVersionConflict = null;
	}

	async function handleSaveZoneEdit(event: SubmitEvent) {
		event.preventDefault();
		if (editingZoneId === null || zoneEditSaving) return;

		actionNotice = null;
		zoneEditError = null;
		sessionActiveConflict = null;

		const errs: Record<string, string> = {};
		const trimmedName = zoneEditName.trim();
		if (!trimmedName) {
			errs.name = 'Nama zona wajib diisi.';
		} else if ([...trimmedName].length > 120) {
			errs.name = 'Nama zona maksimal 120 karakter.';
		}
		if ([...zoneEditDesc.trim()].length > 2000) {
			errs.description = 'Deskripsi zona maksimal 2.000 karakter.';
		}
		zoneEditFieldErrors = errs;
		if (Object.keys(errs).length > 0) return;

		zoneEditSaving = true;
		try {
			const updated = await updateZoneApi(editingZoneId, {
				version: zoneEditVersion,
				name: trimmedName,
				description: zoneEditDesc.trim(),
				status: zoneEditStatus
			});
			editingZoneId = null;
			zoneVersionConflict = null;
			actionNotice = `Zona "${updated.name}" (v${updated.version}) berhasil diperbarui.`;
			await loadZones();
		} catch (err) {
			if (isApiError(err)) {
				if (err.status === 409 && err.code === 'VERSION_CONFLICT') {
					zoneVersionConflict = err.message;
				} else if (err.status === 409 && err.code === 'SESSION_ACTIVE') {
					sessionActiveConflict = {
						targetName: zoneEditName,
						message: err.message
					};
				} else if (err.status === 422 && Object.keys(err.fields).length > 0) {
					const mapped: Record<string, string> = {};
					for (const [k, v] of Object.entries(err.fields)) {
						mapped[k] = translateFieldError(k, v);
					}
					zoneEditFieldErrors = mapped;
					zoneEditError = err.message;
				} else {
					zoneEditError = err.message;
				}
			} else {
				zoneEditError = 'Gagal menyimpan perubahan zona.';
			}
		} finally {
			zoneEditSaving = false;
		}
	}

	async function reloadConflictedZone() {
		if (editingZoneId === null) return;
		try {
			const latest = await getZoneApi(editingZoneId);
			zoneEditVersion = latest.version;
			zoneVersionConflict = null;
			zones = zones.map((z) => (z.id === latest.id ? latest : z));
			actionNotice = `Versi terbaru zona (v${latest.version}) telah dimuat dari server. Input Anda tetap dipertahankan.`;
		} catch (err) {
			zoneEditError = isApiError(err) ? err.message : 'Gagal memuat ulang versi zona terbaru.';
		}
	}

	async function handleArchiveZone(zoneId: number, version: number, targetStatus: RecordStatus = 'archived') {
		if (archivingZoneId !== null) return;
		archivingZoneId = zoneId;
		actionNotice = null;
		sessionActiveConflict = null;
		try {
			const updated = await updateZoneApi(zoneId, {
				version,
				status: targetStatus
			});
			if (referenceConflict?.kind === 'zone' && referenceConflict.targetId === zoneId) {
				referenceConflict = null;
			}
			actionNotice =
				targetStatus === 'archived'
					? `Zona "${updated.name}" telah diarsipkan.`
					: `Zona "${updated.name}" telah diaktifkan kembali.`;
			await loadZones();
		} catch (err) {
			if (isApiError(err) && err.status === 409 && err.code === 'SESSION_ACTIVE') {
				const z = zones.find((item) => item.id === zoneId);
				sessionActiveConflict = {
					targetName: z?.name ?? `Zona #${zoneId}`,
					message: err.message
				};
			} else {
				zonesLoadError = isApiError(err) ? err.message : 'Gagal mengubah status arsip zona.';
			}
		} finally {
			archivingZoneId = null;
		}
	}

	async function handleDeleteZone(zone: Zone) {
		if (deletingZoneId !== null) return;
		deletingZoneId = zone.id;
		actionNotice = null;
		referenceConflict = null;
		sessionActiveConflict = null;
		try {
			await deleteZoneApi(zone.id, zone.version);
			confirmingZoneDeleteId = null;
			actionNotice = `Zona "${zone.name}" berhasil dihapus permanen.`;
			await loadZones();
		} catch (err) {
			confirmingZoneDeleteId = null;
			if (isApiError(err) && err.status === 409 && err.code === 'ZONE_IN_USE') {
				referenceConflict = {
					kind: 'zone',
					targetId: zone.id,
					targetVersion: zone.version,
					targetName: zone.name,
					message: err.message
				};
			} else {
				zonesLoadError = isApiError(err) ? err.message : 'Gagal menghapus zona.';
			}
		} finally {
			deletingZoneId = null;
		}
	}

	async function handleZonePageChange(nextPage: number) {
		if (nextPage < 1 || nextPage > totalZonePages || nextPage === zonePage) return;
		zonePage = nextPage;
		await loadZones();
	}
</script>

<svelte:head>
	<title>
		{project ? `${project.name} — Detail Proyek & Zona` : 'Detail Proyek & Zona'} — Inspeksi K3
	</title>
</svelte:head>

<div class="detail-stack">
	<nav class="breadcrumb" aria-label="Breadcrumb">
		<a href="/projects">← Kembali ke Daftar Proyek</a>
	</nav>

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
				<strong>Penghapusan Ditolak — Gunakan Pengarsipan:</strong>
				<p>
					{referenceConflict.kind === 'project' ? 'Proyek' : 'Zona'}
					<strong>{referenceConflict.targetName}</strong>: {referenceConflict.message}
				</p>
			</div>
			<div class="banner-actions">
				{#if referenceConflict.kind === 'project'}
					<button
						type="button"
						class="primary-btn"
						onclick={() => handleArchiveProject('archived')}
						disabled={archivingProject}
					>
						{archivingProject ? 'Mengarsipkan...' : 'Arsipkan Sekarang'}
					</button>
				{:else}
					<button
						type="button"
						class="primary-btn"
						onclick={() =>
							referenceConflict &&
							handleArchiveZone(
								referenceConflict.targetId,
								referenceConflict.targetVersion,
								'archived'
							)}
						disabled={archivingZoneId === referenceConflict.targetId}
					>
						{archivingZoneId === referenceConflict.targetId
							? 'Mengarsipkan...'
							: 'Arsipkan Sekarang'}
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
				<strong>Konflik Sesi Monitoring Aktif:</strong>
				<p>
					<strong>{sessionActiveConflict.targetName}</strong>: {sessionActiveConflict.message}
				</p>
			</div>
			<button type="button" class="secondary-btn" onclick={() => (sessionActiveConflict = null)}>
				Tutup
			</button>
		</div>
	{/if}

	{#if loadingProject && !project}
		<section class="panel" role="status" aria-busy="true">
			<p>Memuat detail proyek...</p>
		</section>
	{:else if projectLoadError && !project}
		<section class="panel" role="alert" data-error-kind="backend">
			<h1>Gagal Memuat Detail Proyek</h1>
			<p>{projectLoadError}</p>
			<div class="form-actions">
				<button type="button" class="primary-btn" onclick={() => loadAll()}>
					Coba Lagi
				</button>
				<a href="/projects" class="secondary-link">Kembali ke Daftar Proyek</a>
			</div>
		</section>
	{:else if project}
		<section class="panel" aria-labelledby="project-detail-heading">
			<div class="project-header">
				<div>
					<div class="title-row">
						<h1 id="project-detail-heading">{project.name}</h1>
						<span
							class="status-badge"
							data-tone={project.status === 'active' ? 'ok' : 'neutral'}
						>
							{project.status === 'active' ? 'Aktif' : 'Diarsipkan'}
						</span>
						<span class="version-pill">v{project.version}</span>
					</div>
					<div class="meta-row">
						<span><strong>ID Proyek:</strong> #{project.id}</span>
						<span><strong>Lokasi:</strong> {project.location || 'Tidak ditentukan'}</span>
						<span>
							<strong>Terakhir Diperbarui:</strong>
							{formatIndonesianDateTime(project.updated_at)} WIB
						</span>
					</div>
					{#if project.description}
						<p class="project-desc">{project.description}</p>
					{/if}
				</div>

				<div class="header-actions">
					<button type="button" class="secondary-btn" onclick={openProjectEdit}>
						Edit Proyek
					</button>
					{#if project.status === 'active'}
						<button
							type="button"
							class="secondary-btn"
							onclick={() => handleArchiveProject('archived')}
							disabled={archivingProject}
						>
							{archivingProject ? 'Mengarsipkan...' : 'Arsipkan Proyek'}
						</button>
					{:else}
						<button
							type="button"
							class="secondary-btn"
							onclick={() => handleArchiveProject('active')}
							disabled={archivingProject}
						>
							{archivingProject ? 'Mengaktifkan...' : 'Aktifkan Proyek'}
						</button>
					{/if}

					{#if confirmingProjectDelete}
						<div class="delete-confirm-inline" role="group" aria-label="Konfirmasi hapus proyek">
							<span class="confirm-note">Yakin hapus proyek ini?</span>
							<button
								type="button"
								class="danger-btn"
								onclick={handleDeleteProject}
								disabled={deletingProject}
							>
								{deletingProject ? 'Menghapus...' : 'Konfirmasi Hapus Proyek'}
							</button>
							<button
								type="button"
								class="secondary-btn"
								onclick={() => (confirmingProjectDelete = false)}
							>
								Batal
							</button>
						</div>
					{:else}
						<button
							type="button"
							class="danger-outline-btn"
							onclick={() => (confirmingProjectDelete = true)}
						>
							Hapus Proyek
						</button>
					{/if}
				</div>
			</div>

			{#if projectLoadError}
				<div class="banner err" role="alert">
					<span>{projectLoadError}</span>
				</div>
			{/if}

			{#if editingProject}
				<div class="edit-box">
					<h2>Edit Proyek #{project.id} (Target v{projEditVersion})</h2>

					{#if projVersionConflict}
						<div class="banner warn" role="alert" data-error-kind="version-conflict">
							<div class="banner-body">
								<strong>Konflik Versi Terdeteksi (409 VERSION_CONFLICT):</strong>
								<p>
									{projVersionConflict} Input Anda yang belum disimpan tetap dipertahankan pada formulir di bawah.
								</p>
							</div>
							<button type="button" class="primary-btn" onclick={reloadConflictedProject}>
								Muat Ulang Data Terbaru
							</button>
						</div>
					{/if}

					{#if projEditGeneralError}
						<div class="banner err" role="alert">
							<span>{projEditGeneralError}</span>
						</div>
					{/if}

					<form class="form-stack" onsubmit={handleSaveProjectEdit} novalidate>
						<div class="form-grid">
							<div class="field-group">
								<label for="detail-edit-project-name">Edit Nama Proyek <span class="req">*</span></label>
								<input
									id="detail-edit-project-name"
									type="text"
									maxlength="120"
									bind:value={projEditName}
									aria-invalid={projEditFieldErrors.name ? 'true' : undefined}
									disabled={projEditSaving}
									required
								/>
								{#if projEditFieldErrors.name}
									<p class="field-error">{projEditFieldErrors.name}</p>
								{/if}
							</div>

							<div class="field-group">
								<label for="detail-edit-project-location">Edit Lokasi Proyek</label>
								<input
									id="detail-edit-project-location"
									type="text"
									maxlength="200"
									bind:value={projEditLocation}
									aria-invalid={projEditFieldErrors.location ? 'true' : undefined}
									disabled={projEditSaving}
								/>
								{#if projEditFieldErrors.location}
									<p class="field-error">{projEditFieldErrors.location}</p>
								{/if}
							</div>

							<div class="field-group">
								<label for="detail-edit-project-status">Status Proyek</label>
								<select
									id="detail-edit-project-status"
									bind:value={projEditStatus}
									disabled={projEditSaving}
								>
									<option value="active">Aktif (active)</option>
									<option value="archived">Diarsipkan (archived)</option>
								</select>
							</div>
						</div>

						<div class="field-group">
							<label for="detail-edit-project-desc">Edit Deskripsi Proyek</label>
							<textarea
								id="detail-edit-project-desc"
								rows="2"
								maxlength="2000"
								bind:value={projEditDescription}
								disabled={projEditSaving}
							></textarea>
							{#if projEditFieldErrors.description}
								<p class="field-error">{projEditFieldErrors.description}</p>
							{/if}
						</div>

						<div class="form-actions">
							<button type="submit" class="primary-btn" disabled={projEditSaving}>
								{projEditSaving ? 'Menyimpan...' : 'Simpan Perubahan Proyek'}
							</button>
							<button
								type="button"
								class="secondary-btn"
								onclick={cancelProjectEdit}
								disabled={projEditSaving}
							>
								Batal
							</button>
						</div>
					</form>
				</div>
			{/if}
		</section>

		<section class="panel" aria-labelledby="create-zone-heading">
			<h2 id="create-zone-heading">Tambah Zona pada Proyek Ini</h2>
			{#if project.status !== 'active'}
				<div class="banner warn" role="status">
					<span>
						<strong>Proyek Berstatus Diarsipkan:</strong> Zona baru hanya dapat dibuat pada proyek aktif. Aktifkan kembali proyek ini jika perlu menambahkan zona pengamatan baru.
					</span>
				</div>
			{:else}
				<p class="panel-desc">
					Setiap zona terikat permanen pada proyek <strong>{project.name}</strong> (#{project.id}) dan memiliki nama unik di dalam proyek ini.
				</p>

				{#if createZoneError}
					<div class="banner err" role="alert">
						<span>{createZoneError}</span>
					</div>
				{/if}

				<form class="form-stack" onsubmit={handleCreateZone} novalidate>
					<div class="form-grid">
						<div class="field-group">
							<label for="create-zone-name">Nama Zona <span class="req">*</span></label>
							<input
								id="create-zone-name"
								type="text"
								maxlength="120"
								placeholder="Contoh: Lantai 2 Struktur"
								bind:value={createZoneName}
								aria-invalid={createZoneFieldErrors.name ? 'true' : undefined}
								disabled={creatingZone}
								required
							/>
							{#if createZoneFieldErrors.name}
								<p class="field-error">{createZoneFieldErrors.name}</p>
							{/if}
						</div>

						<div class="field-group">
							<label for="create-zone-desc">Deskripsi Zona</label>
							<input
								id="create-zone-desc"
								type="text"
								maxlength="2000"
								placeholder="Area pengamatan webcam atau titik kerja..."
								bind:value={createZoneDesc}
								aria-invalid={createZoneFieldErrors.description ? 'true' : undefined}
								disabled={creatingZone}
							/>
							{#if createZoneFieldErrors.description}
								<p class="field-error">{createZoneFieldErrors.description}</p>
							{/if}
						</div>
					</div>

					<div class="form-actions">
						<button type="submit" class="primary-btn" disabled={creatingZone}>
							{creatingZone ? 'Menyimpan...' : 'Tambah Zona'}
						</button>
					</div>
				</form>
			{/if}
		</section>

		<section class="panel" aria-labelledby="zone-list-heading">
			<div class="zone-list-header">
				<div>
					<h2 id="zone-list-heading">Daftar Zona Proyek ({zonesMeta.total})</h2>
					<p class="panel-desc">
						Zona yang telah memiliki riwayat sesi monitoring tidak dapat dihapus permanen dan wajib diarsipkan.
					</p>
				</div>

				<div class="field-group">
					<label for="filter-zone-status">Status Zona</label>
					<select
						id="filter-zone-status"
						bind:value={zoneStatusFilter}
						onchange={() => {
							zonePage = 1;
							void loadZones();
						}}
					>
						<option value="">Semua Status</option>
						<option value="active">Aktif (active)</option>
						<option value="archived">Diarsipkan (archived)</option>
					</select>
				</div>
			</div>

			{#if zonesLoadError}
				<div class="banner err" role="alert" data-error-kind="backend">
					<span>{zonesLoadError}</span>
					<button type="button" class="secondary-btn" onclick={() => loadZones()}>
						Coba Lagi
					</button>
				</div>
			{:else if loadingZones}
				<div class="state-box" role="status" aria-busy="true">
					<p>Memuat daftar zona proyek...</p>
				</div>
			{:else if zones.length === 0}
				<div class="state-box" role="status">
					{#if zoneStatusFilter}
						<p>Tidak ada zona dengan status <strong>{zoneStatusFilter}</strong> pada proyek ini.</p>
					{:else}
						<p>
							<strong>Belum ada zona terdaftar pada proyek ini.</strong> Tambahkan minimal satu zona aktif agar proyek dapat dipilih pada sesi monitoring kamera.
						</p>
					{/if}
				</div>
			{:else}
				<ul class="zone-list">
					{#each zones as zone (zone.id)}
						<li class="zone-card" data-testid="zone-item" data-status={zone.status}>
							<div class="zone-main">
								<div class="title-row">
									<strong class="zone-name">{zone.name}</strong>
									<span
										class="status-badge"
										data-tone={zone.status === 'active' ? 'ok' : 'neutral'}
									>
										{zone.status === 'active' ? 'Aktif' : 'Diarsipkan'}
									</span>
									<span class="version-pill">v{zone.version}</span>
								</div>

								<div class="meta-row">
									<span><strong>ID Zona:</strong> #{zone.id}</span>
									<span><strong>Proyek Induk:</strong> #{zone.project_id} ({project.name})</span>
									<span>
										<strong>Diperbarui:</strong>
										{formatIndonesianDateTime(zone.updated_at)} WIB
									</span>
								</div>

								{#if zone.description}
									<p class="project-desc">{zone.description}</p>
								{/if}
							</div>

							<div class="zone-actions">
								<button
									type="button"
									class="secondary-btn"
									onclick={() => startEditZone(zone)}
								>
									Edit Zona
								</button>

								{#if zone.status === 'active'}
									<button
										type="button"
										class="secondary-btn"
										onclick={() => handleArchiveZone(zone.id, zone.version, 'archived')}
										disabled={archivingZoneId === zone.id}
									>
										{archivingZoneId === zone.id ? 'Mengarsipkan...' : 'Arsipkan Zona'}
									</button>
								{:else}
									<button
										type="button"
										class="secondary-btn"
										onclick={() => handleArchiveZone(zone.id, zone.version, 'active')}
										disabled={archivingZoneId === zone.id}
									>
										{archivingZoneId === zone.id ? 'Mengaktifkan...' : 'Aktifkan Zona'}
									</button>
								{/if}

								{#if confirmingZoneDeleteId === zone.id}
									<div class="delete-confirm-inline" role="group" aria-label="Konfirmasi hapus zona">
										<span class="confirm-note">Hapus zona ini?</span>
										<button
											type="button"
											class="danger-btn"
											onclick={() => handleDeleteZone(zone)}
											disabled={deletingZoneId === zone.id}
										>
											{deletingZoneId === zone.id ? 'Menghapus...' : 'Konfirmasi Hapus'}
										</button>
										<button
											type="button"
											class="secondary-btn"
											onclick={() => (confirmingZoneDeleteId = null)}
										>
											Batal
										</button>
									</div>
								{:else}
									<button
										type="button"
										class="danger-outline-btn"
										onclick={() => (confirmingZoneDeleteId = zone.id)}
									>
										Hapus Zona
									</button>
								{/if}
							</div>

							{#if editingZoneId === zone.id}
								<div class="edit-box">
									<h3>Edit Zona #{zone.id} (Target v{zoneEditVersion})</h3>

									{#if zoneVersionConflict}
										<div class="banner warn" role="alert" data-error-kind="version-conflict">
											<div class="banner-body">
												<strong>Konflik Versi Zona (409 VERSION_CONFLICT):</strong>
												<p>
													{zoneVersionConflict} Input Anda tetap dipertahankan di bawah.
												</p>
											</div>
											<button
												type="button"
												class="primary-btn"
												onclick={reloadConflictedZone}
											>
												Muat Ulang Data Terbaru
											</button>
										</div>
									{/if}

									{#if zoneEditError}
										<div class="banner err" role="alert">
											<span>{zoneEditError}</span>
										</div>
									{/if}

									<form class="form-stack" onsubmit={handleSaveZoneEdit} novalidate>
										<div class="form-grid">
											<div class="field-group">
												<label for="edit-zone-name-{zone.id}">Edit Nama Zona <span class="req">*</span></label>
												<input
													id="edit-zone-name-{zone.id}"
													type="text"
													maxlength="120"
													bind:value={zoneEditName}
													aria-invalid={zoneEditFieldErrors.name ? 'true' : undefined}
													disabled={zoneEditSaving}
													required
												/>
												{#if zoneEditFieldErrors.name}
													<p class="field-error">{zoneEditFieldErrors.name}</p>
												{/if}
											</div>

											<div class="field-group">
												<label for="edit-zone-status-{zone.id}">Status Zona</label>
												<select
													id="edit-zone-status-{zone.id}"
													bind:value={zoneEditStatus}
													disabled={zoneEditSaving}
												>
													<option value="active">Aktif (active)</option>
													<option value="archived">Diarsipkan (archived)</option>
												</select>
											</div>
										</div>

										<div class="field-group">
											<label for="edit-zone-desc-{zone.id}">Edit Deskripsi Zona</label>
											<textarea
												id="edit-zone-desc-{zone.id}"
												rows="2"
												maxlength="2000"
												bind:value={zoneEditDesc}
												disabled={zoneEditSaving}
											></textarea>
											{#if zoneEditFieldErrors.description}
												<p class="field-error">{zoneEditFieldErrors.description}</p>
											{/if}
										</div>

										<div class="form-actions">
											<button type="submit" class="primary-btn" disabled={zoneEditSaving}>
												{zoneEditSaving ? 'Menyimpan...' : 'Simpan Perubahan Zona'}
											</button>
											<button
												type="button"
												class="secondary-btn"
												onclick={cancelEditZone}
												disabled={zoneEditSaving}
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

				<div class="pagination-bar" aria-label="Navigasi halaman zona">
					<span>
						Halaman <strong>{zonesMeta.page}</strong> dari <strong>{totalZonePages}</strong> • Total
						<strong>{zonesMeta.total}</strong> zona
					</span>
					<div class="pagination-controls">
						<button
							type="button"
							class="secondary-btn"
							onclick={() => handleZonePageChange(zonePage - 1)}
							disabled={zonePage <= 1 || loadingZones}
						>
							Sebelumnya
						</button>
						<button
							type="button"
							class="secondary-btn"
							onclick={() => handleZonePageChange(zonePage + 1)}
							disabled={zonePage >= totalZonePages || loadingZones}
						>
							Berikutnya
						</button>
					</div>
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.detail-stack {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.breadcrumb a {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--accent-primary);
		text-decoration: none;
	}

	.breadcrumb a:hover {
		text-decoration: underline;
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

	.project-header,
	.zone-list-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.title-row h1 {
		margin: 0;
		font-size: 1.4rem;
	}

	.panel h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	.panel-desc {
		margin: 0.2rem 0 0 0;
		font-size: 0.875rem;
		color: var(--ink-secondary);
	}

	.meta-row {
		margin-top: 0.4rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
		font-size: 0.8125rem;
		color: var(--ink-secondary);
		font-variant-numeric: tabular-nums;
	}

	.project-desc {
		margin: 0.5rem 0 0 0;
		font-size: 0.9375rem;
		color: var(--ink-primary);
	}

	.header-actions,
	.zone-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
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

	.edit-box {
		padding: 1rem;
		border-radius: 8px;
		background: var(--bg-subtle);
		border: 1px solid var(--border-strong);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.edit-box h2,
	.edit-box h3 {
		margin: 0;
		font-size: 0.95rem;
	}

	.form-stack {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.875rem;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
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
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--border-strong);
		background: var(--bg-surface);
		font-size: 0.9375rem;
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

	.zone-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.zone-card {
		border: 1px solid var(--border-default);
		border-radius: 10px;
		padding: 1rem 1.125rem;
		background: var(--bg-surface);
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.zone-card[data-status='archived'] {
		background: var(--bg-subtle);
	}

	.zone-name {
		font-size: 1rem;
		color: var(--ink-primary);
	}

	.zone-actions {
		padding-top: 0.65rem;
		border-top: 1px solid var(--border-default);
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
	.dismiss-btn,
	.secondary-link {
		padding: 0.42rem 0.8rem;
		border-radius: 6px;
		border: 1px solid var(--border-strong);
		background: var(--bg-surface);
		color: var(--ink-primary);
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
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
		gap: 0.5rem;
	}

	@media (max-width: 720px) {
		.panel {
			padding: 1rem;
		}
	}
</style>
