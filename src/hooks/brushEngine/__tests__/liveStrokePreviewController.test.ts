import {
  applyStrokeRisographOverlay,
  renderLiveStrokePreview,
  scheduleLiveStrokeRender,
} from '../liveStrokePreviewController';
import type { BrushSettings } from '@/types';

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
      liveStrokeBoundsRef: { current: null },
      strokeBoundsRef: { current: null },
      liveDirtyRectRef: { current: null },
      shouldApplyStrokeDither: true,
      brushSettings: {} as BrushSettings,
      isDitherStrokeBrush: false,
      isPixelDitherNoBg: false,
      warnIfDitherStrokePath: jest.fn(),
      withAlphaLock: jest.fn(),
      applyStrokeDither: jest.fn(),
      applyStrokeRisographOverlay: jest.fn(),
      renderLiveStrokePreviewUtil: util,
    });

    expect(util).toHaveBeenCalled();
  });

  it('schedules preview only once while pending', () => {
    const liveRenderScheduledRef = { current: false };
    const render = jest.fn();
    const visibleCtx = {} as CanvasRenderingContext2D;

    scheduleLiveStrokeRender({
      visibleCtx,
      liveRenderScheduledRef,
      renderLiveStrokePreview: render,
    });
    scheduleLiveStrokeRender({
      visibleCtx,
      liveRenderScheduledRef,
      renderLiveStrokePreview: render,
    });

    expect(liveRenderScheduledRef.current).toBe(true);
  });
});

