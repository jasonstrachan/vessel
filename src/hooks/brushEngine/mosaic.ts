import type { BrushSettings } from '@/types';
import { parseColor } from './colorUtils';

export const DITHER_MAX_PIXELS = 256 * 256;

export const DEFAULT_MOSAIC_SIZE = 60;
const DEFAULT_TILE_PX = 8;
const DEFAULT_BLOCKS_COUNT = 6;
const DEFAULT_PALETTE_COUNT = 8;
const DEFAULT_SEGMENT_PX = 160;

export type MosaicGradientStop = {
  position: number;
  rgb: [number, number, number];
};

export type MosaicState = {
  activePalette: string[];
  activePaletteRgb: [number, number, number][];
  tilePx: number;
  paletteCount: number;
  blocksCount: number;
  rows: number;
  cols: number;
  stampW: number;
  stampH: number;
  segmentLengthPx: number;
  segmentRemainingPx: number;
  segmentJitter: number;
  spacingPx: number;
  spacingRemainingPx: number;
  lastX: number;
  lastY: number;
  ditherEnabled: boolean;
  seed: number;
  rng: () => number;
  stampCanvas: HTMLCanvasElement | null;
  gradientStops: MosaicGradientStop[];
  tileColorIndices: number[];
  gradientPhaseOffset: number;
  hasStamped: boolean;
};

