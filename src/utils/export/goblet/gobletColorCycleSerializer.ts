import { resolveGobletColorCycleExportSource, type GobletColorCycleDocumentRead, type GobletColorCyclePayloadBuildSource } from '@/utils/export/goblet/colorCycleExportSourceResolver';
import { debugLog, debugWarn } from '@/utils/debug';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { getColorCyclePlaybackClock, type ColorCyclePlaybackClock } from '@/lib/colorCycle/playbackClock';
import { normalizeGradientSeamProfile, type GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import { MAX_BRUSH_COLOR_CYCLE_SPEED, MAX_CC_LAYER_SPEED_SCALE, MIN_BRUSH_COLOR_CYCLE_SPEED, MIN_CC_LAYER_SPEED_SCALE } from '@/constants/colorCycle';
import { decodeColorCycleSpeedByte, encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';
import {
  composeColorCyclePlaybackSpeedScale,
  resolveLayerColorCycleFallbackPlaybackSpeedCps,
} from '@/utils/colorCycleLayerSpeed';
import { packArrayToB64Z, unpackB64ZToUint8Array } from '@/utils/export/b64z';
import { deriveForegroundGradientStops } from '@/utils/colorCycleGradients';
import { captureCanvasImageData } from '@/utils/canvas/canvasImage';
import { parseCssColor } from '@/utils/color/parseCssColor';
import {
  getColorCycleLegacyLayerBuffer,
  mapDocumentSnapshotToGobletBrushState,
  type ColorCycleLayerDocumentSnapshot,
} from '@/lib/colorCycle/document';
import type {
  ColorCyclePersistenceDocumentState,
  PersistedColorCycleBrushState,
} from '@/lib/colorCycle/persistence';
import {
  AUTHORED_SPEED_SOURCE_VERSION,
  LEGACY_EFFECTIVE_SPEED_SOURCE_VERSION,
  type ColorCycleSpeedSourceVersion,
} from '@/lib/colorCycle/persistence/colorCyclePersistenceTypes';
import {
  resolvePersistedColorCycleExportEligibility,
} from '@/utils/export/goblet/colorCycleExportSourceEligibility';
import { posInt, toNum } from '@/utils/num';
import type { Layer, Project } from '@/types';
import { clampRectToDocument as clampBoundsToDocument, scaleMaskBoundsToDocument, type Size2D as CoverageSize } from '@/utils/export/colorCycleBounds';
import { getLayerSurfaceSize } from '@/utils/export/goblet/gobletLayerSerializer';
import type { BrushStateRuntimePayload, ColorCycleCoverageResult, ColorCycleMaskDataset, ColorCycleSerializationResult, SerializedAlphaMaskResult, SerializedGradientDefinition, SerializedGradientStops, SerializedSlotPalette, WebGLExportMetadata, WebGLLayerBounds, WebGLSerializedBrushState, WebGLSerializedColorCycle } from '@/utils/export/goblet/gobletTypes';

// Boundary: serialization only. Source availability is decided before this module;
// this module converts the resolved layer/source into Goblet payload data.
const gobletDiagnosticsDefault = process.env.NEXT_PUBLIC_VESSEL_GOBLET_DEBUG === 'true';

let gobletDiagnosticsActive = gobletDiagnosticsDefault;

export const setGobletColorCycleDiagnosticsActive = (active: boolean): void => {
  gobletDiagnosticsActive = active;
};

const gobletDebugLog = (...args: Array<unknown>) => {
  if (gobletDiagnosticsActive) {
    debugLog('raw-console', ...args);
  }
};

export const resolveDimensionFromCandidates = (candidates: Array<unknown>, fallback: number): number => {
  for (const candidate of candidates) {
    const numeric = toNum(candidate, NaN);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.max(1, numeric);
    }
  }
  return Math.max(1, fallback);
};

export const resolveRecolorSurfaceSize = (layer: Layer, project: Project): CoverageSize => {
  const colorCycle = layer.colorCycleData;
  const recolorImage = colorCycle?.recolorSettings?.originalImageData ?? layer.imageData ?? null;

  const width = resolveDimensionFromCandidates(
    [
      recolorImage?.width,
      colorCycle?.canvasWidth,
      colorCycle?.canvas?.width,
      project.width
    ],
    project.width
  );

  const height = resolveDimensionFromCandidates(
    [
      recolorImage?.height,
      colorCycle?.canvasHeight,
      colorCycle?.canvas?.height,
      project.height
    ],
    project.height
  );

  return {
    width,
    height
  };
};

export const clampBoundsToSurface = (bounds: WebGLLayerBounds, surface: CoverageSize): WebGLLayerBounds => {
  return clampBoundsToDocument(bounds, surface);
};

export const sanitizePositiveDimension = (value: unknown, fallback: number): number => {
  const fallbackPositive = Math.max(1, Math.round(toNum(fallback, 1)));
  const numeric = toNum(value, fallbackPositive);
  const safe = numeric > 0 ? numeric : fallbackPositive;
  return posInt(safe, fallbackPositive);
};

const isSerializedGradient = (value: unknown): value is SerializedGradientStops => {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  return value.every((stop) => {
    if (!stop || typeof stop !== 'object') {
      return false;
    }
    const entry = stop as { position?: unknown; color?: unknown };
    const hasColor = typeof entry.color === 'string';
    const position = entry.position;
    const hasPosition = typeof position === 'number' && Number.isFinite(position);
    return hasColor && hasPosition;
  });
};

const buildGradientKey = (gradient: SerializedGradientStops): string => {
  return gradient
    .map((stop) => {
      const position = Number.isFinite(stop.position) ? Number(stop.position.toFixed(6)) : 0;
      return `${position}:${stop.color}`;
    })
    .join('|');
};

export const deduplicateGradients = (metadata: WebGLExportMetadata): void => {
  if (!metadata || !Array.isArray(metadata.layers) || metadata.layers.length === 0) {
    return;
  }

  const gradientMap = new Map<string, number>();
  const gradients: SerializedGradientStops[] = [];

  metadata.layers.forEach((layer) => {
    if (!layer?.colorCycle) {
      return;
    }
    const gradient = layer.colorCycle.gradient;
    if (!isSerializedGradient(gradient)) {
      return;
    }

    const key = buildGradientKey(gradient);
    let index = gradientMap.get(key);
    if (typeof index === 'undefined') {
      index = gradients.length;
      gradientMap.set(key, index);
      gradients.push(gradient);
    }

    layer.colorCycle.gradientRef = index;
    delete layer.colorCycle.gradient;
  });

  if (gradients.length > 0) {
    metadata.gradients = gradients;
  } else if ('gradients' in metadata) {
    delete metadata.gradients;
  }
};


const toSerializableGradientStops = (
  stops: Array<{ position?: number; color?: string; opacity?: number }> | undefined,
  fallback: Array<{ position: number; color: string }> = []
): Array<{ position: number; color: string }> => {
  if (!Array.isArray(stops) || stops.length === 0) {
    return [...fallback];
  }

  const normalized = stops
    .map((stop) => {
      const positionRaw = typeof stop?.position === 'number'
        ? stop.position
        : Number.parseFloat(String(stop?.position ?? '0'));
      const position = Number.isFinite(positionRaw) ? positionRaw : 0;
      const color = typeof stop?.color === 'string' && stop.color
        ? stop.color
        : '#ffffff';
      const opacity = Number.isFinite(stop?.opacity)
        ? Math.max(0, Math.min(1, Number(stop.opacity)))
        : 1;
      if (opacity === 1) {
        return { position, color };
      }
      const parsed = parseCssColor(color);
      const alpha = Number(((parsed.a / 255) * opacity).toFixed(6));
      return {
        position,
        color: `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`,
      };
    })
    .filter((entry) => Number.isFinite(entry.position));

  if (normalized.length === 0) {
    return [...fallback];
  }

  return normalized;
};

const toSerializableArrayLike = (source: unknown): unknown[] => {
  if (source == null) {
    return [];
  }
  if (Array.isArray(source)) {
    return source.slice();
  }
  if (source instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(source));
  }
  if (ArrayBuffer.isView(source)) {
    return Array.from(source as unknown as ArrayLike<unknown>);
  }
  if (typeof source === 'object') {
    const maybeRecord = source as Record<string, unknown>;
    if ('data' in maybeRecord && maybeRecord.data !== source) {
      const nested = toSerializableArrayLike(maybeRecord.data);
      if (nested.length > 0) {
        return nested;
      }
    }
  }
  const iterator = (source as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  if (typeof iterator === 'function') {
    try {
      return Array.from(source as Iterable<unknown>);
    } catch {
      return [];
    }
  }
  return [];
};

const toSerializableNumberArray = (source: unknown): number[] => {
  const values = toSerializableArrayLike(source);
  if (values.length === 0) {
    return [];
  }

  const numbers: number[] = [];
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      numbers.push(value);
      continue;
    }

    const coerced = Number(value);
    if (Number.isFinite(coerced)) {
      numbers.push(coerced);
    }
  }

  return numbers;
};

const decodeBase64Bytes = (base64: string): Uint8Array => {
  if (!base64) {
    return new Uint8Array(0);
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  return new Uint8Array(0);
};


const decodePersistedDefIdBuffer = (source: unknown): number[] => {
  if (!source) {
    return [];
  }
  if (typeof source === 'string' && source.startsWith('zip:')) {
    return [];
  }
  if (typeof source === 'string') {
    const bytes = decodeBase64Bytes(source);
    if (bytes.byteLength % 2 !== 0) {
      return [];
    }
    return Array.from(new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2));
  }
  if (source instanceof ArrayBuffer) {
    if (source.byteLength % 2 !== 0) {
      return [];
    }
    return Array.from(new Uint16Array(source));
  }
  if (ArrayBuffer.isView(source)) {
    const view = source as ArrayBufferView;
    if (view.byteLength % 2 !== 0) {
      return [];
    }
    return Array.from(new Uint16Array(view.buffer, view.byteOffset, view.byteLength / 2));
  }
  return toSerializableNumberArray(source);
};

