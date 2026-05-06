import type { Layer } from '@/types';
import {
  COLOR_CYCLE_PERSISTENCE_SCHEMA_VERSION,
  getLayerSnapshot,
  hasCanonicalBrushStateMarkers,
} from '@/lib/colorCycle/persistence/colorCyclePersistenceValidation';
import type {
  PersistedColorCycleBrushState,
  PersistedColorCycleLayerSnapshot,
} from '@/lib/colorCycle/persistence/colorCyclePersistenceTypes';

// Boundary: persisted/archive source eligibility only. This module decides whether
// persisted data is safe to try; final Goblet payload validity belongs to payload validation.
export type PersistedColorCycleExportLayerEntry = NonNullable<PersistedColorCycleBrushState['layers']>[number];

export type PersistedColorCycleExportEligibility =
  | {
      ok: true;
      brushState: PersistedColorCycleBrushState;
      entry: PersistedColorCycleExportLayerEntry;
      layerSnapshot: PersistedColorCycleLayerSnapshot | undefined;
    }
  | {
      ok: false;
      reason:
        | 'missing-brush-state'
        | 'missing-layer-entry'
        | 'non-canonical'
        | 'unsupported-schema'
        | 'missing-export-buffers';
      brushState?: PersistedColorCycleBrushState;
      entry?: PersistedColorCycleExportLayerEntry;
      layerSnapshot?: PersistedColorCycleLayerSnapshot;
    };

export const hasExportableColorCycleBuffer = (value: unknown): boolean => {
  if (value instanceof ArrayBuffer) {
    return value.byteLength > 0;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength > 0;
  }
  if (typeof value === 'string') {
    return value.length > 0 && !value.startsWith('zip:');
  }
  return false;
};

export const getPersistedColorCycleExportEntry = (
  brushState: PersistedColorCycleBrushState | undefined,
  layerId: string,
): PersistedColorCycleExportLayerEntry | undefined => {
  const layers = brushState?.layers;
  if (!layers?.length) {
    return undefined;
  }
  return layers.find((entry) => entry.layerId === layerId) ?? (layers.length === 1 ? layers[0] : undefined);
};

export const hasSupportedPersistedColorCycleSchema = (
  brushState: PersistedColorCycleBrushState | undefined,
  layerSnapshot: PersistedColorCycleLayerSnapshot | undefined,
): boolean => !(
  (brushState?.schemaVersion !== undefined && brushState.schemaVersion !== COLOR_CYCLE_PERSISTENCE_SCHEMA_VERSION) ||
  (layerSnapshot?.schemaVersion !== undefined && layerSnapshot.schemaVersion !== COLOR_CYCLE_PERSISTENCE_SCHEMA_VERSION)
);

export const hasPersistedColorCycleCanonicalMarkers = (
  brushState: PersistedColorCycleBrushState | undefined,
  layerSnapshot: PersistedColorCycleLayerSnapshot | undefined,
): boolean => hasCanonicalBrushStateMarkers(brushState, layerSnapshot);

const hasExportablePersistedStrokeData = (
  layer: Layer,
  strokeData: unknown,
): boolean => {
  if (!strokeData || typeof strokeData !== 'object') {
    return false;
  }
  const snapshot = strokeData as {
    paintBuffer?: unknown;
    gradientIdBuffer?: unknown;
    gradientDefIdBuffer?: unknown;
  };
  return (
    hasExportableColorCycleBuffer(snapshot.paintBuffer) &&
    (
      hasExportableColorCycleBuffer(snapshot.gradientIdBuffer) ||
      hasExportableColorCycleBuffer(layer.colorCycleData?.gradientIdBuffer)
    ) &&
    (
      hasExportableColorCycleBuffer(snapshot.gradientDefIdBuffer) ||
      hasExportableColorCycleBuffer(layer.colorCycleData?.gradientDefIdBuffer)
    )
  );
};

export const resolvePersistedColorCycleExportEligibility = (
  layer: Layer,
): PersistedColorCycleExportEligibility => {
  const brushState = layer.colorCycleData?.brushState as PersistedColorCycleBrushState | undefined;
  if (!brushState) {
    return { ok: false, reason: 'missing-brush-state' };
  }

  const entry = getPersistedColorCycleExportEntry(brushState, layer.id);
  const layerSnapshot = getLayerSnapshot(brushState, layer.id) ?? (
    brushState.layers?.length === 1 ? entry : undefined
  );
  if (!entry) {
    return { ok: false, reason: 'missing-layer-entry', brushState, layerSnapshot };
  }
  if (!hasPersistedColorCycleCanonicalMarkers(brushState, layerSnapshot)) {
    return { ok: false, reason: 'non-canonical', brushState, entry, layerSnapshot };
  }
  if (!hasSupportedPersistedColorCycleSchema(brushState, layerSnapshot)) {
    return { ok: false, reason: 'unsupported-schema', brushState, entry, layerSnapshot };
  }
  if (!hasExportablePersistedStrokeData(layer, entry.strokeData)) {
    return { ok: false, reason: 'missing-export-buffers', brushState, entry, layerSnapshot };
  }

  return {
    ok: true,
    brushState,
    entry,
    layerSnapshot,
  };
};

export const hasExportablePersistedColorCycleSource = (layer: Layer): boolean => (
  resolvePersistedColorCycleExportEligibility(layer).ok
);
