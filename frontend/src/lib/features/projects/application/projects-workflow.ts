import type {
	PaginatedList,
	Project,
	ProjectCreateInput,
	ProjectListFilter,
	ProjectUpdateInput,
	Zone,
	ZoneCreateInput,
	ZoneListFilter,
	ZoneUpdateInput
} from '../domain/types';

export interface ProjectsZoneLookupContract {
	listProjects(filter?: ProjectListFilter): Promise<PaginatedList<Project>>;
	listZones(projectId: number, filter?: ZoneListFilter): Promise<PaginatedList<Zone>>;
}

export interface ProjectsApiContract extends ProjectsZoneLookupContract {
	getProject(id: number): Promise<Project>;
	createProject(input: ProjectCreateInput): Promise<Project>;
	updateProject(id: number, input: ProjectUpdateInput): Promise<Project>;
	deleteProject(id: number, version: number): Promise<void>;
	getZone(id: number): Promise<Zone>;
	createZone(projectId: number, input: ZoneCreateInput): Promise<Zone>;
	updateZone(id: number, input: ZoneUpdateInput): Promise<Zone>;
	deleteZone(id: number, version: number): Promise<void>;
}

export function createProjectsWorkflow(api: ProjectsApiContract) {
	return {
		...api,
		listProjects(filter: ProjectListFilter = {}) {
			return api.listProjects({
				q: filter.q?.trim() || undefined,
				status: filter.status || undefined,
				page: filter.page,
				page_size: filter.page_size
			});
		},
		createProject(input: ProjectCreateInput) {
			return api.createProject({
				name: input.name.trim(),
				location: (input.location ?? '').trim(),
				description: (input.description ?? '').trim()
			});
		},
		updateProject(id: number, input: ProjectUpdateInput) {
			return api.updateProject(id, {
				...input,
				name: input.name !== undefined ? input.name.trim() : undefined,
				location: input.location !== undefined ? input.location.trim() : undefined,
				description: input.description !== undefined ? input.description.trim() : undefined
			});
		},
		listZones(projectId: number, filter: ZoneListFilter = {}) {
			return api.listZones(projectId, {
				status: filter.status || undefined,
				page: filter.page,
				page_size: filter.page_size
			});
		},
		createZone(projectId: number, input: ZoneCreateInput) {
			return api.createZone(projectId, {
				name: input.name.trim(),
				description: (input.description ?? '').trim()
			});
		},
		updateZone(id: number, input: ZoneUpdateInput) {
			return api.updateZone(id, {
				...input,
				name: input.name !== undefined ? input.name.trim() : undefined,
				description: input.description !== undefined ? input.description.trim() : undefined
			});
		},
	};
}
