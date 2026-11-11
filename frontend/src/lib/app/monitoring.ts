import { projects } from './projects';
import { apiData, apiList } from '#lib/shared/http/client';
import { createMonitoringApi } from '#lib/features/monitoring/infrastructure/http-adapter';
import { createCaptureLoop as capture, type CreateCaptureLoopOptions } from '#lib/features/monitoring/application/capture-workflow';
import { releaseMediaStream } from '#lib/features/monitoring/infrastructure/camera-adapter';
import { classifyMonitoringError } from '#lib/features/monitoring/presentation/errors';
export { DEFAULT_CAMERA_CONSTRAINTS, JPEG_QUALITY, MAX_JPEG_HEIGHT, MAX_JPEG_WIDTH, releaseMediaStream, requestUserCameraStream, sampleVideoElementJpeg, SERVER_IDLE_TIMEOUT_SECONDS, TARGET_SAMPLE_FPS } from '#lib/features/monitoring/infrastructure/camera-adapter';
export const monitoringApi = {
	...createMonitoringApi({ apiData, apiList }),
	async listActiveProjects() { return (await projects.listProjects({ status: 'active', page: 1, page_size: 100 })).data; },
	async listActiveZones(projectId: number) { return (await projects.listZones(projectId, { status: 'active', page: 1, page_size: 100 })).data; }
};
export function createCaptureLoop(options: Omit<CreateCaptureLoopOptions, 'releaseCamera' | 'revokeObjectUrl' | 'classifyError' | 'createAbortController' | 'schedule' | 'nowMonotonicMs' | 'nowUtcIso'> & {
	stream: MediaStream | null; videoEl?: HTMLVideoElement | null;
	nowMonotonicMs?: () => number; nowUtcIso?: () => string;
}) {
	return capture({
		...options, releaseCamera: () => releaseMediaStream(options.stream, options.videoEl),
		revokeObjectUrl: (url) => URL.revokeObjectURL(url), classifyError: classifyMonitoringError,
		createAbortController: () => new AbortController(), nowMonotonicMs: options.nowMonotonicMs ?? (() => performance.now()),
		nowUtcIso: options.nowUtcIso ?? (() => new Date().toISOString()),
		schedule: (callback, ms) => { const id = setInterval(callback, ms); return () => clearInterval(id); }
	});
}