const clampRound = (value: number | undefined, fallback: number, min: number, max: number) => {
  const resolved = Number.isFinite(value) ? (value as number) : fallback;
  const rounded = Math.round(resolved);
  return Math.max(min, Math.min(max, rounded));
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export const resolveMosaicSettings = (settings: BrushSettings) => {
  return {
    tilePx: clampRound(settings.mosaicTilePx, DEFAULT_TILE_PX, 1, 128),
    blocksCount: clampRound(settings.mosaicBlocksCount, DEFAULT_BLOCKS_COUNT, 1, 32),
    paletteCount: clampRound(settings.mosaicPaletteCount, DEFAULT_PALETTE_COUNT, 1, 32),
    segmentLengthPx: clampRound(settings.mosaicSegmentPx, DEFAULT_SEGMENT_PX, 1, 5000),
    segmentJitter: clamp01((settings.mosaicSegmentJitter ?? 0) / 100),
    ditherEnabled: Boolean(settings.mosaicDitherEnabled),
    seed: Number.isFinite(settings.mosaicSeed)
      ? Math.floor(settings.mosaicSeed as number)
      : Math.floor(Math.random() * 1_000_000_000)
  };
};

const createRng = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

export const normalizeMosaicStops = (stops: Array<{ position: number; color: string }>): MosaicGradientStop[] => {
  return stops
    .map((stop) => ({
      position: clamp01(stop.position),
      rgb: parseColor(stop.color)
    }))
    .sort((a, b) => a.position - b.position);
};

const sampleGradientRgb = (stops: MosaicGradientStop[], position: number): [number, number, number] => {
  if (!stops.length) {
    return [0, 0, 0];
  }

  const clamped = clamp01(position);
  let prev = stops[0];
  let next = stops[stops.length - 1];

  for (let i = 0; i < stops.length - 1; i++) {
    const current = stops[i];
    const upcoming = stops[i + 1];
    if (clamped >= current.position && clamped <= upcoming.position) {
      prev = current;
      next = upcoming;
      break;
    }
  }

  const span = next.position - prev.position;
  const t = span > 0 ? (clamped - prev.position) / span : 0;

  const r = Math.round(prev.rgb[0] + (next.rgb[0] - prev.rgb[0]) * t);
  const g = Math.round(prev.rgb[1] + (next.rgb[1] - prev.rgb[1]) * t);
  const b = Math.round(prev.rgb[2] + (next.rgb[2] - prev.rgb[2]) * t);

  return [r, g, b];
};

export const sampleMosaicPalette = (stops: MosaicGradientStop[], paletteCount: number) => {
  const activePaletteRgb: [number, number, number][] = [];
  const activePalette: string[] = [];

  for (let i = 0; i < paletteCount; i++) {
    const t = (i + 0.5) / paletteCount;
    const rgb = sampleGradientRgb(stops, t);
    activePaletteRgb.push(rgb);
    activePalette.push(`rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`);
  }

  return { activePalette, activePaletteRgb };
};

const resampleMosaicPalette = (state: MosaicState) => {
  state.activePalette = [];
  state.activePaletteRgb = [];
  for (let i = 0; i < state.paletteCount; i++) {
    const t = (i + state.rng()) / state.paletteCount;
    const rgb = sampleGradientRgb(state.gradientStops, t);
    state.activePaletteRgb.push(rgb);
    state.activePalette.push(`rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`);
  }
};

const shuffleInPlace = <T>(values: T[], rng: () => number) => {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
};

const buildMosaicTileIndices = (state: MosaicState) => {
  const tileCount = state.cols * state.rows;
  state.tileColorIndices = new Array(tileCount);
  for (let i = 0; i < tileCount; i++) {
    state.tileColorIndices[i] = Math.floor(state.rng() * state.activePalette.length);
  }
};

const updateGradientPhaseOffset = (state: MosaicState) => {
  state.gradientPhaseOffset = state.rng();
};

const computeSegmentLength = (state: MosaicState) => {
  if (state.segmentJitter <= 0) {
    return state.segmentLengthPx;
  }
  const jitter = (state.rng() * 2 - 1) * state.segmentJitter;
  const length = Math.round(state.segmentLengthPx * (1 + jitter));
  return Math.max(1, length);
};

export const shuffleMosaicPalette = (state: MosaicState) => {
  if (state.ditherEnabled) {
    resampleMosaicPalette(state);
    updateGradientPhaseOffset(state);
    return;
  }
  shuffleInPlace(state.activePalette, state.rng);
  state.activePaletteRgb = state.activePalette.map((color) => parseColor(color));
};

export const shouldUseMosaicDither = (
  stampW: number,
  stampH: number,
  ditherEnabled: boolean
) => {
  if (!ditherEnabled) return false;
  return stampW * stampH <= DITHER_MAX_PIXELS;
};

const findNearestPaletteColor = (
  target: [number, number, number],
  palette: [number, number, number][]
): [number, number, number] => {
  let best = palette[0];
  let bestDist = Number.POSITIVE_INFINITY;

  for (const color of palette) {
    const dr = target[0] - color[0];
    const dg = target[1] - color[1];
    const db = target[2] - color[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = color;
    }
  }

  return best;
};

export const buildMosaicStamp = (state: MosaicState): HTMLCanvasElement | null => {
  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = state.stampW;
  canvas.height = state.stampH;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) {
    return null;
  }

  ctx.imageSmoothingEnabled = false;

  const useDither = shouldUseMosaicDither(state.stampW, state.stampH, state.ditherEnabled);

  if (!useDither) {
    for (let row = 0; row < state.rows; row++) {
      for (let col = 0; col < state.cols; col++) {
        const tileIndex = col + row * state.cols;
        const colorIndex = state.tileColorIndices[tileIndex] ?? 0;
        ctx.fillStyle = state.activePalette[colorIndex % state.activePalette.length];
        ctx.fillRect(col * state.tilePx, row * state.tilePx, state.tilePx, state.tilePx);
      }
    }
    return canvas;
  }

  const image = ctx.createImageData
    ? ctx.createImageData(state.stampW, state.stampH)
    : new ImageData(state.stampW, state.stampH);
  const data = image.data;
  const tileCount = state.cols * state.rows;

  for (let row = 0; row < state.rows; row++) {
    for (let col = 0; col < state.cols; col++) {
      const tileIndex = col + row * state.cols;
      const tTile = ((tileIndex + 0.5) / tileCount + state.gradientPhaseOffset) % 1;
      const target = sampleGradientRgb(state.gradientStops, tTile);
      const tileSize = state.tilePx;
      const tilePixelCount = tileSize * tileSize;

      const errR = new Float32Array(tilePixelCount);
      const errG = new Float32Array(tilePixelCount);
      const errB = new Float32Array(tilePixelCount);

      for (let y = 0; y < tileSize; y++) {
        const leftToRight = (y & 1) === 0;
        const xStart = leftToRight ? 0 : tileSize - 1;
        const xEnd = leftToRight ? tileSize : -1;
        const xStep = leftToRight ? 1 : -1;

        for (let x = xStart; x !== xEnd; x += xStep) {
          const tileIdx = y * tileSize + x;
          const desiredR = target[0] + errR[tileIdx];
          const desiredG = target[1] + errG[tileIdx];
          const desiredB = target[2] + errB[tileIdx];
          const clampedR = Math.max(0, Math.min(255, Math.round(desiredR)));
          const clampedG = Math.max(0, Math.min(255, Math.round(desiredG)));
          const clampedB = Math.max(0, Math.min(255, Math.round(desiredB)));

          const [newR, newG, newB] = findNearestPaletteColor(
            [clampedR, clampedG, clampedB],
            state.activePaletteRgb
          );

          const errorR = desiredR - newR;
          const errorG = desiredG - newG;
          const errorB = desiredB - newB;

          const globalX = col * tileSize + x;
          const globalY = row * tileSize + y;
          const idx = (globalY * state.stampW + globalX) * 4;
          data[idx] = newR;
          data[idx + 1] = newG;
          data[idx + 2] = newB;
          data[idx + 3] = 255;

          if (leftToRight) {
            if (x + 1 < tileSize) {
              const right = tileIdx + 1;
              errR[right] += errorR * 0.5;
              errG[right] += errorG * 0.5;
              errB[right] += errorB * 0.5;
            }
            if (y + 1 < tileSize) {
              const down = tileIdx + tileSize;
              errR[down] += errorR * 0.25;
              errG[down] += errorG * 0.25;
              errB[down] += errorB * 0.25;
              if (x > 0) {
                const downLeft = tileIdx + tileSize - 1;
                errR[downLeft] += errorR * 0.25;
                errG[downLeft] += errorG * 0.25;
                errB[downLeft] += errorB * 0.25;
              }
            }
          } else {
            if (x - 1 >= 0) {
              const left = tileIdx - 1;
              errR[left] += errorR * 0.5;
              errG[left] += errorG * 0.5;
              errB[left] += errorB * 0.5;
            }
            if (y + 1 < tileSize) {
              const down = tileIdx + tileSize;
              errR[down] += errorR * 0.25;
              errG[down] += errorG * 0.25;
              errB[down] += errorB * 0.25;
              if (x + 1 < tileSize) {
                const downRight = tileIdx + tileSize + 1;
                errR[downRight] += errorR * 0.25;
                errG[downRight] += errorG * 0.25;
                errB[downRight] += errorB * 0.25;
              }
            }
          }
        }
      }
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
};

export const createMosaicState = (params: {
  settings: BrushSettings;
  gradientStops: Array<{ position: number; color: string }>;
  startX: number;
  startY: number;
}): MosaicState => {
  const resolved = resolveMosaicSettings(params.settings);
  const normalizedStops = normalizeMosaicStops(params.gradientStops);
  const rng = createRng(resolved.seed);

  const { activePalette } = sampleMosaicPalette(normalizedStops, resolved.paletteCount);
  shuffleInPlace(activePalette, rng);

  const rows = 1;
  const cols = resolved.blocksCount;
  const stampW = resolved.tilePx * cols;
  const stampH = resolved.tilePx * rows;
  const spacingSetting = Number.isFinite(params.settings.spacing) ? (params.settings.spacing as number) : null;
  const spacingPx = spacingSetting && spacingSetting > 0
    ? Math.max(1, Math.round(spacingSetting))
    : Math.max(1, Math.floor(resolved.tilePx * 0.75));

  const state: MosaicState = {
    activePalette,
    activePaletteRgb: activePalette.map((color) => parseColor(color)),
    tilePx: resolved.tilePx,
    paletteCount: resolved.paletteCount,
    blocksCount: resolved.blocksCount,
    rows,
    cols,
    stampW,
    stampH,
    segmentLengthPx: resolved.segmentLengthPx,
    segmentRemainingPx: 0,
    segmentJitter: resolved.segmentJitter,
    spacingPx,
    spacingRemainingPx: 0,
    lastX: params.startX,
    lastY: params.startY,
    ditherEnabled: resolved.ditherEnabled,
    seed: resolved.seed,
    rng,
    stampCanvas: null,
    gradientStops: normalizedStops,
    tileColorIndices: [],
    gradientPhaseOffset: 0,
    hasStamped: false
  };

  buildMosaicTileIndices(state);
  updateGradientPhaseOffset(state);
  state.segmentRemainingPx = computeSegmentLength(state);
  state.stampCanvas = buildMosaicStamp(state);
  return state;
};

export const rebuildMosaicStamp = (state: MosaicState) => {
  state.activePaletteRgb = state.activePalette.map((color) => parseColor(color));
  buildMosaicTileIndices(state);
  updateGradientPhaseOffset(state);
  state.segmentRemainingPx = computeSegmentLength(state);
  state.stampCanvas = buildMosaicStamp(state);
};
