import type { AppState } from '@/stores/useAppStore';

export const selectAutosaveSettings = (state: AppState) => ({
  isEnabled: state.autosave.isEnabled,
  interval: state.autosave.interval,
});

export const selectCanvasPreferences = (state: AppState) => ({
  showRulers: state.canvas.showRulers,
});

export const selectSettingsActions = (state: AppState) => ({
  setAutosaveEnabled: state.setAutosaveEnabled,
  setAutosaveInterval: state.setAutosaveInterval,
  toggleRulers: state.toggleRulers,
  setHistorySize: state.setHistorySize,
});
