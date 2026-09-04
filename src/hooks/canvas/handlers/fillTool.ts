import { flushGradientApply, requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { resolveColorCycleFlowByte } from '@/hooks/brushEngine/colorCycleStrokeTimingRuntime';
import { clearColorCycleEraseMaskInRegion } from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeCommit';
import { resolveColorCycleGradientSourceState } from '@/hooks/canvas/handlers/colorCycle/colorCycleGradientSourceContract';
import type { EventHandlerDependencies, EventHandlerDynamicDeps } from '@/hooks/canvas/utils/types';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import { cloneLayerImageData, commitLayerHistory } from '@/history/helpers/layerHistory';
import { trackPendingHistoryCommit } from '@/history/pendingHistoryCommits';
import { getMaskManager, type MaskManager } from '@/layers/MaskManager';
import { resolveLayerSamplingCanvas } from '@/components/canvas/resolveColorCyclePresentation';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { writeColorCycleRegion } from '@/stores/helpers/colorCycleSelection';
import {
  fillRasterWithinSelection,
  resolveSelectionRasterScope,
  type SelectionRasterScope,
} from '@/stores/helpers/selectionRoi';
import type { Layer, Project, Rectangle } from '@/types';
import { normalizeColorCycleSampledMotion } from '@/utils/colorCycleSampledMotion';
import { createFloodFillMask, floodFill, type FloodFillMaskResult } from '@/utils/floodFill';
import { ensureGradientDefForStops } from '@/utils/colorCycleGradientDefs';
import { encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { debugWarn } from '@/utils/debug';

type FillBounds = { x: number; y: number; width: number; height: number };

type BinaryFillMask = FloodFillMaskResult;

const cropBinaryMask = (
  data: Uint8Array,
  width: number,
  height: number,
  originX: number,
  originY: number,
): BinaryFillMask | null => {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[y * width + x] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) {
    return null;
  }
  const resultWidth = maxX - minX + 1;
  const resultHeight = maxY - minY + 1;
  const result = new Uint8Array(resultWidth * resultHeight);
  for (let row = 0; row < resultHeight; row += 1) {
    const sourceStart = (minY + row) * width + minX;
    result.set(data.subarray(sourceStart, sourceStart + resultWidth), row * resultWidth);
  }
  return {
    data: result,
    width: resultWidth,
    height: resultHeight,
    bounds: {
      x: originX + minX,
      y: originY + minY,
      width: resultWidth,
      height: resultHeight,
    },
  };
};

const createSelectionFillMask = (
  source: ImageData,
  selectionScope: SelectionRasterScope,
  eraseInstead: boolean,
): BinaryFillMask | null => {
  const bounds = selectionScope.bounds;
  if (!bounds) return null;
  const originX = Math.max(0, Math.floor(bounds.x));
  const originY = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(source.width, Math.ceil(bounds.x + bounds.width));
  const bottom = Math.min(source.height, Math.ceil(bounds.y + bounds.height));
  const width = right - originX;
  const height = bottom - originY;
  if (width <= 0 || height <= 0) return null;

  const mask = new Uint8Array(width * height);
  const selectionMask = selectionScope.selectionMask;
  const selectionMaskBounds = selectionScope.selectionMaskBounds;
  const maskOriginX = Math.floor(selectionMaskBounds?.x ?? 0);
  const maskOriginY = Math.floor(selectionMaskBounds?.y ?? 0);
  for (let y = originY; y < bottom; y += 1) {
    for (let x = originX; x < right; x += 1) {
      if (selectionMask && selectionMaskBounds) {
        const maskX = x - maskOriginX;
        const maskY = y - maskOriginY;
        if (
          maskX < 0 ||
          maskY < 0 ||
          maskX >= selectionMask.width ||
          maskY >= selectionMask.height ||
          selectionMask.data[(maskY * selectionMask.width + maskX) * 4 + 3] === 0
        ) {
          continue;
        }
      }
      const sourceAlpha = source.data[(y * source.width + x) * 4 + 3] ?? 0;
      if (eraseInstead && sourceAlpha === 0) continue;
      mask[(y - originY) * width + x - originX] = 255;
    }
  }
  return cropBinaryMask(mask, width, height, originX, originY);
};

export const createColorCycleFillMask = ({
  source,
  point,
  threshold,
  contiguous,
  selectionScope,
  eraseInstead,
}: {
  source: ImageData;
  point: { x: number; y: number };
  threshold: number;
  contiguous: boolean;
  selectionScope: SelectionRasterScope;
  eraseInstead: boolean;
}): BinaryFillMask | null => {
  if (selectionScope.bounds) {
    return createSelectionFillMask(source, selectionScope, eraseInstead);
  }
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= source.width || y >= source.height) return null;
  if (eraseInstead && source.data[(y * source.width + x) * 4 + 3] === 0) return null;
  return createFloodFillMask(source, x, y, { threshold, contiguous });
};

