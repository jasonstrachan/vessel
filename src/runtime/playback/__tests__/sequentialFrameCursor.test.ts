import {
  advanceSequentialFrameCursor,
  getSequentialFrameCursor,
  getSequentialRenderFrame,
  setSequentialFrameCursor,
} from '@/runtime/playback/sequentialFrameCursor';

describe('sequentialFrameCursor', () => {
  it('tracks playback frame outside Zustand state and wraps by frame count', () => {
    setSequentialFrameCursor({ nextFrame: 3, nextFrameCount: 4, timestampMs: 10 });
    expect(getSequentialFrameCursor()).toMatchObject({
      frame: 3,
      frameCount: 4,
      updatedAtMs: 10,
    });

    advanceSequentialFrameCursor({ step: 2, nextFrameCount: 4, timestampMs: 20 });
    expect(getSequentialFrameCursor().frame).toBe(1);
    expect(getSequentialRenderFrame({
      sequentialRecord: { frameCount: 4 },
      colorCyclePlayback: { desiredPlaying: true },
    })).toBe(1);
  });

  it('preserves absolute store frames for export callers', () => {
    setSequentialFrameCursor({ nextFrame: 1, nextFrameCount: 12, timestampMs: 30 });

    expect(getSequentialRenderFrame({
      sequentialRecord: {
        currentFrame: 13,
        frameCount: 12,
      },
      colorCyclePlayback: { desiredPlaying: false },
    })).toBe(13);
  });
});
