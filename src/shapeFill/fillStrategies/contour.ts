import { FillParams, FillResult, ShapeDefinition, Vec2 } from '../types';
import { clamp } from '../utils/math';
import { createRng, hashString, resolveSeedWithFallback } from '../utils/random';
import { generateOrganicContourLines } from '../utils/contourField';
import { MIN_LINE_SPACING, MAX_LINE_SPACING } from '@/utils/contourLines';

export function contourFill(shape: ShapeDefinition, params: FillParams): FillResult {
  if (!shape.points || shape.points.length < 3) {
    return {
      lines: [],
      lineWidth: Math.max(0.2, params.thickness ?? 1),
      clipPath: [...(shape.points ?? [])],
    };
  }

  const variance = clamp(params.variance ?? 0, 0, 1);
  const spacing = clamp(params.spacing ?? 12, MIN_LINE_SPACING, MAX_LINE_SPACING);
  const thickness = Math.max(0.2, params.thickness ?? 1);
  const spacingWobble = clamp(params.spacingWobble ?? variance, 0, 1);
  const shapeSalt = shape.id ? hashString(shape.id) : 0;
  const seed = resolveSeedWithFallback(shape.points, params.seed, {
    treatZeroAsUndefined: true,
    shapeSalt,
  });
  const rng = createRng(seed);

  const organicLines = generateOrganicContourLines(shape.points, {
    spacing,
    variance,
    seed,
    spacingWobble,
  });
  if (organicLines.length > 0) {
    return {
      lines: organicLines,
      lineWidth: thickness,
      clipPath: [...shape.points],
    };
  }

  // Fallback to radial rings if basis generation fails (e.g., degenerate polygon)
  const fallbackLines = generateRadialRings(shape, spacing, variance, rng);
  return {
    lines: fallbackLines,
    lineWidth: thickness,
    clipPath: [...shape.points],
  };
}

const generateRadialRings = (
  shape: ShapeDefinition,
  spacing: number,
  variance: number,
  rng: () => number
): Vec2[][] => {
  const centroid = shape.centroid;
  const maxRadius = shape.points.reduce((max, point) => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    return Math.max(max, Math.hypot(dx, dy));
  }, 0);

  const rings: Vec2[][] = [];
  const maxDistance = maxRadius + spacing * 4;
  const jitterScale = variance * spacing;

  for (let offset = spacing; offset <= maxDistance; offset += spacing) {
    const ring: Vec2[] = [];
    for (const point of shape.points) {
      const dx = point.x - centroid.x;
      const dy = point.y - centroid.y;
      const distance = Math.hypot(dx, dy);
      const dirX = distance === 0 ? 0 : dx / distance;
      const dirY = distance === 0 ? 0 : dy / distance;

      const jitter = jitterScale * (rng() - 0.5) * 2;
      const radius = distance + offset + jitter;

      ring.push({
        x: centroid.x + dirX * radius,
        y: centroid.y + dirY * radius,
      });
    }

    if (ring.length > 0) {
      ring.push({ ...ring[0] });
      rings.push(ring);
    }
  }

  return rings;
};
