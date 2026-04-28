import type { Layer } from '@/types';

import type {
  CaptureColorCyclePersistenceSnapshotContext,
  ColorCyclePersistenceDiagnostic,
  ColorCyclePersistenceSource,
  DeferredColorCycleArchiveRuntime,
  PersistedColorCycleBrushState,
} from './colorCyclePersistenceTypes';
import {
  classifyBrushStateFailure,
  getLayerSnapshot,
  hasCanonicalBrushStateMarkers,
} from './colorCyclePersistenceValidation';

export type ResolvedColorCyclePersistenceSource =
  | {
      ok: true;
      source: ColorCyclePersistenceSource;
      brushState: PersistedColorCycleBrushState;
      deferredRuntime?: DeferredColorCycleArchiveRuntime;
      diagnostics: ColorCyclePersistenceDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: ColorCyclePersistenceDiagnostic[];
    };

const emitDiagnostics = (
  diagnostics: ColorCyclePersistenceDiagnostic[],
  context: CaptureColorCyclePersistenceSnapshotContext,
): void => {
  diagnostics.forEach((diagnostic) => context.diagnostics?.(diagnostic));
};

const captureRuntimeBrushState = (
  layer: Layer,
  context: CaptureColorCyclePersistenceSnapshotContext,
): PersistedColorCycleBrushState | undefined => {
  const brush =
    context.runtimeBrush ??
    context.runtimeBrushManager?.getLayerColorCycleBrush?.(layer.id) ??
    context.runtimeBrushManager?.getBrush?.(layer.id) ??
    (layer.colorCycleData?.colorCycleBrush as { getFullState?: () => unknown; serialize?: () => unknown } | undefined);
  if (!brush) {
    return undefined;
  }
  const rawState =
    typeof brush.getFullState === 'function'
      ? brush.getFullState()
      : typeof brush.serialize === 'function'
        ? brush.serialize()
        : undefined;
  const brushState = context.serializeRuntimeBrushState
    ? context.serializeRuntimeBrushState(rawState, layer.id)
    : rawState as PersistedColorCycleBrushState | undefined;
  const snapshot = getLayerSnapshot(brushState, layer.id);
  return snapshot ? {
    ...brushState,
    canonicalPaint: true,
    schemaVersion: 1,
    layers: brushState?.layers?.map((entry) => (
      entry.layerId === layer.id
        ? { ...entry, canonicalPaint: true, schemaVersion: 1 }
        : entry
    )),
  } : undefined;
};

const getDeferredRuntime = (
  layer: Layer,
  context: CaptureColorCyclePersistenceSnapshotContext,
): DeferredColorCycleArchiveRuntime | undefined => (
  context.deferredRuntime ?? context.layerRuntimeCache?.getDeferredRuntime?.(layer.id)
);

const archiveRefExists = (
  ref: string | undefined,
  context: CaptureColorCyclePersistenceSnapshotContext,
): boolean => {
  if (!ref || !context.archiveManifest) {
    return true;
  }
  const path = ref.startsWith('zip:') ? ref.slice('zip:'.length) : ref;
  return Boolean(context.archiveManifest.has?.(path) ?? context.archiveManifest.get?.(path));
};

const getMissingDeferredArchiveRefs = (
  runtime: DeferredColorCycleArchiveRuntime,
  context: CaptureColorCyclePersistenceSnapshotContext,
): string[] => {
  const refs = [
    runtime.paintRef,
    runtime.speedRef,
    runtime.flowRef,
    runtime.phaseRef,
    runtime.gradientIdRef,
    runtime.gradientDefIdRef,
    ...((runtime.brushState?.layers ?? []).flatMap((snapshot) => [
      snapshot.strokeData?.paintBuffer,
      snapshot.strokeData?.speedBuffer,
      snapshot.strokeData?.flowBuffer,
      snapshot.strokeData?.phaseBuffer,
      snapshot.strokeData?.gradientIdBuffer,
      snapshot.strokeData?.gradientDefIdBuffer,
    ])),
  ].filter((ref): ref is string => typeof ref === 'string' && ref.startsWith('zip:'));

  return refs.filter((ref) => !archiveRefExists(ref, context));
};

export const resolveColorCyclePersistenceSource = (
  layer: Layer,
  context: CaptureColorCyclePersistenceSnapshotContext,
): ResolvedColorCyclePersistenceSource => {
  const diagnostics: ColorCyclePersistenceDiagnostic[] = [];

  try {
    const runtimeBrushState = captureRuntimeBrushState(layer, context);
    if (runtimeBrushState) {
      diagnostics.push({
        source: 'live-runtime',
        kind: 'source-selected',
        message: 'Selected live runtime as color-cycle persistence source.',
      });
      emitDiagnostics(diagnostics, context);
      return {
        ok: true,
        source: 'live-runtime',
        brushState: runtimeBrushState,
        diagnostics,
      };
    }
  } catch (error) {
    diagnostics.push({
      source: 'live-runtime',
      kind: 'source-rejected',
      message: error instanceof Error ? error.message : 'Live runtime capture failed.',
    });
  }

  const deferredRuntime = getDeferredRuntime(layer, context);
  if (deferredRuntime) {
    const missingRefs = getMissingDeferredArchiveRefs(deferredRuntime, context);
    if (missingRefs.length > 0) {
      diagnostics.push({
        source: 'deferred-archive',
        kind: 'missing-archive-ref',
        fields: missingRefs,
        message: 'Deferred archive source references missing binary entries.',
      });
    } else {
      diagnostics.push({
        source: 'deferred-archive',
        kind: 'source-selected',
        message: 'Selected deferred archive as color-cycle persistence source.',
      });
      emitDiagnostics(diagnostics, context);
      return {
        ok: true,
        source: 'deferred-archive',
        brushState: {
          ...(deferredRuntime.brushState ?? { layers: [] }),
          canonicalPaint: true,
          schemaVersion: 1,
        },
        deferredRuntime,
        diagnostics,
      };
    }
  }

  const persistedBrushState = layer.colorCycleData?.brushState as PersistedColorCycleBrushState | undefined;
  const persistedSnapshot = getLayerSnapshot(persistedBrushState, layer.id);
  if (persistedBrushState && hasCanonicalBrushStateMarkers(persistedBrushState, persistedSnapshot)) {
    diagnostics.push({
      source: 'persisted-brush-state',
      kind: 'source-selected',
      message: 'Selected marked persisted brush state as color-cycle persistence source.',
    });
    emitDiagnostics(diagnostics, context);
    return {
      ok: true,
      source: 'persisted-brush-state',
      brushState: persistedBrushState,
      diagnostics,
    };
  }

  if (persistedBrushState) {
    diagnostics.push(...classifyBrushStateFailure(persistedBrushState, persistedSnapshot).diagnostics);
  }
  emitDiagnostics(diagnostics, context);
  return { ok: false, diagnostics };
};
