import { BrushShape, type BrushSettings } from '@/types';

export type DrawingPipeline =
  | 'contour-fill'
  | 'color-cycle-stroke'
  | 'color-cycle-shape'
  | 'standard-stroke';

export type ToolSnapshot = {
  currentTool: string;
  shapeMode: boolean;
  brushSettings: BrushSettings;
};

const CONTOUR_PIPELINE_SHAPES = new Set<BrushShape | string>([
  BrushShape.SHAPE_FILL,
  BrushShape.CONTOUR_LINES2,
  BrushShape.CONTOUR_POLYGON,
]);

export function getColorCycleBrushFlags(settings: BrushSettings) {
  const shape = settings.brushShape;
  const isStandard = shape === BrushShape.COLOR_CYCLE || shape === BrushShape.COLOR_CYCLE_TRIANGLE;
  const isShapeVariant = shape === BrushShape.COLOR_CYCLE_SHAPE;
  const isCustom = shape === BrushShape.CUSTOM && settings.customBrushColorCycle === true;
  return {
    isStandard,
    isShapeVariant,
    isCustom,
    isAny: isStandard || isShapeVariant || isCustom,
  } as const;
}

export function resolveDrawingPipeline(tools: ToolSnapshot): DrawingPipeline {
  const { brushSettings, shapeMode } = tools;
  const shape = brushSettings.brushShape;
  const ccFlags = getColorCycleBrushFlags(brushSettings);

  if (ccFlags.isShapeVariant) {
    return 'color-cycle-shape';
  }

  if (ccFlags.isAny) {
    return 'color-cycle-stroke';
  }

  if ((shape && CONTOUR_PIPELINE_SHAPES.has(shape)) || (shapeMode && shape && CONTOUR_PIPELINE_SHAPES.has(shape))) {
    return 'contour-fill';
  }

  return 'standard-stroke';
}
