import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { debugWarn } from '@/utils/debug';
import { applyEdgePadding } from '@/utils/colorCycle/fillMath';
import { buildNonZeroWindingRowSpans } from '@/utils/colorCycle/ccGradientDither';
import { runPerceptualDitherJob } from '@/workers/colorCycleFillClient';
import type { PaletteMapEntry } from '@/workers/colorCycleFillTypes';

import { fillLinear } from './ccGradientFillDither';
import type { FillDitherAlgorithm } from './ccGradientFillDither';
import { paletteEntriesFromMap } from './colorCycleCanvas2DUtils';
import type { LayerStrokeState } from './colorCycleCanvas2DTypes';
import { applyLostEdgeFromWrittenMask } from './colorCycleShapeFillBuffers';
import type { ColorCycleLinearShapeFillContext } from './colorCycleShapeFillLinearTypes';

type LinearFillBBox = { minX: number; minY: number; width: number; height: number };

type LinearPerceptualFillContext = {
  isDitherEnabled: ColorCycleLinearShapeFillContext['isDitherEnabled'];
  isPerceptualDitherEnabled: ColorCycleLinearShapeFillContext['isPerceptualDitherEnabled'];
  isPxlEdgeEnabled: ColorCycleLinearShapeFillContext['isPxlEdgeEnabled'];
  getDitherPixelSize: ColorCycleLinearShapeFillContext['getDitherPixelSize'];
  canRunPerceptualDitherWorker: ColorCycleLinearShapeFillContext['canRunPerceptualDitherWorker'];
  colorAtPosition: ColorCycleLinearShapeFillContext['colorAtPosition'];
  buildQuantizedGradientPalette: ColorCycleLinearShapeFillContext['buildQuantizedGradientPalette'];
  logSetIndexSample: ColorCycleLinearShapeFillContext['logSetIndexSample'];
  resolveLostEdgeTileSize: ColorCycleLinearShapeFillContext['resolveLostEdgeTileSize'];
  advanceStampCounter: ColorCycleLinearShapeFillContext['advanceStampCounter'];
  markPresenterLayerDirty: ColorCycleLinearShapeFillContext['markPresenterLayerDirty'];
  logShapeFillBufferSnapshot: ColorCycleLinearShapeFillContext['logShapeFillBufferSnapshot'];
  render: ColorCycleLinearShapeFillContext['render'];
  snapshotFromBuffers: ColorCycleLinearShapeFillContext['snapshotFromBuffers'];
};

type LinearPerceptualBufferState = {
  paint: Uint8Array;
  gid: Uint8Array;
  spd: Uint8Array;
  flow: Uint8Array;
  phase: Uint8Array;
  def?: Uint16Array;
  width: number;
};

type LinearPerceptualPreviousState = {
  paint: Uint8Array;
  gid: Uint8Array;
  spd: Uint8Array;
  flow: Uint8Array;
  phase: Uint8Array;
  def: Uint16Array;
};

export type LinearPerceptualFillParams = {
  context: LinearPerceptualFillContext;
  animator: ColorCycleAnimator;
  strokeData: LayerStrokeState | null | undefined;
  vertices: Array<{ x: number; y: number }>;
  direction: { x: number; y: number };
  layerId: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  bbox: LinearFillBBox;
  buffers: LinearPerceptualBufferState;
  previous: LinearPerceptualPreviousState;
  writtenMask: Uint8Array;
  ccGradient: boolean;
  fillAlgorithm: FillDitherAlgorithm;
  fillPatternStyle: string | undefined;
  baseOffset: number;
  ditherLevels: number | null;
  numBands: number;
  lostEdge: number;
  logCcFill: boolean;
  writeLinearIndex(x: number, y: number, colorIndex: number, phaseByte?: number): void;
  yieldIfNeeded(row: number): Promise<void>;
  logCpuLinear(): void;
};

