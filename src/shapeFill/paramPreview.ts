import { FillParams, ShapeDefinition, ShapeFillId } from './types';
import { clamp } from './utils/math';
import { createRng, hashPoints, hashString, resolveSeedWithFallback } from './utils/random';
import { pointInPolygon } from './utils/geometry';
import { generateOrganicContourLines } from './utils/contourField';
import { MIN_LINE_SPACING, MAX_LINE_SPACING } from '@/utils/contourLines';

export type PreviewRenderer = (
  ctx: CanvasRenderingContext2D,
  shape: ShapeDefinition,
  param: keyof FillParams,
  value: number,
  sessionParams?: Partial<FillParams>,
  strategyDefaults?: FillParams
) => void;

export const defaultPreviewRenderer: PreviewRenderer = (ctx, shape, param, value) => {
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.strokeStyle = '#999';
  ctx.setLineDash([4, 4]);

  switch (param) {
    case 'spacing':
      ctx.beginPath();
      ctx.arc(shape.centroid.x, shape.centroid.y, value, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'rotation': {
      const length = 80;
      const rad = (value * Math.PI) / 180;
      const { x, y } = shape.centroid;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(rad) * length, y + Math.sin(rad) * length);
      ctx.stroke();
      break;
    }
    default:
      break;
  }

  ctx.restore();
};

const previewRegistry = new Map<ShapeFillId, PreviewRenderer>();

export function registerPreviewRenderer(fillId: ShapeFillId, renderer: PreviewRenderer): void {
  previewRegistry.set(fillId, renderer);
}

export function getPreviewRenderer(fillId: ShapeFillId): PreviewRenderer {
  return previewRegistry.get(fillId) ?? defaultPreviewRenderer;
}

registerPreviewRenderer('hatch', defaultPreviewRenderer);

registerPreviewRenderer('contour', (ctx, shape, param, value, sessionParams, strategyDefaults) => {
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setLineDash([]);

  const baseSpacing =
    typeof sessionParams?.spacing === 'number'
      ? sessionParams.spacing
      : strategyDefaults?.spacing ?? 12;
  const spacing = clamp(
    param === 'spacing' && typeof value === 'number' ? value : baseSpacing,
    MIN_LINE_SPACING,
    MAX_LINE_SPACING
  );
  const baseVariance =
    typeof sessionParams?.variance === 'number'
      ? sessionParams.variance
      : strategyDefaults?.variance ?? 0.3;
  const variance = clamp(
    param === 'variance' && typeof value === 'number' ? value : baseVariance,
    0,
    1
  );
  const baseSpacingWobble =
    typeof sessionParams?.spacingWobble === 'number'
      ? sessionParams.spacingWobble
      : strategyDefaults?.spacingWobble ?? baseVariance;
  const spacingWobble = clamp(
    param === 'spacingWobble' && typeof value === 'number' ? value : baseSpacingWobble,
    0,
    1
  );
  const seedCandidate =
    (sessionParams?.seed as number | undefined) ??
    (strategyDefaults?.seed as number | undefined);
  const shapeSalt = shape.id ? hashString(shape.id) : 0;
  const seed = resolveSeedWithFallback(shape.points, seedCandidate, {
    treatZeroAsUndefined: true,
    shapeSalt,
  });

  const lines = generateOrganicContourLines(shape.points, {
    spacing,
    variance,
    seed,
    spacingWobble,
  });

  ctx.strokeStyle = '#5f5f5f';
  ctx.lineWidth = 1;
  if (shape.points.length >= 3) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    for (let i = 1; i < shape.points.length; i += 1) {
      ctx.lineTo(shape.points[i].x, shape.points[i].y);
    }
    ctx.closePath();
    ctx.clip();
  }

  const maxLines = Math.min(lines.length, 8);
  for (let i = 0; i < maxLines; i += 1) {
    const line = lines[i];
    if (line.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(line[0].x, line[0].y);
    for (let j = 1; j < line.length; j += 1) {
      ctx.lineTo(line[j].x, line[j].y);
    }
    ctx.stroke();
  }

  if (shape.points.length >= 3) {
    ctx.restore();
  }

  ctx.restore();
});

const STIPPLE_PREVIEW_DEFAULT_SPACING = 12;
const STIPPLE_PREVIEW_DEFAULT_WOBBLE = 0.45;

registerPreviewRenderer('stipple', (ctx, shape, param, value) => {
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#555';
  ctx.setLineDash([]);

  const spacing = Math.max(
    2,
    param === 'spacing' && typeof value === 'number' ? value : STIPPLE_PREVIEW_DEFAULT_SPACING
  );
  const wobble = clamp(
    param === 'wobble' && typeof value === 'number' ? value : STIPPLE_PREVIEW_DEFAULT_WOBBLE,
    0,
    1
  );

  const jitterExtent = spacing * (0.18 + wobble * 0.8);
  const step = Math.max(4, spacing * (0.65 + (1 - wobble) * 0.35));
  const maxDots = 320;
  const bounds = shape.bounds;
  const rng = createRng(hashPoints(shape.points) ^ (param === 'wobble' ? 0x9e3779b1 : 0));

  let rendered = 0;
  for (let x = bounds.minX; x <= bounds.maxX && rendered < maxDots; x += step) {
    for (let y = bounds.minY; y <= bounds.maxY && rendered < maxDots; y += step) {
      const base = {
        x: x + step * 0.5,
        y: y + step * 0.5,
      };
      const sample = jitterPreviewPoint(base, jitterExtent, rng);
      if (!pointInPolygon(sample, shape.points)) {
        continue;
      }
      rendered += 1;
      const radius = 1 + (rng() - 0.5) * wobble * 0.9;
      ctx.beginPath();
      ctx.arc(sample.x, sample.y, Math.max(0.8, radius), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
});

function jitterPreviewPoint(anchor: { x: number; y: number }, extent: number, rng: () => number) {
  if (extent <= 0) {
    return anchor;
  }
  const theta = rng() * Math.PI * 2;
  const distance = Math.pow(rng(), 0.65) * extent;
  return {
    x: anchor.x + Math.cos(theta) * distance,
    y: anchor.y + Math.sin(theta) * distance,
  };
}
