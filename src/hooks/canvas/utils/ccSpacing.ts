import type { AppState } from '@/stores/useAppStore';

export const getCcEffectiveSpacing = (state: AppState): number => {
  return Math.max(1, Math.round(state.tools.brushSettings.spacing || 1));
};
