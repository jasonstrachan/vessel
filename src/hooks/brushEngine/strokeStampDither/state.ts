import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { createPressureResolutionState } from '@/utils/pressureResolution';

export type StampDitherState = {
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

export type StampDitherStrokeData = StampDitherState & {
  paint: Uint8Array;
  gradientIdBuffer?: Uint8Array;
  gradientDefIdBuffer?: Uint16Array;
  speedBuffer?: Uint8Array;
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
  if (!strokeData.stampDitherBaseTag || strokeData.stampDitherBaseTag.length !== size) {
    strokeData.stampDitherBaseTag = new Uint16Array(size);
  }
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
