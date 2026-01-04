import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';

jest.mock('@/stores/useAppStore', () => {
  type ColorCyclePlayback = { desiredPlaying: boolean; suspendDepth: number };
  type BrushSettings = { colorCycleSpeed: number; colorCycleFlowMode: string };
  type MockState = {
    colorCyclePlayback: ColorCyclePlayback;
    layers: Array<unknown>;
    activeLayerId: string | null;
    selectedLayerIds: string[];
    tools: { brushSettings: BrushSettings };
    updateLayer: jest.Mock;
    setBrushSettings: jest.Mock;
    playColorCycle: jest.Mock;
    pauseColorCycle: jest.Mock;
    forceResumeColorCycle: jest.Mock;
    colorCycleRuntimeHandlers: Record<string, unknown>;
  };
  type Selector<T> = (state: MockState) => T;
  type StoreHook = {
    <T>(selector?: Selector<T>): T;
    getState: () => MockState;
    setState: (updater: Partial<MockState> | ((state: MockState) => Partial<MockState>)) => void;
    subscribe: (listener: (state: MockState) => void) => () => void;
  };

  const listeners = new Set<(state: MockState) => void>();
  const state: MockState = {
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

  const useAppStore = ((selector?: Selector<unknown>) =>
    selector ? selector(state) : state) as StoreHook;
  useAppStore.getState = () => state;
  useAppStore.setState = (updater) => {
    const next = typeof updater === 'function' ? updater(state) : updater;
    Object.assign(state, next);
    listeners.forEach((listener) => listener(state));
  };
  useAppStore.subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const selectEffectiveColorCyclePlaying = (s: MockState) =>
    s.colorCyclePlayback.desiredPlaying && s.colorCyclePlayback.suspendDepth === 0;
  const selectColorCycleSuspendDepth = (s: MockState) => s.colorCyclePlayback.suspendDepth;

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
