import {
  createColorCycleBrushPersistenceLayerMetaFromLayerData,
  type ColorCycleBrushPersistenceLayerMeta,
} from '@/lib/colorCycle/document';
import type { Layer } from '@/types';

import type { SerializedLayerColorCycleMeta } from './colorCycleCanvas2DTypes';

export type ColorCycleLayerMetaRuntimeContext = {
  getLayers(): Layer[];
  mergeLayerMeta(
    layerId: string,
    fallback: ColorCycleBrushPersistenceLayerMeta | null,
  ): ColorCycleBrushPersistenceLayerMeta | null;
};

export function resolveColorCycleLayerMeta(
  context: ColorCycleLayerMetaRuntimeContext,
  layerId: string,
): SerializedLayerColorCycleMeta | null {
  const layer = context.getLayers().find((entry) => entry.id === layerId);
  const colorCycleData = layer?.layerType === 'color-cycle' ? layer.colorCycleData : null;
  const fallback = createColorCycleBrushPersistenceLayerMetaFromLayerData(colorCycleData);
  return context.mergeLayerMeta(layerId, fallback) as SerializedLayerColorCycleMeta | null;
}
