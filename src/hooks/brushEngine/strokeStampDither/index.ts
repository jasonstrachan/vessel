import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { BAYER_8x8_MATRIX, BLUE_NOISE_16x16, VOID_CLUSTER_8x8 } from '@/utils/ditherAlgorithms';
import type { PatternStyle } from '@/utils/ditherAlgorithms';
import { resolveCcPatternThreshold } from '@/utils/colorCycle/ccPatternThreshold';
import { encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';
import {
  computePressureResolution,
  createPressureResolutionState,
  PRESSURE_RESOLUTION_MAX_PX,
} from '@/utils/pressureResolution';

export type StampDitherAlgorithm =
  | 'floyd-steinberg'
  | 'jarvis-judice-ninke'
  | 'stucki'
  | 'burkes'
  | 'sierra-3'
  | 'sierra-2'
  | 'sierra-lite'
  | 'atkinson'
  | 'bayer'
  | 'blue-noise'
  | 'void-and-cluster'
  | 'pattern';

export type StampDitherConfig = {
  algorithm: StampDitherAlgorithm;
  pixelSize: number;
  patternStyle?: PatternStyle;
  bgFill: boolean;
  pressureLinked: boolean;
  seed: number;
};

export type StampDitherState = {
  stampDitherOrigin?: { x: number; y: number } | null;
  stampDitherSeed?: number;
  stampDitherPressureState?: ReturnType<typeof createPressureResolutionState> | null;
  stampDitherPressureStable?: number;
  stampDitherPressureLast?: number;
  stampDitherPressureLastTime?: number;
  stampDitherPressureSampleCount?: number;
  stampDitherTag?: Uint32Array;
  stampDitherStrokeEpoch?: number;
  stampDitherStampSeq?: number;
  stampSeqMeta?: Array<[number, number]>;
  stampSeqToTileScale?: Uint16Array;
  stampDitherPrimaryBuffer?: Uint8Array;
  stampDitherBaseIdx?: Uint8Array;
  stampDitherBaseGid?: Uint8Array;
  stampDitherBaseDef?: Uint16Array;
  stampDitherBaseTag?: Uint16Array;
  stampDitherLockedBucket?: number;
  stampDitherStrokeScale?: number;
  stampDitherOriginUnits?: { x: number; y: number } | null;
  stampDitherOriginBaseSize?: number;
  stampDitherBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  stampDitherLastTileScale?: number | null;
  stampDitherChoice?: Uint8Array;
  stampDitherRecomposeLastMs?: number;
  stampDitherRecomposePending?: boolean;
  stampDitherRecomposeScale?: number;
  stampDitherFillHandle?: ReturnType<ColorCycleAnimator['beginDirectFill']>;
};

export type StampDitherRuntime = {
  baseTiles: Map<string, Uint8Array>;
  tiles: Map<string, Uint8Array>;
};

export type StampDitherShape =
  | 'square'
  | 'round'
  | 'triangle'
  | 'diamond'
  | 'diamond5'
  | 'diamond7'
  | 'diamond9'
  | 'checkered';

type ErrorDiffusionTap = { dx: number; dy: number; weight: number };

type StampDitherStrokeData = StampDitherState & {
  paintBuffer: Uint8Array;
  gradientIdBuffer?: Uint8Array;
  gradientDefIdBuffer?: Uint16Array;
  speedBuffer?: Uint8Array;
  stampSeqMeta?: Array<[number, number]>;
  stampSeqToTileScale?: Uint16Array;
};

export const STAMP_DITHER_BUCKETS = 64;
const STAMP_DITHER_TILE_BASE_MIN = 64;
const STAMP_DITHER_TILE_BASE_MAX = 128;
const STAMP_DITHER_TILE_TARGET = 128;
const STAMP_DITHER_PHASE_STEPS = 8;
const STAMP_DITHER_COVERAGE_MIN = 0.25;
const STAMP_DITHER_COVERAGE_MAX = 0.75;
const STAMP_DITHER_COVERAGE_CLAMP_MIN = 0.35;
const STAMP_DITHER_COVERAGE_CLAMP_MAX = 0.65;
const STAMP_DITHER_PRESSURE_SMOOTHING = 0.6;
const STAMP_DITHER_PRESSURE_MAX_DECAY_PER_MS = 0.003;
const STAMP_DITHER_PRESSURE_MIN_DROP = 0.01;
const STAMP_DITHER_PRESSURE_SAMPLE_WINDOW = 5;
const STAMP_DITHER_PEN_LIFT_THRESHOLD = 0.02;
const DIAMOND_5_MASK: ReadonlyArray<number> = [
  0, 0, 1, 0, 0,
  0, 1, 1, 1, 0,
  1, 1, 1, 1, 1,
  0, 1, 1, 1, 0,
  0, 0, 1, 0, 0,
];
const DIAMOND_7_MASK: ReadonlyArray<number> = [
  0, 0, 0, 1, 0, 0, 0,
  0, 0, 1, 1, 1, 0, 0,
  0, 1, 1, 1, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1,
  0, 1, 1, 1, 1, 1, 0,
  0, 0, 1, 1, 1, 0, 0,
  0, 0, 0, 1, 0, 0, 0,
];
const DIAMOND_9_MASK: ReadonlyArray<number> = [
  0, 0, 0, 0, 1, 0, 0, 0, 0,
  0, 0, 0, 1, 1, 1, 0, 0, 0,
  0, 0, 1, 1, 1, 1, 1, 0, 0,
  0, 1, 1, 1, 1, 1, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1,
  0, 1, 1, 1, 1, 1, 1, 1, 0,
  0, 0, 1, 1, 1, 1, 1, 0, 0,
  0, 0, 0, 1, 1, 1, 0, 0, 0,
  0, 0, 0, 0, 1, 0, 0, 0, 0,
];
const CHECKERED_4_MASK: ReadonlyArray<number> = [
  1, 0, 1, 0,
  0, 1, 0, 1,
  1, 0, 1, 0,
  0, 1, 0, 1,
];
export const STAMP_DITHER_FINALIZE_ERROR_DIFFUSION_ALGOS: ReadonlySet<StampDitherAlgorithm> = new Set([
  'floyd-steinberg',
  'jarvis-judice-ninke',
  'stucki',
  'burkes',
  'sierra-3',
  'sierra-2',
  'sierra-lite',
  'atkinson',
]);

const isTileMaskAlgorithm = (algo?: StampDitherAlgorithm): boolean => {
  switch (algo) {
    case 'bayer':
    case 'blue-noise':
    case 'void-and-cluster':
    case 'pattern':
      return true;
    default:
      return false;
  }
};

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const resolveStampDitherPressure = (state: StampDitherState, pressure: number): number => {
  const p = Math.max(0, Math.min(1, pressure));
  const last = state.stampDitherPressureLast ?? 0;
  const smoothed = last === 0
    ? p
    : last + (p - last) * STAMP_DITHER_PRESSURE_SMOOTHING;

  const now = nowMs();
  const lastTime = state.stampDitherPressureLastTime ?? 0;
  const elapsed = lastTime === 0 ? 0 : Math.max(0, now - lastTime);
  state.stampDitherPressureLastTime = now;

  const sampleCount = (state.stampDitherPressureSampleCount ?? 0) + 1;
  state.stampDitherPressureSampleCount = sampleCount;

  const isEarlySample = sampleCount <= STAMP_DITHER_PRESSURE_SAMPLE_WINDOW;
  const isPenLift = p <= STAMP_DITHER_PEN_LIFT_THRESHOLD;

  let stable = state.stampDitherPressureStable ?? smoothed;
  if (isPenLift) {
    // Freeze stable on pen-lift to avoid resolution collapse at tail.
  } else if (smoothed >= stable || isEarlySample) {
    stable = smoothed;
  } else {
    const isLowPressure = smoothed < 0.25;
    const decayMultiplier = isLowPressure ? 4.0 : 1.0;
    const timeDrop = Math.max(0, elapsed * STAMP_DITHER_PRESSURE_MAX_DECAY_PER_MS * decayMultiplier);
    const maxDrop = Math.max(timeDrop, STAMP_DITHER_PRESSURE_MIN_DROP);
    stable = Math.max(smoothed, stable - maxDrop);
  }

  state.stampDitherPressureStable = stable;
  state.stampDitherPressureLast = p;

  return stable > 0 ? stable : p;
};

export const createStampDitherRuntime = (): StampDitherRuntime => ({
  baseTiles: new Map(),
  tiles: new Map(),
});

export const clearStampDitherRuntime = (runtime: StampDitherRuntime) => {
  runtime.baseTiles.clear();
  runtime.tiles.clear();
};

export const resolveStampDitherCoverage = (
  phase: number,
  colorIndex: number,
  isAnimating: boolean
): number => {
  const basePhase = isAnimating ? phase : 0.5;
  const clamped = Math.max(0, Math.min(1, basePhase));
  const steps = Math.max(2, STAMP_DITHER_PHASE_STEPS);
  const snapped = Math.round(clamped * (steps - 1)) / (steps - 1);
  const eased = STAMP_DITHER_COVERAGE_MIN +
    (STAMP_DITHER_COVERAGE_MAX - STAMP_DITHER_COVERAGE_MIN) * snapped;
  const normalizedIndex = Math.max(0, Math.min(1, (colorIndex - 1) / 254));
  const extremity = Math.abs(normalizedIndex - 0.5) * 2;
  const pullToMid = Math.min(1, extremity * 0.85);
  const blended = eased + (0.5 - eased) * pullToMid;
  return Math.max(STAMP_DITHER_COVERAGE_CLAMP_MIN, Math.min(STAMP_DITHER_COVERAGE_CLAMP_MAX, blended));
};

export const resolveStampDitherBucket = (fraction: number): number => {
  const clamped = Math.max(0, Math.min(1, fraction));
  return Math.round(clamped * (STAMP_DITHER_BUCKETS - 1));
};

export const resolveStampDitherBaseSize = (tileScale: number): number => {
  const scale = Math.max(1, Math.floor(tileScale));
  const raw = Math.ceil(STAMP_DITHER_TILE_TARGET / scale);
  const clamped = Math.max(STAMP_DITHER_TILE_BASE_MIN, Math.min(STAMP_DITHER_TILE_BASE_MAX, raw));
  const rounded = Math.ceil(clamped / 8) * 8;
  return Math.max(STAMP_DITHER_TILE_BASE_MIN, Math.min(STAMP_DITHER_TILE_BASE_MAX, rounded));
};

export const resolveStampDitherTileSample = (
  tile: Uint8Array,
  tileSize: number,
  worldX: number,
  worldY: number,
  originX: number,
  originY: number,
  seed: number
): number => {
  const size = Math.max(1, Math.floor(tileSize));
  const relX = worldX - originX;
  const relY = worldY - originY;
  const blockX = Math.floor(relX / size);
  const blockY = Math.floor(relY / size);
  let h = seed ^ Math.imul(blockX + 1, 0x27d4eb2d) ^ Math.imul(blockY + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  const flipX = (h & 1) === 1;
  const flipY = (h & 2) === 2;
  const swap = (h & 4) === 4;
  const offsetX = (h >>> 3) % size;
  const offsetY = (h >>> 19) % size;

  let x = ((relX % size) + size) % size;
  let y = ((relY % size) + size) % size;
  x = (x + offsetX) % size;
  y = (y + offsetY) % size;
  if (swap) {
    const tmp = x;
    x = y;
    y = tmp;
  }
  if (flipX) x = size - 1 - x;
  if (flipY) y = size - 1 - y;

  const idx = (y * size + x) % tile.length;
  return tile[idx] ? 0.0 : 1.0;
};

export const resolveStampDitherSecondaryIndex = (primaryIndex: number): number => {
  const offset = 64;
  if (!Number.isFinite(primaryIndex)) {
    return 1;
  }
  let next = Math.round(primaryIndex + offset);
  while (next > 255) {
    next -= 255;
  }
  if (next === primaryIndex) {
    next = primaryIndex > 1 ? primaryIndex - 1 : Math.min(255, primaryIndex + 1);
  }
  return Math.max(1, Math.min(255, next));
};

const isErrorDiffusionAlgorithm = (algo?: StampDitherAlgorithm): boolean => {
  switch (algo) {
    case 'floyd-steinberg':
    case 'jarvis-judice-ninke':
    case 'stucki':
    case 'burkes':
    case 'sierra-3':
    case 'sierra-2':
    case 'sierra-lite':
    case 'atkinson':
      return true;
    default:
      return false;
  }
};

const getErrorDiffusionKernel = (algo: StampDitherAlgorithm): {
  taps: ErrorDiffusionTap[];
  divisor: number;
  serpentine: boolean;
  errorScale: number;
} => {
  switch (algo) {
    case 'floyd-steinberg':
      return {
        taps: [
          { dx: 1, dy: 0, weight: 7 },
          { dx: -1, dy: 1, weight: 3 },
          { dx: 0, dy: 1, weight: 5 },
          { dx: 1, dy: 1, weight: 1 },
        ],
        divisor: 16,
        serpentine: true,
        errorScale: 1,
      };
    case 'jarvis-judice-ninke':
      return {
        taps: [
          { dx: 1, dy: 0, weight: 7 }, { dx: 2, dy: 0, weight: 5 },
          { dx: -2, dy: 1, weight: 3 }, { dx: -1, dy: 1, weight: 5 }, { dx: 0, dy: 1, weight: 7 }, { dx: 1, dy: 1, weight: 5 }, { dx: 2, dy: 1, weight: 3 },
          { dx: -2, dy: 2, weight: 1 }, { dx: -1, dy: 2, weight: 3 }, { dx: 0, dy: 2, weight: 5 }, { dx: 1, dy: 2, weight: 3 }, { dx: 2, dy: 2, weight: 1 },
        ],
        divisor: 48,
        serpentine: true,
        errorScale: 1,
      };
    case 'stucki':
      return {
        taps: [
          { dx: 1, dy: 0, weight: 8 }, { dx: 2, dy: 0, weight: 4 },
          { dx: -2, dy: 1, weight: 2 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 8 }, { dx: 1, dy: 1, weight: 4 }, { dx: 2, dy: 1, weight: 2 },
          { dx: -2, dy: 2, weight: 1 }, { dx: -1, dy: 2, weight: 2 }, { dx: 0, dy: 2, weight: 4 }, { dx: 1, dy: 2, weight: 2 }, { dx: 2, dy: 2, weight: 1 },
        ],
        divisor: 42,
        serpentine: true,
        errorScale: 1,
      };
    case 'burkes':
      return {
        taps: [
          { dx: 1, dy: 0, weight: 8 }, { dx: 2, dy: 0, weight: 4 },
          { dx: -2, dy: 1, weight: 2 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 8 }, { dx: 1, dy: 1, weight: 4 }, { dx: 2, dy: 1, weight: 2 },
        ],
        divisor: 32,
        serpentine: true,
        errorScale: 1,
      };
    case 'sierra-3':
      return {
        taps: [
          { dx: 1, dy: 0, weight: 5 }, { dx: 2, dy: 0, weight: 3 },
          { dx: -2, dy: 1, weight: 2 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 5 }, { dx: 1, dy: 1, weight: 4 }, { dx: 2, dy: 1, weight: 2 },
          { dx: -1, dy: 2, weight: 2 }, { dx: 0, dy: 2, weight: 3 }, { dx: 1, dy: 2, weight: 2 },
        ],
        divisor: 32,
        serpentine: true,
        errorScale: 1,
      };
    case 'sierra-2':
      return {
        taps: [
          { dx: 1, dy: 0, weight: 4 }, { dx: 2, dy: 0, weight: 3 },
          { dx: -2, dy: 1, weight: 1 }, { dx: -1, dy: 1, weight: 2 }, { dx: 0, dy: 1, weight: 3 }, { dx: 1, dy: 1, weight: 2 }, { dx: 2, dy: 1, weight: 1 },
        ],
        divisor: 32,
        serpentine: true,
        errorScale: 1,
      };
    case 'atkinson':
      return {
        taps: [
          { dx: 1, dy: 0, weight: 1 }, { dx: 2, dy: 0, weight: 1 },
          { dx: -1, dy: 1, weight: 1 }, { dx: 0, dy: 1, weight: 1 }, { dx: 1, dy: 1, weight: 1 },
          { dx: 0, dy: 2, weight: 1 },
        ],
        divisor: 8,
        serpentine: true,
        errorScale: 0.75,
      };
    case 'sierra-lite':
    default:
      return {
        taps: [
          { dx: 1, dy: 0, weight: 2 },
          { dx: -1, dy: 1, weight: 1 },
          { dx: 0, dy: 1, weight: 1 },
        ],
        divisor: 4,
        serpentine: true,
        errorScale: 1,
      };
  }
};

const hashCellNoise = (seed: number, cellX: number, cellY: number): number => {
  let h = seed ^ Math.imul(cellX + 1, 0x27d4eb2d) ^ Math.imul(cellY + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967295;
};

export const ensureStampDitherBuffers = (strokeData: StampDitherStrokeData, width: number, height: number) => {
  const size = Math.max(1, width * height);
  if (!strokeData.stampDitherPrimaryBuffer || strokeData.stampDitherPrimaryBuffer.length !== size) {
    strokeData.stampDitherPrimaryBuffer = new Uint8Array(size);
  }
};

export const ensureStampDitherBaseBuffers = (
  strokeData: StampDitherStrokeData,
  width: number,
  height: number
) => {
  const size = Math.max(1, width * height);
  if (!strokeData.stampDitherBaseIdx || strokeData.stampDitherBaseIdx.length !== size) {
    strokeData.stampDitherBaseIdx = new Uint8Array(size);
  }
  if (!strokeData.stampDitherBaseGid || strokeData.stampDitherBaseGid.length !== size) {
    strokeData.stampDitherBaseGid = new Uint8Array(size);
  }
  if (!strokeData.stampDitherBaseDef || strokeData.stampDitherBaseDef.length !== size) {
    strokeData.stampDitherBaseDef = new Uint16Array(size);
  }
  if (!strokeData.stampDitherBaseTag || strokeData.stampDitherBaseTag.length !== size) {
    strokeData.stampDitherBaseTag = new Uint16Array(size);
  }
};

export const ensureStampDitherTag = (strokeData: StampDitherStrokeData, width: number, height: number) => {
  const size = Math.max(1, width * height);
  if (!strokeData.stampDitherTag || strokeData.stampDitherTag.length !== size) {
    strokeData.stampDitherTag = new Uint32Array(size);
  }
};

const updateStampDitherBounds = (
  strokeData: StampDitherStrokeData,
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
) => {
  const clampedMinX = Math.max(0, Math.min(width - 1, minX));
  const clampedMaxX = Math.max(0, Math.min(width - 1, maxX));
  const clampedMinY = Math.max(0, Math.min(height - 1, minY));
  const clampedMaxY = Math.max(0, Math.min(height - 1, maxY));
  if (!strokeData.stampDitherBounds) {
    strokeData.stampDitherBounds = {
      minX: clampedMinX,
      minY: clampedMinY,
      maxX: clampedMaxX,
      maxY: clampedMaxY,
    };
    return;
  }
  strokeData.stampDitherBounds.minX = Math.min(strokeData.stampDitherBounds.minX, clampedMinX);
  strokeData.stampDitherBounds.minY = Math.min(strokeData.stampDitherBounds.minY, clampedMinY);
  strokeData.stampDitherBounds.maxX = Math.max(strokeData.stampDitherBounds.maxX, clampedMaxX);
  strokeData.stampDitherBounds.maxY = Math.max(strokeData.stampDitherBounds.maxY, clampedMaxY);
};

const applyStampDitherMask = (
  strokeData: StampDitherStrokeData,
  width: number,
  height: number,
  shape: StampDitherShape,
  x: number,
  y: number,
  brushSize: number,
  primaryIndex: number,
  stampSeq: number,
  bgFill: boolean
): { minX: number; minY: number; maxX: number; maxY: number } => {
  ensureStampDitherBuffers(strokeData, width, height);
  ensureStampDitherTag(strokeData, width, height);
  const primary = strokeData.stampDitherPrimaryBuffer!;
  const tag = strokeData.stampDitherTag!;
  const captureBase = !bgFill && !!strokeData.stampDitherBaseTag;
  const baseTag = strokeData.stampDitherBaseTag;
  const baseIdx = strokeData.stampDitherBaseIdx;
  const baseGid = strokeData.stampDitherBaseGid;
  const baseDef = strokeData.stampDitherBaseDef;
  const paint = strokeData.paintBuffer;
  const gid = strokeData.gradientIdBuffer;
  const def = strokeData.gradientDefIdBuffer;
  const strokeEpoch = strokeData.stampDitherStrokeEpoch ?? 1;
  const captureIfNeeded = (idx: number) => {
    if (!captureBase || !baseTag || !baseIdx) return;
    if (baseTag[idx] === strokeEpoch) return;
    baseTag[idx] = strokeEpoch;
    baseIdx[idx] = paint[idx];
    if (baseGid && gid) {
      baseGid[idx] = gid[idx];
    }
    if (baseDef && def) {
      baseDef[idx] = def[idx];
    }
  };

  const tagValue = ((strokeEpoch & 0xffff) << 16) | (stampSeq & 0xffff);

  if (shape === 'triangle') {
    const halfSize = brushSize / 2;
    const topX = x;
    const topY = y - halfSize;
    const leftX = x - halfSize;
    const leftY = y + halfSize;
    const rightX = x + halfSize;
    const rightY = y + halfSize;
    const minX = Math.max(0, Math.floor(Math.min(leftX, rightX, topX)));
    const maxX = Math.min(width - 1, Math.floor(Math.max(leftX, rightX, topX)));
    const minY = Math.max(0, Math.floor(Math.min(topY, leftY, rightY)));
    const maxY = Math.min(height - 1, Math.floor(Math.max(topY, leftY, rightY)));
    const sign = (px: number, py: number, ax: number, ay: number, bx: number, by: number) =>
      (px - bx) * (ay - by) - (ax - bx) * (py - by);

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const sampleX = px + 0.5;
        const sampleY = py + 0.5;
        const b1 = sign(sampleX, sampleY, topX, topY, leftX, leftY) <= 0;
        const b2 = sign(sampleX, sampleY, leftX, leftY, rightX, rightY) <= 0;
        const b3 = sign(sampleX, sampleY, rightX, rightY, topX, topY) <= 0;
        if ((b1 === b2) && (b2 === b3)) {
          const idx = py * width + px;
          captureIfNeeded(idx);
          primary[idx] = primaryIndex;
          tag[idx] = tagValue;
        }
      }
    }
    updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
    return { minX, minY, maxX, maxY };
  }

  if (shape === 'round') {
    const radius = brushSize / 2;
    const radiusSq = radius * radius;
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(width - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(height - 1, Math.ceil(y + radius));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dx = px + 0.5 - x;
        const dy = py + 0.5 - y;
        if (dx * dx + dy * dy > radiusSq) continue;
        const idx = py * width + px;
        captureIfNeeded(idx);
        primary[idx] = primaryIndex;
        tag[idx] = tagValue;
      }
    }
    updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
    return { minX, minY, maxX, maxY };
  }

  if (shape === 'diamond') {
    const radius = brushSize / 2;
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(width - 1, Math.floor(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(height - 1, Math.floor(y + radius));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dx = Math.abs(px + 0.5 - x);
        const dy = Math.abs(py + 0.5 - y);
        if (dx + dy > radius) continue;
        const idx = py * width + px;
        captureIfNeeded(idx);
        primary[idx] = primaryIndex;
        tag[idx] = tagValue;
      }
    }
    updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
    return { minX, minY, maxX, maxY };
  }

  if (shape === 'diamond5') {
    const pixelScale = Math.max(1, Math.round(brushSize / 5));
    const stampSize = 5 * pixelScale;
    const originX = Math.floor(x - stampSize / 2);
    const originY = Math.floor(y - stampSize / 2);
    const minX = Math.max(0, originX);
    const maxX = Math.min(width - 1, originX + stampSize - 1);
    const minY = Math.max(0, originY);
    const maxY = Math.min(height - 1, originY + stampSize - 1);
    for (let py = minY; py <= maxY; py++) {
      const localY = py - originY;
      const cellY = Math.max(0, Math.min(4, Math.floor(localY / pixelScale)));
      for (let px = minX; px <= maxX; px++) {
        const localX = px - originX;
        const cellX = Math.max(0, Math.min(4, Math.floor(localX / pixelScale)));
        if (DIAMOND_5_MASK[cellY * 5 + cellX] === 0) continue;
        const idx = py * width + px;
        captureIfNeeded(idx);
        primary[idx] = primaryIndex;
        tag[idx] = tagValue;
      }
    }
    updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
    return { minX, minY, maxX, maxY };
  }

  if (shape === 'diamond7' || shape === 'diamond9') {
    const gridSize = shape === 'diamond7' ? 7 : 9;
    const mask = shape === 'diamond7' ? DIAMOND_7_MASK : DIAMOND_9_MASK;
    const pixelScale = Math.max(1, Math.round(brushSize / gridSize));
    const stampSize = gridSize * pixelScale;
    const originX = Math.floor(x - stampSize / 2);
    const originY = Math.floor(y - stampSize / 2);
    const minX = Math.max(0, originX);
    const maxX = Math.min(width - 1, originX + stampSize - 1);
    const minY = Math.max(0, originY);
    const maxY = Math.min(height - 1, originY + stampSize - 1);
    for (let py = minY; py <= maxY; py++) {
      const localY = py - originY;
      const cellY = Math.max(0, Math.min(gridSize - 1, Math.floor(localY / pixelScale)));
      for (let px = minX; px <= maxX; px++) {
        const localX = px - originX;
        const cellX = Math.max(0, Math.min(gridSize - 1, Math.floor(localX / pixelScale)));
        if (mask[cellY * gridSize + cellX] === 0) continue;
        const idx = py * width + px;
        captureIfNeeded(idx);
        primary[idx] = primaryIndex;
        tag[idx] = tagValue;
      }
    }
    updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
    return { minX, minY, maxX, maxY };
  }

  if (shape === 'checkered') {
    const gridSize = 4;
    const pixelScale = Math.max(1, Math.round(brushSize / gridSize));
    const stampSize = gridSize * pixelScale;
    const originX = Math.floor(x - stampSize / 2);
    const originY = Math.floor(y - stampSize / 2);
    const minX = Math.max(0, originX);
    const maxX = Math.min(width - 1, originX + stampSize - 1);
    const minY = Math.max(0, originY);
    const maxY = Math.min(height - 1, originY + stampSize - 1);
    for (let py = minY; py <= maxY; py++) {
      const localY = py - originY;
      const cellY = Math.max(0, Math.min(gridSize - 1, Math.floor(localY / pixelScale)));
      for (let px = minX; px <= maxX; px++) {
        const localX = px - originX;
        const cellX = Math.max(0, Math.min(gridSize - 1, Math.floor(localX / pixelScale)));
        if (CHECKERED_4_MASK[cellY * gridSize + cellX] === 0) continue;
        const idx = py * width + px;
        captureIfNeeded(idx);
        primary[idx] = primaryIndex;
        tag[idx] = tagValue;
      }
    }
    updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
    return { minX, minY, maxX, maxY };
  }

  // square (default)
  const halfSize = brushSize / 2;
  const minX = Math.max(0, Math.floor(x - halfSize));
  const maxX = Math.min(width - 1, Math.floor(x + halfSize));
  const minY = Math.max(0, Math.floor(y - halfSize));
  const maxY = Math.min(height - 1, Math.floor(y + halfSize));
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const idx = py * width + px;
      captureIfNeeded(idx);
      primary[idx] = primaryIndex;
      tag[idx] = tagValue;
    }
  }
  updateStampDitherBounds(strokeData, width, height, minX, minY, maxX, maxY);
  return { minX, minY, maxX, maxY };
};

