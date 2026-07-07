import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import type { ColorCycleSurfaceBrush } from '@/hooks/canvas/handlers/colorCycle/colorCycleSurface';
import { ensureActiveColorCycleGradientSlot } from '@/hooks/canvas/handlers/colorCycle/ensureActiveColorCycleGradientSlot';

export const createEnsureActiveColorCycleGradientSlotDispatcher = () => {
  return (
    state: AppState,
    layer: Layer,
    brush?: ColorCycleSurfaceBrush | null
  ) => {
    ensureActiveColorCycleGradientSlot({ state, layer, brush });
  };
};
