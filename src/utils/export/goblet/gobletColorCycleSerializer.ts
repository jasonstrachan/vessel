import { debugLog, debugWarn } from '@/utils/debug';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { normalizeGradientSeamProfile, type GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import { MAX_BRUSH_COLOR_CYCLE_SPEED, MAX_CC_LAYER_SPEED_SCALE, MIN_BRUSH_COLOR_CYCLE_SPEED, MIN_CC_LAYER_SPEED_SCALE } from '@/constants/colorCycle';
import { decodeColorCycleSpeedByte, encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';
import { resolveLayerColorCycleBaseSpeed } from '@/utils/colorCycleLayerSpeed';
import { packArrayToB64Z } from '@/utils/export/b64z';
import { ccLog, ccSample } from '@/utils/colorCycle/ccDebug';
import { deriveForegroundGradientStops } from '@/utils/colorCycleGradients';
import { captureCanvasImageData } from '@/utils/canvas/canvasImage';
import { normalizeColorCycleLayerDocumentState } from '@/lib/colorCycle/documentState';
import { posInt, toNum } from '@/utils/num';
import type { Layer, Project } from '@/types';
import { clampRectToDocument as clampBoundsToDocument, scaleMaskBoundsToDocument, type Size2D as CoverageSize } from '@/utils/export/colorCycleBounds';
import { getLayerSurfaceSize } from '@/utils/export/goblet/gobletLayerSerializer';
import type { BrushStateRuntimePayload, ColorCycleCoverageResult, ColorCycleMaskDataset, ColorCycleSerializationResult, SerializedAlphaMaskResult, SerializedGradientStops, SerializedSlotPalette, WebGLExportMetadata, WebGLLayerBounds, WebGLSerializedBrushState, WebGLSerializedColorCycle } from '@/utils/export/goblet/gobletTypes';

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

const normalizeBrushFlowDirection = (direction: unknown): 'forward' | 'reverse' | 'pingpong' | undefined => {
  if (typeof direction !== 'string') {
    return undefined;
  }

  const trimmed = direction.trim().toLowerCase();
  if (trimmed === 'forward') {
    return 'forward';
  }
  if (trimmed === 'reverse' || trimmed === 'backward') {
    return 'reverse';
  }
  if (trimmed === 'pingpong' || trimmed === 'ping-pong' || trimmed === 'bounce') {
    return 'pingpong';
  }

  return undefined;
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


const detectFlowDirectionFromAnimator = (animator: unknown): 'forward' | 'reverse' | 'pingpong' | undefined => {
  if (!animator || typeof animator !== 'object') {
    return undefined;
  }

  const animatorAny = animator as {
    getFlowMode?: () => unknown;
    getFlowDirection?: () => unknown;
    flowMode?: unknown;
    flowDirection?: unknown;
    animationController?: {
      getMode?: () => unknown;
      getDirection?: () => unknown;
      flowMode?: unknown;
      flowDirection?: unknown;
    };
  };

  if (typeof animatorAny.getFlowMode === 'function') {
    try {
      const detected = normalizeBrushFlowDirection(animatorAny.getFlowMode());
      if (detected) {
        return detected;
      }
    } catch (error) {
      debugLog('raw-console', '[webglExporter] Failed to read flow mode via animator.getFlowMode()', error);
    }
  }

  if (typeof animatorAny.getFlowDirection === 'function') {
    try {
      const detected = normalizeBrushFlowDirection(animatorAny.getFlowDirection());
      if (detected) {
        return detected;
      }
    } catch (error) {
      debugLog('raw-console', '[webglExporter] Failed to read flow direction via animator.getFlowDirection()', error);
    }
  }

  const modeDirect = normalizeBrushFlowDirection(animatorAny.flowMode);
  if (modeDirect) {
    return modeDirect;
  }

  const direct = normalizeBrushFlowDirection(animatorAny.flowDirection);
  if (direct) {
    return direct;
  }

  const controller = animatorAny.animationController;
  if (controller) {
    if (typeof controller.getMode === 'function') {
      try {
        const detected = normalizeBrushFlowDirection(controller.getMode());
        if (detected) {
          return detected;
        }
      } catch (error) {
        debugLog('raw-console', '[webglExporter] Failed to read flow mode via animationController.getMode()', error);
      }
    }

    if (typeof controller.getDirection === 'function') {
      try {
        const detected = normalizeBrushFlowDirection(controller.getDirection());
        if (detected) {
          return detected;
        }
      } catch (error) {
        debugLog('raw-console', '[webglExporter] Failed to read flow direction via animationController.getDirection()', error);
      }
    }

    const controllerModeDirect = normalizeBrushFlowDirection(controller.flowMode);
    if (controllerModeDirect) {
      return controllerModeDirect;
    }

    const controllerDirect = normalizeBrushFlowDirection(controller.flowDirection);
    if (controllerDirect) {
      return controllerDirect;
    }
  }

  return undefined;
};

const detectBrushFlowDirection = (brush: unknown, layerId: string): 'forward' | 'reverse' | 'pingpong' | undefined => {
  if (!brush || typeof brush !== 'object') {
    return undefined;
  }

  const brushAny = brush as {
    flowMode?: unknown;
    flowDirection?: unknown;
    getFlowDirection?: () => unknown;
    getFlowMode?: () => unknown;
    animators?: Map<string, unknown> | {
      get?: (key: string) => unknown;
      size?: number;
      values?: () => Iterable<unknown>;
    };
  };

  const modeDirect = normalizeBrushFlowDirection(brushAny.flowMode);
  if (modeDirect) {
    return modeDirect;
  }

  const direct = normalizeBrushFlowDirection(brushAny.flowDirection);
  if (direct) {
    return direct;
  }

  if (typeof brushAny.getFlowMode === 'function') {
    try {
      const detected = normalizeBrushFlowDirection(brushAny.getFlowMode());
      if (detected) {
        return detected;
      }
    } catch (error) {
      debugLog('raw-console', '[webglExporter] Failed to read brush flow mode via getFlowMode()', error);
    }
  }

  if (typeof brushAny.getFlowDirection === 'function') {
    try {
      const detected = normalizeBrushFlowDirection(brushAny.getFlowDirection());
      if (detected) {
        return detected;
      }
    } catch (error) {
      debugLog('raw-console', '[webglExporter] Failed to read brush flow direction via getFlowDirection()', error);
    }
  }

  const { animators } = brushAny;
  if (!animators || typeof animators !== 'object') {
    return undefined;
  }

  try {
    if (animators instanceof Map) {
      let animator = animators.get(layerId);
      if (!animator && animators.size === 1) {
        animator = Array.from(animators.values())[0];
      }
      const detected = detectFlowDirectionFromAnimator(animator);
      if (detected) {
        return detected;
      }
    } else if (typeof (animators as { get?: (key: string) => unknown }).get === 'function') {
      const mapLike = animators as {
        get: (key: string) => unknown;
        size?: number;
        values?: () => Iterable<unknown>;
      };
      let animator = mapLike.get(layerId);
      if (!animator && typeof mapLike.size === 'number' && mapLike.size === 1 && typeof mapLike.values === 'function') {
        const iterator = mapLike.values();
        const first = iterator && iterator[Symbol.iterator] ? iterator[Symbol.iterator]().next() : undefined;
        animator = first && !first.done ? first.value : animator;
      }
      const detected = detectFlowDirectionFromAnimator(animator);
      if (detected) {
        return detected;
      }
    }
  } catch (error) {
    debugLog('raw-console', '[webglExporter] Failed to inspect brush animators for flow direction', error);
  }

  return undefined;
};


const toSerializableGradientStops = (
  stops: Array<{ position?: number; color?: string }> | undefined,
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
      return { position, color };
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

const normalizeIndexBufferValues = (source: unknown, visited: Set<unknown> = new Set()): number[] => {
  if (source == null) {
    return [];
  }

  const isObjectLike = typeof source === 'object' || typeof source === 'function';
  if (isObjectLike) {
    if (visited.has(source)) {
      return [];
    }
    visited.add(source);
  }

  if (Array.isArray(source)) {
    const values: number[] = [];
    for (const value of source) {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(numeric)) {
        values.push(numeric);
      }
    }
    return values;
  }

  if (source instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(source));
  }

  if (ArrayBuffer.isView(source)) {
    const view = source as unknown as ArrayLike<number> & { length?: number };
    if (typeof view.length === 'number') {
      const values: number[] = new Array(view.length);
      for (let index = 0; index < view.length; index += 1) {
        const raw = view[index];
        values[index] = Number(raw);
      }
      return values;
    }
  }

  const iterator = (source as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  if (typeof iterator === 'function') {
    try {
      const values: number[] = [];
      for (const value of source as Iterable<unknown>) {
        const numeric = typeof value === 'number' ? value : Number(value);
        if (Number.isFinite(numeric)) {
          values.push(numeric);
        }
      }
      if (values.length > 0) {
        return values;
      }
    } catch {
      // Ignore iterator conversion failures and continue falling back to nested inspection.
    }
  }

  if (isObjectLike) {
    const record = source as Record<string, unknown>;
    const nestedCandidates = ['data', 'values', 'buffer', 'array', 'indexBuffer'] as const;
    for (const key of nestedCandidates) {
      if (key in record) {
        const nested = record[key];
        if (nested && nested !== source) {
          const extracted = normalizeIndexBufferValues(nested, visited);
          if (extracted.length > 0) {
            return extracted;
          }
        }
      }
    }
  }

  return toSerializableNumberArray(source);
};

const decodePersistedNumericBuffer = (source: unknown): number[] => {
  if (typeof source === 'string') {
    return Array.from(decodeBase64Bytes(source));
  }
  return toSerializableNumberArray(source);
};

const decodePersistedDefIdBuffer = (source: unknown): number[] => {
  if (!source) {
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

const isByteRangeArray = (values: number[]): boolean => {
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value) || value < 0 || value > 255) {
      return false;
    }
  }
  return true;
};

type NumericArrayInput = Uint8Array | number[] | string | null | undefined;

const packNumericArrayForExport = async (input: NumericArrayInput): Promise<number[] | string | undefined> => {
  if (!input) {
    return undefined;
  }

  if (typeof input === 'string') {
    return input;
  }

  if (Array.isArray(input)) {
    if (input.length === 0) {
      return [];
    }
    if (!isByteRangeArray(input)) {
      return [...input];
    }
    const packed = await packArrayToB64Z(input);
    if (packed) {
      return packed;
    }
    return [...input];
  }

  if (input.length === 0) {
    return [];
  }

  const packed = await packArrayToB64Z(input);
  if (packed) {
    return packed;
  }
  return Array.from(input);
};

export const summarizeEncodedBuffer = (
  payload: number[] | string | undefined,
  fallbackLength: number
): {
  encoding: 'array' | 'b64z' | 'none';
  length: number | null;
  preview: number[] | string;
} => {
  if (!payload) {
    return { encoding: 'none', length: null, preview: 'none' };
  }

  if (Array.isArray(payload)) {
    return {
      encoding: 'array',
      length: payload.length,
      preview: payload.slice(0, 16)
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

const stripFlowBitsFromGradientIds = (
  input: number[] | Uint8Array | undefined
): number[] | Uint8Array | undefined => {
  if (!input || input.length === 0) {
    return input;
  }

  let needsStrip = false;
  for (let i = 0; i < input.length; i += 1) {
    const value = input[i] as number;
    if (value > FLOW_SLOT_MASK) {
      needsStrip = true;
      break;
    }
  }

  if (!needsStrip) {
    return input;
  }

  const stripped = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    stripped[i] = (input[i] as number) & FLOW_SLOT_MASK;
  }
  return stripped;
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
    return applyExportPlaybackScale(layerBaseSpeed, layerSpeedScale);
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
  if (toolSpeed !== null) {
    return applyExportPlaybackScale(toolSpeed, layerSpeedScale);
  }
  const layerSpeed = toFiniteNumberOrNull(resolveLayerColorCycleBaseSpeed(layer.colorCycleData));
  return layerSpeed !== null
    ? applyExportPlaybackScale(layerSpeed, layerSpeedScale)
    : null;
};

const collectUsedSlots = (
  gradientIds: number[],
  indices?: number[]
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

const detectSlotSpeedConflicts = (
  gradientIds: number[],
  speedBuffer: number[],
  indices?: number[]
): boolean => {
  const length = Math.min(gradientIds.length, speedBuffer.length, indices?.length ?? gradientIds.length);
  const speedBySlot = new Map<number, number>();
  for (let i = 0; i < length; i += 1) {
    if (indices && indices[i] === 0) {
      continue;
    }
    const speedByte = speedBuffer[i] | 0;
    if (speedByte <= 0) {
      continue;
    }
    const slot = (gradientIds[i] ?? 0) & FLOW_SLOT_MASK;
    const existing = speedBySlot.get(slot);
    if (existing !== undefined && existing !== speedByte) {
      return true;
    }
    speedBySlot.set(slot, speedByte);
  }
  return false;
};

const buildSpeedBufferFromSlots = (params: {
  gradientIds: number[];
  indices?: number[];
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

const prepareBrushSpeedExport = (params: {
  layer: Layer;
  brushState: WebGLSerializedBrushState;
  warnOnce: () => void;
  forceBuffer?: boolean;
  layerSpeedScale: number;
  fallbackToolSpeed?: number | null;
}): {
  speedMode?: 'slot' | 'buffer';
  slotSpeeds?: Array<{ slot: number; speed: number }>;
  speedBufferOverride?: number[];
} | null => {
  const gradientIds = Array.isArray(params.brushState.gradientIdBuffer)
    ? params.brushState.gradientIdBuffer
    : null;
  if (!gradientIds || gradientIds.length === 0) {
    return null;
  }

  const indices = Array.isArray(params.brushState.indexBuffer) ? params.brushState.indexBuffer : undefined;
  const usedSlots = collectUsedSlots(gradientIds, indices);
  if (usedSlots.size === 0) {
    return null;
  }

  const rawSpeedBySlot = resolveSlotSpeedMap(params.layer.colorCycleData);
  const speedBySlot = new Map<number, number>();
  rawSpeedBySlot.forEach((speed, slot) => {
    speedBySlot.set(slot, (speed ?? 0) * params.layerSpeedScale);
  });
  const fallbackSpeed = resolveExportToolSpeed(params.layer, params.layerSpeedScale, params.fallbackToolSpeed);
  const speedBufferValues = Array.isArray(params.brushState.speedBuffer)
    ? params.brushState.speedBuffer
    : null;

  const hasConflict = speedBufferValues
    ? detectSlotSpeedConflicts(gradientIds, speedBufferValues, indices)
    : false;
  const shouldUseBuffer = params.forceBuffer || usedSlots.size > SPEED_SLOT_LIMIT || hasConflict;

  if (shouldUseBuffer) {
    const speedBufferOverride = speedBufferValues && speedBufferValues.length > 0
      ? scaleEncodedSpeedBuffer(speedBufferValues, params.layerSpeedScale)
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
    };
  }

  const slotSpeeds: Array<{ slot: number; speed: number }> = [];
  usedSlots.forEach((slot) => {
    const speed = speedBySlot.get(slot);
    if (Number.isFinite(speed)) {
      slotSpeeds.push({ slot, speed: speed as number });
      return;
    }
    params.warnOnce();
    if (Number.isFinite(fallbackSpeed)) {
      slotSpeeds.push({ slot, speed: fallbackSpeed as number });
    }
  });

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

  const gradientIds = Array.isArray(brushState.gradientIdBuffer) ? brushState.gradientIdBuffer : null;
  const defIds = Array.isArray(brushState.gradientDefIdBuffer)
    ? brushState.gradientDefIdBuffer
    : decodePersistedDefIdBuffer(data.gradientDefIdBuffer);
  const indices = Array.isArray(brushState.indexBuffer) ? brushState.indexBuffer : undefined;
  const defs = data.gradientDefStore ?? [];

  if (!gradientIds || gradientIds.length === 0 || defIds.length === 0 || defs.length === 0) {
    return params.slotPalettes;
  }

  const seamProfilesBySlot = new Map<number, GradientSeamProfile>();
  defs.forEach((entry) => {
    if (typeof entry.slot === 'number') {
      seamProfilesBySlot.set(entry.slot, normalizeGradientSeamProfile(entry.seamProfile));
    }
  });
  const resolved = [...(params.slotPalettes ?? [])].map((entry) => ({
    ...entry,
    seamProfile: entry.seamProfile ?? seamProfilesBySlot.get(entry.slot),
  }));
  const existingSlots = new Set(resolved.map((entry) => entry.slot));
  const missingUsedSlots = [...collectUsedSlots(gradientIds, indices)].filter((slot) => !existingSlots.has(slot));
  if (missingUsedSlots.length === 0) {
    return resolved;
  }

  const missingSet = new Set(missingUsedSlots);
  const defCountsBySlot = new Map<number, Map<number, number>>();
  const length = Math.min(gradientIds.length, defIds.length, indices?.length ?? gradientIds.length);
  for (let index = 0; index < length; index += 1) {
    if (indices && indices[index] === 0) {
      continue;
    }
    const slot = (gradientIds[index] ?? 0) & FLOW_SLOT_MASK;
    if (!missingSet.has(slot)) {
      continue;
    }
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

  for (const slot of missingUsedSlots) {
    const counts = defCountsBySlot.get(slot);
    if (!counts || counts.size === 0) {
      continue;
    }
    const [defId] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!Number.isFinite(defId)) {
      continue;
    }
    const def = defs.find((entry) => entry.id === defId);
    if (!def?.stops?.length) {
      continue;
    }
    resolved.push({
      slot,
      stops: toSerializableGradientStops(def.stops, []),
      seamProfile: normalizeGradientSeamProfile(def.seamProfile),
    });
  }

  return resolved;
};

const resolveExportSlotPalettes = (
  data: Layer['colorCycleData'] | undefined,
  brushState?: WebGLSerializedBrushState
): SerializedSlotPalette[] | undefined => {
  if (!data) {
    return undefined;
  }

  let slotPalettes = data.slotPalettes?.length
      ? data.slotPalettes.map((entry) => ({
          slot: entry.slot,
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

const extractBrushStateFromBrushProperties = (brush: unknown, layer: Layer): WebGLSerializedBrushState | undefined => {
  const brushAny = brush as Record<string, unknown>;
  const rawIndexSource = brushAny?.indexBuffer ?? brushAny?.indices ?? brushAny?.data;
  const indexBuffer = normalizeIndexBufferValues(rawIndexSource);
  if (indexBuffer.length === 0) {
    return undefined;
  }

  const dimensionSource = typeof brushAny?.dimensions === 'object' && brushAny.dimensions
    ? brushAny.dimensions as Record<string, unknown>
    : undefined;
  const gradientIdSource =
    brushAny?.gradientIdBuffer
    ?? brushAny?.gradientId
    ?? (rawIndexSource as { gradientId?: unknown } | undefined)?.gradientId
    ?? (dimensionSource as { gradientIdBuffer?: unknown } | undefined)?.gradientIdBuffer;
  const gradientIdBuffer = toSerializableNumberArray(gradientIdSource);
  const speedSource =
    brushAny?.speedBuffer
    ?? (rawIndexSource as { speedData?: unknown } | undefined)?.speedData
    ?? (dimensionSource as { speedBuffer?: unknown } | undefined)?.speedBuffer;
  const speedBuffer = toSerializableNumberArray(speedSource);

  const widthRaw = Number(
    brushAny?.width
    ?? dimensionSource?.width
    ?? layer.imageData?.width
    ?? layer.colorCycleData?.canvas?.width
    ?? 0
  );
  const heightRaw = Number(
    brushAny?.height
    ?? dimensionSource?.height
    ?? layer.imageData?.height
    ?? layer.colorCycleData?.canvas?.height
    ?? 0
  );
  const width = Math.max(1, Math.round(Number.isFinite(widthRaw) ? widthRaw : 1));
  const height = Math.max(1, Math.round(Number.isFinite(heightRaw) ? heightRaw : 1));

  const gradientStops = toSerializableGradientStops(
    (brushAny?.gradientStops as Array<{ position?: number; color?: string }>)
      ?? (dimensionSource?.gradientStops as Array<{ position?: number; color?: string }>)
      ?? (layer.colorCycleData?.gradient ?? []),
    layer.colorCycleData?.gradient ?? []
  );

  const brushState: WebGLSerializedBrushState = {
    width,
    height,
    indexBuffer,
    gradientIdBuffer: gradientIdBuffer.length > 0 ? gradientIdBuffer : undefined,
    speedBuffer: speedBuffer.length > 0 ? speedBuffer : undefined,
    gradientStops,
    animationOffset: 0
  };

  const flowDirection = detectBrushFlowDirection(brush, layer.id);
  if (flowDirection) {
    brushState.flowDirection = flowDirection;
  }

  if (gobletDiagnosticsActive) {
    gobletDebugLog('[webglExporter] Created brush state from direct properties', {
      layerId: layer.id,
      width,
      height,
      indices: indexBuffer.length,
      gradientStops: gradientStops.length
    });
  }

  return brushState;
};

const extractBrushStateFromAnimator = (brush: unknown, layer: Layer): WebGLSerializedBrushState | undefined => {
  const brushAny = brush as Record<string, unknown>;
  const animators = brushAny?.animators as Map<string, unknown> | undefined;
  if (!animators || typeof animators.get !== 'function') {
    return undefined;
  }

  const keys = animators instanceof Map ? Array.from(animators.keys()) : [];
  ccLog('extractBrushStateFromAnimator.animators', { want: layer.id, keys });

  let animator = animators.get(layer.id);
  if (!animator) {
    animator = animators.get('default');
  }
  if (!animator && animators.size === 1) {
    animator = Array.from(animators.values())[0];
  }
  if (!animator) {
    return undefined;
  }

  ccLog('extractBrushStateFromAnimator.use', { used: (animator as { layerId?: string }).layerId ?? 'unknown' });

  try {
    const animatorAny = animator as {
      serialize?: () => unknown;
      indexBuffer?: { serialize?: () => unknown; getDirectData?: () => Uint8Array; width?: number; height?: number; palette?: string[] };
      getCanvas?: () => HTMLCanvasElement;
    };

    const serialized = typeof animatorAny.serialize === 'function'
      ? animatorAny.serialize() as {
          indexBuffer?: { width?: number; height?: number; data?: Uint8Array | number[]; palette?: string[] };
          gradient?: { gradientStops?: Array<{ position?: number; color?: string }> };
          animation?: { offset?: number; stats?: { targetFPS?: number } };
        }
      : undefined;

    let indexBuffer = serialized?.indexBuffer as {
      width?: number;
      height?: number;
      data?: Uint8Array | number[];
      palette?: string[];
      gradientId?: Uint8Array | number[];
      speedData?: Uint8Array | number[];
    } | undefined;
    if ((!indexBuffer || !indexBuffer.data) && animatorAny.indexBuffer) {
      try {
        const fromIndexBuffer = typeof animatorAny.indexBuffer.serialize === 'function'
          ? animatorAny.indexBuffer.serialize() as {
              width?: number;
              height?: number;
              data?: Uint8Array | number[];
              palette?: string[];
              gradientId?: Uint8Array | number[];
              speedData?: Uint8Array | number[];
            }
          : undefined;
        if (fromIndexBuffer?.data) {
          indexBuffer = fromIndexBuffer;
        } else if (typeof animatorAny.indexBuffer.getDirectData === 'function') {
        const directData = animatorAny.indexBuffer.getDirectData();
        indexBuffer = {
          width: animatorAny.indexBuffer.width,
          height: animatorAny.indexBuffer.height,
          data: directData,
          palette: animatorAny.indexBuffer.palette,
          speedData: (animatorAny.indexBuffer as { getDirectSpeedData?: () => Uint8Array }).getDirectSpeedData?.()
        } as {
          width?: number;
          height?: number;
          data?: Uint8Array;
          palette?: string[];
          gradientId?: Uint8Array | number[];
          speedData?: Uint8Array | number[];
        };
        }
      } catch (error) {
        debugWarn('raw-console', '[webglExporter] Failed to read animator index buffer directly for layer', layer.id, error);
      }
    }

    if (!indexBuffer?.data) {
      return undefined;
    }

    const widthRaw = Number(indexBuffer.width ?? (animatorAny as { width?: number }).width ?? layer.imageData?.width ?? layer.colorCycleData?.canvas?.width);
    const heightRaw = Number(indexBuffer.height ?? (animatorAny as { height?: number }).height ?? layer.imageData?.height ?? layer.colorCycleData?.canvas?.height);

    const width = Math.max(1, Math.round(Number.isFinite(widthRaw) ? widthRaw : 0));
    const height = Math.max(1, Math.round(Number.isFinite(heightRaw) ? heightRaw : 0));

    const gradientStops = toSerializableGradientStops(
      serialized?.gradient?.gradientStops as Array<{ position?: number; color?: string }> | undefined,
      toSerializableGradientStops((brushAny.currentGradientStops as Array<{ position?: number; color?: string }>) ?? [], layer.colorCycleData?.gradient ?? [])
    );

    const animationOffset = typeof serialized?.animation?.offset === 'number' ? serialized.animation.offset : 0;
    const targetFPS = typeof serialized?.animation?.stats?.targetFPS === 'number'
      ? serialized.animation.stats.targetFPS
      : undefined;

    const indexBufferData = normalizeIndexBufferValues(indexBuffer.data);
    if (indexBufferData.length === 0) {
      debugWarn('raw-console', '[webglExporter] Animator fallback produced an empty index buffer for layer', layer.id);
      return undefined;
    }

    ccLog('extractBrushStateFromAnimator.index', {
      w: widthRaw,
      h: heightRaw,
      len: indexBufferData.length,
      sample: ccSample(indexBufferData, 12)
    });

    const paletteValues = indexBuffer.palette ? toSerializablePaletteArray(indexBuffer.palette) : undefined;
    const gradientIdValues = toSerializableNumberArray(indexBuffer.gradientId);
    const gradientIdBuffer = gradientIdValues.length > 0 ? gradientIdValues : undefined;
    const gradientDefIdBuffer = decodePersistedDefIdBuffer(layer.colorCycleData?.gradientDefIdBuffer);
    const speedValues = toSerializableNumberArray(indexBuffer.speedData);
    const speedBuffer = speedValues.length > 0 ? speedValues : undefined;
    const palette = paletteValues && paletteValues.length > 0 ? paletteValues : undefined;

    if (gobletDiagnosticsActive) {
      gobletDebugLog('[webglExporter] Animator-derived index buffer', {
        layerId: layer.id,
        width,
        height,
        paletteSize: palette?.length ?? null,
        dataSample: indexBufferData.slice(0, 16)
      });
    }

    const brushState: WebGLSerializedBrushState = {
      width,
      height,
      indexBuffer: indexBufferData,
      gradientIdBuffer,
      gradientDefIdBuffer: gradientDefIdBuffer.length > 0 ? gradientDefIdBuffer : undefined,
      speedBuffer,
      gradientStops,
      palette,
      animationOffset,
      targetFPS
    };

    const flowDirection = detectFlowDirectionFromAnimator(animator)
      ?? detectBrushFlowDirection(brush, layer.id);
    if (flowDirection) {
      brushState.flowDirection = flowDirection;
    }

    if (gobletDiagnosticsActive) {
      gobletDebugLog('[webglExporter] Brush state extracted from animator fallback', {
        layerId: layer.id,
        width,
        height,
        indices: indexBufferData.length,
        paletteSize: palette?.length ?? null,
        targetFPS,
        hasFlowDirection: Boolean(brushState.flowDirection)
      });
    }

    return brushState;
  } catch (error) {
    debugWarn('raw-console', '[webglExporter] Failed to extract brush state from animator for layer', layer.id, error);
    return undefined;
  }
};

export const extractBrushStateFromSavedSnapshot = (layer: Layer): WebGLSerializedBrushState | undefined => {
  const savedState = layer.colorCycleData?.brushState as {
    cycleSpeed?: unknown;
    fps?: unknown;
    layers?: Array<{
      layerId?: string;
      animator?: {
        indexBuffer?: {
          width?: unknown;
          height?: unknown;
          data?: unknown;
          gradientId?: unknown;
          speedData?: unknown;
          palette?: unknown;
        };
        gradient?: {
          gradientStops?: Array<{ position?: number; color?: string }>;
        };
        animation?: {
          offset?: unknown;
          stats?: {
            targetFPS?: unknown;
          };
        };
      };
      strokeData?: {
        paintBuffer?: unknown;
        gradientIdBuffer?: unknown;
        speedBuffer?: unknown;
      };
    }>;
  } | undefined;

  if (!savedState?.layers?.length) {
    return undefined;
  }

  const entry = savedState.layers.find((candidate) => candidate?.layerId === layer.id) ?? savedState.layers[0];
  if (!entry) {
    return undefined;
  }

  const animatorIndexBuffer = entry.animator?.indexBuffer;
  const strokeData = entry.strokeData;
  const indexBuffer = normalizeIndexBufferValues(animatorIndexBuffer?.data);
  const normalizedIndexBuffer = indexBuffer.length > 0
    ? indexBuffer
    : decodePersistedNumericBuffer(strokeData?.paintBuffer);
  if (normalizedIndexBuffer.length === 0) {
    return undefined;
  }

  const width = Math.max(
    1,
    Math.round(
      Number.isFinite(Number(animatorIndexBuffer?.width))
        ? Number(animatorIndexBuffer?.width)
        : (layer.imageData?.width ?? layer.colorCycleData?.canvas?.width ?? layer.colorCycleData?.canvasWidth ?? 1)
    )
  );
  const height = Math.max(
    1,
    Math.round(
      Number.isFinite(Number(animatorIndexBuffer?.height))
        ? Number(animatorIndexBuffer?.height)
        : (layer.imageData?.height ?? layer.colorCycleData?.canvas?.height ?? layer.colorCycleData?.canvasHeight ?? 1)
    )
  );

  const gradientIdBuffer = decodePersistedNumericBuffer(animatorIndexBuffer?.gradientId);
  const fallbackGradientIdBuffer = gradientIdBuffer.length > 0
    ? gradientIdBuffer
    : decodePersistedNumericBuffer(strokeData?.gradientIdBuffer);
  const fallbackGradientDefIdBuffer = decodePersistedDefIdBuffer(layer.colorCycleData?.gradientDefIdBuffer);
  const speedBuffer = decodePersistedNumericBuffer(animatorIndexBuffer?.speedData);
  const fallbackSpeedBuffer = speedBuffer.length > 0
    ? speedBuffer
    : decodePersistedNumericBuffer(strokeData?.speedBuffer);
  const paletteValues = animatorIndexBuffer?.palette
    ? toSerializablePaletteArray(animatorIndexBuffer.palette)
    : undefined;
  const gradientStops = toSerializableGradientStops(
    entry.animator?.gradient?.gradientStops,
    layer.colorCycleData?.gradient ?? []
  );
  const animationOffset = Number.isFinite(Number(entry.animator?.animation?.offset))
    ? Number(entry.animator?.animation?.offset)
    : 0;
  const targetFPS = Number.isFinite(Number(entry.animator?.animation?.stats?.targetFPS))
    ? Number(entry.animator?.animation?.stats?.targetFPS)
    : (Number.isFinite(Number(savedState.fps)) ? Number(savedState.fps) : undefined);
  const animationSpeed = Number.isFinite(Number(savedState.cycleSpeed))
    ? Number(savedState.cycleSpeed)
    : undefined;

  return {
    width,
    height,
    indexBuffer: normalizedIndexBuffer,
    gradientIdBuffer: fallbackGradientIdBuffer.length > 0 ? fallbackGradientIdBuffer : undefined,
    gradientDefIdBuffer: fallbackGradientDefIdBuffer.length > 0 ? fallbackGradientDefIdBuffer : undefined,
    speedBuffer: fallbackSpeedBuffer.length > 0 ? fallbackSpeedBuffer : undefined,
    gradientStops,
    palette: paletteValues && paletteValues.length > 0 ? paletteValues : undefined,
    animationOffset,
    targetFPS,
    animationSpeed,
    alphaMode: 'opaque-indices'
  };
};

const extractBrushStateFromDocumentState = (layer: Layer): WebGLSerializedBrushState | undefined => {
  const result = normalizeColorCycleLayerDocumentState(layer, {
    fallbackWidth: layer.imageData?.width ?? layer.colorCycleData?.canvasWidth ?? layer.colorCycleData?.canvas?.width,
    fallbackHeight: layer.imageData?.height ?? layer.colorCycleData?.canvasHeight ?? layer.colorCycleData?.canvas?.height,
  });
  if (!result.ok) {
    return undefined;
  }

  const { state } = result;
  const indexBuffer = decodePersistedNumericBuffer(state.paintBuffer);
  if (indexBuffer.length === 0) {
    return undefined;
  }

  const gradientIdBuffer = decodePersistedNumericBuffer(state.gradientIdBuffer);
  const gradientDefIdBuffer = decodePersistedDefIdBuffer(state.gradientDefIdBuffer);
  const speedBuffer = decodePersistedNumericBuffer(state.speedBuffer);
  const flowBuffer = decodePersistedNumericBuffer(state.flowBuffer);
  const phaseBuffer = decodePersistedNumericBuffer(state.phaseBuffer);
  const gradientStops = toSerializableGradientStops(
    state.slotPalettes?.[0]?.stops,
    layer.colorCycleData?.gradient ?? [],
  );

  return {
    width: state.width,
    height: state.height,
    indexBuffer,
    gradientIdBuffer: gradientIdBuffer.length > 0 ? gradientIdBuffer : undefined,
    gradientDefIdBuffer: gradientDefIdBuffer.length > 0 ? gradientDefIdBuffer : undefined,
    speedBuffer: speedBuffer.length > 0 ? speedBuffer : undefined,
    flowBuffer: flowBuffer.length > 0 ? flowBuffer : undefined,
    phaseBuffer: phaseBuffer.length > 0 ? phaseBuffer : undefined,
    gradientStops,
    animationOffset: 0,
    animationSpeed: resolveLayerColorCycleBaseSpeed(layer.colorCycleData),
    alphaMode: 'opaque-indices',
  };
};

let cachedBrushManager: Pick<ColorCycleBrushManager, 'getBrush'> | null = null;

const getBrushManagerInstance = (): Pick<ColorCycleBrushManager, 'getBrush'> | null => {
  if (cachedBrushManager) {
    return cachedBrushManager;
  }

  try {
    cachedBrushManager = getColorCycleBrushManager();
    return cachedBrushManager;
  } catch (error) {
    debugLog('raw-console', '[webglExporter] Unable to load color cycle brush manager', error);
    cachedBrushManager = null;
  }

  return null;
};

const resolveColorCycleBrushInstance = (layer: Layer): { serialize?: () => unknown } | undefined => {
  const directBrush = layer.colorCycleData?.colorCycleBrush as { serialize?: () => unknown } | undefined;
  if (directBrush && typeof directBrush.serialize === 'function') {
    return directBrush;
  }

  try {
    const manager = getBrushManagerInstance();
    if (manager?.getBrush) {
      const managedBrush = manager.getBrush(layer.id) as { serialize?: () => unknown } | undefined;
      if (managedBrush && typeof managedBrush.serialize === 'function') {
        return managedBrush;
      }
    }
  } catch (error) {
    debugLog('raw-console', '[webglExporter] Failed to resolve color cycle brush via manager', error);
  }

  return directBrush;
};

export const serializeBrushState = (layer: Layer): WebGLSerializedBrushState | undefined => {
  const brush = resolveColorCycleBrushInstance(layer);

  if (brush?.serialize) {
    try {
      const raw = brush.serialize() as {
      layers?: Array<{
        layerId?: string;
        data?: {
          indexBuffer?: {
            width?: number;
            height?: number;
            data?: Uint8Array | number[];
            palette?: string[];
            gradientId?: Uint8Array | number[];
          };
          gradient?: { gradientStops?: Array<{ position?: number; color?: string }> };
          animation?: {
            offset?: number;
            stats?: { targetFPS?: number };
          };
        };
        strokeData?: {
          paintBuffer?: unknown;
          gradientIdBuffer?: unknown;
          gradientDefIdBuffer?: unknown;
          speedBuffer?: unknown;
        };
      }>;
      } | undefined;

      ccLog('serializeBrushState.raw', {
        layerId: layer.id,
        rawLayers: raw?.layers?.map((entry) => ({
          id: entry?.layerId ?? null,
          w: entry?.data?.indexBuffer?.width ?? null,
          h: entry?.data?.indexBuffer?.height ?? null,
          len: (entry?.data?.indexBuffer?.data as { length?: number } | undefined)?.length ?? null
        })) ?? null
      });

      if (raw?.layers && raw.layers.length > 0) {
        const directMatch = raw.layers.find((candidate) => candidate?.layerId === layer.id);

      type FallbackReason = 'default' | 'single' | 'dimensions' | 'density';
      let fallbackReason: FallbackReason | undefined;
      let entry = directMatch;

      if (!entry) {
        const defaultMatch = raw.layers.find((candidate) => candidate?.layerId === 'default');
        if (defaultMatch) {
          entry = defaultMatch;
          fallbackReason = 'default';
        } else if (raw.layers.length === 1) {
          entry = raw.layers[0];
          fallbackReason = 'single';
        }
      }

      if (!entry) {
        const toFiniteNumber = (value: unknown): number | undefined => {
          if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
          }
          return undefined;
        };
        const resolveDimension = (...values: Array<unknown>): number | undefined => {
          for (const value of values) {
            const numeric = toFiniteNumber(value);
            if (numeric !== undefined) {
              return numeric;
            }
          }
          return undefined;
        };
        const approx = (a?: number, b?: number) => {
          if (typeof a !== 'number' || typeof b !== 'number') {
            return false;
          }
          return Math.abs(a - b) <= 2;
        };

        const lw = resolveDimension(
          layer.imageData?.width,
          layer.colorCycleData?.canvas?.width,
          (layer.framebuffer as HTMLCanvasElement | OffscreenCanvas | undefined)?.width
        );
        const lh = resolveDimension(
          layer.imageData?.height,
          layer.colorCycleData?.canvas?.height,
          (layer.framebuffer as HTMLCanvasElement | OffscreenCanvas | undefined)?.height
        );

        entry = raw.layers.find((candidate) => {
          if (!candidate) {
            return false;
          }
          const width = resolveDimension(candidate?.data?.indexBuffer?.width);
          const height = resolveDimension(candidate?.data?.indexBuffer?.height);
          return approx(width, lw) && approx(height, lh);
        });

        if (entry) {
          fallbackReason = 'dimensions';
          ccLog('serializeBrushState.dimFallback', {
            wanted: layer.id,
            wantedW: lw ?? null,
            wantedH: lh ?? null,
            picked: entry?.layerId ?? null
          });
        }
      }

      if (!entry) {
        const sorted = raw.layers
          .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
          .sort((a, b) => {
            const al = (a.data?.indexBuffer?.data as ArrayLike<number> | undefined)?.length ?? 0;
            const bl = (b.data?.indexBuffer?.data as ArrayLike<number> | undefined)?.length ?? 0;
            return bl - al;
          });
        entry = sorted[0];

        if (entry) {
          fallbackReason = 'density';
        }
      }

      if (!entry) {
        return undefined;
      }

      ccLog('serializeBrushState.pick', {
        wanted: layer.id,
        picked: entry?.layerId ?? null,
        reason: directMatch ? 'direct' : (fallbackReason ?? 'unknown')
      });

      if (!directMatch) {
        const reasonDescription = (() => {
          switch (fallbackReason) {
            case 'default':
              return 'default layerId match';
            case 'single':
              return 'single serialized layer';
            case 'dimensions':
              return 'dimension-based match';
            case 'density':
              return 'largest non-zero index buffer';
            default:
              return undefined;
          }
        })();
        debugWarn(
          'raw-console',
          '[webglExporter] Falling back to brush state from layerId',
          entry.layerId ?? 'unknown',
          'for layer',
          layer.id,
          reasonDescription ? `(${reasonDescription})` : ''
        );
      }

      if (entry) {
        const indexBuffer = entry.data?.indexBuffer;
        const strokeData = entry.strokeData;
        const widthRaw = Number(indexBuffer?.width);
        const heightRaw = Number(indexBuffer?.height);
        if (indexBuffer) {
          const ib = indexBuffer;
          const fallbackWidth = layer.imageData?.width ?? layer.colorCycleData?.canvas?.width ?? 1;
          const fallbackHeight = layer.imageData?.height ?? layer.colorCycleData?.canvas?.height ?? 1;

          if (ib.data) {
            if (gobletDiagnosticsActive) {
              const dataType = (ib.data as { constructor?: { name?: string } })?.constructor?.name ?? 'unknown';
              const sample = (() => {
                try {
                  const arrayLike = ib.data as ArrayLike<number>;
                  return Array.prototype.slice.call(arrayLike, 0, 16);
                } catch {
                  return 'unavailable';
                }
              })();
              gobletDebugLog('[webglExporter] Brush serialize() indexBuffer payload', {
                layerId: layer.id,
                width: ib.width,
                height: ib.height,
                dataType,
                dataLength: (ib.data as { length?: number })?.length ?? 0,
                sample
              });
            }

            let indexArray: number[] = [];
            try {
              indexArray = Array.from(ib.data as ArrayLike<number>);
            } catch (conversionError) {
              debugWarn('raw-console', '[webglExporter] Failed to convert indexBuffer data via Array.from; falling back to normalizeIndexBufferValues', conversionError);
              indexArray = normalizeIndexBufferValues(ib.data);
            }

            if (indexArray.length === 0) {
              indexArray = normalizeIndexBufferValues(ib.data);
            }

            if (indexArray.length === 0) {
              debugWarn('raw-console', `[webglExporter] Brush serialize() returned an empty index buffer for layer ${layer.id}`);
            } else {
              if (gobletDiagnosticsActive) {
                const totalLength = indexArray.length;
                const uniqueValues = new Set(indexArray);
                const firstNonZeroIndex = indexArray.findIndex((value) => value !== 0);
                gobletDebugLog('[webglExporter] Brush serialize() index analysis', {
                  layerId: layer.id,
                  totalLength,
                  nonZeroCount: indexArray.filter((value) => value !== 0).length,
                  uniqueValues: Array.from(uniqueValues).slice(0, 20),
                  firstNonZeroIndex,
                  startSample: indexArray.slice(0, 16),
                  endSample: indexArray.slice(totalLength > 16 ? totalLength - 16 : 0)
                });
              }

              const width = Math.max(1, Math.round(Number.isFinite(widthRaw) ? widthRaw : fallbackWidth));
              const height = Math.max(1, Math.round(Number.isFinite(heightRaw) ? heightRaw : fallbackHeight));
              const gradientStops = toSerializableGradientStops(
                entry.data?.gradient?.gradientStops as Array<{ position?: number; color?: string }> | undefined,
                layer.colorCycleData?.gradient ?? []
              );
              const gradientIdValues = toSerializableNumberArray(ib.gradientId);
              const gradientIdBuffer = gradientIdValues.length > 0 ? gradientIdValues : undefined;
              const speedValues = toSerializableNumberArray((ib as { speedData?: unknown }).speedData);
              const speedBuffer = speedValues.length > 0 ? speedValues : undefined;
              const animationOffset = typeof entry.data?.animation?.offset === 'number'
                ? entry.data.animation.offset
                : 0;
              const targetFPS = typeof entry.data?.animation?.stats?.targetFPS === 'number'
                ? entry.data.animation.stats.targetFPS
                : undefined;
              const paletteValues = ib.palette ? toSerializablePaletteArray(ib.palette) : undefined;
              const palette = paletteValues && paletteValues.length > 0 ? paletteValues : undefined;

              const result: WebGLSerializedBrushState = {
                width,
                height,
                indexBuffer: indexArray,
                gradientIdBuffer,
                speedBuffer,
                gradientStops,
                palette,
                animationOffset,
                targetFPS
              };

              const animationData = entry.data?.animation as { flowDirection?: unknown; stats?: { flowDirection?: unknown } } | undefined;
              const serializedDirection = normalizeBrushFlowDirection(animationData?.flowDirection)
                ?? normalizeBrushFlowDirection(animationData?.stats?.flowDirection);
              const flowDirection = serializedDirection
                ?? detectBrushFlowDirection(brush, layer.id);

              if (flowDirection) {
                result.flowDirection = flowDirection;
              }

              result.alphaMode = 'opaque-indices';

              if (gobletDiagnosticsActive) {
                gobletDebugLog('[webglExporter] Brush serialize() final state', {
                  layerId: layer.id,
                  width,
                  height,
                  indices: indexArray.length,
                  gradientStops: gradientStops.length,
                  paletteSize: palette?.length ?? null,
                  targetFPS
                });
              }

              ccLog('serializeBrushState.done', {
                layerId: layer.id,
                width,
                height,
                idxLen: indexArray.length,
                idxSample: ccSample(indexArray, 12)
              });

              return result;
            }
          }
        }

        const strokeIndexBuffer = decodePersistedNumericBuffer(strokeData?.paintBuffer);
        if (strokeIndexBuffer.length > 0) {
          const fallbackWidth = Number.isFinite(widthRaw)
            ? widthRaw
            : (layer.imageData?.width ?? layer.colorCycleData?.canvasWidth ?? layer.colorCycleData?.canvas?.width ?? 1);
          const fallbackHeight = Number.isFinite(heightRaw)
            ? heightRaw
            : (layer.imageData?.height ?? layer.colorCycleData?.canvasHeight ?? layer.colorCycleData?.canvas?.height ?? 1);
          const width = Math.max(1, Math.round(Number.isFinite(fallbackWidth) ? fallbackWidth : 1));
          const height = Math.max(1, Math.round(Number.isFinite(fallbackHeight) ? fallbackHeight : 1));
          const gradientStops = toSerializableGradientStops(
            entry.data?.gradient?.gradientStops as Array<{ position?: number; color?: string }> | undefined,
            layer.colorCycleData?.gradient ?? []
          );
          const gradientIdValues = decodePersistedNumericBuffer(strokeData?.gradientIdBuffer);
          const gradientDefIdValues = decodePersistedDefIdBuffer(
            strokeData?.gradientDefIdBuffer ?? layer.colorCycleData?.gradientDefIdBuffer
          );
          const speedValues = decodePersistedNumericBuffer(strokeData?.speedBuffer);
          const animationOffset = typeof entry.data?.animation?.offset === 'number'
            ? entry.data.animation.offset
            : 0;
          const targetFPS = typeof entry.data?.animation?.stats?.targetFPS === 'number'
            ? entry.data.animation.stats.targetFPS
            : undefined;

          const result: WebGLSerializedBrushState = {
            width,
            height,
            indexBuffer: strokeIndexBuffer,
            gradientIdBuffer: gradientIdValues.length > 0 ? gradientIdValues : undefined,
            gradientDefIdBuffer: gradientDefIdValues.length > 0 ? gradientDefIdValues : undefined,
            speedBuffer: speedValues.length > 0 ? speedValues : undefined,
            gradientStops,
            animationOffset,
            targetFPS,
            alphaMode: 'opaque-indices'
          };

          const flowDirection = detectBrushFlowDirection(brush, layer.id);
          if (flowDirection) {
            result.flowDirection = flowDirection;
          }

          ccLog('serializeBrushState.strokeDataFallback', {
            layerId: layer.id,
            width,
            height,
            idxLen: strokeIndexBuffer.length,
            idxSample: ccSample(strokeIndexBuffer, 12)
          });

          return result;
        }
      }
      }
    } catch (error) {
      debugWarn('raw-console', '[webglExporter] Failed to serialize brush color cycle state for layer', layer.id, error);
    }
  }

  const propertyState = extractBrushStateFromBrushProperties(brush, layer);
  if (propertyState) {
    if (!propertyState.alphaMode) {
      propertyState.alphaMode = 'opaque-indices';
    }
    return propertyState;
  }

  const animatorState = extractBrushStateFromAnimator(brush, layer);
  if (animatorState) {
    if (!animatorState.alphaMode) {
      animatorState.alphaMode = 'opaque-indices';
    }
    return animatorState;
  }

  const documentState = extractBrushStateFromDocumentState(layer);
  if (documentState) {
    if (!documentState.alphaMode) {
      documentState.alphaMode = 'opaque-indices';
    }
    return documentState;
  }

  const savedSnapshotState = extractBrushStateFromSavedSnapshot(layer);
  if (savedSnapshotState) {
    if (!savedSnapshotState.alphaMode) {
      savedSnapshotState.alphaMode = 'opaque-indices';
    }
    return savedSnapshotState;
  }

  return undefined;
};

const resolveColorCycleMaskImage = (layer: Layer): ImageData | undefined => {
  const data = layer.colorCycleData;
  if (!data) {
    return undefined;
  }
  if (data.eraseMaskImageData) {
    return data.eraseMaskImageData;
  }
  return captureCanvasImageData(data.eraseMask ?? null) ?? undefined;
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
    Array.isArray(brushState.indexBuffer) &&
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

const applyAlphaMaskToIndexBuffer = (indices: number[] | undefined, mask: Uint8Array): void => {
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

export const serializeColorCycleData = async (
  layer: Layer,
  project: Project,
  speedWarning?: { warned: boolean },
  options?: {
    forceSpeedBuffer?: boolean;
    layerSpeedScale?: number;
    toolSpeed?: number | null;
  }
): Promise<ColorCycleSerializationResult | undefined> => {
  const data = layer.colorCycleData;
  if (!data) {
    return undefined;
  }

  const brushInstance = data.colorCycleBrush as { commitCurrentStroke?: (layerId?: string) => void } | null | undefined;
  if (brushInstance && typeof brushInstance.commitCurrentStroke === 'function') {
    try {
      brushInstance.commitCurrentStroke(layer.id);
    } catch (error) {
      debugWarn('raw-console', '[webglExporter] Failed to commit current color cycle stroke before export', error);
    }
  }

  const layerSpeedScale = clampExportLayerSpeedScale(options?.layerSpeedScale);
  let brushState: WebGLSerializedBrushState | undefined;
  if (!data.recolorSettings) {
    brushState = serializeBrushState(layer);
    if (!brushState) {
      debugWarn('raw-console', '[webglExporter] No brush state could be extracted for layer', layer.id);
    }
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
  const controllerSpeedForExport = data.mode === 'recolor'
    ? resolvedControllerSpeed
    : (resolvedControllerSpeed ?? resolvedBrushSpeed ?? MIN_BRUSH_COLOR_CYCLE_SPEED);
  const shouldAnimate = data.mode === 'recolor'
    ? shouldExportLayerAsAnimating(layer, brushState, layerSpeedScale)
    : !isStaticPreviewOnlyBrushLayer;
  const serialized: WebGLSerializedColorCycle = {
    mode: data.mode ?? 'brush',
    gradient: data.gradient,
    brushSpeed: resolvedBrushSpeed,
    layerBaseSpeedCps: data.mode === 'recolor' ? undefined : resolvedControllerSpeed,
    controllerSpeedCps: controllerSpeedForExport,
    speedMin: MIN_BRUSH_COLOR_CYCLE_SPEED,
    speedMax: MAX_BRUSH_COLOR_CYCLE_SPEED,
    isAnimating: shouldAnimate
  };

  let runtimeBrushState: BrushStateRuntimePayload | undefined;

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

  let exportSlotPalettes: Array<{ slot: number; stops: SerializedGradientStops }> | undefined;
  let fgDerivedStops: SerializedGradientStops | undefined;
  if (!data.recolorSettings) {
    exportSlotPalettes = resolveExportSlotPalettes(data, brushState);
    fgDerivedStops = resolveFgDerivedStops(data, exportSlotPalettes);
    if (exportSlotPalettes && exportSlotPalettes.length > 0) {
      serialized.slotPalettes = exportSlotPalettes.map((entry) => ({
        slot: entry.slot,
        stops: toSerializableGradientStops(entry.stops, [])
      }));
    }
  }

  const maskDimensions = brushState
    ? { width: brushState.width, height: brushState.height }
    : recolorSurface ?? getLayerSurfaceSize(layer);
  const alphaMaskDataset = captureColorCycleMaskDataset(layer, maskDimensions.width, maskDimensions.height);
  const alphaMaskResult = await serializeColorCycleAlphaMask(
    layer,
    maskDimensions.width,
    maskDimensions.height,
    alphaMaskDataset
  );
  if (alphaMaskResult) {
    serialized.alphaMask = alphaMaskResult.payload;
    if (brushState && Array.isArray(brushState.indexBuffer)) {
      applyAlphaMaskToIndexBuffer(brushState.indexBuffer, alphaMaskResult.values);
    }
  }

  if (brushState && Array.isArray(brushState.indexBuffer)) {
    runtimeBrushState = {
      width: brushState.width,
      height: brushState.height,
      indices: [...brushState.indexBuffer],
      palette: brushState.palette ? [...brushState.palette] : undefined
    };
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

  const coverage = computeColorCycleCoverage({
    layer,
    project,
    brushState,
    recolorIndexBuffer: data.recolorSettings?.indexBuffer ?? null,
    recolorSurface,
    maskDataset: coverageMaskDataset
  });

  if (coverage) {
    serialized.coverageBoundsSourcePx = coverage.source;
    serialized.coverageBoundsPx = coverage.document;
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
      layer,
      brushState,
      warnOnce: warnOnceMissingSpeed,
      forceBuffer: options?.forceSpeedBuffer === true,
      layerSpeedScale,
      fallbackToolSpeed: options?.toolSpeed,
    });
    if (speedPlan?.speedMode) {
      serialized.speedMode = speedPlan.speedMode;
    } else if (options?.forceSpeedBuffer && brushState.speedBuffer) {
      serialized.speedMode = 'buffer';
    }
    if (speedPlan?.slotSpeeds && speedPlan.slotSpeeds.length > 0) {
      serialized.slotSpeeds = speedPlan.slotSpeeds;
    }
    let preparedSource = brushState;
    if (speedPlan?.speedMode === 'slot') {
      preparedSource = { ...preparedSource, speedBuffer: undefined };
    }
    if (speedPlan?.speedBufferOverride) {
      preparedSource = { ...preparedSource, speedBuffer: speedPlan.speedBufferOverride };
    }
    const resolvePackedBuffer = async (
      input?: number[] | Uint8Array | string
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
    const normalizedGradientIds = typeof rawGradientIds === 'string'
      ? undefined
      : stripFlowBitsFromGradientIds(rawGradientIds ?? undefined);
    const gradientIdFallback = Array.isArray(normalizedGradientIds)
      ? normalizedGradientIds
      : normalizedGradientIds
        ? (Array.from(normalizedGradientIds) as number[])
        : typeof rawGradientIds === 'string'
          ? rawGradientIds
          : undefined;
    const encodedGradientIdBuffer = await resolvePackedBuffer(gradientIdFallback);
    const encodedSpeedBuffer = await resolvePackedBuffer(preparedSource.speedBuffer ?? undefined);
    const fallbackSpeedBuffer = (() => {
      const raw = preparedSource.speedBuffer;
      if (!raw || typeof raw === 'string') {
        return raw;
      }
      return Array.isArray(raw) ? raw : (Array.from(raw) as number[]);
    })();
    const preparedBrushState: WebGLSerializedBrushState = {
      ...preparedSource,
      indexBuffer: encodedIndexBuffer ?? [],
      gradientIdBuffer: encodedGradientIdBuffer ?? gradientIdFallback,
      speedBuffer: encodedSpeedBuffer ?? fallbackSpeedBuffer,
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
    if (brushStops && brushStops.length > 0) {
      // Prefer the live brush gradient to avoid exporting stale layer gradients.
      serialized.gradient = brushStops;
    } else if (!serialized.gradient || serialized.gradient.length === 0) {
      serialized.gradient = fgDerivedStops ?? preparedBrushState.gradientStops;
    }
    if (gobletDiagnosticsActive) {
      const summary = summarizeEncodedBuffer(preparedBrushState.indexBuffer, Array.isArray(brushState.indexBuffer) ? brushState.indexBuffer.length : 0);
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
    runtime: runtimeBrushState ? { brushState: runtimeBrushState } : undefined
  };
};