const buildBaseStampDitherTile = (
  bucket: number,
  baseSize: number,
  algo: StampDitherAlgorithm,
  pattern: PatternStyle
): Uint8Array => {
  const tileSize = Math.max(1, Math.floor(baseSize));
  const clampedBucket = Math.max(0, Math.min(STAMP_DITHER_BUCKETS - 1, bucket));
  const coverage = clampedBucket / Math.max(1, STAMP_DITHER_BUCKETS - 1);
  if (algo === 'pattern') {
    const result = new Uint8Array(tileSize * tileSize);
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        const patternValue = resolveCcPatternThreshold(pattern, x, y, coverage);
        result[y * tileSize + x] = patternValue <= coverage ? 1 : 0;
      }
    }
    return result;
  }
  const result = new Uint8Array(tileSize * tileSize);
  const toByte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
  const fillFromMatrix = (matrix: number[][]) => {
    const matrixSize = matrix.length;
    for (let y = 0; y < tileSize; y += 1) {
      const row = matrix[y % matrixSize];
      for (let x = 0; x < tileSize; x += 1) {
        const threshold = row[x % matrixSize];
        result[y * tileSize + x] = toByte(threshold);
      }
    }
  };

  if (algo === 'bayer') {
    fillFromMatrix(BAYER_8x8_MATRIX);
    return result;
  }
  if (algo === 'blue-noise') {
    fillFromMatrix(BLUE_NOISE_16x16);
    return result;
  }
  if (algo === 'void-and-cluster') {
    fillFromMatrix(VOID_CLUSTER_8x8);
    return result;
  }
  const noiseSeed = 0x9e3779b9 ^ (clampedBucket << 8) ^ tileSize;
  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      result[y * tileSize + x] = toByte(hashCellNoise(noiseSeed, x, y));
    }
  }
  return result;
};

