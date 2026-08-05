import { hasColorCycleWarmableRuntimeSource } from '@/lib/colorCycle/runtimeSourcePolicy';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { isColdColorCycleLayer } from '@/stores/layerHydration';
import type { Layer } from '@/types';

const getManagedDocument = (
  colorCycleBrushManager: ColorCycleBrushManager,
  layerId: string,
) => colorCycleBrushManager.getDocument?.(layerId);

export const hasWarmableColorCycleRuntimeSource = (
  colorCycleBrushManager: ColorCycleBrushManager,
  layer: Layer | null | undefined,
): boolean => hasColorCycleWarmableRuntimeSource(layer, {
  document: layer ? getManagedDocument(colorCycleBrushManager, layer.id) : undefined,
});

export const isDocumentColdColorCycleLayer = (
  colorCycleBrushManager: ColorCycleBrushManager,
  layer: Layer | null | undefined,
): boolean => isColdColorCycleLayer(
  layer,
  layer ? getManagedDocument(colorCycleBrushManager, layer.id) : undefined,
);
