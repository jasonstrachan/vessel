import { useAppStore, type AppState } from '@/stores/useAppStore';

export const getAppStoreState = (): AppState => useAppStore.getState();
