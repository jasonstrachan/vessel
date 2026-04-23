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

const EMPTY_SAVE_STATUS = Object.freeze({
  phase: 'idle' as const,
  source: null,
  message: null,
  updatedAt: null,
});

const EMPTY_GRID_STATE = Object.freeze({
  enabled: false,
  rows: 8,
  columns: 8,
});

export const selectAutosaveSaveStatus = (state: AppState) =>
  state.autosave.saveStatus ?? EMPTY_SAVE_STATUS;

export const selectGridState = (state: AppState) =>
  state.ui?.grid ?? EMPTY_GRID_STATE;
