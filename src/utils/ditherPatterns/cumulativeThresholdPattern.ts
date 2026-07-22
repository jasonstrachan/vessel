export const MAX_CUMULATIVE_PATTERN_DIMENSION = 512;
export const MAX_CUMULATIVE_PATTERN_PIXELS =
  MAX_CUMULATIVE_PATTERN_DIMENSION * MAX_CUMULATIVE_PATTERN_DIMENSION;

export type DitherPatternCoveragePolicy = 'fixed' | 'local-tone' | 'mark-tone-map';
export type DitherPatternStorageScope = 'project' | 'local-library';

export type DitherPatternToneMapEntry = Readonly<{
  maxInput: number;
  tone: number;
}>;

export type CumulativeThresholdPatternDefinition = Readonly<{
  id: string;
  name: string;
  kind: 'cumulative-threshold';
  width: number;
  height: number;
  coveragePolicy: DitherPatternCoveragePolicy;
  payloadHash: string;
  storageScope: DitherPatternStorageScope;
  fixedTone?: number;
  toneMap?: readonly DitherPatternToneMapEntry[];
}>;

export type CumulativeThresholdPatternRuntime = Readonly<{
  definition: CumulativeThresholdPatternDefinition;
  thresholds: Uint8Array;
}>;

export type CumulativeThresholdResolver = ((x: number, y: number) => number | null) & Readonly<{
  patternId: string;
  payloadHash: string;
  coveragePolicy: DitherPatternCoveragePolicy;
  cacheKey: string;
  resolveTone: (inputTone: number) => number;
}>;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteUnitValue = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const parseToneMap = (value: unknown): readonly DitherPatternToneMapEntry[] | null => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    return null;
  }
  const entries: DitherPatternToneMapEntry[] = [];
  let previousMax = 0;
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry) || !isFiniteUnitValue(entry.maxInput) || !isFiniteUnitValue(entry.tone)) {
      return null;
    }
    if (entry.maxInput <= previousMax || (index === value.length - 1 && entry.maxInput !== 1)) {
      return null;
    }
    previousMax = entry.maxInput;
    entries.push({ maxInput: entry.maxInput, tone: entry.tone });
  }
  return entries;
};

export const parseCumulativeThresholdPatternDefinition = (
  value: unknown,
): CumulativeThresholdPatternDefinition | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const width = value.width;
  const height = value.height;
  const coveragePolicy = value.coveragePolicy;
  const storageScope = value.storageScope;
  const payloadHash = typeof value.payloadHash === 'string' ? value.payloadHash.toLowerCase() : '';
  if (
    !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id) ||
    name.length < 1 ||
    name.length > 128 ||
    value.kind !== 'cumulative-threshold' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    (width as number) < 1 ||
    (height as number) < 1 ||
    (width as number) > MAX_CUMULATIVE_PATTERN_DIMENSION ||
    (height as number) > MAX_CUMULATIVE_PATTERN_DIMENSION ||
    (width as number) * (height as number) > MAX_CUMULATIVE_PATTERN_PIXELS ||
    !['fixed', 'local-tone', 'mark-tone-map'].includes(String(coveragePolicy)) ||
    !['project', 'local-library'].includes(String(storageScope)) ||
    !/^sha256:[0-9a-f]{64}$/.test(payloadHash)
  ) {
    return null;
  }

  const fixedTone = isFiniteUnitValue(value.fixedTone) ? value.fixedTone : undefined;
  const toneMap = value.toneMap === undefined ? undefined : parseToneMap(value.toneMap);
  if (coveragePolicy === 'fixed' && fixedTone === undefined) {
    return null;
  }
  if (coveragePolicy === 'mark-tone-map' && !toneMap) {
    return null;
  }
  if (coveragePolicy !== 'fixed' && value.fixedTone !== undefined) {
    return null;
  }
  if (coveragePolicy !== 'mark-tone-map' && value.toneMap !== undefined) {
    return null;
  }

  return {
    id,
    name,
    kind: 'cumulative-threshold',
    width: width as number,
    height: height as number,
    coveragePolicy: coveragePolicy as DitherPatternCoveragePolicy,
    payloadHash,
    storageScope: storageScope as DitherPatternStorageScope,
    ...(fixedTone === undefined ? {} : { fixedTone }),
    ...(toneMap ? { toneMap } : {}),
  };
};

