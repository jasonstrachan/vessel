import { debugWarn } from '@/utils/debug';
import { logCCMutation, summarizeColorCycleLayer, summarizeScalarBuffer } from '@/utils/colorCycle/ccMutationAudit';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { copyScalarRegion } from '@/stores/helpers/selectionCapture';
import type { Layer, Project, Rectangle } from '@/types';
import type { AppState } from '@/stores/useAppStore';
import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';

const colorCycleBrushManager = getColorCycleBrushManager();

const resolveLayerBrush = (
  state: Pick<AppState, 'getLayerColorCycleBrush'> | null | undefined,
  layerId: string,
) =>
  (typeof state?.getLayerColorCycleBrush === 'function'
    ? state.getLayerColorCycleBrush(layerId)
    : null) ?? colorCycleBrushManager.getLayerColorCycleBrush(layerId);

type BufferMutator = (buffers: {
  paint: Uint8Array;
  gradientId: Uint8Array;
  gradientDefId: Uint16Array;
  speed: Uint8Array;
  flow: Uint8Array;
  phase: Uint8Array;
  width: number;
  height: number;
}) => boolean;

type ColorCycleClearAuditOptions = {
  source?: string;
  details?: Record<string, unknown>;
};

const getCanvasForLayer = (
  state: Pick<AppState, 'getLayerColorCycleBrush'> | null | undefined,
  layer: Layer,
  fallbackWidth: number,
  fallbackHeight: number,
) => {
  if (layer.colorCycleData?.canvas) {
    return layer.colorCycleData.canvas;
  }
  const brush = resolveLayerBrush(state, layer.id);
  if (brush && typeof brush.getCanvas === 'function') {
    const brushCanvas = brush.getCanvas();
    if (brushCanvas) {
      return brushCanvas;
    }
  }
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, fallbackWidth);
  canvas.height = Math.max(1, fallbackHeight);
  return canvas;
};

