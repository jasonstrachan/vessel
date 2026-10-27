import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SettingsModal } from '@/components/modals/SettingsModal';
import { mergeLocalSettings } from '@/utils/localSettings';

const mockState = {
  canvas: {
    showRulers: false,
    showFPSMeter: false,
    showPixelGridAtMaxZoom: true,
    transparencyBackgroundMode: 'checker',
    frameColor: '#000000',
  },
  autosave: { isEnabled: false, interval: 5 },
  history: { maxHistorySize: 50 },
  ui: { settingsSection: 'display' },
  project: null,
  layers: [],
  setAutosaveEnabled: jest.fn(),
  setAutosaveInterval: jest.fn(),
  setHistorySize: jest.fn(),
  toggleRulers: jest.fn(),
  setShowFPSMeter: jest.fn(),
  setShowPixelGridAtMaxZoom: jest.fn(),
  setTransparencyBackgroundMode: jest.fn(),
  setFrameColor: jest.fn(),
  setSettingsSection: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: (select: (state: typeof mockState) => unknown) => select(mockState),
}));
jest.mock('@/stores/appStoreAccess', () => ({
  getAppStoreState: () => mockState,
}));
jest.mock('@/hooks/useKeyboardScope', () => ({ useKeyboardScope: jest.fn() }));
jest.mock('@/utils/projectIO', () => ({ getProjectSaveSizeReport: jest.fn() }));
jest.mock('@/utils/localSettings', () => ({ mergeLocalSettings: jest.fn(() => true) }));

const advance = (milliseconds: number) => act(() => { jest.advanceTimersByTime(milliseconds); });
const heading = () => screen.queryByRole('heading', { name: 'Settings' });

describe('SettingsModal transition lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('keeps a quickly opened startup modal mounted beyond the previous closed deadline', () => {
    const onClose = jest.fn();
    const { rerender } = render(<SettingsModal isOpen={false} onClose={onClose} />);
    advance(100);
    rerender(<SettingsModal isOpen onClose={onClose} />);
    advance(10);
    expect(heading()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Autosave' })).toBeInTheDocument();
    advance(290);
    expect(heading()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Autosave' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps a reopened modal mounted after the superseded close transition', () => {
    const onClose = jest.fn();
    const { rerender } = render(<SettingsModal isOpen onClose={onClose} />);
    advance(10);
    rerender(<SettingsModal isOpen={false} onClose={onClose} />);
    advance(100);
    rerender(<SettingsModal isOpen onClose={onClose} />);
    advance(10);
    expect(heading()).toBeInTheDocument();
    advance(290);
    expect(heading()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('retains an ordinary closing modal until its 300ms transition ends', () => {
    const onClose = jest.fn();
    const { rerender } = render(<SettingsModal isOpen onClose={onClose} />);
    advance(10);
    rerender(<SettingsModal isOpen={false} onClose={onClose} />);
    advance(299);
    expect(heading()).toBeInTheDocument();
    advance(1);
    expect(heading()).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps an initially open modal mounted and saves once through public Escape', () => {
    const onClose = jest.fn();
    render(<SettingsModal isOpen onClose={onClose} />);
    advance(400);
    expect(heading()).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mergeLocalSettings).toHaveBeenCalledTimes(1);
    expect(mergeLocalSettings).toHaveBeenCalledWith({
      autosave: { isEnabled: false, interval: 5 },
      canvas: mockState.canvas,
      history: { maxHistorySize: 50 },
    });
  });
});
