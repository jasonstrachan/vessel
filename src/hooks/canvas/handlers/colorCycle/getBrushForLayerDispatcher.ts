import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';

export const createGetBrushForLayerDispatcher = () => {
  return (layerId: string): ColorCycleBrushImplementation | undefined =>
    getColorCycleBrushManager().getBrush(layerId) as ColorCycleBrushImplementation | undefined;
};
