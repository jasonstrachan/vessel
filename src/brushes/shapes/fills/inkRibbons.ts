import { clamp } from '@/utils/num';
import { resolveCoordinateSnap, isPointInPolygonSDF } from './common';
import type { InkRibbonsFillParams, Point } from './types';

type GradientSample = { gx: number; gy: number };

type SignedDistanceField = InkRibbonsFillParams['dependencies']['createSignedDistanceField'] extends (
  vertices: Point[],
  canvasWidth: number,
  canvasHeight: number,
  resolution?: number
) => infer R
  ? R
  : never;

const clamp01 = (value: number): number => clamp(Number.isFinite(value) ? value : 0, 0, 1);

const clampInt = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  const rounded = Math.round(value);
  return clamp(rounded, min, max);
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

const createRandomGenerator = (seed: number) => {
  let state = seed >>> 0;
  if (state === 0) {
    state = 0x6d2b79f5;
  }
  return () => {
    state = Math.imul(state, 1664525) + 1013904223;
    return ((state >>> 8) & 0x00ffffff) / 0x00ffffff;
  };
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

    return { gx: interpX, gy: interpY };
  };
};

const buildDistanceSampler = (fieldData: SignedDistanceField) => {
  const { field, cols, rows, resolution, extension } = fieldData;
  const originX = -extension;
  const originY = -extension;

  return (x: number, y: number): number => {
    const gx = clamp((x - originX) / resolution, 0, cols - 1);
    const gy = clamp((y - originY) / resolution, 0, rows - 1);

    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = clamp(x0 + 1, 0, cols - 1);
    const y1 = clamp(y0 + 1, 0, rows - 1);
    const tx = gx - x0;
    const ty = gy - y0;

    const f00 = field[y0][x0];
    const f01 = field[y1][x0];
    const f10 = field[y0][x1];
    const f11 = field[y1][x1];

    return (
      f00 * (1 - tx) * (1 - ty) +
      f10 * tx * (1 - ty) +
      f01 * (1 - tx) * ty +
      f11 * tx * ty
    );
  };
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

const createPerlinFbm2D = (seed: number) => {
  const rand = createRandomGenerator(seed || 0x9e3779b9);
  const permutation = new Uint8Array(512);
  const base = new Uint8Array(256);

  for (let i = 0; i < 256; i++) {
    base[i] = i;
  }

  for (let i = 255; i >= 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const temp = base[i];
    base[i] = base[j];
    base[j] = temp;
  }

  for (let i = 0; i < 512; i++) {
    permutation[i] = base[i & 255];
  }

  const grad = (hash: number, x: number, y: number) => {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    const a = (h & 1) === 0 ? u : -u;
    const b = (h & 2) === 0 ? v : -v;
    return a + b;
  };

  const noise2D = (x: number, y: number) => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);

    const aa = permutation[xi] + yi;
    const ab = permutation[xi] + yi + 1;
    const ba = permutation[xi + 1] + yi;
    const bb = permutation[xi + 1] + yi + 1;

    const x1 = lerp(
      grad(permutation[aa], xf, yf),
      grad(permutation[ba], xf - 1, yf),
      u
    );
    const x2 = lerp(
      grad(permutation[ab], xf, yf - 1),
      grad(permutation[bb], xf - 1, yf - 1),
      u
    );

    return lerp(x1, x2, v);
  };

  return (x: number, y: number, octaves: number): number => {
    const cappedOctaves = clampInt(octaves, 1, 8);
    let amplitude = 0.5;
    let frequency = 1;
    let total = 0;
    let maxAmplitude = 0;

    for (let i = 0; i < cappedOctaves; i++) {
      total += noise2D(x * frequency, y * frequency) * amplitude;
      maxAmplitude += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }

    if (maxAmplitude === 0) {
      return 0.5;
    }

    const normalized = total / maxAmplitude;
    return normalized * 0.5 + 0.5;
  };
};

const tracePolygonPath = (
  ctx: CanvasRenderingContext2D,
  vertices: Point[],
  snap: (value: number) => number
) => {
  ctx.beginPath();
  ctx.moveTo(snap(vertices[0].x), snap(vertices[0].y));
  for (let i = 1; i < vertices.length; i++) {
    ctx.lineTo(snap(vertices[i].x), snap(vertices[i].y));
  }
  ctx.closePath();
};

