import type { BrushSettings } from '@/types';

export type Point2D = { x: number; y: number };

export type PolygonGradientData = {
  vertices: Point2D[];
  colors: string[];
};

export type RoiRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GradientDitherOptions = {
  ditherLevels?: number;
  ditherPixelSize?: number;
  ditherPairBandCount?: number;
  ditherPaletteSpread?: number;
  roi?: RoiRect;
};

export type RectangleGradientSettings = Pick<
  BrushSettings,
  | 'opacity'
  | 'color'
  | 'ditherEnabled'
  | 'risographIntensity'
  | 'colors'
  | 'gradientBands'
  | 'fillResolution'
  | 'ditherAlgorithm'
  | 'patternStyle'
  | 'ditherPaletteSpread'
  | 'risographColorShift'
>;

export type PolygonGradientSettings = Pick<
  BrushSettings,
  | 'opacity'
  | 'color'
  | 'ditherEnabled'
  | 'risographIntensity'
  | 'colors'
  | 'gradientBands'
  | 'fillResolution'
  | 'ditherAlgorithm'
  | 'patternStyle'
  | 'ditherPaletteSpread'
>;