type ExportRuntimeBrushMetadata = {
  exportCycleSpeed?: unknown;
  exportFps?: unknown;
  exportGradientStops?: Array<{ position?: number; color?: string }>;
  exportAnimationOffset?: unknown;
  exportTargetFPS?: unknown;
  exportPalette?: unknown;
  cycleSpeed?: unknown;
  fps?: unknown;
  animator?: {
    indexBuffer?: {
      palette?: unknown;
    };
    gradient?: { gradientStops?: Array<{ position?: number; color?: string }> };
    animation?: {
      offset?: unknown;
      stats?: { targetFPS?: unknown };
    };
  };
};

const documentSnapshotToBrushState = (
  layer: Layer,
  state: ColorCycleLayerDocumentSnapshot,
  brushState?: PersistedColorCycleBrushState,
): WebGLSerializedBrushState | undefined => {
  const metadata = brushState as (PersistedColorCycleBrushState & ExportRuntimeBrushMetadata) | undefined;
  const layerMetadata = brushState?.layers?.find((entry) => entry.layerId === layer.id) as
    | (NonNullable<PersistedColorCycleBrushState['layers']>[number] & ExportRuntimeBrushMetadata)
    | undefined;
  const gradientStops = toSerializableGradientStops(
    state.slotPalettes?.[0]?.stops ?? layerMetadata?.exportGradientStops ?? layerMetadata?.animator?.gradient?.gradientStops,
    layer.colorCycleData?.gradient ?? [],
  );
  const animationOffsetSource = layerMetadata?.exportAnimationOffset ?? layerMetadata?.animator?.animation?.offset;
  const animationOffset = typeof animationOffsetSource === 'number'
    ? animationOffsetSource
    : 0;
  const targetFPSSource = layerMetadata?.exportTargetFPS
    ?? layerMetadata?.animator?.animation?.stats?.targetFPS
    ?? metadata?.exportFps
    ?? metadata?.fps;
  const targetFPS = typeof targetFPSSource === 'number'
    ? targetFPSSource
    : undefined;
  const animationSpeedSource = metadata?.exportCycleSpeed ?? metadata?.cycleSpeed;
  const animationSpeed = resolveLayerColorCycleFallbackPlaybackSpeedCps(
    layer.colorCycleData,
    typeof animationSpeedSource === 'number' ? animationSpeedSource : undefined,
  );
  const stampDitherEnabled = typeof metadata?.stampDitherEnabled === 'boolean'
    ? metadata.stampDitherEnabled
    : undefined;
  const paletteSource = layerMetadata?.exportPalette ?? layerMetadata?.animator?.indexBuffer?.palette;
  const palette = paletteSource
    ? toSerializablePaletteArray(paletteSource)
    : undefined;

  return mapDocumentSnapshotToGobletBrushState(state, {
    gradientStops,
    palette: palette && palette.length > 0 ? palette : undefined,
    animationOffset,
    animationSpeed,
    targetFPS,
    alphaMode: 'opaque-indices',
    stampDitherEnabled,
  });
};

const isByteRangeArray = (values: number[]): boolean => {
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value) || value < 0 || value > 255) {
      return false;
    }
  }
  return true;
};

type NumericArrayLike = number[] | Uint8Array | Uint16Array;
type NumericArrayInput = NumericArrayLike | string | undefined;

const isNumericArrayLike = (value: unknown): value is NumericArrayLike => (
  Array.isArray(value) ||
  value instanceof Uint8Array ||
  value instanceof Uint16Array
);

const numericArrayLikeToArray = (value: NumericArrayLike): number[] => (
  Array.isArray(value) ? value : Array.from(value)
);

const numericArrayInputToUint8Array = (value: NumericArrayInput | null): Uint8Array | undefined => {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string') {
    try {
      return unpackB64ZToUint8Array(value);
    } catch {
      return undefined;
    }
  }

  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }

  return Uint8Array.from(numericArrayLikeToArray(value), (entry) => (
    Math.max(0, Math.min(255, Math.round(toNum(entry, 0))))
  ));
};

const packNumericArrayForExport = async (input: NumericArrayInput | null): Promise<number[] | string | undefined> => {
  if (!input) {
    return undefined;
  }

  if (typeof input === 'string') {
    return input;
  }

  const normalizedInput = numericArrayLikeToArray(input);
  if (normalizedInput.length === 0) {
    return [];
  }

  if (!isByteRangeArray(normalizedInput)) {
    return normalizedInput;
  }

  const packed = await packArrayToB64Z(normalizedInput);
  if (packed) {
    return packed;
  }
  return normalizedInput;
};

export const summarizeEncodedBuffer = (
  payload: NumericArrayInput,
  fallbackLength: number
): {
  encoding: 'array' | 'b64z' | 'none';
  length: number | null;
  preview: number[] | string;
} => {
  if (!payload) {
    return { encoding: 'none', length: null, preview: 'none' };
  }

  if (isNumericArrayLike(payload)) {
    const values = numericArrayLikeToArray(payload);
    return {
      encoding: 'array',
      length: payload.length,
      preview: values.slice(0, 16)
    };
  }

  return {
    encoding: 'b64z',
    length: fallbackLength,
    preview: payload.slice(0, 64)
  };
};