export const hashCumulativeThresholdPayload = async (payload: Uint8Array): Promise<string> => {
  if (!globalThis.crypto?.subtle) {
    throw new Error('SHA-256 is unavailable in this browser.');
  }
  const source = new Uint8Array(payload);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', source);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
};

export const decodeCumulativeThresholdPattern = async ({
  definition: definitionInput,
  payload,
}: {
  definition: unknown;
  payload: Uint8Array;
}): Promise<CumulativeThresholdPatternRuntime> => {
  const definition = parseCumulativeThresholdPatternDefinition(definitionInput);
  if (!definition) {
    throw new Error('Invalid cumulative-threshold pattern definition.');
  }
  if (!(payload instanceof Uint8Array) || payload.length !== definition.width * definition.height) {
    throw new Error('Cumulative-threshold payload dimensions do not match its definition.');
  }
  const thresholds = new Uint8Array(payload);
  const payloadHash = await hashCumulativeThresholdPayload(thresholds);
  if (payloadHash !== definition.payloadHash) {
    throw new Error('Cumulative-threshold payload hash does not match its definition.');
  }
  return { definition, thresholds };
};

const mod = (value: number, modulo: number): number => ((value % modulo) + modulo) % modulo;

export const resolveCumulativeThreshold = (
  runtime: CumulativeThresholdPatternRuntime,
  x: number,
  y: number,
): number => {
  const { width, height } = runtime.definition;
  const localX = mod(Math.floor(x), width);
  const localY = mod(Math.floor(y), height);
  const encoded = runtime.thresholds[localY * width + localX] ?? 255;
  return encoded === 255 ? Number.POSITIVE_INFINITY : encoded / 254;
};

export const resolveCumulativePatternTone = (
  definition: CumulativeThresholdPatternDefinition,
  inputTone: number,
): number => {
  const tone = Number.isFinite(inputTone) ? Math.max(0, Math.min(1, inputTone)) : 0.5;
  if (definition.coveragePolicy === 'fixed') {
    return definition.fixedTone ?? 0.5;
  }
  if (definition.coveragePolicy === 'local-tone') {
    return tone;
  }
  const toneMap = definition.toneMap ?? [];
  return toneMap.find((entry) => tone < entry.maxInput)?.tone ?? toneMap.at(-1)?.tone ?? tone;
};

export const isCumulativeThresholdActive = (
  runtime: CumulativeThresholdPatternRuntime,
  x: number,
  y: number,
  inputTone: number,
): boolean => resolveCumulativePatternTone(runtime.definition, inputTone) >=
  resolveCumulativeThreshold(runtime, x, y);

export const createCumulativeThresholdResolver = (
  runtime: CumulativeThresholdPatternRuntime,
  settings: {
    scale?: number | null;
    offsetX?: number | null;
    offsetY?: number | null;
  } = {},
): CumulativeThresholdResolver => {
  const scale = Math.max(1, Math.round(settings.scale ?? 1));
  const offsetX = Math.round(settings.offsetX ?? 0);
  const offsetY = Math.round(settings.offsetY ?? 0);
  const resolver = ((x: number, y: number) => resolveCumulativeThreshold(
    runtime,
    Math.floor((x + offsetX) / scale),
    Math.floor((y + offsetY) / scale),
  )) as CumulativeThresholdResolver;
  return Object.assign(resolver, {
    patternId: runtime.definition.id,
    payloadHash: runtime.definition.payloadHash,
    coveragePolicy: runtime.definition.coveragePolicy,
    cacheKey: `${runtime.definition.payloadHash}:${scale}:${offsetX}:${offsetY}`,
    resolveTone: (inputTone: number) => resolveCumulativePatternTone(runtime.definition, inputTone),
  });
};

export const isCumulativeThresholdResolver = (
  resolver: ((x: number, y: number) => number | null) | null | undefined,
): resolver is CumulativeThresholdResolver => Boolean(
  resolver &&
  typeof (resolver as Partial<CumulativeThresholdResolver>).payloadHash === 'string' &&
  typeof (resolver as Partial<CumulativeThresholdResolver>).resolveTone === 'function',
);

export const resolveExternalPatternTone = ({
  resolver,
  localTone,
  markTone,
}: {
  resolver: ((x: number, y: number) => number | null) | null | undefined;
  localTone: number;
  markTone: number;
}): number => {
  if (!isCumulativeThresholdResolver(resolver)) {
    return localTone;
  }
  const sourceTone = resolver.coveragePolicy === 'mark-tone-map' ? markTone : localTone;
  return resolver.resolveTone(sourceTone);
};
