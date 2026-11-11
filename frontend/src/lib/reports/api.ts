import {
	ApiError,
	apiData,
	apiList,
	apiNoContent,
	authSession,
	isApiError,
	type SystemMode,
	type SystemStatus,
	type ViolationType
} from '#lib';
import type {
	ApproveReportInput,
	CreateManualReportInput,
	GenerateReportInput,
	ProjectLookup,
	RegenerateReportInput,
	Report,
	ReportFilterParams,
	ReportListResult,
	SessionLookup,
	UpdateReportInput,
	ZoneLookup
} from './types';

export type SharedApiErrorLike = ApiError;
export type SharedSystemStatusLike = SystemStatus;
export type SharedAuthSessionLike = typeof authSession;

export function isReportApiError(err: unknown): err is ApiError {
	return isApiError(err);
}

export function getSharedAuthSession(): typeof authSession {
	return authSession;
}

export function createOperationRequestKey(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	const hex = '0123456789abcdef';
	let out = '';
	for (let i = 0; i < 36; i++) {
		if (i === 8 || i === 13 || i === 18 || i === 23) {
			out += '-';
		} else if (i === 14) {
			out += '4';
		} else if (i === 19) {
			out += hex[(Math.floor(Math.random() * 16) & 0x3) | 0x8];
		} else {
			out += hex[Math.floor(Math.random() * 16)];
		}
	}
	return out;
}

export function buildReportsQuery(filter: ReportFilterParams = {}): string {
	const params = new URLSearchParams();
	if (filter.project_id && filter.project_id > 0) {
		params.set('project_id', String(filter.project_id));
	}
	if (filter.session_id && filter.session_id > 0) {
		params.set('session_id', String(filter.session_id));
	}
	if (filter.status) {
		params.set('status', filter.status);
	}
	if (filter.page && filter.page > 0) {
		params.set('page', String(filter.page));
	}
	if (filter.page_size && filter.page_size > 0) {
		params.set('page_size', String(filter.page_size));
	}
	const qs = params.toString();
	return qs ? `/reports?${qs}` : '/reports';
}

export async function listReportsApi(
	filter: ReportFilterParams = {}
): Promise<ReportListResult<Report>> {
	return apiList<Report>(buildReportsQuery(filter), {
		method: 'GET'
	});
}

export async function getReportApi(id: number): Promise<Report> {
	return apiData<Report>(`/reports/${id}`, {
		method: 'GET'
	});
}

export async function generateReportApi(input: GenerateReportInput): Promise<Report> {
	return apiData<Report>('/reports/generate', {
		method: 'POST',
		body: {
			session_id: input.session_id,
			request_key: input.request_key
		}
	});
}

export async function createManualReportApi(input: CreateManualReportInput): Promise<Report> {
	const body: Record<string, unknown> = {
		session_id: input.session_id,
		use_template: input.use_template
	};
	if (!input.use_template) {
		if (input.title !== undefined) {
			body.title = input.title;
		}
		if (input.content !== undefined) {
			body.content = input.content;
		}
	}
	return apiData<Report>('/reports', {
		method: 'POST',
		body
	});
}

export async function updateReportApi(id: number, input: UpdateReportInput): Promise<Report> {
	const body: Record<string, unknown> = {
		version: input.version
	};
	if (input.title !== undefined) {
		body.title = input.title;
	}
	if (input.content !== undefined) {
		body.content = input.content;
	}
	return apiData<Report>(`/reports/${id}`, {
		method: 'PATCH',
		body
	});
}

export async function regenerateReportApi(
	id: number,
	input: RegenerateReportInput
): Promise<Report> {
	return apiData<Report>(`/reports/${id}/regenerate`, {
		method: 'POST',
		body: {
			version: input.version,
			request_key: input.request_key
		}
	});
}

export async function approveReportApi(id: number, input: ApproveReportInput): Promise<Report> {
	return apiData<Report>(`/reports/${id}/approve`, {
		method: 'POST',
		body: {
			version: input.version,
			review_acknowledged: input.review_acknowledged
		}
	});
}

export async function deleteReportApi(id: number, version: number): Promise<void> {
	await apiNoContent(`/reports/${id}?version=${encodeURIComponent(String(version))}`, {
		method: 'DELETE'
	});
}

export async function listProjectsLookupApi(
	pageSize = 100
): Promise<ReportListResult<ProjectLookup>> {
	return apiList<ProjectLookup>(`/projects?page=1&page_size=${pageSize}`, {
		method: 'GET'
	});
}

export async function listZonesLookupApi(
	projectId: number,
	pageSize = 100
): Promise<ReportListResult<ZoneLookup>> {
	return apiList<ZoneLookup>(`/projects/${projectId}/zones?page=1&page_size=${pageSize}`, {
		method: 'GET'
	});
}

export async function listSessionsLookupApi(
	params: {
		project_id?: number | null;
		zone_id?: number | null;
		status?: string;
		page_size?: number;
	} = {}
): Promise<ReportListResult<SessionLookup>> {
	const q = new URLSearchParams();
	q.set('page', '1');
	q.set('page_size', String(params.page_size ?? 100));
	if (params.project_id && params.project_id > 0) {
		q.set('project_id', String(params.project_id));
	}
	if (params.zone_id && params.zone_id > 0) {
		q.set('zone_id', String(params.zone_id));
	}
	if (params.status) {
		q.set('status', params.status);
	}
	return apiList<SessionLookup>(`/monitoring/sessions?${q.toString()}`, {
		method: 'GET'
	});
}

export async function countConfirmedFindingsForSessionApi(sessionId: number): Promise<number> {
	const res = await apiList<{ id: number }>(
		`/findings?session_id=${encodeURIComponent(String(sessionId))}&verification_status=confirmed&page=1&page_size=1`,
		{
			method: 'GET'
		}
	);
	return res.meta.total ?? 0;
}

export type { SystemMode, ViolationType };
