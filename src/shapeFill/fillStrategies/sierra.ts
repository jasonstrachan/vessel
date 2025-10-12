import { FillParams, FillResult, ShapeDefinition, Vec2 } from '../types';
import { computeBounds, pointInPolygon } from '../utils/geometry';
import { clamp } from '../utils/math';

const THRESHOLD = 128;
const FLAT_FILL_THRESHOLD = 0.96;

interface ActiveCell {
  gx: number;
  gy: number;
}

export function sierraFill(shape: ShapeDefinition, params: FillParams): FillResult {
  if (shape.points.length < 3) {
    return { dots: [], clipPath: [...shape.points] };
  }

  const bounds = computeBounds(shape.points);
  const minX = Math.floor(bounds.minX);
  const minY = Math.floor(bounds.minY);
  const width = Math.max(1, Math.ceil(bounds.maxX) - minX + 1);
  const height = Math.max(1, Math.ceil(bounds.maxY) - minY + 1);

  const density = clamp(params.sierraDensity ?? 0.45, 0, 1);
  const resolution = Math.max(1, Math.round(params.sierraResolution ?? 4));
  const desired = density * 255;

  if (density <= 0) {
    return {
      clipPath: [...shape.points],
    };
  }

  if (density >= FLAT_FILL_THRESHOLD) {
    return {
      polygons: [shape.points.map(point => ({ ...point }))],
      clipPath: [...shape.points],
    };
  }

  const gridWidth = Math.max(1, Math.ceil(width / resolution));
  const gridHeight = Math.max(1, Math.ceil(height / resolution));

  const buffer = new Float32Array(gridWidth * gridHeight).fill(desired);
  const mask = new Uint8Array(gridWidth * gridHeight);

  for (let gy = 0; gy < gridHeight; gy += 1) {
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const worldX = minX + (gx + 0.5) * resolution;
      const worldY = minY + (gy + 0.5) * resolution;
      mask[gy * gridWidth + gx] = pointInPolygon({ x: worldX, y: worldY }, shape.points) ? 1 : 0;
    }
  }

  const activeCells: ActiveCell[] = [];

  for (let gy = 0; gy < gridHeight; gy += 1) {
    const serpentine = gy % 2 === 1;
    const start = serpentine ? gridWidth - 1 : 0;
    const end = serpentine ? -1 : gridWidth;
    const step = serpentine ? -1 : 1;

    for (let gx = start; gx !== end; gx += step) {
      const index = gy * gridWidth + gx;
      if (!mask[index]) {
        continue;
      }

      const value = buffer[index];
      const output = value >= THRESHOLD ? 255 : 0;
      const error = value - output;

      if (output >= THRESHOLD) {
        activeCells.push({ gx, gy });
      }

      const forwardX = gx + step;
      if (forwardX >= 0 && forwardX < gridWidth) {
        const forwardIndex = gy * gridWidth + forwardX;
        if (mask[forwardIndex]) {
          buffer[forwardIndex] += error * 0.5;
        }
      }

      const nextRow = gy + 1;
      if (nextRow < gridHeight) {
        const downIndex = nextRow * gridWidth + gx;
        if (mask[downIndex]) {
          buffer[downIndex] += error * 0.25;
        }

        const diagonalX = gx - step;
        if (diagonalX >= 0 && diagonalX < gridWidth) {
          const diagonalIndex = nextRow * gridWidth + diagonalX;
          if (mask[diagonalIndex]) {
            buffer[diagonalIndex] += error * 0.25;
          }
        }
      }
    }
  }

  if (resolution === 1) {
    const dots = activeCells.map(cell => ({
      x: minX + (cell.gx + 0.5) * resolution,
      y: minY + (cell.gy + 0.5) * resolution,
    }));
    return {
      dots,
      dotRadius: 0.6,
      clipPath: [...shape.points],
    };
  }

  const polygons: Vec2[][] = [];

  for (const cell of activeCells) {
    const left = minX + cell.gx * resolution;
    const top = minY + cell.gy * resolution;
    const right = left + resolution;
    const bottom = top + resolution;

    const corners: Vec2[] = [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ];

    const allInside = corners.every(corner => pointInPolygon(corner, shape.points));
    if (!allInside) {
      continue;
    }

    polygons.push(corners);
  }

  return {
    polygons,
    clipPath: [...shape.points],
  };
}