const scaleStampDitherTile = (base: Uint8Array, scale: number, baseSize: number): Uint8Array => {
  if (scale <= 1) {
    return base;
  }
  const baseTileSize = Math.max(1, Math.floor(baseSize));
  const scaledSize = baseTileSize * scale;
  const scaled = new Uint8Array(scaledSize * scaledSize);
  for (let y = 0; y < scaledSize; y++) {
    const baseY = Math.floor(y / scale);
    for (let x = 0; x < scaledSize; x++) {
      const baseX = Math.floor(x / scale);
      const baseIdx = baseY * baseTileSize + baseX;
      scaled[y * scaledSize + x] = base[baseIdx];
    }
  }
  return scaled;
};

const getBaseStampDitherTile = (
  runtime: StampDitherRuntime,
  bucket: number,
  baseSize: number,
  algoOverride: StampDitherAlgorithm,
  patternOverride: PatternStyle
): Uint8Array => {
  const normalizedBucket = Math.max(0, Math.min(STAMP_DITHER_BUCKETS - 1, bucket | 0));
  const algo = algoOverride;
  const pattern = patternOverride;
  const sizeKey = Math.max(1, Math.floor(baseSize));
  const cacheKey = `${algo}|${pattern}|${normalizedBucket}|${sizeKey}`;
  let tile = runtime.baseTiles.get(cacheKey);
  if (!tile) {
    tile = buildBaseStampDitherTile(normalizedBucket, sizeKey, algo, pattern);
    runtime.baseTiles.set(cacheKey, tile);
  }
  return tile;
};

