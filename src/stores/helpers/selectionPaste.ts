import type { StoreApi } from 'zustand';
import type { AppState, CaptureROI } from '@/stores/useAppStore';
import type { Rectangle } from '@/types';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import { requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { showAppFeedback } from '@/utils/appFeedback';
import { debugLog, debugWarn, logError } from '@/utils/debug';
import {
  mergeTransferredColorCycleSlotPalettes,
  mergeTransferredColorCycleGradientDefs,
} from '@/stores/helpers/colorCycleGradientDefTransfer';
import {
  debugCaptureColorCycleScalarRegion,
  hasColorCycleIndices,
  writeColorCycleRegion,
} from '@/stores/helpers/colorCycleSelection';
import {
  buildCcSelectionHistoryPayload,
  runCcSelectionTransaction,
  type CcCanonicalSelectionPayload,
  type CcSelectionOperation,
} from '@/stores/helpers/colorCycleSelectionTransaction';
import { logCCMutation, summarizeColorCycleLayer } from '@/utils/colorCycle/ccMutationAudit';

type StoreGet = StoreApi<AppState>['getState'];
type StoreSet = StoreApi<AppState>['setState'];

type CaptureFn = AppState['captureCanvasToActiveLayer'];

const buildCcCanonicalPayload = (
  state: AppState,
  layerId: string,
  fallbackWidth: number,
  fallbackHeight: number
): CcCanonicalSelectionPayload => {
  const brush = typeof state.getLayerColorCycleBrush === 'function'
    ? state.getLayerColorCycleBrush(layerId)
    : null;
  const snapshot = brush?.getLayerSnapshot?.(layerId) ?? null;
  const layer = state.layers.find((candidate) => candidate.id === layerId);
  const canUseEmptyInitializedCcRuntime = Boolean(brush && layer?.layerType === 'color-cycle' && layer.colorCycleData);
  const expectedPixels = Math.max(1, fallbackWidth * fallbackHeight);
  const emptyBytes = () => new Uint8Array(expectedPixels);
  const emptyDefBytes = () => new Uint16Array(expectedPixels);
  return {
    paintBuffer: snapshot?.paintBuffer?.byteLength ? new Uint8Array(snapshot.paintBuffer) : (canUseEmptyInitializedCcRuntime ? emptyBytes() : null),
    gradientIdBuffer: snapshot?.gradientIdBuffer?.byteLength ? new Uint8Array(snapshot.gradientIdBuffer) : (canUseEmptyInitializedCcRuntime ? emptyBytes() : null),
    gradientDefIdBuffer: snapshot?.gradientDefIdBuffer?.byteLength ? new Uint16Array(snapshot.gradientDefIdBuffer) : (canUseEmptyInitializedCcRuntime ? emptyDefBytes() : null),
    speedBuffer: snapshot?.speedBuffer?.byteLength ? new Uint8Array(snapshot.speedBuffer) : (canUseEmptyInitializedCcRuntime ? emptyBytes() : null),
    flowBuffer: snapshot?.flowBuffer?.byteLength ? new Uint8Array(snapshot.flowBuffer) : (canUseEmptyInitializedCcRuntime ? emptyBytes() : null),
    phaseBuffer: snapshot?.phaseBuffer?.byteLength ? new Uint8Array(snapshot.phaseBuffer) : (canUseEmptyInitializedCcRuntime ? emptyBytes() : null),
    width: fallbackWidth,
    height: fallbackHeight,
  };
};

const hasCompleteCcCanonicalPayload = (payload: CcCanonicalSelectionPayload): boolean => {
  const expectedPixels = Math.max(1, payload.width * payload.height);
  return Boolean(
    payload.paintBuffer?.byteLength === expectedPixels &&
    payload.gradientIdBuffer?.byteLength === expectedPixels &&
    payload.gradientDefIdBuffer?.byteLength === expectedPixels * Uint16Array.BYTES_PER_ELEMENT &&
    payload.speedBuffer?.byteLength === expectedPixels &&
    payload.flowBuffer?.byteLength === expectedPixels &&
    payload.phaseBuffer?.byteLength === expectedPixels
  );
};

const colorCyclePayloadAlreadyMatchesRegion = (
  target: CcCanonicalSelectionPayload,
  rect: Rectangle,
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  options?: {
    alphaData?: Uint8ClampedArray | Uint8Array | null;
    alphaStride?: number;
    alphaChannelOffset?: number;
    alphaThreshold?: number;
    sourceGradientIds?: Uint8Array | null;
    sourceGradientDefIds?: Uint16Array | null;
    sourceSpeed?: Uint8Array | null;
    sourceFlow?: Uint8Array | null;
    sourcePhase?: Uint8Array | null;
  }
): boolean => {
  if (!hasCompleteCcCanonicalPayload(target) || sourceWidth <= 0 || sourceHeight <= 0) {
    return false;
  }

  const paint = target.paintBuffer;
  const gradientIds = target.gradientIdBuffer;
  const gradientDefIds = target.gradientDefIdBuffer;
  const speed = target.speedBuffer;
  const flow = target.flowBuffer;
  const phase = target.phaseBuffer;
  if (!paint || !gradientIds || !gradientDefIds || !speed || !flow || !phase) {
    return false;
  }

  const startX = clamp(Math.floor(rect.x), 0, target.width);
  const startY = clamp(Math.floor(rect.y), 0, target.height);
  const endX = clamp(Math.ceil(rect.x + rect.width), 0, target.width);
  const endY = clamp(Math.ceil(rect.y + rect.height), 0, target.height);
  if (startX >= endX || startY >= endY) {
    return true;
  }

  const alphaData = options?.alphaData ?? null;
  const alphaStride = Math.max(1, options?.alphaStride ?? 4);
  const alphaChannelOffset = Math.max(0, options?.alphaChannelOffset ?? 3);
  const alphaThreshold = Math.max(0, options?.alphaThreshold ?? 0);

  for (let y = startY; y < endY; y += 1) {
    const srcY = y - startY;
    if (srcY < 0 || srcY >= sourceHeight) {
      continue;
    }
    for (let x = startX; x < endX; x += 1) {
      const srcX = x - startX;
      if (srcX < 0 || srcX >= sourceWidth) {
        continue;
      }
      if (alphaData) {
        const alphaIndex = (srcY * sourceWidth + srcX) * alphaStride + alphaChannelOffset;
        const alpha = alphaData[alphaIndex] ?? 0;
        if (alpha <= alphaThreshold) {
          continue;
        }
      }

      const srcIndex = srcY * sourceWidth + srcX;
      const destIndex = y * target.width + x;
      if (
        paint[destIndex] !== source[srcIndex] ||
        gradientIds[destIndex] !== (options?.sourceGradientIds?.[srcIndex] ?? gradientIds[destIndex]) ||
        gradientDefIds[destIndex] !== (options?.sourceGradientDefIds?.[srcIndex] ?? gradientDefIds[destIndex]) ||
        speed[destIndex] !== (options?.sourceSpeed?.[srcIndex] ?? speed[destIndex]) ||
        flow[destIndex] !== (options?.sourceFlow?.[srcIndex] ?? flow[destIndex]) ||
        phase[destIndex] !== (options?.sourcePhase?.[srcIndex] ?? phase[destIndex])
      ) {
        return false;
      }
    }
  }

  return true;
};

const logCcPasteTransactionBlocked = (args: {
  layerId: string;
  layer: AppState['layers'][number];
  operation: CcSelectionOperation;
  transactionId: string;
  kind: string;
  details: Record<string, unknown>;
}): void => {
  const summary = summarizeColorCycleLayer(args.layer);
  logCCMutation({
    event: 'cc-selection-transaction-preflight-blocked',
    layerId: args.layerId,
    reason: args.operation,
    severity: args.kind === 'missing-canonical-payload' || args.kind === 'missing-gradient-definition' ? 'error' : 'warn',
    before: summary,
    after: summary,
    details: {
      transactionId: args.transactionId,
      operation: args.operation,
      kind: args.kind,
      clearSelection: false,
      ...args.details,
    },
  });
};

const logCcPasteTransactionEvent = (args: {
  layerId: string;
  layer: AppState['layers'][number];
  operation: CcSelectionOperation;
  transactionId: string;
  event:
    | 'cc-selection-transaction-paste-committed'
    | 'cc-selection-transaction-restored'
    | 'cc-selection-transaction-failed';
  kind: string;
  severity?: 'warn' | 'error';
  details?: Record<string, unknown>;
}): void => {
  const summary = summarizeColorCycleLayer(args.layer);
  logCCMutation({
    event: args.event,
    layerId: args.layerId,
    reason: args.operation,
    severity: args.severity ?? 'warn',
    before: summary,
    after: summary,
    details: {
      transactionId: args.transactionId,
      operation: args.operation,
      kind: args.kind,
      ...(args.details ?? {}),
    },
  });
};

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
};

type FloatRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const getDestinationRect = (
  floatingPaste: NonNullable<AppState['floatingPaste']>
): FloatRect => {
  const width = Math.max(1, floatingPaste.displayWidth ?? floatingPaste.width);
  const height = Math.max(1, floatingPaste.displayHeight ?? floatingPaste.height);
  return {
    x: floatingPaste.position.x,
    y: floatingPaste.position.y,
    width,
    height,
  };
};

const getRotatedBoundingRect = (rect: FloatRect, rotation: number): FloatRect => {
  if (!rotation) {
    return rect;
  }
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const bboxWidth = Math.abs(rect.width * cos) + Math.abs(rect.height * sin);
  const bboxHeight = Math.abs(rect.width * sin) + Math.abs(rect.height * cos);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return {
    x: centerX - bboxWidth / 2,
    y: centerY - bboxHeight / 2,
    width: bboxWidth,
    height: bboxHeight,
  };
};

const intersectWithProject = (rect: FloatRect, project: { width: number; height: number }): CaptureROI | null => {
  const x = Math.max(rect.x, 0);
  const y = Math.max(rect.y, 0);
  const maxX = Math.min(rect.x + rect.width, project.width);
  const maxY = Math.min(rect.y + rect.height, project.height);
  const width = maxX - x;
  const height = maxY - y;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
};

const deriveSourceCrop = (
  visibleRect: FloatRect,
  destRect: FloatRect,
  intrinsicWidth: number,
  intrinsicHeight: number
): FloatRect | null => {
  const safeSourceWidth = Math.max(1, intrinsicWidth);
  const safeSourceHeight = Math.max(1, intrinsicHeight);
  const scaleX = destRect.width / safeSourceWidth;
  const scaleY = destRect.height / safeSourceHeight;
  const safeScaleX = Number.isFinite(scaleX) && scaleX !== 0 ? scaleX : 1;
  const safeScaleY = Number.isFinite(scaleY) && scaleY !== 0 ? scaleY : 1;

  const sourceX = (visibleRect.x - destRect.x) / safeScaleX;
  const sourceY = (visibleRect.y - destRect.y) / safeScaleY;
  const sourceWidth = visibleRect.width / safeScaleX;
  const sourceHeight = visibleRect.height / safeScaleY;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const clampToSource = (value: number, max: number) => clamp(value, 0, max);

  const clampedX = clampToSource(sourceX, safeSourceWidth);
  const clampedY = clampToSource(sourceY, safeSourceHeight);
  const maxWidth = safeSourceWidth - clampedX;
  const maxHeight = safeSourceHeight - clampedY;

  return {
    x: clampedX,
    y: clampedY,
    width: Math.min(sourceWidth, maxWidth),
    height: Math.min(sourceHeight, maxHeight),
  };
};

const roundRect = (rect: FloatRect): Rectangle => {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const right = Math.ceil(rect.x + rect.width);
  const bottom = Math.ceil(rect.y + rect.height);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
};

const toRoundedDestinationRect = (rect: FloatRect): Rectangle => ({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  width: Math.max(1, Math.round(rect.width)),
  height: Math.max(1, Math.round(rect.height)),
});

const resampleScalarNearest = (
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): Uint8Array => {
  if (targetWidth <= 0 || targetHeight <= 0) {
    return new Uint8Array(0);
  }
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return new Uint8Array(targetWidth * targetHeight);
  }
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return source.slice();
  }

  const output = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / targetHeight));
    const outputRow = y * targetWidth;
    const sourceRow = sourceY * sourceWidth;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / targetWidth));
      output[outputRow + x] = source[sourceRow + sourceX] ?? 0;
    }
  }
  return output;
};

const resampleScalarNearest16 = (
  source: Uint16Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): Uint16Array => {
  if (targetWidth <= 0 || targetHeight <= 0) {
    return new Uint16Array(0);
  }
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return new Uint16Array(targetWidth * targetHeight);
  }
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return source.slice();
  }

  const output = new Uint16Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / targetHeight));
    const outputRow = y * targetWidth;
    const sourceRow = sourceY * sourceWidth;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / targetWidth));
      output[outputRow + x] = source[sourceRow + sourceX] ?? 0;
    }
  }
  return output;
};

const resampleAlphaNearest = (
  imageData: ImageData | null | undefined,
  targetWidth: number,
  targetHeight: number
): Uint8Array | null => {
  if (!imageData || targetWidth <= 0 || targetHeight <= 0) {
    return null;
  }

  const sourceWidth = imageData.width;
  const sourceHeight = imageData.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const output = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / targetWidth));
      const sourceIndex = (sourceY * sourceWidth + sourceX) * 4 + 3;
      output[y * targetWidth + x] = imageData.data[sourceIndex] ?? 0;
    }
  }

  return output;
};

