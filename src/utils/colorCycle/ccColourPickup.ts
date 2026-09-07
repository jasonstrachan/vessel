import type { BrushSettings } from '@/types';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';
import { parseCssColorToRgba } from '@/hooks/canvas/utils/colorCycleHelpers';

type Point = { x: number; y: number };
type Rgba = [number, number, number, number];
export type CcColourPickup = {
  image: ImageData | null;
  sampleBase?: boolean;
  baseStops: StoredStop[];
  brushSize: number;
};

export const usesCcSampledGradient = (
  settings: Pick<BrushSettings, 'ccGradientSource' | 'colorCyclePickupEnabled'>,
  source = settings.ccGradientSource,
): boolean => settings.colorCyclePickupEnabled === true || source === 'sampled';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const readPixel = (image: ImageData | null, x: number, y: number): Rgba => {
  if (!image || x < 0 || y < 0 || x >= image.width || y >= image.height) return [0, 0, 0, 0];
  const i = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
};

const mixSamples = (
  pickup: CcColourPickup,
  samples: Rgba[],
  distance: number,
): StoredStop[] => {
  if (!samples.some((sample) => sample[3] > 0)) return pickup.baseStops.map((stop) => ({ ...stop }));
  const base = pickup.baseStops.map((stop) => ({
    ...stop,
    rgba: parseCssColorToRgba(stop.color),
  })).sort((a, b) => a.position - b.position);
  if (!base.length) return [];
  const step = distance / Math.max(1, samples.length - 1);
  const size = Math.max(1, pickup.brushSize);
  const recovery = Math.exp(-step / (size * 3));
  const uptake = 1 - Math.exp(-Math.max(step, 1) / (size * 0.35));
  let amount = 0;
  const carried = [0, 0, 0];
  return samples.map((sample, index) => {
    const t = index / Math.max(1, samples.length - 1);
    amount *= recovery;
    const incoming = uptake * sample[3] / 255;
    const nextAmount = Math.min(0.8, amount + incoming * (1 - amount));
    for (let c = 0; c < 3; c += 1) {
      carried[c] = nextAmount > 0
        ? (carried[c] * amount + sample[c] * (nextAmount - amount)) / nextAmount
        : 0;
    }
    amount = nextAmount;
    let hi = base.findIndex((stop) => stop.position >= t);
    if (hi < 0) hi = base.length - 1;
    const b = base[hi];
    const a = base[Math.max(0, hi - 1)];
    const f = b.position > a.position ? clamp01((t - a.position) / (b.position - a.position)) : 0;
    const rgb = [0, 1, 2].map((c) => Math.round(
      (a.rgba[c] + (b.rgba[c] - a.rgba[c]) * f) * (1 - amount) + carried[c] * amount,
    ));
    const alphaA = (a.opacity ?? 1) * a.rgba[3] / 255;
    const alphaB = (b.opacity ?? 1) * b.rgba[3] / 255;
    return { position: t, color: `rgb(${rgb.join(', ')})`, opacity: alphaA + (alphaB - alphaA) * f };
  });
};

export const buildCcPickupStrokeStops = (pickup: CcColourPickup, points: Point[]): StoredStop[] => {
  const path = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!path.length) return pickup.baseStops.map((stop) => ({ ...stop }));
  const lengths = [0];
  for (let i = 1; i < path.length; i += 1) {
    lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  }
  const total = lengths[lengths.length - 1];
  const count = Math.max(2, Math.min(256, Math.ceil(total / 2) + 1));
  const samples: Rgba[] = [];
  let segment = 1;
  for (let i = 0; i < count; i += 1) {
    const distance = i * total / (count - 1);
    while (segment < path.length - 1 && lengths[segment] < distance) segment += 1;
    const a = path[Math.max(0, segment - 1)];
    const b = path[Math.min(segment, path.length - 1)];
    const span = (lengths[segment] ?? 0) - lengths[segment - 1];
    const t = span > 0 ? clamp01((distance - lengths[segment - 1]) / span) : 0;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const sample: Rgba = [0, 0, 0, 0];
    // Sample across the contact width, including paint crossed by the tip's sides.
    for (let lane = -2; lane <= 2; lane += 1) {
      const offset = lane * pickup.brushSize / 5;
      const rgba = readPixel(pickup.image, x - (b.y - a.y) / length * offset, y + (b.x - a.x) / length * offset);
      for (let c = 0; c < 3; c += 1) sample[c] += rgba[c] * rgba[3];
      sample[3] += rgba[3];
    }
    if (sample[3] > 0) for (let c = 0; c < 3; c += 1) sample[c] /= sample[3];
    sample[3] /= 5;
    samples.push(sample);
  }
  return mixSamples(pickup, samples, total);
};

