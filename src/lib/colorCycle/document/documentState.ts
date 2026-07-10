import type {
  ColorCycleGradientDef,
  ColorCycleGradientDefStoreEntry,
  ColorCycleSlotPalette,
  Layer,
} from '@/types';
import { DEFAULT_BRUSH_COLOR_CYCLE_SPEED } from '@/constants/colorCycle';
import { encodeColorCycleSpeedByte, sanitizeBrushColorCycleSpeed } from '@/utils/colorCycleSpeed';
import { resolveLayerColorCycleFallbackSpeedCps } from '@/utils/colorCycleLayerSpeed';
import type {
  ColorCycleLayerDocumentState,
} from './colorCycleDocumentContract';
import { readLegacyColorCycleTopLevelBuffers } from './legacyTopLevelBuffers';

export type { ColorCycleLayerDocumentState };

export type ColorCycleDocumentStateResult =
  | { ok: true; state: ColorCycleLayerDocumentState }
  | { ok: false; reason: string };

export type NormalizeColorCycleDocumentStateOptions = {
  fallbackWidth?: number;
  fallbackHeight?: number;
  decodeSerializedBrushStateBuffers?: boolean;
  completeMotionBuffers?: boolean;
  fallbackWriteSpeedCps?: number;
};

type PersistedLayerSnapshot = {
  layerId?: string;
  strokeData?: {
    hasContent?: boolean;
    paintBuffer?: unknown;
    gradientIdBuffer?: unknown;
    gradientDefIdBuffer?: unknown;
    speedBuffer?: unknown;
    flowBuffer?: unknown;
    phaseBuffer?: unknown;
  };
  gradientDefs?: ColorCycleGradientDef[];
  slotPalettes?: ColorCycleSlotPalette[];
  gradientDefStore?: ColorCycleGradientDefStoreEntry[];
  nextGradientDefId?: number;
  fgActiveSlot?: number;
};

type PersistedBrushState = {
  cycleSpeed?: number;
  layers?: PersistedLayerSnapshot[];
};

const decodeBase64ArrayBuffer = (value: string): ArrayBuffer | undefined => {
  if (!value || value.startsWith('zip:')) {
    return undefined;
  }
  try {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  } catch {
    return undefined;
  }
};

const asArrayBuffer = (
  value: unknown,
  options: NormalizeColorCycleDocumentStateOptions,
): ArrayBuffer | undefined => {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (options.decodeSerializedBrushStateBuffers && typeof value === 'string') {
    return decodeBase64ArrayBuffer(value);
  }
  return undefined;
};

const cloneArrayBuffer = (
  value: unknown,
  options: NormalizeColorCycleDocumentStateOptions = {},
): ArrayBuffer | undefined => {
  const buffer = asArrayBuffer(value, options);
  return buffer ? buffer.slice(0) : undefined;
};

const cloneStops = <T extends { position: number; color: string; opacity?: number }>(
  stops: T[],
): T[] => stops.map((stop) => ({ ...stop }));

const cloneGradientDefs = (
  gradientDefs: ColorCycleGradientDef[] | undefined,
): ColorCycleGradientDef[] | undefined => (
  gradientDefs?.map((entry) => ({
    id: entry.id,
    name: entry.name,
    currentSlot: entry.currentSlot,
  }))
);

const cloneSlotPalettes = (
  slotPalettes: ColorCycleSlotPalette[] | undefined,
): ColorCycleSlotPalette[] | undefined => (
  slotPalettes?.map((entry) => ({
    slot: entry.slot,
    stops: cloneStops(entry.stops),
  }))
);

const cloneGradientDefStore = (
  gradientDefStore: ColorCycleGradientDefStoreEntry[] | undefined,
): ColorCycleGradientDefStoreEntry[] | undefined => (
  gradientDefStore?.map((entry) => ({
    ...entry,
    stops: cloneStops(entry.stops),
  }))
);

const resolveLayerDimensions = (
  layer: Layer,
  options: NormalizeColorCycleDocumentStateOptions,
): { width: number; height: number } | null => {
  const colorCycleData = layer.colorCycleData;
  const width =
    colorCycleData?.canvasWidth ??
    colorCycleData?.canvasImageData?.width ??
    layer.imageData?.width ??
    options.fallbackWidth;
  const height =
    colorCycleData?.canvasHeight ??
    colorCycleData?.canvasImageData?.height ??
    layer.imageData?.height ??
    options.fallbackHeight;

  if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height) {
    return null;
  }
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
};

const getBrushSnapshotForLayer = (
  brushState: unknown,
  layerId: string,
): PersistedLayerSnapshot | undefined => {
  const layers = (brushState as PersistedBrushState | undefined)?.layers;
  if (!Array.isArray(layers)) {
    return undefined;
  }
  return layers.find((snapshot) => snapshot?.layerId === layerId);
};

