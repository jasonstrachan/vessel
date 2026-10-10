import {
  applyStrokeRisographOverlay,
  renderLiveStrokePreview,
  scheduleLiveStrokeRender,
} from '../liveStrokePreviewController';
import type { BrushSettings } from '@/types';
import { CANVAS_FRAME_UPDATE_EVENT } from '@/hooks/canvas/handlers/animation/animationRuntime';

describe('liveStrokePreviewController', () => {
  it('applies stroke risograph overlay with multiply compositing', () => {
    const ctx = {
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
      drawImage: jest.fn(),
    } as unknown as CanvasRenderingContext2D;

    const source = document.createElement('canvas');

    applyStrokeRisographOverlay({
      ctx,
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      source,
      risographIntensity: 20,
    });

    expect(ctx.drawImage).toHaveBeenCalledWith(source, 1, 2, 3, 4, 1, 2, 3, 4);
    expect(ctx.globalCompositeOperation).toBe('source-over');
    expect(ctx.globalAlpha).toBe(1);
  });

  it('forwards preview args to util', () => {
    const util = jest.fn();

    renderLiveStrokePreview({
      visibleCtx: {} as CanvasRenderingContext2D,
      liveRenderScheduledRef: { current: false },
      liveStrokeRawRef: { current: null },
      liveStrokeDitherRef: { current: null },
      liveStrokeBaseRef: { current: null },
      liveStrokeBoundsRef: { current: null },
      strokeBoundsRef: { current: null },
      liveDirtyRectRef: { current: null },
      shouldApplyStrokeDither: true,
      brushSettings: {} as BrushSettings,
      isPixelDitherNoBg: false,
      warnIfDitherStrokePath: jest.fn(),
      withAlphaLock: jest.fn(),
      applyStrokeDither: jest.fn(),
      applyStrokeRisographOverlay: jest.fn(),
      renderLiveStrokePreviewUtil: util,
    });

    expect(util).toHaveBeenCalled();
  });

  it('publishes before notifying the drawing surface with its context restored', () => {
    let scheduled: FrameRequestCallback | undefined;
    const frame = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      scheduled = callback;
      return 1;
    });
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 0.75;
    let published = false;
    const observe = jest.fn(() => {
      expect(published).toBe(true);
      expect(ctx.globalCompositeOperation).toBe('source-over');
      expect(ctx.globalAlpha).toBe(1);
    });
    window.addEventListener(CANVAS_FRAME_UPDATE_EVENT, observe);
    try {
      scheduleLiveStrokeRender({
        visibleCtx: ctx,
        liveRenderScheduledRef: { current: false },
        renderLiveStrokePreview: () => { published = true; },
      });
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      expect(observe).not.toHaveBeenCalled();
      scheduled?.(0);
      expect(observe).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(CANVAS_FRAME_UPDATE_EVENT, observe);
      frame.mockRestore();
    }
  });

  it('restores context without announcing a failed publication', () => {
    let scheduled: FrameRequestCallback | undefined;
    const frame = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      scheduled = callback;
      return 1;
    });
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 0.75;
    const observe = jest.fn();
    window.addEventListener(CANVAS_FRAME_UPDATE_EVENT, observe);
    try {
      scheduleLiveStrokeRender({
        visibleCtx: ctx,
        liveRenderScheduledRef: { current: false },
        renderLiveStrokePreview: () => { throw new Error('publication failed'); },
      });
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      expect(() => scheduled?.(0)).toThrow('publication failed');
      expect(ctx.globalCompositeOperation).toBe('source-over');
      expect(ctx.globalAlpha).toBe(1);
      expect(observe).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(CANVAS_FRAME_UPDATE_EVENT, observe);
      frame.mockRestore();
    }
  });

  it('coalesces pending publications and notifies once per published frame', () => {
    const scheduled: FrameRequestCallback[] = [];
    const frame = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      scheduled.push(callback);
      return scheduled.length;
    });
    const liveRenderScheduledRef = { current: false };
    const render = jest.fn(() => { liveRenderScheduledRef.current = false; });
    const visibleCtx = {} as CanvasRenderingContext2D;
    const observe = jest.fn();
    const schedule = () => scheduleLiveStrokeRender({
      visibleCtx, liveRenderScheduledRef, renderLiveStrokePreview: render,
    });
    window.addEventListener(CANVAS_FRAME_UPDATE_EVENT, observe);
    try {
      schedule();
      schedule();
      expect(scheduled).toHaveLength(1);
      expect(liveRenderScheduledRef.current).toBe(true);
      scheduled[0](0);
      expect(render).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledTimes(1);
      schedule();
      expect(scheduled).toHaveLength(2);
      scheduled[1](16);
      expect(render).toHaveBeenCalledTimes(2);
      expect(observe).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(CANVAS_FRAME_UPDATE_EVENT, observe);
      frame.mockRestore();
    }
  });
});
