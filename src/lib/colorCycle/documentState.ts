import type {
  ColorCycleGradientDef,
  ColorCycleGradientDefStoreEntry,
  ColorCycleSlotPalette,
  Layer,
} from '@/types';

export type ColorCycleLayerDocumentState = {
  layerId: string;
  width: number;
  height: number;
  paintBuffer?: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  flowBuffer?: ArrayBuffer;
  phaseBuffer?: ArrayBuffer;
  slotPalettes?: ColorCycleSlotPalette[];
  gradientDefs?: ColorCycleGradientDef[];
  gradientDefStore?: ColorCycleGradientDefStoreEntry[];
  activeGradientId?: string;
  paintSlot?: number;
  fgActiveSlot?: number;
  layerBaseSpeedCps?: number;
  flowMode?: 'forward' | 'reverse' | 'pingpong';
  hasContent: boolean;
  sources: {
    brushStateSnapshot: boolean;
    topLevelBuffers: boolean;
    legacyStateRefs: boolean;
  };
};

export type ColorCycleDocumentStateResult =
  | { ok: true; state: ColorCycleLayerDocumentState }
  | { ok: false; reason: string };

export type NormalizeColorCycleDocumentStateOptions = {
  fallbackWidth?: number;
  fallbackHeight?: number;
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
  layers?: PersistedLayerSnapshot[];
};

const asArrayBuffer = (value: unknown): ArrayBuffer | undefined => (
  value instanceof ArrayBuffer ? value : undefined
);

const cloneArrayBuffer = (value: unknown): ArrayBuffer | undefined => {
  const buffer = asArrayBuffer(value);
  return buffer ? buffer.slice(0) : undefined;
};

const hasAnyByte = (buffer: ArrayBuffer | undefined): boolean => {
  if (!buffer) {
    return false;
  }
  const bytes = new Uint8Array(buffer);
  return bytes.some((value) => value !== 0);
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
): boolean => Boolean(state.paintBuffer && (state.hasContent || hasAnyByte(state.paintBuffer)));

export const hasGradientBindingBuffers = (
  state: Pick<ColorCycleLayerDocumentState, 'gradientIdBuffer' | 'gradientDefIdBuffer'>,
): boolean => Boolean(state.gradientIdBuffer || state.gradientDefIdBuffer);

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
  const snapshot = getBrushSnapshotForLayer(colorCycleData.brushState, layer.id);
  const strokeData = snapshot?.strokeData;
  const legacyRefs = getLegacyStateRefs(layer);

  const paintBuffer =
    cloneArrayBuffer(strokeData?.paintBuffer) ??
    legacyRefs.paintBuffer;
  const gradientIdBuffer =
    cloneArrayBuffer(colorCycleData.gradientIdBuffer) ??
    cloneArrayBuffer(strokeData?.gradientIdBuffer) ??
    legacyRefs.gradientIdBuffer;
  const gradientDefIdBuffer =
    cloneArrayBuffer(colorCycleData.gradientDefIdBuffer) ??
    cloneArrayBuffer(strokeData?.gradientDefIdBuffer) ??
    legacyRefs.gradientDefIdBuffer;
  const speedBuffer =
    cloneArrayBuffer(strokeData?.speedBuffer) ??
    legacyRefs.speedBuffer;
  const flowBuffer =
    cloneArrayBuffer(strokeData?.flowBuffer) ??
    legacyRefs.flowBuffer;
  const phaseBuffer =
    cloneArrayBuffer(colorCycleData.phaseBuffer) ??
    cloneArrayBuffer(strokeData?.phaseBuffer) ??
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
    hasContent: Boolean(strokeData?.hasContent ?? colorCycleData.hasContent ?? hasAnyByte(paintBuffer)),
    sources: {
      brushStateSnapshot: Boolean(snapshot),
      topLevelBuffers: Boolean(colorCycleData.gradientIdBuffer || colorCycleData.gradientDefIdBuffer || colorCycleData.phaseBuffer),
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

  const dimensionValidation = validateColorCycleDocumentStateDimensions(state);
  if (!dimensionValidation.ok) {
    return dimensionValidation;
  }

  return { ok: true, state };
};
