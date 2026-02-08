import { selectEffectiveColorCyclePlaying, useAppStore } from '@/stores/useAppStore';

export const isColorCyclePlaybackActive = () =>
  selectEffectiveColorCyclePlaying(useAppStore.getState());
