import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';

import { createLayerStrokeState } from '../colorCycleLayerStrokeBuffers';
import { prepareColorCycleStrokeContext } from '../colorCycleStrokePreparationRuntime';

describe('prepareColorCycleStrokeContext', () => {
  it('binds a newly created runtime stroke state to the existing animator buffers', () => {
    const animator = {} as ColorCycleAnimator;
    const states = new Map<string, ReturnType<typeof createLayerStrokeState>>();
    const animatorPaint = new Uint8Array(12);
    const bindStrokeBuffersToAnimator = jest.fn((strokeState) => {
      strokeState.buffers.paint = animatorPaint;
    });

    const result = prepareColorCycleStrokeContext({
      ensureFullResolution: () => animator,
      getStrokeState: (layerId) => states.get(layerId),
      createStrokeState: ({ hasContent, contentIsOptimistic }) => createLayerStrokeState({
        bufferSize: 12,
        hasContent,
        contentIsOptimistic,
        strokeCycleSpeed: 1,
        strokeSpeedByte: 2,
      }),
      setStrokeState: (layerId, strokeState) => states.set(layerId, strokeState),
      bindStrokeBuffersToAnimator,
      getCanvasBufferSize: () => 12,
      getActiveSlot: () => 3,
    }, 'layer-1');

    expect(bindStrokeBuffersToAnimator).toHaveBeenCalledWith(result.strokeData, animator);
    expect(result.strokeData.buffers.paint).toBe(animatorPaint);
    expect(result.strokeData.flow.activeSlot).toBe(0);
  });

  it('rebinds after resizing an empty runtime stroke state', () => {
    const animator = {} as ColorCycleAnimator;
    const strokeState = createLayerStrokeState({
      bufferSize: 4,
      hasContent: false,
      strokeCycleSpeed: 1,
      strokeSpeedByte: 2,
    });
    const animatorPaint = new Uint8Array(12);
    const bindStrokeBuffersToAnimator = jest.fn((nextStrokeState) => {
      nextStrokeState.buffers.paint = animatorPaint;
    });

    prepareColorCycleStrokeContext({
      ensureFullResolution: () => animator,
      getStrokeState: () => strokeState,
      createStrokeState: () => strokeState,
      setStrokeState: jest.fn(),
      bindStrokeBuffersToAnimator,
      getCanvasBufferSize: () => 12,
      getActiveSlot: () => 0,
    }, 'layer-1');

    expect(bindStrokeBuffersToAnimator).toHaveBeenCalledWith(strokeState, animator);
    expect(strokeState.buffers.paint).toBe(animatorPaint);
  });
});
