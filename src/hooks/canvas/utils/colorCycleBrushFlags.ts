import { BrushShape, type BrushSettings } from '@/types';

export type ColorCycleBrushFlags = {
  isStandard: boolean;
  isShapeVariant: boolean;
  isCustom: boolean;
  isAny: boolean;
};

export const getColorCycleBrushFlags = (settings: BrushSettings): ColorCycleBrushFlags => {
  const shape = settings.brushShape;
  const isStandard = shape === BrushShape.COLOR_CYCLE || shape === BrushShape.COLOR_CYCLE_TRIANGLE;
  const isShapeVariant = shape === BrushShape.COLOR_CYCLE_SHAPE;
  const isCustom = shape === BrushShape.CUSTOM && settings.customBrushColorCycle === true;
  return {
    isStandard,
    isShapeVariant,
    isCustom,
    isAny: isStandard || isShapeVariant || isCustom
  };
};
