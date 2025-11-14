import { bresenhamLine } from '@/lib/brush/algorithms';
import { snapPointToPixel } from '@/utils/pixelSharp';
import type { FillResult, FillStrokeSegment, Vec2 } from './types';

type PixelPerfectOptions = {
  pixelSize?: number;
};

const DEFAULT_PIXEL_SIZE = 1;

export function toPixelPerfectFill(result: FillResult, options: PixelPerfectOptions = {}): FillResult {
  const pixelSize = options.pixelSize ?? DEFAULT_PIXEL_SIZE;
  const snapPolygon = (polygon: Vec2[]): Vec2[] =>
    polygon.map(point => snapPointToPixel(point, { strategy: 'nearest' }));

  const snappedClipPath = result.clipPath ? snapPolygon(result.clipPath) : undefined;
  const polygonList = result.polygons ? result.polygons.map(snapPolygon) : undefined;

  const dotInstances: NonNullable<FillResult['dotInstances']> = [
    ...convertStrokeSegmentsToDots(result.strokeSegments, pixelSize),
    ...convertLinesToDots(result.lines, pixelSize),
    ...snapDotInstances(result.dotInstances, pixelSize),
    ...convertDotsToInstances(result.dots, pixelSize, result.dotRadius),
  ];

  return {
    ...result,
    strokeSegments: undefined,
    lines: undefined,
    polygons: polygonList,
    dots: undefined,
    dotInstances,
    clipPath: snappedClipPath,
    lineWidth: 1,
    dotRadius: pixelSize * 0.5,
  };
}

const convertStrokeSegmentsToDots = (
  segments: FillStrokeSegment[] | undefined,
  pixelSize: number
): NonNullable<FillResult['dotInstances']> => {
  if (!segments || segments.length === 0) {
    return [];
  }
  const points = new Map<string, Vec2>();
  segments.forEach(segment => {
    for (let i = 0; i < segment.points.length - 1; i += 1) {
      const current = segment.points[i];
      const next = segment.points[i + 1];
      emitLinePixels(current, next, points);
    }
  });
  return buildDotInstances(points, pixelSize);
};

const convertLinesToDots = (lines: Vec2[][] | undefined, pixelSize: number) => {
  if (!lines || lines.length === 0) {
    return [];
  }
  const points = new Map<string, Vec2>();
  lines.forEach(line => {
    for (let i = 0; i < line.length - 1; i += 1) {
      emitLinePixels(line[i], line[i + 1], points);
    }
  });
  return buildDotInstances(points, pixelSize);
};

const snapDotInstances = (
  instances: FillResult['dotInstances'],
  pixelSize: number
): NonNullable<FillResult['dotInstances']> => {
  if (!instances || instances.length === 0) {
    return [];
  }
  return instances.map(instance => {
    const snappedCenter = snapPointToPixel(instance.center, { strategy: 'center' });
    return {
      ...instance,
      center: snappedCenter,
      radius: pixelSize * 0.5,
      size: pixelSize,
      shape: 'square',
    };
  });
};

const convertDotsToInstances = (
  dots: Vec2[] | undefined,
  pixelSize: number,
  dotRadius: number | undefined
): NonNullable<FillResult['dotInstances']> => {
  if (!dots || dots.length === 0) {
    return [];
  }
  const radius = dotRadius ?? pixelSize * 0.5;
  return dots.map(dot => {
    const center = snapPointToPixel(dot, { strategy: 'center' });
    return {
      center,
      radius,
      size: pixelSize,
      shape: 'square',
    };
  });
};

const emitLinePixels = (start: Vec2, end: Vec2, target: Map<string, Vec2>): void => {
  const pixels = bresenhamLine(Math.round(start.x), Math.round(start.y), Math.round(end.x), Math.round(end.y));
  pixels.forEach(pixel => {
    const key = `${pixel.x},${pixel.y}`;
    if (!target.has(key)) {
      target.set(key, pixel);
    }
  });
};

const buildDotInstances = (points: Map<string, Vec2>, pixelSize: number) => {
  if (points.size === 0) {
    return [];
  }
  const radius = pixelSize * 0.5;
  return Array.from(points.values()).map(point => {
    const center = {
      x: point.x + 0.5,
      y: point.y + 0.5,
    };
    return {
      center,
      radius,
      size: pixelSize,
      shape: 'square' as const,
    };
  });
};
