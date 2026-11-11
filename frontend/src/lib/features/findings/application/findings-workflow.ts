import type {
	CreateManualFindingInput,
	Finding,
	FindingFilterParams,
	FindingListResult,
	ProjectLookup,
	ReviewFindingInput,
	SessionLookup,
	ZoneLookup
} from '../domain/types';

export interface FindingsApiContract {
	listFindings(filter?: FindingFilterParams): Promise<FindingListResult<Finding>>;
	getFinding(id: number): Promise<Finding>;
	reviewFinding(id: number, input: ReviewFindingInput): Promise<Finding>;
	deleteFinding(id: number, version: number): Promise<void>;
	createManualFinding(input: CreateManualFindingInput): Promise<Finding>;
	listProjectsLookup(pageSize?: number): Promise<FindingListResult<ProjectLookup>>;
	listZonesLookup(projectId: number, pageSize?: number): Promise<FindingListResult<ZoneLookup>>;
	getProjectLookup(projectId: number): Promise<ProjectLookup>;
	getZoneLookup(zoneId: number): Promise<ZoneLookup>;
	listSessionsLookup(params?: {
		project_id?: number | null;
		zone_id?: number | null;
		status?: string;
		page_size?: number;
	}): Promise<FindingListResult<SessionLookup>>;
	getSessionLookup(sessionId: number): Promise<SessionLookup>;
	createManualSession(input: {
		project_id: number;
		zone_id: number;
	}): Promise<SessionLookup>;
	fetchProtectedEvidenceBlob(
		evidenceUrl: string,
		signal?: AbortSignal
	): Promise<{ blob: Blob; requestId: string | null }>;
}

export interface FindingsContextLookups {
	projectLookup: ProjectLookup | null;
	zoneLookup: ZoneLookup | null;
	sessionLookup: SessionLookup | null;
}

export interface FindingsGalleryLookups {
	projects: ProjectLookup[];
	sessions: SessionLookup[];
	zonesByProject: Record<number, ZoneLookup[]>;
}

export interface FindingsWorkflow extends FindingsApiContract {
	loadFindingContextLookups(finding: Finding): Promise<FindingsContextLookups>;
	loadGalleryLookups(): Promise<FindingsGalleryLookups>;
}

export function createFindingsWorkflow(api: FindingsApiContract): FindingsWorkflow {
	return {
		...api,
		async loadFindingContextLookups(finding: Finding): Promise<FindingsContextLookups> {
			const [projRes, zoneRes, sessRes] = await Promise.allSettled([
				api.getProjectLookup(finding.project_id),
				api.getZoneLookup(finding.zone_id),
				api.getSessionLookup(finding.session_id)
			]);
			return {
				projectLookup: projRes.status === 'fulfilled' ? projRes.value : null,
				zoneLookup: zoneRes.status === 'fulfilled' ? zoneRes.value : null,
				sessionLookup: sessRes.status === 'fulfilled' ? sessRes.value : null
			};
		},
		async loadGalleryLookups(): Promise<FindingsGalleryLookups> {
			const [projRes, sessRes] = await Promise.all([
				api.listProjectsLookup(100),
				api.listSessionsLookup({ page_size: 100 })
			]);
			const zonesByProject: Record<number, ZoneLookup[]> = {};
			for(const p of projRes.data) {
				try {
					const zRes = await api.listZonesLookup(p.id, 100);
					zonesByProject[p.id] = zRes.data;
				} catch {
					zonesByProject[p.id] = [];
				}
			}
			return {
				projects: projRes.data,
				sessions: sessRes.data,
				zonesByProject
			};
		}
	};
}
