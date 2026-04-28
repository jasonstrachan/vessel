import type {
  ColorCycleBufferRef,
  ColorCycleDamageKind,
  ColorCyclePersistenceDiagnostic,
  ColorCyclePersistenceDocumentState,
  ColorCyclePersistenceFailureReason,
  ColorCyclePersistenceSource,
  PersistedColorCycleBrushState,
  PersistedColorCycleLayerSnapshot,
} from './colorCyclePersistenceTypes';

export const COLOR_CYCLE_PERSISTENCE_SCHEMA_VERSION = 1;

const isArchiveRef = (value: ColorCycleBufferRef | undefined): value is string => (
  typeof value === 'string' && value.startsWith('zip:')
);

const hasBufferRef = (value: ColorCycleBufferRef | undefined): boolean => (
  value instanceof ArrayBuffer || typeof value === 'string'
);

export const cloneBufferRef = <T extends ColorCycleBufferRef | undefined>(value: T): T => (
  value instanceof ArrayBuffer ? value.slice(0) as T : value
);

export const getLayerSnapshot = (
  brushState: PersistedColorCycleBrushState | undefined,
  layerId: string,
): PersistedColorCycleLayerSnapshot | undefined => (
  brushState?.layers?.find((snapshot) => snapshot.layerId === layerId)
);

export const hasCanonicalBrushStateMarkers = (
  brushState: PersistedColorCycleBrushState | undefined,
  snapshot: PersistedColorCycleLayerSnapshot | undefined,
): boolean => Boolean(
  brushState?.canonicalPaint === true ||
  snapshot?.canonicalPaint === true,
);

const expectedByteLength = (state: ColorCyclePersistenceDocumentState, field: string): number => {
  const pixels = state.width * state.height;
  return field === 'gradientDefIdBuffer' ? pixels * 2 : pixels;
};

export const validatePersistenceDocumentState = (
  state: ColorCyclePersistenceDocumentState,
  {
    requirePaint,
    source,
  }: {
    requirePaint: boolean;
    source: ColorCyclePersistenceSource;
  },
): { ok: true } | {
  ok: false;
  reason: ColorCyclePersistenceFailureReason;
  damageKind: ColorCycleDamageKind;
  diagnostics: ColorCyclePersistenceDiagnostic[];
} => {
  const diagnostics: ColorCyclePersistenceDiagnostic[] = [];
  const expectedPixels = state.width * state.height;

  if (!Number.isFinite(state.width) || !Number.isFinite(state.height) || expectedPixels <= 0) {
    return {
      ok: false,
      reason: 'dimension-mismatch',
      damageKind: 'dimension-mismatch',
      diagnostics: [{
        source,
        kind: 'dimension-mismatch',
        message: 'Color-cycle document dimensions are missing or invalid.',
      }],
    };
  }

  const fields: Array<keyof Pick<
    ColorCyclePersistenceDocumentState,
    'paintBuffer' | 'speedBuffer' | 'flowBuffer' | 'phaseBuffer' | 'gradientIdBuffer' | 'gradientDefIdBuffer'
  >> = ['paintBuffer', 'speedBuffer', 'flowBuffer', 'phaseBuffer', 'gradientIdBuffer', 'gradientDefIdBuffer'];

  for (const field of fields) {
    const ref = state[field];
    if (ref instanceof ArrayBuffer && ref.byteLength !== expectedByteLength(state, field)) {
      return {
        ok: false,
        reason: 'dimension-mismatch',
        damageKind: 'dimension-mismatch',
        diagnostics: [{
          source,
          kind: 'dimension-mismatch',
          fields: [field],
          message: `${field} byteLength ${ref.byteLength} does not match ${expectedByteLength(state, field)} for ${state.width}x${state.height}.`,
        }],
      };
    }
  }

  if (requirePaint && !hasBufferRef(state.paintBuffer)) {
    return {
      ok: false,
      reason: 'missing-canonical-paint',
      damageKind: 'missing-paint-buffer',
      diagnostics: [{
        source,
        kind: 'missing-paint-buffer',
        fields: ['paintBuffer'],
        message: 'Color-cycle document state is missing canonical paint.',
      }],
    };
  }

  const missingMotion = ['speedBuffer', 'flowBuffer', 'phaseBuffer'].filter((field) => (
    !hasBufferRef(state[field as 'speedBuffer' | 'flowBuffer' | 'phaseBuffer'])
  ));
  if (missingMotion.length > 0) {
    return {
      ok: false,
      reason: 'missing-motion-buffers',
      damageKind: 'missing-motion-buffers',
      diagnostics: [{
        source,
        kind: 'missing-motion-buffers',
        fields: missingMotion,
        message: 'Color-cycle document state is missing motion buffers.',
      }],
    };
  }

  if (isArchiveRef(state.paintBuffer)) {
    diagnostics.push({
      source,
      kind: 'source-selected',
      message: 'Color-cycle document state uses deferred archive refs.',
    });
  }

  return { ok: true };
};

export const classifyBrushStateFailure = (
  brushState: PersistedColorCycleBrushState | undefined,
  snapshot: PersistedColorCycleLayerSnapshot | undefined,
): {
  reason: ColorCyclePersistenceFailureReason;
  damageKind: ColorCycleDamageKind;
  diagnostics: ColorCyclePersistenceDiagnostic[];
} => {
  if (!snapshot) {
    return {
      reason: 'missing-canonical-paint',
      damageKind: 'missing-paint-buffer',
      diagnostics: [{
        source: 'persisted-brush-state',
        kind: 'missing-paint-buffer',
        message: 'Persisted brush state has no snapshot for this layer.',
      }],
    };
  }
  if (!hasCanonicalBrushStateMarkers(brushState, snapshot)) {
    return {
      reason: 'metadata-only-state',
      damageKind: 'metadata-only',
      diagnostics: [{
        source: 'persisted-brush-state',
        kind: 'metadata-only',
        message: 'Persisted brush state is not explicitly marked as canonical paint.',
      }],
    };
  }
  if (brushState?.schemaVersion !== undefined && brushState.schemaVersion !== COLOR_CYCLE_PERSISTENCE_SCHEMA_VERSION) {
    return {
      reason: 'invalid-schema-version',
      damageKind: 'invalid-schema-version',
      diagnostics: [{
        source: 'persisted-brush-state',
        kind: 'invalid-schema-version',
        message: 'Persisted brush state schema version is not supported.',
      }],
    };
  }
  return {
    reason: 'missing-canonical-paint',
    damageKind: 'missing-paint-buffer',
    diagnostics: [{
      source: 'persisted-brush-state',
      kind: 'missing-paint-buffer',
      message: 'Persisted brush state is missing canonical paint.',
    }],
  };
};
