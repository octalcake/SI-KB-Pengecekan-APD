import { apiData } from '#lib/api/client';
import type { SystemMode } from '#lib/types/api';

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

/**
 * Converts a local calendar date (YYYY-MM-DD) at 00:00:00 in the given IANA timezone
 * (default Asia/Jakarta, UTC+07:00) into an exact UTC RFC3339 timestamp string.
 */
export function localDateStartToUtcIso(dateStr: string, timeZone = 'Asia/Jakarta'): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
	if (!match) {
		throw new Error(`Format tanggal tidak valid: ${dateStr}`);
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);

	// Compute the timezone offset at that calendar date using Intl.DateTimeFormat
	const approxUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
	const offsetMs = getTimeZoneOffsetMs(new Date(approxUtc), timeZone);
	const exactUtc = new Date(approxUtc - offsetMs);
	return exactUtc.toISOString();
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
	try {
		const formatter = new Intl.DateTimeFormat('en-US', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23'
		});
		const parts = formatter.formatToParts(date);
		const map: Record<string, number> = {};
		for (const part of parts) {
			if (part.type !== 'literal') {
				map[part.type] = Number(part.value);
			}
		}
		const asUtc = Date.UTC(
			map.year,
			(map.month ?? 1) - 1,
			map.day ?? 1,
			map.hour ?? 0,
			map.minute ?? 0,
			map.second ?? 0
		);
		return asUtc - date.getTime();
	} catch {
		// Fallback for Asia/Jakarta (+07:00)
		return 7 * 60 * 60 * 1000;
	}
}

function addCalendarDays(dateStr: string, days: number): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
	if (!match) {
		throw new Error(`Format tanggal tidak valid: ${dateStr}`);
	}
	const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/**
 * Converts local calendar dates (YYYY-MM-DD) in the display timezone into:
 * - `from`: inclusive start of `fromDate` (00:00:00 local -> UTC RFC3339)
 * - `to`: exclusive end of `toDate` (00:00:00 of next local day -> UTC RFC3339)
 */
export function localDateRangeToUtcInterval(
	fromDate?: string,
	toDate?: string,
	timeZone = 'Asia/Jakarta'
): { from?: string; to?: string } {
	const fromTrimmed = fromDate?.trim() ?? '';
	const toTrimmed = toDate?.trim() ?? '';
	const result: { from?: string; to?: string } = {};

	if (fromTrimmed) {
		result.from = localDateStartToUtcIso(fromTrimmed, timeZone);
	}
	if (toTrimmed) {
		const nextDay = addCalendarDays(toTrimmed, 1);
		result.to = localDateStartToUtcIso(nextDay, timeZone);
	}
	return result;
}

export async function dashboardSummaryApi(
	filter: DashboardSummaryFilter = {}
): Promise<DashboardSummary> {
	const params = new URLSearchParams();
	if (filter.project_id && filter.project_id > 0) {
		params.set('project_id', String(filter.project_id));
	}
	if (filter.zone_id && filter.zone_id > 0) {
		params.set('zone_id', String(filter.zone_id));
	}
	if (filter.from) {
		params.set('from', filter.from);
	}
	if (filter.to) {
		params.set('to', filter.to);
	}
	if (filter.mode) {
		params.set('mode', filter.mode);
	}
	const qs = params.toString();
	return apiData<DashboardSummary>(`/dashboard/summary${qs ? `?${qs}` : ''}`);
}
