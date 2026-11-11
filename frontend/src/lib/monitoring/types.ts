/**
 * Domain types and API contracts for Monitoring & Browser Capture (SRS §5.4, §6, §8.3, §9.5).
 */

export type SystemMode = 'real' | 'simulated' | 'manual';

export type ViolationType = 'NO_HELMET' | 'NO_VEST';

export type MasterStatus = 'active' | 'archived';

export type SessionStatus = 'active' | 'stopped' | 'interrupted';

export type SessionSource = 'browser_webcam' | 'manual_entry';

export type StopReason = 'user_stop' | 'page_hidden';

export type PPEState = 'positive' | 'negative' | 'unknown';

export type NormalizedBBox = [number, number, number, number];

export interface MonitoringProject {
	id: number;
	name: string;
	location: string;
	description: string;
	status: MasterStatus;
	version: number;
	created_at: string;
	updated_at: string;
}

export interface MonitoringZone {
	id: number;
	project_id: number;
	name: string;
	description: string;
	status: MasterStatus;
	version: number;
	created_at: string;
	updated_at: string;
}

export interface SessionConfig {
	sample_fps: number;
	confirm_hits: number;
	confirm_max_frames: number;
	confirm_window_ms: number;
	track_timeout_ms: number;
	supported_violations?: ViolationType[];
}

export interface MonitoringSession {
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
	config: SessionConfig;
}

export interface PPEObservation {
	type: ViolationType;
	state: PPEState;
	confidence: number | null;
	bbox: NormalizedBBox | null;
}

export interface TrackView {
	track_id: number;
	track_key: string;
	person_confidence: number;
	person_bbox: NormalizedBBox;
	observations: PPEObservation[];
}

export interface FrameEvent {
	type: 'finding_created' | string;
	finding_id: number;
	verification_status: 'pending' | 'confirmed' | 'rejected';
	evidence_url: string;
}

export interface FrameResult {
	session_id: number;
	frame_sequence: number;
	captured_at: string;
	received_at: string;
	width: number;
	height: number;
	inference_ms: number;
	model_version: string;
	mode: SystemMode;
	tracks: TrackView[];
	events: FrameEvent[];
}

export interface StartSessionInput {
	project_id: number;
	zone_id: number;
	source?: SessionSource;
}

export interface SendFrameInput {
	sessionId: number;
	sequence: number;
	capturedAtUtc: string;
	sampleElapsedMs: number;
	jpeg: Blob | Uint8Array | ArrayBuffer;
	signal?: AbortSignal;
}

export interface InferredSnapshot {
	sequence: number;
	capturedAtUtc: string;
	receivedAtUtc: string;
	completedAtMonotonicMs: number;
	jpegUrl: string;
	width: number;
	height: number;
	inferenceMs: number;
	modelVersion: string;
	mode: SystemMode;
	tracks: TrackView[];
	events: FrameEvent[];
}

export interface CapturedEventItem {
	findingId: number;
	sessionId: number;
	sequence: number;
	capturedAtUtc: string;
	evidenceUrl: string;
	verificationStatus: 'pending' | 'confirmed' | 'rejected';
	mode: SystemMode;
}

export interface MonitoringErrorState {
	code: string;
	title: string;
	message: string;
	status: number;
	requestId: string | null;
	retryAfterSec: number | null;
	terminal: boolean;
	recoveryHint: string;
}
