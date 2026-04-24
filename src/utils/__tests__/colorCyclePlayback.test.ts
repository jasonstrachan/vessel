import type { Layer } from '@/types';

const registerExistingLayer = jest.fn(async () => true);
const playAll = jest.fn();
const pause = jest.fn();
const renderOnce = jest.fn();

const recolorManagerInstance = {
  registerExistingLayer,
  playAll,
  pause,
  renderOnce
};

const updateLayer = jest.fn();
const playColorCycle = jest.fn();
const pauseColorCycle = jest.fn();
const forceResumeColorCycle = jest.fn();
const runtimeStart = jest.fn();
const runtimeStop = jest.fn();

const mockState = {
  layers: [] as Layer[],
  colorCyclePlayback: {
    desiredPlaying: false,
    suspendDepth: 0
  },
  playColorCycle: (reason: string) => {
    playColorCycle(reason);
    mockState.colorCyclePlayback.desiredPlaying = true;
  },
  pauseColorCycle: (reason: string) => {
    pauseColorCycle(reason);
    mockState.colorCyclePlayback.desiredPlaying = false;
  },
  forceResumeColorCycle: (reason: string) => {
    forceResumeColorCycle(reason);
    mockState.colorCyclePlayback.suspendDepth = 0;
  },
  updateLayer,
  colorCycleRuntimeHandlers: {
    start: runtimeStart,
    stop: runtimeStop
  }
};

jest.mock('@/lib/colorCycle/RecolorManager', () => ({
  __esModule: true as const,
  RecolorManager: {
    getInstance: () => recolorManagerInstance
  }
}));

jest.mock('@/stores/useAppStore', () => ({
  __esModule: true as const,
  useAppStore: {
    getState: () => mockState
  },
  selectColorCycleDesiredPlaying: (state: typeof mockState) => state.colorCyclePlayback.desiredPlaying,
  selectColorCycleSuspendDepth: (state: typeof mockState) => state.colorCyclePlayback.suspendDepth,
  selectColorCyclePlaybackToggleAction: (state: typeof mockState) => {
    if (!state.colorCyclePlayback.desiredPlaying) {
      return 'play';
    }
    if (state.colorCyclePlayback.suspendDepth > 0) {
      return 'resume';
    }
    return 'pause';
  },
  selectEffectiveColorCyclePlaying: (state: typeof mockState) =>
    state.colorCyclePlayback.desiredPlaying && state.colorCyclePlayback.suspendDepth === 0
}));

import {
  toggleGlobalColorCyclePlayback,
  toggleToolbarColorCyclePlayback,
} from '@/utils/colorCyclePlayback';

const makeRecolorLayer = (id: string, visible: boolean): Layer =>
  ({
    id,
    name: id,
    visible,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    layerType: 'color-cycle',
    colorCycleData: {
      mode: 'recolor',
      recolorSettings: {
        animation: {
          isPlaying: false
        }
      }
    }
  }) as Layer;

describe('colorCyclePlayback visibility behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.colorCyclePlayback.desiredPlaying = false;
    mockState.colorCyclePlayback.suspendDepth = 0;
    mockState.layers = [
      makeRecolorLayer('visible-recolor', true),
      makeRecolorLayer('hidden-recolor', false),
      {
        ...makeRecolorLayer('visible-brush-cc', true),
        colorCycleData: {
          mode: 'brush'
        }
      } as Layer
    ];
  });

  it('registers only visible recolor layers when playback starts', async () => {
    await toggleGlobalColorCyclePlayback(true, 'toolbar');

    expect(runtimeStart).toHaveBeenCalledWith('store-sync');
    expect(registerExistingLayer).toHaveBeenCalledTimes(1);
    expect(registerExistingLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'visible-recolor' })
    );
    expect(updateLayer).toHaveBeenCalledTimes(1);
    expect(updateLayer).toHaveBeenCalledWith(
      'visible-recolor',
      expect.objectContaining({
        colorCycleData: expect.objectContaining({
          recolorSettings: expect.objectContaining({
            animation: expect.objectContaining({ isPlaying: true })
          })
        })
      })
    );
  });

  it('uses pause as the single toolbar action when playback is already active', async () => {
    mockState.colorCyclePlayback.desiredPlaying = true;

    await toggleToolbarColorCyclePlayback();

    expect(pauseColorCycle).toHaveBeenCalledWith('toolbar');
    expect(playColorCycle).not.toHaveBeenCalled();
  });

  it('uses resume as the single toolbar action when playback is suspended', async () => {
    mockState.colorCyclePlayback.desiredPlaying = true;
    mockState.colorCyclePlayback.suspendDepth = 2;

    await toggleToolbarColorCyclePlayback();

    expect(forceResumeColorCycle).toHaveBeenCalledWith('toolbar');
    expect(playColorCycle).toHaveBeenCalledWith('toolbar');
  });
});
