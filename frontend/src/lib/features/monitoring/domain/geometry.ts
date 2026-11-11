import type { NormalizedBBox } from './types';
/**
 * Computes aspect-preserving dimensions bounded by maxWidth and maxHeight (SRS §6.1: max 640x480).
 */
export function computeAspectPreservingSize(
	sourceWidth: number,
	sourceHeight: number,
	maxWidth = 640,
	maxHeight = 480
): { width: number; height: number } {
	const safeW = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : maxWidth;
	const safeH = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : maxHeight;
	const scale = Math.min(1, maxWidth / safeW, maxHeight / safeH);
	const width = Math.max(1, Math.round(safeW * scale));
	const height = Math.max(1, Math.round(safeH * scale));
	return { width, height };
}

/**
 * Converts normalized [x_min, y_min, x_max, y_max] (0..1) on the original sampled JPEG
 * into pixel coordinates for an overlay matching the exact inferred snapshot aspect ratio (SRS §9.5).
 */
export function scaleNormalizedBBox(
	bbox: NormalizedBBox,
	displayWidth: number,
	displayHeight: number
): { left: number; top: number; width: number; height: number } {
	const [xMin, yMin, xMax, yMax] = bbox;
	const clampedXMin = Math.max(0, Math.min(1, xMin));
	const clampedYMin = Math.max(0, Math.min(1, yMin));
	const clampedXMax = Math.max(clampedXMin, Math.min(1, xMax));
	const clampedYMax = Math.max(clampedYMin, Math.min(1, yMax));

	return {
		left: clampedXMin * displayWidth,
		top: clampedYMin * displayHeight,
		width: (clampedXMax - clampedXMin) * displayWidth,
		height: (clampedYMax - clampedYMin) * displayHeight
	};
}
