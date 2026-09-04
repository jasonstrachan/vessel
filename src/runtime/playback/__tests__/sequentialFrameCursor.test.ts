import {
  advanceSequentialFrameCursor,
  beginSequentialExportTimeline,
  frameAtSequentialTime,
  getSequentialFrameCursor,
  getSequentialLayerRenderFrame,
  getSequentialRenderFrame,
  resetSequentialFrameCursorFromState,
  setSequentialExportTime,
  setSequentialFrameCursor,
} from '@/runtime/playback/sequentialFrameCursor';
import type { AppState } from '@/stores/useAppStore';

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

  it('maps one transport time into independent layer clip rates', () => {
    setSequentialFrameCursor({
      nextFrame: 6,
      nextFrameCount: 12,
      nextFps: 12,
      timestampMs: 40,
    });

    expect(frameAtSequentialTime({
      clipTimeMs: getSequentialFrameCursor().timeMs,
      clipFps: 24,
      clipFrameCount: 16,
    })).toBe(12);
  });

  it('uses an isolated export timeline and restores the live transport afterward', () => {
    setSequentialFrameCursor({
      nextFrame: 3,
      nextFrameCount: 12,
      nextFps: 12,
      timestampMs: 50,
    });
    const layer = {
      id: 'sequence',
      layerType: 'sequential' as const,
      sequentialData: { fps: 12, frameCount: 12, durationMs: 1000, events: [] },
    };
    const state = {
      activeLayerId: 'sequence',
      sequentialRecord: { currentFrame: 3, isPointerDown: false },
      colorCyclePlayback: { desiredPlaying: false },
    };

    const finish = beginSequentialExportTimeline();
    setSequentialExportTime(750);
    expect(getSequentialLayerRenderFrame(state, layer)).toBe(9);
    finish();
    expect(getSequentialLayerRenderFrame(state, layer)).toBe(3);
    expect(getSequentialFrameCursor().frame).toBe(3);
  });

  it('falls back safely for non-finite transport inputs', () => {
    setSequentialFrameCursor({
      nextFrame: Number.NaN,
      nextFrameCount: Number.POSITIVE_INFINITY,
      nextFps: Number.NaN,
    });

    expect(getSequentialFrameCursor()).toEqual(expect.objectContaining({
      frame: 0,
      frameCount: 1,
      fps: 1,
      timeMs: 0,
    }));
    expect(frameAtSequentialTime({
      clipTimeMs: Number.NaN,
      clipFps: Number.POSITIVE_INFINITY,
      clipFrameCount: Number.NaN,
    })).toBe(0);
  });

  it('resets transport using the active sequence clip rate', () => {
    resetSequentialFrameCursorFromState({
      activeLayerId: 'sequence',
      layers: [{
        id: 'sequence',
        layerType: 'sequential',
        sequentialData: { fps: 24, frameCount: 16, durationMs: 667, events: [] },
      }],
      sequentialRecord: { currentFrame: 6, fps: 12, frameCount: 12 },
    } as unknown as AppState);

    expect(getSequentialFrameCursor()).toEqual(expect.objectContaining({
      frame: 6,
      frameCount: 16,
      fps: 24,
      timeMs: 250,
    }));
  });
});
