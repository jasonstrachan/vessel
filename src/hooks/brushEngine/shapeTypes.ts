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
  ditherPixelSize?: number;
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
>;