export const buildCcPickupShapeStops = (
  pickup: CcColourPickup,
  points: Point[],
  direction: Point | null | undefined,
  mode: 'linear' | 'concentric',
): StoredStop[] => {
  if (!pickup.image || points.length < 3 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return pickup.baseStops.map((stop) => ({ ...stop }));
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const dirLength = Math.hypot(direction?.x ?? 1, direction?.y ?? 0) || 1;
  const dx = (direction?.x ?? 1) / dirLength, dy = (direction?.y ?? 0) / dirLength;
  const projections = points.map((p) => p.x * dx + p.y * dy);
  const start = Math.min(...projections);
  const span = Math.max(1, Math.max(...projections) - start);
  const sampleBudget = Math.min(16384, Math.max(1, Math.floor(1_000_000 / points.length)));
  const step = Math.max(1, Math.ceil(Math.sqrt((maxX - minX) * (maxY - minY) / sampleBudget)));
  const pixels: Array<{ position: number; rgba: Rgba }> = [];
  let maxDistance = 1;
  for (let y = Math.max(0, minY); y < Math.min(pickup.image.height, maxY); y += step) {
    for (let x = Math.max(0, minX); x < Math.min(pickup.image.width, maxX); x += step) {
      const px = x + 0.5, py = y + 0.5;
      let winding = 0;
      let distance = Infinity;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        const cross = (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
        if (a.y <= py && b.y > py && cross > 0) winding += 1;
        if (a.y > py && b.y <= py && cross < 0) winding -= 1;
        if (mode === 'concentric') {
          const ex = b.x - a.x, ey = b.y - a.y;
          const t = clamp01(((px - a.x) * ex + (py - a.y) * ey) / (ex * ex + ey * ey || 1));
          distance = Math.min(distance, Math.hypot(px - a.x - t * ex, py - a.y - t * ey));
        }
      }
      if (winding === 0) continue;
      maxDistance = Math.max(maxDistance, mode === 'concentric' ? distance : 1);
      pixels.push({ position: mode === 'concentric' ? distance : (px * dx + py * dy - start) / span, rgba: readPixel(pickup.image, px, py) });
    }
  }
  const samples: Rgba[] = Array.from({ length: 128 }, () => [0, 0, 0, 0]);
  const counts = new Uint32Array(samples.length);
  for (const pixel of pixels) {
    const bucket = Math.round(clamp01(pixel.position / (mode === 'concentric' ? maxDistance : 1)) * (samples.length - 1));
    const sample = samples[bucket];
    for (let c = 0; c < 3; c += 1) sample[c] += pixel.rgba[c] * pixel.rgba[3];
    sample[3] += pixel.rgba[3];
    counts[bucket] += 1;
  }
  samples.forEach((sample, i) => {
    if (sample[3] > 0) for (let c = 0; c < 3; c += 1) sample[c] /= sample[3];
    sample[3] /= Math.max(1, counts[i]);
  });
  // A slice with no sampled positions is unknown, not transparent paint.
  // Interpolate only those gaps; measured transparent slices must still dilute.
  const observed = samples.map((_, i) => i).filter((i) => counts[i] > 0);
  let right = 0;
  for (let i = 0; i < samples.length && observed.length > 0; i += 1) {
    if (counts[i] > 0) continue;
    while (right < observed.length - 1 && observed[right] < i) right += 1;
    const hi = observed[right];
    const lo = observed[Math.max(0, right - 1)];
    const t = hi > lo ? clamp01((i - lo) / (hi - lo)) : 0;
    const a = samples[lo], b = samples[hi];
    const alpha = a[3] + (b[3] - a[3]) * t;
    for (let c = 0; c < 3; c += 1) {
      samples[i][c] = alpha > 0 ? (a[c] * a[3] * (1 - t) + b[c] * b[3] * t) / alpha : 0;
    }
    samples[i][3] = alpha;
  }
  return mixSamples(pickup, samples, mode === 'concentric' ? maxDistance : span);
};
