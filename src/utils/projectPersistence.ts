export const PROJECT_ARCHIVE_MANIFEST_VERSION = 1;

export type PersistedLayerType = 'normal' | 'color-cycle' | 'colorCycle' | 'sequential';

export type ArchiveBinaryRef = `zip:${string}`;

export type BinaryManifestDType =
  | 'uint8'
  | 'uint16'
  | 'rgba8'
  | 'json'
  | 'unknown';

export type BinaryManifestCompression = 'deflate' | 'stored';

export interface BinaryManifestEntry {
  version: 1;
  path: string;
  checksum: string;
  byteLength: number;
  logicalByteLength?: number;
  dtype: BinaryManifestDType;
  width?: number;
  height?: number;
  encoding?: 'raw' | 'sparse-rect-v1';
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  compression: BinaryManifestCompression;
}

export interface PersistedProjectBinaryManifest {
  entries: BinaryManifestEntry[];
}

export interface PersistedLayerEnvelopeBase {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  locked: boolean;
  transparencyLocked?: boolean;
  order: number;
  imageDataUrl: string;
  layerType?: PersistedLayerType;
  alignment?: unknown;
  groupId?: string;
  state?: unknown;
}

export interface PersistedNormalLayerEnvelope extends PersistedLayerEnvelopeBase {
  layerType?: 'normal';
  colorCycleData?: undefined;
  sequentialData?: undefined;
}

export interface PersistedColorCycleLayerEnvelope extends PersistedLayerEnvelopeBase {
  layerType: 'color-cycle' | 'colorCycle';
  colorCycleData: Record<string, unknown>;
  sequentialData?: undefined;
}

export interface PersistedSequentialLayerEnvelope extends PersistedLayerEnvelopeBase {
  layerType: 'sequential';
  sequentialData: Record<string, unknown>;
  colorCycleData?: undefined;
}

export type PersistedLayerEnvelope =
  | PersistedNormalLayerEnvelope
  | PersistedColorCycleLayerEnvelope
  | PersistedSequentialLayerEnvelope;

export interface VesselProjectArchive {
  version: string;
  manifestVersion?: number;
  metadata: {
    name: string;
    created: string;
    modified: string;
    appVersion: string;
  };
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    backgroundColor: string;
    layers: PersistedLayerEnvelope[];
    customBrushes: unknown[];
    layerGroups?: unknown[];
    defaultCustomBrushId?: string | null;
    thumbnail?: string;
    brushSpecificSettings?: Record<string, unknown>;
    globalBrushSize?: number;
    referenceLayerId?: string | null;
    exportLayout?: unknown;
    palette?: unknown;
    canvasShape?: unknown;
    viewState?: unknown;
  };
  binaries?: PersistedProjectBinaryManifest;
}

export type PersistedFieldClass = 'canonical' | 'metadata' | 'forbidden-on-disk';

export const COLOR_CYCLE_STATE_FIELD_CLASSIFICATION = {
  version: 'metadata',
  dimensions: 'canonical',
  mode: 'metadata',
  gradientDefs: 'metadata',
  slotPalettes: 'canonical',
  gradientDefStore: 'canonical',
  nextGradientDefId: 'metadata',
  fgActiveSlot: 'metadata',
  activeGradientId: 'metadata',
  paintSlot: 'metadata',
  layerBaseSpeedCps: 'metadata',
  brushSpeed: 'metadata',
  controllerSpeedCps: 'metadata',
  flowMode: 'metadata',
  paintRef: 'canonical',
  gradientIdRef: 'canonical',
  gradientDefIdRef: 'canonical',
  speedRef: 'canonical',
  flowRef: 'canonical',
  phaseRef: 'canonical',
  hasContent: 'metadata',
  strokeCounter: 'metadata',
  dither: 'metadata',
} as const satisfies Record<string, PersistedFieldClass>;

export const MODERN_COLOR_CYCLE_DATA_FIELD_CLASSIFICATION = {
  gradient: 'metadata',
  recolorSettings: 'metadata',
  canvasImageData: 'metadata',
  eraseMaskImageData: 'metadata',
  eraseMaskVersion: 'metadata',
  canvasWidth: 'metadata',
  canvasHeight: 'metadata',
} as const satisfies Record<string, PersistedFieldClass>;

