import type {
	FrameResult,
	MonitoringProject,
	MonitoringSession,
	MonitoringZone,
	SendFrameInput,
	SessionStatus,
	StartSessionInput,
	StopReason
} from '../domain/types';

export interface MonitoringApi {
	listActiveProjects(): Promise<MonitoringProject[]>;
	listActiveZones(projectId: number): Promise<MonitoringZone[]>;
	listSessions(params?: {
		projectId?: number;
		zoneId?: number;
		status?: SessionStatus;
		page?: number;
		pageSize?: number;
	}): Promise<{ data: MonitoringSession[]; meta: { page: number; page_size: number; total: number } }>;
	getSession(sessionId: number): Promise<MonitoringSession>;
	startSession(input: StartSessionInput): Promise<MonitoringSession>;
	sendFrame(input: SendFrameInput): Promise<FrameResult>;
	stopSession(sessionId: number, reason?: StopReason): Promise<MonitoringSession>;
}