const getStampDitherTile = (
  runtime: StampDitherRuntime,
  bucket: number,
  overrideScale: number,
  baseSize: number,
  algoOverride: StampDitherAlgorithm,
  patternOverride: PatternStyle
): Uint8Array => {
  const normalizedBucket = Math.max(0, Math.min(STAMP_DITHER_BUCKETS - 1, bucket | 0));
  const algo = algoOverride;
  const pattern = patternOverride;
  const scale = Math.max(1, Math.floor(overrideScale));
  const sizeKey = Math.max(1, Math.floor(baseSize));
  const cacheKey = `${algo}|${pattern}|${normalizedBucket}|${sizeKey}|${scale}`;
  let tile = runtime.tiles.get(cacheKey);
  if (!tile) {
    const baseTile = getBaseStampDitherTile(runtime, normalizedBucket, sizeKey, algo, pattern);
    tile = scale === 1 ? baseTile : scaleStampDitherTile(baseTile, scale, sizeKey);
    runtime.tiles.set(cacheKey, tile);
  }
  return tile;
};

const replayStampDitherRuntime: StampDitherRuntime = createStampDitherRuntime();

const hasRecordedStampScales = (strokeData: StampDitherStrokeData): boolean =>
  Array.isArray(strokeData.stampSeqMeta) && strokeData.stampSeqMeta.length > 0;

