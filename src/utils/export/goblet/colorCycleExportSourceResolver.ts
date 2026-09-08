import type { Layer, Project } from '@/types';
import {
  ColorCycleLayerDocument,
  normalizeColorCycleLayerDocumentState,
  cloneColorCycleSerializedBrushLayerSnapshotBuffers,
  createColorCycleCanonicalBrushStateFromDocumentSnapshot,
  getColorCycleLegacyLayerBuffers,
  deleteLegacyColorCycleTopLevelBuffers,
  type ColorCycleLayerDocumentRead,
  type ColorCycleLayerDocumentSnapshot,
  type ColorCycleLegacyLayerBuffers,
} from '@/lib/colorCycle/document';
import {
  resolveGobletColorCycleDocument,
} from '@/utils/export/goblet/colorCycleLiveBrushResolver';
import { resolvePersistedColorCycleExportEligibility } from '@/utils/export/goblet/colorCycleExportSourceEligibility';
import type { GobletColorCyclePayloadDiagnostic } from '@/utils/export/goblet/colorCyclePayloadValidation';
import { hydrateColorCycleArchiveRuntimeSnapshotForExport } from '@/utils/projectIO';

// Resolve one document read. Archive compatibility is normalized here, before
// serialization; runtime projections are never an alternate source of paint.
export type GobletColorCycleDocumentRead = Pick<ColorCycleLayerDocumentRead, 'snapshot' | 'version'>;
export type GobletColorCyclePayloadBuildSource =
  | 'document'
  | 'recolor-runtime';

export type GobletColorCycleExportSourceResult =
  | {
      ok: true;
      layerId: string;
      source: GobletColorCyclePayloadBuildSource;
      layer: Layer;
      documentRead?: GobletColorCycleDocumentRead;
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
  preservePersistedMetadata = false,
): Layer => {
  const cloned = cloneGobletExportLayer(layer);
  deleteLegacyColorCycleTopLevelBuffers(cloned.colorCycleData);
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
          brushState: preservePersistedMetadata ? cloned.colorCycleData.brushState : createColorCycleCanonicalBrushStateFromDocumentSnapshot({
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
      documentRead: { snapshot, version },
      diagnostics: [{
        code: 'document-source-selected',
        severity: 'info',
        message: `Selected color-cycle document version ${version} for Goblet export.`,
        documentVersion: version,
      }],
    };
  }

  // Cold layers hydrate into an export-local document without warming the editor
  // or changing its active layer. A failed hydration must not use stale mirrors.
  let persistedLayer = layer;
  const isCold = layer.colorCycleData.deferredRuntimeRestore || layer.colorCycleData.runtimeHydrationState === 'cold';
  try {
    if (isCold) {
      persistedLayer = await hydrateColorCycleArchiveRuntimeSnapshotForExport(layer);
    }
    const eligibility = resolvePersistedColorCycleExportEligibility(persistedLayer);
    if (eligibility.ok) {
      const normalized = normalizeColorCycleLayerDocumentState(persistedLayer, {
        fallbackWidth: persistedLayer.framebuffer?.width ?? project.width,
        fallbackHeight: persistedLayer.framebuffer?.height ?? project.height,
        decodeSerializedBrushStateBuffers: true,
      });
      if (normalized.ok) {
        const documentRead = new ColorCycleLayerDocument(normalized.state).read();
        return {
          ok: true,
          layerId: layer.id,
          source: 'document',
          documentRead,
          // Retain archived speed-source metadata: legacy effective speeds must
          // not be relabelled as newly authored speeds during normalization.
          layer: cloneLayerFromDocumentSnapshot(persistedLayer, documentRead.snapshot, documentRead.version, true),
          diagnostics: [{
            code: 'archive-document-hydrated',
            severity: 'info',
            message: 'Normalized persisted color-cycle data into an export-local document.',
            documentVersion: documentRead.version,
          }],
        };
      }
      diagnostics.push({ code: 'archive-document-rejected', severity: 'error', message: normalized.reason });
    }
  } catch (error) {
    diagnostics.push({
      code: 'archive-document-rejected',
      severity: 'error',
      message: error instanceof Error ? error.message : 'Color-cycle document hydration failed.',
    });
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
