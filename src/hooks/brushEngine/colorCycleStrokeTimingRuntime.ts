import { resolveCcFlowSpeedMultiplier } from '@/utils/colorCycleFlowVelocity';
import { resolveStableFlatSeed } from '@/utils/colorCycle/ccFlatSeed';
import {
  encodeColorCycleSpeedByte,
  sanitizeBrushColorCycleSpeed,
} from '@/utils/colorCycleSpeed';
import { debugLog } from '@/utils/debug';

import type { LayerStrokeState } from './colorCycleCanvas2DTypes';

export function refreshColorCycleShapeFillWriteSpeed(params: {
  strokeData: LayerStrokeState | null | undefined;
  strokeCounter: number;
  resolvedSpeed: number;
}): void {
  const { strokeData } = params;
  if (!strokeData) {
    return;
  }
  strokeData.strokeCounter = params.strokeCounter;
  strokeData.strokeCycleSpeed = params.resolvedSpeed;
  strokeData.strokeSpeedByte = encodeColorCycleSpeedByte(params.resolvedSpeed);
}

export function resolveColorCycleWriteCycleSpeed(params: {
  strokeData?: LayerStrokeState | null;
  strokeCounter: number;
  resolvedSpeed: number;
}): number {
  const { strokeData } = params;
  const hasActiveStrokeSpeed =
    Boolean(strokeData) &&
    strokeData!.strokeCounter === params.strokeCounter &&
    Number.isFinite(strokeData!.strokeCycleSpeed);
  if (hasActiveStrokeSpeed) {
    return strokeData!.strokeCycleSpeed;
  }
  return params.resolvedSpeed;
}

export function resolveColorCycleWriteSpeedByte(params: {
  strokeData?: LayerStrokeState | null;
  strokeCounter: number;
  resolvedSpeed: number;
}): number {
  const { strokeData } = params;
  const hasActiveStrokeSpeed =
    Boolean(strokeData) &&
    strokeData!.strokeCounter === params.strokeCounter &&
    Number.isFinite(strokeData!.strokeSpeedByte);
  if (hasActiveStrokeSpeed) {
    return strokeData!.strokeSpeedByte;
  }
  return encodeColorCycleSpeedByte(resolveColorCycleWriteCycleSpeed(params));
}

export function resolveColorCycleGradientFillSpeedByte(params: {
  strokeData?: LayerStrokeState | null;
  strokeCounter: number;
  resolvedSpeed: number;
}): number {
  const baseSpeed = resolveColorCycleWriteCycleSpeed(params);
  if (!Number.isFinite(baseSpeed) || baseSpeed <= 0) {
    return 0;
  }
  return encodeColorCycleSpeedByte(baseSpeed);
}

export function resolveColorCycleFlowByte(flowMode: 'forward' | 'reverse' | 'pingpong'): number {
  if (flowMode === 'reverse') {
    return 2;
  }
  if (flowMode === 'pingpong') {
    return 3;
  }
  return 1;
}

export function resolveColorCycleShapeAnimationBytes(params: {
  strokeData?: LayerStrokeState | null;
  strokeCounter: number;
  resolvedSpeed: number;
  flowMode: 'forward' | 'reverse' | 'pingpong';
  ccGradient?: boolean;
}): { speedByte: number; flowByte: number } {
  return {
    speedByte: params.ccGradient
      ? resolveColorCycleGradientFillSpeedByte(params)
      : resolveColorCycleWriteSpeedByte(params),
    flowByte: resolveColorCycleFlowByte(params.flowMode),
  };
}

export function resolveColorCycleShapePhaseByte(
  normalized: number,
  options?: {
    ccGradient?: boolean;
    pairBandCount?: number;
    effectiveColorCount?: number;
    shapePhaseBaseByte?: number;
  },
): number {
  if (!options?.ccGradient) return 0;

  const t = Number.isFinite(normalized)
    ? Math.max(0, Math.min(1, normalized))
    : 0;

  const effectiveColorCount = Math.max(
    options.pairBandCount ?? 0,
    options.effectiveColorCount ?? 0,
  );

  if (effectiveColorCount <= 1) {
    return 0;
  }

  const basePhase = Number.isFinite(options.shapePhaseBaseByte)
    ? Math.max(0, Math.min(255, Math.round(options.shapePhaseBaseByte ?? 0)))
    : 0;
  if (basePhase > 0) {
    return basePhase;
  }

  return t > 0 ? 1 : 0;
}