export const applyColorCycleFillEraseMask = (
  layerId: string,
  fillMask: BinaryFillMask,
  maskManager: Pick<MaskManager, 'getMask' | 'bumpVersion'> = getMaskManager(),
): boolean => {
  const eraseMask = maskManager.getMask(layerId);
  const ctx = eraseMask.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const bounds = fillMask.bounds;
  const left = Math.max(0, Math.floor(bounds.x));
  const top = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(eraseMask.width, Math.ceil(bounds.x + bounds.width));
  const bottom = Math.min(eraseMask.height, Math.ceil(bounds.y + bounds.height));
  if (right <= left || bottom <= top) return false;

  const image = ctx.getImageData(left, top, right - left, bottom - top);
  let changed = false;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const sourceIndex = (y - bounds.y) * fillMask.width + x - bounds.x;
      if ((fillMask.data[sourceIndex] ?? 0) === 0) continue;
      const targetIndex = ((y - top) * image.width + x - left) * 4;
      if (image.data[targetIndex + 3] === 255) continue;
      image.data[targetIndex] = 255;
      image.data[targetIndex + 1] = 255;
      image.data[targetIndex + 2] = 255;
      image.data[targetIndex + 3] = 255;
      changed = true;
    }
  }
  if (!changed) return false;
  ctx.putImageData(image, left, top);
  maskManager.bumpVersion(layerId);
  return true;
};

const readColorCyclePresentation = (layer: Layer): ImageData | null => {
  const canvas = resolveLayerSamplingCanvas(layer);
  if (!canvas) return null;
  const ctx = canvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings,
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx || !('getImageData' in ctx)) return null;
  try {
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
};

export type ColorCycleFloodFillDeps = {
  readPresentation: (layer: Layer) => ImageData | null;
  applyEraseMask: (layerId: string, fillMask: BinaryFillMask) => boolean;
  ensureGradientDefinition: typeof ensureGradientDefForStops;
  requestGradientApply: typeof requestGradientApply;
  flushGradientApply: typeof flushGradientApply;
  getState: typeof getAppStoreState;
  writeRegion: typeof writeColorCycleRegion;
  clearEraseMask: (
    state: ReturnType<typeof getAppStoreState>,
    layerId: string,
    fillMask: BinaryFillMask,
  ) => void;
};

const colorCycleFloodFillDeps: ColorCycleFloodFillDeps = {
  readPresentation: readColorCyclePresentation,
  applyEraseMask: applyColorCycleFillEraseMask,
  ensureGradientDefinition: ensureGradientDefForStops,
  requestGradientApply,
  flushGradientApply,
  getState: getAppStoreState,
  writeRegion: writeColorCycleRegion,
  clearEraseMask: (state, layerId, fillMask) => {
    clearColorCycleEraseMaskInRegion(
      { current: state },
      layerId,
      fillMask.bounds,
      { paintMask: fillMask },
    );
  },
};

