import { getAppStoreState } from '@/stores/appStoreAccess';
import { selectEffectiveColorCyclePlaying } from '@/stores/useAppStore';

export const isColorCyclePlaybackActive = () =>
  selectEffectiveColorCyclePlaying(getAppStoreState());
