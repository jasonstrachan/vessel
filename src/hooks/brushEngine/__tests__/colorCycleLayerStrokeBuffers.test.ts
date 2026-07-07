import {
  createLayerStrokeState,
  layerStrokeStateHasContent,
  paintBufferHasContent,
  resizeLayerStrokeBuffersAfterTargetCanvasChange,
} from '@/hooks/brushEngine/colorCycleLayerStrokeBuffers';

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
