import { BrushShape, type Tool } from '@/types';

const CROSSHAIR_TOOLS = new Set<Tool>(['fill', 'magic-wand', 'crop', 'recolor', 'selection', 'custom']);

export const resolveDefaultCursorStyle = ({
  currentTool,
  brushShape,
  shapeMode,
}: {
  currentTool: Tool;
  brushShape: BrushShape | undefined;
  shapeMode: boolean;
}): string => {
  if (CROSSHAIR_TOOLS.has(currentTool)) {
    return 'crosshair';
  }

  if (brushShape === BrushShape.PIXEL_DITHER && shapeMode) {
    return 'crosshair';
  }

  if (
    brushShape === BrushShape.RECTANGLE_GRADIENT ||
    brushShape === BrushShape.POLYGON_GRADIENT ||
    brushShape === BrushShape.DITHER_GRADIENT ||
    brushShape === BrushShape.CONTOUR_POLYGON ||
    brushShape === BrushShape.CONTOUR_LINES2 ||
    brushShape === BrushShape.COLOR_CYCLE_SHAPE ||
    brushShape === BrushShape.SPAM_TEXT ||
    brushShape === BrushShape.SHAPE_FILL
  ) {
    return 'crosshair';
  }

  return 'none';
};