export function resolveColorCycleShapePhaseBaseByte(options?: {
  ccGradient?: boolean;
  pairBandCount?: number;
  effectiveColorCount?: number;
  markId?: string | null;
  bounds?: { minX: number; minY: number; width: number; height: number };
  points?: Array<{ x: number; y: number }>;
}): number {
  if (!options?.ccGradient) {
    return 0;
  }

  const effectiveColorCount = Math.max(
    options.pairBandCount ?? 0,
    options.effectiveColorCount ?? 0,
  );
  if (effectiveColorCount <= 1) {
    return 0;
  }

  const stableSeed = resolveStableFlatSeed({
    markId: options.markId ?? null,
    bounds: options.bounds ?? { minX: 0, minY: 0, width: 1, height: 1 },
    points: options.points ?? [],
  });
  // Sequential mark IDs share patterned low bits, so avalanche before reducing to a phase byte.
  let mixedSeed = stableSeed >>> 0;
  mixedSeed ^= mixedSeed >>> 16;
  mixedSeed = Math.imul(mixedSeed, 0x7feb352d);
  mixedSeed ^= mixedSeed >>> 15;
  mixedSeed = Math.imul(mixedSeed, 0x846ca68b);
  mixedSeed ^= mixedSeed >>> 16;
  return 1 + ((mixedSeed >>> 0) % 223);
}

export function mapColorCycleBandIndexToPaletteIndex(bandIndex: number, bandsToUse: number): number {
  const clampedBands = Math.max(1, Math.min(255, Math.floor(bandsToUse)));
  if (clampedBands <= 1) {
    return 1;
  }
  const normalized = Math.max(0, Math.min(1, bandIndex / (clampedBands - 1)));
  const paletteIndex = 1 + Math.round(normalized * 254);
  return Math.max(1, Math.min(255, paletteIndex));
}

export function computeColorCycleBandIndex(params: {
  strokeData: LayerStrokeState;
  gradientBands: number;
}): number {
  const bands = Math.max(2, Math.min(254, Math.floor(params.gradientBands || 12)));
  const phaseIndex = ((params.strokeData.strokePhaseUnits % 255) + 255) % 255;
  const normalized = bands <= 1 ? 0 : phaseIndex / 254;
  const bandIndex = Math.max(0, Math.min(bands - 1, Math.round(normalized * (bands - 1))));
  const paletteIndex = mapColorCycleBandIndexToPaletteIndex(bandIndex, bands);
  if (
    process.env.NODE_ENV !== 'production' &&
    typeof globalThis !== 'undefined' &&
    (globalThis as { __CC_NON_DITHER_DEBUG?: boolean }).__CC_NON_DITHER_DEBUG === true &&
    (phaseIndex % 8) === 0
  ) {
    debugLog('raw-console', '[cc-band-map]', {
      phaseIndex,
      bands,
      bandIndex,
      paletteIndex,
    });
  }
  return paletteIndex;
}

export function getColorCycleNonDitherStrokeColorIndex(strokeData: LayerStrokeState): number {
  const phase = ((Math.floor(strokeData.stampCounter) % 255) + 255) % 255;
  return 1 + phase;
}

export function resolveColorCycleStrokeFlowCycleSpeed(params: {
  baseSpeed: number;
  speedSamplePxPerMs?: number;
}): number {
  const speedMultiplier = resolveCcFlowSpeedMultiplier(params.speedSamplePxPerMs);
  if (speedMultiplier <= 1) {
    return params.baseSpeed;
  }

  return sanitizeBrushColorCycleSpeed(
    params.baseSpeed * speedMultiplier,
    params.baseSpeed,
  );
}

export function applyColorCycleStrokeFlowSpeed(params: {
  strokeData: LayerStrokeState;
  resolvedSpeed: number;
}): void {
  params.strokeData.strokeCycleSpeed = params.resolvedSpeed;
  params.strokeData.strokeSpeedByte = encodeColorCycleSpeedByte(params.resolvedSpeed);
}

export function advanceColorCycleStrokePhase(params: {
  strokeData: LayerStrokeState;
  phaseAdvance: number;
}): void {
  params.strokeData.strokePhaseUnits = (
    params.strokeData.strokePhaseUnits + params.phaseAdvance
  ) % 255;
}

export function enableColorCycleNonDitherPlaybackSpeed(params: {
  strokeData: LayerStrokeState;
  speedByte: number;
}): boolean {
  const paint = params.strokeData.buffers.paint;
  const spd = params.strokeData.buffers.spd;
  if (paint.length === 0 || spd.length !== paint.length || params.speedByte <= 0) {
    return false;
  }

  let changed = false;
  for (let i = 0; i < paint.length; i += 1) {
    const nextSpeed = paint[i] === 0
      ? 0
      : (spd[i] > 0 ? spd[i] : params.speedByte);
    if (spd[i] !== nextSpeed) {
      spd[i] = nextSpeed;
      changed = true;
    }
  }
  return changed;
}
