import type { ProjectLookup, SessionLookup, ZoneLookup, Report, ReportListResult, ReportFilterParams } from '../domain/types';
export interface ReportContextLookup {
	listProjectsLookupApi(pageSize: number): Promise<ReportListResult<ProjectLookup>>;
	listSessionsLookupApi(params: { page_size: number }): Promise<ReportListResult<SessionLookup>>;
	listReportsApi(filter: ReportFilterParams): Promise<ReportListResult<Report>>;
	listZonesLookupApi(projectId: number, pageSize: number): Promise<ReportListResult<ZoneLookup>>;
	countConfirmedFindingsForSessionApi(sessionId: number): Promise<number>;
}
export function createReportContext(lookup: ReportContextLookup) {
	const {
		listProjectsLookupApi,
		listSessionsLookupApi,
		listReportsApi,
		listZonesLookupApi,
		countConfirmedFindingsForSessionApi,
	} = lookup;
	return async function loadReportContext() {
		const [projRes, sessRes, allRepRes] = await Promise.all([
			listProjectsLookupApi(100),
			listSessionsLookupApi({ page_size: 100 }),
			listReportsApi({ page: 1, page_size: 100 })
		]);



		const repMap: Record<number, Report> = {};
		for(const r of allRepRes.data) {
			repMap[r.session_id] = r;
		}


		const zoneMap: Record<number, ZoneLookup[]> = {};
		await Promise.all(
			projRes.data.map(async (p) => {
				try {
					const zRes = await listZonesLookupApi(p.id, 100);
					zoneMap[p.id] = zRes.data;
				} catch {
					zoneMap[p.id] = [];
				}
			})
		);


		const countMap: Record<number, number> = {};
		await Promise.all(
			sessRes.data.map(async (s) => {
				try {
					countMap[s.id] = await countConfirmedFindingsForSessionApi(s.id);
				} catch {
					countMap[s.id] = 0;
				}
			})
		);


		return {
			projects: projRes.data, sessions: sessRes.data, allReportsBySession: repMap, zonesByProject: zoneMap, confirmedCountsBySession: countMap,
			firstEligibleSessionId: sessRes.data.find(s => s.status !== 'active' && (countMap[s.id] ?? 0) > 0 && !repMap[s.id])?.id ?? 0
		};
	};
}
