import type { Layer } from '@/types';
import type { ColorCycleSerializedStateBrushContext } from '@/hooks/brushEngine/colorCycleBrushContracts';
import type { ColorCycleLayerDocumentReader } from '@/lib/colorCycle/persistence';
import {
  readColorCycleBrushSerializedStateFromRuntime,
  type ColorCycleBrushSerializedStateRuntimeReader,
} from '@/lib/colorCycle/document';
import { debugLog } from '@/utils/debug';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';

// Boundary: live runtime lookup only. This is the source of truth for direct and
// manager-backed CC brush availability during Goblet export.
export type GobletSerializableColorCycleBrush = ColorCycleBrushSerializedStateRuntimeReader & {
  getColorCycleLayerDocument?: (layerId: string) => ColorCycleLayerDocumentReader | undefined;
};
type GobletManagedSerializableBrush =
  & ColorCycleSerializedStateBrushContext
  & ColorCycleBrushSerializedStateRuntimeReader;

export const resolveGobletColorCycleLiveBrush = (
  layer: Layer,
): GobletSerializableColorCycleBrush | undefined => {
  try {
    const manager = getColorCycleBrushManager();
    const managedBrush = manager.getSerializedStateBrush(layer.id) as GobletManagedSerializableBrush | undefined;
    if (readColorCycleBrushSerializedStateFromRuntime(managedBrush)) {
      return managedBrush;
    }
  } catch (error) {
    debugLog('raw-console', '[webglExporter] Failed to resolve color cycle brush via manager', error);
  }

  const directBrush = layer.colorCycleData?.colorCycleBrush as GobletSerializableColorCycleBrush | undefined;
  if (readColorCycleBrushSerializedStateFromRuntime(directBrush)) {
    return directBrush;
  }

  return undefined;
};

export const hasGobletColorCycleLiveBrush = (layer: Layer): boolean => (
  Boolean(resolveGobletColorCycleLiveBrush(layer))
);

const isUnresolvedColdColorCycleDocument = (
  document: ColorCycleLayerDocumentReader | null | undefined,
): boolean => document?.residency === 'cold-archive-ref';

const resolveExportableGobletColorCycleDocument = (
  document: ColorCycleLayerDocumentReader | null | undefined,
): ColorCycleLayerDocumentReader | undefined => (
  document && !isUnresolvedColdColorCycleDocument(document)
    ? document
    : undefined
);

export const resolveGobletColorCycleDocument = (
  layer: Layer,
): ColorCycleLayerDocumentReader | undefined => {
  try {
    const manager = getColorCycleBrushManager();
    const managerDocument = manager.getDocument?.(layer.id);
    const exportableManagerDocument = resolveExportableGobletColorCycleDocument(managerDocument);
    if (exportableManagerDocument) {
      return exportableManagerDocument;
    }

    const managedBrush = manager.getSerializedStateBrush(layer.id) as GobletManagedSerializableBrush | undefined;
    const managedDocument = managedBrush?.getColorCycleLayerDocument?.(layer.id);
    const exportableManagedDocument = resolveExportableGobletColorCycleDocument(managedDocument);
    if (exportableManagedDocument) {
      return exportableManagedDocument;
    }
  } catch (error) {
    debugLog('raw-console', '[webglExporter] Failed to resolve color cycle document via manager', error);
  }

  const directBrush = layer.colorCycleData?.colorCycleBrush as GobletSerializableColorCycleBrush | undefined;
  return resolveExportableGobletColorCycleDocument(directBrush?.getColorCycleLayerDocument?.(layer.id));
};
