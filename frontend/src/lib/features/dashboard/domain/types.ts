import type { SystemMode } from '#lib/shared/domain/types';
export interface DashboardSummary {
	sessions: number;
	findings_pending: number;
	findings_confirmed: number;
	findings_rejected: number;
	confirmed_actions_open: number;
	count_unit: string;
	mode: SystemMode;
	timezone: string;
}

export interface DashboardSummaryFilter {
	project_id?: number;
	zone_id?: number;
	from?: string;
	to?: string;
	mode?: SystemMode;
}
