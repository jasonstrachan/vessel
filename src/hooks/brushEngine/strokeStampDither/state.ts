import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { createPressureResolutionState } from '@/utils/pressureResolution';

export type StampDitherState = {
  stampDitherInkOffset?: number;
  stampDitherOrigin?: { x: number; y: number } | null;
  stampDitherSeed?: number;
  stampDitherDiversity?: number;
  stampDitherPressureState?: ReturnType<typeof createPressureResolutionState> | null;
  stampDitherPressureStable?: number;
  stampDitherPressureLast?: number;
  stampDitherPressureLastTime?: number;
  stampDitherPressureSampleCount?: number;
  stampDitherTag?: Uint32Array;
  stampDitherStrokeEpoch?: number;
  stampDitherStampSeq?: number;
  stampSourceDistances?: number[];
  stampSourcePoints?: Array<{ x: number; y: number }>;
  stampSourceLast?: { x: number; y: number };
  stampSeqMeta?: Array<[number, number]>;
  stampSeqToTileScale?: Uint16Array;
  stampDitherPrimaryBuffer?: Uint8Array;
  stampDitherBaseIdx?: Uint8Array;
  stampDitherBaseGid?: Uint8Array;
  stampDitherBaseDef?: Uint16Array;
  stampDitherBaseSpeed?: Uint8Array;
  stampDitherBaseFlow?: Uint8Array;
  stampDitherBasePhase?: Uint8Array;
  stampDitherBaseTag?: Uint16Array;
  stampDitherPhaseIntent?: Uint8Array;
  stampDitherFlowBits?: number;
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

export type StampDitherStrokeData = StampDitherState & {
  paint: Uint8Array;
  gradientIdBuffer?: Uint8Array;
  gradientDefIdBuffer?: Uint16Array;
  speedBuffer?: Uint8Array;
  flowBuffer?: Uint8Array;
  phaseBuffer?: Uint8Array;
  stampSeqMeta?: Array<[number, number]>;
  stampSeqToTileScale?: Uint16Array;
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

export const ensureStampDitherBuffers = (
  strokeData: StampDitherStrokeData,
  width: number,
  height: number,
): void => {
  const size = Math.max(1, width * height);
  if (!strokeData.stampDitherPrimaryBuffer || strokeData.stampDitherPrimaryBuffer.length !== size) {
    strokeData.stampDitherPrimaryBuffer = new Uint8Array(size);
  }
};

export const ensureStampDitherBaseBuffers = (
  strokeData: StampDitherStrokeData,
  width: number,
  height: number,
): void => {
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
  if (!strokeData.stampDitherBaseSpeed || strokeData.stampDitherBaseSpeed.length !== size) {
    strokeData.stampDitherBaseSpeed = new Uint8Array(size);
  }
  if (!strokeData.stampDitherBaseFlow || strokeData.stampDitherBaseFlow.length !== size) {
    strokeData.stampDitherBaseFlow = new Uint8Array(size);
  }
  if (!strokeData.stampDitherBasePhase || strokeData.stampDitherBasePhase.length !== size) {
    strokeData.stampDitherBasePhase = new Uint8Array(size);
  }
  if (!strokeData.stampDitherBaseTag || strokeData.stampDitherBaseTag.length !== size) {
    strokeData.stampDitherBaseTag = new Uint16Array(size);
  }
};

export const restoreStampDitherBasePixel = (
  state: StampDitherStrokeData,
  handle: ReturnType<ColorCycleAnimator['beginDirectFill']>,
  index: number,
): void => {
  if (state.stampDitherBaseTag?.[index] !== (state.stampDitherStrokeEpoch ?? 1)) return;
  handle.data[index] = state.stampDitherBaseIdx?.[index] ?? 0;
  handle.gradientId[index] = state.stampDitherBaseGid?.[index] ?? 0;
  handle.speedData[index] = state.stampDitherBaseSpeed?.[index] ?? 0;
  if (state.gradientDefIdBuffer) state.gradientDefIdBuffer[index] = state.stampDitherBaseDef?.[index] ?? 0;
  if (handle.flowData) handle.flowData[index] = state.stampDitherBaseFlow?.[index] ?? 0;
  if (handle.phaseData) handle.phaseData[index] = state.stampDitherBasePhase?.[index] ?? 0;
};

export const resolveStampDitherFlowBits = (animator: ColorCycleAnimator): number => {
  const mode = animator.getFlowMode?.();
  return mode === 'forward' ? 1 : mode === 'reverse' ? 2 : mode === 'pingpong' ? 3 : 0;
};

export const ensureStampDitherTag = (
  strokeData: StampDitherStrokeData,
  width: number,
  height: number,
): void => {
  const size = Math.max(1, width * height);
  if (!strokeData.stampDitherTag || strokeData.stampDitherTag.length !== size) {
    strokeData.stampDitherTag = new Uint32Array(size);
  }
};

export const updateStampDitherBounds = (
  strokeData: StampDitherStrokeData,
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void => {
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
