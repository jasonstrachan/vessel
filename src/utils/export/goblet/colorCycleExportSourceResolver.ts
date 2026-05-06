import type { Layer, Project } from '@/types';
import { hasExportablePersistedColorCycleSource } from '@/utils/export/goblet/colorCycleExportSourceEligibility';
import { hasGobletColorCycleLiveBrush } from '@/utils/export/goblet/colorCycleLiveBrushResolver';
import type { GobletColorCyclePayloadDiagnostic } from '@/utils/export/goblet/colorCyclePayloadValidation';

// Boundary: source ordering only. Do not validate final payload buffer lengths here;
// persisted and live availability must come from the shared source helpers.
export type GobletColorCyclePayloadBuildSource =
  | 'hydrated-archive-document-state'
  | 'persisted-brush-state'
  | 'live-runtime'
  | 'recolor-runtime';

export type GobletColorCycleExportSourceResult =
  | {
      ok: true;
      layerId: string;
      source: GobletColorCyclePayloadBuildSource;
      layer: Layer;
      diagnostics: GobletColorCyclePayloadDiagnostic[];
    }
  | {
      ok: false;
      layerId: string;
      reason: string;
      diagnostics: GobletColorCyclePayloadDiagnostic[];
    };

const cloneArrayBuffer = (value: unknown): ArrayBuffer | undefined => (
  value instanceof ArrayBuffer ? value.slice(0) : undefined
);

const cloneStrokeData = <T extends { strokeData?: Record<string, unknown> }>(entry: T): T => {
  if (!entry.strokeData) {
    return { ...entry };
  }
  return {
    ...entry,
    strokeData: {
      ...entry.strokeData,
      paintBuffer: cloneArrayBuffer(entry.strokeData.paintBuffer) ?? entry.strokeData.paintBuffer,
      gradientIdBuffer: cloneArrayBuffer(entry.strokeData.gradientIdBuffer) ?? entry.strokeData.gradientIdBuffer,
      gradientDefIdBuffer: cloneArrayBuffer(entry.strokeData.gradientDefIdBuffer) ?? entry.strokeData.gradientDefIdBuffer,
      speedBuffer: cloneArrayBuffer(entry.strokeData.speedBuffer) ?? entry.strokeData.speedBuffer,
      flowBuffer: cloneArrayBuffer(entry.strokeData.flowBuffer) ?? entry.strokeData.flowBuffer,
      phaseBuffer: cloneArrayBuffer(entry.strokeData.phaseBuffer) ?? entry.strokeData.phaseBuffer,
    },
  };
};

export const cloneGobletExportLayer = (layer: Layer): Layer => {
  const colorCycleData = layer.colorCycleData
    ? {
        ...layer.colorCycleData,
        gradientIdBuffer: cloneArrayBuffer(layer.colorCycleData.gradientIdBuffer) ?? layer.colorCycleData.gradientIdBuffer,
        gradientDefIdBuffer: cloneArrayBuffer(layer.colorCycleData.gradientDefIdBuffer) ?? layer.colorCycleData.gradientDefIdBuffer,
        phaseBuffer: cloneArrayBuffer(layer.colorCycleData.phaseBuffer) ?? layer.colorCycleData.phaseBuffer,
        brushState: layer.colorCycleData.brushState && typeof layer.colorCycleData.brushState === 'object'
          ? {
              ...(layer.colorCycleData.brushState as Record<string, unknown>),
              layers: Array.isArray((layer.colorCycleData.brushState as { layers?: unknown }).layers)
                ? ((layer.colorCycleData.brushState as { layers: Array<Record<string, unknown>> }).layers).map(cloneStrokeData)
                : (layer.colorCycleData.brushState as { layers?: unknown }).layers,
            } as NonNullable<Layer['colorCycleData']>['brushState']
          : layer.colorCycleData.brushState,
      }
    : layer.colorCycleData;
  return {
    ...layer,
    colorCycleData,
  };
};

const hasHydratedArchiveDocumentState = (layer: Layer): boolean => hasExportablePersistedColorCycleSource(layer);

export const resolveGobletColorCycleExportSource = async (
  layer: Layer,
  project: Project,
): Promise<GobletColorCycleExportSourceResult> => {
  void project;
  if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return {
      ok: false,
      layerId: layer.id,
      reason: 'not-color-cycle-layer',
      diagnostics: [{
        code: 'not-color-cycle-layer',
        severity: 'error',
        message: 'Layer is not a color-cycle layer.',
      }],
    };
  }

  if (layer.colorCycleData.recolorSettings) {
    return {
      ok: true,
      layerId: layer.id,
      source: 'recolor-runtime',
      layer: cloneGobletExportLayer(layer),
      diagnostics: [],
    };
  }

  const diagnostics: GobletColorCyclePayloadDiagnostic[] = [];

  if (
    layer.colorCycleData.runtimeHydrationState === 'cold' ||
    layer.colorCycleData.runtimeHydrationState === 'warm' ||
    layer.colorCycleData.deferredRuntimeRestore === true
  ) {
    try {
      const projectIO = await import('@/utils/projectIO');
      const hydrated = await projectIO.hydrateColorCycleArchiveRuntimeSnapshotForExport(layer);
      if (hasHydratedArchiveDocumentState(hydrated)) {
        return {
          ok: true,
          layerId: layer.id,
          source: 'hydrated-archive-document-state',
          layer: cloneGobletExportLayer(hydrated),
          diagnostics: [{
            code: 'hydrated-export-local-archive-state',
            severity: 'info',
            message: 'Color-cycle archive data was materialized into an export-local layer snapshot.',
          }],
        };
      }
      diagnostics.push({
        code: 'archive-hydration-empty',
        severity: 'warning',
        message: 'No exportable color-cycle archive snapshot was materialized; trying persisted and live sources.',
      });
    } catch (error) {
      diagnostics.push({
        code: 'missing-archive-ref',
        severity: 'warning',
        message: error instanceof Error ? error.message : 'Failed to hydrate color-cycle archive data.',
      });
    }
  }

  if (hasExportablePersistedColorCycleSource(layer)) {
    const resolvedLayer = cloneGobletExportLayer(layer);
    if (resolvedLayer.colorCycleData) {
      resolvedLayer.colorCycleData.colorCycleBrush = undefined;
    }
    return {
      ok: true,
      layerId: layer.id,
      source: 'persisted-brush-state',
      layer: resolvedLayer,
      diagnostics,
    };
  }

  if (hasGobletColorCycleLiveBrush(layer)) {
    return {
      ok: true,
      layerId: layer.id,
      source: 'live-runtime',
      layer: cloneGobletExportLayer(layer),
      diagnostics: [...diagnostics, {
        code: 'live-runtime-source-selected',
        severity: 'info',
        message: 'No persisted export snapshot was available; using live runtime state.',
      }],
    };
  }

  return {
    ok: false,
    layerId: layer.id,
    reason: 'missing-color-cycle-source',
    diagnostics: [...diagnostics, {
      code: 'missing-color-cycle-source',
      severity: 'error',
      message: 'No archive, persisted brush, or live runtime color-cycle source is available.',
    }],
  };
};
