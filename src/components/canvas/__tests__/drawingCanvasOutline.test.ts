import { drawCanvasOutlineLayer } from '@/components/canvas/drawingCanvasOutline';
import type { CanvasShape } from '@/types';

const createContext = () => ({
  save: jest.fn(),
  restore: jest.fn(),
  translate: jest.fn(),
  scale: jest.fn(),
  strokeRect: jest.fn(),
});

describe('drawCanvasOutlineLayer', () => {
  const baseOptions = {
    scale: 2,
    offsetX: 10,
    offsetY: 12,
    editorDraftShape: null,
    editorActive: false,
    strokeCanvasShapeOutline: jest.fn(),
  };

  it('does not draw a persistent outline around the canvas bounds', () => {
    const ctx = createContext();

    drawCanvasOutlineLayer({
      ...baseOptions,
      ctx: ctx as unknown as CanvasRenderingContext2D,
    });

    expect(ctx.strokeRect).not.toHaveBeenCalled();
    expect(baseOptions.strokeCanvasShapeOutline).not.toHaveBeenCalled();
  });

  it('still draws the temporary editor draft outline', () => {
    const ctx = createContext();
    const strokeCanvasShapeOutline = jest.fn();
    const editorDraftShape = { kind: 'ellipse' } as unknown as CanvasShape;

    drawCanvasOutlineLayer({
      ...baseOptions,
      ctx: ctx as unknown as CanvasRenderingContext2D,
      editorActive: true,
      editorDraftShape,
      strokeCanvasShapeOutline,
    });

    expect(strokeCanvasShapeOutline).toHaveBeenCalledWith(
      ctx,
      editorDraftShape,
      {
        strokeStyle: '#C7D7F8',
        lineWidth: 0.75,
        dash: [3, 2],
      }
    );
  });
});
