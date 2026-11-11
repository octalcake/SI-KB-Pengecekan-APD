import * as http from '#lib/features/projects/infrastructure/http-adapter';
import { createProjectsWorkflow } from '#lib/features/projects/application/projects-workflow';
const projects = createProjectsWorkflow({
	listProjects: http.listProjectsApi,
	getProject: http.getProjectApi,
	createProject: http.createProjectApi,
	updateProject: http.updateProjectApi,
	deleteProject: http.deleteProjectApi,
	listZones: http.listZonesApi,
	getZone: http.getZoneApi,
	createZone: http.createZoneApi,
	updateZone: http.updateZoneApi,
	deleteZone: http.deleteZoneApi,
});
export const {
	listProjects: listProjectsApi,
	getProject: getProjectApi,
	createProject: createProjectApi,
	updateProject: updateProjectApi,
	deleteProject: deleteProjectApi,
	listZones: listZonesApi,
	getZone: getZoneApi,
	createZone: createZoneApi,
	updateZone: updateZoneApi,
	deleteZone: deleteZoneApi,
} = projects;
export { projects };
