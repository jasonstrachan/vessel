import type { BrushSettings } from '@/types';
import { BrushShape } from '@/types';

export type BoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type CaptureRegion = { x: number; y: number; width: number; height: number };

export const createBoundingBox = (point: { x: number; y: number }): BoundingBox => ({
  minX: point.x,
  minY: point.y,
  maxX: point.x,
  maxY: point.y,
});

export const expandBoundingBox = (bbox: BoundingBox, point: { x: number; y: number }): BoundingBox => ({
  minX: Math.min(bbox.minX, point.x),
  minY: Math.min(bbox.minY, point.y),
  maxX: Math.max(bbox.maxX, point.x),
  maxY: Math.max(bbox.maxY, point.y),
});

export const mergeBoundingBox = (bbox: BoundingBox | null, point: { x: number; y: number }): BoundingBox =>
  bbox ? expandBoundingBox(bbox, point) : createBoundingBox(point);

export const boundingBoxToCaptureRegion = (
  bbox: BoundingBox | null,
  padding: number,
  project: { width: number; height: number } | null
): CaptureRegion | undefined => {
  if (!bbox || !project) {
    return undefined;
  }
  const minX = Math.min(bbox.minX, bbox.maxX);
  const maxX = Math.max(bbox.minX, bbox.maxX);
  const minY = Math.min(bbox.minY, bbox.maxY);
  const maxY = Math.max(bbox.minY, bbox.maxY);
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return undefined;
  }
  const pad = Math.max(0, padding);
  const x = Math.max(0, Math.floor(minX) - pad);
  const y = Math.max(0, Math.floor(minY) - pad);
  const right = Math.min(project.width, Math.ceil(maxX) + pad);
  const bottom = Math.min(project.height, Math.ceil(maxY) + pad);
  if (right <= x || bottom <= y) {
    return undefined;
  }
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
};

export const rectToCaptureRegion = (
  rect: { x: number; y: number; width: number; height: number } | null | undefined,
  padding: number,
  project: { width: number; height: number } | null
): CaptureRegion | undefined => {
  if (!rect || !project) {
    return undefined;
  }
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return undefined;
  }
  const paddedX = rect.x - padding;
  const paddedY = rect.y - padding;
  const paddedRight = rect.x + rect.width + padding;
  const paddedBottom = rect.y + rect.height + padding;
  const x = Math.max(0, Math.floor(paddedX));
  const y = Math.max(0, Math.floor(paddedY));
  const right = Math.min(project.width, Math.ceil(paddedRight));
  const bottom = Math.min(project.height, Math.ceil(paddedBottom));
  if (right <= x || bottom <= y) {
    return undefined;
  }
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  };
};

export const unionCaptureRegions = (
  first?: CaptureRegion | null,
  second?: CaptureRegion | null
): CaptureRegion | undefined => {
  const a = first ?? null;
  const b = second ?? null;
  if (!a && !b) {
    return undefined;
  }
  if (!a) {
    return b ?? undefined;
  }
  if (!b) {
    return a;
  }
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
};

export const captureRegionFromPoints = (
  points: Array<{ x: number; y: number }> | undefined,
  padding: number,
  project: { width: number; height: number } | null
): CaptureRegion | undefined => {
  if (!points || points.length === 0) {
    return undefined;
  }
  let bbox = createBoundingBox(points[0]);
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (!point) {
      continue;
    }
    bbox = expandBoundingBox(bbox, point);
  }
  return boundingBoxToCaptureRegion(bbox, padding, project);
};

export const shouldPixelAlignBrush = (settings: BrushSettings | null | undefined): boolean => {
  if (!settings) {
    return false;
  }
  if (settings.brushShape === BrushShape.PIXEL_ROUND || settings.brushShape === BrushShape.PIXEL_DITHER) {
    return true;
  }
  return settings.brushShape === BrushShape.SQUARE && settings.antialiasing === false;
};

export const alignPointToPixel = <T extends { x: number; y: number }>(
  point: T,
  shouldAlign: boolean
): T => {
  if (!shouldAlign) {
    return point;
  }
  const alignedX = Math.round(point.x);
  const alignedY = Math.round(point.y);
  if (alignedX === point.x && alignedY === point.y) {
    return point;
  }
  return { ...point, x: alignedX, y: alignedY };
};