const getLegacyStateRefs = (layer: Layer): {
  paintBuffer?: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  flowBuffer?: ArrayBuffer;
  phaseBuffer?: ArrayBuffer;
} => {
  const legacyState = (layer as unknown as {
    state?: {
      paintRef?: unknown;
      gradientIdRef?: unknown;
      gradientDefIdRef?: unknown;
      speedRef?: unknown;
      flowRef?: unknown;
      phaseRef?: unknown;
    };
  }).state;

  return {
    paintBuffer: cloneArrayBuffer(legacyState?.paintRef),
    gradientIdBuffer: cloneArrayBuffer(legacyState?.gradientIdRef),
    gradientDefIdBuffer: cloneArrayBuffer(legacyState?.gradientDefIdRef),
    speedBuffer: cloneArrayBuffer(legacyState?.speedRef),
    flowBuffer: cloneArrayBuffer(legacyState?.flowRef),
    phaseBuffer: cloneArrayBuffer(legacyState?.phaseRef),
  };
};

export const validateColorCycleDocumentStateDimensions = (
  state: Pick<ColorCycleLayerDocumentState,
    | 'width'
    | 'height'
    | 'paintBuffer'
    | 'gradientIdBuffer'
    | 'gradientDefIdBuffer'
    | 'speedBuffer'
    | 'flowBuffer'
    | 'phaseBuffer'
  >,
): { ok: true } | { ok: false; reason: string } => {
  const expectedPixels = state.width * state.height;
  const checks: Array<[string, ArrayBuffer | undefined, number]> = [
    ['paintBuffer', state.paintBuffer, expectedPixels],
    ['gradientIdBuffer', state.gradientIdBuffer, expectedPixels],
    ['speedBuffer', state.speedBuffer, expectedPixels],
    ['flowBuffer', state.flowBuffer, expectedPixels],
    ['phaseBuffer', state.phaseBuffer, expectedPixels],
    ['gradientDefIdBuffer', state.gradientDefIdBuffer, expectedPixels * 2],
  ];

  for (const [name, buffer, expectedBytes] of checks) {
    if (buffer && buffer.byteLength !== expectedBytes) {
      return {
        ok: false,
        reason: `${name} byteLength ${buffer.byteLength} does not match ${expectedBytes} for ${state.width}x${state.height}`,
      };
    }
  }

  return { ok: true };
};

export const hasCanonicalColorCyclePaint = (
  state: Pick<ColorCycleLayerDocumentState, 'paintBuffer' | 'hasContent'>,
): boolean => Boolean(state.paintBuffer);

export const hasGradientBindingBuffers = (
  state: Pick<ColorCycleLayerDocumentState, 'gradientIdBuffer' | 'gradientDefIdBuffer'>,
): boolean => Boolean(state.gradientIdBuffer || state.gradientDefIdBuffer);

const hasVisiblePaintBuffer = (paintBuffer: ArrayBuffer | undefined): boolean => {
  if (!paintBuffer) {
    return false;
  }
  return new Uint8Array(paintBuffer).some((value) => value !== 0);
};

const makeDefaultByteBuffer = (length: number): ArrayBuffer => (
  new Uint8Array(length).buffer
);

const getFlowByteForMode = (
  flowMode: ColorCycleLayerDocumentState['flowMode'] = 'forward',
): number => {
  if (flowMode === 'reverse') {
    return 2;
  }
  if (flowMode === 'pingpong') {
    return 3;
  }
  return 1;
};

const makePaintedByteBuffer = (
  paintBuffer: ArrayBuffer,
  value: number,
): ArrayBuffer => {
  const paint = new Uint8Array(paintBuffer);
  const buffer = new Uint8Array(paint.length);
  for (let index = 0; index < paint.length; index += 1) {
    buffer[index] = paint[index] === 0 ? 0 : value;
  }
  return buffer.buffer;
};

const resolveDefaultMotionSpeedByte = (speed?: number): number => {
  if (speed === 0) {
    return encodeColorCycleSpeedByte(0);
  }
  if (Number.isFinite(speed)) {
    return encodeColorCycleSpeedByte(sanitizeBrushColorCycleSpeed(speed));
  }
  return encodeColorCycleSpeedByte(DEFAULT_BRUSH_COLOR_CYCLE_SPEED);
};

export const completeDefaultColorCycleMotionBuffers = <
  T extends Pick<
    ColorCycleLayerDocumentState,
    | 'width'
    | 'height'
    | 'paintBuffer'
    | 'speedBuffer'
    | 'flowBuffer'
    | 'phaseBuffer'
    | 'layerBaseSpeedCps'
    | 'flowMode'
  >
>(
  state: T,
  options: { fallbackSpeedCps?: number } = {},
): T => {
  const pixels = state.width * state.height;
  const paintBuffer = state.paintBuffer;
  if (!paintBuffer || !hasVisiblePaintBuffer(paintBuffer) || pixels <= 0) {
    return state;
  }
  const fallbackSpeed = options.fallbackSpeedCps
    ?? resolveLayerColorCycleFallbackSpeedCps({ layerBaseSpeedCps: state.layerBaseSpeedCps });
  const speedByte = resolveDefaultMotionSpeedByte(fallbackSpeed);
  const flowByte = getFlowByteForMode(state.flowMode);

  return {
    ...state,
    speedBuffer: state.speedBuffer ?? makePaintedByteBuffer(paintBuffer, speedByte),
    flowBuffer: state.flowBuffer ?? makePaintedByteBuffer(paintBuffer, flowByte),
    phaseBuffer: state.phaseBuffer ?? makeDefaultByteBuffer(pixels),
  };
};

