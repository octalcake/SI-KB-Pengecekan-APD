export type SystemMode = 'real' | 'simulated' | 'manual';

export type ViolationType = 'NO_HELMET' | 'NO_VEST';

export type ActionStatus = 'pending' | 'in_progress' | 'completed';

export type SessionStatus = 'active' | 'stopped' | 'interrupted';

export type SessionSource = 'browser_webcam' | 'manual_entry';

export type ReportStatus = 'draft' | 'approved';

export type ReportGeneratedBy = 'gemini' | 'template' | 'manual';

export interface NamedRef {
	id: number;
	name: string;
}

export interface SnapshotFinding {
	id: number;
	version: number;
	violation_type: ViolationType;
	captured_at: string;
	notes: string;
	action_status: ActionStatus;
	action_notes: string;
}

export interface ReportSnapshot {
	session_id: number;
	mode: SystemMode;
	project: NamedRef;
	zone: NamedRef;
	findings: SnapshotFinding[];
}

export interface Report {
	id: number;
	session_id: number;
	project_id: number;
	created_by: number;
	title: string;
	content: string;
	status: ReportStatus;
	generated_by: ReportGeneratedBy;
	gemini_model: string | null;
	prompt_version: string | null;
	snapshot: ReportSnapshot;
	source_finding_ids: number[];
	source_hash: string;
	is_stale: boolean;
	approved_by: number | null;
	approved_at: string | null;
	version: number;
	created_at: string;
	updated_at: string;
}

export interface ReportFilterParams {
	project_id?: number | null;
	session_id?: number | null;
	status?: ReportStatus | '';
	page?: number;
	page_size?: number;
}

export interface GenerateReportInput {
	session_id: number;
	request_key: string;
}

export interface CreateManualReportInput {
	session_id: number;
	title?: string;
	content?: string;
	use_template: boolean;
}

export interface UpdateReportInput {
	version: number;
	title?: string;
	content?: string;
}

export interface RegenerateReportInput {
	version: number;
	request_key: string;
}

export interface ApproveReportInput {
	version: number;
	review_acknowledged: boolean;
}

export interface ProjectLookup {
	id: number;
	name: string;
	location: string;
	description: string;
	status: 'active' | 'archived';
	version: number;
	created_at: string;
	updated_at: string;
}

export interface ZoneLookup {
	id: number;
	project_id: number;
	name: string;
	description: string;
	status: 'active' | 'archived';
	version: number;
	created_at: string;
	updated_at: string;
}

export interface SessionConfigLookup {
	sample_fps: number;
	confirm_hits: number;
	confirm_max_frames: number;
	confirm_window_ms: number;
	track_timeout_ms: number;
	supported_violations?: ViolationType[];
}

export interface SessionLookup {
	id: number;
	project_id: number;
	zone_id: number;
	started_by: number;
	source: SessionSource;
	status: SessionStatus;
	mode: SystemMode;
	model_version: string | null;
	supported_violations: ViolationType[];
	started_at: string;
	ended_at: string | null;
	end_reason: string | null;
	last_frame_at: string | null;
	config: SessionConfigLookup;
}

export interface ReportPageMeta {
	page: number;
	page_size: number;
	total: number;
}

export interface ReportListResult<T> {
	data: T[];
	meta: ReportPageMeta;
}

export interface SessionEligibilityInfo {
	session: SessionLookup;
	projectName: string;
	zoneName: string;
	confirmedCount: number;
	existingReport: Report | null;
	isClosed: boolean;
	isEligibleForNewReport: boolean;
	ineligibleReason: string | null;
}