export const fillColorCycleLayer = ({
  layer,
  project,
  dynamic,
  point,
}: {
  layer: Layer;
  project: Project;
  dynamic: EventHandlerDynamicDeps;
  point: { x: number; y: number };
}, deps: ColorCycleFloodFillDeps = colorCycleFloodFillDeps): FillBounds | null => {
  const source = deps.readPresentation(layer);
  if (!source) return null;
  const selectionScope = resolveSelectionRasterScope({
    selectionStart: dynamic.selectionStart,
    selectionEnd: dynamic.selectionEnd,
    selectionMask: dynamic.selectionMask,
    selectionMaskBounds: dynamic.selectionMaskBounds,
  }, source.width, source.height);
  const fillMask = createColorCycleFillMask({
    source,
    point,
    threshold: dynamic.tools.fillSettings.threshold,
    contiguous: dynamic.tools.fillSettings.contiguous,
    selectionScope,
    eraseInstead: dynamic.tools.fillSettings.eraseInstead,
  });
  if (!fillMask) return null;

  if (dynamic.tools.fillSettings.eraseInstead) {
    return deps.applyEraseMask(layer.id, fillMask) ? fillMask.bounds : null;
  }

  const settings = dynamic.tools.brushSettings;
  const gradient = resolveColorCycleGradientSourceState({
    layer,
    brushSettings: settings,
    ccGradientSource: settings.ccGradientSource,
    fgParams: {
      fgColorHex: dynamic.palette.foregroundColor,
      fgLightness: settings.colorCycleFgLightness,
      fgVariance: settings.colorCycleFgVariance,
      fgHueShift: settings.colorCycleFgHueShift,
      fgSaturationShift: settings.colorCycleFgSaturationShift,
      fgOpacity: settings.colorCycleFgOpacity,
      fgStops: settings.colorCycleFgStops,
    },
  });
  const definition = deps.ensureGradientDefinition({
    layerId: layer.id,
    kind: 'linear',
    stops: gradient.activeStops,
    source: gradient.source,
    speedCps: settings.colorCycleSpeed,
    seamProfile: settings.colorCycleGradientSeamProfile,
    sampledCapacityFallback: gradient.source === 'sampled'
      ? 'reuse-nearest-compatible'
      : undefined,
  });
  if (!definition) return null;
  deps.requestGradientApply(layer.id, 'flood-fill');
  deps.flushGradientApply(layer.id);

  const pixelCount = fillMask.width * fillMask.height;
  const paint = new Uint8Array(pixelCount).fill(1);
  const gradientIds = new Uint8Array(pixelCount).fill(definition.slot);
  const gradientDefIds = new Uint16Array(pixelCount).fill(definition.def.id);
  const sampledMotion = gradient.source === 'manual' && settings.colorCycleGradientIsRuntimePalette
    ? normalizeColorCycleSampledMotion(settings.colorCycleSampledMotion)
    : null;
  const speed = new Uint8Array(pixelCount).fill(
    sampledMotion?.speedByte ?? encodeColorCycleSpeedByte(settings.colorCycleSpeed),
  );
  const flow = new Uint8Array(pixelCount).fill(
    sampledMotion?.flowByte ?? resolveColorCycleFlowByte(
      settings.colorCycleFlowMode ?? layer.colorCycleData?.flowMode ?? 'forward',
    ),
  );
  const phase = new Uint8Array(pixelCount).fill(sampledMotion?.phaseByte ?? 0);
  const state = deps.getState();
  const freshLayer = state.layers.find((candidate) => candidate.id === layer.id) ?? layer;
  const wrote = deps.writeRegion(
    state,
    freshLayer,
    project,
    fillMask.bounds,
    paint,
    fillMask.width,
    fillMask.height,
    {
      alphaData: fillMask.data,
      alphaStride: 1,
      alphaChannelOffset: 0,
      gradientSlot: definition.slot,
      sourceGradientIds: gradientIds,
      sourceGradientDefIds: gradientDefIds,
      sourceSpeed: speed,
      sourceFlow: flow,
      sourcePhase: phase,
    },
  );
  const latestState = deps.getState();
  const hadEraseMask = Boolean(
    latestState.layers.find((candidate) => candidate.id === layer.id)?.colorCycleData?.eraseMask,
  );
  if (hadEraseMask) {
    deps.clearEraseMask(latestState, layer.id, fillMask);
  }
  return wrote || hadEraseMask ? fillMask.bounds : null;
};

const getNormalLayerImageData = (
  layer: Layer,
  width: number,
  height: number,
): ImageData | null => {
  if (layer.framebuffer) {
    const framebuffer = layer.framebuffer;
    if (framebuffer.width !== width || framebuffer.height !== height) {
      framebuffer.width = width;
      framebuffer.height = height;
    }
    const ctx = framebuffer.getContext('2d', { willReadFrequently: true });
    if (ctx && 'getImageData' in ctx) {
      return ctx.getImageData(0, 0, width, height);
    }
  }
  if (layer.imageData) return layer.imageData;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d', { willReadFrequently: true })?.createImageData(width, height) ?? null;
};