export const normalizeColorCycleLayerDocumentState = (
  layer: Layer,
  options: NormalizeColorCycleDocumentStateOptions = {},
): ColorCycleDocumentStateResult => {
  if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return { ok: false, reason: 'not-color-cycle' };
  }

  const dimensions = resolveLayerDimensions(layer, options);
  if (!dimensions) {
    return { ok: false, reason: 'missing-dimensions' };
  }

  const { colorCycleData } = layer;
  const persistedBrushState = colorCycleData.brushState as PersistedBrushState | undefined;
  const snapshot = getBrushSnapshotForLayer(persistedBrushState, layer.id);
  const strokeData = snapshot?.strokeData;
  const legacyRefs = getLegacyStateRefs(layer);
  const legacyTopLevelBuffers = readLegacyColorCycleTopLevelBuffers(colorCycleData);

  const paintBuffer =
    cloneArrayBuffer(strokeData?.paintBuffer, options) ??
    legacyRefs.paintBuffer;
  const gradientIdBuffer =
    cloneArrayBuffer(legacyTopLevelBuffers.gradientIdBuffer) ??
    cloneArrayBuffer(strokeData?.gradientIdBuffer, options) ??
    legacyRefs.gradientIdBuffer;
  const gradientDefIdBuffer =
    cloneArrayBuffer(legacyTopLevelBuffers.gradientDefIdBuffer) ??
    cloneArrayBuffer(strokeData?.gradientDefIdBuffer, options) ??
    legacyRefs.gradientDefIdBuffer;
  const speedBuffer =
    cloneArrayBuffer(strokeData?.speedBuffer, options) ??
    legacyRefs.speedBuffer;
  const flowBuffer =
    cloneArrayBuffer(strokeData?.flowBuffer, options) ??
    legacyRefs.flowBuffer;
  const phaseBuffer =
    cloneArrayBuffer(strokeData?.phaseBuffer, options) ??
    cloneArrayBuffer(legacyTopLevelBuffers.phaseBuffer) ??
    legacyRefs.phaseBuffer;

  const state: ColorCycleLayerDocumentState = {
    layerId: layer.id,
    width: dimensions.width,
    height: dimensions.height,
    paintBuffer,
    gradientIdBuffer,
    gradientDefIdBuffer,
    speedBuffer,
    flowBuffer,
    phaseBuffer,
    slotPalettes: cloneSlotPalettes(snapshot?.slotPalettes ?? colorCycleData.slotPalettes),
    gradientDefs: cloneGradientDefs(snapshot?.gradientDefs ?? colorCycleData.gradientDefs),
    gradientDefStore: cloneGradientDefStore(snapshot?.gradientDefStore ?? colorCycleData.gradientDefStore),
    activeGradientId: colorCycleData.activeGradientId,
    paintSlot: colorCycleData.paintSlot,
    fgActiveSlot: snapshot?.fgActiveSlot ?? colorCycleData.fgActiveSlot,
    layerBaseSpeedCps: colorCycleData.layerBaseSpeedCps ?? colorCycleData.controllerSpeedCps,
    flowMode: colorCycleData.flowMode,
    hasContent: Boolean(strokeData?.hasContent ?? colorCycleData.hasContent ?? false),
    sources: {
      brushStateSnapshot: Boolean(snapshot),
      topLevelBuffers: Boolean(
        legacyTopLevelBuffers.gradientIdBuffer ||
        legacyTopLevelBuffers.gradientDefIdBuffer ||
        legacyTopLevelBuffers.phaseBuffer,
      ),
      legacyStateRefs: Boolean(
        legacyRefs.paintBuffer ||
        legacyRefs.gradientIdBuffer ||
        legacyRefs.gradientDefIdBuffer ||
        legacyRefs.speedBuffer ||
        legacyRefs.flowBuffer ||
        legacyRefs.phaseBuffer,
      ),
    },
  };

  const completedState = options.completeMotionBuffers === false
    ? state
    : completeDefaultColorCycleMotionBuffers(state, {
        fallbackSpeedCps: resolveLayerColorCycleFallbackSpeedCps(
          colorCycleData,
          typeof persistedBrushState?.cycleSpeed === 'number' &&
            Number.isFinite(persistedBrushState.cycleSpeed)
            ? persistedBrushState.cycleSpeed
            : options.fallbackWriteSpeedCps,
        ),
      });
  const dimensionValidation = validateColorCycleDocumentStateDimensions(completedState);
  if (!dimensionValidation.ok) {
    return dimensionValidation;
  }

  return { ok: true, state: completedState };
};
