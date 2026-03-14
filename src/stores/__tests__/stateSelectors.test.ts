/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  selectAutosaveSettings,
  selectCanvasPreferences,
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
});
