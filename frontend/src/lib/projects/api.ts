import { apiData, apiList, apiNoContent } from '#lib/api/client';
import type { ApiListEnvelope } from '#lib/types/api';

export type RecordStatus = 'active' | 'archived';

export interface Project {
	id: number;
	name: string;
	location: string;
	description: string;
	status: RecordStatus;
	version: number;
	created_at: string;
	updated_at: string;
}

export interface Zone {
	id: number;
	project_id: number;
	name: string;
	description: string;
	status: RecordStatus;
	version: number;
	created_at: string;
	updated_at: string;
}

export interface ProjectListFilter {
	q?: string;
	status?: RecordStatus | '';
	page?: number;
	page_size?: number;
}

export interface ProjectCreateInput {
	name: string;
	location?: string;
	description?: string;
}

export interface ProjectUpdateInput {
	version: number;
	name?: string;
	location?: string;
	description?: string;
	status?: RecordStatus;
}

export interface ZoneListFilter {
	status?: RecordStatus | '';
	page?: number;
	page_size?: number;
}

export interface ZoneCreateInput {
	name: string;
	description?: string;
}

export interface ZoneUpdateInput {
	version: number;
	name?: string;
	description?: string;
	status?: RecordStatus;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
	const searchParams = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== '') {
			searchParams.set(key, String(value));
		}
	}
	const qs = searchParams.toString();
	return qs ? `?${qs}` : '';
}

export async function listProjectsApi(
	filter: ProjectListFilter = {}
): Promise<ApiListEnvelope<Project>> {
	const qs = buildQuery({
		q: filter.q?.trim() || undefined,
		status: filter.status || undefined,
		page: filter.page,
		page_size: filter.page_size
	});
	return apiList<Project>(`/projects${qs}`);
}

export async function getProjectApi(id: number): Promise<Project> {
	return apiData<Project>(`/projects/${id}`);
}

export async function createProjectApi(input: ProjectCreateInput): Promise<Project> {
	return apiData<Project>('/projects', {
		method: 'POST',
		body: {
			name: input.name,
			location: input.location ?? '',
			description: input.description ?? ''
		}
	});
}

export async function updateProjectApi(id: number, input: ProjectUpdateInput): Promise<Project> {
	return apiData<Project>(`/projects/${id}`, {
		method: 'PATCH',
		body: input
	});
}

export async function deleteProjectApi(id: number, version: number): Promise<void> {
	return apiNoContent(`/projects/${id}?version=${encodeURIComponent(String(version))}`, {
		method: 'DELETE'
	});
}

export async function listZonesApi(
	projectId: number,
	filter: ZoneListFilter = {}
): Promise<ApiListEnvelope<Zone>> {
	const qs = buildQuery({
		status: filter.status || undefined,
		page: filter.page,
		page_size: filter.page_size
	});
	return apiList<Zone>(`/projects/${projectId}/zones${qs}`);
}

export async function getZoneApi(id: number): Promise<Zone> {
	return apiData<Zone>(`/zones/${id}`);
}

export async function createZoneApi(projectId: number, input: ZoneCreateInput): Promise<Zone> {
	return apiData<Zone>(`/projects/${projectId}/zones`, {
		method: 'POST',
		body: {
			name: input.name,
			description: input.description ?? ''
		}
	});
}

export async function updateZoneApi(id: number, input: ZoneUpdateInput): Promise<Zone> {
	return apiData<Zone>(`/zones/${id}`, {
		method: 'PATCH',
		body: input
	});
}

export async function deleteZoneApi(id: number, version: number): Promise<void> {
	return apiNoContent(`/zones/${id}?version=${encodeURIComponent(String(version))}`, {
		method: 'DELETE'
	});
}

export function translateFieldError(field: string, code: string): string {
	const label =
		field === 'name'
			? 'Nama'
			: field === 'location'
				? 'Lokasi'
				: field === 'description'
					? 'Deskripsi'
					: field === 'status'
						? 'Status'
						: field === 'version'
							? 'Versi'
							: field;

	if (code === 'required') return `${label} wajib diisi.`;
	if (code === 'too_long') {
		if (field === 'name') return `${label} maksimal 120 karakter.`;
		if (field === 'location') return `${label} maksimal 200 karakter.`;
		if (field === 'description') return `${label} maksimal 2.000 karakter.`;
		return `${label} melebihi batas panjang karakter.`;
	}
	if (code === 'invalid') return `${label} tidak valid.`;
	return `${label}: ${code}`;
}

export function formatIndonesianDateTime(
	isoString: string,
	timeZone = 'Asia/Jakarta'
): string {
	if (!isoString) return '-';
	const date = new Date(isoString);
	if (Number.isNaN(date.getTime())) return isoString;
	try {
		return new Intl.DateTimeFormat('id-ID', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone
		}).format(date);
	} catch {
		return date.toISOString();
	}
}
