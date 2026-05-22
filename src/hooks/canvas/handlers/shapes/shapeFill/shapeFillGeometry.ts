import { snapPointToPixel } from '@/utils/pixelSharp';

export type ShapeFillPoint = { x: number; y: number };

export type ShapeFillBoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type ShapeFillRoi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const SHAPE_FILL_ROI_PADDING = 8;

export const computeShapeFillBoundingBox = (
  points: ShapeFillPoint[]
): ShapeFillBoundingBox | null => {
  if (points.length === 0) {
    return null;
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  return { minX, minY, maxX, maxY };
};

export const shapeFillBoundingBoxToRoi = (
  bbox: ShapeFillBoundingBox | null,
  project: { width: number; height: number } | null | undefined
): ShapeFillRoi | undefined => {
  if (!bbox || !project) {
    return undefined;
  }

  const x = Math.max(0, Math.floor(Math.min(bbox.minX, bbox.maxX)) - SHAPE_FILL_ROI_PADDING);
  const y = Math.max(0, Math.floor(Math.min(bbox.minY, bbox.maxY)) - SHAPE_FILL_ROI_PADDING);
  const right = Math.min(
    project.width,
    Math.ceil(Math.max(bbox.minX, bbox.maxX)) + SHAPE_FILL_ROI_PADDING
  );
  const bottom = Math.min(
    project.height,
    Math.ceil(Math.max(bbox.minY, bbox.maxY)) + SHAPE_FILL_ROI_PADDING
  );
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);

  return { x, y, width, height };
};

export const getShapeFillPolygonForMode = (
  points: ShapeFillPoint[],
  pixelPerfect: boolean
): ShapeFillPoint[] => {
  if (!pixelPerfect) {
    return points;
  }

  return points.map((point) => {
    const snapped = snapPointToPixel(point, { strategy: 'nearest' });
    return { x: snapped.x, y: snapped.y };
  });
};

export const getShapeFillRenderBounds = (
  fallbackBounds: ShapeFillBoundingBox,
  polygonPoints: ShapeFillPoint[],
  pixelPerfect: boolean
): ShapeFillBoundingBox => {
  if (!pixelPerfect || polygonPoints.length === 0) {
    return fallbackBounds;
  }

  return computeShapeFillBoundingBox(polygonPoints) ?? fallbackBounds;
};

export const hasVisibleShapeFillOverlayPixels = (
  canvas: HTMLCanvasElement,
  roi?: ShapeFillRoi
): boolean => {
  const ctx = canvas.getContext('2d', {
    willReadFrequently: true,
    alpha: true,
  } as CanvasRenderingContext2DSettings);

  if (!ctx || canvas.width <= 0 || canvas.height <= 0) {
    return false;
  }

  const x = Math.max(0, Math.floor(roi?.x ?? 0));
  const y = Math.max(0, Math.floor(roi?.y ?? 0));
  const right = Math.min(canvas.width, Math.ceil((roi?.x ?? 0) + (roi?.width ?? canvas.width)));
  const bottom = Math.min(canvas.height, Math.ceil((roi?.y ?? 0) + (roi?.height ?? canvas.height)));
  const width = right - x;
  const height = bottom - y;

  if (width <= 0 || height <= 0) {
    return false;
  }

  const data = ctx.getImageData(x, y, width, height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) {
      return true;
    }
  }

  return false;
};