const buildOpaqueAlphaFromIndices = (indices: Uint8Array | null | undefined): Uint8Array | null => {
  if (!indices?.length) {
    return null;
  }
  const alpha = new Uint8Array(indices.length);
  for (let index = 0; index < indices.length; index += 1) {
    alpha[index] = (indices[index] ?? 0) > 0 ? 255 : 0;
  }
  return alpha;
};

const unionWithProjectBounds = (
  a: Rectangle,
  b: Rectangle,
  project: { width: number; height: number }
): Rectangle | null => {
  const minX = Math.max(0, Math.min(a.x, b.x));
  const minY = Math.max(0, Math.min(a.y, b.y));
  const maxX = Math.min(project.width, Math.max(a.x + a.width, b.x + b.width));
  const maxY = Math.min(project.height, Math.max(a.y + a.height, b.y + b.height));
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x: minX, y: minY, width, height };
};

const extractImageDataRoi = (
  imageData: ImageData,
  roi: Rectangle
): ImageData | null => {
  if (roi.width <= 0 || roi.height <= 0) {
    return null;
  }
  if (
    roi.x < 0 ||
    roi.y < 0 ||
    roi.x + roi.width > imageData.width ||
    roi.y + roi.height > imageData.height
  ) {
    return null;
  }

  const result = new Uint8ClampedArray(roi.width * roi.height * 4);
  for (let y = 0; y < roi.height; y += 1) {
    const srcStart = ((roi.y + y) * imageData.width + roi.x) * 4;
    const srcEnd = srcStart + roi.width * 4;
    result.set(imageData.data.slice(srcStart, srcEnd), y * roi.width * 4);
  }

  return new ImageData(result, roi.width, roi.height);
};

const synthesizeMoveBeforeImage = ({
  roi,
  sourceBounds,
  sourceImage,
  context2d,
}: {
  roi: Rectangle;
  sourceBounds: Rectangle;
  sourceImage: ImageData;
  context2d: CanvasRenderingContext2D;
}): ImageData | null => {
  if (roi.width <= 0 || roi.height <= 0) {
    return null;
  }

  let composed: ImageData;
  try {
    composed = context2d.getImageData(roi.x, roi.y, roi.width, roi.height);
  } catch {
    return null;
  }

  const sourceX = Math.floor(sourceBounds.x);
  const sourceY = Math.floor(sourceBounds.y);
  const sourceWidth = Math.min(Math.ceil(sourceBounds.width), sourceImage.width);
  const sourceHeight = Math.min(Math.ceil(sourceBounds.height), sourceImage.height);
  const overlayStartX = Math.max(sourceX, roi.x);
  const overlayStartY = Math.max(sourceY, roi.y);
  const overlayEndX = Math.min(sourceX + sourceWidth, roi.x + roi.width);
  const overlayEndY = Math.min(sourceY + sourceHeight, roi.y + roi.height);

  if (overlayEndX <= overlayStartX || overlayEndY <= overlayStartY) {
    return composed;
  }

  for (let y = overlayStartY; y < overlayEndY; y += 1) {
    const sourceRow = (y - sourceY) * sourceImage.width;
    const composedRow = (y - roi.y) * composed.width;
    for (let x = overlayStartX; x < overlayEndX; x += 1) {
      const sourceIndex = (sourceRow + (x - sourceX)) * 4;
      const destIndex = (composedRow + (x - roi.x)) * 4;
      composed.data[destIndex] = sourceImage.data[sourceIndex] ?? 0;
      composed.data[destIndex + 1] = sourceImage.data[sourceIndex + 1] ?? 0;
      composed.data[destIndex + 2] = sourceImage.data[sourceIndex + 2] ?? 0;
      composed.data[destIndex + 3] = sourceImage.data[sourceIndex + 3] ?? 0;
    }
  }

  return composed;
};

const rebuildMoveBeforeColorState = ({
  currentState,
  sourceBounds,
  sourceIndices,
  sourceGradientIds,
  sourceGradientDefIds,
  sourceSpeed,
  sourceFlow,
  sourcePhase,
  sourceWidth,
  sourceHeight,
  canvasWidth,
  canvasHeight,
}: {
  currentState: ColorCycleSerializedState;
  sourceBounds: Rectangle;
  sourceIndices: Uint8Array;
  sourceGradientIds?: Uint8Array | null;
  sourceGradientDefIds?: Uint16Array | null;
  sourceSpeed?: Uint8Array | null;
  sourceFlow?: Uint8Array | null;
  sourcePhase?: Uint8Array | null;
  sourceWidth: number;
  sourceHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}): ColorCycleSerializedState => {
  if (!currentState?.layers?.length) {
    return currentState;
  }
  const layer0 = currentState.layers[0];
  const paintBuffer = layer0?.strokeData?.paintBuffer
    ? new Uint8Array(layer0.strokeData.paintBuffer)
    : null;
  const gradientBuffer = layer0?.strokeData?.gradientIdBuffer
    ? new Uint8Array(layer0.strokeData.gradientIdBuffer)
    : null;
  const gradientDefBuffer = layer0?.strokeData?.gradientDefIdBuffer
    ? new Uint16Array(layer0.strokeData.gradientDefIdBuffer)
    : null;
  const speedBuffer = layer0?.strokeData?.speedBuffer
    ? new Uint8Array(layer0.strokeData.speedBuffer)
    : null;
  const flowBuffer = layer0?.strokeData?.flowBuffer
    ? new Uint8Array(layer0.strokeData.flowBuffer)
    : null;
  const phaseBuffer = layer0?.strokeData?.phaseBuffer
    ? new Uint8Array(layer0.strokeData.phaseBuffer)
    : null;
  if (!paintBuffer || paintBuffer.length !== canvasWidth * canvasHeight) {
    return currentState;
  }

  const restored = paintBuffer.slice();
  const startX = Math.max(0, Math.floor(sourceBounds.x));
  const startY = Math.max(0, Math.floor(sourceBounds.y));
  const endX = Math.min(canvasWidth, Math.ceil(sourceBounds.x + sourceBounds.width));
  const endY = Math.min(canvasHeight, Math.ceil(sourceBounds.y + sourceBounds.height));

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const localX = x - startX;
      const localY = y - startY;
      if (localX < 0 || localY < 0 || localX >= sourceWidth || localY >= sourceHeight) {
        continue;
      }
      const srcIndex = localY * sourceWidth + localX;
      const dstIndex = y * canvasWidth + x;
      restored[dstIndex] = sourceIndices[srcIndex] ?? 0;
      if (gradientBuffer && gradientBuffer.length === canvasWidth * canvasHeight) {
        gradientBuffer[dstIndex] = sourceGradientIds?.[srcIndex] ?? 0;
      }
      if (gradientDefBuffer && gradientDefBuffer.length === canvasWidth * canvasHeight) {
        gradientDefBuffer[dstIndex] = sourceGradientDefIds?.[srcIndex] ?? 0;
      }
      if (speedBuffer && speedBuffer.length === canvasWidth * canvasHeight) {
        speedBuffer[dstIndex] = sourceSpeed?.[srcIndex] ?? 0;
      }
      if (flowBuffer && flowBuffer.length === canvasWidth * canvasHeight) {
        flowBuffer[dstIndex] = sourceFlow?.[srcIndex] ?? 0;
      }
      if (phaseBuffer && phaseBuffer.length === canvasWidth * canvasHeight) {
        phaseBuffer[dstIndex] = sourcePhase?.[srcIndex] ?? 0;
      }
    }
  }

  const nextLayer0 = {
    ...layer0,
    strokeData: layer0.strokeData
      ? {
          ...layer0.strokeData,
          paintBuffer: restored.buffer,
          gradientIdBuffer: gradientBuffer?.buffer ?? layer0.strokeData.gradientIdBuffer,
          gradientDefIdBuffer: gradientDefBuffer?.buffer ?? layer0.strokeData.gradientDefIdBuffer,
          speedBuffer: speedBuffer?.buffer ?? layer0.strokeData.speedBuffer,
          flowBuffer: flowBuffer?.buffer ?? layer0.strokeData.flowBuffer,
          phaseBuffer: phaseBuffer?.buffer ?? layer0.strokeData.phaseBuffer,
        }
      : layer0.strokeData,
  };

  return {
    ...currentState,
    layers: [nextLayer0, ...currentState.layers.slice(1)],
  };
};

