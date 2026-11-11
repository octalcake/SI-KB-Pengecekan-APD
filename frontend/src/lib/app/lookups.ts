import { projects } from './projects';
import { monitoringApi } from './monitoring';
export const listProjectsLookupApi = (pageSize = 100) => projects.listProjects({ page: 1, page_size: pageSize });
export const listZonesLookupApi = (projectId: number, pageSize = 100) => projects.listZones(projectId, { page: 1, page_size: pageSize });
export const getProjectLookupApi = projects.getProject;
export const getZoneLookupApi = projects.getZone;
export const listSessionsLookupApi = (params: { project_id?: number | null; zone_id?: number | null; status?: string; page_size?: number } = {}) => monitoringApi.listSessions({
	projectId: params.project_id ?? undefined, zoneId: params.zone_id ?? undefined,
	status: params.status as 'active' | 'stopped' | 'interrupted' | undefined, page: 1, pageSize: params.page_size ?? 100
});
export const getSessionLookupApi = monitoringApi.getSession;
export const createManualSessionApi = (input: { project_id: number; zone_id: number }) => monitoringApi.startSession({ ...input, source: 'manual_entry' });