const toSerializablePaletteArray = (source: unknown): Array<string | number> => {
  const values = toSerializableArrayLike(source);
  if (values.length === 0) {
    return [];
  }

  const palette: Array<string | number> = [];
  for (const value of values) {
    if (typeof value === 'string') {
      palette.push(value);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      palette.push(value);
    } else if (value != null) {
      const coerced = Number(value);
      if (Number.isFinite(coerced)) {
        palette.push(coerced);
      }
    }
  }

  return palette;
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const clampExportLayerSpeedScale = (value: unknown): number => {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(
    MIN_CC_LAYER_SPEED_SCALE,
    Math.min(MAX_CC_LAYER_SPEED_SCALE, value as number)
  );
};

export const resolveExportLayerSpeedScale = (value?: unknown): number => {
  return clampExportLayerSpeedScale(value);
};

export const applyExportPlaybackScale = (speed: number | null, layerSpeedScale: number): number | null => {
  if (!Number.isFinite(speed)) {
    return null;
  }
  return (speed as number) * layerSpeedScale;
};

export const scaleEncodedSpeedBuffer = (
  speedBuffer: number[] | Uint8Array,
  layerSpeedScale: number
): number[] => {
  const out = new Array<number>(speedBuffer.length);
  for (let i = 0; i < speedBuffer.length; i += 1) {
    const encoded = Number(speedBuffer[i] ?? 0);
    if (!Number.isFinite(encoded) || encoded <= 0) {
      out[i] = 0;
      continue;
    }
    const decoded = decodeColorCycleSpeedByte(encoded);
    out[i] = encodeColorCycleSpeedByte(decoded * layerSpeedScale);
  }
  return out;
};

const resolveExportBrushSpeed = (layer: Layer, layerSpeedScale: number): number | null => {
  const data = layer.colorCycleData;
  if (!data) {
    return null;
  }

  const brushSpeed = toFiniteNumberOrNull(data.brushSpeed);
  if (brushSpeed !== null) {
    return applyExportPlaybackScale(brushSpeed, layerSpeedScale);
  }

  const recolorSpeed = toFiniteNumberOrNull(data.recolorSettings?.animation?.speed);
  if (recolorSpeed !== null) {
    return applyExportPlaybackScale(recolorSpeed, layerSpeedScale);
  }

  return null;
};

const resolveExportControllerSpeed = (
  layer: Layer,
  layerSpeedScale: number,
  fallbackToolSpeed?: number | null
): number | null => {
  const data = layer.colorCycleData;
  if (!data) {
    return null;
  }

  const layerBaseSpeed = toFiniteNumberOrNull(data.layerBaseSpeedCps);
  if (layerBaseSpeed !== null) {
    return applyExportPlaybackScale(
      resolveLayerColorCycleFallbackPlaybackSpeedCps(data, fallbackToolSpeed ?? undefined),
      layerSpeedScale,
    );
  }

  const controllerSpeed = toFiniteNumberOrNull(data.controllerSpeedCps);
  if (controllerSpeed !== null) {
    return applyExportPlaybackScale(controllerSpeed, layerSpeedScale);
  }

  const brushSpeed = toFiniteNumberOrNull(data.brushSpeed);
  if (brushSpeed !== null) {
    return applyExportPlaybackScale(brushSpeed, layerSpeedScale);
  }

  const recolorSpeed = toFiniteNumberOrNull(data.recolorSettings?.animation?.speed);
  if (recolorSpeed !== null) {
    return applyExportPlaybackScale(recolorSpeed, layerSpeedScale);
  }

  const toolSpeed = resolveExportToolSpeed(layer, layerSpeedScale, fallbackToolSpeed);
  if (toolSpeed !== null) {
    return toolSpeed;
  }

  return null;
};

const SPEED_SLOT_LIMIT = 64;

const resolveExportToolSpeed = (
  layer: Layer,
  layerSpeedScale: number,
  fallbackToolSpeed?: number | null
): number | null => {
  const toolSpeed = toFiniteNumberOrNull(fallbackToolSpeed);
  const data = layer.colorCycleData;
  if (!data && toolSpeed === null) {
    return null;
  }
  return applyExportPlaybackScale(
    resolveLayerColorCycleFallbackPlaybackSpeedCps(data, toolSpeed ?? undefined),
    layerSpeedScale,
  );
};

const collectUsedSlots = (
  gradientIds: NumericArrayLike,
  indices?: NumericArrayLike
): Set<number> => {
  const used = new Set<number>();
  const length = Math.min(gradientIds.length, indices?.length ?? gradientIds.length);
  for (let i = 0; i < length; i += 1) {
    if (indices && indices[i] === 0) {
      continue;
    }
    const slot = (gradientIds[i] ?? 0) & FLOW_SLOT_MASK;
    used.add(slot);
  }
  return used;
};

const resolveSlotSpeedMap = (
  data: Layer['colorCycleData'] | undefined
): Map<number, number> => {
  const slotSpeeds = new Map<number, { speed: number; createdAtMs: number }>();
  const defs = data?.gradientDefStore ?? [];
  for (const entry of defs) {
    if (typeof entry.slot !== 'number') {
      continue;
    }
    const speed = toFiniteNumberOrNull(entry.speedCps);
    if (speed === null) {
      continue;
    }
    const createdAtMs = Number.isFinite(entry.createdAtMs) ? entry.createdAtMs : 0;
    const existing = slotSpeeds.get(entry.slot);
    if (!existing || createdAtMs >= existing.createdAtMs) {
      slotSpeeds.set(entry.slot, { speed, createdAtMs });
    }
  }
  const resolved = new Map<number, number>();
  slotSpeeds.forEach((value, slot) => {
    resolved.set(slot, value.speed);
  });
  return resolved;
};

type SlotSpeedByteScan = {
  hasConflict: boolean;
  speedByteBySlot: Map<number, number>;
  zeroOnlySlots: Set<number>;
  hasNonZeroByte: boolean;
};

const scanSlotSpeedBytes = (
  gradientIds: NumericArrayLike,
  speedBuffer: NumericArrayLike,
  indices?: NumericArrayLike
): SlotSpeedByteScan => {
  const length = Math.min(gradientIds.length, speedBuffer.length, indices?.length ?? gradientIds.length);
  const speedByteBySlot = new Map<number, number>();
  const zeroOnlySlots = new Set<number>();
  const result = (hasConflict: boolean): SlotSpeedByteScan => ({
    hasConflict,
    speedByteBySlot,
    zeroOnlySlots,
    hasNonZeroByte: speedByteBySlot.size > 0,
  });
  for (let i = 0; i < length; i += 1) {
    if (indices && indices[i] === 0) {
      continue;
    }
    const slot = (gradientIds[i] ?? 0) & FLOW_SLOT_MASK;
    const speedByte = speedBuffer[i] | 0;
    if (speedByte <= 0) {
      if (speedByteBySlot.has(slot)) {
        return result(true);
      }
      zeroOnlySlots.add(slot);
      continue;
    }
    if (zeroOnlySlots.has(slot)) {
      return result(true);
    }
    zeroOnlySlots.delete(slot);
    const existing = speedByteBySlot.get(slot);
    if (existing !== undefined && existing !== speedByte) {
      return result(true);
    }
    speedByteBySlot.set(slot, speedByte);
  }
  return result(false);
};

const buildSpeedBufferFromSlots = (params: {
  gradientIds: NumericArrayLike;
  indices?: NumericArrayLike;
  speedBySlot: Map<number, number>;
  fallbackSpeed: number | null;
  warnOnce: () => void;
}): Uint8Array => {
  const length = params.gradientIds.length;
  const out = new Uint8Array(length);
  const resolveSpeed = (slot: number): number => {
    const resolved = params.speedBySlot.get(slot);
    if (resolved !== undefined) {
      return resolved;
    }
    params.warnOnce();
    return params.fallbackSpeed ?? MIN_BRUSH_COLOR_CYCLE_SPEED;
  };
  for (let i = 0; i < length; i += 1) {
    if (params.indices && params.indices[i] === 0) {
      continue;
    }
    const slot = (params.gradientIds[i] ?? 0) & FLOW_SLOT_MASK;
    const speed = resolveSpeed(slot);
    out[i] = speed > 0 ? encodeColorCycleSpeedByte(speed) : 0;
  }
  return out;
};

export const prepareBrushSpeedExport = (params: {
  layer: Layer;
  brushState: WebGLSerializedBrushState;
  warnOnce: () => void;
  forceBuffer?: boolean;
  layerSpeedScale: number;
  fallbackToolSpeed?: number | null;
  speedSourceVersion?: ColorCycleSpeedSourceVersion;
}): {
  speedMode?: 'slot' | 'buffer';
  slotSpeeds?: Array<{ slot: number; speed: number }>;
  speedBufferOverride?: number[];
  speedMin?: number;
  speedMax?: number;
} | null => {
  const gradientIds = isNumericArrayLike(params.brushState.gradientIdBuffer)
    ? params.brushState.gradientIdBuffer
    : null;
  if (!gradientIds || gradientIds.length === 0) {
    return null;
  }

  const indices = isNumericArrayLike(params.brushState.indexBuffer) ? params.brushState.indexBuffer : undefined;
  const usedSlots = collectUsedSlots(gradientIds, indices);
  if (usedSlots.size === 0) {
    return null;
  }

  const layerMultiplier = toFiniteNumberOrNull(
    params.layer.colorCycleData?.layerBaseSpeedCps,
  );
  const sourceSpeedScale = params.speedSourceVersion === AUTHORED_SPEED_SOURCE_VERSION
    ? composeColorCyclePlaybackSpeedScale(layerMultiplier, params.layerSpeedScale)
    : params.layerSpeedScale;
  const rawSpeedBySlot = resolveSlotSpeedMap(params.layer.colorCycleData);
  const speedBySlot = new Map<number, number>();
  rawSpeedBySlot.forEach((speed, slot) => {
    speedBySlot.set(slot, (speed ?? 0) * sourceSpeedScale);
  });
  const fallbackSpeed = resolveExportToolSpeed(params.layer, params.layerSpeedScale, params.fallbackToolSpeed);
  const speedBufferValues = isNumericArrayLike(params.brushState.speedBuffer)
    ? params.brushState.speedBuffer
    : null;

  const speedByteScan = speedBufferValues && speedBufferValues.length > 0
    ? scanSlotSpeedBytes(gradientIds, speedBufferValues, indices)
    : null;
  const hasConflict = speedByteScan?.hasConflict ?? false;
  const shouldUseBuffer = params.forceBuffer || usedSlots.size > SPEED_SLOT_LIMIT || hasConflict;

  if (shouldUseBuffer) {
    const hasPersistedSpeedBuffer = Boolean(speedBufferValues && speedBufferValues.length > 0);
    const speedBufferOverride = hasPersistedSpeedBuffer
      ? numericArrayLikeToArray(speedBufferValues as NumericArrayLike)
      : buildSpeedBufferFromSlots({
          gradientIds,
          indices,
          speedBySlot,
          fallbackSpeed,
          warnOnce: params.warnOnce,
        });
    const normalizedSpeedBuffer = Array.isArray(speedBufferOverride)
      ? speedBufferOverride
      : Array.from(speedBufferOverride);
    return {
      speedMode: 'buffer',
      speedBufferOverride: normalizedSpeedBuffer,
      speedMin: hasPersistedSpeedBuffer
        ? MIN_BRUSH_COLOR_CYCLE_SPEED * sourceSpeedScale
        : MIN_BRUSH_COLOR_CYCLE_SPEED,
      speedMax: hasPersistedSpeedBuffer
        ? MAX_BRUSH_COLOR_CYCLE_SPEED * sourceSpeedScale
        : MAX_BRUSH_COLOR_CYCLE_SPEED,
    };
  }

  const slotSpeeds: Array<{ slot: number; speed: number }> = [];
  const pushFallbackSlotSpeed = (slot: number) => {
    const speed = speedBySlot.get(slot);
    if (Number.isFinite(speed)) {
      slotSpeeds.push({ slot, speed: speed as number });
      return;
    }
    params.warnOnce();
    if (Number.isFinite(fallbackSpeed)) {
      slotSpeeds.push({ slot, speed: fallbackSpeed as number });
    }
  };

  if (speedByteScan?.hasNonZeroByte) {
    usedSlots.forEach((slot) => {
      const speedByte = speedByteScan.speedByteBySlot.get(slot);
      if (speedByte !== undefined) {
        slotSpeeds.push({
          slot,
          speed: decodeColorCycleSpeedByte(speedByte) * sourceSpeedScale,
        });
        return;
      }
      if (speedByteScan.zeroOnlySlots.has(slot)) {
        slotSpeeds.push({ slot, speed: 0 });
        return;
      }
      pushFallbackSlotSpeed(slot);
    });
  } else {
    // Legacy/defaultable exports may synthesize zero-filled speed buffers for
    // states that never stored per-pixel speed data; keep those on def/tool fallback.
    usedSlots.forEach(pushFallbackSlotSpeed);
  }

  if (slotSpeeds.length === 0) {
    const speedBufferOverride = buildSpeedBufferFromSlots({
      gradientIds,
      indices,
      speedBySlot,
      fallbackSpeed,
      warnOnce: params.warnOnce,
    });
    const normalizedSpeedBuffer = Array.from(speedBufferOverride);
    return {
      speedMode: 'buffer',
      speedBufferOverride: normalizedSpeedBuffer,
    };
  }

  return {
    speedMode: 'slot',
    slotSpeeds,
  };
};

const cropNumericBufferToBounds = (
  input: NumericArrayInput,
  sourceWidth: number,
  sourceHeight: number,
  bounds: WebGLLayerBounds
): NumericArrayInput => {
  if (!isNumericArrayLike(input)) {
    return input;
  }

  const width = Math.max(1, Math.floor(sourceWidth));
  const height = Math.max(1, Math.floor(sourceHeight));
  const expectedLength = width * height;
  if (input.length < expectedLength) {
    return input;
  }

  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  const cropWidth = Math.max(1, Math.floor(bounds.width));
  const cropHeight = Math.max(1, Math.floor(bounds.height));
  const clampedWidth = Math.min(cropWidth, width - x);
  const clampedHeight = Math.min(cropHeight, height - y);
  if (clampedWidth >= width && clampedHeight >= height && x === 0 && y === 0) {
    return input;
  }

  const output = new Array<number>(clampedWidth * clampedHeight);
  let outIndex = 0;
  for (let row = 0; row < clampedHeight; row += 1) {
    const sourceStart = (y + row) * width + x;
    for (let col = 0; col < clampedWidth; col += 1) {
      output[outIndex] = input[sourceStart + col] ?? 0;
      outIndex += 1;
    }
  }
  return output;
};

const cropMaskValuesToBounds = (
  input: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  bounds: WebGLLayerBounds
): Uint8Array => {
  const width = Math.max(1, Math.floor(sourceWidth));
  const height = Math.max(1, Math.floor(sourceHeight));
  const expectedLength = width * height;
  if (input.length < expectedLength) {
    return input;
  }

  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  const cropWidth = Math.min(Math.max(1, Math.floor(bounds.width)), width - x);
  const cropHeight = Math.min(Math.max(1, Math.floor(bounds.height)), height - y);
  if (x === 0 && y === 0 && cropWidth >= width && cropHeight >= height) {
    return input;
  }

  const output = new Uint8Array(cropWidth * cropHeight);
  let outIndex = 0;
  for (let row = 0; row < cropHeight; row += 1) {
    const sourceStart = (y + row) * width + x;
    for (let col = 0; col < cropWidth; col += 1) {
      output[outIndex] = input[sourceStart + col] ?? 0;
      outIndex += 1;
    }
  }
  return output;
};

const cropBrushStateToCoverage = (
  brushState: WebGLSerializedBrushState,
  coverage: WebGLLayerBounds | undefined
): WebGLSerializedBrushState => {
  if (!coverage) {
    return brushState;
  }

  const sourceWidth = Math.max(1, Math.floor(brushState.width));
  const sourceHeight = Math.max(1, Math.floor(brushState.height));
  const x = Math.max(0, Math.floor(coverage.x));
  const y = Math.max(0, Math.floor(coverage.y));
  const cropWidth = Math.min(Math.max(1, Math.floor(coverage.width)), sourceWidth - x);
  const cropHeight = Math.min(Math.max(1, Math.floor(coverage.height)), sourceHeight - y);
  if (
    x === 0 &&
    y === 0 &&
    cropWidth >= sourceWidth &&
    cropHeight >= sourceHeight
  ) {
    return brushState;
  }

  return {
    ...brushState,
    width: cropWidth,
    height: cropHeight,
    indexBuffer: cropNumericBufferToBounds(brushState.indexBuffer, sourceWidth, sourceHeight, coverage)
      ?? brushState.indexBuffer,
    gradientIdBuffer: cropNumericBufferToBounds(brushState.gradientIdBuffer, sourceWidth, sourceHeight, coverage),
    gradientDefIdBuffer: cropNumericBufferToBounds(brushState.gradientDefIdBuffer, sourceWidth, sourceHeight, coverage),
    speedBuffer: cropNumericBufferToBounds(brushState.speedBuffer, sourceWidth, sourceHeight, coverage),
    flowBuffer: cropNumericBufferToBounds(brushState.flowBuffer, sourceWidth, sourceHeight, coverage),
    phaseBuffer: cropNumericBufferToBounds(brushState.phaseBuffer, sourceWidth, sourceHeight, coverage),
  };
};

const resolveFgDerivedStops = (
  data: Layer['colorCycleData'] | undefined,
  slotPalettes: Array<{ slot: number; stops: SerializedGradientStops }> | undefined
): SerializedGradientStops | undefined => {
  if (!data) {
    return undefined;
  }

  const fgSlot = typeof data.fgActiveSlot === 'number' ? data.fgActiveSlot : null;
  if (fgSlot === null) {
    return undefined;
  }

  const existing = slotPalettes?.find((entry) => entry.slot === fgSlot);
  if (existing?.stops && existing.stops.length > 0) {
    return existing.stops;
  }

  const derivedEntries = data.fgDerivedGradients ?? data.derivedGradients;
  if (!Array.isArray(derivedEntries) || derivedEntries.length === 0) {
    return undefined;
  }

  const derivedMatch = derivedEntries.find((entry) => entry?.slot === fgSlot)
    ?? (data.fgDerivedKey
      ? derivedEntries.find((entry) => entry?.key === data.fgDerivedKey)
      : undefined);
  if (!derivedMatch?.spec) {
    return undefined;
  }

  return deriveForegroundGradientStops(derivedMatch.spec);
};

export const resolveDefBoundSlotPalettes = (params: {
  data: Layer['colorCycleData'] | undefined;
  brushState?: WebGLSerializedBrushState;
  slotPalettes?: SerializedSlotPalette[];
}): SerializedSlotPalette[] | undefined => {
  const { data, brushState } = params;
  if (!data || !brushState) {
    return params.slotPalettes;
  }

  const gradientIds = isNumericArrayLike(brushState.gradientIdBuffer) ? brushState.gradientIdBuffer : null;
  const defIds = isNumericArrayLike(brushState.gradientDefIdBuffer)
    ? brushState.gradientDefIdBuffer
    : decodePersistedDefIdBuffer(getColorCycleLegacyLayerBuffer(data, 'gradientDefIdBuffer'));
  const indices = isNumericArrayLike(brushState.indexBuffer) ? brushState.indexBuffer : undefined;
  const defs = data.gradientDefStore ?? [];

  if (!gradientIds || gradientIds.length === 0 || defIds.length === 0 || defs.length === 0) {
    return params.slotPalettes;
  }

  const seamProfilesBySlot = new Map<number, GradientSeamProfile>();
  defs.forEach((entry) => {
    if (typeof entry.slot === 'number' && entry.seamProfile !== undefined) {
      seamProfilesBySlot.set(entry.slot, normalizeGradientSeamProfile(entry.seamProfile));
    }
  });
  const resolved = [...(params.slotPalettes ?? [])].map((entry) => ({
    ...entry,
    seamProfile: entry.seamProfile ?? seamProfilesBySlot.get(entry.slot),
  }));
  const resolvedBySlot = new Map<number, SerializedSlotPalette>(
    resolved.map((entry) => [entry.slot, entry])
  );
  const usedSlots = [...collectUsedSlots(gradientIds, indices)];
  if (usedSlots.length === 0) {
    return resolved;
  }

  const usedSet = new Set(usedSlots);
  const paintedCountsBySlot = new Map<number, number>();
  const defCountsBySlot = new Map<number, Map<number, number>>();
  const length = Math.min(gradientIds.length, defIds.length, indices?.length ?? gradientIds.length);
  for (let index = 0; index < length; index += 1) {
    if (indices && indices[index] === 0) {
      continue;
    }
    const slot = (gradientIds[index] ?? 0) & FLOW_SLOT_MASK;
    if (!usedSet.has(slot)) {
      continue;
    }
    paintedCountsBySlot.set(slot, (paintedCountsBySlot.get(slot) ?? 0) + 1);
    const defId = Number(defIds[index] ?? 0);
    if (!Number.isFinite(defId) || defId <= 0) {
      continue;
    }
    let counts = defCountsBySlot.get(slot);
    if (!counts) {
      counts = new Map<number, number>();
      defCountsBySlot.set(slot, counts);
    }
    counts.set(defId, (counts.get(defId) ?? 0) + 1);
  }

  for (const slot of usedSlots) {
    const counts = defCountsBySlot.get(slot);
    if (!counts || counts.size === 0) {
      continue;
    }
    const [defId, defCount = 0] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!Number.isFinite(defId)) {
      continue;
    }
    const def = defs.find((entry) => entry.id === defId);
    if (!def?.stops?.length) {
      continue;
    }
    const hasExistingPalette = resolvedBySlot.has(slot);
    const paintedCount = paintedCountsBySlot.get(slot) ?? 0;
    if (hasExistingPalette && defCount <= paintedCount / 2) {
      continue;
    }
    resolvedBySlot.set(slot, {
      slot,
      stops: toSerializableGradientStops(def.stops, []),
      seamProfile: normalizeGradientSeamProfile(def.seamProfile),
    });
  }

  return [...resolvedBySlot.values()];
};

