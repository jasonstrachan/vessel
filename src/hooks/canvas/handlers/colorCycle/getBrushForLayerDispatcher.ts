import { getColorCycleBrushManager, getColorCycleStoreState } from '@/stores/colorCycleBrushManager';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';

export const createGetBrushForLayerDispatcher = () => {
  return (layerId: string): ColorCycleBrushImplementation | undefined =>
    (
      getColorCycleStoreState()?.getLayerColorCycleBrush?.(layerId) ??
      getColorCycleBrushManager().getBrush(layerId)
    ) as ColorCycleBrushImplementation | undefined;
};
