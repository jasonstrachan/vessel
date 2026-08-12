import type { StoreApi } from 'zustand';
import type { AppState } from '@/stores/useAppStore';
import type { Layer, Rectangle } from '@/types';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import { requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { showAppFeedback } from '@/utils/appFeedback';
import { debugLog, debugWarn, logError } from '@/utils/debug';
import {
  getFloatingPasteDestinationRect,
  getFloatingPasteRotatedBounds,
  rasterizeFloatingPasteBitmap,
  rasterizeFloatingPasteScalar,
  type FloatingPasteFloatRect,
} from '@/utils/selection/floatingPasteRaster';
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
import { DEFAULT_BRUSH_COLOR_CYCLE_SPEED } from '@/constants/colorCycle';
import { encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';
import { resolveLayerColorCycleBaseSpeedFromLayer } from '@/utils/colorCycleLayerSpeed';
import {
  buildColorCycleCanonicalSelectionPayloadFromSnapshot,
  rebuildColorCycleSerializedStateRegion,
  type ColorCyclePaintSnapshot,
} from '@/lib/colorCycle/document/paintDeltaMask';
import type { ColorCycleLayerDocumentSnapshot } from '@/lib/colorCycle/document/colorCycleDocumentContract';

type StoreGet = StoreApi<AppState>['getState'];
type StoreSet = StoreApi<AppState>['setState'];

type CaptureFn = AppState['captureCanvasToActiveLayer'];
type GetColorCycleDocumentSnapshot = (layerId: string) => ColorCycleLayerDocumentSnapshot | null;

const resolvePaintSnapshot = (
  snapshot: ColorCycleLayerDocumentSnapshot | null,
): ColorCyclePaintSnapshot | null => {
  if (!snapshot?.paintBuffer) {
    return null;
  }
  return {
    paintBuffer: snapshot.paintBuffer,
    gradientIdBuffer: snapshot.gradientIdBuffer,
    gradientDefIdBuffer: snapshot.gradientDefIdBuffer,
    speedBuffer: snapshot.speedBuffer,
    flowBuffer: snapshot.flowBuffer,
    phaseBuffer: snapshot.phaseBuffer,
    hasContent: snapshot.hasContent,
  };
};

const buildCcCanonicalPayload = (
  state: AppState,
  layerId: string,
  fallbackWidth: number,
  fallbackHeight: number,
  getColorCycleDocumentSnapshot: GetColorCycleDocumentSnapshot
): CcCanonicalSelectionPayload => {
  const documentSnapshot = getColorCycleDocumentSnapshot(layerId);
  const layer = state.layers.find((candidate) => candidate.id === layerId);
  const canUseEmptyInitializedCcRuntime = Boolean(layer?.layerType === 'color-cycle' && layer.colorCycleData);
  return buildColorCycleCanonicalSelectionPayloadFromSnapshot({
    snapshot: resolvePaintSnapshot(documentSnapshot),
    width: fallbackWidth,
    height: fallbackHeight,
    allowEmptyInitializedPayload: canUseEmptyInitializedCcRuntime,
  });
};

const hasCompleteCcCanonicalPayload = (payload: CcCanonicalSelectionPayload): boolean => {
  const expectedPixels = Math.max(1, payload.width * payload.height);
  return Boolean(
    payload.paint?.byteLength === expectedPixels &&
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

  const paint = target.paint;
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

const getDestinationRect = (
  floatingPaste: NonNullable<AppState['floatingPaste']>
): FloatingPasteFloatRect => getFloatingPasteDestinationRect(floatingPaste);

const getRotatedBoundingRect = (
  rect: FloatingPasteFloatRect,
  rotation: number
): FloatingPasteFloatRect => getFloatingPasteRotatedBounds(rect, rotation);

const roundRect = (rect: FloatingPasteFloatRect): Rectangle => {
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

const resolveColorCyclePasteGradientSlot = (layer: Layer): number | undefined => {
  if (layer.layerType !== 'color-cycle') {
    return undefined;
  }
  const data = layer.colorCycleData;
  if (typeof data?.paintSlot === 'number' && Number.isFinite(data.paintSlot)) {
    return data.paintSlot;
  }
  const activeDef = data?.activeGradientId
    ? data.gradientDefs?.find((entry) => entry.id === data.activeGradientId)
    : (data?.gradientDefs?.[0] ?? null);
  if (typeof activeDef?.currentSlot === 'number' && Number.isFinite(activeDef.currentSlot)) {
    return activeDef.currentSlot;
  }
  return undefined;
};

const resolveColorCyclePasteGradientDefId = (
  layer: Layer,
  gradientSlot: number | undefined
): number | null => {
  if (layer.layerType !== 'color-cycle' || typeof gradientSlot !== 'number') {
    return null;
  }
  const matched = layer.colorCycleData?.gradientDefStore?.find((entry) => entry.slot === gradientSlot);
  return typeof matched?.id === 'number' && Number.isFinite(matched.id) ? matched.id : null;
};

const resolveColorCyclePasteFlowByte = (layer: Layer): number => {
  const flowMode = layer.layerType === 'color-cycle' ? layer.colorCycleData?.flowMode : undefined;
  if (flowMode === 'reverse') {
    return 2;
  }
  if (flowMode === 'pingpong') {
    return 3;
  }
  return 1;
};

const buildColorCyclePasteFromBitmap = (
  imageData: ImageData | null | undefined,
  targetWidth: number,
  targetHeight: number,
  layer: Layer,
  gradientSlot: number | undefined
): {
  indices: Uint8Array;
  alpha: Uint8Array;
  speed: Uint8Array;
  flow: Uint8Array;
  phase: Uint8Array;
  gradientDefIds: Uint16Array;
} | null => {
  if (!imageData || targetWidth <= 0 || targetHeight <= 0 || imageData.width <= 0 || imageData.height <= 0) {
    return null;
  }

  const pixelCount = targetWidth * targetHeight;
  const indices = new Uint8Array(pixelCount);
  const alpha = new Uint8Array(pixelCount);
  const speed = new Uint8Array(pixelCount);
  const flow = new Uint8Array(pixelCount);
  const phase = new Uint8Array(pixelCount);
  const resolvedDefId = resolveColorCyclePasteGradientDefId(layer, gradientSlot);
  const gradientDefIds = new Uint16Array(pixelCount);
  const gradientDefIdValue = resolvedDefId ?? 0;
  const speedByte = encodeColorCycleSpeedByte(
    resolveLayerColorCycleBaseSpeedFromLayer(layer) ?? DEFAULT_BRUSH_COLOR_CYCLE_SPEED
  );
  const flowByte = resolveColorCyclePasteFlowByte(layer);

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(imageData.height - 1, Math.floor((y * imageData.height) / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(imageData.width - 1, Math.floor((x * imageData.width) / targetWidth));
      const sourceIndex = (sourceY * imageData.width + sourceX) * 4;
      const destIndex = y * targetWidth + x;
      const sourceAlpha = imageData.data[sourceIndex + 3] ?? 0;
      const luminance =
        (0.2126 * (imageData.data[sourceIndex] ?? 0)) +
        (0.7152 * (imageData.data[sourceIndex + 1] ?? 0)) +
        (0.0722 * (imageData.data[sourceIndex + 2] ?? 0));
      const ccIndex = sourceAlpha > 0
        ? Math.max(1, Math.min(255, Math.round((luminance / 255) * 254) + 1))
        : 0;
      indices[destIndex] = ccIndex;
      alpha[destIndex] = sourceAlpha;
      speed[destIndex] = ccIndex > 0 ? speedByte : 0;
      flow[destIndex] = ccIndex > 0 ? flowByte : 0;
      phase[destIndex] = 0;
      gradientDefIds[destIndex] = ccIndex > 0 ? gradientDefIdValue : 0;
    }
  }

  return { indices, alpha, speed, flow, phase, gradientDefIds };
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

const compositeImageDataSourceOver = (
  destination: ImageData,
  source: ImageData
): ImageData => {
  const output = new ImageData(destination.data, destination.width, destination.height);
  const pixelCount = Math.min(destination.width * destination.height, source.width * source.height);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const index = pixelIndex * 4;
    const sourceAlpha = (source.data[index + 3] ?? 0) / 255;
    if (sourceAlpha <= 0) {
      continue;
    }

    const destinationAlpha = (output.data[index + 3] ?? 0) / 255;
    const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    if (outAlpha <= 0) {
      output.data[index] = 0;
      output.data[index + 1] = 0;
      output.data[index + 2] = 0;
      output.data[index + 3] = 0;
      continue;
    }

    output.data[index] = Math.round(
      (((source.data[index] ?? 0) * sourceAlpha) +
        ((output.data[index] ?? 0) * destinationAlpha * (1 - sourceAlpha))) /
        outAlpha
    );
    output.data[index + 1] = Math.round(
      (((source.data[index + 1] ?? 0) * sourceAlpha) +
        ((output.data[index + 1] ?? 0) * destinationAlpha * (1 - sourceAlpha))) /
        outAlpha
    );
    output.data[index + 2] = Math.round(
      (((source.data[index + 2] ?? 0) * sourceAlpha) +
        ((output.data[index + 2] ?? 0) * destinationAlpha * (1 - sourceAlpha))) /
        outAlpha
    );
    output.data[index + 3] = Math.round(outAlpha * 255);
  }

  return output;
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
  if (!currentState) {
    return currentState;
  }
  return rebuildColorCycleSerializedStateRegion<NonNullable<ColorCycleSerializedState>>({
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
  });
};

export const createSelectionPasteHelpers = ({
  get,
  captureCanvasToActiveLayer,
  set,
  getColorCycleDocumentSnapshot,
}: {
  get: StoreGet;
  set: StoreSet;
  captureCanvasToActiveLayer: CaptureFn;
  getColorCycleDocumentSnapshot?: GetColorCycleDocumentSnapshot;
}) => {
  const readColorCycleDocumentSnapshot = getColorCycleDocumentSnapshot ?? (() => null);
  let floatingPasteCommitPromise: Promise<void> | null = null;

  const performFloatingPasteCommit = async (): Promise<void> => {
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
      const floatingPasteHasColorCycleIndices = hasColorCycleIndices(floatingPaste);
      let colorCycleDestRect: Rectangle | null = null;
      let rasterizedPasteImageData: ImageData | null = null;
      let projectedColorCycleIndices: Uint8Array | null = null;
      if (targetLayer.layerType === 'color-cycle' && floatingPaste.imageData) {
        const bitmapRaster = rasterizeFloatingPasteBitmap(
          { ...floatingPaste, imageData: floatingPaste.imageData },
          project
        );
        if (!bitmapRaster) {
          set({ floatingPaste: null, floatingPasteHistoryContext: null });
          return;
        }
        const rasterCtx = bitmapRaster.canvas.getContext('2d', { willReadFrequently: true });
        if (!rasterCtx) {
          debugWarn('selection-paste-cc', 'Missing raster context for bitmap CC paste', {
            layerId: targetLayer.id,
          });
          return;
        }
        colorCycleDestRect = bitmapRaster.roi;
        rasterizedPasteImageData = rasterCtx.getImageData(
          0,
          0,
          bitmapRaster.roi.width,
          bitmapRaster.roi.height,
        );
      }
      if (targetLayer.layerType === 'color-cycle' && floatingPaste.colorCycleIndices) {
        const scalarRaster = rasterizeFloatingPasteScalar(
          floatingPaste,
          floatingPaste.colorCycleIndices,
          project,
        );
        if (!scalarRaster) {
          set({ floatingPaste: null, floatingPasteHistoryContext: null });
          return;
        }
        colorCycleDestRect = scalarRaster.roi;
        projectedColorCycleIndices = scalarRaster.data;
      }

      debugLog('selection-paste-cc', 'CC destRect', {
        layerId: targetLayer.id,
        rect: colorCycleDestRect,
        indicesLen: floatingPaste.colorCycleIndices?.length ?? 0,
      });

      const pastedBitmapColorCycle = targetLayer.layerType === 'color-cycle' && !floatingPasteHasColorCycleIndices
        ? buildColorCyclePasteFromBitmap(
            rasterizedPasteImageData,
            colorCycleDestRect?.width ?? 0,
            colorCycleDestRect?.height ?? 0,
            targetLayer,
            resolveColorCyclePasteGradientSlot(targetLayer)
          )
        : null;
      const resolvedColorCycleIndices = floatingPasteHasColorCycleIndices
        ? projectedColorCycleIndices
        : pastedBitmapColorCycle?.indices ?? null;
      const resolvedGradientSlot = resolveColorCyclePasteGradientSlot(targetLayer);
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

      if (targetLayer.layerType === 'color-cycle' && hasColorCycleData && colorCycleDestRect) {
        let pasteTransactionId: string | null = null;
        let pasteTransactionKind = 'paste-commit';
        const targetCanvas = targetLayer.colorCycleData?.canvas ?? targetLayer.framebuffer ?? null;
        const targetCanonical = buildCcCanonicalPayload(
          state,
          targetLayer.id,
          targetCanvas?.width ?? project.width,
          targetCanvas?.height ?? project.height,
          readColorCycleDocumentSnapshot
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

        const convertedBitmapPaste = Boolean(pastedBitmapColorCycle);
        const colorCycleSourceIndices = convertedBitmapPaste
          ? pastedBitmapColorCycle!.indices
          : resolvedColorCycleIndices!;
        const colorCycleSourceGradientIds = convertedBitmapPaste
          ? null
          : floatingPaste.colorCycleGradientIds
          ? (rasterizeFloatingPasteScalar(
              floatingPaste,
              floatingPaste.colorCycleGradientIds,
              project,
            )?.data ?? null)
          : null;
        let remappedGradientDefs = convertedBitmapPaste ? null : floatingPaste.colorCycleGradientDefs ?? null;
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
        let colorCycleSourceGradientDefIds = convertedBitmapPaste
          ? pastedBitmapColorCycle!.gradientDefIds
          : floatingPaste.colorCycleGradientDefIds
          ? (rasterizeFloatingPasteScalar(
              floatingPaste,
              floatingPaste.colorCycleGradientDefIds,
              project,
            )?.data ?? null)
          : null;
        if (!convertedBitmapPaste && colorCycleSourceGradientDefIds?.length) {
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
        const colorCycleSourceSpeed = convertedBitmapPaste
          ? pastedBitmapColorCycle!.speed
          : floatingPaste.colorCycleSpeed
          ? (rasterizeFloatingPasteScalar(
              floatingPaste,
              floatingPaste.colorCycleSpeed,
              project,
            )?.data ?? null)
          : null;
        const colorCycleSourceFlow = convertedBitmapPaste
          ? pastedBitmapColorCycle!.flow
          : floatingPaste.colorCycleFlow
          ? (rasterizeFloatingPasteScalar(
              floatingPaste,
              floatingPaste.colorCycleFlow,
              project,
            )?.data ?? null)
          : null;
        const colorCycleSourcePhase = convertedBitmapPaste
          ? pastedBitmapColorCycle!.phase
          : floatingPaste.colorCyclePhase
          ? (rasterizeFloatingPasteScalar(
              floatingPaste,
              floatingPaste.colorCyclePhase,
              project,
            )?.data ?? null)
          : null;
        const colorCycleSourceWidth = colorCycleDestRect.width;
        const colorCycleSourceHeight = colorCycleDestRect.height;
        const bitmapAlphaData = convertedBitmapPaste
          ? pastedBitmapColorCycle!.alpha
          : (rasterizedPasteImageData?.data ?? null);
        const hasBitmapAlpha = bitmapAlphaData
          ? bitmapAlphaData.some((value) => value > 0)
          : false;
        const synthesizedAlpha = hasBitmapAlpha
          ? null
          : buildOpaqueAlphaFromIndices(colorCycleSourceIndices);
        const alphaData = hasBitmapAlpha ? bitmapAlphaData : synthesizedAlpha;
        const alphaStride = convertedBitmapPaste
          ? 1
          : hasBitmapAlpha
          ? 4
          : 1;
        const alphaChannelOffset = convertedBitmapPaste
          ? 0
          : hasBitmapAlpha
          ? 3
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
            clearTransparentPixels: convertedBitmapPaste,
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
              { skipColorCycleSync: true, dirtyRects: [colorCycleDestRect] }
            );
          }
          state.scheduleColorCycleSlotRebuild?.('selection-paste-commit');
          requestGradientApply(targetLayer.id, 'selection-paste-commit');
          set({ layersNeedRecomposition: true });
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

      const raster = rasterizeFloatingPasteBitmap(
        { ...floatingPaste, imageData: floatingPaste.imageData },
        project
      );
      if (!raster) {
        set({ floatingPaste: null, floatingPasteHistoryContext: null });
        return;
      }
      const captureArea = raster.roi;

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

      const bitmapRoi = raster.roi;
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

      tempCtx.imageSmoothingEnabled = false;
      const rasterCtx = raster.canvas.getContext('2d', { willReadFrequently: true });
      if (rasterCtx) {
        const destinationImage = tempCtx.getImageData(
          raster.roi.x,
          raster.roi.y,
          raster.roi.width,
          raster.roi.height
        );
        const sourceImage = rasterCtx.getImageData(0, 0, raster.roi.width, raster.roi.height);
        tempCtx.putImageData(
          compositeImageDataSourceOver(destinationImage, sourceImage),
          raster.roi.x,
          raster.roi.y
        );
      }

      await captureCanvasToActiveLayer(tempCanvas, captureArea, { mode: 'replace' });

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

  const commitFloatingPaste = (): Promise<void> => {
    if (floatingPasteCommitPromise) {
      return floatingPasteCommitPromise;
    }

    const pendingCommit = performFloatingPasteCommit();
    const trackedCommit = pendingCommit.finally(() => {
      if (floatingPasteCommitPromise === trackedCommit) {
        floatingPasteCommitPromise = null;
      }
    });
    floatingPasteCommitPromise = trackedCommit;
    return trackedCommit;
  };

  const cancelFloatingPaste = (): void => {
    const state = get();
    const floatingPaste = state.floatingPaste;
    const restoreContext = state.floatingPasteHistoryContext;
    const project = state.project;
    const shouldRestoreExtractedSelection = Boolean(
      floatingPaste?.sourceLayerId &&
      restoreContext &&
      restoreContext.sourceLayerId === floatingPaste.sourceLayerId
    );

    if (
      floatingPaste &&
      hasColorCycleIndices(floatingPaste) &&
      floatingPaste.sourceLayerId &&
      shouldRestoreExtractedSelection &&
      project
    ) {
      const targetLayer = state.layers.find((layer) => layer.id === floatingPaste.sourceLayerId);
      if (targetLayer && targetLayer.layerType === 'color-cycle') {
        const sourceIndices = restoreContext?.sourceIndices;
        if (!sourceIndices) {
          logError('[floatingPaste] Cannot restore extracted CC selection without source indices');
          return;
        }
        let restoreTransactionId: string | null = null;
        let restoreTransactionKind = 'paste-cancel-restore';
        const targetCanvas = targetLayer.colorCycleData?.canvas ?? targetLayer.framebuffer ?? null;
        const restoreRect = restoreContext.sourceBounds;
        const targetCanonical = buildCcCanonicalPayload(
          state,
          targetLayer.id,
          targetCanvas?.width ?? project.width,
          targetCanvas?.height ?? project.height,
          readColorCycleDocumentSnapshot
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

        const bitmapAlphaData = restoreContext.sourceBeforeImage?.data ?? null;
        const hasBitmapAlpha = bitmapAlphaData
          ? bitmapAlphaData.some((value, index) => index % 4 === 3 && value > 0)
          : false;
        const synthesizedAlpha = hasBitmapAlpha
          ? null
          : buildOpaqueAlphaFromIndices(sourceIndices);
        const alphaData = hasBitmapAlpha ? bitmapAlphaData : synthesizedAlpha;
        const restoreAlreadyMatches = colorCyclePayloadAlreadyMatchesRegion(
          targetCanonical,
          restoreRect,
          sourceIndices,
          restoreRect.width,
          restoreRect.height,
          {
            sourceGradientIds: restoreContext.sourceGradientIds,
            sourceGradientDefIds: restoreContext.sourceGradientDefIds,
            sourceSpeed: restoreContext.sourceSpeed,
            sourceFlow: restoreContext.sourceFlow,
            sourcePhase: restoreContext.sourcePhase,
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
          sourceIndices,
          restoreRect.width,
          restoreRect.height,
          {
            sourceGradientIds: restoreContext.sourceGradientIds,
            sourceGradientDefIds: restoreContext.sourceGradientDefIds,
            sourceSpeed: restoreContext.sourceSpeed,
            sourceFlow: restoreContext.sourceFlow,
            sourcePhase: restoreContext.sourcePhase,
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
        set({ layersNeedRecomposition: true });
        state.setCurrentCompositeBitmap(null);
        set({ floatingPaste: null, floatingPasteHistoryContext: null });
        return;
      }
    }

    if (
      floatingPaste &&
      floatingPaste.imageData &&
      floatingPaste.sourceLayerId &&
      shouldRestoreExtractedSelection &&
      restoreContext
    ) {
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
        const sourceImage = restoreContext.sourceBeforeImage ?? floatingPaste.imageData;
        const restoredLayerData = new Uint8ClampedArray(layerImageData.data);
        const pasteData = sourceImage.data;
        const pasteWidth = sourceImage.width;
        const pasteHeight = sourceImage.height;
        const baseX = clamp(Math.round(restoreContext.sourceBounds.x), 0, layerImageData.width);
        const baseY = clamp(Math.round(restoreContext.sourceBounds.y), 0, layerImageData.height);

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
            : { imageData: restoredImage },
          {
            dirtyRects: [{
              x: baseX,
              y: baseY,
              width: pasteWidth,
              height: pasteHeight,
            }],
          },
        );
        set({ layersNeedRecomposition: true });
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