export const COLOR_CYCLE_STATE_AUTHORITY_FIELDS = [
  'gradientDefs',
  'slotPalettes',
  'gradientDefStore',
  'nextGradientDefId',
  'fgActiveSlot',
  'activeGradientId',
  'paintRef',
  'gradientIdRef',
  'gradientDefIdRef',
  'speedRef',
  'flowRef',
  'phaseRef',
  'mode',
  'layerBaseSpeedCps',
  'brushSpeed',
  'controllerSpeedCps',
  'flowMode',
] as const;

export const COLOR_CYCLE_DATA_DUPLICATE_AUTHORITY_FIELDS = [
  'gradientDefs',
  'slotPalettes',
  'gradientDefStore',
  'nextGradientDefId',
  'fgActiveSlot',
  'activeGradientId',
  'gradientIdBuffer',
  'gradientDefIdBuffer',
  'mode',
  'layerBaseSpeedCps',
  'brushSpeed',
  'controllerSpeedCps',
  'flowMode',
] as const;

export type PersistencePolicyDecision = 'hard-fail' | 'warn-and-save' | 'auto-repair';

export interface ColorCyclePersistencePolicyIssue {
  code:
    | 'unexpected-state-fields'
    | 'unexpected-color-cycle-data-fields'
    | 'dual-authority-canonical-fields'
    | 'dual-authority-runtime-stroke-buffers';
  decision: PersistencePolicyDecision;
  fields?: string[];
}

export const STRICT_V1_COLOR_CYCLE_STATE_FIELDS = [
  ...Object.keys(COLOR_CYCLE_STATE_FIELD_CLASSIFICATION),
] as const;

export const MODERN_ALLOWED_COLOR_CYCLE_DATA_FIELDS = [
  ...Object.keys(MODERN_COLOR_CYCLE_DATA_FIELD_CLASSIFICATION),
] as const;

export function getColorCycleStateFieldClass(field: string): PersistedFieldClass | undefined {
  return COLOR_CYCLE_STATE_FIELD_CLASSIFICATION[field as keyof typeof COLOR_CYCLE_STATE_FIELD_CLASSIFICATION];
}

export function getModernColorCycleDataFieldClass(field: string): PersistedFieldClass | undefined {
  return MODERN_COLOR_CYCLE_DATA_FIELD_CLASSIFICATION[field as keyof typeof MODERN_COLOR_CYCLE_DATA_FIELD_CLASSIFICATION];
}

export function getUnexpectedColorCycleStateFields(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const allowed = new Set<string>(STRICT_V1_COLOR_CYCLE_STATE_FIELDS);
  return Object.keys(value as Record<string, unknown>).filter((key) => !allowed.has(key));
}

export function getUnexpectedModernColorCycleDataFields(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const allowed = new Set<string>(MODERN_ALLOWED_COLOR_CYCLE_DATA_FIELDS);
  return Object.keys(value as Record<string, unknown>).filter((key) => !allowed.has(key));
}

const hasAnyOwnField = (value: unknown, fields: readonly string[]): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return fields.some((field) => record[field] !== undefined);
};

const hasRuntimeStrokeBufferAuthority = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const brushState = (value as { brushState?: { layers?: Array<{ strokeData?: Record<string, unknown> }> } }).brushState;
  return (brushState?.layers ?? []).some((snapshot) => {
    const strokeData = snapshot?.strokeData;
    return strokeData?.paintBuffer !== undefined
      || strokeData?.gradientIdBuffer !== undefined
      || strokeData?.gradientDefIdBuffer !== undefined
      || strokeData?.speedBuffer !== undefined
      || strokeData?.flowBuffer !== undefined
      || strokeData?.phaseBuffer !== undefined;
  });
};

