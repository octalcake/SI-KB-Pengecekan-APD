import type {
	FrameResult,
	MonitoringSession,
	SendFrameInput,
	StartSessionInput,
	StopReason
} from '../domain/types';

import type { MonitoringApi } from '../application/contracts';
export interface MonitoringHttpClient {
	apiData<T>(path: string, options?: Record<string, unknown>): Promise<T>;
	apiList<T>(
		path: string,
		options?: Record<string, unknown>
	): Promise<{ data: T[]; meta: { page: number; page_size: number; total: number } }>;
}

/**
 * Creates the monitoring API consumer bound to the shared #lib apiData/apiList interface.
 */
export function createMonitoringApi(client: MonitoringHttpClient): Omit<MonitoringApi, 'listActiveProjects' | 'listActiveZones'> {
	return {
		async listSessions(params = {}) {
			const search = new URLSearchParams();
			if(params.projectId && params.projectId > 0) {
				search.set('project_id', String(params.projectId));
			}
			if(params.zoneId && params.zoneId > 0) {
				search.set('zone_id', String(params.zoneId));
			}
			if(params.status) {
				search.set('status', params.status);
			}
			search.set('page', String(params.page ?? 1));
			search.set('page_size', String(params.pageSize ?? 20));
			return client.apiList<MonitoringSession>(`/monitoring/sessions?${search.toString()}`);
		},

		async getSession(sessionId: number): Promise<MonitoringSession> {
			return client.apiData<MonitoringSession>(
				`/monitoring/sessions/${encodeURIComponent(String(sessionId))}`
			);
		},

		async startSession(input: StartSessionInput): Promise<MonitoringSession> {
			return client.apiData<MonitoringSession>('/monitoring/sessions', {
				method: 'POST',
				body: {
					project_id: input.project_id,
					zone_id: input.zone_id,
					source: input.source ?? 'browser_webcam'
				}
			});
		},

		async sendFrame(input: SendFrameInput): Promise<FrameResult> {
			const sequenceInt = Math.max(1, Math.trunc(input.sequence));
			const elapsedInt = Math.max(0, Math.round(input.sampleElapsedMs));
			return client.apiData<FrameResult>(
				`/monitoring/sessions/${encodeURIComponent(String(input.sessionId))}/frames`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'image/jpeg',
						'X-Frame-Sequence': String(sequenceInt),
						'X-Captured-At': input.capturedAtUtc,
						'X-Sample-Elapsed-Ms': String(elapsedInt)
					},
					body: input.jpeg,
					signal: input.signal
				}
			);
		},

		async stopSession(
			sessionId: number,
			reason: StopReason = 'user_stop'
		): Promise<MonitoringSession> {
			return client.apiData<MonitoringSession>(
				`/monitoring/sessions/${encodeURIComponent(String(sessionId))}/stop`,
				{
					method: 'POST',
					body: { reason }
				}
			);
		}
	};
}
