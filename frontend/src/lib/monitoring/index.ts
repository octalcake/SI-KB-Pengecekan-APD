export {
	classifyMonitoringError,
	computeAspectPreservingSize,
	createMonitoringApi,
	scaleNormalizedBBox,
	shouldStopSamplingOnError,
	type MonitoringApi,
	type MonitoringHttpClient
} from './api.ts';

export {
	createCaptureLoop,
	DEFAULT_CAMERA_CONSTRAINTS,
	JPEG_QUALITY,
	MAX_JPEG_HEIGHT,
	MAX_JPEG_WIDTH,
	releaseMediaStream,
	requestUserCameraStream,
	sampleVideoElementJpeg,
	SERVER_IDLE_TIMEOUT_SECONDS,
	TARGET_SAMPLE_FPS,
	type CaptureLoopState,
	type CaptureTickResult,
	type CreateCaptureLoopOptions,
	type SampledJpegFrame
} from './capture.ts';

export type {
	CapturedEventItem,
	FrameEvent,
	FrameResult,
	InferredSnapshot,
	MasterStatus,
	MonitoringErrorState,
	MonitoringProject,
	MonitoringSession,
	MonitoringZone,
	NormalizedBBox,
	PPEObservation,
	PPEState,
	SendFrameInput,
	SessionConfig,
	SessionSource,
	SessionStatus,
	StartSessionInput,
	StopReason,
	SystemMode,
	TrackView,
	ViolationType
} from './types.ts';

export { default as MonitoringView } from './MonitoringView.svelte';
export { default as SnapshotOverlay } from './SnapshotOverlay.svelte';