export const materializeDefBoundBrushSlots = (params: {
  data: Layer['colorCycleData'] | undefined;
  brushState?: WebGLSerializedBrushState;
  slotPalettes?: SerializedSlotPalette[];
}): {
  brushState?: WebGLSerializedBrushState;
  slotPalettes?: SerializedSlotPalette[];
  remapped: boolean;
} => {
  const { data, brushState } = params;
  if (!data || !brushState) {
    return { brushState, slotPalettes: params.slotPalettes, remapped: false };
  }

  const gradientIds = isNumericArrayLike(brushState.gradientIdBuffer) ? brushState.gradientIdBuffer : null;
  const defIds = isNumericArrayLike(brushState.gradientDefIdBuffer)
    ? brushState.gradientDefIdBuffer
    : decodePersistedDefIdBuffer(getColorCycleLegacyLayerBuffer(data, 'gradientDefIdBuffer'));
  const indices = isNumericArrayLike(brushState.indexBuffer) ? brushState.indexBuffer : undefined;
  const defs = data.gradientDefStore ?? [];

  if (!gradientIds || gradientIds.length === 0 || defIds.length === 0 || defs.length === 0) {
    return { brushState, slotPalettes: params.slotPalettes, remapped: false };
  }

  type GradientDefStoreEntry = NonNullable<NonNullable<Layer['colorCycleData']>['gradientDefStore']>[number];
  const defsById = new Map<number, GradientDefStoreEntry>();
  defs.forEach((entry) => {
    if (Number.isFinite(entry.id) && entry.stops?.length) {
      defsById.set(Math.round(entry.id), entry);
    }
  });
  if (defsById.size === 0) {
    return { brushState, slotPalettes: params.slotPalettes, remapped: false };
  }

  const length = Math.min(gradientIds.length, defIds.length, indices?.length ?? gradientIds.length);
  const paintedDefIds = new Set<number>();
  const usedSlots = new Set<number>();
  for (let index = 0; index < length; index += 1) {
    if (indices && indices[index] === 0) {
      continue;
    }
    usedSlots.add((gradientIds[index] ?? 0) & FLOW_SLOT_MASK);
    const defId = Number(defIds[index] ?? 0);
    if (Number.isFinite(defId) && defId > 0 && defsById.has(Math.round(defId))) {
      paintedDefIds.add(Math.round(defId));
    }
  }

  if (paintedDefIds.size === 0) {
    return { brushState, slotPalettes: params.slotPalettes, remapped: false };
  }

  const resolvedBySlot = new Map<number, SerializedSlotPalette>();
  (params.slotPalettes ?? []).forEach((entry) => {
    resolvedBySlot.set(entry.slot & FLOW_SLOT_MASK, {
      ...entry,
      slot: entry.slot & FLOW_SLOT_MASK,
    });
  });

  const defIdsByPreferredSlot = new Map<number, number[]>();
  paintedDefIds.forEach((defId) => {
    const preferredSlot = (defsById.get(defId)?.slot ?? 0) & FLOW_SLOT_MASK;
    const ids = defIdsByPreferredSlot.get(preferredSlot) ?? [];
    ids.push(defId);
    defIdsByPreferredSlot.set(preferredSlot, ids);
  });

  const defSlotMap = new Map<number, number>();
  const reservedSlots = new Set<number>([
    ...usedSlots,
    ...resolvedBySlot.keys(),
  ]);
  const allocateSlot = (): number | null => {
    for (let slot = 0; slot <= FLOW_SLOT_MASK; slot += 1) {
      if (!reservedSlots.has(slot)) {
        reservedSlots.add(slot);
        return slot;
      }
    }
    return null;
  };

  [...paintedDefIds].sort((a, b) => a - b).forEach((defId) => {
    const def = defsById.get(defId);
    if (!def) {
      return;
    }
    const preferredSlot = (def.slot ?? 0) & FLOW_SLOT_MASK;
    const preferredIds = defIdsByPreferredSlot.get(preferredSlot) ?? [];
    const canUsePreferred = preferredIds[0] === defId && (!resolvedBySlot.has(preferredSlot) || usedSlots.has(preferredSlot));
    const slot = canUsePreferred ? preferredSlot : allocateSlot();
    if (slot === null) {
      return;
    }
    defSlotMap.set(defId, slot);
    resolvedBySlot.set(slot, {
      slot,
      stops: toSerializableGradientStops(def.stops, []),
      seamProfile: normalizeGradientSeamProfile(def.seamProfile),
    });
    reservedSlots.add(slot);
  });

  if (defSlotMap.size === 0) {
    return { brushState, slotPalettes: [...resolvedBySlot.values()], remapped: false };
  }

  let remapped = false;
  const remappedGradientIds = gradientIds.slice();
  for (let index = 0; index < length; index += 1) {
    if (indices && indices[index] === 0) {
      continue;
    }
    const defId = Math.round(Number(defIds[index] ?? 0));
    const slot = defSlotMap.get(defId);
    if (slot === undefined) {
      continue;
    }
    const current = remappedGradientIds[index] ?? 0;
    if ((current & FLOW_SLOT_MASK) !== slot) {
      remapped = true;
    }
    remappedGradientIds[index] = slot;
  }

  return {
    brushState: remapped ? { ...brushState, gradientIdBuffer: remappedGradientIds } : brushState,
    slotPalettes: [...resolvedBySlot.values()].sort((a, b) => a.slot - b.slot),
    remapped,
  };
};

