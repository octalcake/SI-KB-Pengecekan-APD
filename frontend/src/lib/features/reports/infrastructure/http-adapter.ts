import { apiData, apiList, apiNoContent } from '#lib/shared/http/client';
import type {
	ApproveReportInput,
	CreateManualReportInput,
	GenerateReportInput,
	RegenerateReportInput,
	Report,
	ReportFilterParams,
	ReportListResult,
	UpdateReportInput
} from '../domain/types';

export function buildReportsQuery(filter: ReportFilterParams = {}): string {
	const params = new URLSearchParams();
	if(filter.project_id && filter.project_id > 0) {
		params.set('project_id', String(filter.project_id));
	}
	if(filter.session_id && filter.session_id > 0) {
		params.set('session_id', String(filter.session_id));
	}
	if(filter.status) {
		params.set('status', filter.status);
	}
	if(filter.page && filter.page > 0) {
		params.set('page', String(filter.page));
	}
	if(filter.page_size && filter.page_size > 0) {
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
	if(!input.use_template) {
		if(input.title !== undefined) {
			body.title = input.title;
		}
		if(input.content !== undefined) {
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
	if(input.title !== undefined) {
		body.title = input.title;
	}
	if(input.content !== undefined) {
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

export async function countConfirmedFindingsForSessionApi(sessionId: number): Promise<number> {
	const res = await apiList<{ id: number }>(
		`/findings?session_id=${encodeURIComponent(String(sessionId))}&verification_status=confirmed&page=1&page_size=1`,
		{
			method: 'GET'
		}
	);
	return res.meta.total ?? 0;
}