export const createSelectionPasteHelpers = ({
  get,
  captureCanvasToActiveLayer,
  set,
}: {
  get: StoreGet;
  set: StoreSet;
  captureCanvasToActiveLayer: CaptureFn;
}) => {
  const commitFloatingPaste = async (): Promise<void> => {
    let state = get();
    const { floatingPaste, layers, activeLayerId, project } = state;

    if (!floatingPaste || !project) {
      return;
    }

    const originalFloatingPaste = floatingPaste;
    const targetLayerId = activeLayerId ?? layers[0]?.id;
    if (!targetLayerId) {
      return;
    }

    const activeLayer = layers.find((layer) => layer.id === targetLayerId);
    if (!activeLayer) {
      return;
    }
    let targetLayer = activeLayer;

    if (
      targetLayer.layerType === 'color-cycle' &&
      targetLayer.colorCycleData &&
      (
        targetLayer.colorCycleData.deferredRuntimeRestore === true ||
        targetLayer.colorCycleData.runtimeHydrationState === 'cold'
      ) &&
      typeof state.ensureColorCycleLayerRuntime === 'function'
    ) {
      showAppFeedback('Preparing color-cycle layer... 0%');
      const progressTimer = globalThis.setTimeout(() => {
        showAppFeedback('Preparing color-cycle layer... 56%');
      }, 120);
      const warmed = await state.ensureColorCycleLayerRuntime(targetLayer.id, { target: 'active' });
      globalThis.clearTimeout(progressTimer);
      state = get();
      if (
        state.floatingPaste !== originalFloatingPaste ||
        (state.activeLayerId ?? state.layers[0]?.id) !== targetLayerId ||
        state.project !== project
      ) {
        return;
      }
      const warmedLayer = state.layers.find((layer) => layer.id === targetLayer.id);
      if (!warmed || !warmedLayer || warmedLayer.layerType !== 'color-cycle') {
        showAppFeedback('This color-cycle layer is preview-only and cannot be edited');
        state.addNotification?.({
          type: 'warning',
          title: 'Paste blocked',
          message: 'This color-cycle layer is still preparing. Try again when it is ready.',
          timestamp: new Date(),
        });
        return;
      }
      showAppFeedback('Color-cycle layer ready');
      targetLayer = warmedLayer;
    }

    const beforeColorState =
      targetLayer.layerType === 'color-cycle'
        ? captureColorCycleBrushState(targetLayer.id)
        : null;
    const floatingPasteHistoryContext = state.floatingPasteHistoryContext;
    const useMoveHistoryContext = Boolean(
      floatingPasteHistoryContext &&
      floatingPaste.sourceLayerId &&
      floatingPasteHistoryContext.sourceLayerId === floatingPaste.sourceLayerId &&
      targetLayer.id === floatingPasteHistoryContext.sourceLayerId
    );
    const historyBeforeColorState = (() => {
      if (!useMoveHistoryContext) {
        return beforeColorState;
      }
      const contextState = floatingPasteHistoryContext?.beforeColorState;
      if (contextState) {
        return contextState;
      }
      if (
        activeLayer.layerType === 'color-cycle' &&
        floatingPasteHistoryContext &&
        floatingPaste.colorCycleIndices &&
        project
      ) {
        return rebuildMoveBeforeColorState({
          currentState: beforeColorState,
          sourceBounds: floatingPasteHistoryContext.sourceBounds,
          sourceIndices: floatingPaste.colorCycleIndices,
          sourceGradientIds: floatingPasteHistoryContext.sourceGradientIds,
          sourceGradientDefIds: floatingPasteHistoryContext.sourceGradientDefIds,
          sourceSpeed: floatingPasteHistoryContext.sourceSpeed,
          sourceFlow: floatingPasteHistoryContext.sourceFlow,
          sourcePhase: floatingPasteHistoryContext.sourcePhase,
          sourceWidth: floatingPaste.width,
          sourceHeight: floatingPaste.height,
          canvasWidth: project.width,
          canvasHeight: project.height,
        });
      }
      return beforeColorState;
    })();
    const addNotification = state.addNotification;
    let beforeImage: ImageData | null = null;
    let moveHistoryRoi: Rectangle | null = null;

    try {
      const destinationRect = getDestinationRect(floatingPaste);
      const rotation = floatingPaste.rotation ?? 0;
      const rotatedBounds = getRotatedBoundingRect(destinationRect, rotation);
      if (useMoveHistoryContext && floatingPasteHistoryContext) {
        const sourceRect = floatingPasteHistoryContext.sourceBounds;
        const destRect = roundRect(rotatedBounds);
        moveHistoryRoi = unionWithProjectBounds(sourceRect, destRect, project);
        if (moveHistoryRoi && floatingPasteHistoryContext.beforeImage) {
          const extractedBeforeImage = extractImageDataRoi(
            floatingPasteHistoryContext.beforeImage,
            moveHistoryRoi
          );
          if (extractedBeforeImage) {
            beforeImage = extractedBeforeImage;
          }
        }
      }
      const colorCycleDestRect = toRoundedDestinationRect(destinationRect);

      debugLog('selection-paste-cc', 'CC destRect', {
        layerId: targetLayer.id,
        rect: colorCycleDestRect,
        indicesLen: floatingPaste.colorCycleIndices?.length ?? 0,
      });

      const resolvedColorCycleIndices = hasColorCycleIndices(floatingPaste)
        ? floatingPaste.colorCycleIndices
        : null;
      const resolvedGradientSlot = (() => {
        if (targetLayer.layerType !== 'color-cycle' || !hasColorCycleIndices(floatingPaste)) {
          return undefined;
        }
        const data = targetLayer.colorCycleData;
        if (typeof data?.paintSlot === 'number') {
          return data.paintSlot;
        }
        const activeDef = data?.activeGradientId
          ? data.gradientDefs?.find((entry) => entry.id === data.activeGradientId)
          : (data?.gradientDefs?.[0] ?? null);
        if (typeof activeDef?.currentSlot === 'number') {
          return activeDef.currentSlot;
        }
        return undefined;
      })();
      const hasColorCycleData = Boolean(resolvedColorCycleIndices && resolvedColorCycleIndices.length > 0);

      if (targetLayer.layerType === 'color-cycle' && !hasColorCycleData) {
        const feedbackMessage = 'Cannot paste bitmap pixels into a CC layer';
        const notificationMessage = 'Bitmap paste into a color-cycle layer is blocked. Paste onto a normal layer, or copy from a color-cycle layer to preserve color-cycle data.';
        debugWarn('selection-paste-cc', 'Missing color cycle indices for paste commit', {
          layerId: targetLayer.id,
        });
        showAppFeedback(feedbackMessage);
        addNotification?.({
          type: 'warning',
          title: 'Paste blocked',
          message: notificationMessage,
          timestamp: new Date(),
        });
        return;
      }

      if (targetLayer.layerType === 'color-cycle' && hasColorCycleData) {
        let pasteTransactionId: string | null = null;
        let pasteTransactionKind = 'paste-commit';
        const targetCanvas = targetLayer.colorCycleData?.canvas ?? targetLayer.framebuffer ?? null;
        const targetCanonical = buildCcCanonicalPayload(
          state,
          targetLayer.id,
          targetCanvas?.width ?? project.width,
          targetCanvas?.height ?? project.height
        );
        const pastePreflight = runCcSelectionTransaction({
          operation: 'commit-floating-paste',
          activeLayer: targetLayer,
          activeLayerId: targetLayer.id,
          project,
          selectionStart: { x: colorCycleDestRect.x, y: colorCycleDestRect.y },
          selectionEnd: {
            x: colorCycleDestRect.x + colorCycleDestRect.width,
            y: colorCycleDestRect.y + colorCycleDestRect.height,
          },
          selectionMask: null,
          selectionMaskBounds: null,
          selectionMaskLayerId: null,
          selectionLastAction: null,
          canonical: targetCanonical,
          requireGradientDefinitionPresence: false,
        });
        if (!pastePreflight.ok) {
          logCcPasteTransactionBlocked({
            layerId: targetLayer.id,
            layer: targetLayer,
            operation: 'commit-floating-paste',
            transactionId: pastePreflight.transactionId,
            kind: pastePreflight.kind,
            details: pastePreflight.details,
          });
          showAppFeedback('Paste blocked');
          addNotification?.({
            type: 'warning',
            title: 'Paste blocked',
            message: 'This color-cycle layer is not ready for paste. The floating selection was kept active.',
            timestamp: new Date(),
          });
          return;
        }
        pasteTransactionId = pastePreflight.transactionId;
        pasteTransactionKind = pastePreflight.kind;

        const requiresResample =
          colorCycleDestRect.width !== floatingPaste.width ||
          colorCycleDestRect.height !== floatingPaste.height;
        const colorCycleSourceIndices = requiresResample
          ? resampleScalarNearest(
              resolvedColorCycleIndices!,
              floatingPaste.width,
              floatingPaste.height,
              colorCycleDestRect.width,
              colorCycleDestRect.height
            )
          : resolvedColorCycleIndices!;
        const colorCycleSourceGradientIds = floatingPaste.colorCycleGradientIds
          ? (requiresResample
            ? resampleScalarNearest(
                floatingPaste.colorCycleGradientIds,
                floatingPaste.width,
                floatingPaste.height,
                colorCycleDestRect.width,
                colorCycleDestRect.height
              )
            : floatingPaste.colorCycleGradientIds)
          : null;
        let remappedGradientDefs = floatingPaste.colorCycleGradientDefs ?? null;
        let colorCycleRemappedGradientIds = colorCycleSourceGradientIds;
        if (colorCycleRemappedGradientIds?.length) {
          const mergedPalettes = mergeTransferredColorCycleSlotPalettes({
            layer: targetLayer,
            palettes: floatingPaste.colorCycleSlotPalettes ?? null,
            gradientIds: colorCycleRemappedGradientIds,
          });
          targetLayer = mergedPalettes.layer;
          colorCycleRemappedGradientIds = mergedPalettes.remappedGradientIds;
          if (mergedPalettes.slotRemap.size > 0 && remappedGradientDefs?.length) {
            remappedGradientDefs = remappedGradientDefs.map((entry) => ({
              ...entry,
              slot: typeof entry.slot === 'number'
                ? (mergedPalettes.slotRemap.get(entry.slot) ?? entry.slot)
                : entry.slot,
            }));
          }
          if (mergedPalettes.changed) {
            state.updateLayer(targetLayer.id, { colorCycleData: targetLayer.colorCycleData }, { skipColorCycleSync: true });
          }
        }
        let colorCycleSourceGradientDefIds = floatingPaste.colorCycleGradientDefIds
          ? (requiresResample
            ? resampleScalarNearest16(
                floatingPaste.colorCycleGradientDefIds,
                floatingPaste.width,
                floatingPaste.height,
                colorCycleDestRect.width,
                colorCycleDestRect.height
              )
            : floatingPaste.colorCycleGradientDefIds)
          : null;
        if (colorCycleSourceGradientDefIds?.length) {
          const merged = mergeTransferredColorCycleGradientDefs({
            layer: targetLayer,
            defs: remappedGradientDefs,
            defIds: colorCycleSourceGradientDefIds,
          });
          targetLayer = merged.layer;
          colorCycleSourceGradientDefIds = merged.remappedDefIds;
          if (merged.changed) {
            state.updateLayer(targetLayer.id, { colorCycleData: targetLayer.colorCycleData }, { skipColorCycleSync: true });
          }
        }
        const colorCycleSourceSpeed = floatingPaste.colorCycleSpeed
          ? (requiresResample
            ? resampleScalarNearest(
                floatingPaste.colorCycleSpeed,
                floatingPaste.width,
                floatingPaste.height,
                colorCycleDestRect.width,
                colorCycleDestRect.height
              )
            : floatingPaste.colorCycleSpeed)
          : null;
        const colorCycleSourceFlow = floatingPaste.colorCycleFlow
          ? (requiresResample
            ? resampleScalarNearest(
                floatingPaste.colorCycleFlow,
                floatingPaste.width,
                floatingPaste.height,
                colorCycleDestRect.width,
                colorCycleDestRect.height
              )
            : floatingPaste.colorCycleFlow)
          : null;
        const colorCycleSourcePhase = floatingPaste.colorCyclePhase
          ? (requiresResample
            ? resampleScalarNearest(
                floatingPaste.colorCyclePhase,
                floatingPaste.width,
                floatingPaste.height,
                colorCycleDestRect.width,
                colorCycleDestRect.height
              )
            : floatingPaste.colorCyclePhase)
          : null;
        const colorCycleSourceWidth = requiresResample ? colorCycleDestRect.width : floatingPaste.width;
        const colorCycleSourceHeight = requiresResample ? colorCycleDestRect.height : floatingPaste.height;
        const resampledAlphaData = requiresResample
          ? resampleAlphaNearest(
              floatingPaste.imageData,
              colorCycleDestRect.width,
              colorCycleDestRect.height
            )
          : null;
        const bitmapAlphaData = requiresResample
          ? resampledAlphaData
          : (floatingPaste.imageData?.data ?? null);
        const hasBitmapAlpha = bitmapAlphaData
          ? bitmapAlphaData.some((value) => value > 0)
          : false;
        const synthesizedAlpha = hasBitmapAlpha
          ? null
          : buildOpaqueAlphaFromIndices(colorCycleSourceIndices);
        const alphaData = hasBitmapAlpha ? bitmapAlphaData : synthesizedAlpha;
        const alphaStride = hasBitmapAlpha
          ? (requiresResample ? 1 : 4)
          : 1;
        const alphaChannelOffset = hasBitmapAlpha
          ? (requiresResample ? 0 : 3)
          : 0;

        const beforeRegion = debugCaptureColorCycleScalarRegion(targetLayer, project, colorCycleDestRect);
        const applied = writeColorCycleRegion(
          state,
          targetLayer,
          project,
          colorCycleDestRect,
          colorCycleSourceIndices,
          colorCycleSourceWidth,
          colorCycleSourceHeight,
          {
            offsetX: 0,
            offsetY: 0,
            alphaData,
            alphaStride,
            alphaChannelOffset,
            alphaThreshold: 0,
            gradientSlot: resolvedGradientSlot,
            sourceGradientIds: colorCycleRemappedGradientIds,
            sourceGradientDefIds: colorCycleSourceGradientDefIds,
            sourceSpeed: colorCycleSourceSpeed,
            sourceFlow: colorCycleSourceFlow,
            sourcePhase: colorCycleSourcePhase,
          }
        );
        const afterRegion = debugCaptureColorCycleScalarRegion(targetLayer, project, colorCycleDestRect);

        const beforeNonZero = beforeRegion ? beforeRegion.some((value) => value !== 0) : null;
        const afterNonZero = afterRegion ? afterRegion.some((value) => value !== 0) : null;
        debugLog('selection-paste-cc', 'CC region diff', {
          applied,
          beforeNonZero,
          afterNonZero,
          firstBefore: beforeRegion ? beforeRegion.slice(0, 16) : null,
          firstAfter: afterRegion ? afterRegion.slice(0, 16) : null,
        });

        if (applied) {
          logCcPasteTransactionEvent({
            layerId: targetLayer.id,
            layer: targetLayer,
            operation: 'commit-floating-paste',
            transactionId: pasteTransactionId ?? 'unknown',
            event: 'cc-selection-transaction-paste-committed',
            kind: pasteTransactionKind,
            details: {
              bounds: colorCycleDestRect,
              sourceLayerId: floatingPaste.sourceLayerId ?? null,
            },
          });
          const eraseMask = targetLayer.colorCycleData?.eraseMask;
          const eraseMaskCtx = eraseMask?.getContext('2d', { willReadFrequently: true });
        if (eraseMaskCtx) {
          eraseMaskCtx.clearRect(
            colorCycleDestRect.x,
              colorCycleDestRect.y,
              colorCycleDestRect.width,
              colorCycleDestRect.height
            );
            state.updateLayer(
              targetLayer.id,
              {
                colorCycleData: {
                  ...(targetLayer.colorCycleData ?? {}),
                  eraseMask,
                },
              },
            { skipColorCycleSync: true }
          );
        }
        state.scheduleColorCycleSlotRebuild?.('selection-paste-commit');
        requestGradientApply(targetLayer.id, 'selection-paste-commit');
        state.setLayersNeedRecomposition(true);
        state.setCurrentCompositeBitmap(null);

          await commitLayerHistory(buildCcSelectionHistoryPayload({
            transactionId: pasteTransactionId ?? 'unknown',
            operation: 'commit-floating-paste',
            layerId: targetLayer.id,
            beforeImage,
            beforeColorState: historyBeforeColorState,
            bitmapRoi: moveHistoryRoi ?? colorCycleDestRect,
            actionType: 'paste',
            description: 'Committed paste',
            tool: 'paste',
            selectionBefore: useMoveHistoryContext ? floatingPasteHistoryContext?.selectionBefore : undefined,
          }));

          set({ floatingPaste: null, floatingPasteHistoryContext: null });
          return;
        }

        debugWarn('selection-paste-cc', 'Failed to write color-cycle paste region', {
          layerId: targetLayer.id,
          rect: colorCycleDestRect,
        });
        logCcPasteTransactionEvent({
          layerId: targetLayer.id,
          layer: targetLayer,
          operation: 'commit-floating-paste',
          transactionId: pasteTransactionId ?? 'unknown',
          event: 'cc-selection-transaction-failed',
          kind: pasteTransactionKind,
          severity: 'error',
          details: {
            reason: 'destination-write-failed',
            bounds: colorCycleDestRect,
            sourceLayerId: floatingPaste.sourceLayerId ?? null,
          },
        });
        return;
      }

      if (!floatingPaste.imageData) {
        debugWarn('selection-paste', 'Missing bitmap data for paste operation.');
        return;
      }

      const captureArea = intersectWithProject(rotatedBounds, project);
      if (!captureArea) {
        set({ floatingPaste: null, floatingPasteHistoryContext: null });
        return;
      }

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = project.width;
      tempCanvas.height = project.height;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      if (!tempCtx) {
        return;
      }

      if (activeLayer.imageData) {
        try {
          tempCtx.putImageData(activeLayer.imageData, 0, 0);
        } catch {}
      } else if (activeLayer.framebuffer) {
        try {
          tempCtx.drawImage(activeLayer.framebuffer, 0, 0);
        } catch {}
      }

      const roundedDestRect = {
        x: Math.round(destinationRect.x),
        y: Math.round(destinationRect.y),
        width: Math.round(destinationRect.width),
        height: Math.round(destinationRect.height),
      };
      const roiX = clamp(roundedDestRect.x, 0, project.width);
      const roiY = clamp(roundedDestRect.y, 0, project.height);
      const roiWidth = clamp(roundedDestRect.width, 0, project.width - roiX);
      const roiHeight = clamp(roundedDestRect.height, 0, project.height - roiY);
      const bitmapRoi =
        roiWidth > 0 && roiHeight > 0
          ? {
              x: roiX,
              y: roiY,
              width: roiWidth,
              height: roiHeight,
            }
          : null;
      if (
        !beforeImage &&
        useMoveHistoryContext &&
        moveHistoryRoi &&
        floatingPasteHistoryContext &&
        (floatingPasteHistoryContext.sourceBeforeImage || floatingPaste.imageData)
      ) {
        beforeImage = synthesizeMoveBeforeImage({
          roi: moveHistoryRoi,
          sourceBounds: floatingPasteHistoryContext.sourceBounds,
          sourceImage: floatingPasteHistoryContext.sourceBeforeImage ?? floatingPaste.imageData!,
          context2d: tempCtx,
        });
      }
      if (!beforeImage) {
        beforeImage = bitmapRoi
          ? tempCtx.getImageData(bitmapRoi.x, bitmapRoi.y, bitmapRoi.width, bitmapRoi.height)
          : null;
      }

      const pasteCanvas = document.createElement('canvas');
      pasteCanvas.width = floatingPaste.width;
      pasteCanvas.height = floatingPaste.height;
      const pasteCtx = pasteCanvas.getContext('2d', { willReadFrequently: true });
      if (pasteCtx) {
        try {
          pasteCtx.putImageData(floatingPaste.imageData, 0, 0);
        } catch {}

        // Selection scale/transform should preserve exact pixel alpha values.
        tempCtx.imageSmoothingEnabled = false;
        const isPixelExactPaste =
          !rotation &&
          Math.round(destinationRect.width) === floatingPaste.width &&
          Math.round(destinationRect.height) === floatingPaste.height;

        if (rotation) {
          const centerX = destinationRect.x + destinationRect.width / 2;
          const centerY = destinationRect.y + destinationRect.height / 2;
          const radians = (rotation * Math.PI) / 180;
          tempCtx.save();
          tempCtx.translate(centerX, centerY);
          tempCtx.rotate(radians);
          tempCtx.drawImage(
            pasteCanvas,
            -destinationRect.width / 2,
            -destinationRect.height / 2,
            destinationRect.width,
            destinationRect.height
          );
          tempCtx.restore();
        } else if (isPixelExactPaste) {
          tempCtx.putImageData(
            floatingPaste.imageData,
            Math.round(destinationRect.x),
            Math.round(destinationRect.y)
          );
        } else {
          const sourceCrop = deriveSourceCrop(
            captureArea,
            destinationRect,
            floatingPaste.width,
            floatingPaste.height
          );
          if (!sourceCrop) {
            set({ floatingPaste: null });
            return;
          }

          tempCtx.drawImage(
            pasteCanvas,
            sourceCrop.x,
            sourceCrop.y,
            sourceCrop.width,
            sourceCrop.height,
            captureArea.x,
            captureArea.y,
            captureArea.width,
            captureArea.height
          );
        }
      }

      await captureCanvasToActiveLayer(tempCanvas, captureArea);

      await commitLayerHistory({
        layerId: activeLayer.id,
        beforeImage,
        beforeColorState: historyBeforeColorState,
        bitmapRoi: moveHistoryRoi ?? bitmapRoi ?? undefined,
        actionType: 'paste',
        description: 'Committed paste',
        tool: 'paste',
        selectionBefore: useMoveHistoryContext ? floatingPasteHistoryContext?.selectionBefore : undefined,
      });

      set({ floatingPaste: null, floatingPasteHistoryContext: null });
    } catch (error) {
      logError('[floatingPaste] Failed to commit paste', error);
    }
  };

  const cancelFloatingPaste = (): void => {
    const state = get();
    const floatingPaste = state.floatingPaste;
    const project = state.project;

    if (
      floatingPaste &&
      hasColorCycleIndices(floatingPaste) &&
      floatingPaste.sourceLayerId &&
      project
    ) {
      const targetLayer = state.layers.find((layer) => layer.id === floatingPaste.sourceLayerId);
      if (targetLayer && targetLayer.layerType === 'color-cycle') {
        let restoreTransactionId: string | null = null;
        let restoreTransactionKind = 'paste-cancel-restore';
        const targetCanvas = targetLayer.colorCycleData?.canvas ?? targetLayer.framebuffer ?? null;
        const restoreRect = {
          x: floatingPaste.originalPosition.x,
          y: floatingPaste.originalPosition.y,
          width: floatingPaste.width,
          height: floatingPaste.height,
        };
        const targetCanonical = buildCcCanonicalPayload(
          state,
          targetLayer.id,
          targetCanvas?.width ?? project.width,
          targetCanvas?.height ?? project.height
        );
        const restorePreflight = runCcSelectionTransaction({
          operation: 'cancel-floating-paste',
          activeLayer: targetLayer,
          activeLayerId: targetLayer.id,
          project,
          selectionStart: { x: restoreRect.x, y: restoreRect.y },
          selectionEnd: {
            x: restoreRect.x + restoreRect.width,
            y: restoreRect.y + restoreRect.height,
          },
          selectionMask: null,
          selectionMaskBounds: null,
          selectionMaskLayerId: null,
          selectionLastAction: null,
          canonical: targetCanonical,
          requireGradientDefinitionPresence: false,
        });
        if (!restorePreflight.ok) {
          logCcPasteTransactionBlocked({
            layerId: targetLayer.id,
            layer: targetLayer,
            operation: 'cancel-floating-paste',
            transactionId: restorePreflight.transactionId,
            kind: restorePreflight.kind,
            details: restorePreflight.details,
          });
          return;
        }
        restoreTransactionId = restorePreflight.transactionId;
        restoreTransactionKind = restorePreflight.kind;

        const bitmapAlphaData = floatingPaste.imageData?.data ?? null;
        const hasBitmapAlpha = bitmapAlphaData
          ? bitmapAlphaData.some((value, index) => index % 4 === 3 && value > 0)
          : false;
        const synthesizedAlpha = hasBitmapAlpha
          ? null
          : buildOpaqueAlphaFromIndices(floatingPaste.colorCycleIndices);
        const alphaData = hasBitmapAlpha ? bitmapAlphaData : synthesizedAlpha;
        const restoreAlreadyMatches = colorCyclePayloadAlreadyMatchesRegion(
          targetCanonical,
          restoreRect,
          floatingPaste.colorCycleIndices,
          floatingPaste.width,
          floatingPaste.height,
          {
            sourceGradientIds: floatingPaste.colorCycleGradientIds,
            sourceGradientDefIds: floatingPaste.colorCycleGradientDefIds,
            sourceSpeed: floatingPaste.colorCycleSpeed,
            sourceFlow: floatingPaste.colorCycleFlow,
            sourcePhase: floatingPaste.colorCyclePhase,
            alphaData,
            alphaStride: hasBitmapAlpha ? 4 : 1,
            alphaChannelOffset: hasBitmapAlpha ? 3 : 0,
            alphaThreshold: 0,
          }
        );
        const restored = writeColorCycleRegion(
          state,
          targetLayer,
          project,
          restoreRect,
          floatingPaste.colorCycleIndices,
          floatingPaste.width,
          floatingPaste.height,
          {
            sourceGradientIds: floatingPaste.colorCycleGradientIds,
            sourceGradientDefIds: floatingPaste.colorCycleGradientDefIds,
            sourceSpeed: floatingPaste.colorCycleSpeed,
            sourceFlow: floatingPaste.colorCycleFlow,
            sourcePhase: floatingPaste.colorCyclePhase,
            alphaData,
            alphaStride: hasBitmapAlpha ? 4 : 1,
            alphaChannelOffset: hasBitmapAlpha ? 3 : 0,
            alphaThreshold: 0,
          }
        );
        if (!restored && !restoreAlreadyMatches) {
          logCcPasteTransactionEvent({
            layerId: targetLayer.id,
            layer: targetLayer,
            operation: 'cancel-floating-paste',
            transactionId: restoreTransactionId ?? 'unknown',
            event: 'cc-selection-transaction-failed',
            kind: restoreTransactionKind,
            severity: 'error',
            details: {
              reason: 'restore-write-failed',
              bounds: restoreRect,
              sourceLayerId: floatingPaste.sourceLayerId,
            },
          });
          return;
        }
        logCcPasteTransactionEvent({
          layerId: targetLayer.id,
          layer: targetLayer,
          operation: 'cancel-floating-paste',
          transactionId: restoreTransactionId ?? 'unknown',
          event: 'cc-selection-transaction-restored',
          kind: restoreTransactionKind,
          details: {
            bounds: restoreRect,
            sourceLayerId: floatingPaste.sourceLayerId,
            noOpRestore: !restored,
          },
        });
        state.scheduleColorCycleSlotRebuild?.('selection-paste-cancel');
        requestGradientApply(targetLayer.id, 'selection-paste-cancel');
        state.setLayersNeedRecomposition(true);
        state.setCurrentCompositeBitmap(null);
        set({ floatingPaste: null, floatingPasteHistoryContext: null });
        return;
      }
    }

    if (floatingPaste && floatingPaste.imageData && floatingPaste.sourceLayerId) {
      const targetLayer = state.layers.find((layer) => layer.id === floatingPaste.sourceLayerId);
      let layerImageData = targetLayer?.imageData || null;

      if (!layerImageData && targetLayer?.framebuffer) {
        try {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = targetLayer.framebuffer.width;
          tempCanvas.height = targetLayer.framebuffer.height;
          const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
          if (tempCtx) {
            tempCtx.drawImage(targetLayer.framebuffer, 0, 0);
            layerImageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
          }
        } catch {
          layerImageData = null;
        }
      }

      if (layerImageData) {
        const restoredLayerData = new Uint8ClampedArray(layerImageData.data);
        const pasteData = floatingPaste.imageData.data;
        const pasteWidth = floatingPaste.imageData.width;
        const pasteHeight = floatingPaste.imageData.height;
        const baseX = clamp(Math.round(floatingPaste.originalPosition.x), 0, layerImageData.width);
        const baseY = clamp(Math.round(floatingPaste.originalPosition.y), 0, layerImageData.height);

        for (let y = 0; y < pasteHeight; y++) {
          const targetY = baseY + y;
          if (targetY < 0 || targetY >= layerImageData.height) continue;

          for (let x = 0; x < pasteWidth; x++) {
            const targetX = baseX + x;
            if (targetX < 0 || targetX >= layerImageData.width) continue;

            const destIndex = (targetY * layerImageData.width + targetX) * 4;
            const srcIndex = (y * pasteWidth + x) * 4;

            restoredLayerData[destIndex] = pasteData[srcIndex];
            restoredLayerData[destIndex + 1] = pasteData[srcIndex + 1];
            restoredLayerData[destIndex + 2] = pasteData[srcIndex + 2];
            restoredLayerData[destIndex + 3] = pasteData[srcIndex + 3];
          }
        }

        const restoredImage = new ImageData(restoredLayerData, layerImageData.width, layerImageData.height);
        const targetFramebuffer = targetLayer?.framebuffer ?? null;
        if (targetFramebuffer) {
          try {
            if (
              targetFramebuffer.width !== restoredImage.width ||
              targetFramebuffer.height !== restoredImage.height
            ) {
              targetFramebuffer.width = restoredImage.width;
              targetFramebuffer.height = restoredImage.height;
            }
            const fbCtx = targetFramebuffer.getContext('2d', { willReadFrequently: true }) as
              | CanvasRenderingContext2D
              | OffscreenCanvasRenderingContext2D
              | null;
            if (fbCtx && 'putImageData' in fbCtx) {
              fbCtx.putImageData(restoredImage, 0, 0);
            }
          } catch {
            // Fall back to imageData-only restore if framebuffer sync fails.
          }
        }

        state.updateLayer(
          floatingPaste.sourceLayerId,
          targetFramebuffer
            ? { imageData: restoredImage, framebuffer: targetFramebuffer }
            : { imageData: restoredImage }
        );
        state.setLayersNeedRecomposition(true);
        set({ floatingPaste: null, floatingPasteHistoryContext: null });
        return;
      }
    }

    set({ floatingPaste: null, floatingPasteHistoryContext: null });
  };

  return {
    commitFloatingPaste,
    cancelFloatingPaste,
  };
};