export function evaluateColorCyclePersistencePolicy(
  state: unknown,
  colorCycleData: unknown,
): ColorCyclePersistencePolicyIssue[] {
  const issues: ColorCyclePersistencePolicyIssue[] = [];
  const unexpectedStateFields = getUnexpectedColorCycleStateFields(state);
  if (unexpectedStateFields.length > 0) {
    issues.push({
      code: 'unexpected-state-fields',
      decision: 'hard-fail',
      fields: unexpectedStateFields,
    });
  }

  const unexpectedColorCycleDataFields = getUnexpectedModernColorCycleDataFields(colorCycleData);
  if (unexpectedColorCycleDataFields.length > 0) {
    issues.push({
      code: 'unexpected-color-cycle-data-fields',
      decision: 'hard-fail',
      fields: unexpectedColorCycleDataFields,
    });
  }

  const stateOwnsAuthority = hasAnyOwnField(state, COLOR_CYCLE_STATE_AUTHORITY_FIELDS);
  if (stateOwnsAuthority && hasAnyOwnField(colorCycleData, COLOR_CYCLE_DATA_DUPLICATE_AUTHORITY_FIELDS)) {
    issues.push({
      code: 'dual-authority-canonical-fields',
      decision: 'hard-fail',
    });
  }

  if (stateOwnsAuthority && hasRuntimeStrokeBufferAuthority(colorCycleData)) {
    issues.push({
      code: 'dual-authority-runtime-stroke-buffers',
      decision: 'hard-fail',
    });
  }

  return issues;
}

export function validateStrictColorCyclePersistedSurface(
  layerId: string,
  state: unknown,
  colorCycleData: unknown,
): void {
  const issues = evaluateColorCyclePersistencePolicy(state, colorCycleData);
  const firstHardFailure = issues.find((issue) => (
    issue.decision === 'hard-fail'
      && (
        issue.code === 'dual-authority-canonical-fields'
        || issue.code === 'dual-authority-runtime-stroke-buffers'
      )
  )) ?? issues.find((issue) => issue.decision === 'hard-fail');
  if (!firstHardFailure) {
    return;
  }

  if (firstHardFailure.code === 'unexpected-state-fields') {
    throw new Error(`Unexpected color-cycle state fields for ${layerId}: ${(firstHardFailure.fields ?? []).join(', ')}`);
  }
  if (firstHardFailure.code === 'unexpected-color-cycle-data-fields') {
    throw new Error(`Unexpected color-cycle data fields for ${layerId}: ${(firstHardFailure.fields ?? []).join(', ')}`);
  }
  if (
    firstHardFailure.code === 'dual-authority-canonical-fields'
    || firstHardFailure.code === 'dual-authority-runtime-stroke-buffers'
  ) {
    throw new Error(`Dual-authority color-cycle layer payload detected for ${layerId}`);
  }
}

export function isArchiveBinaryRef(value: unknown): value is ArchiveBinaryRef {
  return typeof value === 'string' && value.startsWith('zip:');
}

export function collectArchiveBinaryRefs(value: unknown, refs: Set<string> = new Set<string>()): Set<string> {
  if (isArchiveBinaryRef(value)) {
    refs.add(value.slice('zip:'.length));
    return refs;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectArchiveBinaryRefs(entry, refs));
    return refs;
  }

  if (!value || typeof value !== 'object') {
    return refs;
  }

  Object.values(value).forEach((entry) => collectArchiveBinaryRefs(entry, refs));
  return refs;
}

export function fnv1aHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function inferBinaryManifestDType(path: string): BinaryManifestDType {
  if (path.endsWith('.json')) {
    return 'json';
  }
  if (path.endsWith('gradient-def-id.bin')) {
    return 'uint16';
  }
  if (
    path.endsWith('paint.bin')
    || path.endsWith('gradient-id.bin')
    || path.endsWith('speed.bin')
    || path.endsWith('flow.bin')
    || path.endsWith('phase.bin')
    || path.endsWith('recolor-index.bin')
    || path.endsWith('recolor-index-phase.bin')
    || path.endsWith('recolor-phase.bin')
    || path.endsWith('animator-index.bin')
    || path.endsWith('animator-gradient-id.bin')
    || path.endsWith('animator-speed.bin')
    || path.endsWith('animator-flow.bin')
    || path.endsWith('animator-phase.bin')
  ) {
    return 'uint8';
  }
  return 'unknown';
}

export function normalizePersistedLayerType(layerType: PersistedLayerType | undefined): 'normal' | 'color-cycle' | 'sequential' {
  if (layerType === 'colorCycle') {
    return 'color-cycle';
  }
  if (layerType === 'color-cycle' || layerType === 'sequential') {
    return layerType;
  }
  return 'normal';
}
