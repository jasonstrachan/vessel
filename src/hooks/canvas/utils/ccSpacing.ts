import type { AppState } from '@/stores/useAppStore';
import { resolveVelocityAdjustedSpacing } from '@/utils/velocitySpacing';

export const getCcEffectiveSpacing = (
  state: AppState,
  velocityPxPerMs?: number
): number => {
  const baseSpacing = Math.max(1, Math.round(state.tools.brushSettings.spacing || 1));
  const brushSize = Math.max(1, Math.round(state.tools.brushSettings.size || 1));
  const velocityAdjustedSpacing = resolveVelocityAdjustedSpacing({
    baseSpacing,
    baseSize: brushSize,
    enabled: state.tools.brushSettings.velocitySpacingEnabled,
    speedPxPerMs: velocityPxPerMs,
  });
  return Math.max(1, Math.round(velocityAdjustedSpacing));
};