const generateSeedPoints = (
  vertices: Point[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  spacing: number,
  jitter: number,
  rng: () => number
): Point[] => {
  const seeds: Point[] = [];
  if (spacing <= 0) {
    return seeds;
  }

  const padding = spacing * 0.8;
  const startX = bounds.minX - padding;
  const startY = bounds.minY - padding;
  const endX = bounds.maxX + padding;
  const endY = bounds.maxY + padding;
  const rejectionDistance = spacing * 0.55;

  for (let y = startY; y <= endY; y += spacing) {
    for (let x = startX; x <= endX; x += spacing) {
      const offsetX = (rng() - 0.5) * spacing * jitter;
      const offsetY = (rng() - 0.5) * spacing * jitter;
      const candidate = { x: x + offsetX, y: y + offsetY };

      if (!isPointInPolygonSDF(candidate, vertices)) {
        continue;
      }

      let tooClose = false;
      for (const existing of seeds) {
        if (Math.hypot(existing.x - candidate.x, existing.y - candidate.y) < rejectionDistance) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        seeds.push(candidate);
      }
    }
  }

  return seeds;
};

export const drawInkRibbonsFill = ({
  ctx,
  vertices,
  brushSettings,
  dependencies,
  isPreview = false,
  randomSeed,
  strokeColorOverride,
}: InkRibbonsFillParams): void => {
  if (vertices.length < 3) {
    return;
  }

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const snap = resolveCoordinateSnap(pixelMode);
  const strokeColor = strokeColorOverride ?? brushSettings.color ?? '#0d1d71';

  const sdfStep = Math.max(4, Math.round(brushSettings.ribbonSdfStep ?? 8));
  const baseSpacing = Math.max(6, brushSettings.ribbonSeedSpacing ?? 18);
  const baseStepSize = Math.max(0.4, brushSettings.ribbonStepSize ?? 1.7);
  const baseMaxSteps = clampInt(brushSettings.ribbonMaxSteps ?? 370, 8, 6000);
  const tangentWeight = clamp01(brushSettings.ribbonTangentWeight ?? 0.6);
  const biasAngle = ((brushSettings.ribbonBiasAngle ?? 80) * Math.PI) / 180;
  const noiseStrength = clamp01(brushSettings.ribbonNoiseStrength ?? 0.45);
  const noiseScale = Math.max(10, brushSettings.ribbonNoiseScale ?? 220);
  const noiseOctaves = clampInt(brushSettings.ribbonNoiseOctaves ?? 3, 1, 6);
  const lineWidth = Math.max(0.6, brushSettings.ribbonLineWidth ?? brushSettings.shapeFillLineWidth ?? 1.6);
  const jitterAmount = clamp01(brushSettings.ribbonJitter ?? 0.25);
  const anchorFalloff = clamp01(brushSettings.ribbonAnchorFalloff ?? 0.3);
  const seedValue = clampInt(Math.round(brushSettings.ribbonSeed ?? randomSeed ?? 2025), 0, 0xffffffff);

  const spacing = isPreview ? baseSpacing * 1.35 : baseSpacing;
  const maxSteps = Math.max(8, Math.floor(isPreview ? baseMaxSteps * 0.65 : baseMaxSteps));
  const stepSize = baseStepSize;

  const field = dependencies.createSignedDistanceField(
    vertices,
    ctx.canvas.width,
    ctx.canvas.height,
    sdfStep
  );
  if (!field.field.length) {
    return;
  }

  const sampleGradient = buildGradientSampler(field);
  const sampleDistance = buildDistanceSampler(field);
  const bounds = computePolygonBounds(vertices);

  const bias = { x: Math.cos(biasAngle), y: Math.sin(biasAngle) };
  const rng = createRandomGenerator(seedValue ^ 0x9e3779b9);
  const perlinFbm = createPerlinFbm2D(seedValue >>> 0);

  const seeds = generateSeedPoints(vertices, bounds, spacing, jitterAmount, rng);
  if (!seeds.length) {
    return;
  }

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

  const drawnAnchors: Point[] = [];
  const rejectDist = spacing * 0.45;

  const isNearAnchors = (pt: Point) => {
    for (const anchor of drawnAnchors) {
      if (Math.hypot(anchor.x - pt.x, anchor.y - pt.y) < rejectDist) {
        return true;
      }
    }
    return false;
  };

  const adjustStep = (x: number, y: number): number => {
    if (anchorFalloff <= 0.001) {
      return stepSize;
    }
    const distance = Math.max(0, sampleDistance(x, y));
    const factor = 1 - clamp(distance / (spacing * 1.2), 0, 1);
    const eased = anchorFalloff * factor + (1 - anchorFalloff);
    return stepSize * eased;
  };

  const integrate = (start: Point, direction: 1 | -1): Point[] => {
    const points: Point[] = [];
    let x = start.x;
    let y = start.y;

    for (let i = 0; i < maxSteps; i++) {
      if (!isPointInPolygonSDF({ x, y }, vertices)) {
        break;
      }

      const g = sampleGradient(x, y);
      let tx = -g.gy;
      let ty = g.gx;

      const tiny = 1e-4;
      if (!Number.isFinite(tx) || !Number.isFinite(ty) || (Math.abs(tx) < tiny && Math.abs(ty) < tiny)) {
        tx = bias.x;
        ty = bias.y;
      }

      if (tx * bias.x + ty * bias.y < 0) {
        tx = -tx;
        ty = -ty;
      }

      let vx = tx * tangentWeight + bias.x * (1 - tangentWeight);
      let vy = ty * tangentWeight + bias.y * (1 - tangentWeight);

      if (noiseStrength > 0.0001) {
        const noiseValue = perlinFbm(x / noiseScale, y / noiseScale, noiseOctaves);
        const theta = (noiseValue * 2 - 1) * noiseStrength * Math.PI * 0.35;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        const rx = vx * cosT - vy * sinT;
        const ry = vx * sinT + vy * cosT;
        vx = rx;
        vy = ry;
      }

      const length = Math.hypot(vx, vy) || 1;
      vx /= length;
      vy /= length;

      const step = adjustStep(x, y);
      x += direction * vx * step;
      y += direction * vy * step;

      if (!isPointInPolygonSDF({ x, y }, vertices)) {
        break;
      }

      points.push({ x, y });
    }

    return points;
  };

  for (const seed of seeds) {
    if (isNearAnchors(seed)) {
      continue;
    }

    const forward = integrate(seed, 1);
    const backward = integrate(seed, -1).reverse();
    const path = backward.concat([seed], forward);

    if (path.length < 6) {
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(snap(path[0].x), snap(path[0].y));
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(snap(path[i].x), snap(path[i].y));
    }
    ctx.stroke();

    drawnAnchors.push(seed);
  }

  ctx.restore();
};
