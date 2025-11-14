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

export type ResolveSeedOptions = {
  /**
   * When true, a seed value of 0 is treated as "unset" and we fall back to hashing the shape points.
   * This helps legacy persisted presets that stored 0 as a placeholder seed without forcing identical outputs.
   */
  treatZeroAsUndefined?: boolean;
  /** Optional salt mixed into fallback hashes to introduce per-session variation. */
  shapeSalt?: number;
};

export function resolveSeedWithFallback(
  points: Vec2[],
  explicitSeed: number | undefined,
  options: ResolveSeedOptions = {}
): number {
  const { treatZeroAsUndefined = false } = options;

  if (typeof explicitSeed === 'number' && Number.isFinite(explicitSeed)) {
    if (!treatZeroAsUndefined || explicitSeed !== 0) {
      return explicitSeed;
    }
  }

  const salt = typeof options.shapeSalt === 'number' ? options.shapeSalt : 0;
  return hashPoints(points) ^ salt;
}

export function hashString(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
