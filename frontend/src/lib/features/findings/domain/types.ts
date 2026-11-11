import type { SystemMode, ViolationType } from '#lib/shared/domain/types';
export type { SystemMode, ViolationType } from '#lib/shared/domain/types';

export type VerificationStatus = 'pending' | 'confirmed' | 'rejected';

export type ActionStatus = 'pending' | 'in_progress' | 'completed';

export type FindingSource = 'auto' | 'manual';

export type SessionStatus = 'active' | 'stopped' | 'interrupted';

export type SessionSource = 'browser_webcam' | 'manual_entry';

export type BBox = [number, number, number, number];

export interface RawPPEObservation {
	type: ViolationType;
	state: 'positive' | 'negative' | 'unknown';
	confidence?: number | null;
	bbox?: BBox | null;
}

export interface RawDetectionPerson {
	track_id?: number;
	confidence?: number;
	bbox?: BBox;
	ppe?: RawPPEObservation[];
}

export interface Finding {
	id: number;
	session_id: number;
	project_id: number;
	zone_id: number;
	source: FindingSource;
	mode: SystemMode;
	track_id: number | null;
	track_key: string | null;
	detected_violation: ViolationType | null;
	violation_type: ViolationType;
	confidence: number | null;
	person_bbox: BBox | null;
	violation_bbox: BBox | null;
	raw_detection: RawDetectionPerson | Record<string, unknown> | null;
	evidence_url: string;
	evidence_sha256: string;
	frame_sequence: number | null;
	frame_width: number;
	frame_height: number;
	model_version: string | null;
	captured_at: string;
	received_at: string;
	verification_status: VerificationStatus;
	verified_by: number | null;
	verified_at: string | null;
	notes: string;
	action_status: ActionStatus;
	action_notes: string;
	version: number;
	created_at: string;
	updated_at: string;
}

export interface FindingFilterParams {
	project_id?: number | null;
	zone_id?: number | null;
	session_id?: number | null;
	violation_type?: ViolationType | '';
	verification_status?: VerificationStatus | '';
	action_status?: ActionStatus | '';
	from?: string;
	to?: string;
	sort?: 'id' | 'captured_at' | '';
	page?: number;
	page_size?: number;
}

export interface ReviewFindingInput {
	version: number;
	verification_status?: 'confirmed' | 'rejected';
	violation_type?: ViolationType;
	notes?: string;
	action_status?: ActionStatus;
	action_notes?: string;
}

export interface CreateManualFindingInput {
	session_id: number;
	violation_type: ViolationType;
	notes: string;
	evidence: File | Blob;
}

export type { Project as ProjectLookup } from '#lib/features/projects/domain';

export type { Zone as ZoneLookup } from '#lib/features/projects/domain';

export type { SessionConfig as SessionConfigLookup } from '#lib/features/monitoring/domain';

export type { MonitoringSession as SessionLookup } from '#lib/features/monitoring/domain';

export interface FindingPageMeta {
	page: number;
	page_size: number;
	total: number;
}

export interface FindingListResult<T> {
	data: T[];
	meta: FindingPageMeta;
}
