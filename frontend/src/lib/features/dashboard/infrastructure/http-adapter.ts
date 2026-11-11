import { apiData } from '#lib/shared/http/client';
import type { DashboardSummary, DashboardSummaryFilter } from '../domain/types';
export async function dashboardSummaryApi(
	filter: DashboardSummaryFilter = {}
): Promise<DashboardSummary> {
	const params = new URLSearchParams();
	if(filter.project_id && filter.project_id > 0) {
		params.set('project_id', String(filter.project_id));
	}
	if(filter.zone_id && filter.zone_id > 0) {
		params.set('zone_id', String(filter.zone_id));
	}
	if(filter.from) {
		params.set('from', filter.from);
	}
	if(filter.to) {
		params.set('to', filter.to);
	}
	if(filter.mode) {
		params.set('mode', filter.mode);
	}
	const qs = params.toString();
	return apiData<DashboardSummary>(`/dashboard/summary${qs ? `?${qs}` : ''}`);
}
