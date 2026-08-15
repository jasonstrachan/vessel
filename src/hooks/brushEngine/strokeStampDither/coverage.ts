import type { PatternStyle } from '@/utils/ditherAlgorithms';
import { isCumulativeThresholdResolver } from '@/utils/ditherPatterns/cumulativeThresholdPattern';
import {
  computePressureResolution,
  createPressureResolutionState,
  PRESSURE_RESOLUTION_MAX_PX,
} from '@/utils/pressureResolution';

import type { StampDitherState } from './state';
import { STAMP_DITHER_BUCKETS } from './tile';
export { STAMP_DITHER_BUCKETS } from './tile';

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
  imageTileThresholdResolver?: (x: number, y: number) => number | null;
  bgFill: boolean;
  pressureLinked: boolean;
  seed: number;
  diversity?: number;
};

export type ErrorDiffusionTap = { dx: number; dy: number; weight: number };

export type ErrorDiffusionKernel = {
  taps: ErrorDiffusionTap[];
  divisor: number;
  serpentine: boolean;
  errorScale: number;
};

export const STAMP_DITHER_PHASE_STEPS = 8;
export const STAMP_DITHER_COVERAGE_MIN = 0.25;
export const STAMP_DITHER_COVERAGE_MAX = 0.75;
export const STAMP_DITHER_COVERAGE_CLAMP_MIN = 0.35;
export const STAMP_DITHER_COVERAGE_CLAMP_MAX = 0.65;
export const STAMP_DITHER_PRESSURE_SMOOTHING = 0.6;
export const STAMP_DITHER_PRESSURE_MAX_DECAY_PER_MS = 0.003;
export const STAMP_DITHER_PRESSURE_MIN_DROP = 0.01;
export const STAMP_DITHER_PRESSURE_SAMPLE_WINDOW = 5;
export const STAMP_DITHER_PEN_LIFT_THRESHOLD = 0.02;

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

export const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const isTileMaskAlgorithm = (algo?: StampDitherAlgorithm): boolean => {
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

export const isErrorDiffusionAlgorithm = (algo?: StampDitherAlgorithm): boolean => {
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

export const resolveStampDitherPressure = (state: StampDitherState, pressure: number): number => {
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

export const resolvePressureLinkedTileScale = (
  state: StampDitherState,
  baseTileScale: number,
  pressure: number,
): number => {
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
    PRESSURE_RESOLUTION_MAX_PX,
  );
  return Math.max(1, Math.round(computed));
};

export const resolveStampDitherCoverage = (
  phase: number,
  colorIndex: number,
  isAnimating: boolean,
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

export const resolveStampDitherPatternBucket = (
  lockedBucket: number,
  patternStyle: PatternStyle | undefined,
  colorIndex: number,
  thresholdResolver?: (x: number, y: number) => number | null,
  selectMarkTone = false,
): number => {
  const normalizedIndex = Math.max(0, Math.min(1, (colorIndex - 1) / 254));
  if (patternStyle === 'image-tile' && isCumulativeThresholdResolver(thresholdResolver)) {
    if (thresholdResolver.coveragePolicy === 'mark-tone-map' && !selectMarkTone) {
      return lockedBucket;
    }
    const toneBucket = resolveStampDitherBucket(thresholdResolver.resolveTone(normalizedIndex));
    return Math.min(STAMP_DITHER_BUCKETS - 2, Math.max(1, toneBucket));
  }
  return lockedBucket;
};

export const getErrorDiffusionKernel = (algo: StampDitherAlgorithm): ErrorDiffusionKernel => {
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
