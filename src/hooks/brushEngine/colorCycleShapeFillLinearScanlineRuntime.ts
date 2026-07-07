import { buildNonZeroWindingRowSpans } from '@/utils/colorCycle/ccGradientDither';

import { applyLostEdgeFromWrittenMask } from './colorCycleShapeFillBuffers';
import type { ColorCycleLinearShapeFillContext } from './colorCycleShapeFillLinearTypes';

type LinearFillBBox = { minX: number; minY: number; width: number; height: number };

type LinearScanlineFillContext = {
  isDitherEnabled: ColorCycleLinearShapeFillContext['isDitherEnabled'];
  isPxlEdgeEnabled: ColorCycleLinearShapeFillContext['isPxlEdgeEnabled'];
  getDitherPixelSize: ColorCycleLinearShapeFillContext['getDitherPixelSize'];
  getDitherStrength: ColorCycleLinearShapeFillContext['getDitherStrength'];
  resolveShapePhaseByte: ColorCycleLinearShapeFillContext['resolveShapePhaseByte'];
  resolveLostEdgeTileSize: ColorCycleLinearShapeFillContext['resolveLostEdgeTileSize'];
  logSetIndexSample: ColorCycleLinearShapeFillContext['logSetIndexSample'];
};

type LinearScanlineBufferState = {
  paint: Uint8Array;
  gid: Uint8Array;
  spd: Uint8Array;
  flow: Uint8Array;
  phase: Uint8Array;
  def?: Uint16Array;
  width: number;
};

type LinearScanlinePreviousState = {
  paint: Uint8Array;
  gid: Uint8Array;
  spd: Uint8Array;
  flow: Uint8Array;
  phase: Uint8Array;
  def: Uint16Array;
};

export type LinearScanlineFillParams = {
  context: LinearScanlineFillContext;
  vertices: Array<{ x: number; y: number }>;
  layerId: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
  dirX: number;
  dirY: number;
  paddedMinProjection: number;
  safeProjectionRange: number;
  bbox: LinearFillBBox;
  buffers: LinearScanlineBufferState;
  previous: LinearScanlinePreviousState;
  writtenMask: Uint8Array;
  numBands: number;
  ditherLevels: number | null;
  lostEdge: number;
  ccGradient: boolean;
  pairBandCount: number;
  continuous: boolean;
  indexFromNormalized(pos: number): number;
  clamp01(value: number): number;
  writeLinearIndex(x: number, y: number, colorIndex: number, phaseByte?: number): void;
  yieldIfNeeded(row: number): Promise<void>;
};

