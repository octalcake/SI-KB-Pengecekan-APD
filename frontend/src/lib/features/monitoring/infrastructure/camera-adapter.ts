import { computeAspectPreservingSize } from '../domain/geometry';
import type { SampledJpegFrame } from '../application/capture-workflow';
/**
 * SRS §6.1: Browser requests video only (no audio) with ideal 640x480.
 */
export const DEFAULT_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
	video: {
		width: { ideal: 640 },
		height: { ideal: 480 }
	},
	audio: false
};

export const JPEG_QUALITY = 0.7;
export const MAX_JPEG_WIDTH = 640;
export const MAX_JPEG_HEIGHT = 480;
export const TARGET_SAMPLE_FPS = 1;
export const SERVER_IDLE_TIMEOUT_SECONDS = 15;

/**
 * Requests user-initiated camera access with video-only constraints (SRS §6.1).
 */
export async function requestUserCameraStream(
	mediaDevices: MediaDevices | undefined = typeof navigator !== 'undefined'
		? navigator.mediaDevices
		: undefined
): Promise<MediaStream> {
	if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
		throw {
			status: 0,
			code: 'CAMERA_UNSUPPORTED',
			message:
				'Kamera belum bisa diakses. Buka aplikasi lewat HTTPS di browser terbaru, lalu coba lagi.'
		};
	}

	try {
		return await mediaDevices.getUserMedia(DEFAULT_CAMERA_CONSTRAINTS);
	} catch (err) {
		const domErr = err as { name?: string; message?: string };
		const name = domErr?.name ?? '';
		if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
			throw {
				status: 0,
				code: 'CAMERA_DENIED',
				message: 'Izinkan akses kamera di pengaturan browser, lalu mulai inspeksi lagi.'
			};
		}
		if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
			throw {
				status: 0,
				code: 'CAMERA_NOT_FOUND',
				message: 'Kamera tidak ditemukan. Periksa sambungan kamera, lalu coba lagi.'
			};
		}
		if (name === 'NotReadableError' || name === 'TrackStartError') {
			throw {
				status: 0,
				code: 'CAMERA_DEVICE_BUSY',
				message:
					'Kamera belum bisa dipakai. Tutup aplikasi lain yang memakai kamera, lalu coba lagi.'
			};
		}
		throw {
			status: 0,
			code: 'CAMERA_ERROR',
			message: 'Kamera belum bisa dibuka. Periksa kamera dan izinnya, lalu coba lagi.'
		};
	}
}

/**
 * Releases all media tracks immediately and detaches any bound video element.
 */
export function releaseMediaStream(
	stream: MediaStream | null | undefined,
	videoEl?: HTMLVideoElement | null
): void {
	if (stream) {
		for (const track of stream.getTracks()) {
			try {
				track.stop();
			} catch {
				// ignore track stop errors
			}
		}
	}
	if (videoEl) {
		try {
			videoEl.pause();
			videoEl.srcObject = null;
		} catch {
			// ignore video element detach errors
		}
	}
}

/**
 * Samples a single aspect-preserving JPEG (max 640x480, quality 0.7) from a live HTMLVideoElement.
 * Preview mirroring never alters the sampled evidence coordinates.
 */
export async function sampleVideoElementJpeg(
	videoEl: HTMLVideoElement,
	canvasEl?: HTMLCanvasElement
): Promise<SampledJpegFrame> {
	const rawWidth = videoEl.videoWidth || MAX_JPEG_WIDTH;
	const rawHeight = videoEl.videoHeight || MAX_JPEG_HEIGHT;
	const { width, height } = computeAspectPreservingSize(
		rawWidth,
		rawHeight,
		MAX_JPEG_WIDTH,
		MAX_JPEG_HEIGHT
	);

	const canvas = canvasEl ?? document.createElement('canvas');
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;

	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw {
			status: 0,
			code: 'CANVAS_UNAVAILABLE',
			message: 'Browser belum bisa mengambil foto. Muat ulang halaman, lalu coba lagi.'
		};
	}

	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.drawImage(videoEl, 0, 0, width, height);
	ctx.restore();

	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(b) => {
				if (b) {
					resolve(b);
				} else {
					reject({
						status: 0,
						code: 'JPEG_ENCODE_FAILED',
						message: 'Foto belum bisa diproses. Mulai inspeksi lagi.'
					});
				}
			},
			'image/jpeg',
			JPEG_QUALITY
		);
	});

	const objectUrl =
		typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
			? URL.createObjectURL(blob)
			: '';

	return {
		blob,
		width,
		height,
		objectUrl
	};
}
