import { FillParams, FillResult, ShapeDefinition, Vec2 } from '../types';
import { computeBounds, pointInPolygon } from '../utils/geometry';
import { fbm2 } from '../utils/noise';
import { createRng, hashPoints } from '../utils/random';
import { clamp } from '../utils/math';

const MIN_SPACING = 2;
const MAX_SAMPLES = 200_000;

export function noiseFill(shape: ShapeDefinition, params: FillParams): FillResult {
  if (shape.points.length < 3) {
    return { dotInstances: [], clipPath: [] };
  }

  const bounds = computeBounds(shape.points);
  const spacing = Math.max(MIN_SPACING, params.spacing ?? 6);
  const jitter = spacing * clamp(params.variance ?? 0.25, 0, 1);

  const seed = params.seed ?? hashPoints(shape.points);
  const rng = createRng(seed);

  const scale = Math.max(2, params.noiseScale ?? 48);
  const contrast = clamp01(params.noiseContrast ?? 0.65);
  const threshold = clamp01(params.noiseThreshold ?? 0.45);
  const octaves = clamp(Math.round(params.noiseOctaves ?? 3), 1, 6);
  const thickness = Math.max(0.15, params.thickness ?? 1);

  const dotInstances: NonNullable<FillResult['dotInstances']> = [];

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const maxDots = Math.min(
    MAX_SAMPLES,
    Math.ceil(width / spacing) * Math.ceil(height / spacing) * 2
  );

  for (let x = bounds.minX; x <= bounds.maxX && dotInstances.length < maxDots; x += spacing) {
    for (let y = bounds.minY; y <= bounds.maxY && dotInstances.length < maxDots; y += spacing) {
      const jitterX = jitter ? (rng() - 0.5) * 2 * jitter : 0;
      const jitterY = jitter ? (rng() - 0.5) * 2 * jitter : 0;
      const sample: Vec2 = { x: x + jitterX, y: y + jitterY };

      if (!pointInPolygon(sample, shape.points)) {
        continue;
      }

      const noiseValue = fbm2(sample.x / scale, sample.y / scale, seed, octaves, 2, 0.55);
      const normalized = clamp01(0.5 + 0.5 * noiseValue);
      const contrasted = applyContrast(normalized, contrast);

      if (contrasted < threshold) {
        continue;
      }

      const surplus = (contrasted - threshold) / Math.max(1e-5, 1 - threshold);
      const radiusBase = Math.max(0.35, thickness * 0.45);
      const radius = radiusBase * (0.65 + surplus * 1.5);
      const alpha = clamp01(0.35 + surplus * 0.55);

      dotInstances.push({
        center: sample,
        radius,
        alpha,
      });
    }
  }

  return {
    dotInstances,
    clipPath: [...shape.points],
  };
}

function applyContrast(value: number, contrast: number): number {
  // Map contrast in [0,1] to gamma-like adjustment where 0.5 is neutral.
  if (contrast <= 0) {
    return value;
  }

  const pivot = 0.5;
  const strength = 1 + contrast * 2;
  const adjusted = (value - pivot) * strength + pivot;
  return clamp01(adjusted);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