const resolvePatternFinalizeFallbackScale = (
  strokeData: StampDitherStrokeData,
  config: StampDitherConfig
): number => {
  if (hasRecordedStampScales(strokeData)) {
    return Math.max(1, strokeData.stampDitherStrokeScale ?? config.pixelSize);
  }
  return Math.max(1, config.pixelSize);
};

export const sampleStampDitherReplayMask = ({
  x,
  y,
  coverage,
  seed,
  tileScale,
  originX,
  originY,
  algorithm,
  patternStyle,
}: {
  x: number;
  y: number;
  coverage: number;
  seed: number;
  tileScale: number;
  originX: number;
  originY: number;
  algorithm: StampDitherAlgorithm;
  patternStyle: PatternStyle;
}): number => {
  const scale = Math.max(1, Math.floor(tileScale));
  const clampedCoverage = Math.max(0, Math.min(1, coverage));
  const bucket = resolveStampDitherBucket(clampedCoverage);
  const baseSize = resolveStampDitherBaseSize(scale);
  const tile = getStampDitherTile(
    replayStampDitherRuntime,
    bucket,
    scale,
    baseSize,
    algorithm,
    patternStyle
  );
  return resolveStampDitherTileSample(
    tile,
    baseSize * scale,
    x,
    y,
    originX,
    originY,
    seed >>> 0
  );
};

const applyStampDitherToRegion = (
  strokeData: StampDitherStrokeData,
  animator: ColorCycleAnimator,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  tile: Uint8Array,
  tileSize: number,
  maskOriginX: number,
  maskOriginY: number,
  flowSlot: number,
  stampSeq: number,
  cycleSpeed: number,
  bgFill: boolean,
  algo: StampDitherAlgorithm,
  coverage: number
) => {
  const primary = strokeData.stampDitherPrimaryBuffer;
  const tag = strokeData.stampDitherTag;
  if (!primary || !tag) {
    return;
  }
  const strokeEpoch = strokeData.stampDitherStrokeEpoch ?? 1;
  const tagValue = ((strokeEpoch & 0xffff) << 16) | (stampSeq & 0xffff);

  const handle = strokeData.stampDitherFillHandle ?? animator.beginDirectFill();
  const shouldCloseHandle = !strokeData.stampDitherFillHandle;
  const data = handle.data;
  const gradientId = handle.gradientId;
  const speedData = handle.speedData;
  const defData = strokeData.gradientDefIdBuffer;
  const speedByte = encodeColorCycleSpeedByte(cycleSpeed);
  const width = handle.width;
  const minX = Math.max(0, Math.min(width - 1, bounds.minX));
  const maxX = Math.max(0, Math.min(width - 1, bounds.maxX));
  const minY = Math.max(0, Math.min(handle.height - 1, bounds.minY));
  const maxY = Math.max(0, Math.min(handle.height - 1, bounds.maxY));
  const tileClamp = Math.max(1, Math.floor(tileSize));
  const bgFillOff = !bgFill;

  const coverageByte = Math.max(0, Math.min(255, Math.round(coverage * 255)));
  for (let py = minY; py <= maxY; py++) {
    const rowOffset = py * width;
    const localY = ((py - maskOriginY) % tileClamp + tileClamp) % tileClamp;
    const tileRow = localY * tileClamp;
    let localX = ((minX - maskOriginX) % tileClamp + tileClamp) % tileClamp;
    for (let px = minX; px <= maxX; px++) {
      const idx = rowOffset + px;
      if (tag[idx] !== tagValue) {
        localX += 1;
        if (localX === tileClamp) localX = 0;
        continue;
      }
      const tileIdx = tileRow + localX;
      const t = tile ? tile[tileIdx] : 0;
      const usePrimary =
        algo === 'pattern'
          ? (t === 1)
          : (t <= coverageByte);
      if (bgFillOff && !usePrimary) {
        const base = strokeData.stampDitherBaseIdx;
        const baseG = strokeData.stampDitherBaseGid;
        const baseD = strokeData.stampDitherBaseDef;
        const baseTag = strokeData.stampDitherBaseTag;
        if (base && baseTag && base.length === data.length && baseTag[idx] === strokeEpoch) {
          const v = base[idx];
          data[idx] = v;
          if (v === 0) {
            gradientId[idx] = 0;
            speedData[idx] = 0;
            if (defData) defData[idx] = 0;
          } else if (baseG && baseG.length === gradientId.length) {
            gradientId[idx] = baseG[idx];
            if (defData) {
              defData[idx] = baseD && baseD.length === defData.length ? baseD[idx] : 0;
            }
          } else {
            gradientId[idx] = flowSlot;
            if (defData) defData[idx] = 0;
          }
        } else {
          localX += 1;
          if (localX === tileClamp) localX = 0;
          continue;
        }
        localX += 1;
        if (localX === tileClamp) localX = 0;
        continue;
      }
      const primaryIndex = primary[idx];

      if (usePrimary) {
        data[idx] = primaryIndex;
        gradientId[idx] = primaryIndex === 0 ? 0 : flowSlot;
        speedData[idx] = primaryIndex === 0 ? 0 : speedByte;
        if (defData) defData[idx] = 0;
        localX += 1;
        if (localX === tileClamp) localX = 0;
        continue;
      }

      const secondary = resolveStampDitherSecondaryIndex(primaryIndex);
      data[idx] = secondary;
      gradientId[idx] = secondary === 0 ? 0 : flowSlot;
      speedData[idx] = secondary === 0 ? 0 : speedByte;
      if (defData) defData[idx] = 0;
      localX += 1;
      if (localX === tileClamp) localX = 0;
    }
  }

  if (shouldCloseHandle) {
    const needsUpload = animator.hasWebGL?.() ?? false;
    animator.endDirectFill({ markDirty: needsUpload });
  }
  animator.markDirtyBounds({
    minX,
    minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  });
};

