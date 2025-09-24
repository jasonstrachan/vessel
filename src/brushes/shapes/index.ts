import { BrushShape } from '@/types';

import { drawRoundShape } from './round';
import { drawSquareShape } from './square';
import type { ShapeDrawFunction } from './types';
import { drawTriangleShape } from './triangle';

export { drawAntialiasedLine } from './antialiasedLine';
export { drawPixelPerfectLine } from './pixelPerfectLine';
export { drawRoundShape } from './round';
export { drawSquareShape } from './square';
export type { ShapeDrawFunction } from './types';
export { drawTriangleShape } from './triangle';

const SHAPE_DRAW_FUNCTIONS: Partial<Record<BrushShape, ShapeDrawFunction>> = {
  [BrushShape.SQUARE]: drawSquareShape,
  [BrushShape.ROUND]: drawRoundShape,
  [BrushShape.PIXEL_ROUND]: drawRoundShape,
  [BrushShape.TRIANGLE]: drawTriangleShape,
};

export const getShapeDrawFunction = (shape: BrushShape): ShapeDrawFunction | null =>
  SHAPE_DRAW_FUNCTIONS[shape] ?? null;
