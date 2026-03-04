import { drawSelectionLayer } from '../drawingCanvasSelection';
import { strokeMarqueeRect } from '@/utils/marqueeStroke';

jest.mock('@/utils/marqueeStroke', () => ({
  strokeMarqueeRect: jest.fn(),
  strokeMarqueePath: jest.fn(),
}));

jest.mock('@/utils/selectionMaskContourPath', () => ({
  getSelectionMaskContourPath: jest.fn(() => new Path2D()),
}));

describe('drawSelectionLayer', () => {
  it('clamps marquee rect to project bounds so ants stay on canvas edges', () => {
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      scale: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
      setLineDash: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      stroke: jest.fn(),
      fillStyle: '#fff',
      strokeStyle: '#000',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;

    drawSelectionLayer({
      ctx,
      projectWidth: 100,
      projectHeight: 80,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      marchingAntsOffset: 0,
      selectionStart: { x: -20, y: -10 },
      selectionEnd: { x: 40, y: 30 },
      isSelecting: true,
      selectionStartRef: null,
      selectionMask: null,
      selectionMaskBounds: null,
      selectionVectorPath: null,
      activeCanvasShape: null,
      applyCanvasShapeClip: jest.fn(),
    });

    expect(strokeMarqueeRect).toHaveBeenCalledWith(
      ctx,
      0,
      0,
      40,
      30,
      expect.objectContaining({
        animated: true,
        marchingAntsOffset: 0,
        scale: 1,
      })
    );
  });
});