export async function tryRunLinearPerceptualFill({
  context,
  animator,
  strokeData,
  vertices,
  direction,
  layerId,
  minX,
  minY,
  maxX,
  maxY,
  bbox,
  buffers,
  previous,
  writtenMask,
  ccGradient,
  fillAlgorithm,
  fillPatternStyle,
  baseOffset,
  ditherLevels,
  numBands,
  lostEdge,
  logCcFill,
  writeLinearIndex,
  yieldIfNeeded,
  logCpuLinear,
}: LinearPerceptualFillParams): Promise<boolean> {
  if (
    !context.isDitherEnabled() ||
    (!context.isPerceptualDitherEnabled() && !(ccGradient && fillAlgorithm !== 'sierra-lite'))
  ) {
    return false;
  }

  try {
    const width = Math.max(1, Math.ceil(maxX) - Math.floor(minX) + 1);
    const height = Math.max(1, Math.ceil(maxY) - Math.floor(minY) + 1);
    const img = new ImageData(width, height);
    const data = img.data;
    const x0 = Math.floor(minX);
    const y0 = Math.floor(minY);

    const spans = buildNonZeroWindingRowSpans({
      vertices,
      minX: x0,
      minY: y0,
      maxX: Math.ceil(maxX),
      maxY: Math.ceil(maxY),
      useWholeEdgeCells: context.isPxlEdgeEnabled(),
    });

    const dirLength = Math.sqrt(direction.x * direction.x + direction.y * direction.y) || 1;
    const dirX = direction.x / dirLength;
    const dirY = direction.y / dirLength;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    let minProj = Infinity;
    let maxProj = -Infinity;
    for (const v of vertices) {
      const dx = v.x - centerX;
      const dy = v.y - centerY;
      const p = dx * dirX + dy * dirY;
      if (p < minProj) minProj = p;
      if (p > maxProj) maxProj = p;
    }
    const projPadding = 0.5 * (Math.abs(dirX) + Math.abs(dirY));
    const paddedMinProj = minProj - projPadding;
    const paddedMaxProj = maxProj + projPadding;
    const projRange = Math.max(1e-6, paddedMaxProj - paddedMinProj);

    const useBlockQuantization =
      context.isDitherEnabled() &&
      Math.max(1, context.getDitherPixelSize()) > 1;
    const blockSize = Math.max(1, context.getDitherPixelSize());
    const quantizeSample = (value: number, base: number, extent: number) => {
      if (!useBlockQuantization || blockSize <= 1) return value + 0.5;
      const rel = value - base;
      const snapped = base + Math.floor(rel / blockSize) * blockSize + blockSize * 0.5;
      const limit = base + extent - 0.5;
      return Math.min(limit, Math.max(base, snapped));
    };

    for (let yy = 0; yy < height; yy++) {
      await yieldIfNeeded(yy);
      const y = y0 + yy;
      const rowSpans = spans[yy] || [];
      for (const [sx, ex] of rowSpans) {
        for (let x = sx; x <= ex; x++) {
          const xx = x - x0;
          if (xx < 0 || xx >= width) continue;
          const sampleX = quantizeSample(x, x0, width);
          const sampleY = quantizeSample(y, y0, height);
          const dx = sampleX - centerX;
          const dy = sampleY - centerY;
          const proj = dx * dirX + dy * dirY;
          const r = applyEdgePadding((proj - paddedMinProj) / Math.max(projRange, 1e-6));
          const { r: R, g: G, b: B } = context.colorAtPosition(r);
          const idx = (yy * width + xx) * 4;
          data[idx] = R;
          data[idx + 1] = G;
          data[idx + 2] = B;
          data[idx + 3] = 255;
        }
      }
    }

    const quantLevels = ditherLevels ?? numBands;
    const { css: paletteCss, mapRgbToIndex } = context.buildQuantizedGradientPalette(quantLevels);
    const paletteEntries = paletteEntriesFromMap(mapRgbToIndex);
    const workerEligible =
      paletteEntries.length > 0 &&
      context.canRunPerceptualDitherWorker(width, height);

    if (workerEligible) {
      const handled = await tryRunWorkerPerceptualFill({
        context,
        animator,
        strokeData,
        layerId,
        width,
        height,
        x0,
        y0,
        spans,
        img,
        paletteCss,
        paletteEntries,
        quantLevels,
        baseOffset,
        bbox,
        buffers,
        previous,
        writtenMask,
        lostEdge,
        ccGradient,
        logCcFill,
        writeLinearIndex,
        yieldIfNeeded,
        logCpuLinear,
      });
      if (handled) {
        return true;
      }
    }

    const dithered: ImageData = fillLinear(img, {
      levels: quantLevels,
      pixelSize: Math.max(1, context.getDitherPixelSize()),
      algorithm: fillAlgorithm,
      patternStyle: fillPatternStyle,
      perceptual: true,
      customPalette: paletteCss,
    });
    const out = dithered.data;
    for (let yy = 0; yy < height; yy++) {
      await yieldIfNeeded(yy);
      const y = y0 + yy;
      const rowSpans = spans[yy] || [];
      for (const [sx, ex] of rowSpans) {
        for (let x = sx; x <= ex; x++) {
          const xx = x - x0;
          if (xx < 0 || xx >= width) continue;
          const p = (yy * width + xx) * 4;
          const key = `${out[p]},${out[p + 1]},${out[p + 2]}`;
          const gi = mapRgbToIndex.get(key);
          if (gi !== undefined) {
            context.logSetIndexSample(layerId, x, y);
            writeLinearIndex(x, y, gi);
          }
        }
      }
    }

    finishLinearPerceptualFill({
      context,
      animator,
      strokeData,
      layerId,
      bbox,
      buffers,
      previous,
      writtenMask,
      lostEdge,
      ccGradient,
      ditherEnabled: context.isDitherEnabled(),
      colors: quantLevels,
      logCcFill,
      logCpuLinear,
    });
    return true;
  } catch {
    return false;
  }
}

