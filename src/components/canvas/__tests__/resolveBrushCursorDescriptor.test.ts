import { BrushShape, type Tool } from '@/types';
import { resolveBrushCursorDescriptor } from '../resolveBrushCursorDescriptor';

describe('resolveBrushCursorDescriptor', () => {
  const baseTools = {
    currentTool: 'brush' as Tool,
    brushSettings: {
      size: 15,
      brushShape: BrushShape.PIXEL_DITHER,
      antialiasing: false,
      rotationEnabled: false,
      ditherStrokeTipShape: 'round' as const,
    },
    eraserSettings: {},
  };

  it('keeps round pixel-dither cursor size equal to the stamp size', () => {
    const descriptor = resolveBrushCursorDescriptor({
      tools: baseTools,
      globalBrushSize: 15,
    });

    expect(descriptor).toEqual({
      kind: 'shape',
      shape: BrushShape.ROUND,
      pixelSize: 15,
    });
  });

  it('expands diamond cursor size to match rotated stamp footprint', () => {
    const descriptor = resolveBrushCursorDescriptor({
      tools: {
        ...baseTools,
        brushSettings: {
          ...baseTools.brushSettings,
          ditherStrokeTipShape: 'diamond',
        },
      },
      globalBrushSize: 15,
    });

    expect(descriptor).toEqual({
      kind: 'shape',
      shape: BrushShape.SQUARE,
      pixelSize: 22,
    });
  });

  it('uses the rasterized grid size for diamond9 pixel-dither tips', () => {
    const descriptor = resolveBrushCursorDescriptor({
      tools: {
        ...baseTools,
        brushSettings: {
          ...baseTools.brushSettings,
          size: 15,
          ditherStrokeTipShape: 'diamond9',
        },
      },
      globalBrushSize: 15,
    });

    expect(descriptor).toEqual({
      kind: 'shape',
      shape: BrushShape.SQUARE,
      pixelSize: 18,
    });
  });
});
