import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { ManagedColorCycleBrush } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';

export const createGetBrushForLayerDispatcher = () => {
  return (layerId: string): ManagedColorCycleBrush | undefined =>
    getColorCycleBrushManager().getCommitBrush(layerId) as ManagedColorCycleBrush | undefined;
};