export const applyStampDitherStamp = (args: {
  animator: ColorCycleAnimator;
  state: StampDitherStrokeData;
  config: StampDitherConfig;
  runtime: StampDitherRuntime;
  stampShape: StampDitherShape;
  x: number;
  y: number;
  pressure: number;
  pressureSize: number;
  primaryIndex: number;
  flowSlot: number;
  cycleSpeed: number;
  width: number;
  height: number;
  isAnimating: boolean;
  onScheduleRecompose?: (tileScale: number) => void;
  perf?: {
    onMask?: (ms: number, bounds: { minX: number; minY: number; maxX: number; maxY: number }) => void;
    onApply?: (ms: number) => void;
  };
}): { didApply: boolean; bounds?: { minX: number; minY: number; maxX: number; maxY: number } } => {
  const {
    animator,
    state,
    config,
    runtime,
    stampShape,
    x,
    y,
    pressure,
    pressureSize,
    primaryIndex,
    flowSlot,
    cycleSpeed,
    width,
    height,
    isAnimating,
    onScheduleRecompose,
  } = args;

  const baseTileScale = Math.max(1, config.pixelSize);
  let tileScale = baseTileScale;
  if (config.pressureLinked) {
    const pressureState =
      state.stampDitherPressureState ?? createPressureResolutionState(1);
    state.stampDitherPressureState = pressureState;
    const stablePressure = resolveStampDitherPressure(state, pressure);
    const computed = computePressureResolution(
      baseTileScale,
      stablePressure,
      true,
      pressureState,
      undefined,
      PRESSURE_RESOLUTION_MAX_PX
    );
    tileScale = Math.max(1, Math.round(computed));
    if (state.stampSeqMeta?.length) {
      state.stampSeqMeta = undefined;
      state.stampSeqToTileScale = undefined;
    }
  } else {
    state.stampDitherPressureState = null;
    state.stampDitherStrokeScale = undefined;
  }
  state.stampDitherStrokeScale = tileScale;
  const tileScaleInt = tileScale;
  let tileSize = STAMP_DITHER_TILE_BASE_MIN * tileScaleInt;

  if (!config.bgFill && !state.stampDitherBaseTag) {
    ensureStampDitherBaseBuffers(state, width, height);
  }
  if (state.stampDitherLockedBucket == null) {
    const phaseForMask = 0.5;
    const coverage = resolveStampDitherCoverage(phaseForMask, primaryIndex, isAnimating);
    const rawBucket = resolveStampDitherBucket(coverage);
    state.stampDitherLockedBucket = Math.min(
      STAMP_DITHER_BUCKETS - 2,
      Math.max(1, rawBucket)
    );
  }

  const lastScale = state.stampDitherLastTileScale;
  if (lastScale == null) {
    state.stampDitherLastTileScale = tileScaleInt;
  } else if (lastScale !== tileScaleInt) {
    state.stampDitherLastTileScale = tileScaleInt;
    onScheduleRecompose?.(tileScaleInt);
  }

  const rawAlgo = config.algorithm || 'sierra-lite';
  const algo: StampDitherAlgorithm = rawAlgo === 'pattern' ? 'pattern' : 'sierra-lite';
  const baseSize = resolveStampDitherBaseSize(tileScaleInt);
  if (!state.stampDitherOriginUnits || state.stampDitherOriginBaseSize !== baseSize) {
    const seed = config.seed ?? 0;
    state.stampDitherOriginUnits = {
      x: (seed % baseSize) | 0,
      y: ((seed >>> 16) % baseSize) | 0,
    };
    state.stampDitherOriginBaseSize = baseSize;
  }
  tileSize = baseSize * tileScaleInt;
  const originU = state.stampDitherOriginUnits ?? { x: 0, y: 0 };
  const maskOriginX = -originU.x * tileScaleInt;
  const maskOriginY = -originU.y * tileScaleInt;
  state.stampDitherOrigin = { x: maskOriginX, y: maskOriginY };

  const bucket = state.stampDitherLockedBucket ?? 1;
  const tile = getStampDitherTile(
    runtime,
    bucket,
    tileScaleInt,
    baseSize,
    algo,
    config.patternStyle ?? 'dots'
  );

  const nextSeq = (state.stampDitherStampSeq ?? 0) + 1;
  state.stampDitherStampSeq = nextSeq > 0xffff ? 0xffff : nextSeq;
  const stampSeq = state.stampDitherStampSeq ?? 1;

  const maskStart = nowMs();
  const stampBounds = applyStampDitherMask(
    state,
    width,
    height,
    stampShape,
    x,
    y,
    pressureSize,
    primaryIndex,
    stampSeq,
    config.bgFill
  );
  const maskMs = Math.max(0, nowMs() - maskStart);
  if (stampBounds) {
    args.perf?.onMask?.(maskMs, stampBounds);
  }
  if (stampBounds && state.stampSeqMeta) {
    state.stampSeqMeta.push([stampSeq, tileScaleInt]);
  }

  const coverage = bucket / Math.max(1, STAMP_DITHER_BUCKETS - 1);
  const applyStart = nowMs();
  applyStampDitherToRegion(
    state,
    animator,
    stampBounds,
    tile,
    tileSize,
    maskOriginX ?? stampBounds.minX,
    maskOriginY ?? stampBounds.minY,
    flowSlot,
    stampSeq,
    cycleSpeed,
    config.bgFill,
    algo,
    coverage
  );
  args.perf?.onApply?.(Math.max(0, nowMs() - applyStart));

  return { didApply: true, bounds: stampBounds };
};

const buildStampSeqToTileScale = (strokeData: StampDitherStrokeData, fallbackScale: number): Uint16Array => {
  const maxSeq = strokeData.stampDitherStampSeq ?? 0;
  let lut = strokeData.stampSeqToTileScale;
  if (!lut || lut.length !== maxSeq + 1) {
    lut = new Uint16Array(maxSeq + 1);
  } else {
    lut.fill(0);
  }
  const meta = strokeData.stampSeqMeta ?? [];
  for (const [seq, scale] of meta) {
    if (seq >= 0 && seq <= maxSeq) {
      lut[seq] = Math.max(1, Math.min(0xffff, scale | 0));
    }
  }
  if (lut.length > 0 && fallbackScale > 0) {
    lut[0] = Math.max(1, Math.min(0xffff, fallbackScale | 0));
  }
  strokeData.stampSeqToTileScale = lut;
  return lut;
};

