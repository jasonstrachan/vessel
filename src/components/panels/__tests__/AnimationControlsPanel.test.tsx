import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';

jest.mock('@/stores/useAppStore', () => {
  type ColorCyclePlayback = { desiredPlaying: boolean; suspendDepth: number };
  type Layer = { id: string; layerType: 'normal' | 'color-cycle' | 'sequential' };
  type SequentialRecord = {
    fps: number;
    frameCount: number;
    timeSmear: number;
    currentFrame: number;
    isPointerDown: boolean;
  };
  type MockState = {
    colorCyclePlayback: ColorCyclePlayback;
    layers: Layer[];
    activeLayerId: string | null;
    sequentialRecord: SequentialRecord;
    playColorCycle: jest.Mock;
    pauseColorCycle: jest.Mock;
    forceResumeColorCycle: jest.Mock;
    setRecordFPS: jest.Mock;
    setRecordFrameCount: jest.Mock;
    setTimeSmear: jest.Mock;
    setBrushSettings: jest.Mock;
    tools: {
      brushSettings: {
        colorCycleLayerSpeedScale?: number;
      };
    };
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
    layers: [{ id: 'layer-regular', layerType: 'normal' }],
    activeLayerId: 'layer-regular',
    sequentialRecord: {
      fps: 12,
      frameCount: 12,
      timeSmear: 1,
      currentFrame: 0,
      isPointerDown: false,
    },
    playColorCycle: jest.fn(),
    pauseColorCycle: jest.fn(),
    forceResumeColorCycle: jest.fn(),
    setRecordFPS: jest.fn(),
    setRecordFrameCount: jest.fn(),
    setTimeSmear: jest.fn(),
    setBrushSettings: jest.fn((updates: { colorCycleLayerSpeedScale?: number }) => {
      state.tools.brushSettings = {
        ...state.tools.brushSettings,
        ...updates,
      };
    }),
    tools: {
      brushSettings: {
        colorCycleLayerSpeedScale: 1,
      },
    },
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
  const selectSequentialRecordState = (s: MockState) => s.sequentialRecord;
  const selectSequentialPlaybackActive = (s: MockState) => {
    const activeLayer = s.layers.find((layer) => layer.id === s.activeLayerId);
    return s.colorCyclePlayback.desiredPlaying && activeLayer?.layerType === 'sequential';
  };
  const selectSequentialCaptureActive = (s: MockState) =>
    s.sequentialRecord.isPointerDown &&
    s.layers.some((layer) => layer.id === s.activeLayerId && layer.layerType === 'sequential');

  return {
    useAppStore,
    selectEffectiveColorCyclePlaying,
    selectColorCycleSuspendDepth,
    selectSequentialRecordState,
    selectSequentialPlaybackActive,
    selectSequentialCaptureActive,
  };
});

import AnimationControlsPanel from '@/components/panels/AnimationControlsPanel';
import { useAppStore } from '@/stores/useAppStore';

const SEQUENTIAL_PANEL_EXPANDED_STORAGE_KEY = 'vessel-sequential-panel-expanded';

type PanelMockState = {
  colorCyclePlayback: { desiredPlaying: boolean; suspendDepth: number };
  layers: Array<{ id: string; layerType: 'normal' | 'color-cycle' | 'sequential' }>;
  activeLayerId: string | null;
  sequentialRecord: {
    fps: number;
    frameCount: number;
    timeSmear: number;
    currentFrame: number;
    isPointerDown: boolean;
  };
  playColorCycle: jest.Mock;
  pauseColorCycle: jest.Mock;
  forceResumeColorCycle: jest.Mock;
  setRecordFPS: jest.Mock;
  setRecordFrameCount: jest.Mock;
  setTimeSmear: jest.Mock;
  setBrushSettings: jest.Mock;
  tools: {
    brushSettings: {
      colorCycleLayerSpeedScale?: number;
    };
  };
};

const appStore = useAppStore as unknown as {
  getState: () => PanelMockState;
  setState: (updater: Partial<PanelMockState>) => void;
};

describe('AnimationControlsPanel', () => {
  beforeEach(() => {
    window.localStorage.removeItem(SEQUENTIAL_PANEL_EXPANDED_STORAGE_KEY);
    const store = appStore.getState();
    store.playColorCycle.mockClear();
    store.pauseColorCycle.mockClear();
    store.forceResumeColorCycle.mockClear();
    store.setRecordFPS.mockClear();
    store.setRecordFrameCount.mockClear();
    store.setTimeSmear.mockClear();
    store.setBrushSettings.mockClear();
    appStore.setState({
      colorCyclePlayback: { desiredPlaying: false, suspendDepth: 0 },
      layers: [{ id: 'layer-regular', layerType: 'normal' }],
      activeLayerId: 'layer-regular',
      sequentialRecord: {
        fps: 12,
        frameCount: 12,
        timeSmear: 1,
        currentFrame: 0,
        isPointerDown: false,
      },
      tools: {
        brushSettings: {
          colorCycleLayerSpeedScale: 1,
        },
      },
    });
  });

  it('pauses when effective playback is active', () => {
    appStore.setState({
      colorCyclePlayback: { desiredPlaying: true, suspendDepth: 0 },
    });

    render(<AnimationControlsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));

    const store = appStore.getState();
    expect(store.pauseColorCycle).toHaveBeenCalledWith('toolbar');
    expect(store.playColorCycle).not.toHaveBeenCalled();
  });

  it('plays and force-resumes when suspended', () => {
    appStore.setState({
      colorCyclePlayback: { desiredPlaying: true, suspendDepth: 2 },
    });

    render(<AnimationControlsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /play/i }));

    const store = appStore.getState();
    expect(store.playColorCycle).toHaveBeenCalledWith('toolbar');
    expect(store.forceResumeColorCycle).toHaveBeenCalledWith('toolbar');
  });

  it('disables sequential controls while capturing', () => {
    appStore.setState({
      colorCyclePlayback: { desiredPlaying: false, suspendDepth: 0 },
      layers: [{ id: 'layer-seq', layerType: 'sequential' }],
      activeLayerId: 'layer-seq',
      sequentialRecord: {
        fps: 12,
        frameCount: 24,
        timeSmear: 1.5,
        currentFrame: 2,
        isPointerDown: true,
      },
    });

    render(<AnimationControlsPanel />);

    expect(screen.getByRole('spinbutton', { name: /fps/i })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: /frames/i })).toBeDisabled();
    expect(screen.queryByText(/capture active\. changes apply next take\./i)).not.toBeInTheDocument();
  });

  it('shows sequential controls even when active layer is not sequential', () => {
    appStore.setState({
      layers: [{ id: 'layer-regular', layerType: 'normal' }],
      activeLayerId: 'layer-regular',
      sequentialRecord: {
        fps: 12,
        frameCount: 24,
        timeSmear: 1,
        currentFrame: 0,
        isPointerDown: false,
      },
    });

    render(<AnimationControlsPanel />);

    expect(screen.getByText('Sequential')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /fps/i })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /frames/i })).toBeInTheDocument();
  });

  it('shows pause while sequential capture is active and returns to play on pointer up', () => {
    appStore.setState({
      colorCyclePlayback: { desiredPlaying: false, suspendDepth: 0 },
      layers: [{ id: 'layer-seq', layerType: 'sequential' }],
      activeLayerId: 'layer-seq',
      sequentialRecord: {
        fps: 12,
        frameCount: 24,
        timeSmear: 1,
        currentFrame: 1,
        isPointerDown: true,
      },
    });

    const { unmount } = render(<AnimationControlsPanel />);
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();

    unmount();
    appStore.setState({
      colorCyclePlayback: { desiredPlaying: false, suspendDepth: 0 },
      sequentialRecord: {
        ...appStore.getState().sequentialRecord,
        isPointerDown: false,
      },
    });
    render(<AnimationControlsPanel />);
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  it('pauses when sequential playback is active even if color-cycle playback is suspended', () => {
    appStore.setState({
      colorCyclePlayback: { desiredPlaying: true, suspendDepth: 2 },
      layers: [{ id: 'layer-seq', layerType: 'sequential' }],
      activeLayerId: 'layer-seq',
      sequentialRecord: {
        fps: 12,
        frameCount: 24,
        timeSmear: 1,
        currentFrame: 0,
        isPointerDown: false,
      },
    });

    render(<AnimationControlsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));

    const store = appStore.getState();
    expect(store.pauseColorCycle).toHaveBeenCalledWith('toolbar');
    expect(store.playColorCycle).not.toHaveBeenCalled();
  });

  it('updates sequential controls when active sequential layer is selected', () => {
    appStore.setState({
      layers: [{ id: 'layer-seq', layerType: 'sequential' }],
      activeLayerId: 'layer-seq',
      sequentialRecord: {
        fps: 8,
        frameCount: 16,
        timeSmear: 1,
        currentFrame: 0,
        isPointerDown: false,
      },
    });

    render(<AnimationControlsPanel />);

    fireEvent.change(screen.getByRole('spinbutton', { name: /fps/i }), {
      target: { value: '24' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: /frames/i }), {
      target: { value: '32' },
    });
    fireEvent.change(screen.getByRole('slider', { name: /time-smear/i }), {
      target: { value: '2.5' },
    });
    fireEvent.change(screen.getByRole('slider', { name: /layer speed/i }), {
      target: { value: '0.6' },
    });

    const store = appStore.getState();
    expect(store.setRecordFPS).toHaveBeenCalledWith(24);
    expect(store.setRecordFrameCount).toHaveBeenCalledWith(32);
    expect(store.setTimeSmear).toHaveBeenCalledWith(2.5);
    expect(store.setBrushSettings).toHaveBeenCalledWith({ colorCycleLayerSpeedScale: 0.6 });
  });

  it('renders play pause button below sequential controls', () => {
    appStore.setState({
      layers: [{ id: 'layer-seq', layerType: 'sequential' }],
      activeLayerId: 'layer-seq',
      sequentialRecord: {
        fps: 12,
        frameCount: 24,
        timeSmear: 1,
        currentFrame: 0,
        isPointerDown: false,
      },
    });

    const { container } = render(<AnimationControlsPanel />);
    const sequentialHeader = screen.getByText('Sequential');
    const playbackButton = screen.getByRole('button', { name: /play/i });
    const relation = sequentialHeader.compareDocumentPosition(playbackButton);

    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).toContain('Sequential');
  });

  it('allows minimizing sequential controls', () => {
    appStore.setState({
      layers: [{ id: 'layer-seq', layerType: 'sequential' }],
      activeLayerId: 'layer-seq',
      sequentialRecord: {
        fps: 12,
        frameCount: 24,
        timeSmear: 1,
        currentFrame: 0,
        isPointerDown: false,
      },
    });

    render(<AnimationControlsPanel />);

    const toggleButton = screen.getByRole('button', { name: /Sequential/i });
    expect(screen.getByRole('spinbutton', { name: /fps/i })).toBeInTheDocument();
    fireEvent.click(toggleButton);
    expect(screen.queryByRole('spinbutton', { name: /fps/i })).not.toBeInTheDocument();
    fireEvent.click(toggleButton);
    expect(screen.getByRole('spinbutton', { name: /fps/i })).toBeInTheDocument();
  });

  it('restores sequential panel collapsed state from storage', () => {
    window.localStorage.setItem(SEQUENTIAL_PANEL_EXPANDED_STORAGE_KEY, '0');

    appStore.setState({
      layers: [{ id: 'layer-seq', layerType: 'sequential' }],
      activeLayerId: 'layer-seq',
      sequentialRecord: {
        fps: 12,
        frameCount: 24,
        timeSmear: 1,
        currentFrame: 0,
        isPointerDown: false,
      },
    });

    render(<AnimationControlsPanel />);

    expect(screen.queryByRole('spinbutton', { name: /fps/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sequential/i })).toHaveAttribute('aria-expanded', 'false');
  });
});
