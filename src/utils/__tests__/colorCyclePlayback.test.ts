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
const ensureColorCycleLayerRuntime = jest.fn(async () => true);

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
  activeLayerId: null as string | null,
  ensureColorCycleLayerRuntime,
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

jest.mock('@/utils/colorCycle/ccMutationAudit', () => ({
  __esModule: true as const,
  logCCMutation: jest.fn(),
}));

import {
  toggleGlobalColorCyclePlayback,
  toggleToolbarColorCyclePlayback,
} from '@/utils/colorCyclePlayback';
import { logCCMutation } from '@/utils/colorCycle/ccMutationAudit';

const mockLogCCMutation = logCCMutation as jest.Mock;

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
    mockState.activeLayerId = null;
    mockState.layers = [
      makeRecolorLayer('visible-recolor', true),
      makeRecolorLayer('hidden-recolor', false),
      {
        ...makeRecolorLayer('visible-brush-cc', true),
        colorCycleData: {
          mode: 'brush',
          hasContent: true,
        }
      } as Layer
    ];
  });

  it('registers only visible recolor layers when playback starts', async () => {
    await toggleGlobalColorCyclePlayback(true, 'toolbar');

    expect(ensureColorCycleLayerRuntime).toHaveBeenCalledWith('visible-brush-cc', { target: 'warm' });
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

  it('warms the active visible brush CC layer before playback starts', async () => {
    mockState.activeLayerId = 'visible-brush-cc';

    await toggleGlobalColorCyclePlayback(true, 'toolbar');

    expect(ensureColorCycleLayerRuntime).toHaveBeenCalledWith('visible-brush-cc', { target: 'active' });
    expect(runtimeStart).toHaveBeenCalledWith('store-sync');
  });

  it('does not start playback when a visible brush CC layer fails to warm', async () => {
    ensureColorCycleLayerRuntime.mockResolvedValueOnce(false);

    await toggleGlobalColorCyclePlayback(true, 'toolbar');

    expect(ensureColorCycleLayerRuntime).toHaveBeenCalledWith('visible-brush-cc', { target: 'warm' });
    expect(playColorCycle).toHaveBeenCalledWith('toolbar');
    expect(pauseColorCycle).toHaveBeenCalledWith('toolbar');
    expect(runtimeStart).not.toHaveBeenCalled();
    expect(registerExistingLayer).not.toHaveBeenCalled();
    expect(mockState.colorCyclePlayback.desiredPlaying).toBe(false);
    expect(mockLogCCMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'cc-playback-warmup-failed',
        layerId: 'visible-brush-cc',
      }),
    );
  });

  it('does not warm hidden cold brush CC layers during toolbar playback', async () => {
    mockState.layers = [
      {
        ...makeRecolorLayer('hidden-cold-brush-cc', false),
        colorCycleData: {
          mode: 'brush',
          hasContent: true,
          deferredRuntimeRestore: true,
          runtimeHydrationState: 'cold',
        },
      } as Layer,
      {
        ...makeRecolorLayer('visible-brush-cc', true),
        colorCycleData: {
          mode: 'brush',
          hasContent: true,
        },
      } as Layer,
    ];

    await toggleGlobalColorCyclePlayback(true, 'toolbar');

    expect(ensureColorCycleLayerRuntime).toHaveBeenCalledTimes(1);
    expect(ensureColorCycleLayerRuntime).toHaveBeenCalledWith('visible-brush-cc', { target: 'warm' });
    expect(ensureColorCycleLayerRuntime).not.toHaveBeenCalledWith('hidden-cold-brush-cc', expect.anything());
    expect(runtimeStart).toHaveBeenCalledWith('store-sync');
  });

  it('does not block playback on an empty visible brush CC layer without a runtime', async () => {
    mockState.layers = [
      makeRecolorLayer('visible-recolor', true),
      {
        ...makeRecolorLayer('empty-visible-brush-cc', true),
        colorCycleData: {
          mode: 'brush',
          hasContent: false,
        },
      } as Layer,
      {
        ...makeRecolorLayer('populated-visible-brush-cc', true),
        colorCycleData: {
          mode: 'brush',
          hasContent: true,
        },
      } as Layer,
    ];

    await toggleGlobalColorCyclePlayback(true, 'toolbar');

    expect(ensureColorCycleLayerRuntime).toHaveBeenCalledTimes(1);
    expect(ensureColorCycleLayerRuntime).toHaveBeenCalledWith('populated-visible-brush-cc', { target: 'warm' });
    expect(runtimeStart).toHaveBeenCalledWith('store-sync');
    expect(mockState.colorCyclePlayback.desiredPlaying).toBe(true);
  });

  it('does not block playback on a visible repair-failed metadata-only brush CC layer', async () => {
    mockState.layers = [
      makeRecolorLayer('visible-recolor', true),
      {
        ...makeRecolorLayer('repair-failed-preview-cc', true),
        colorCycleData: {
          mode: 'brush',
          hasContent: true,
          repairStatus: {
            ok: false,
            reason: 'missing-gradient-bindings',
          },
        },
      } as Layer,
      {
        ...makeRecolorLayer('populated-visible-brush-cc', true),
        colorCycleData: {
          mode: 'brush',
          hasContent: true,
        },
      } as Layer,
    ];

    await toggleGlobalColorCyclePlayback(true, 'toolbar');

    expect(ensureColorCycleLayerRuntime).toHaveBeenCalledTimes(1);
    expect(ensureColorCycleLayerRuntime).toHaveBeenCalledWith('populated-visible-brush-cc', { target: 'warm' });
    expect(runtimeStart).toHaveBeenCalledWith('store-sync');
    expect(mockState.colorCyclePlayback.desiredPlaying).toBe(true);
  });

  it('does not restart playback when the user pauses while cold CC warmup is pending', async () => {
    let resolveWarmup: (value: boolean) => void = () => {};
    ensureColorCycleLayerRuntime.mockImplementationOnce(() => (
      new Promise<boolean>((resolve) => {
        resolveWarmup = resolve;
      })
    ));

    const playPromise = toggleGlobalColorCyclePlayback(true, 'toolbar');
    expect(playColorCycle).toHaveBeenCalledWith('toolbar');
    expect(mockState.colorCyclePlayback.desiredPlaying).toBe(true);

    await toggleGlobalColorCyclePlayback(false, 'toolbar');
    expect(pauseColorCycle).toHaveBeenCalledWith('toolbar');
    expect(mockState.colorCyclePlayback.desiredPlaying).toBe(false);

    resolveWarmup(true);
    await playPromise;

    expect(runtimeStart).not.toHaveBeenCalled();
    expect(registerExistingLayer).not.toHaveBeenCalled();
    expect(mockState.colorCyclePlayback.desiredPlaying).toBe(false);
  });

  it('keeps canonical summaries idempotent across repeated play/pause toggles', async () => {
    mockState.layers = [
      {
        ...makeRecolorLayer('visible-brush-cc', true),
        colorCycleData: {
          mode: 'brush',
          hasContent: true,
          gradientIdBuffer: new ArrayBuffer(4),
          gradientDefIdBuffer: new ArrayBuffer(4),
          phaseBuffer: new ArrayBuffer(4),
          brushState: { canonicalPaint: true },
        },
      } as Layer,
    ];

    for (let index = 0; index < 10; index += 1) {
      await toggleGlobalColorCyclePlayback(true, 'toolbar');
      await toggleGlobalColorCyclePlayback(false, 'toolbar');
    }

    expect(mockLogCCMutation).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'cc-playback-canonical-mutated',
      }),
    );
    expect(mockState.layers[0].colorCycleData).toEqual(
      expect.objectContaining({
        hasContent: true,
        gradientIdBuffer: expect.any(ArrayBuffer),
        gradientDefIdBuffer: expect.any(ArrayBuffer),
        phaseBuffer: expect.any(ArrayBuffer),
        brushState: { canonicalPaint: true },
      }),
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