export const recomposeStampDitherOverlay = (args: {
  state: StampDitherStrokeData;
  config: StampDitherConfig;
  runtime: StampDitherRuntime;
  animator: ColorCycleAnimator;
  flowSlot: number;
  cycleSpeed: number;
  tileScale: number;
}): void => {
  const {
    state,
    config,
    runtime,
    animator,
    flowSlot,
    cycleSpeed,
    tileScale,
  } = args;
  const bounds = state.stampDitherBounds;
  const tag = state.stampDitherTag;
  const primary = state.stampDitherPrimaryBuffer;
  const base = state.stampDitherBaseIdx;
  const baseG = state.stampDitherBaseGid;
  const baseD = state.stampDitherBaseDef;
  const baseTag = state.stampDitherBaseTag;
  if (!bounds || !tag || !primary) return;
  const rawAlgo = config.algorithm || 'sierra-lite';
  const algo = rawAlgo === 'pattern' ? 'pattern' : 'sierra-lite';
  const bucket = state.stampDitherLockedBucket ?? 1;
  const coverage = bucket / Math.max(1, STAMP_DITHER_BUCKETS - 1);
  const seed = config.seed ?? 0;
  const bgFillOff = !config.bgFill;
  if (bgFillOff && (!base || !baseTag)) {
    return;
  }
  const basePixelSize = Math.max(1, config.pixelSize);
  const fallbackScale = Math.max(1, tileScale || basePixelSize);
  const lut = buildStampSeqToTileScale(state, fallbackScale);
  const tileCache = new Map<number, { tile: Uint8Array; tileClamp: number; originX: number; originY: number }>();

  const handle = state.stampDitherFillHandle ?? animator.beginDirectFill();
  const shouldCloseHandle = !state.stampDitherFillHandle;
  const data = handle.data;
  const gid = handle.gradientId;
  const spd = handle.speedData;
  const def = state.gradientDefIdBuffer;
  const speedByte = encodeColorCycleSpeedByte(cycleSpeed);
  const w = handle.width;
  const h = handle.height;
  const minX = Math.max(0, Math.min(w - 1, bounds.minX));
  const maxX = Math.max(0, Math.min(w - 1, bounds.maxX));
  const minY = Math.max(0, Math.min(h - 1, bounds.minY));
  const maxY = Math.max(0, Math.min(h - 1, bounds.maxY));

  const strokeEpoch = state.stampDitherStrokeEpoch ?? 1;
  const coverageByte = Math.max(0, Math.min(255, Math.round(coverage * 255)));
  for (let y = minY; y <= maxY; y += 1) {
    const row = y * w;
    for (let x = minX; x <= maxX; x += 1) {
      const idx = row + x;
      const tagValue = tag[idx];
      if ((tagValue >>> 16) !== strokeEpoch) continue;
      const seq = tagValue & 0xffff;
      if (seq === 0) continue;
      const seqScale = lut[seq] || fallbackScale;
      let tileEntry = tileCache.get(seqScale);
      if (!tileEntry) {
        const baseSize = resolveStampDitherBaseSize(seqScale);
        const originU = {
          x: (seed % baseSize) | 0,
          y: ((seed >>> 16) % baseSize) | 0,
        };
        const originX = -originU.x * seqScale;
        const originY = -originU.y * seqScale;
        const tileClamp = baseSize * seqScale;
        const tile = getStampDitherTile(
          runtime,
          bucket,
          seqScale,
          baseSize,
          algo === 'pattern' ? 'pattern' : 'sierra-lite',
          config.patternStyle ?? 'dots'
        );
        tileEntry = { tile, tileClamp, originX, originY };
        tileCache.set(seqScale, tileEntry);
      }
      const localY = ((y - tileEntry.originY) % tileEntry.tileClamp + tileEntry.tileClamp) % tileEntry.tileClamp;
      const tileRow = localY * tileEntry.tileClamp;
      const localX = ((x - tileEntry.originX) % tileEntry.tileClamp + tileEntry.tileClamp) % tileEntry.tileClamp;
      const tIdx = tileRow + localX;
      const p = primary[idx];
      const usePrimary =
        algo === 'pattern'
          ? (tileEntry.tile[tIdx] === 1)
          : (tileEntry.tile[tIdx] <= coverageByte);
      if (usePrimary) {
        data[idx] = p;
        gid[idx] = p === 0 ? 0 : flowSlot;
        spd[idx] = p === 0 ? 0 : speedByte;
        if (def) def[idx] = 0;
        continue;
      }
      if (bgFillOff) {
        if (base && baseTag && base.length === data.length && baseTag[idx] === strokeEpoch) {
          const v = base[idx];
          data[idx] = v;
          if (v === 0) {
            gid[idx] = 0;
            spd[idx] = 0;
            if (def) def[idx] = 0;
          } else if (baseG && baseG.length === gid.length) {
            gid[idx] = baseG[idx];
            if (def) {
              def[idx] = baseD && baseD.length === def.length ? baseD[idx] : 0;
            }
          } else {
            gid[idx] = flowSlot;
            if (def) def[idx] = 0;
          }
        }
        continue;
      }
      const secondary = resolveStampDitherSecondaryIndex(p);
      data[idx] = secondary;
      gid[idx] = secondary === 0 ? 0 : flowSlot;
      spd[idx] = secondary === 0 ? 0 : speedByte;
      if (def) def[idx] = 0;
    }
  }

  if (shouldCloseHandle) {
    const needsUpload = animator.hasWebGL?.() ?? false;
    animator.endDirectFill({ markDirty: needsUpload });
  }
  animator.markDirtyBounds({
    minX,
    minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  });
};

export const scheduleStampDitherRecompose = (args: {
  state: StampDitherStrokeData;
  onRecompose: (tileScale: number) => void;
}): void => {
  const { state, onRecompose } = args;
  const now = nowMs();
  const last = state.stampDitherRecomposeLastMs ?? 0;
  const minInterval = 50;
  if (state.stampDitherRecomposePending) {
    return;
  }
  const run = () => {
    state.stampDitherRecomposePending = false;
    state.stampDitherRecomposeLastMs = nowMs();
    const nextScale = state.stampDitherRecomposeScale ?? 1;
    onRecompose(nextScale);
  };
  const elapsed = now - last;
  state.stampDitherRecomposePending = true;
  if (elapsed >= minInterval) {
    requestAnimationFrame(run);
  } else {
    const delay = Math.max(0, minInterval - elapsed);
    setTimeout(() => {
      requestAnimationFrame(run);
    }, delay);
  }
};

/**
 * finalizeStampDither:
 * Rewrites the completed stroke using the selected algorithm so mouse-up is authoritative,
 * even when the live preview used a lighter-weight approximation.
 */
