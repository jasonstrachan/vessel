import { Vec2 } from '../types';

// Simple deterministic RNG (Mulberry32).
export function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashPoints(points: Vec2[]): number {
  let hash = 2166136261 >>> 0;
  for (const point of points) {
    hash ^= Math.fround(point.x);
    hash = Math.imul(hash, 16777619);
    hash ^= Math.fround(point.y);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