const resolveActiveGradientDefinitions = (params: {
  data: Layer['colorCycleData'] | undefined;
  brushState?: WebGLSerializedBrushState;
  documentState?: ColorCyclePersistenceDocumentState;
}): SerializedGradientDefinition[] | undefined => {
  const { data, brushState, documentState } = params;
  if (!data || !brushState) {
    return undefined;
  }

  const defIds = isNumericArrayLike(brushState.gradientDefIdBuffer)
    ? brushState.gradientDefIdBuffer
    : decodePersistedDefIdBuffer(getColorCycleLegacyLayerBuffer(data, 'gradientDefIdBuffer'));
  const indices = isNumericArrayLike(brushState.indexBuffer) ? brushState.indexBuffer : undefined;
  const defs = documentState?.gradientDefStore?.length
    ? documentState.gradientDefStore
    : data.gradientDefStore ?? [];
  if (defIds.length === 0 || defs.length === 0) {
    return undefined;
  }

  const activeDefIds = new Set<number>();
  const length = Math.min(defIds.length, indices?.length ?? defIds.length);
  for (let index = 0; index < length; index += 1) {
    if (indices && indices[index] === 0) {
      continue;
    }
    const defId = Math.round(Number(defIds[index] ?? 0));
    if (Number.isFinite(defId) && defId > 0 && defId <= 0xffff) {
      activeDefIds.add(defId);
    }
  }

  const serialized = defs
    .filter((entry) => activeDefIds.has(Math.round(entry.id)) && entry.stops?.length)
    .map((entry) => ({
      id: Math.round(entry.id),
      stops: toSerializableGradientStops(entry.stops, []),
      seamProfile: normalizeGradientSeamProfile(entry.seamProfile),
    }))
    .filter((entry) => entry.stops.length > 0)
    .sort((a, b) => a.id - b.id);

  return serialized.length > 0 ? serialized : undefined;
};

const resolveExportSlotPalettes = (
  data: Layer['colorCycleData'] | undefined,
  brushState?: WebGLSerializedBrushState,
  documentState?: ColorCyclePersistenceDocumentState
): SerializedSlotPalette[] | undefined => {
  if (!data) {
    return undefined;
  }

  let slotPalettes: SerializedSlotPalette[] | undefined = documentState?.slotPalettes?.length
      ? documentState.slotPalettes.map((entry) => ({
          slot: entry.slot,
          seamProfile: entry.seamProfile,
          stops: toSerializableGradientStops(entry.stops, []),
        }))
    : data.slotPalettes?.length
      ? data.slotPalettes.map((entry) => ({
          slot: entry.slot,
          seamProfile: entry.seamProfile,
          stops: toSerializableGradientStops(entry.stops, []),
        }))
    : data.gradients?.length
      ? data.gradients.map((entry) => ({
          slot: entry.slot,
          stops: toSerializableGradientStops(entry.stops, []),
        }))
      : undefined;

  if (!slotPalettes || slotPalettes.length === 0) {
    slotPalettes = undefined;
  }

  const fgStops = resolveFgDerivedStops(data, slotPalettes);
  const fgSlot = typeof data.fgActiveSlot === 'number' ? data.fgActiveSlot : null;
  if (fgSlot !== null && fgStops && fgStops.length > 0) {
    const hasSlot = slotPalettes?.some((entry) => entry.slot === fgSlot) ?? false;
    if (!hasSlot) {
      slotPalettes = [...(slotPalettes ?? []), { slot: fgSlot, stops: fgStops }];
    }
  }

  return resolveDefBoundSlotPalettes({ data, brushState, slotPalettes });
};

const resolveColorCycleMaskImage = (layer: Layer): ImageData | undefined => {
  const data = layer.colorCycleData;
  if (!data) {
    return undefined;
  }
  return captureCanvasImageData(data.eraseMask ?? null) ?? data.eraseMaskImageData;
};

const resolveColorCycleSoftEdgeMaskImage = (layer: Layer): ImageData | undefined => {
  const data = layer.colorCycleData;
  if (!data) {
    return undefined;
  }
  if (data.softEdgeMaskEnabled === false) {
    return undefined;
  }
  if (data.softEdgeMaskImageData) {
    return data.softEdgeMaskImageData;
  }
  return captureCanvasImageData(data.softEdgeMask ?? null) ?? undefined;
};

const extractAlphaChannel = (imageData: ImageData): Uint8Array => {
  const width = Math.max(1, Math.floor(imageData.width));
  const height = Math.max(1, Math.floor(imageData.height));
  const total = width * height;
  const alpha = new Uint8Array(total);
  const source = imageData.data;
  for (let i = 0, aIdx = 3; i < total && aIdx < source.length; i += 1, aIdx += 4) {
    alpha[i] = source[aIdx] ?? 0;
  }
  return alpha;
};

const resampleAlphaChannel = (imageData: ImageData, width: number, height: number): Uint8Array => {
  const targetWidth = Math.max(1, Math.floor(width));
  const targetHeight = Math.max(1, Math.floor(height));
  const sourceWidth = Math.max(1, Math.floor(imageData.width));
  const sourceHeight = Math.max(1, Math.floor(imageData.height));

  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return extractAlphaChannel(imageData);
  }

  const result = new Uint8Array(targetWidth * targetHeight);
  const srcData = imageData.data;
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;

  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = Math.min(sourceHeight - 1, Math.max(0, Math.floor(y * scaleY)));
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.min(sourceWidth - 1, Math.max(0, Math.floor(x * scaleX)));
      const srcIndex = (srcY * sourceWidth + srcX) * 4 + 3;
      result[y * targetWidth + x] = srcData[srcIndex] ?? 0;
    }
  }

  return result;
};

const hasAnyMaskValue = (values: Uint8Array): boolean => {
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > 0) {
      return true;
    }
  }
  return false;
};

const captureColorCycleMaskDataset = (
  layer: Layer,
  width: number,
  height: number
): ColorCycleMaskDataset | undefined => {
  const maskSource = resolveColorCycleMaskImage(layer);
  if (!maskSource) {
    return undefined;
  }

  const normalizedWidth = Math.max(1, Math.floor(width));
  const normalizedHeight = Math.max(1, Math.floor(height));
  const values = resampleAlphaChannel(maskSource, normalizedWidth, normalizedHeight);

  let hasCoverage = false;
  let minX = normalizedWidth;
  let minY = normalizedHeight;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < normalizedHeight; y += 1) {
    for (let x = 0; x < normalizedWidth; x += 1) {
      const idx = y * normalizedWidth + x;
      if (values[idx] > 0) {
        hasCoverage = true;
        if (x < minX) {
          minX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (y > maxY) {
          maxY = y;
        }
      }
    }
  }

  const coverage = hasCoverage
    ? {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
      }
    : undefined;

  return {
    width: normalizedWidth,
    height: normalizedHeight,
    values,
    coverage
  };
};

const captureColorCycleSoftEdgeMaskDataset = (
  layer: Layer,
  width: number,
  height: number
): ColorCycleMaskDataset | undefined => {
  const maskSource = resolveColorCycleSoftEdgeMaskImage(layer);
  if (!maskSource) {
    return undefined;
  }
  const normalizedWidth = Math.max(1, Math.floor(width));
  const normalizedHeight = Math.max(1, Math.floor(height));
  const values = resampleAlphaChannel(maskSource, normalizedWidth, normalizedHeight);
  if (!hasAnyMaskValue(values)) {
    return undefined;
  }
  return {
    width: normalizedWidth,
    height: normalizedHeight,
    values,
  };
};