export const finalizeStampDither = (args: {
  animator: ColorCycleAnimator;
  state: StampDitherStrokeData;
  config: StampDitherConfig;
  width: number;
  height: number;
  flowSlot: number;
  cycleSpeed: number;
  ditherStrength: number;
}): boolean => {
  const {
    animator,
    state,
    config,
    width,
    height,
    flowSlot,
    cycleSpeed,
    ditherStrength,
  } = args;
  const bounds = state.stampDitherBounds;
  const tag = state.stampDitherTag;
  const primary = state.stampDitherPrimaryBuffer;
  if (!bounds || !tag || !primary) return false;

  const algo = config.algorithm ?? 'sierra-lite';
  const isErrorDiffusion = isErrorDiffusionAlgorithm(algo);
  const isTileMask = isTileMaskAlgorithm(algo);
  if (!isErrorDiffusion && !isTileMask) return false;

  const fallbackScale = algo === 'pattern'
    ? resolvePatternFinalizeFallbackScale(state, config)
    : Math.max(1, state.stampDitherStrokeScale ?? config.pixelSize);
  const lut = buildStampSeqToTileScale(state, fallbackScale);

  const minX = Math.max(0, Math.min(width - 1, bounds.minX));
  const maxX = Math.max(0, Math.min(width - 1, bounds.maxX));
  const minY = Math.max(0, Math.min(height - 1, bounds.minY));
  const maxY = Math.max(0, Math.min(height - 1, bounds.maxY));
  if (maxX < minX || maxY < minY) return false;

  const choice = state.stampDitherChoice && state.stampDitherChoice.length === width * height
    ? state.stampDitherChoice
    : new Uint8Array(width * height);
  state.stampDitherChoice = choice;

  const scaleBounds = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
  const strokeEpoch = state.stampDitherStrokeEpoch ?? 1;
  for (let y = minY; y <= maxY; y += 1) {
    const row = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      const idx = row + x;
      const tagValue = tag[idx];
      if ((tagValue >>> 16) !== strokeEpoch) continue;
      const seq = tagValue & 0xffff;
      if (seq === 0) continue;
      const scale = lut[seq] || fallbackScale;
      let entry = scaleBounds.get(scale);
      if (!entry) {
        entry = { minX: x, minY: y, maxX: x, maxY: y };
        scaleBounds.set(scale, entry);
        continue;
      }
      entry.minX = Math.min(entry.minX, x);
      entry.minY = Math.min(entry.minY, y);
      entry.maxX = Math.max(entry.maxX, x);
      entry.maxY = Math.max(entry.maxY, y);
    }
  }

  if (scaleBounds.size === 0) return false;

  const bucket = state.stampDitherLockedBucket ?? 1;
  const coverage = bucket / Math.max(1, STAMP_DITHER_BUCKETS - 1);
  const seed = config.seed ?? 0;

  if (isErrorDiffusion) {
    const kernel = getErrorDiffusionKernel(algo);
    const effectiveStrength = ditherStrength > 0 ? ditherStrength : 1;
    const errorIntensity = Math.max(0, Math.min(1, effectiveStrength)) * kernel.errorScale;
    const jitterScale = 0.1 * errorIntensity;

    for (const [scale, scaleBound] of scaleBounds) {
      const cellSize = Math.max(1, scale);
      const minCellX = Math.floor(scaleBound.minX / cellSize);
      const maxCellX = Math.floor(scaleBound.maxX / cellSize);
      const minCellY = Math.floor(scaleBound.minY / cellSize);
      const maxCellY = Math.floor(scaleBound.maxY / cellSize);
      const gridW = Math.max(1, maxCellX - minCellX + 1);
      const gridH = Math.max(1, maxCellY - minCellY + 1);
      const cellCount = gridW * gridH;

      const cellMask = new Uint8Array(cellCount);
      for (let y = scaleBound.minY; y <= scaleBound.maxY; y += 1) {
        const row = y * width;
        const cellY = Math.floor(y / cellSize) - minCellY;
        for (let x = scaleBound.minX; x <= scaleBound.maxX; x += 1) {
          const idx = row + x;
          const tagValue = tag[idx];
          if ((tagValue >>> 16) !== strokeEpoch) continue;
          const seq = tagValue & 0xffff;
          if (seq === 0) continue;
          const seqScale = lut[seq] || fallbackScale;
          if (seqScale !== scale) continue;
          const cellX = Math.floor(x / cellSize) - minCellX;
          const cellIdx = cellY * gridW + cellX;
          cellMask[cellIdx] = 1;
        }
      }

      const cellChoice = new Uint8Array(cellCount);
      const errBuf = new Float32Array(cellCount);

      for (let cy = 0; cy < gridH; cy += 1) {
        const leftToRight = kernel.serpentine ? (cy & 1) === 0 : true;
        const xStart = leftToRight ? 0 : gridW - 1;
        const xEnd = leftToRight ? gridW : -1;
        const xStep = leftToRight ? 1 : -1;

        for (let cx = xStart; cx !== xEnd; cx += xStep) {
          const cellIdx = cy * gridW + cx;
          if (cellMask[cellIdx] === 0) continue;
          const globalCellX = cx + minCellX;
          const globalCellY = cy + minCellY;
          const jitter = jitterScale > 0 ? (hashCellNoise(seed, globalCellX, globalCellY) - 0.5) * 2 * jitterScale : 0;
          const value = Math.max(0, Math.min(1, coverage + errBuf[cellIdx] + jitter));
          const quant = value >= 0.5 ? 1 : 0;
          cellChoice[cellIdx] = quant;
          const error = (value - quant) * errorIntensity;
          if (error === 0) continue;
          for (const tap of kernel.taps) {
            const nx = cx + (leftToRight ? tap.dx : -tap.dx);
            const ny = cy + tap.dy;
            if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
            const nIdx = ny * gridW + nx;
            if (cellMask[nIdx] === 0) continue;
            errBuf[nIdx] += (error * tap.weight) / kernel.divisor;
          }
        }
      }

      for (let y = scaleBound.minY; y <= scaleBound.maxY; y += 1) {
        const row = y * width;
        const cellY = Math.floor(y / cellSize) - minCellY;
        for (let x = scaleBound.minX; x <= scaleBound.maxX; x += 1) {
          const idx = row + x;
          const tagValue = tag[idx];
          if ((tagValue >>> 16) !== strokeEpoch) continue;
          const seq = tagValue & 0xffff;
          if (seq === 0) continue;
          const seqScale = lut[seq] || fallbackScale;
          if (seqScale !== scale) continue;
          const cellX = Math.floor(x / cellSize) - minCellX;
          const cellIdx = cellY * gridW + cellX;
          choice[idx] = cellChoice[cellIdx];
        }
      }
    }
  } else {
    const tileCache = new Map<number, { tile: Uint8Array; tileClamp: number; originX: number; originY: number }>();
    const coverageByte = Math.max(0, Math.min(255, Math.round(coverage * 255)));

    for (let y = minY; y <= maxY; y += 1) {
      const row = y * width;
      for (let x = minX; x <= maxX; x += 1) {
        const idx = row + x;
        const tagValue = tag[idx];
        if ((tagValue >>> 16) !== strokeEpoch) continue;
        const seq = tagValue & 0xffff;
        if (seq === 0) continue;
        const seqScale = lut[seq] || fallbackScale;
        let tileEntry = tileCache.get(seqScale);
        if (!tileEntry) {
          const baseSize = resolveStampDitherBaseSize(seqScale);
          const originU = {
            x: (seed % baseSize) | 0,
            y: ((seed >>> 16) % baseSize) | 0,
          };
          const originX = -originU.x * seqScale;
          const originY = -originU.y * seqScale;
          const tileClamp = baseSize * seqScale;
          const tile = getStampDitherTile(
            replayStampDitherRuntime,
            bucket,
            seqScale,
            baseSize,
            algo,
            config.patternStyle ?? 'dots'
          );
          tileEntry = { tile, tileClamp, originX, originY };
          tileCache.set(seqScale, tileEntry);
        }

        const localY = ((y - tileEntry.originY) % tileEntry.tileClamp + tileEntry.tileClamp) % tileEntry.tileClamp;
        const tileRow = localY * tileEntry.tileClamp;
        const localX = ((x - tileEntry.originX) % tileEntry.tileClamp + tileEntry.tileClamp) % tileEntry.tileClamp;
        const tileValue = tileEntry.tile[tileRow + localX];
        choice[idx] = algo === 'pattern'
          ? (tileValue === 1 ? 1 : 0)
          : (tileValue <= coverageByte ? 1 : 0);
      }
    }
  }

  const handle = state.stampDitherFillHandle ?? animator.beginDirectFill();
  const shouldCloseHandle = !state.stampDitherFillHandle;
  const data = handle.data;
  const gid = handle.gradientId;
  const spd = handle.speedData;
  const speedByte = encodeColorCycleSpeedByte(cycleSpeed);
  const bgFillOff = !config.bgFill;
  const base = state.stampDitherBaseIdx;
  const baseG = state.stampDitherBaseGid;
  const baseD = state.stampDitherBaseDef;
  const baseTag = state.stampDitherBaseTag;
  const def = state.gradientDefIdBuffer;

  for (let y = minY; y <= maxY; y += 1) {
    const row = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      const idx = row + x;
      const tagValue = tag[idx];
      if ((tagValue >>> 16) !== strokeEpoch) continue;
      if ((tagValue & 0xffff) === 0) continue;
      const usePrimary = choice[idx] === 1;
      const primaryIndex = primary[idx];
      if (usePrimary) {
        data[idx] = primaryIndex;
        gid[idx] = primaryIndex === 0 ? 0 : flowSlot;
        spd[idx] = primaryIndex === 0 ? 0 : speedByte;
        if (def) def[idx] = 0;
        continue;
      }
      if (bgFillOff) {
        if (base && baseTag && base.length === data.length && baseTag[idx] === strokeEpoch) {
          const v = base[idx];
          data[idx] = v;
          if (v === 0) {
            gid[idx] = 0;
            spd[idx] = 0;
            if (def) def[idx] = 0;
          } else if (baseG && baseG.length === gid.length) {
            gid[idx] = baseG[idx];
            if (def) {
              def[idx] = baseD && baseD.length === def.length ? baseD[idx] : 0;
            }
          } else {
            gid[idx] = flowSlot;
            if (def) def[idx] = 0;
          }
        }
        continue;
      }
      const secondary = resolveStampDitherSecondaryIndex(primaryIndex);
      data[idx] = secondary;
      gid[idx] = secondary === 0 ? 0 : flowSlot;
      spd[idx] = secondary === 0 ? 0 : speedByte;
      if (def) def[idx] = 0;
    }
  }

  if (shouldCloseHandle) {
    const needsUpload = animator.hasWebGL?.() ?? false;
    animator.endDirectFill({ markDirty: needsUpload });
  }
  animator.markDirtyBounds({
    minX,
    minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  });

  return true;
};
