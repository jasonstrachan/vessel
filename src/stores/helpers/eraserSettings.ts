import { BrushShape, type BrushSettings } from '@/types';

export const ERASER_TIP_OPTIONS = ['square', 'round', 'diamond5'] as const;
export type EraserTipOption = (typeof ERASER_TIP_OPTIONS)[number];

type EraserShapeSettings = Pick<BrushSettings, 'brushShape' | 'ditherStrokeTipShape'>;

export const resolveEraserTipOption = (
  settings?: Partial<EraserShapeSettings> | null
): EraserTipOption => {
  if (!settings) {
    return 'square';
  }

  if (
    settings.brushShape === BrushShape.PIXEL_DITHER &&
    settings.ditherStrokeTipShape === 'diamond5'
  ) {
    return 'diamond5';
  }

  if (settings.brushShape === BrushShape.PIXEL_ROUND || settings.brushShape === BrushShape.ROUND) {
    return 'round';
  }

  return 'square';
};

export const createEraserTipSettingsPatch = (
  tip: EraserTipOption
): Pick<BrushSettings, 'brushShape' | 'ditherStrokeTipShape' | 'antialiasing'> => {
  if (tip === 'diamond5') {
    return {
      brushShape: BrushShape.PIXEL_DITHER,
      ditherStrokeTipShape: 'diamond5',
      antialiasing: false,
    };
  }

  if (tip === 'round') {
    return {
      brushShape: BrushShape.PIXEL_ROUND,
      ditherStrokeTipShape: 'round',
      antialiasing: false,
    };
  }

  return {
    brushShape: BrushShape.SQUARE,
    ditherStrokeTipShape: 'square',
    antialiasing: false,
  };
};

export const sanitizeEraserTipSettings = (
  settings?: Partial<EraserShapeSettings> | null
): Pick<BrushSettings, 'brushShape' | 'ditherStrokeTipShape' | 'antialiasing'> => {
  const tip = resolveEraserTipOption(settings);
  if (tip === 'round' && settings?.brushShape === BrushShape.ROUND) {
    return {
      brushShape: BrushShape.ROUND,
      ditherStrokeTipShape: 'round',
      antialiasing: false,
    };
  }
  return createEraserTipSettingsPatch(tip);
};
