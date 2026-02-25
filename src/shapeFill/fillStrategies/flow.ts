import { FillParams, FillResult, ShapeDefinition, Vec2 } from '../types';
import { buildSDF, gradientField, bilinearGrad } from '../utils/fields';
import { pointInPolygon } from '../utils/geometry';
import { createRng, hashPoints } from '../utils/random';

interface GradientSample {
  gx: number;
  gy: number;
}

export function flowFill(shape: ShapeDefinition, params: FillParams): FillResult {
  if (shape.points.length < 3) {
    return { lines: [], clipPath: [...shape.points] };
  }

  const seedSpacing = Math.max(4, params.flowSeedSpacing ?? 18);
  const stepSize = Math.max(0.25, params.flowStepSize ?? 6);
  const maxSteps = Math.max(8, Math.floor(params.flowMaxSteps ?? 140));
  const fieldStep = Math.max(2, params.flowFieldStep ?? 8);
  const useOrthogonal = Boolean(params.flowUseOrthogonal ?? false);
  const strokeWidth = Math.max(0.6, params.thickness ?? 1);
  const seed = params.seed ?? hashPoints(shape.points);

  const grid = buildSDF(fieldStep, shape.points);
  const gradients = gradientField(grid.nx, grid.ny, grid.step, grid.field);
  const gradientSampler = bilinearGrad(
    grid.minX,
    grid.minY,
    grid.step,
    grid.nx,
    grid.ny,
    gradients.gx,
    gradients.gy
  );

  const rng = createRng(seed);
  const lines: Vec2[][] = [];

  for (let y = grid.minY; y <= grid.maxY; y += seedSpacing) {
    for (let x = grid.minX; x <= grid.maxX; x += seedSpacing) {
      const jitterX = (rng() - 0.5) * seedSpacing * 0.6;
      const jitterY = (rng() - 0.5) * seedSpacing * 0.6;
      const sx = x + jitterX;
      const sy = y + jitterY;
      const seedPoint = { x: sx, y: sy };

      if (!pointInPolygon(seedPoint, shape.points)) {
        continue;
      }

      const forward = integrate(seedPoint, 1);
      const backward = integrate(seedPoint, -1);
      const combined = [...backward.reverse(), seedPoint, ...forward];

      if (combined.length > 2) {
        lines.push(combined);
      }
    }
  }

  return {
    lines,
    lineWidth: strokeWidth,
    clipPath: [...shape.points],
  };

  function integrate(start: Vec2, direction: 1 | -1): Vec2[] {
    const path: Vec2[] = [];
    let currentX = start.x;
    let currentY = start.y;

    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
      if (!pointInPolygon({ x: currentX, y: currentY }, shape.points)) {
        break;
      }

      const g = gradientSampler(currentX, currentY) as GradientSample;
      let vx = g.gx;
      let vy = g.gy;

      if (useOrthogonal) {
        const temp = vx;
        vx = -vy;
        vy = temp;
      }

      const magnitude = Math.hypot(vx, vy);
      if (magnitude <= 1e-5) {
        break;
      }

      vx /= magnitude;
      vy /= magnitude;

      currentX += direction * vx * stepSize;
      currentY += direction * vy * stepSize;

      if (!pointInPolygon({ x: currentX, y: currentY }, shape.points)) {
        break;
      }

      path.push({ x: currentX, y: currentY });
    }

    return path;
  }
}
