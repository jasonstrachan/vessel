import { drawSelectionLayer } from '../drawingCanvasSelection';
import * as marqueeStroke from '@/utils/marqueeStroke';

describe('drawSelectionLayer integration', () => {
  it('draws marching ants on canvas edges when marquee starts outside bounds', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');

    expect(ctx).toBeTruthy();
    if (!ctx) {
      return;
    }
    const mutableCtx = ctx as CanvasRenderingContext2D & {
      rect?: jest.Mock;
      clip?: jest.Mock;
      strokeRect?: jest.Mock;
      setLineDash?: jest.Mock;
      lineDashOffset?: number;
    };
    if (typeof mutableCtx.rect !== 'function') {
      mutableCtx.rect = jest.fn();
    }
    if (typeof mutableCtx.clip !== 'function') {
      mutableCtx.clip = jest.fn();
    }
    if (typeof mutableCtx.strokeRect !== 'function') {
      mutableCtx.strokeRect = jest.fn();
    }
    if (typeof mutableCtx.setLineDash !== 'function') {
      mutableCtx.setLineDash = jest.fn();
    }

    const marqueeRectSpy = jest.spyOn(marqueeStroke, 'strokeMarqueeRect');

    drawSelectionLayer({
      ctx,
      projectWidth: 100,
      projectHeight: 80,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      marchingAntsOffset: 2,
      selectionStart: { x: -25, y: -10 },
      selectionEnd: { x: 45, y: 30 },
      isSelecting: true,
      selectionStartRef: null,
      selectionMask: null,
      selectionMaskBounds: null,
      selectionVectorPath: null,
      activeCanvasShape: null,
      applyCanvasShapeClip: jest.fn(),
    });

    expect(marqueeRectSpy).toHaveBeenCalledWith(
      expect.any(Object),
      0,
      0,
      45,
      30,
      expect.objectContaining({
        animated: true,
      })
    );
  });
});
