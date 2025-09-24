import { resolveCoordinateSnap, isPointInPolygonSDF } from './common';
import type { FlowFillParams, Point } from './types';

type GradientSample = { gx: number; gy: number; magnitude: number };

type SignedDistanceField = FlowFillParams['dependencies']['createSignedDistanceField'] extends (
  vertices: Point[],
  canvasWidth: number,
  canvasHeight: number,
  resolution?: number
) => infer R
  ? R
  : never;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const createRandomGenerator = (seed?: number) => {
  if (seed == null) {
    return Math.random;
  }
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const computePolygonBounds = (vertices: Point[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const vertex of vertices) {
    if (vertex.x < minX) minX = vertex.x;
    if (vertex.y < minY) minY = vertex.y;
    if (vertex.x > maxX) maxX = vertex.x;
    if (vertex.y > maxY) maxY = vertex.y;
  }

  return { minX, minY, maxX, maxY };
};

const buildGradientSampler = (fieldData: SignedDistanceField) => {
  const { field, cols, rows, resolution, extension } = fieldData;
  const gradX: number[][] = new Array(rows);
  const gradY: number[][] = new Array(rows);

  for (let y = 0; y < rows; y++) {
    gradX[y] = new Array(cols);
    gradY[y] = new Array(cols);
    for (let x = 0; x < cols; x++) {
      const left = field[y][x > 0 ? x - 1 : x];
      const right = field[y][x < cols - 1 ? x + 1 : x];
      const top = field[y > 0 ? y - 1 : y][x];
      const bottom = field[y < rows - 1 ? y + 1 : y][x];

      const denomX = x > 0 && x < cols - 1 ? 2 : 1;
      const denomY = y > 0 && y < rows - 1 ? 2 : 1;
      gradX[y][x] = (right - left) / (denomX * resolution);
      gradY[y][x] = (bottom - top) / (denomY * resolution);
    }
  }

  const originX = -extension;
  const originY = -extension;

  return (x: number, y: number): GradientSample => {
    const gx = clamp((x - originX) / resolution, 0, cols - 1);
    const gy = clamp((y - originY) / resolution, 0, rows - 1);

    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = clamp(x0 + 1, 0, cols - 1);
    const y1 = clamp(y0 + 1, 0, rows - 1);
    const tx = gx - x0;
    const ty = gy - y0;

    const g00x = gradX[y0][x0];
    const g01x = gradX[y1][x0];
    const g10x = gradX[y0][x1];
    const g11x = gradX[y1][x1];
    const g00y = gradY[y0][x0];
    const g01y = gradY[y1][x0];
    const g10y = gradY[y0][x1];
    const g11y = gradY[y1][x1];

    const interpX =
      g00x * (1 - tx) * (1 - ty) +
      g10x * tx * (1 - ty) +
      g01x * (1 - tx) * ty +
      g11x * tx * ty;
    const interpY =
      g00y * (1 - tx) * (1 - ty) +
      g10y * tx * (1 - ty) +
      g01y * (1 - tx) * ty +
      g11y * tx * ty;

    const magnitude = Math.hypot(interpX, interpY);
    return { gx: interpX, gy: interpY, magnitude };
  };
};

const tracePolygonPath = (ctx: CanvasRenderingContext2D, vertices: Point[], snap: (value: number) => number) => {
  ctx.beginPath();
  ctx.moveTo(snap(vertices[0].x), snap(vertices[0].y));
  for (let i = 1; i < vertices.length; i++) {
    ctx.lineTo(snap(vertices[i].x), snap(vertices[i].y));
  }
  ctx.closePath();
};

export const drawFlowFill = ({
  ctx,
  vertices,
  brushSettings,
  dependencies,
  seedSpacing,
  stepSize,
  maxSteps,
  useOrthogonal,
  fieldResolution,
  randomSeed,
  strokeColorOverride,
  isPreview = false,
}: FlowFillParams): void => {
  if (vertices.length < 3) {
    return;
  }

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const snap = resolveCoordinateSnap(pixelMode);
  const lineWidth = Math.max(0.2, brushSettings.shapeFillLineWidth ?? 1);
  const strokeColor = strokeColorOverride ?? brushSettings.color ?? '#000000';

  const baseSeedSpacing = seedSpacing ?? brushSettings.flowSeedSpacing ?? 18;
  const baseStepSize = stepSize ?? brushSettings.flowStepSize ?? 4;
  const baseMaxSteps = maxSteps ?? brushSettings.flowMaxSteps ?? 120;
  const orthogonal = useOrthogonal ?? brushSettings.flowUseOrthogonal ?? false;
  const sdfResolution = fieldResolution ?? brushSettings.flowFieldResolution ?? 8;

  if (baseSeedSpacing <= 0 || baseStepSize <= 0 || baseMaxSteps <= 0) {
    return;
  }

  const spacing = isPreview ? baseSeedSpacing * 1.5 : baseSeedSpacing;
  const step = Math.max(0.1, baseStepSize);
  const totalSteps = Math.max(1, Math.floor(isPreview ? baseMaxSteps * 0.6 : baseMaxSteps));
  const seedJitter = 0.6;

  const field = dependencies.createSignedDistanceField(vertices, ctx.canvas.width, ctx.canvas.height, sdfResolution);
  if (!field.field.length) {
    return;
  }

  const sampleGradient = buildGradientSampler(field);
  const rng = createRandomGenerator(randomSeed);
  const bounds = computePolygonBounds(vertices);
  const padding = Math.max(spacing * 0.5, step * 2);
  const minX = bounds.minX - padding;
  const minY = bounds.minY - padding;
  const maxX = bounds.maxX + padding;
  const maxY = bounds.maxY + padding;

  ctx.save();
  ctx.globalAlpha = brushSettings.opacity;
  ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
  ctx.imageSmoothingEnabled = !pixelMode;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  tracePolygonPath(ctx, vertices, snap);
  ctx.clip('nonzero');

  const integrate = (start: Point, direction: number) => {
    const points: Point[] = [];
    let currentX = start.x;
    let currentY = start.y;

    for (let stepIndex = 0; stepIndex < totalSteps; stepIndex++) {
      if (!isPointInPolygonSDF({ x: currentX, y: currentY }, vertices)) {
        break;
      }

      const { gx, gy, magnitude } = sampleGradient(currentX, currentY);
      if (magnitude < 1e-5) {
        break;
      }

      let vx = gx;
      let vy = gy;
      if (orthogonal) {
        const temp = vx;
        vx = -vy;
        vy = temp;
      }

      const length = Math.hypot(vx, vy) || 1e-6;
      vx /= length;
      vy /= length;

      currentX += direction * vx * step;
      currentY += direction * vy * step;

      if (!isPointInPolygonSDF({ x: currentX, y: currentY }, vertices)) {
        break;
      }

      points.push({ x: currentX, y: currentY });
    }

    return points;
  };

  for (let y = minY; y <= maxY; y += spacing) {
    for (let x = minX; x <= maxX; x += spacing) {
      const jitterX = (rng() - 0.5) * spacing * seedJitter;
      const jitterY = (rng() - 0.5) * spacing * seedJitter;
      const seedX = x + jitterX;
      const seedY = y + jitterY;

      if (!isPointInPolygonSDF({ x: seedX, y: seedY }, vertices)) {
        continue;
      }

      const forward = integrate({ x: seedX, y: seedY }, 1);
      const backward = integrate({ x: seedX, y: seedY }, -1);
      const path = backward.reverse().concat([{ x: seedX, y: seedY }], forward);

      if (path.length < 2) {
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(snap(path[0].x), snap(path[0].y));
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(snap(path[i].x), snap(path[i].y));
      }
      ctx.stroke();
    }
  }

  ctx.restore();
};

export type { FlowFillParams as DrawFlowFillParams };