type WorkerPerceptualFillParams = {
  context: LinearPerceptualFillContext;
  animator: ColorCycleAnimator;
  strokeData: LayerStrokeState | null | undefined;
  layerId: string;
  width: number;
  height: number;
  x0: number;
  y0: number;
  spans: Array<Array<[number, number]>>;
  img: ImageData;
  paletteCss: string[];
  paletteEntries: PaletteMapEntry[];
  quantLevels: number;
  baseOffset: number;
  bbox: LinearFillBBox;
  buffers: LinearPerceptualBufferState;
  previous: LinearPerceptualPreviousState;
  writtenMask: Uint8Array;
  lostEdge: number;
  ccGradient: boolean;
  logCcFill: boolean;
  writeLinearIndex(x: number, y: number, colorIndex: number, phaseByte?: number): void;
  yieldIfNeeded(row: number): Promise<void>;
  logCpuLinear(): void;
};

async function tryRunWorkerPerceptualFill({
  context,
  animator,
  strokeData,
  layerId,
  width,
  height,
  x0,
  y0,
  spans,
  img,
  paletteCss,
  paletteEntries,
  quantLevels,
  baseOffset,
  bbox,
  buffers,
  previous,
  writtenMask,
  lostEdge,
  ccGradient,
  logCcFill,
  writeLinearIndex,
  yieldIfNeeded,
  logCpuLinear,
}: WorkerPerceptualFillParams): Promise<boolean> {
  const pixelBuffer = new Uint8ClampedArray(img.data);
  try {
    const workerResult = await runPerceptualDitherJob({
      type: 'perceptual-dither',
      mode: 'linear',
      width,
      height,
      baseOffset,
      quantLevels,
      ditherPixelSize: Math.max(1, context.getDitherPixelSize()),
      paletteCss,
      paletteMapEntries: paletteEntries,
      pixels: pixelBuffer.buffer,
    });
    const indicesArray = new Uint8Array(workerResult.indices);
    for (let yy = 0; yy < height; yy++) {
      await yieldIfNeeded(yy);
      const y = y0 + yy;
      const rowSpans = spans[yy] || [];
      const rowBase = yy * width;
      for (const [sx, ex] of rowSpans) {
        for (let x = sx; x <= ex; x++) {
          const xx = x - x0;
          if (xx < 0 || xx >= width) continue;
          const colorIndex = indicesArray[rowBase + xx];
          if (colorIndex > 0) {
            context.logSetIndexSample(layerId, x, y);
            writeLinearIndex(x, y, colorIndex);
          }
        }
      }
    }

    finishLinearPerceptualFill({
      context,
      animator,
      strokeData,
      layerId,
      bbox,
      buffers,
      previous,
      writtenMask,
      lostEdge,
      ccGradient,
      ditherEnabled: context.isDitherEnabled(),
      colors: quantLevels,
      logCcFill,
      logCpuLinear,
    });
    return true;
  } catch (error) {
    debugWarn('raw-console', '[ColorCycleBrushCanvas2D] Worker perceptual fill failed; falling back to main thread.', error);
    return false;
  }
}

type FinishLinearPerceptualFillParams = {
  context: LinearPerceptualFillContext;
  animator: ColorCycleAnimator;
  strokeData: LayerStrokeState | null | undefined;
  layerId: string;
  bbox: LinearFillBBox;
  buffers: LinearPerceptualBufferState;
  previous: LinearPerceptualPreviousState;
  writtenMask: Uint8Array;
  lostEdge: number;
  ccGradient: boolean;
  ditherEnabled: boolean;
  colors: number;
  logCcFill: boolean;
  logCpuLinear(): void;
};

function finishLinearPerceptualFill({
  context,
  animator,
  strokeData,
  layerId,
  bbox,
  buffers,
  previous,
  writtenMask,
  lostEdge,
  ccGradient,
  ditherEnabled,
  colors,
  logCcFill,
  logCpuLinear,
}: FinishLinearPerceptualFillParams): void {
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

  const stampCounter = context.advanceStampCounter(colors);
  if (strokeData) strokeData.stampCounter = stampCounter;
  context.markPresenterLayerDirty(layerId);
  if (logCcFill) {
    context.logShapeFillBufferSnapshot({
      layerId,
      mode: 'linear',
      path: 'cpu',
      ccGradient,
      ditherEnabled,
      colors,
      bbox,
      width: buffers.width,
      paint: buffers.paint,
      speed: buffers.spd,
      flow: buffers.flow,
      phase: buffers.phase,
    });
  }
  animator.forceRender();
  context.render(false);
  if (strokeData) {
    context.snapshotFromBuffers(strokeData);
  }
  logCpuLinear();
}
