import type {
  CustomBrushCcPhaseMode,
  CustomBrushColorCycleData,
  CustomBrushColorCycleMode,
  CustomBrushColorCycleSource,
  CustomBrushColorCycleV1,
  CustomBrushColorCycleV2,
} from '@/types';

const MAX_MAP_PIXELS = 4096 * 4096;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const toFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const toSafeInt = (value: unknown): number | undefined => {
  const num = toFiniteNumber(value);
  if (num === undefined) {
    return undefined;
  }
  const rounded = Math.round(num);
  return rounded >= 0 ? rounded : undefined;
};

const sanitizeSource = (source: unknown): CustomBrushColorCycleSource =>
  source === 'color-cycle-layer' || source === 'manual' ? source : 'unknown';

export const sanitizePhaseMode = (mode: unknown): CustomBrushCcPhaseMode | undefined => {
  if (mode === 'per-stroke-seeded' || mode === 'jittered') {
    return mode;
  }
  if (mode === 'global') {
    return 'global';
  }
  return undefined;
};

const sanitizeGradient = (
  gradient: unknown
): Array<{ position: number; color: string }> | undefined => {
  if (!Array.isArray(gradient)) {
    return undefined;
  }
  const stops = gradient
    .filter((stop) => typeof stop?.position === 'number' && typeof stop?.color === 'string')
    .map((stop) => ({
      position: clamp01(Number(stop.position)),
      color: String(stop.color),
    }));
  return stops.length > 0 ? stops : undefined;
};

const createV1 = (input: Partial<CustomBrushColorCycleV1>): CustomBrushColorCycleV1 => ({
  schemaVersion: 1,
  source: sanitizeSource(input.source),
  gradient: sanitizeGradient(input.gradient),
  speed: toFiniteNumber(input.speed),
  phaseMode: sanitizePhaseMode(input.phaseMode),
  phaseJitter:
    toFiniteNumber(input.phaseJitter) !== undefined
      ? clamp01(Number(input.phaseJitter))
      : undefined,
});

const sanitizeMapDimensions = (
  width: unknown,
  height: unknown
): { width: number; height: number; area: number } | null => {
  const mapWidth = Math.max(1, toSafeInt(width) ?? 1);
  const mapHeight = Math.max(1, toSafeInt(height) ?? 1);
  const area = mapWidth * mapHeight;
  if (!Number.isFinite(area) || area <= 0 || area > MAX_MAP_PIXELS) {
    return null;
  }
  return { width: mapWidth, height: mapHeight, area };
};

const sanitizeMode = (mode: unknown): CustomBrushColorCycleMode =>
  mode === 'captured-data' ? 'captured-data' : 'tip';

const ensureUint16ArrayLength = (
  value: unknown,
  expectedLength: number
): Uint16Array | undefined => {
  if (!(value instanceof Uint16Array)) {
    return undefined;
  }
  if (value.length !== expectedLength) {
    return undefined;
  }
  return new Uint16Array(value);
};

const ensureUint8ArrayLength = (
  value: unknown,
  expectedLength: number
): Uint8Array | undefined => {
  if (!(value instanceof Uint8Array)) {
    return undefined;
  }
  if (value.length !== expectedLength) {
    return undefined;
  }
  return new Uint8Array(value);
};

const createV2 = (input: Partial<CustomBrushColorCycleV2>): CustomBrushColorCycleV2 => {
  const dims = sanitizeMapDimensions(input.mapWidth, input.mapHeight);
  if (!dims) {
    return {
      schemaVersion: 2,
      mode: 'tip',
      source: sanitizeSource(input.source),
      gradient: sanitizeGradient(input.gradient),
      speed: toFiniteNumber(input.speed),
      phaseMode: sanitizePhaseMode(input.phaseMode),
      phaseJitter: toFiniteNumber(input.phaseJitter) !== undefined ? clamp01(Number(input.phaseJitter)) : undefined,
      sourceCycleLength: Math.max(1, Math.round(toFiniteNumber(input.sourceCycleLength) ?? 256)),
      mapWidth: 1,
      mapHeight: 1,
    };
  }

  const phaseMap = ensureUint16ArrayLength(input.phaseMap, dims.area);
  const indexMap = ensureUint16ArrayLength(input.indexMap, dims.area);
  const alphaMask = ensureUint8ArrayLength(input.alphaMask, dims.area);

  const hasAnyMap = Boolean(phaseMap || indexMap);
  const requestedMode = sanitizeMode(input.mode);
  const mode = requestedMode === 'captured-data' && hasAnyMap ? 'captured-data' : 'tip';

  return {
    schemaVersion: 2,
    mode,
    source: sanitizeSource(input.source),
    gradient: sanitizeGradient(input.gradient),
    speed: toFiniteNumber(input.speed),
    phaseMode: sanitizePhaseMode(input.phaseMode),
    phaseJitter: toFiniteNumber(input.phaseJitter) !== undefined ? clamp01(Number(input.phaseJitter)) : undefined,
    sourceCycleLength: Math.max(1, Math.round(toFiniteNumber(input.sourceCycleLength) ?? 256)),
    mapWidth: dims.width,
    mapHeight: dims.height,
    phaseMap,
    indexMap,
    alphaMask,
    useAlphaMask: input.useAlphaMask !== false,
  };
};

export const normalizeCustomBrushColorCycle = (
  input: CustomBrushColorCycleData | null | undefined
): CustomBrushColorCycleData | undefined => {
  if (!input) {
    return undefined;
  }
  if (input.schemaVersion === 2) {
    return createV2(input);
  }
  if (input.schemaVersion === 1) {
    return createV1(input);
  }
  return undefined;
};

const encodeBytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  const maybeBuffer = (globalThis as typeof globalThis & { Buffer?: { from: (s: string, enc: string) => { toString: (enc: string) => string } } }).Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(binary, 'binary').toString('base64');
  }
  throw new Error('No base64 encoder available');
};

const decodeBase64ToBytes = (value: string): Uint8Array => {
  const decode = (): string => {
    if (typeof atob === 'function') {
      return atob(value);
    }
    const maybeBuffer = (globalThis as typeof globalThis & { Buffer?: { from: (s: string, enc: string) => { toString: (enc: string) => string } } }).Buffer;
    if (maybeBuffer) {
      return maybeBuffer.from(value, 'base64').toString('binary');
    }
    throw new Error('No base64 decoder available');
  };

  const binary = decode();
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i) & 0xff;
  }
  return bytes;
};

const encodeUint16Array = (value: Uint16Array): string =>
  encodeBytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));

const decodeUint16Array = (value: string): Uint16Array => {
  const bytes = decodeBase64ToBytes(value);
  const length = Math.floor(bytes.byteLength / Uint16Array.BYTES_PER_ELEMENT);
  const view = new Uint16Array(length);
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < length; i += 1) {
    view[i] = dataView.getUint16(i * Uint16Array.BYTES_PER_ELEMENT, true);
  }
  return view;
};

const encodeUint8Array = (value: Uint8Array): string =>
  encodeBytesToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));

const decodeUint8Array = (value: string): Uint8Array => decodeBase64ToBytes(value);

export type SerializedCustomBrushColorCycle =
  | {
      schemaVersion: 1;
      source?: CustomBrushColorCycleSource;
      gradient?: Array<{ position: number; color: string }>;
      speed?: number;
      phaseMode?: CustomBrushCcPhaseMode;
      phaseJitter?: number;
    }
  | {
      schemaVersion: 2;
      mode: CustomBrushColorCycleMode;
      source?: CustomBrushColorCycleSource;
      gradient?: Array<{ position: number; color: string }>;
      speed?: number;
      phaseMode?: CustomBrushCcPhaseMode;
      phaseJitter?: number;
      sourceCycleLength: number;
      mapWidth: number;
      mapHeight: number;
      phaseMapBase64?: string;
      indexMapBase64?: string;
      alphaMaskBase64?: string;
      useAlphaMask?: boolean;
    };

export const serializeCustomBrushColorCycle = (
  input: CustomBrushColorCycleData | undefined
): SerializedCustomBrushColorCycle | undefined => {
  const normalized = normalizeCustomBrushColorCycle(input);
  if (!normalized) {
    return undefined;
  }

  if (normalized.schemaVersion === 1) {
    return {
      schemaVersion: 1,
      source: normalized.source,
      gradient: normalized.gradient,
      speed: normalized.speed,
      phaseMode: normalized.phaseMode,
      phaseJitter: normalized.phaseJitter,
    };
  }

  return {
    schemaVersion: 2,
    mode: normalized.mode,
    source: normalized.source,
    gradient: normalized.gradient,
    speed: normalized.speed,
    phaseMode: normalized.phaseMode,
    phaseJitter: normalized.phaseJitter,
    sourceCycleLength: normalized.sourceCycleLength,
    mapWidth: normalized.mapWidth,
    mapHeight: normalized.mapHeight,
    phaseMapBase64: normalized.phaseMap ? encodeUint16Array(normalized.phaseMap) : undefined,
    indexMapBase64: normalized.indexMap ? encodeUint16Array(normalized.indexMap) : undefined,
    alphaMaskBase64: normalized.alphaMask ? encodeUint8Array(normalized.alphaMask) : undefined,
    useAlphaMask: normalized.useAlphaMask !== false,
  };
};

export const deserializeCustomBrushColorCycle = (
  input: SerializedCustomBrushColorCycle | undefined
): CustomBrushColorCycleData | undefined => {
  if (!input) {
    return undefined;
  }

  if (input.schemaVersion === 1) {
    return normalizeCustomBrushColorCycle(input);
  }

  if (input.schemaVersion === 2) {
    let phaseMap: Uint16Array | undefined;
    let indexMap: Uint16Array | undefined;
    let alphaMask: Uint8Array | undefined;

    try {
      phaseMap = typeof input.phaseMapBase64 === 'string' ? decodeUint16Array(input.phaseMapBase64) : undefined;
      indexMap = typeof input.indexMapBase64 === 'string' ? decodeUint16Array(input.indexMapBase64) : undefined;
      alphaMask = typeof input.alphaMaskBase64 === 'string' ? decodeUint8Array(input.alphaMaskBase64) : undefined;
    } catch {
      return normalizeCustomBrushColorCycle({
        schemaVersion: 2,
        mode: 'tip',
        source: input.source,
        gradient: input.gradient,
        speed: input.speed,
        phaseMode: input.phaseMode,
        phaseJitter: input.phaseJitter,
        sourceCycleLength: input.sourceCycleLength,
        mapWidth: input.mapWidth,
        mapHeight: input.mapHeight,
      });
    }

    return normalizeCustomBrushColorCycle({
      schemaVersion: 2,
      mode: input.mode,
      source: input.source,
      gradient: input.gradient,
      speed: input.speed,
      phaseMode: input.phaseMode,
      phaseJitter: input.phaseJitter,
      sourceCycleLength: input.sourceCycleLength,
      mapWidth: input.mapWidth,
      mapHeight: input.mapHeight,
      phaseMap,
      indexMap,
      alphaMask,
      useAlphaMask: input.useAlphaMask,
    });
  }

  return undefined;
};
