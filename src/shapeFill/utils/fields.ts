import { computeBounds, pointInPolygon } from './geometry';
import type { Vec2 } from '../types';
import { clamp } from './math';

export interface SdfGrid {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  step: number;
  nx: number;
  ny: number;
  field: Float32Array;
}

export function buildSDF(step: number, polygon: Vec2[]): SdfGrid {
  if (step <= 0) {
    throw new Error('SDF step must be positive');
  }

  const bounds = computeBounds(polygon);
  const pad = Math.max(step * 2, Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.1);
  const minX = Math.floor((bounds.minX - pad) / step) * step;
  const minY = Math.floor((bounds.minY - pad) / step) * step;
  const maxX = Math.ceil((bounds.maxX + pad) / step) * step;
  const maxY = Math.ceil((bounds.maxY + pad) / step) * step;

  const nx = Math.max(2, Math.round((maxX - minX) / step) + 1);
  const ny = Math.max(2, Math.round((maxY - minY) / step) + 1);
  const field = new Float32Array(nx * ny);

  for (let j = 0; j < ny; j += 1) {
    const y = minY + j * step;
    for (let i = 0; i < nx; i += 1) {
      const x = minX + i * step;
      const distance = signedDistanceToPolygon({ x, y }, polygon);
      field[j * nx + i] = distance;
    }
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    step,
    nx,
    ny,
    field,
  };
}

export function gradientField(nx: number, ny: number, step: number, field: Float32Array): {
  gx: Float32Array;
  gy: Float32Array;
} {
  const gx = new Float32Array(field.length);
  const gy = new Float32Array(field.length);

  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const idx = j * nx + i;
      const left = field[j * nx + Math.max(i - 1, 0)];
      const right = field[j * nx + Math.min(i + 1, nx - 1)];
      const top = field[Math.max(j - 1, 0) * nx + i];
      const bottom = field[Math.min(j + 1, ny - 1) * nx + i];
      gx[idx] = (right - left) / (2 * step);
      gy[idx] = (bottom - top) / (2 * step);
    }
  }

  return { gx, gy };
}

export function bilinearGrad(
  minX: number,
  minY: number,
  step: number,
  nx: number,
  ny: number,
  gx: Float32Array,
  gy: Float32Array
): (x: number, y: number) => { gx: number; gy: number } {
  return (x: number, y: number) => {
    const fx = (x - minX) / step;
    const fy = (y - minY) / step;

    if (Number.isNaN(fx) || Number.isNaN(fy)) {
      return { gx: 0, gy: 0 };
    }

    const ix = clamp(Math.floor(fx), 0, nx - 1);
    const iy = clamp(Math.floor(fy), 0, ny - 1);
    const tx = clamp(fx - ix, 0, 1);
    const ty = clamp(fy - iy, 0, 1);

    const ix1 = clamp(ix + 1, 0, nx - 1);
    const iy1 = clamp(iy + 1, 0, ny - 1);

    const gx00 = gx[iy * nx + ix];
    const gx10 = gx[iy * nx + ix1];
    const gx01 = gx[iy1 * nx + ix];
    const gx11 = gx[iy1 * nx + ix1];

    const gy00 = gy[iy * nx + ix];
    const gy10 = gy[iy * nx + ix1];
    const gy01 = gy[iy1 * nx + ix];
    const gy11 = gy[iy1 * nx + ix1];

    const gx0 = gx00 + (gx10 - gx00) * tx;
    const gx1 = gx01 + (gx11 - gx01) * tx;
    const gy0 = gy00 + (gy10 - gy00) * tx;
    const gy1 = gy01 + (gy11 - gy01) * tx;

    return {
      gx: gx0 + (gx1 - gx0) * ty,
      gy: gy0 + (gy1 - gy0) * ty,
    };
  };
}

function signedDistanceToPolygon(point: Vec2, polygon: Vec2[]): number {
  let minDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const distance = pointSegmentDistance(point, a, b);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }

  const inside = pointInPolygon(point, polygon);
  return inside ? -minDistance : minDistance;
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abLenSq = abx * abx + aby * aby;

  if (abLenSq <= 1e-9) {
    return Math.hypot(apx, apy);
  }

  const t = clamp((apx * abx + apy * aby) / abLenSq, 0, 1);
  const closestX = a.x + abx * t;
  const closestY = a.y + aby * t;
  return Math.hypot(p.x - closestX, p.y - closestY);
}
