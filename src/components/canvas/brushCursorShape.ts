import { BrushShape, type BrushSettings, type Tool } from '@/types';

export const resolveBrushCursorShape = (tools: {
  currentTool: Tool;
  brushSettings: { brushShape?: BrushShape; ditherStrokeTipShape?: BrushSettings['ditherStrokeTipShape'] };
  eraserSettings: { brushShape?: BrushShape };
}): BrushShape => {
  if (tools.currentTool === 'eraser') {
    return (
      tools.eraserSettings.brushShape ??
      tools.brushSettings.brushShape ??
      BrushShape.ROUND
    );
  }
  const brushShape = tools.brushSettings.brushShape ?? BrushShape.ROUND;
  if (brushShape === BrushShape.PIXEL_DITHER) {
    const tipShape = tools.brushSettings.ditherStrokeTipShape ?? 'round';
    if (tipShape === 'round') return BrushShape.ROUND;
    if (tipShape === 'triangle') return BrushShape.TRIANGLE;
    return BrushShape.SQUARE;
  }
  return brushShape;
};