const deriveCoverageFromIndexBufferWithMask = (
  buffer: ArrayLike<number>,
  width: number,
  height: number,
  maskDataset?: ColorCycleMaskDataset
): WebGLLayerBounds | undefined => {
  const normalizedWidth = Math.max(1, Math.floor(width));
  const normalizedHeight = Math.max(1, Math.floor(height));
  const total = normalizedWidth * normalizedHeight;
  const length = typeof buffer.length === 'number' ? buffer.length : total;
  const limit = Math.min(length, total);

  const maskValues = maskDataset
    && maskDataset.width === normalizedWidth
    && maskDataset.height === normalizedHeight
      ? maskDataset.values
      : undefined;

  let minX = normalizedWidth;
  let minY = normalizedHeight;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < limit; index += 1) {
    const value = Number(buffer[index]);
    if (!Number.isFinite(value) || value === 0) {
      continue;
    }
    if (maskValues && maskValues[index] > 0) {
      continue;
    }
    const y = Math.floor(index / normalizedWidth);
    const x = index - y * normalizedWidth;
    if (x < minX) {
      minX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y > maxY) {
      maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return undefined;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
};

interface ColorCycleCoverageContext {
  layer: Layer;
  project: Project;
  brushState?: WebGLSerializedBrushState;
  recolorIndexBuffer?: ArrayLike<number> | null;
  recolorSurface?: CoverageSize | null;
  maskDataset?: ColorCycleMaskDataset;
}

const computeColorCycleCoverage = (
  context: ColorCycleCoverageContext
): ColorCycleCoverageResult | undefined => {
  const documentSize = {
    width: Math.max(1, context.project.width),
    height: Math.max(1, context.project.height)
  };

  const brushState = context.brushState;
  if (
    brushState &&
    isNumericArrayLike(brushState.indexBuffer) &&
    Number.isFinite(brushState.width) &&
    Number.isFinite(brushState.height)
  ) {
    const coverage = deriveCoverageFromIndexBufferWithMask(
      brushState.indexBuffer,
      brushState.width,
      brushState.height
    );
    if (coverage) {
      return {
        source: clampBoundsToSurface(coverage, {
          width: brushState.width,
          height: brushState.height
        }),
        document: scaleMaskBoundsToDocument(coverage, {
          width: brushState.width,
          height: brushState.height
        }, documentSize)
      };
    }
  }

  if (context.recolorIndexBuffer && context.recolorSurface) {
    const coverage = deriveCoverageFromIndexBufferWithMask(
      context.recolorIndexBuffer,
      context.recolorSurface.width,
      context.recolorSurface.height,
      context.maskDataset
    );
    if (coverage) {
      return {
        source: clampBoundsToSurface(coverage, context.recolorSurface),
        document: scaleMaskBoundsToDocument(
          coverage,
          context.recolorSurface,
          documentSize
        )
      };
    }
  }

  return undefined;
};

const serializeColorCycleAlphaMask = async (
  layer: Layer,
  width: number,
  height: number,
  dataset?: ColorCycleMaskDataset
): Promise<SerializedAlphaMaskResult | undefined> => {
  const maskDataset = dataset ?? captureColorCycleMaskDataset(layer, width, height);
  if (!maskDataset) {
    return undefined;
  }

  const encoded = await packNumericArrayForExport(maskDataset.values);
  if (!encoded) {
    return undefined;
  }

  return {
    payload: {
      width: maskDataset.width,
      height: maskDataset.height,
      data: encoded
    },
    values: maskDataset.values,
    coverageBounds: maskDataset.coverage
  };
};

const applyAlphaMaskToNumericIndexBuffer = (indices: Uint8Array | undefined, mask: Uint8Array): void => {
  if (!indices || indices.length === 0 || mask.length === 0) {
    return;
  }
  const length = Math.min(indices.length, mask.length);
  for (let i = 0; i < length; i += 1) {
    if (mask[i] > 0) {
      indices[i] = 0;
    }
  }
};

const numericAlphaMaskWouldEraseAllPaint = (indices: Uint8Array | undefined, mask: Uint8Array): boolean => {
  if (!indices || indices.length === 0 || mask.length === 0) {
    return false;
  }
  const length = Math.min(indices.length, mask.length);
  let hasPaint = false;
  for (let index = 0; index < length; index += 1) {
    if ((indices[index] ?? 0) === 0) {
      continue;
    }
    hasPaint = true;
    if (mask[index] === 0) {
      return false;
    }
  }
  return hasPaint;
};

const numericSoftEdgeMaskWouldHideAllPaint = (indices: Uint8Array | undefined, mask: Uint8Array): boolean => {
  if (!indices || indices.length === 0 || mask.length === 0) {
    return false;
  }
  const length = Math.min(indices.length, mask.length);
  let hasPaint = false;
  for (let index = 0; index < length; index += 1) {
    if ((indices[index] ?? 0) === 0) {
      continue;
    }
    hasPaint = true;
    if (mask[index] > 0) {
      return false;
    }
  }
  return hasPaint;
};

const hasNonZeroMagnitude = (value: unknown): boolean => {
  const numeric = toNum(value, 0);
  return Math.abs(numeric) > 0;
};

const isBrushInstanceAnimating = (brush: unknown): boolean => {
  if (!brush || typeof brush !== 'object') {
    return false;
  }

  const candidate = brush as {
    isPlaying?: () => unknown;
    isAnimating?: () => unknown;
    animationState?: { isAnimating?: unknown; isPaused?: unknown };
  };

  if (typeof candidate.isPlaying === 'function') {
    try {
      const playing = candidate.isPlaying();
      if (playing === true) {
        return true;
      }
    } catch (error) {
      debugLog('raw-console', '[webglExporter] Failed to inspect brush.isPlaying()', error);
    }
  }

  if (typeof candidate.isAnimating === 'function') {
    try {
      const animating = candidate.isAnimating();
      if (animating === true) {
        return true;
      }
    } catch (error) {
      debugLog('raw-console', '[webglExporter] Failed to inspect brush.isAnimating()', error);
    }
  }

  const state = candidate.animationState;
  if (state && typeof state === 'object') {
    const { isAnimating, isPaused } = state as { isAnimating?: unknown; isPaused?: unknown };
    if (isAnimating === true && isPaused !== true) {
      return true;
    }
  }

  return false;
};

const hasNonZeroSpeedBuffer = (buffer: unknown): boolean => {
  if (!buffer) {
    return false;
  }

  if (buffer instanceof ArrayBuffer) {
    const view = new Uint8Array(buffer);
    return view.some((value) => value !== 0);
  }

  if (Array.isArray(buffer)) {
    return buffer.some((value) => Number(value) !== 0);
  }

  if (buffer instanceof Uint8Array) {
    return buffer.some((value) => value !== 0);
  }

  return false;
};

const shouldExportLayerAsAnimating = (
  layer: Layer,
  brushState?: WebGLSerializedBrushState,
  layerSpeedScale: number = resolveExportLayerSpeedScale()
): boolean => {
  const data = layer.colorCycleData;
  if (!data) {
    return false;
  }

  if (data.isAnimating) {
    return true;
  }

  if (isBrushInstanceAnimating(data.colorCycleBrush)) {
    return true;
  }

  if (brushState?.speedBuffer && hasNonZeroSpeedBuffer(brushState.speedBuffer)) {
    return true;
  }

  const resolvedSpeed = resolveExportBrushSpeed(layer, layerSpeedScale);
  if (hasNonZeroMagnitude(resolvedSpeed)) {
    return true;
  }

  const recolor = data.recolorSettings;
  if (recolor) {
    const animation = recolor.animation;
    if (animation) {
      if (animation.isPlaying) {
        return true;
      }
      if (hasNonZeroMagnitude(animation.speed)) {
        return true;
      }
    }
  }

  return false;
};

export const serializeColorCycleDataFromResolvedLayer = async (
  layer: Layer,
  project: Project,
  speedWarning?: { warned: boolean },
  options?: {
      playbackClock?: ColorCyclePlaybackClock | null;
      forceSpeedBuffer?: boolean;
      layerSpeedScale?: number;
      toolSpeed?: number | null;
      resolvedSource?: GobletColorCyclePayloadBuildSource;
      documentRead?: GobletColorCycleDocumentRead;
  }
): Promise<ColorCycleSerializationResult | undefined> => {
  // Direct callers use the same resolver as the payload builder. Once pinned,
  // neither the manager nor legacy layer buffers are consulted again.
  if (!options?.resolvedSource) {
    const source = await resolveGobletColorCycleExportSource(layer, project);
    if (!source.ok) {
      throw new Error(`Goblet export blocked: color-cycle layer "${layer.name ?? layer.id}" is missing animated brush data (${source.reason}).`);
    }
    return serializeColorCycleDataFromResolvedLayer(source.layer, project, speedWarning, {
      ...options,
      resolvedSource: source.source,
      documentRead: source.documentRead,
    });
  }
  const data = layer.colorCycleData;
  if (!data) {
    return undefined;
  }

  const layerSpeedScale = clampExportLayerSpeedScale(options?.layerSpeedScale);
  const playbackClock = options?.playbackClock === undefined
    ? getColorCyclePlaybackClock(layer.id, project.id)
    : options.playbackClock;
  let brushState: WebGLSerializedBrushState | undefined;
  let exportDocumentState: ColorCyclePersistenceDocumentState | undefined;
  if (!data.recolorSettings) {
    if (!options.documentRead) {
      throw new Error('Goblet export blocked: missing pinned color-cycle document.');
    }
    exportDocumentState = options.documentRead.snapshot;
    brushState = documentSnapshotToBrushState(
      layer,
      options.documentRead.snapshot,
      data.brushState as PersistedColorCycleBrushState | undefined,
    );
  }

  const persistedBrushFailureReason = (() => {
    if (!data.brushState) {
      return undefined;
    }
    const eligibility = resolvePersistedColorCycleExportEligibility(layer);
    if (eligibility.ok) {
      return undefined;
    }
    switch (eligibility.reason) {
      case 'non-canonical':
        return 'metadata-only-state';
      case 'unsupported-schema':
        return 'invalid-schema-version';
      default:
        return undefined;
    }
  })();

  const requiresBrushPayload = Boolean(
    !data.recolorSettings &&
    !brushState &&
    (
      data.hasContent ||
      data.deferredRuntimeRestore ||
      data.runtimeHydrationState === 'cold' ||
      data.repairStatus?.ok === false
    )
  );
  if (requiresBrushPayload) {
    const reason = data.repairStatus?.reason
      ?? persistedBrushFailureReason
      ?? (data.deferredRuntimeRestore || data.runtimeHydrationState === 'cold'
        ? 'cold-color-cycle-runtime'
        : 'missing-brush-state');
    throw new Error(
      `Goblet export blocked: color-cycle layer "${layer.name ?? layer.id}" is missing animated brush data (${reason}).`
    );
  }

  const isStaticPreviewOnlyBrushLayer = Boolean(
    !data.recolorSettings &&
    !brushState &&
    data.repairStatus?.ok === false
  );
  if (isStaticPreviewOnlyBrushLayer) {
    debugWarn(
      'raw-console',
      '[webglExporter] Color cycle layer is repair-failed/static-preview-only; exporting without animated brush data.',
      { layerId: layer.id, reason: data.repairStatus?.reason },
    );
  }

  const resolvedBrushSpeed = resolveExportBrushSpeed(layer, layerSpeedScale);
  const resolvedControllerSpeed = resolveExportControllerSpeed(layer, layerSpeedScale, options?.toolSpeed);
  const exportMode = data.recolorSettings ? 'recolor' : data.mode ?? 'brush';
  const controllerSpeedForExport = exportMode === 'recolor'
    ? resolvedControllerSpeed
    : (resolvedControllerSpeed ?? resolvedBrushSpeed ?? MIN_BRUSH_COLOR_CYCLE_SPEED);
  const shouldAnimate = exportMode === 'recolor'
    ? shouldExportLayerAsAnimating(layer, brushState, layerSpeedScale)
    : !isStaticPreviewOnlyBrushLayer;
  const serialized: WebGLSerializedColorCycle = {
    ...(playbackClock ? { playbackClock: { ...playbackClock } } : {}),
    mode: exportMode,
    gradient: data.gradient,
    brushSpeed: resolvedBrushSpeed,
    layerBaseSpeedCps: exportMode === 'recolor' ? undefined : resolvedControllerSpeed,
    controllerSpeedCps: controllerSpeedForExport,
    speedMin: MIN_BRUSH_COLOR_CYCLE_SPEED,
    speedMax: MAX_BRUSH_COLOR_CYCLE_SPEED,
    isAnimating: shouldAnimate
  };

  let runtimeBrushState: BrushStateRuntimePayload | undefined;
  const markerBrushState = data.brushState as PersistedColorCycleBrushState | undefined;
  const markerValue = markerBrushState?.layers
    ?.find((snapshot) => snapshot.layerId === layer.id)
    ?.strokeData?.speedSourceVersion;
  if (
    markerValue !== undefined &&
    markerValue !== LEGACY_EFFECTIVE_SPEED_SOURCE_VERSION &&
    markerValue !== AUTHORED_SPEED_SOURCE_VERSION
  ) {
    throw new Error(
      `Goblet export blocked: color-cycle layer "${layer.name ?? layer.id}" has an invalid speed source version.`,
    );
  }
  const speedSourceVersion: ColorCycleSpeedSourceVersion = (
    markerValue === AUTHORED_SPEED_SOURCE_VERSION
  )
    ? AUTHORED_SPEED_SOURCE_VERSION
    : LEGACY_EFFECTIVE_SPEED_SOURCE_VERSION;

  if (gobletDiagnosticsActive) {
    gobletDebugLog('[webglExporter] Animation inference for layer', layer.id, {
      inputIsAnimating: data.isAnimating,
      brushSpeed: resolvedBrushSpeed,
      recolorSpeed: data.recolorSettings?.animation?.speed,
      animationWasPlaying: data.recolorSettings?.animation?.isPlaying,
      exportedIsAnimating: shouldAnimate,
      hasSpeedBuffer: Boolean(brushState?.speedBuffer?.length)
    });
  }

  const recolorSurface = data.recolorSettings ? resolveRecolorSurfaceSize(layer, project) : undefined;

  if (data.recolorSettings) {
    const { recolorSettings } = data;
    const animation = { ...recolorSettings.animation };
    if (animation) {
      if (typeof animation.isPlaying !== 'boolean') {
        animation.isPlaying = shouldAnimate;
      } else if (shouldAnimate && animation.isPlaying === false) {
        animation.isPlaying = true;
      }
      // Flow direction has been removed in-app; normalize export to forward.
      animation.flowDirection = 'forward';
      const animationSpeed = toFiniteNumberOrNull(animation.speed);
      if (animationSpeed !== null) {
        animation.speed = animationSpeed * layerSpeedScale;
      }
    }

    const serializedIndexBuffer = await packNumericArrayForExport(recolorSettings.indexBuffer ?? undefined);
    const serializedIndexPhaseMap = await packNumericArrayForExport(recolorSettings.indexPhaseMap ?? undefined);
    const serializedPhaseMap = await packNumericArrayForExport(recolorSettings.phaseMap ?? undefined);

    serialized.recolorSettings = {
      width: recolorSurface!.width,
      height: recolorSurface!.height,
      quantizationMode: recolorSettings.quantizationMode,
      ditherMode: recolorSettings.ditherMode,
      animation,
      cycleColors: recolorSettings.cycleColors,
      gradient: recolorSettings.gradient,
      mappingMode: recolorSettings.mappingMode,
      flowMapping: recolorSettings.flowMapping,
      directionAngle: recolorSettings.directionAngle,
      bandWidthPx: recolorSettings.bandWidthPx,
      indexBuffer: serializedIndexBuffer,
      palette: recolorSettings.palette ? Array.from(recolorSettings.palette) : undefined,
      indexPhaseMap: serializedIndexPhaseMap,
      phaseMap: serializedPhaseMap,
      colorMap: recolorSettings.colorMap ? Array.from(recolorSettings.colorMap.entries()) : undefined
    };
  }

  let exportSlotPalettes: SerializedSlotPalette[] | undefined;
  let fgDerivedStops: SerializedGradientStops | undefined;
  let remappedDefBoundSlots = false;
  if (!data.recolorSettings) {
    serialized.gradientDefStore = resolveActiveGradientDefinitions({
      data,
      brushState,
      documentState: exportDocumentState,
    });
    exportSlotPalettes = resolveExportSlotPalettes(data, brushState, exportDocumentState);
    const defBoundSlots = materializeDefBoundBrushSlots({
      data,
      brushState,
      slotPalettes: exportSlotPalettes,
    });
    brushState = defBoundSlots.brushState;
    exportSlotPalettes = defBoundSlots.slotPalettes;
    remappedDefBoundSlots = defBoundSlots.remapped;
    fgDerivedStops = resolveFgDerivedStops(data, exportSlotPalettes);
    if (exportSlotPalettes && exportSlotPalettes.length > 0) {
      serialized.slotPalettes = exportSlotPalettes.map((entry) => ({
        slot: entry.slot,
        stops: toSerializableGradientStops(entry.stops, []),
        seamProfile: entry.seamProfile,
      }));
    }
  }

  const maskDimensions = brushState
    ? { width: brushState.width, height: brushState.height }
    : recolorSurface ?? getLayerSurfaceSize(layer);
  const alphaMaskDataset = captureColorCycleMaskDataset(layer, maskDimensions.width, maskDimensions.height);
  let alphaMaskResult = await serializeColorCycleAlphaMask(
    layer,
    maskDimensions.width,
    maskDimensions.height,
    alphaMaskDataset
  );
  const softEdgeMaskDataset = captureColorCycleSoftEdgeMaskDataset(layer, maskDimensions.width, maskDimensions.height);
  let softEdgeMaskResult = await serializeColorCycleAlphaMask(
    layer,
    maskDimensions.width,
    maskDimensions.height,
    softEdgeMaskDataset
  );
  if (alphaMaskResult) {
    if (brushState) {
      const indexBufferForMask = numericArrayInputToUint8Array(brushState.indexBuffer);
      if (numericAlphaMaskWouldEraseAllPaint(indexBufferForMask, alphaMaskResult.values) && data.hasContent === true) {
        debugWarn('raw-console', '[webglExporter] Ignoring stale color-cycle alpha mask that would erase all animated brush paint during Goblet export.', {
          layerId: layer.id,
          maskWidth: alphaMaskResult.payload.width,
          maskHeight: alphaMaskResult.payload.height,
        });
        alphaMaskResult = undefined;
      } else if (indexBufferForMask) {
        applyAlphaMaskToNumericIndexBuffer(indexBufferForMask, alphaMaskResult.values);
        brushState = {
          ...brushState,
          indexBuffer: indexBufferForMask,
        };
      }
    }
  }
  if (softEdgeMaskResult && brushState) {
    const indexBufferForSoftEdgeMask = numericArrayInputToUint8Array(brushState.indexBuffer);
    if (numericSoftEdgeMaskWouldHideAllPaint(indexBufferForSoftEdgeMask, softEdgeMaskResult.values)) {
      debugWarn('raw-console', '[webglExporter] Ignoring stale color-cycle soft-edge mask that would hide all animated brush paint during Goblet export.', {
        layerId: layer.id,
        maskWidth: softEdgeMaskResult.payload.width,
        maskHeight: softEdgeMaskResult.payload.height,
      });
      softEdgeMaskResult = undefined;
    }
  }

  let coverageMaskDataset: ColorCycleMaskDataset | undefined;
  if (recolorSurface) {
    if (
      alphaMaskDataset &&
      alphaMaskDataset.width === recolorSurface.width &&
      alphaMaskDataset.height === recolorSurface.height
    ) {
      coverageMaskDataset = alphaMaskDataset;
    } else {
      coverageMaskDataset = captureColorCycleMaskDataset(layer, recolorSurface.width, recolorSurface.height);
    }
  }

  const canCropBrushCoverage = brushState?.stampDitherEnabled !== true;
  const coverage = canCropBrushCoverage ? computeColorCycleCoverage({
    layer,
    project,
    brushState,
    recolorIndexBuffer: data.recolorSettings?.indexBuffer ?? null,
    recolorSurface,
    maskDataset: coverageMaskDataset
  }) : undefined;

  if (coverage) {
    serialized.coverageBoundsPx = coverage.document;
  }

  if (!data.recolorSettings && canCropBrushCoverage && !coverage) {
    serialized.isAnimating = false;
  }

  let brushCoverageSource = coverage?.source;
  let croppedAlphaMaskValues: Uint8Array | undefined;
  let croppedSoftEdgeMaskValues: Uint8Array | undefined;
  let sourceCropPx: WebGLLayerBounds | undefined;
  let sourceCropBasis: { width: number; height: number } | undefined;
  if (brushState) {
    const croppedBrushState = cropBrushStateToCoverage(brushState, coverage?.source);
    if (croppedBrushState !== brushState) {
      if (coverage?.source) {
        sourceCropPx = coverage.source;
        sourceCropBasis = {
          width: brushState.width,
          height: brushState.height,
        };
      }
      if (
        alphaMaskResult &&
        coverage?.source &&
        alphaMaskResult.payload.width === brushState.width &&
        alphaMaskResult.payload.height === brushState.height
      ) {
        croppedAlphaMaskValues = cropMaskValuesToBounds(
          alphaMaskResult.values,
          brushState.width,
          brushState.height,
          coverage.source
        );
      }
      if (
        softEdgeMaskResult &&
        coverage?.source &&
        softEdgeMaskResult.payload.width === brushState.width &&
        softEdgeMaskResult.payload.height === brushState.height
      ) {
        croppedSoftEdgeMaskValues = cropMaskValuesToBounds(
          softEdgeMaskResult.values,
          brushState.width,
          brushState.height,
          coverage.source
        );
      }
      brushState = croppedBrushState;
      brushCoverageSource = {
        x: 0,
        y: 0,
        width: brushState.width,
        height: brushState.height,
      };
    }
  }

  if (alphaMaskResult) {
    if (croppedAlphaMaskValues) {
      const encodedAlphaMask = await packNumericArrayForExport(croppedAlphaMaskValues);
      if (encodedAlphaMask) {
        serialized.alphaMask = {
          width: brushState?.width ?? alphaMaskResult.payload.width,
          height: brushState?.height ?? alphaMaskResult.payload.height,
          data: encodedAlphaMask
        };
      }
    } else {
      serialized.alphaMask = alphaMaskResult.payload;
    }
  }

  if (softEdgeMaskResult) {
    if (croppedSoftEdgeMaskValues) {
      const encodedSoftEdgeMask = await packNumericArrayForExport(croppedSoftEdgeMaskValues);
      if (encodedSoftEdgeMask) {
        serialized.softEdgeMask = {
          width: brushState?.width ?? softEdgeMaskResult.payload.width,
          height: brushState?.height ?? softEdgeMaskResult.payload.height,
          data: encodedSoftEdgeMask
        };
      }
    } else {
      serialized.softEdgeMask = softEdgeMaskResult.payload;
    }
  }

  if (brushCoverageSource) {
    serialized.coverageBoundsSourcePx = brushCoverageSource;
  }

  if (brushState && isNumericArrayLike(brushState.indexBuffer)) {
    runtimeBrushState = {
      width: brushState.width,
      height: brushState.height,
      indices: numericArrayLikeToArray(brushState.indexBuffer),
      palette: brushState.palette ? [...brushState.palette] : undefined
    };
  }

  if (brushState) {
    const warnOnceMissingSpeed = () => {
      if (speedWarning?.warned) {
        return;
      }
      if (speedWarning) {
        speedWarning.warned = true;
      }
      debugWarn('raw-console',
        '[webglExporter] Missing per-shape color cycle speed metadata; falling back to tool speed during export.'
      );
    };
    const speedPlan = prepareBrushSpeedExport({
      layer: playbackClock ? { ...layer, colorCycleData: { ...data, layerBaseSpeedCps: 1 } } : layer,
      brushState,
      warnOnce: warnOnceMissingSpeed,
      forceBuffer: Boolean(playbackClock) || options?.forceSpeedBuffer === true || remappedDefBoundSlots,
      layerSpeedScale: playbackClock ? 1 : layerSpeedScale,
      fallbackToolSpeed: options?.toolSpeed,
      speedSourceVersion,
    });
    if (speedPlan?.speedMode) {
      serialized.speedMode = speedPlan.speedMode;
    } else if (options?.forceSpeedBuffer && brushState.speedBuffer) {
      serialized.speedMode = 'buffer';
    }
    if (speedPlan?.slotSpeeds && speedPlan.slotSpeeds.length > 0) {
      serialized.slotSpeeds = speedPlan.slotSpeeds;
    }
    if (speedPlan?.speedMin !== undefined) {
      serialized.speedMin = speedPlan.speedMin;
    }
    if (speedPlan?.speedMax !== undefined) {
      serialized.speedMax = speedPlan.speedMax;
    }
    let preparedSource = brushState;
    if (speedPlan?.speedMode === 'slot') {
      preparedSource = { ...preparedSource, speedBuffer: undefined };
    }
    if (speedPlan?.speedBufferOverride) {
      preparedSource = { ...preparedSource, speedBuffer: speedPlan.speedBufferOverride };
    }
    const resolvePackedBuffer = async (
      input?: NumericArrayInput
    ): Promise<number[] | string | undefined> => {
      if (!input) {
        return undefined;
      }
      if (typeof input === 'string') {
        return input;
      }
      return packNumericArrayForExport(input);
    };

    const encodedIndexBuffer = await packNumericArrayForExport(preparedSource.indexBuffer);
    const rawGradientIds = preparedSource.gradientIdBuffer;
    const normalizedRawGradientIds = isNumericArrayLike(rawGradientIds)
      ? numericArrayLikeToArray(rawGradientIds)
      : rawGradientIds;
    const normalizedGradientIds = typeof normalizedRawGradientIds === 'string'
      ? undefined
      : normalizedRawGradientIds;
    const gradientIdFallback = Array.isArray(normalizedGradientIds)
      ? normalizedGradientIds
      : normalizedGradientIds
        ? (Array.from(normalizedGradientIds) as number[])
        : typeof normalizedRawGradientIds === 'string'
          ? normalizedRawGradientIds
          : undefined;
    const encodedGradientIdBuffer = await resolvePackedBuffer(gradientIdFallback);
    const encodedGradientDefIdBuffer = await resolvePackedBuffer(preparedSource.gradientDefIdBuffer ?? undefined);
    const encodedSpeedBuffer = await resolvePackedBuffer(preparedSource.speedBuffer ?? undefined);
    const resolveFallbackBuffer = (
      raw: NumericArrayInput
    ): number[] | string | undefined => {
      if (!raw || typeof raw === 'string') {
        return raw;
      }
      return numericArrayLikeToArray(raw);
    };
    const encodedFlowBuffer = await resolvePackedBuffer(preparedSource.flowBuffer ?? undefined);
    const encodedPhaseBuffer = await resolvePackedBuffer(preparedSource.phaseBuffer ?? undefined);
    const fallbackGradientDefIdBuffer = resolveFallbackBuffer(preparedSource.gradientDefIdBuffer);
    const fallbackSpeedBuffer = resolveFallbackBuffer(preparedSource.speedBuffer);
    const fallbackFlowBuffer = resolveFallbackBuffer(preparedSource.flowBuffer);
    const fallbackPhaseBuffer = resolveFallbackBuffer(preparedSource.phaseBuffer);
    const preparedBrushState: WebGLSerializedBrushState = {
      ...preparedSource,
      indexBuffer: encodedIndexBuffer ?? [],
      gradientIdBuffer: encodedGradientIdBuffer ?? gradientIdFallback,
      gradientDefIdBuffer: encodedGradientDefIdBuffer ?? fallbackGradientDefIdBuffer,
      speedBuffer: encodedSpeedBuffer ?? fallbackSpeedBuffer,
      flowBuffer: encodedFlowBuffer ?? fallbackFlowBuffer,
      phaseBuffer: encodedPhaseBuffer ?? fallbackPhaseBuffer,
      legacySpeedCps: controllerSpeedForExport ?? undefined
    };
    // Flow direction has been removed in-app; normalize export to forward.
    preparedBrushState.flowDirection = 'forward';
    if (typeof resolvedBrushSpeed === 'number' && Number.isFinite(resolvedBrushSpeed)) {
      if (!Number.isFinite(preparedBrushState.animationSpeed)) {
        preparedBrushState.animationSpeed = resolvedBrushSpeed;
      }
    }

    serialized.brushState = preparedBrushState;
    const brushStops = preparedBrushState.gradientStops;
    if (fgDerivedStops && fgDerivedStops.length > 0) {
      serialized.gradient = fgDerivedStops;
    } else if (brushStops && brushStops.length > 0) {
      // Prefer the live brush gradient to avoid exporting stale layer gradients.
      serialized.gradient = brushStops;
    } else if (!serialized.gradient || serialized.gradient.length === 0) {
      serialized.gradient = fgDerivedStops ?? preparedBrushState.gradientStops;
    }
    if (gobletDiagnosticsActive) {
      const summary = summarizeEncodedBuffer(
        preparedBrushState.indexBuffer,
        isNumericArrayLike(brushState.indexBuffer) ? brushState.indexBuffer.length : 0
      );
      gobletDebugLog('[webglExporter] Brush state included for layer via serialize()', {
        layerId: layer.id,
        width: preparedBrushState.width,
        height: preparedBrushState.height,
        indices: summary.length,
        encoding: summary.encoding,
        paletteSize: preparedBrushState.palette?.length ?? null,
        sample: summary.preview
      });
    }
  }

  if (gobletDiagnosticsActive) {
    const recolorIndexPayload = serialized.recolorSettings?.indexBuffer;
    const brushIndexPayload = serialized.brushState?.indexBuffer;
    const recolorIndexSummary = summarizeEncodedBuffer(
      Array.isArray(recolorIndexPayload) || typeof recolorIndexPayload === 'string' ? recolorIndexPayload : undefined,
      Array.isArray(data.recolorSettings?.indexBuffer) ? data.recolorSettings!.indexBuffer!.length : 0
    );
    const brushIndexSummary = summarizeEncodedBuffer(
      Array.isArray(brushIndexPayload) || typeof brushIndexPayload === 'string' ? brushIndexPayload : undefined,
      typeof brushIndexPayload === 'string' ? 0 : Array.isArray(brushIndexPayload) ? brushIndexPayload.length : 0
    );

    gobletDebugLog('[webglExporter] Serialized color cycle layer', layer.id, {
      mode: serialized.mode,
      isAnimating: serialized.isAnimating,
      brushSpeed: serialized.brushSpeed,
      hasRecolor: Boolean(serialized.recolorSettings),
      recolorIndexSummary,
      recolorPhaseLength: Array.isArray(serialized.recolorSettings?.phaseMap)
        ? serialized.recolorSettings!.phaseMap!.length
        : undefined,
      recolorPaletteLength: Array.isArray(serialized.recolorSettings?.palette)
        ? serialized.recolorSettings!.palette!.length
        : undefined,
      brushIndexSummary,
      gradientStops: serialized.gradient?.length ?? 0
    });
  }

  return {
    colorCycle: serialized,
    runtime: runtimeBrushState
      ? { brushState: runtimeBrushState, sourceCropPx, sourceCropBasis }
      : undefined
  };
};

export const serializeColorCycleData = serializeColorCycleDataFromResolvedLayer;
