import {
  bindLayerStrokeBuffersToAnimator,
  createLayerStrokeState,
  layerStrokeStateHasContent,
  paintBufferHasContent,
  refreshLayerStrokeStateContent,
  resizeLayerStrokeBuffersAfterTargetCanvasChange,
} from '@/hooks/brushEngine/colorCycleLayerStrokeBuffers';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';

describe('colorCycleLayerStrokeBuffers', () => {
  it('detects paint content across word and tail-aligned buffers', () => {
    const empty = new Uint8Array(17);
    expect(paintBufferHasContent(empty, 17, 1)).toBe(false);

    const wordContent = new Uint8Array(17);
    wordContent[12] = 7;
    expect(paintBufferHasContent(wordContent, 17, 1)).toBe(true);

    const tailContent = new Uint8Array(17);
    tailContent[16] = 9;
    expect(paintBufferHasContent(tailContent, 17, 1)).toBe(true);

    const unalignedSource = new Uint8Array(18);
    const unaligned = unalignedSource.subarray(1);
    unaligned[15] = 3;
    expect(paintBufferHasContent(unaligned, 17, 1)).toBe(true);
  });

  it('treats optimistic content as empty until paint bytes are written', () => {
    const strokeState = createLayerStrokeState({
      hasContent: true,
      contentIsOptimistic: true,
      bufferSize: 4,
      strokeCycleSpeed: 1,
      strokeSpeedByte: 1,
    });

    expect(layerStrokeStateHasContent(strokeState, 2, 2)).toBe(false);

    strokeState.buffers.paint[3] = 1;
    expect(layerStrokeStateHasContent(strokeState, 2, 2)).toBe(true);
  });

  it('refreshes optimistic content without cloning stroke buffers', () => {
    const strokeState = createLayerStrokeState({
      hasContent: true,
      contentIsOptimistic: true,
      bufferSize: 4,
      strokeCycleSpeed: 1,
      strokeSpeedByte: 1,
    });
    const paint = strokeState.buffers.paint;

    expect(refreshLayerStrokeStateContent(strokeState, 2, 2)).toBe(false);
    expect(strokeState.hasContent).toBe(false);
    expect(strokeState.contentIsOptimistic).toBe(false);
    expect(strokeState.buffers.paint).toBe(paint);
  });

  it('marks verified painted content as non-optimistic', () => {
    const strokeState = createLayerStrokeState({
      hasContent: true,
      contentIsOptimistic: true,
      bufferSize: 4,
      strokeCycleSpeed: 1,
      strokeSpeedByte: 1,
    });
    strokeState.buffers.paint[2] = 1;

    expect(refreshLayerStrokeStateContent(strokeState, 2, 2)).toBe(true);
    expect(strokeState.hasContent).toBe(true);
    expect(strokeState.contentIsOptimistic).toBe(false);
  });

  it('adopts the animator definition buffer when binding a new runtime state', () => {
    const strokeState = createLayerStrokeState({
      bufferSize: 4,
      strokeCycleSpeed: 1,
      strokeSpeedByte: 1,
    });
    const defIdData = new Uint16Array([7, 8, 0, 0]);
    const setDefIdData = jest.fn();
    const animator = {
      beginDirectFill: () => ({
        data: new Uint8Array(4),
        gradientId: new Uint8Array(4),
        defIdData,
        speedData: new Uint8Array(4),
        flowData: new Uint8Array(4),
        phaseData: new Uint8Array(4),
        width: 2,
        height: 2,
      }),
      endDirectFill: jest.fn(),
      setDefIdData,
    } as unknown as ColorCycleAnimator;

    bindLayerStrokeBuffersToAnimator(strokeState, animator, 4);

    expect(strokeState.buffers.def).toBe(defIdData);
    expect(setDefIdData).toHaveBeenCalledWith(defIdData);
  });

  it('resizes every per-pixel stroke buffer after target canvas changes', () => {
    const strokeState = createLayerStrokeState({
      bufferSize: 4,
      strokeCycleSpeed: 1,
      strokeSpeedByte: 1,
    });

    resizeLayerStrokeBuffersAfterTargetCanvasChange(strokeState, 9);

    expect(strokeState.buffers.paint).toHaveLength(9);
    expect(strokeState.buffers.gid).toHaveLength(9);
    expect(strokeState.buffers.spd).toHaveLength(9);
    expect(strokeState.buffers.flow).toHaveLength(9);
    expect(strokeState.buffers.phase).toHaveLength(9);
    expect(strokeState.buffers.def).toHaveLength(9);
  });
});
