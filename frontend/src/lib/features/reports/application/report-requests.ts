import { isApiError } from '#lib/shared/errors';
import type { Report, GenerateReportInput, RegenerateReportInput, ApproveReportInput } from '../domain/types';

export function canApproveReport(report: Report | null, acknowledged: boolean): boolean {
	return Boolean(report && report.status === 'draft' && !report.is_stale && acknowledged);
}

export function createReportRequests(operations: {
	generate(input: GenerateReportInput): Promise<Report>;
	regenerate(id: number, input: RegenerateReportInput): Promise<Report>;
	approve(id: number, input: ApproveReportInput): Promise<Report>;
}, mintKey: () => string) {
	let generate: { scope: number; key: string } | null = null;
	let regenerate: { scope: string; key: string } | null = null;
	const replaceOnFailure = (error: unknown) => isApiError(error) &&
		['SOURCE_CHANGED', 'IDEMPOTENCY_CONFLICT', 'REQUEST_KEY_EXPIRED', 'VERSION_CONFLICT'].includes(error.code);
	function generateKey(sessionId: number, reset = false): string {
		if(reset || generate?.scope !== sessionId) generate = { scope: sessionId, key: mintKey() };
		return generate!.key;
	}
	function regenerateKey(id: number, version: number, reset = false): string {
		const scope = `${id}:${version}`;
		if(reset || regenerate?.scope !== scope) regenerate = { scope, key: mintKey() };
		return regenerate!.key;
	}
	return {
		generateKey,
		regenerateKey,
		clear() { generate = null; regenerate = null; },
		async generate(sessionId: number) {
			try { return await operations.generate({ session_id: sessionId, request_key: generateKey(sessionId) }); }
			catch(error) { if(replaceOnFailure(error)) generateKey(sessionId, true); throw error; }
		},
		async regenerate(report: Report) {
			try { return await operations.regenerate(report.id, { version: report.version, request_key: regenerateKey(report.id, report.version) }); }
			catch(error) { if(replaceOnFailure(error)) regenerateKey(report.id, report.version, true); throw error; }
		},
		async approve(report: Report, acknowledged: boolean) {
			if(!canApproveReport(report, acknowledged)) return null;
			return operations.approve(report.id, { version: report.version, review_acknowledged: acknowledged });
		}
	};
}
