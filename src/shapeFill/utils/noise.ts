// Deterministic value noise helpers for 2D procedural fills.

import type { Vec2 } from '../types';

const TAU = Math.PI * 2;

function hash2(x: number, y: number, seed: number): number {
  let h = seed >>> 0;
  h ^= Math.imul(0x27d4eb2d, Math.floor(x));
  h ^= Math.imul(0x165667b1, Math.floor(y));
  h ^= h >>> 15;
  h = Math.imul(h ^ (h >>> 7), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 11), h | 61);
  return ((h ^ (h >>> 14)) >>> 0) / 4294967295;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10); // Perlin fade
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function valueNoise2D(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;

  const topLeft = hash2(x0, y0, seed);
  const topRight = hash2(x0 + 1, y0, seed);
  const bottomLeft = hash2(x0, y0 + 1, seed);
  const bottomRight = hash2(x0 + 1, y0 + 1, seed);

  const u = fade(xf);
  const v = fade(yf);

  const top = lerp(topLeft, topRight, u);
  const bottom = lerp(bottomLeft, bottomRight, u);
  const value = lerp(top, bottom, v);

  return value * 2 - 1; // Map to [-1, 1]
}

export function fbm2(
  x: number,
  y: number,
  seed: number,
  octaves = 3,
  lacunarity = 2,
  gain = 0.5
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let maxAmplitude = 0;

  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise2D(x * frequency, y * frequency, seed + i * 1013) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  if (maxAmplitude === 0) {
    return 0;
  }

  return sum / maxAmplitude;
}

export function jitterPoint(
  point: Vec2,
  scatter: number,
  polygon: Vec2[],
  rng: () => number
): Vec2 {
  if (!scatter) {
    return point;
  }

  const attempts = 3;
  for (let i = 0; i < attempts; i += 1) {
    const ang = rng() * TAU;
    const dist = scatter * (Math.pow(rng(), 0.85) - 0.5) * 2;
    const nx = point.x + Math.cos(ang) * dist;
    const ny = point.y + Math.sin(ang) * dist;
    if (polygon.length === 0 || pointInPolygonLoose(nx, ny, polygon)) {
      return { x: nx, y: ny };
    }
  }

  return point;
}

function pointInPolygonLoose(x: number, y: number, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}
