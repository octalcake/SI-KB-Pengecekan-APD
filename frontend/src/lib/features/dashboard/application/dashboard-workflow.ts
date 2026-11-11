import type { Project, Zone } from '#lib/features/projects/domain';
import type { ProjectsZoneLookupContract } from '#lib/features/projects/application';
import type { SystemMode } from '#lib/shared/domain/types';
import { localDateRangeToUtcInterval } from '../domain/summary';
import type { DashboardSummary, DashboardSummaryFilter } from '../domain/types';

export interface DashboardApiContract {
	getSummary(filter?: DashboardSummaryFilter): Promise<DashboardSummary>;
}

export interface DashboardSummaryQueryInput {
	mode: SystemMode;
	projectId?: string;
	zoneId?: string;
	fromDate?: string;
	toDate?: string;
	timeZone?: string;
}

export interface DashboardWorkflow {
	loadProjects(): Promise<Project[]>;
	loadZones(projectId: number): Promise<Zone[]>;
	fetchSummary(input: DashboardSummaryQueryInput): Promise<DashboardSummary>;
}

export function createDashboardWorkflow(
	api: DashboardApiContract,
	lookup: ProjectsZoneLookupContract
): DashboardWorkflow {
	return {
		async loadProjects(): Promise<Project[]> {
			const res = await lookup.listProjects({ page: 1, page_size: 100 });
			return res.data;
		},

		async loadZones(projectId: number): Promise<Zone[]> {
			const res = await lookup.listZones(projectId, { page: 1, page_size: 100 });
			return res.data;
		},

		async fetchSummary(input: DashboardSummaryQueryInput): Promise<DashboardSummary> {
			const tz = input.timeZone || 'Asia/Jakarta';
			const interval = localDateRangeToUtcInterval(input.fromDate, input.toDate, tz);
			const pid = input.projectId ? Number(input.projectId) : undefined;
			const zid = input.zoneId ? Number(input.zoneId) : undefined;

			return api.getSummary({
				mode: input.mode,
				project_id: pid && pid > 0 ? pid : undefined,
				zone_id: zid && zid > 0 ? zid : undefined,
				from: interval.from,
				to: interval.to
			});
		}
	};
}