const mutateColorCycleLayer = (
  state: AppState,
  layer: Layer,
  project: Project,
  mutator: BufferMutator,
  options?: {
    skipMaterialize?: boolean;
    audit?: ColorCycleClearAuditOptions;
  }
): boolean => {
  if (layer.layerType !== 'color-cycle') {
    return false;
  }

  const fallbackWidth = layer.imageData?.width ?? project.width ?? 0;
  const fallbackHeight = layer.imageData?.height ?? project.height ?? 0;
  const canvas = getCanvasForLayer(state, layer, fallbackWidth, fallbackHeight);
  if (!canvas?.width || !canvas.height) {
    if (process.env.NODE_ENV !== 'production') {
      debugWarn('raw-console', '[cc] invalid canvas in mutateColorCycleLayer', {
        layerId: layer.id,
        canvasWidth: canvas?.width,
        canvasHeight: canvas?.height,
      });
    }
    return false;
  }

  let brush = resolveLayerBrush(state, layer.id);
  if ((!brush?.getLayerSnapshot || !(brush as { applyLayerSnapshot?: unknown }).applyLayerSnapshot) &&
      typeof colorCycleBrushManager.initColorCycleForLayer === 'function') {
    colorCycleBrushManager.initColorCycleForLayer(layer.id, canvas.width, canvas.height);
    brush = resolveLayerBrush(state, layer.id);
  }
  if (!brush?.getLayerSnapshot || !brush.applyLayerSnapshot) {
    return false;
  }

  let snapshot = brush.getLayerSnapshot(layer.id);
  if (!snapshot || !snapshot.paintBuffer || snapshot.paintBuffer.byteLength === 0) {
    const persisted = layer.colorCycleData?.gradientIdBuffer;
    if (persisted) {
      const persistedView = new Uint8Array(persisted);
      const expectedLength = canvas.width * canvas.height;
      if (persistedView.length === expectedLength) {
        const seeded = persistedView.slice();
        brush.applyLayerSnapshot(layer.id, {
          paintBuffer: seeded.buffer,
          hasContent: seeded.some((value) => value !== 0),
          strokeCounter: snapshot?.strokeCounter ?? 0,
        });
        snapshot = brush.getLayerSnapshot(layer.id);
      }
    }
  }
  if (!snapshot) {
    if (process.env.NODE_ENV !== 'production') {
      debugWarn('raw-console', '[cc] no snapshot in mutateColorCycleLayer', { layerId: layer.id });
    }
    return false;
  }

  const bufferLength = canvas.width * canvas.height;
  if (bufferLength <= 0) {
    if (process.env.NODE_ENV !== 'production') {
      debugWarn('raw-console', '[cc] zero bufferLength in mutateColorCycleLayer', {
        layerId: layer.id,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      });
    }
    return false;
  }

  const incoming = snapshot.paintBuffer ? new Uint8Array(snapshot.paintBuffer) : null;
  const incomingGradientId = snapshot.gradientIdBuffer ? new Uint8Array(snapshot.gradientIdBuffer) : null;
  const incomingGradientDefId = snapshot.gradientDefIdBuffer
    ? new Uint16Array(snapshot.gradientDefIdBuffer)
    : (layer.colorCycleData?.gradientDefIdBuffer ? new Uint16Array(layer.colorCycleData.gradientDefIdBuffer) : null);
  const incomingSpeed = snapshot.speedBuffer ? new Uint8Array(snapshot.speedBuffer) : null;
  const incomingFlow = snapshot.flowBuffer ? new Uint8Array(snapshot.flowBuffer) : null;
  const incomingPhase = snapshot.phaseBuffer ? new Uint8Array(snapshot.phaseBuffer) : null;
  if (!incoming && process.env.NODE_ENV !== 'production') {
    debugWarn('raw-console', '[cc] no paintBuffer in snapshot', { layerId: layer.id });
  }
  const working = new Uint8Array(bufferLength);
  const workingGradientId = new Uint8Array(bufferLength);
  const workingGradientDefId = new Uint16Array(bufferLength);
  const workingSpeed = new Uint8Array(bufferLength);
  const workingFlow = new Uint8Array(bufferLength);
  const workingPhase = new Uint8Array(bufferLength);
  if (incoming && incoming.length) {
    if (incoming.length !== bufferLength && process.env.NODE_ENV !== 'production') {
      debugWarn('raw-console', '[cc] paintBuffer/canvas mismatch in mutateColorCycleLayer', {
        layerId: layer.id,
        incoming: incoming.length,
        bufferLength,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      });
    }
    working.set(incoming.subarray(0, Math.min(incoming.length, working.length)));
  }
  const beforePaintSummary = incoming
    ? summarizeScalarBuffer(incoming, canvas.width, canvas.height)
    : null;
  const hadContentBeforeMutation = incoming?.some((value) => value !== 0) ?? Boolean(snapshot.hasContent);

  if (incomingGradientId && incomingGradientId.length) {
    if (incomingGradientId.length !== bufferLength && process.env.NODE_ENV !== 'production') {
      debugWarn('raw-console', '[cc] gradientIdBuffer/canvas mismatch in mutateColorCycleLayer', {
        layerId: layer.id,
        incoming: incomingGradientId.length,
        bufferLength,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      });
    }
    workingGradientId.set(incomingGradientId.subarray(0, Math.min(incomingGradientId.length, workingGradientId.length)));
  }

  if (incomingGradientDefId && incomingGradientDefId.length) {
    workingGradientDefId.set(
      incomingGradientDefId.subarray(0, Math.min(incomingGradientDefId.length, workingGradientDefId.length))
    );
  }

  if (incomingSpeed && incomingSpeed.length) {
    workingSpeed.set(incomingSpeed.subarray(0, Math.min(incomingSpeed.length, workingSpeed.length)));
  }

  if (incomingFlow && incomingFlow.length) {
    workingFlow.set(incomingFlow.subarray(0, Math.min(incomingFlow.length, workingFlow.length)));
  }

  if (incomingPhase && incomingPhase.length) {
    workingPhase.set(incomingPhase.subarray(0, Math.min(incomingPhase.length, workingPhase.length)));
  }

  const mutated = mutator({
    paint: working,
    gradientId: workingGradientId,
    gradientDefId: workingGradientDefId,
    speed: workingSpeed,
    flow: workingFlow,
    phase: workingPhase,
    width: canvas.width,
    height: canvas.height,
  });
  if (!mutated) {
    return false;
  }

  const hasContent = working.some((value) => value !== 0);
  if (hadContentBeforeMutation && !hasContent) {
    const before = summarizeColorCycleLayer(layer);
    const auditSource = options?.audit?.source ?? 'clear-color-cycle-region';
    logCCMutation({
      event: 'color-cycle-layer-cleared',
      layerId: layer.id,
      reason: auditSource,
      severity: 'error',
      before,
      after: before
        ? {
            ...before,
            hasContent: false,
            gradientDefBufferBytes: workingGradientDefId.buffer.byteLength,
            gradientIdBufferBytes: workingGradientId.buffer.byteLength,
          }
        : null,
      details: {
        source: 'selection-region-clear',
        operation: auditSource,
        expectedDestructive: true,
        layerName: layer.name,
        layerVisible: layer.visible,
        layerOpacity: layer.opacity,
        layerBlendMode: layer.blendMode,
        projectId: project.id,
        projectWidth: project.width,
        projectHeight: project.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        bufferLength,
        ...(options?.audit?.details ?? {}),
        paintBefore: beforePaintSummary,
        paintAfter: summarizeScalarBuffer(working, canvas.width, canvas.height),
        gradientIdAfter: summarizeScalarBuffer(workingGradientId, canvas.width, canvas.height),
        gradientDefIdAfter: summarizeScalarBuffer(workingGradientDefId, canvas.width, canvas.height),
        speedAfter: summarizeScalarBuffer(workingSpeed, canvas.width, canvas.height),
        flowAfter: summarizeScalarBuffer(workingFlow, canvas.width, canvas.height),
        phaseAfter: summarizeScalarBuffer(workingPhase, canvas.width, canvas.height),
      },
    });
  }

  (brush.applyLayerSnapshot as (
    layerId: string,
    snapshot: {
      paintBuffer: ArrayBufferLike;
      gradientIdBuffer?: ArrayBufferLike;
      gradientDefIdBuffer?: ArrayBufferLike;
      speedBuffer?: ArrayBufferLike;
      flowBuffer?: ArrayBufferLike;
      phaseBuffer?: ArrayBufferLike;
      hasContent: boolean;
      strokeCounter: number;
    },
    animatorIndex?: unknown,
    reason?: string,
    options?: { suppressClearAudit?: boolean }
  ) => void)(layer.id, {
    paintBuffer: working.buffer,
    gradientIdBuffer: workingGradientId.buffer,
    gradientDefIdBuffer: workingGradientDefId.buffer,
    speedBuffer: workingSpeed.buffer,
    flowBuffer: workingFlow.buffer,
    phaseBuffer: workingPhase.buffer,
    hasContent,
    strokeCounter: snapshot.strokeCounter,
  }, undefined, 'selection-region-clear', { suppressClearAudit: true });

  const skipMaterialize = options?.skipMaterialize === true;
  let syncedImage: ImageData | undefined;
  let resolvedImageData: ImageData | undefined;

  if (!skipMaterialize) {
    try {
      brush.renderDirectToCanvas?.(canvas, layer.id);
    } catch {
      // ignore render errors; state will sync via canvas snapshot
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    syncedImage =
      ctx?.getImageData(0, 0, canvas.width, canvas.height) ?? layer.colorCycleData?.canvasImageData ?? undefined;
    resolvedImageData = syncedImage ?? layer.imageData ?? undefined;
  }

  const nextColorCycleData: NonNullable<Layer['colorCycleData']> | undefined = (() => {
    const base = layer.colorCycleData ?? {};
    const update: Partial<NonNullable<Layer['colorCycleData']>> = {};

    if (base.colorCycleBrush !== brush) {
      update.colorCycleBrush = brush;
    }

    // Always persist the canvas we rendered into so composites read fresh pixels.
    if (canvas && base.canvas !== canvas) {
      update.canvas = canvas;
    }

    if (syncedImage) {
      update.canvasImageData = syncedImage;
    }
    if (base.hasContent !== hasContent) {
      update.hasContent = hasContent;
    }
    update.gradientIdBuffer = workingGradientId.buffer.slice(0) as ArrayBuffer;
    update.gradientDefIdBuffer = workingGradientDefId.buffer.slice(0) as ArrayBuffer;
    update.phaseBuffer = workingPhase.buffer.slice(0) as ArrayBuffer;

    const hasUpdates = Object.keys(update).length > 0;
    return hasUpdates ? { ...base, ...update } : base;
  })();

  state.updateLayer(
    layer.id,
    skipMaterialize
      ? {
          colorCycleData: nextColorCycleData,
        }
      : {
          imageData: resolvedImageData,
          colorCycleData: nextColorCycleData,
        },
    { skipColorCycleSync: true }
  );

  if (!skipMaterialize) {
    // Invalidate composites so the new CC pixels show up immediately.
    state.setCurrentCompositeBitmap?.(null);
    state.setLayersNeedRecomposition?.(true);
    state.markCompositeSegmentsDirtyByLayerIds?.([layer.id]);
  }

  return true;
};

const clampRect = (rect: Rectangle, width: number, height: number) => {
  const startX = Math.max(0, Math.floor(rect.x));
  const startY = Math.max(0, Math.floor(rect.y));
  const endX = Math.min(width, Math.ceil(rect.x + rect.width));
  const endY = Math.min(height, Math.ceil(rect.y + rect.height));
  return { startX, startY, endX, endY };
};

export const clearColorCycleRegion = (
  state: AppState,
  layer: Layer,
  project: Project,
  rect: Rectangle,
  options?: {
    offsetX?: number;
    offsetY?: number;
    alphaData?: Uint8ClampedArray | Uint8Array | null;
    alphaWidth?: number;
    alphaHeight?: number;
    alphaStride?: number;
    alphaChannelOffset?: number;
    alphaThreshold?: number;
    auditSource?: string;
    auditDetails?: Record<string, unknown>;
  }
): boolean => {
  const auditDetails: Record<string, unknown> = {
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    hasAlphaMask: Boolean(options?.alphaData),
    alphaWidth: options?.alphaWidth ?? null,
    alphaHeight: options?.alphaHeight ?? null,
    alphaThreshold: options?.alphaThreshold ?? null,
    ...(options?.auditDetails ?? {}),
  };

  return mutateColorCycleLayer(
    state,
    layer,
    project,
    ({
      paint: buffer,
      gradientId,
      gradientDefId,
      speed,
      flow,
      phase,
      width: bufferWidth,
      height: bufferHeight,
    }) => {
      const { startX, startY, endX, endY } = clampRect(rect, bufferWidth, bufferHeight);
      auditDetails.clampedRect = {
        x: startX,
        y: startY,
        width: Math.max(0, endX - startX),
        height: Math.max(0, endY - startY),
      };
      if (startX >= endX || startY >= endY) {
        return false;
      }

      const offsetX = Math.max(0, options?.offsetX ?? 0);
      const offsetY = Math.max(0, options?.offsetY ?? 0);
      const alphaData = options?.alphaData ?? null;
      const alphaWidth = Math.max(1, options?.alphaWidth ?? endX - startX);
      const alphaHeight = Math.max(1, options?.alphaHeight ?? endY - startY);
      const alphaStride = Math.max(1, options?.alphaStride ?? 4);
      const alphaChannelOffset = Math.max(0, options?.alphaChannelOffset ?? 3);
      const alphaThreshold = Math.max(0, options?.alphaThreshold ?? 0);
      let changed = false;
      for (let y = startY; y < endY; y += 1) {
        const rowOffset = y * bufferWidth;
        const srcY = y - startY + offsetY;
        if (alphaData && (srcY < 0 || srcY >= alphaHeight)) {
          continue;
        }
        for (let x = startX; x < endX; x += 1) {
          const srcX = x - startX + offsetX;
          if (alphaData && (srcX < 0 || srcX >= alphaWidth)) {
            continue;
          }
          if (alphaData) {
            const alphaIndex = (srcY * alphaWidth + srcX) * alphaStride + alphaChannelOffset;
            const alpha = alphaData[alphaIndex] ?? 0;
            if (alpha <= alphaThreshold) {
              continue;
            }
          }
          const index = rowOffset + x;
          if (
            buffer[index] !== 0 ||
            gradientId[index] !== 0 ||
            gradientDefId[index] !== 0 ||
            speed[index] !== 0 ||
            flow[index] !== 0 ||
            phase[index] !== 0
          ) {
            buffer[index] = 0;
            gradientId[index] = 0;
            gradientDefId[index] = 0;
            speed[index] = 0;
            flow[index] = 0;
            phase[index] = 0;
            changed = true;
          }
        }
      }
      return changed;
    }, {
      audit: {
        source: options?.auditSource,
        details: auditDetails,
      },
    },
  );
};

export const writeColorCycleRegion = (
  state: AppState,
  layer: Layer,
  project: Project,
  rect: Rectangle,
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  options?: {
    offsetX?: number;
    offsetY?: number;
    alphaData?: Uint8ClampedArray | Uint8Array | null;
    alphaStride?: number;
    alphaChannelOffset?: number;
    alphaThreshold?: number;
    gradientSlot?: number;
    sourceGradientIds?: Uint8Array | null;
    sourceGradientDefIds?: Uint16Array | null;
    sourceSpeed?: Uint8Array | null;
    sourceFlow?: Uint8Array | null;
    sourcePhase?: Uint8Array | null;
    skipMaterialize?: boolean;
  }
): boolean =>
  mutateColorCycleLayer(
    state,
    layer,
    project,
    ({ paint: buffer, gradientId, gradientDefId, speed, flow, phase, width: bufferWidth, height: bufferHeight }) => {
    const { startX, startY, endX, endY } = clampRect(rect, bufferWidth, bufferHeight);
    if (startX >= endX || startY >= endY) {
      return false;
    }

    const offsetX = Math.max(0, options?.offsetX ?? 0);
    const offsetY = Math.max(0, options?.offsetY ?? 0);
    const alphaData = options?.alphaData ?? null;
    const alphaStride = Math.max(1, options?.alphaStride ?? 4);
    const alphaChannelOffset = Math.max(0, options?.alphaChannelOffset ?? 3);
    const alphaThreshold = Math.max(0, options?.alphaThreshold ?? 0);
    const hasGradientSlot = typeof options?.gradientSlot === 'number' && Number.isFinite(options.gradientSlot);
    const gradientSlot = hasGradientSlot ? (Math.round(options.gradientSlot as number) & FLOW_SLOT_MASK) : 0;
    const sourceGradientIds = options?.sourceGradientIds ?? null;
    const sourceGradientDefIds = options?.sourceGradientDefIds ?? null;
    const sourceSpeed = options?.sourceSpeed ?? null;
    const sourceFlow = options?.sourceFlow ?? null;
    const sourcePhase = options?.sourcePhase ?? null;
    let changed = false;
    for (let y = startY; y < endY; y += 1) {
      const destRowOffset = y * bufferWidth;
      const srcY = y - startY + offsetY;
      if (srcY < 0 || srcY >= sourceHeight) {
        continue;
      }
      for (let x = startX; x < endX; x += 1) {
        const srcX = x - startX + offsetX;
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
        const destIndex = destRowOffset + x;
        const value = source[srcIndex];
        if (buffer[destIndex] !== value) {
          buffer[destIndex] = value;
          changed = true;
        }
        const nextGradientId = sourceGradientIds?.[srcIndex] ?? (hasGradientSlot ? gradientSlot : gradientId[destIndex]);
        if (gradientId[destIndex] !== nextGradientId) {
          gradientId[destIndex] = nextGradientId;
          changed = true;
        }
        const nextGradientDefId = sourceGradientDefIds?.[srcIndex] ?? gradientDefId[destIndex];
        if (gradientDefId[destIndex] !== nextGradientDefId) {
          gradientDefId[destIndex] = nextGradientDefId;
          changed = true;
        }
        const nextSpeed = sourceSpeed?.[srcIndex] ?? speed[destIndex];
        if (speed[destIndex] !== nextSpeed) {
          speed[destIndex] = nextSpeed;
          changed = true;
        }
        const nextFlow = sourceFlow?.[srcIndex] ?? flow[destIndex];
        if (flow[destIndex] !== nextFlow) {
          flow[destIndex] = nextFlow;
          changed = true;
        }
        const nextPhase = sourcePhase?.[srcIndex] ?? phase[destIndex];
        if (phase[destIndex] !== nextPhase) {
          phase[destIndex] = nextPhase;
          changed = true;
        }
      }
    }
    return changed;
    },
    {
      skipMaterialize: options?.skipMaterialize,
    }
  );

export const hasColorCycleIndices = (payload?: { colorCycleIndices?: Uint8Array | null }): payload is {
  colorCycleIndices: Uint8Array;
} => Boolean(payload?.colorCycleIndices && payload.colorCycleIndices.length);

type GradientStop = { position: number; color: string };

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const normalizeStops = (stops: GradientStop[]): GradientStop[] => {
  const normalized = stops
    .map((stop) => ({
      position: Math.max(0, Math.min(1, stop.position)),
      color: stop.color,
    }))
    .sort((a, b) => a.position - b.position);

  if (normalized.length === 0) {
    return DEFAULT_GRADIENT_STOPS.map((stop) => ({ ...stop }));
  }
  if (normalized.length === 1) {
    const only = normalized[0];
    return [
      { position: 0, color: only.color },
      { position: 1, color: only.color },
    ];
  }
  if (normalized[0].position > 0) {
    normalized.unshift({ position: 0, color: normalized[0].color });
  }
  if (normalized[normalized.length - 1].position < 1) {
    normalized.push({ position: 1, color: normalized[normalized.length - 1].color });
  }
  return normalized;
};

const resolvePasteGradientStops = (
  layer: Layer,
  fallbackStops?: GradientStop[] | null
): GradientStop[] => {
  const colorCycleData = layer.colorCycleData;
  const activeDef = (() => {
    if (!colorCycleData?.gradientDefs?.length) {
      return null;
    }
    if (colorCycleData.activeGradientId) {
      const explicit = colorCycleData.gradientDefs.find((entry) => entry.id === colorCycleData.activeGradientId);
      if (explicit) {
        return explicit;
      }
    }
    return colorCycleData.gradientDefs[0] ?? null;
  })();

  const preferredSlot =
    (typeof colorCycleData?.paintSlot === 'number' ? colorCycleData.paintSlot : undefined) ??
    (typeof activeDef?.currentSlot === 'number' ? activeDef.currentSlot : undefined) ??
    (typeof colorCycleData?.fgActiveSlot === 'number' ? colorCycleData.fgActiveSlot : undefined);

  const activeSlotPalette =
    typeof preferredSlot === 'number'
      ? colorCycleData?.slotPalettes?.find((entry) => entry.slot === preferredSlot)
      : null;
  if (activeSlotPalette?.stops?.length) {
    return normalizeStops(activeSlotPalette.stops);
  }
  if (colorCycleData?.gradient?.length) {
    return normalizeStops(colorCycleData.gradient);
  }
  if (fallbackStops?.length) {
    return normalizeStops(fallbackStops);
  }
  return normalizeStops(DEFAULT_GRADIENT_STOPS);
};

const buildGradientLut = (stops: GradientStop[]): Uint8Array => {
  const normalizedStops = normalizeStops(stops);
  const lut = new Uint8Array(255 * 3);

  for (let i = 0; i < 255; i += 1) {
    const t = i / 254;
    let left = normalizedStops[0];
    let right = normalizedStops[normalizedStops.length - 1];
    for (let j = 0; j < normalizedStops.length - 1; j += 1) {
      const start = normalizedStops[j];
      const end = normalizedStops[j + 1];
      if (t >= start.position && t <= end.position) {
        left = start;
        right = end;
        break;
      }
    }
    const leftColor = parseCssColor(left.color, { r: 255, g: 255, b: 255, a: 255 });
    const rightColor = parseCssColor(right.color, { r: 255, g: 255, b: 255, a: 255 });
    const range = Math.max(1e-6, right.position - left.position);
    const localT = Math.max(0, Math.min(1, (t - left.position) / range));
    lut[i * 3] = clampByte(leftColor.r + (rightColor.r - leftColor.r) * localT);
    lut[i * 3 + 1] = clampByte(leftColor.g + (rightColor.g - leftColor.g) * localT);
    lut[i * 3 + 2] = clampByte(leftColor.b + (rightColor.b - leftColor.b) * localT);
  }
  return lut;
};

export const deriveColorCycleIndicesFromImageData = ({
  imageData,
  layer,
  fallbackGradientStops,
  alphaThreshold = 0,
}: {
  imageData: ImageData | null | undefined;
  layer: Layer;
  fallbackGradientStops?: GradientStop[] | null;
  alphaThreshold?: number;
}): Uint8Array | null => {
  if (!imageData || !imageData.data || imageData.width <= 0 || imageData.height <= 0) {
    return null;
  }
  if (layer.layerType !== 'color-cycle') {
    return null;
  }

  const lut = buildGradientLut(resolvePasteGradientStops(layer, fallbackGradientStops));
  const output = new Uint8Array(imageData.width * imageData.height);
  const colorToIndex = new Map<number, number>();

  const pixelCount = imageData.width * imageData.height;
  for (let i = 0; i < pixelCount; i += 1) {
    const srcOffset = i * 4;
    const alpha = imageData.data[srcOffset + 3] ?? 0;
    if (alpha <= alphaThreshold) {
      output[i] = 0;
      continue;
    }

    const r = imageData.data[srcOffset] ?? 0;
    const g = imageData.data[srcOffset + 1] ?? 0;
    const b = imageData.data[srcOffset + 2] ?? 0;
    const colorKey = (r << 16) | (g << 8) | b;
    const cached = colorToIndex.get(colorKey);
    if (cached !== undefined) {
      output[i] = cached;
      continue;
    }

    let bestIndex = 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let lutIndex = 0; lutIndex < 255; lutIndex += 1) {
      const lutOffset = lutIndex * 3;
      const dr = r - lut[lutOffset];
      const dg = g - lut[lutOffset + 1];
      const db = b - lut[lutOffset + 2];
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = lutIndex + 1;
        if (distance === 0) {
          break;
        }
      }
    }

    colorToIndex.set(colorKey, bestIndex);
    output[i] = bestIndex;
  }

  return output;
};

export const debugCaptureColorCycleScalarRegion = (
  layer: Layer,
  project: Project,
  rect: Rectangle
): Uint8Array | null => {
  const brush = resolveLayerBrush(null, layer.id);
  if (!brush?.getLayerSnapshot) {
    return null;
  }

  const snapshot = brush.getLayerSnapshot(layer.id);
  if (!snapshot?.paintBuffer) {
    return null;
  }

  const canvas =
    layer.colorCycleData?.canvas ??
    (typeof brush.getCanvas === 'function' ? brush.getCanvas() : null);
  const canvasWidth = canvas?.width ?? layer.imageData?.width ?? project.width;
  const canvasHeight = canvas?.height ?? layer.imageData?.height ?? project.height;
  if (!canvasWidth || !canvasHeight) {
    return null;
  }

  const incoming = new Uint8Array(snapshot.paintBuffer);
  if (incoming.length !== canvasWidth * canvasHeight) {
    return null;
  }

  const normRect = {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.max(0, Math.floor(rect.width)),
    height: Math.max(0, Math.floor(rect.height)),
  };

  if (!normRect.width || !normRect.height) {
    return new Uint8Array(0);
  }

  return copyScalarRegion(incoming, canvasWidth, canvasHeight, normRect);
};
