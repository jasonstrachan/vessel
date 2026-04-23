/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  selectAutosaveSaveStatus,
  selectAutosaveSettings,
  selectCanvasPreferences,
  selectGridState,
  selectSettingsActions,
} from '@/stores/selectors/stateSelectors';

describe('stateSelectors', () => {
  const state = {
    autosave: { isEnabled: true, interval: 5 },
    canvas: { showRulers: false, transparencyBackgroundMode: 'checker' },
    setAutosaveEnabled: jest.fn(),
    setAutosaveInterval: jest.fn(),
    toggleRulers: jest.fn(),
    setTransparencyBackgroundMode: jest.fn(),
    setHistorySize: jest.fn(),
  } as any;

  it('selects autosave settings', () => {
    const result = selectAutosaveSettings(state);
    expect(result).toEqual({ isEnabled: true, interval: 5 });
  });

  it('selects canvas preferences', () => {
    const result = selectCanvasPreferences(state);
    expect(result).toEqual({ showRulers: false, transparencyBackgroundMode: 'checker' });
  });

  it('selects settings actions', () => {
    const result = selectSettingsActions(state);
    expect(result).toEqual({
      setAutosaveEnabled: state.setAutosaveEnabled,
      setAutosaveInterval: state.setAutosaveInterval,
      toggleRulers: state.toggleRulers,
      setTransparencyBackgroundMode: state.setTransparencyBackgroundMode,
      setHistorySize: state.setHistorySize,
    });
  });

  it('returns a stable fallback save status reference', () => {
    const saveStatusA = selectAutosaveSaveStatus({
      ...state,
      autosave: { ...state.autosave, saveStatus: null },
    });
    const saveStatusB = selectAutosaveSaveStatus({
      ...state,
      autosave: { ...state.autosave, saveStatus: null },
    });

    expect(saveStatusA).toBe(saveStatusB);
    expect(saveStatusA).toEqual({
      phase: 'idle',
      source: null,
      message: null,
      updatedAt: null,
    });
  });

  it('returns a stable fallback grid reference', () => {
    const gridA = selectGridState({
      ...state,
      ui: {},
    });
    const gridB = selectGridState({
      ...state,
      ui: {},
    });

    expect(gridA).toBe(gridB);
    expect(gridA).toEqual({
      enabled: false,
      rows: 8,
      columns: 8,
    });
  });
});