export async function runLinearScanlineFillFallback({
  context,
  vertices,
  layerId,
  minX,
  minY,
  maxX,
  maxY,
  centerX,
  centerY,
  dirX,
  dirY,
  paddedMinProjection,
  safeProjectionRange,
  bbox,
  buffers,
  previous,
  writtenMask,
  numBands,
  ditherLevels,
  lostEdge,
  ccGradient,
  pairBandCount,
  continuous,
  indexFromNormalized,
  clamp01,
  writeLinearIndex,
  yieldIfNeeded,
}: LinearScanlineFillParams): Promise<void> {
  const bands = numBands;
  const bboxW = Math.max(1, Math.ceil(maxX) - Math.floor(minX) + 1);
  const bboxH = Math.max(1, Math.ceil(maxY) - Math.floor(minY) + 1);
  const ixBase = Math.floor(minX);
  const iyBase = Math.floor(minY);
  let errCurr = new Float32Array(bboxW);
  let errNext = new Float32Array(bboxW);

  const noiseAt = (x: number, y: number): number => {
    let n = (x | 0) * 374761393 + (y | 0) * 668265263;
    n = (n ^ (n >>> 13)) * 1274126177;
    n = (n ^ (n >>> 16)) >>> 0;
    return (n & 0xffff) / 65536;
  };
  const thresholdJitter = 0.2;
  const cellSize = Math.max(1, context.isDitherEnabled()
    ? context.getDitherPixelSize()
    : 1);
  const cellsAcross = Math.max(1, Math.ceil(bboxW / cellSize));
  const cellsDown = Math.max(1, Math.ceil(bboxH / cellSize));
  let cErrCurr = new Float32Array(cellsAcross);
  let cErrNext = new Float32Array(cellsAcross);
  const cellOutIdx: Int16Array[] = Array.from({ length: cellsDown }, () => new Int16Array(cellsAcross).fill(-1));
  const scanlineSpans = buildNonZeroWindingRowSpans({
    vertices,
    minX: ixBase,
    minY: iyBase,
    maxX: Math.ceil(maxX),
    maxY: Math.ceil(maxY),
    useWholeEdgeCells: context.isPxlEdgeEnabled(),
  });

  for (let y = Math.floor(minY), rowIdx = 0; y <= Math.ceil(maxY); y++, rowIdx++) {
    await yieldIfNeeded(rowIdx);
    const t = errCurr;
    errCurr = errNext;
    errNext = t;
    errNext.fill(0);

    const inBlockMode = context.isDitherEnabled() && cellSize > 1;
    const isFirstRowOfCell = inBlockMode ? (rowIdx % cellSize) === 0 : false;
    if ((inBlockMode && isFirstRowOfCell) || !inBlockMode) {
      const tc = cErrCurr;
      cErrCurr = cErrNext;
      cErrNext = tc;
      cErrNext.fill(0);
    }

    const serpentine = (rowIdx & 1) === 1;
    const serpentineCell = (Math.floor(rowIdx / Math.max(1, cellSize)) & 1) === 1;
    const rowSpans = scanlineSpans[rowIdx] ?? [];

    for (const [startX, endX] of rowSpans) {
      const quantizeCoord = (value: number, base: number, limit: number) => {
        const local = value - base;
        const snapped = base + Math.floor(local / cellSize) * cellSize + cellSize * 0.5;
        return Math.min(limit, Math.max(base, snapped));
      };

      const evaluateNormalized = (rawX: number, rawY: number, quantize: boolean) => {
        const px = quantize && cellSize > 1 ? quantizeCoord(rawX, ixBase, maxX) : rawX;
        const py = quantize && cellSize > 1 ? quantizeCoord(rawY, iyBase, maxY) : rawY;
        const proj = (px - centerX) * dirX + (py - centerY) * dirY;
        return clamp01((proj - paddedMinProjection) / safeProjectionRange);
      };

      if (context.isDitherEnabled() && cellSize > 1) {
        const xStartCell = Math.floor((startX - ixBase) / cellSize);
        const xEndCell = Math.floor((endX - ixBase) / cellSize);
        const cy = Math.floor((y - iyBase) / cellSize);
        const processCell = (cx: number) => {
          let cached = cellOutIdx[cy][cx];
          if (cached < 0) {
            cached = resolveBlockCellIndex({
              context,
              cx,
              cy,
              ixBase,
              iyBase,
              endX,
              maxY,
              cellSize,
              cellsAcross,
              serpentineCell,
              cErrCurr,
              cErrNext,
              ditherLevels,
              bands,
              thresholdJitter,
              noiseAt,
              indexFromNormalized,
              clamp01,
              evaluateNormalized,
            });
            cellOutIdx[cy][cx] = cached;
          }

          const xBlock = ixBase + cx * cellSize;
          const xTo = Math.min(endX, xBlock + cellSize - 1);
          const fillStart = Math.max(startX, xBlock);
          if (fillStart <= xTo) {
            for (let xx = fillStart; xx <= xTo; xx++) {
              context.logSetIndexSample(layerId, xx, y);
              writeLinearIndex(xx, y, cached);
            }
          }
        };

        if (!serpentineCell) {
          for (let cx = xStartCell; cx <= xEndCell; cx++) processCell(cx);
        } else {
          for (let cx = xEndCell; cx >= xStartCell; cx--) processCell(cx);
        }
      } else if (context.isDitherEnabled()) {
        processPixelDitherSpan({
          context,
          layerId,
          startX,
          endX,
          y,
          ixBase,
          bboxW,
          serpentine,
          errCurr,
          errNext,
          ditherLevels,
          bands,
          thresholdJitter,
          noiseAt,
          indexFromNormalized,
          evaluateNormalized,
          clamp01,
          writeLinearIndex,
        });
      } else if (continuous) {
        for (let x = startX; x <= endX; x++) {
          const r = evaluateNormalized(x + 0.5, y + 0.5, false);
          const outIdx = indexFromNormalized(r);
          const phaseByte = context.resolveShapePhaseByte(r, {
            ccGradient,
            pairBandCount,
            effectiveColorCount: numBands,
          });
          context.logSetIndexSample(layerId, x, y);
          writeLinearIndex(x, y, outIdx, phaseByte);
        }
      } else {
        const quantLevels = Math.max(2, bands);
        const denom = Math.max(1, quantLevels - 1);
        for (let x = startX; x <= endX; x++) {
          const r = evaluateNormalized(x + 0.5, y + 0.5, false);
          const scaled = r * denom;
          const k = Math.min(quantLevels - 1, Math.floor(scaled));
          const pos = k / denom;
          const outIdx = indexFromNormalized(pos);
          const phaseByte = context.resolveShapePhaseByte(r, {
            ccGradient,
            pairBandCount,
            effectiveColorCount: numBands,
          });
          context.logSetIndexSample(layerId, x, y);
          writeLinearIndex(x, y, outIdx, phaseByte);
        }
      }
    }
  }

  if (lostEdge > 0) {
    applyLostEdgeFromWrittenMask({
      writtenMask,
      prevIdx: previous.paint,
      prevGid: previous.gid,
      prevSpd: previous.spd,
      prevFlow: previous.flow,
      prevPhase: previous.phase,
      prevDef: previous.def,
      paint: buffers.paint,
      gid: buffers.gid,
      spd: buffers.spd,
      flow: buffers.flow,
      phase: buffers.phase,
      def: buffers.def,
      fullW: buffers.width,
      bbox,
      lostEdge,
      tileSize: context.resolveLostEdgeTileSize(),
    });
  }
}

