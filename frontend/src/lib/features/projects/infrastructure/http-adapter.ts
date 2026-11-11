import { apiData, apiList, apiNoContent } from '#lib/shared/http/client';
import type { ApiListEnvelope } from '#lib/shared/envelopes';
import type {
	Project,
	Zone,
	ProjectListFilter,
	ProjectCreateInput,
	ProjectUpdateInput,
	ZoneListFilter,
	ZoneCreateInput,
	ZoneUpdateInput,
} from '../domain/types';
function buildQuery(params: Record<string, string | number | undefined>): string {
	const searchParams = new URLSearchParams();
	for(const [key, value] of Object.entries(params)) {
		if(value !== undefined && value !== '') {
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
