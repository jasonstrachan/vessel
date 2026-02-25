import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import { ensureActiveColorCycleGradientSlot } from '@/hooks/canvas/handlers/colorCycle/ensureActiveColorCycleGradientSlot';

export const createEnsureActiveColorCycleGradientSlotDispatcher = () => {
  return (
    state: AppState,
    layer: Layer,
    brush?: ColorCycleBrushImplementation | null
  ) => {
    ensureActiveColorCycleGradientSlot({ state, layer, brush });
  };
};
