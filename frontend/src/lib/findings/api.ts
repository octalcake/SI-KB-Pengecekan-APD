import {
	ApiError,
	apiBlob,
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
	CreateManualFindingInput,
	Finding,
	FindingFilterParams,
	FindingListResult,
	ProjectLookup,
	ReviewFindingInput,
	SessionLookup,
	ZoneLookup
} from './types';

export type SharedApiErrorLike = ApiError;
export type SharedSystemStatusLike = SystemStatus;
export type SharedAuthSessionLike = typeof authSession;

export function isFindingApiError(err: unknown): err is ApiError {
	return isApiError(err);
}

export function getSharedAuthSession(): typeof authSession {
	return authSession;
}

export function buildFindingsQuery(filter: FindingFilterParams = {}): string {
	const params = new URLSearchParams();
	if (filter.project_id && filter.project_id > 0) {
		params.set('project_id', String(filter.project_id));
	}
	if (filter.zone_id && filter.zone_id > 0) {
		params.set('zone_id', String(filter.zone_id));
	}
	if (filter.session_id && filter.session_id > 0) {
		params.set('session_id', String(filter.session_id));
	}
	if (filter.violation_type) {
		params.set('violation_type', filter.violation_type);
	}
	if (filter.verification_status) {
		params.set('verification_status', filter.verification_status);
	}
	if (filter.action_status) {
		params.set('action_status', filter.action_status);
	}
	if (filter.from) {
		params.set('from', filter.from);
	}
	if (filter.to) {
		params.set('to', filter.to);
	}
	if (filter.sort) {
		params.set('sort', filter.sort);
	}
	if (filter.page && filter.page > 0) {
		params.set('page', String(filter.page));
	}
	if (filter.page_size && filter.page_size > 0) {
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
	if (input.verification_status !== undefined) {
		body.verification_status = input.verification_status;
	}
	if (input.violation_type !== undefined) {
		body.violation_type = input.violation_type;
	}
	if (input.notes !== undefined) {
		body.notes = input.notes;
	}
	if (input.action_status !== undefined) {
		body.action_status = input.action_status;
	}
	if (input.action_notes !== undefined) {
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

export async function listProjectsLookupApi(
	pageSize = 100
): Promise<FindingListResult<ProjectLookup>> {
	return apiList<ProjectLookup>(`/projects?page=1&page_size=${pageSize}`, {
		method: 'GET'
	});
}

export async function listZonesLookupApi(
	projectId: number,
	pageSize = 100
): Promise<FindingListResult<ZoneLookup>> {
	return apiList<ZoneLookup>(`/projects/${projectId}/zones?page=1&page_size=${pageSize}`, {
		method: 'GET'
	});
}

export async function getProjectLookupApi(projectId: number): Promise<ProjectLookup> {
	return apiData<ProjectLookup>(`/projects/${projectId}`, {
		method: 'GET'
	});
}

export async function getZoneLookupApi(zoneId: number): Promise<ZoneLookup> {
	return apiData<ZoneLookup>(`/zones/${zoneId}`, {
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
): Promise<FindingListResult<SessionLookup>> {
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

export async function getSessionLookupApi(sessionId: number): Promise<SessionLookup> {
	return apiData<SessionLookup>(`/monitoring/sessions/${sessionId}`, {
		method: 'GET'
	});
}

export async function createManualSessionApi(input: {
	project_id: number;
	zone_id: number;
}): Promise<SessionLookup> {
	return apiData<SessionLookup>('/monitoring/sessions', {
		method: 'POST',
		body: {
			project_id: input.project_id,
			zone_id: input.zone_id,
			source: 'manual_entry'
		}
	});
}

export type EvidenceLoadStatus =
	| { state: 'loading' }
	| { state: 'ready'; objectUrl: string; byteLength: number }
	| {
			state: 'error';
			status: number;
			code: string;
			message: string;
			requestId: string | null;
			isMissingEvidence: boolean;
			isUnauthorized: boolean;
			isForbidden: boolean;
			isNetworkError: boolean;
	  };

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

export type { SystemMode, ViolationType };
