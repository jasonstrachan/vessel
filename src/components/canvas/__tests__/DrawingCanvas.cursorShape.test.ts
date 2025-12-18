import { resolveBrushCursorShape } from '../DrawingCanvas';
import { BrushShape, type Tool } from '@/types';

describe('resolveBrushCursorShape', () => {
  const baseTools = {
    currentTool: 'brush' as Tool,
    brushSettings: { brushShape: BrushShape.SQUARE },
    eraserSettings: { brushShape: BrushShape.ROUND },
  };

  it('uses the eraser brush shape when eraser is active', () => {
    const shape = resolveBrushCursorShape({
      ...baseTools,
      currentTool: 'eraser',
      eraserSettings: { brushShape: BrushShape.PIXEL_ROUND },
    });

    expect(shape).toBe(BrushShape.PIXEL_ROUND);
  });

  it('falls back to the brush shape when eraser shape is missing', () => {
    const shape = resolveBrushCursorShape({
      ...baseTools,
      currentTool: 'eraser',
      eraserSettings: {},
    });

    expect(shape).toBe(BrushShape.SQUARE);
  });

  it('uses the brush shape for non-eraser tools', () => {
    const shape = resolveBrushCursorShape(baseTools);
    expect(shape).toBe(BrushShape.SQUARE);
  });
});
