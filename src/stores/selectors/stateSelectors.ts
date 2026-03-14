import type { AppState } from '@/stores/useAppStore';

export const selectAutosaveSettings = (state: AppState) => ({
  isEnabled: state.autosave.isEnabled,
  interval: state.autosave.interval,
});

export const selectCanvasPreferences = (state: AppState) => ({
  showRulers: state.canvas.showRulers,
  transparencyBackgroundMode: state.canvas.transparencyBackgroundMode,
});

export const selectSettingsActions = (state: AppState) => ({
  setAutosaveEnabled: state.setAutosaveEnabled,
  setAutosaveInterval: state.setAutosaveInterval,
  toggleRulers: state.toggleRulers,
  setTransparencyBackgroundMode: state.setTransparencyBackgroundMode,
  setHistorySize: state.setHistorySize,
});