type BlockCellIndexOptions = {
  context: LinearScanlineFillContext;
  cx: number;
  cy: number;
  ixBase: number;
  iyBase: number;
  endX: number;
  maxY: number;
  cellSize: number;
  cellsAcross: number;
  serpentineCell: boolean;
  cErrCurr: Float32Array;
  cErrNext: Float32Array;
  ditherLevels: number | null;
  bands: number;
  thresholdJitter: number;
  noiseAt(x: number, y: number): number;
  indexFromNormalized(pos: number): number;
  clamp01(value: number): number;
  evaluateNormalized(rawX: number, rawY: number, quantize: boolean): number;
};

function resolveBlockCellIndex({
  context,
  cx,
  cy,
  ixBase,
  iyBase,
  endX,
  maxY,
  cellSize,
  cellsAcross,
  serpentineCell,
  cErrCurr,
  cErrNext,
  ditherLevels,
  bands,
  thresholdJitter,
  noiseAt,
  indexFromNormalized,
  clamp01,
  evaluateNormalized,
}: BlockCellIndexOptions): number {
  const xBlock = ixBase + cx * cellSize;
  const xCenter = Math.min(endX, xBlock + Math.floor(cellSize / 2));
  const yCenterBlock = Math.min(Math.ceil(maxY), iyBase + cy * cellSize + Math.floor(cellSize / 2));
  const rawSampleX = xCenter + 0.5;
  const rawSampleY = yCenterBlock + 0.5;
  let r = evaluateNormalized(rawSampleX, rawSampleY, true);
  const jitterScale = 0.35;
  const quantLevels = ditherLevels ?? Math.max(2, bands);
  const noiseSeedX = Math.floor(rawSampleX);
  const noiseSeedY = Math.floor(rawSampleY);
  const j = (noiseAt(noiseSeedX, noiseSeedY) - 0.5) * (jitterScale / quantLevels);
  r = clamp01(r + j);

  const denom = Math.max(1, quantLevels - 1);
  const qStep = 1 / denom;
  const scaled = r * denom;
  const kLower = Math.min(quantLevels - 1, Math.floor(scaled));
  const lowerPos = kLower * qStep;
  const upperPos = Math.min(1, (kLower + 1) * qStep);
  const frac = Math.max(0, Math.min(1, scaled - kLower));
  const adj = frac + (cErrCurr[cx] || 0);
  const thr = 0.5 + (noiseAt(Math.floor(rawSampleX), Math.floor(rawSampleY)) - 0.5) * thresholdJitter;
  const chooseUpper = (kLower < quantLevels - 1) && (adj >= thr);
  const q = chooseUpper ? 1 : 0;
  const err = (frac - q) * context.getDitherStrength();
  if (!serpentineCell) {
    if (cx + 1 < cellsAcross) cErrCurr[cx + 1] += err * 0.5;
    if (cx - 1 >= 0) cErrNext[cx - 1] += err * 0.25;
  } else {
    if (cx - 1 >= 0) cErrCurr[cx - 1] += err * 0.5;
    if (cx + 1 < cellsAcross) cErrNext[cx + 1] += err * 0.25;
  }
  cErrNext[cx] += err * 0.25;
  return chooseUpper ? indexFromNormalized(upperPos) : indexFromNormalized(lowerPos);
}

