import type { AppState } from '@/stores/useAppStore';

export const selectModals = (state: AppState) => state.ui.modals;
