import { createDrawingPlaybackSync } from '@/hooks/canvas/createDrawingPlaybackSync';
import type { AppState } from '@/stores/useAppStore';

describe('createDrawingPlaybackSync instrumentation', () => {
  const makeState = (overrides?: Partial<AppState>): AppState =>
    ({
      colorCyclePlayback: {
        desiredPlaying: false,
        suspendDepth: 0,
        playbackSpeedScale: 1,
        lastReason: 'toolbar',
      },
      layers: [
        {
          id: 'layer-abcdef',
          layerType: 'color-cycle',
          colorCycleData: {
            mode: 'brush',
            isAnimating: false,
          },
        },
      ],
      ...overrides,
    }) as AppState;

  it('logs start decisions with playback and layer snapshots', () => {
    const startContinuousColorCycleAnimation = jest.fn();
    const stopContinuousColorCycleAnimation = jest.fn();
    const ccLog = jest.fn();
    const storeRef = {
      current: makeState({
        colorCyclePlayback: {
          desiredPlaying: true,
          suspendDepth: 0,
          playbackSpeedScale: 1,
          lastReason: 'toolbar',
        },
      }),
    };

    const sync = createDrawingPlaybackSync({
      startContinuousColorCycleAnimation,
      stopContinuousColorCycleAnimation,
      storeRef,
      continuousColorCycleAnimationActiveRef: { current: false },
      startingColorCycleAnimationRef: { current: false },
      skipStartLogAtRef: { current: {} },
      skipStopLogAtRef: { current: {} },
      skipCcLogThrottleMs: 0,
      ccLog,
    });

    sync(true, 'toolbar');

    expect(ccLog).toHaveBeenCalledWith(
      'sync playback -> start decision',
      expect.objectContaining({
        reason: 'toolbar',
        playing: true,
        playback: expect.objectContaining({
          desiredPlaying: true,
          suspendDepth: 0,
          lastReason: 'toolbar',
        }),
        layers: [
          expect.objectContaining({
            id: 'abcdef',
            isAnimating: false,
            mode: 'brush',
          }),
        ],
      })
    );
    expect(startContinuousColorCycleAnimation).toHaveBeenCalledWith('toolbar');
    expect(stopContinuousColorCycleAnimation).not.toHaveBeenCalled();
  });

  it('logs stop decisions with playback and layer snapshots', () => {
    const startContinuousColorCycleAnimation = jest.fn();
    const stopContinuousColorCycleAnimation = jest.fn();
    const ccLog = jest.fn();
    const storeRef = {
      current: makeState({
        colorCyclePlayback: {
          desiredPlaying: false,
          suspendDepth: 0,
          playbackSpeedScale: 1,
          lastReason: 'toolbar',
        },
        layers: [
          {
            id: 'layer-abcdef',
            layerType: 'color-cycle',
            colorCycleData: {
              mode: 'brush',
              isAnimating: true,
            },
          },
        ] as AppState['layers'],
      }),
    };

    const sync = createDrawingPlaybackSync({
      startContinuousColorCycleAnimation,
      stopContinuousColorCycleAnimation,
      storeRef,
      continuousColorCycleAnimationActiveRef: { current: false },
      startingColorCycleAnimationRef: { current: false },
      skipStartLogAtRef: { current: {} },
      skipStopLogAtRef: { current: {} },
      skipCcLogThrottleMs: 0,
      ccLog,
    });

    sync(false, 'toolbar');

    expect(ccLog).toHaveBeenCalledWith(
      'sync playback -> stop decision',
      expect.objectContaining({
        reason: 'toolbar',
        playing: false,
        anyAnimating: true,
        playback: expect.objectContaining({
          desiredPlaying: false,
          suspendDepth: 0,
          lastReason: 'toolbar',
        }),
        layers: [
          expect.objectContaining({
            id: 'abcdef',
            isAnimating: true,
            mode: 'brush',
          }),
        ],
      })
    );
    expect(stopContinuousColorCycleAnimation).toHaveBeenCalledWith('toolbar');
    expect(startContinuousColorCycleAnimation).not.toHaveBeenCalled();
  });
});
