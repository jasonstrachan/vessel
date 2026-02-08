import { BrushShape } from '@/types';
import { pauseColorCycleForNonCCInteraction } from '@/hooks/canvas/handlers/colorCycle/colorCycleInteraction';
import type { AppState } from '@/stores/useAppStore';

const createState = (overrides?: {
  activeLayerType?: 'normal' | 'color-cycle' | 'sequential';
  pointerDown?: boolean;
}): AppState =>
  ({
    activeLayerId: 'layer-active',
    layers: [
      {
        id: 'layer-active',
        layerType: overrides?.activeLayerType ?? 'sequential',
      },
    ],
    colorCyclePlayback: {
      desiredPlaying: true,
      suspendDepth: 0,
    },
    sequentialRecord: {
      isPointerDown: overrides?.pointerDown ?? true,
    },
    tools: {
      brushSettings: {
        brushShape: BrushShape.ROUND,
      },
    },
    suspendColorCycle: jest.fn(),
  }) as unknown as AppState;

describe('pauseColorCycleForNonCCInteraction sequential capture guard', () => {
  it('does not suspend color-cycle playback on sequential layers before pointer-down capture starts', () => {
    const pauseAllBrushCCAnimationsNow = jest.fn(() => true);
    const state = createState({ activeLayerType: 'sequential', pointerDown: false });
    const shouldResumeRef = { current: false };
    const recolorWasAnimatingRef = { current: false };

    pauseColorCycleForNonCCInteraction({
      reason: 'shape-preview',
      shouldResumeRef,
      recolorWasAnimatingRef,
      storeRef: { current: state },
      getEffectiveColorCyclePlaying: () => true,
      pauseAllBrushCCAnimationsNow,
      ccLog: jest.fn(),
    });

    expect(pauseAllBrushCCAnimationsNow).not.toHaveBeenCalled();
    expect(state.suspendColorCycle).not.toHaveBeenCalled();
    expect(shouldResumeRef.current).toBe(false);
  });

  it('does not suspend color-cycle playback while sequential capture is active', () => {
    const pauseAllBrushCCAnimationsNow = jest.fn(() => true);
    const state = createState({ activeLayerType: 'sequential', pointerDown: true });
    const shouldResumeRef = { current: false };
    const recolorWasAnimatingRef = { current: false };

    pauseColorCycleForNonCCInteraction({
      reason: 'shape-preview',
      shouldResumeRef,
      recolorWasAnimatingRef,
      storeRef: { current: state },
      getEffectiveColorCyclePlaying: () => true,
      pauseAllBrushCCAnimationsNow,
      ccLog: jest.fn(),
    });

    expect(pauseAllBrushCCAnimationsNow).not.toHaveBeenCalled();
    expect(state.suspendColorCycle).not.toHaveBeenCalled();
    expect(shouldResumeRef.current).toBe(false);
  });

  it('still suspends playback when sequential capture is not active', () => {
    const pauseAllBrushCCAnimationsNow = jest.fn(() => true);
    const state = createState({ activeLayerType: 'normal', pointerDown: false });
    const shouldResumeRef = { current: false };
    const recolorWasAnimatingRef = { current: false };

    pauseColorCycleForNonCCInteraction({
      reason: 'shape-preview',
      shouldResumeRef,
      recolorWasAnimatingRef,
      storeRef: { current: state },
      getEffectiveColorCyclePlaying: () => true,
      pauseAllBrushCCAnimationsNow,
      ccLog: jest.fn(),
    });

    expect(pauseAllBrushCCAnimationsNow).toHaveBeenCalledTimes(1);
    expect(state.suspendColorCycle).toHaveBeenCalledWith('shape-preview');
    expect(shouldResumeRef.current).toBe(true);
  });
});