type PixelDitherSpanOptions = {
  context: LinearScanlineFillContext;
  layerId: string;
  startX: number;
  endX: number;
  y: number;
  ixBase: number;
  bboxW: number;
  serpentine: boolean;
  errCurr: Float32Array;
  errNext: Float32Array;
  ditherLevels: number | null;
  bands: number;
  thresholdJitter: number;
  noiseAt(x: number, y: number): number;
  indexFromNormalized(pos: number): number;
  evaluateNormalized(rawX: number, rawY: number, quantize: boolean): number;
  clamp01(value: number): number;
  writeLinearIndex(x: number, y: number, colorIndex: number, phaseByte?: number): void;
};

function processPixelDitherSpan({
  context,
  layerId,
  startX,
  endX,
  y,
  ixBase,
  bboxW,
  serpentine,
  errCurr,
  errNext,
  ditherLevels,
  bands,
  thresholdJitter,
  noiseAt,
  indexFromNormalized,
  evaluateNormalized,
  clamp01,
  writeLinearIndex,
}: PixelDitherSpanOptions): void {
  const quantLevels = ditherLevels ?? Math.max(2, bands);
  const denom = Math.max(1, quantLevels - 1);
  const qStep = 1 / denom;
  const step = serpentine ? -1 : 1;
  const limit = serpentine ? startX - 1 : endX + 1;

  for (let x = serpentine ? endX : startX; x !== limit; x += step) {
    let r = evaluateNormalized(x + 0.5, y + 0.5, false);
    const jitterScale = 0.35;
    const j = (noiseAt(x, y) - 0.5) * (jitterScale / quantLevels);
    r = clamp01(r + j);

    const scaled = r * denom;
    const kLower = Math.min(quantLevels - 1, Math.floor(scaled));
    const lowerPos = kLower * qStep;
    const upperPos = Math.min(1, (kLower + 1) * qStep);
    const frac = Math.max(0, Math.min(1, scaled - kLower));
    const ix = x - ixBase;
    const adj = frac + (errCurr[ix] || 0);
    const thr = 0.5 + (noiseAt(x, y) - 0.5) * thresholdJitter;
    const chooseUpper = (kLower < quantLevels - 1) && (adj >= thr);
    const q = chooseUpper ? 1 : 0;
    const err = (frac - q) * context.getDitherStrength();
    if (!serpentine) {
      if (ix + 1 < bboxW) errCurr[ix + 1] += err * 0.5;
      if (ix - 1 >= 0) errNext[ix - 1] += err * 0.25;
    } else {
      if (ix - 1 >= 0) errCurr[ix - 1] += err * 0.5;
      if (ix + 1 < bboxW) errNext[ix + 1] += err * 0.25;
    }
    errNext[ix] += err * 0.25;
    const outIdx = chooseUpper ? indexFromNormalized(upperPos) : indexFromNormalized(lowerPos);
    context.logSetIndexSample(layerId, x, y);
    writeLinearIndex(x, y, outIdx);
  }
}