const fillNormalLayer = ({
  layer,
  project,
  dynamic,
  point,
  updateLayer,
}: {
  layer: Layer;
  project: Project;
  dynamic: EventHandlerDynamicDeps;
  point: { x: number; y: number };
  updateLayer: EventHandlerDependencies['updateLayer'];
}): { beforeImage: ImageData; bounds: Rectangle } | null => {
  const currentImage = getNormalLayerImageData(layer, project.width || 1920, project.height || 1080);
  const beforeImage = cloneLayerImageData(currentImage);
  const workingImage = cloneLayerImageData(currentImage);
  if (!beforeImage || !workingImage) return null;

  const shouldErase = dynamic.tools.fillSettings.eraseInstead;
  const fillColor = shouldErase
    ? { r: 0, g: 0, b: 0, a: 0 }
    : (() => {
        const activeColor = dynamic.palette.activeSlot === 'background'
          ? dynamic.palette.backgroundColor
          : dynamic.palette.foregroundColor;
        const { r, g, b } = parseCssColor(activeColor ?? '#000000');
        return { r, g, b, a: 255 };
      })();
  const selectionScope = resolveSelectionRasterScope({
    selectionStart: dynamic.selectionStart,
    selectionEnd: dynamic.selectionEnd,
    selectionMask: dynamic.selectionMask,
    selectionMaskBounds: dynamic.selectionMaskBounds,
  }, workingImage.width, workingImage.height);
  const result = selectionScope.bounds
    ? {
        imageData: workingImage,
        bounds: fillRasterWithinSelection(
          workingImage,
          selectionScope.bounds,
          fillColor,
          selectionScope.selectionMask,
          selectionScope.selectionMaskBounds,
        ),
      }
    : floodFill(
        workingImage,
        Math.floor(point.x),
        Math.floor(point.y),
        fillColor,
        {
          threshold: dynamic.tools.fillSettings.threshold,
          contiguous: dynamic.tools.fillSettings.contiguous,
        },
      );
  if (!result.bounds) return null;

  const framebufferCtx = layer.framebuffer?.getContext('2d', { willReadFrequently: true });
  if (framebufferCtx && 'putImageData' in framebufferCtx) {
    framebufferCtx.putImageData(result.imageData, 0, 0);
  }
  updateLayer(layer.id, { imageData: result.imageData }, { dirtyRects: [result.bounds] });
  return { beforeImage, bounds: result.bounds };
};

export const runFillToolPointerDown = ({
  deps,
  dynamic,
  worldPos,
}: {
  deps: EventHandlerDependencies;
  dynamic: EventHandlerDynamicDeps;
  worldPos: { x: number; y: number };
}): void => {
  const activeLayer = dynamic.layers.find((layer) => layer.id === dynamic.activeLayerId);
  const project = dynamic.project;
  if (!activeLayer || !project) return;
  const beforeColorState = activeLayer.layerType === 'color-cycle'
    ? captureColorCycleBrushState(activeLayer.id)
    : null;
  const normalResult = activeLayer.layerType === 'color-cycle'
    ? null
    : fillNormalLayer({
        layer: activeLayer,
        project,
        dynamic,
        point: worldPos,
        updateLayer: deps.updateLayer,
      });
  const fillBounds = activeLayer.layerType === 'color-cycle'
    ? fillColorCycleLayer({ layer: activeLayer, project, dynamic, point: worldPos })
    : normalResult?.bounds ?? null;
  if (!fillBounds) return;

  deps.compositeCanvasDirtyRef.current = true;
  requestAnimationFrame(() => {
    if (!deps.compositeCanvasRef.current) return;
    deps.compositeLayersToCanvas(deps.compositeCanvasRef.current);
    deps.setCurrentOffscreenCanvas(deps.compositeCanvasRef.current);
    deps.compositeCanvasDirtyRef.current = false;
    const ctx = deps.canvasRef.current?.getContext('2d', { willReadFrequently: true });
    if (ctx) deps.draw(ctx, deps.viewTransformRef.current);
  });

  const shouldErase = dynamic.tools.fillSettings.eraseInstead;
  const historyCommit = commitLayerHistory({
    layerId: activeLayer.id,
    beforeImage: normalResult?.beforeImage ?? null,
    beforeColorState,
    actionType: 'fill',
    description: shouldErase ? 'Flood erase' : 'Flood fill',
    tool: shouldErase ? 'eraser-fill' : 'fill',
    bitmapRoi: fillBounds,
  }).catch((error) => {
    if (process.env.NODE_ENV !== 'production') {
      debugWarn('raw-console', '[history] Failed to record flood fill history', error);
    }
  });
  trackPendingHistoryCommit(historyCommit);
};
