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
  selectEffectiveColorCyclePlaying: (state: typeof mockState) =>
    state.colorCyclePlayback.desiredPlaying && state.colorCyclePlayback.suspendDepth === 0
}));

import { toggleGlobalColorCyclePlayback } from '@/utils/colorCyclePlayback';

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
});
