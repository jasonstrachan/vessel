import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';

jest.mock('@/stores/useAppStore', () => {
  const listeners = new Set<(state: any) => void>();
  const state: any = {
    colorCyclePlayback: { desiredPlaying: false, suspendDepth: 0 },
    layers: [],
    activeLayerId: null,
    selectedLayerIds: [],
    tools: { brushSettings: { colorCycleSpeed: 0.1, colorCycleFlowMode: 'reverse' } },
    updateLayer: jest.fn(),
    setBrushSettings: jest.fn(),
    playColorCycle: jest.fn(),
    pauseColorCycle: jest.fn(),
    forceResumeColorCycle: jest.fn(),
    colorCycleRuntimeHandlers: {},
  };

  const useAppStore = ((selector?: (s: any) => any) =>
    selector ? selector(state) : state) as any;
  useAppStore.getState = () => state;
  useAppStore.setState = (updater: any) => {
    const next = typeof updater === 'function' ? updater(state) : updater;
    Object.assign(state, next);
    listeners.forEach((listener) => listener(state));
  };
  useAppStore.subscribe = (listener: (s: any) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const selectEffectiveColorCyclePlaying = (s: any) =>
    s.colorCyclePlayback.desiredPlaying && s.colorCyclePlayback.suspendDepth === 0;
  const selectColorCycleSuspendDepth = (s: any) => s.colorCyclePlayback.suspendDepth;

  return {
    useAppStore,
    selectEffectiveColorCyclePlaying,
    selectColorCycleSuspendDepth,
  };
});

jest.mock('@/components/ui/ProgressSlider', () => {
  const ProgressSliderMock = () => <div data-testid="progress-slider" />;
  ProgressSliderMock.displayName = 'ProgressSliderMock';
  return { __esModule: true, default: ProgressSliderMock };
});

jest.mock('@/components/ui/ButtonGroup', () => {
  const ButtonGroupMock = () => <div data-testid="button-group" />;
  ButtonGroupMock.displayName = 'ButtonGroupMock';
  return { __esModule: true, default: ButtonGroupMock };
});

import AnimationControlsPanel from '@/components/panels/AnimationControlsPanel';
import { useAppStore } from '@/stores/useAppStore';

describe('AnimationControlsPanel playback button', () => {
  beforeEach(() => {
    const store = useAppStore.getState();
    (store.playColorCycle as jest.Mock).mockClear();
    (store.pauseColorCycle as jest.Mock).mockClear();
    (store.forceResumeColorCycle as jest.Mock).mockClear();
    useAppStore.setState({
      colorCyclePlayback: { desiredPlaying: false, suspendDepth: 0 },
    });
  });

  it('pauses when effective playback is active', () => {
    useAppStore.setState({
      colorCyclePlayback: { desiredPlaying: true, suspendDepth: 0 },
    });

    render(<AnimationControlsPanel />);

    fireEvent.click(screen.getByRole('button', { name: /pause/i }));

    const store = useAppStore.getState();
    expect(store.pauseColorCycle).toHaveBeenCalledWith('toolbar');
    expect(store.playColorCycle).not.toHaveBeenCalled();
  });

  it('plays and force-resumes when suspended', () => {
    useAppStore.setState({
      colorCyclePlayback: { desiredPlaying: true, suspendDepth: 2 },
    });

    render(<AnimationControlsPanel />);

    fireEvent.click(screen.getByRole('button', { name: /play/i }));

    const store = useAppStore.getState();
    expect(store.playColorCycle).toHaveBeenCalledWith('toolbar');
    expect(store.forceResumeColorCycle).toHaveBeenCalledWith('toolbar');
  });

  it('plays without force-resume when not suspended', () => {
    useAppStore.setState({
      colorCyclePlayback: { desiredPlaying: false, suspendDepth: 0 },
    });

    render(<AnimationControlsPanel />);

    fireEvent.click(screen.getByRole('button', { name: /play/i }));

    const store = useAppStore.getState();
    expect(store.playColorCycle).toHaveBeenCalledWith('toolbar');
    expect(store.forceResumeColorCycle).not.toHaveBeenCalled();
  });
});
