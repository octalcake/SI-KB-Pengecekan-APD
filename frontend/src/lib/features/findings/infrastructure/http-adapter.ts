import { apiData, apiList, apiNoContent, apiBlob } from '#lib/shared/http/client';
import type {
	CreateManualFindingInput,
	Finding,
	FindingFilterParams,
	FindingListResult,
	ReviewFindingInput
} from '../domain/types';

export function buildFindingsQuery(filter: FindingFilterParams = {}): string {
	const params = new URLSearchParams();
	if(filter.project_id && filter.project_id > 0) {
		params.set('project_id', String(filter.project_id));
	}
	if(filter.zone_id && filter.zone_id > 0) {
		params.set('zone_id', String(filter.zone_id));
	}
	if(filter.session_id && filter.session_id > 0) {
		params.set('session_id', String(filter.session_id));
	}
	if(filter.violation_type) {
		params.set('violation_type', filter.violation_type);
	}
	if(filter.verification_status) {
		params.set('verification_status', filter.verification_status);
	}
	if(filter.action_status) {
		params.set('action_status', filter.action_status);
	}
	if(filter.from) {
		params.set('from', filter.from);
	}
	if(filter.to) {
		params.set('to', filter.to);
	}
	if(filter.sort) {
		params.set('sort', filter.sort);
	}
	if(filter.page && filter.page > 0) {
		params.set('page', String(filter.page));
	}
	if(filter.page_size && filter.page_size > 0) {
		params.set('page_size', String(filter.page_size));
	}
	const qs = params.toString();
	return qs ? `/findings?${qs}` : '/findings';
}

export async function listFindingsApi(
	filter: FindingFilterParams = {}
): Promise<FindingListResult<Finding>> {
	return apiList<Finding>(buildFindingsQuery(filter), {
		method: 'GET'
	});
}

export async function getFindingApi(id: number): Promise<Finding> {
	return apiData<Finding>(`/findings/${id}`, {
		method: 'GET'
	});
}

export async function reviewFindingApi(id: number, input: ReviewFindingInput): Promise<Finding> {
	const body: Record<string, unknown> = {
		version: input.version
	};
	if(input.verification_status !== undefined) {
		body.verification_status = input.verification_status;
	}
	if(input.violation_type !== undefined) {
		body.violation_type = input.violation_type;
	}
	if(input.notes !== undefined) {
		body.notes = input.notes;
	}
	if(input.action_status !== undefined) {
		body.action_status = input.action_status;
	}
	if(input.action_notes !== undefined) {
		body.action_notes = input.action_notes;
	}
	return apiData<Finding>(`/findings/${id}`, {
		method: 'PATCH',
		body
	});
}

export async function deleteFindingApi(id: number, version: number): Promise<void> {
	await apiNoContent(`/findings/${id}?version=${encodeURIComponent(String(version))}`, {
		method: 'DELETE'
	});
}

export async function createManualFindingApi(input: CreateManualFindingInput): Promise<Finding> {
	const form = new FormData();
	form.set('session_id', String(input.session_id));
	form.set('violation_type', input.violation_type);
	form.set('notes', input.notes);
	form.set('evidence', input.evidence, 'manual-evidence.jpg');

	return apiData<Finding>('/findings', {
		method: 'POST',
		body: form
	});
}

export async function fetchProtectedEvidenceBlob(
	evidenceUrl: string,
	signal?: AbortSignal
): Promise<{ blob: Blob; requestId: string | null }> {
	const targetUrl = evidenceUrl.startsWith('/')
		? evidenceUrl
		: `/api/v1/findings/${evidenceUrl}/evidence`;
	return apiBlob(targetUrl, {
		method: 'GET',
		cache: 'no-store',
		signal
	});
}
