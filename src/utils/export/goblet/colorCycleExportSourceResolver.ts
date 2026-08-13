import type { Layer, Project } from '@/types';
import {
  cloneColorCycleSerializedBrushLayerSnapshotBuffers,
  createColorCycleCanonicalBrushStateFromDocumentSnapshot,
  getColorCycleLegacyLayerBuffers,
  type ColorCycleLayerDocumentSnapshot,
  type ColorCycleLegacyLayerBuffers,
} from '@/lib/colorCycle/document';
import {
  resolveGobletColorCycleDocument,
  resolveGobletColorCycleLiveBrush,
} from '@/utils/export/goblet/colorCycleLiveBrushResolver';
import { resolvePersistedColorCycleExportEligibility } from '@/utils/export/goblet/colorCycleExportSourceEligibility';
import type { GobletColorCyclePayloadDiagnostic } from '@/utils/export/goblet/colorCyclePayloadValidation';
import { hydrateColorCycleArchiveRuntimeSnapshotForExport } from '@/utils/projectIO';

// Boundary: source ordering only. Do not validate final payload buffer lengths here;
// persisted and live availability must come from the shared source helpers.
export type GobletColorCyclePayloadBuildSource =
  | 'document'
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

const cloneColorCycleDataWithLegacyBuffers = (
  colorCycleData: NonNullable<Layer['colorCycleData']>,
  legacyBuffers: ColorCycleLegacyLayerBuffers,
): NonNullable<Layer['colorCycleData']> => {
  const cloned = { ...colorCycleData } as NonNullable<Layer['colorCycleData']> & ColorCycleLegacyLayerBuffers;
  for (const [key, buffer] of Object.entries(legacyBuffers) as Array<[
    keyof ColorCycleLegacyLayerBuffers,
    ArrayBuffer | undefined,
  ]>) {
    if (buffer) {
      cloned[key] = buffer.slice(0);
    }
  }
  return cloned;
};

export const cloneGobletExportLayer = (layer: Layer): Layer => {
  const colorCycleData = layer.colorCycleData
    ? cloneColorCycleDataWithLegacyBuffers(
        {
          ...layer.colorCycleData,
          brushState: layer.colorCycleData.brushState && typeof layer.colorCycleData.brushState === 'object'
            ? {
                ...(layer.colorCycleData.brushState as Record<string, unknown>),
                layers: Array.isArray((layer.colorCycleData.brushState as { layers?: unknown }).layers)
                  ? ((layer.colorCycleData.brushState as { layers: Array<Record<string, unknown>> }).layers)
                    .map(cloneColorCycleSerializedBrushLayerSnapshotBuffers)
                  : (layer.colorCycleData.brushState as { layers?: unknown }).layers,
              } as NonNullable<Layer['colorCycleData']>['brushState']
            : layer.colorCycleData.brushState,
        },
        getColorCycleLegacyLayerBuffers(layer),
      )
    : layer.colorCycleData;
  return {
    ...layer,
    colorCycleData,
  };
};

const cloneLayerFromDocumentSnapshot = (
  layer: Layer,
  snapshot: ColorCycleLayerDocumentSnapshot,
  version: number,
): Layer => {
  const cloned = cloneGobletExportLayer(layer);
  const existingBrushState = cloned.colorCycleData?.brushState && typeof cloned.colorCycleData.brushState === 'object'
    ? cloned.colorCycleData.brushState as Record<string, unknown>
    : {};
  const slotPalettes = snapshot.slotPalettes?.map((entry) => ({
    ...entry,
    stops: entry.stops.map((stop) => ({ ...stop })),
  }));
  const gradientDefs = snapshot.gradientDefs?.map((entry) => ({ ...entry }));
  const gradientDefStore = snapshot.gradientDefStore?.map((entry) => ({
    ...entry,
    stops: entry.stops.map((stop) => ({ ...stop })),
    sourceStops: entry.sourceStops?.map((stop) => ({ ...stop })),
  }));

  return {
    ...cloned,
    colorCycleData: cloned.colorCycleData
      ? {
          ...cloned.colorCycleData,
          colorCycleBrush: undefined,
          canvasWidth: snapshot.width,
          canvasHeight: snapshot.height,
          hasContent: snapshot.hasContent,
          slotPalettes,
          gradientDefs,
          gradientDefStore,
          paintSlot: snapshot.paintSlot,
          fgActiveSlot: snapshot.fgActiveSlot,
          activeGradientId: snapshot.activeGradientId,
          layerBaseSpeedCps: snapshot.layerBaseSpeedCps,
          flowMode: snapshot.flowMode,
          brushState: createColorCycleCanonicalBrushStateFromDocumentSnapshot({
            layerId: layer.id,
            snapshot,
            version,
            existingBrushState,
          }) as NonNullable<Layer['colorCycleData']>['brushState'] ?? cloned.colorCycleData.brushState,
        }
      : cloned.colorCycleData,
  };
};

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
  const document = resolveGobletColorCycleDocument(layer);
  if (document) {
    const { snapshot, version } = document.read();
    return {
      ok: true,
      layerId: layer.id,
      source: 'document',
      layer: cloneLayerFromDocumentSnapshot(layer, snapshot, version),
      diagnostics: [{
        code: 'document-source-selected',
        severity: 'info',
        message: `Selected color-cycle document version ${version} for Goblet export.`,
        documentVersion: version,
      }],
    };
  }

  if (layer.colorCycleData.deferredRuntimeRestore || layer.colorCycleData.runtimeHydrationState === 'cold') {
    try {
      const hydratedLayer = await hydrateColorCycleArchiveRuntimeSnapshotForExport(layer);
      if (resolvePersistedColorCycleExportEligibility(hydratedLayer).ok) {
        return {
          ok: true,
          layerId: layer.id,
          source: 'hydrated-archive-document-state',
          layer: cloneGobletExportLayer(hydratedLayer),
          diagnostics: [{
            code: 'hydrated-archive-document-state-selected',
            severity: 'info',
            message: 'Selected hydrated color-cycle archive state for Goblet export.',
          }],
        };
      }
    } catch (error) {
      diagnostics.push({
        code: 'hydrated-archive-document-state-rejected',
        severity: 'warning',
        message: error instanceof Error
          ? error.message
          : 'Color-cycle archive hydration failed during Goblet export.',
      });
    }
  }

  if (resolvePersistedColorCycleExportEligibility(layer).ok) {
    return {
      ok: true,
      layerId: layer.id,
      source: 'persisted-brush-state',
      layer: cloneGobletExportLayer(layer),
      diagnostics: [{
        code: 'persisted-brush-state-selected',
        severity: 'info',
        message: 'Selected persisted color-cycle brush state for Goblet export.',
      }],
    };
  }

  if (resolveGobletColorCycleLiveBrush(layer)) {
    return {
      ok: true,
      layerId: layer.id,
      source: 'live-runtime',
      layer: cloneGobletExportLayer(layer),
      diagnostics: [{
        code: 'live-runtime-source-selected',
        severity: 'info',
        message: 'Selected live color-cycle runtime for Goblet export.',
      }],
    };
  }

  return {
    ok: false,
    layerId: layer.id,
    reason: 'missing-color-cycle-document',
    diagnostics: [...diagnostics, {
      code: 'missing-color-cycle-document',
      severity: 'error',
      message: 'No color-cycle document is available for Goblet export.',
    }],
  };
};
