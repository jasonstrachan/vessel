import type { BrushSettings, ContourLinesBasis } from '@/types';

export type Point = { x: number; y: number };

export type ContourLineOptions = {
  variant?: 'legacy' | 'lines2';
  lineSpacingA?: number;
  lineSpacingB?: number;
  lineBasis?: ContourLinesBasis;
  lines2Angle?: number;
  lines2ConvergenceA?: Point;
  lines2ConvergenceB?: Point;
  lines2Spacing?: number;
  lines2Density?: number;
  lines2Alternate?: boolean;
  centroid?: Point | null;
  contourSpacingOverride?: number;
  randomSeed?: number;
  previewDetail?: 'minimal' | 'full';
  strokeColorOverride?: string;
};

export type ShapeFillDependencies = {
  applyRisographEffect: (ctx: CanvasRenderingContext2D, vertices: Point[], intensity: number) => void;
  createSignedDistanceField: (
    vertices: Point[],
    canvasWidth: number,
    canvasHeight: number,
    resolution?: number
  ) => {
    field: number[][];
    cols: number;
    rows: number;
    resolution: number;
    peakX: number;
    peakY: number;
    extension: number;
  };
  extractContour: (
    field: number[][],
    cols: number,
    rows: number,
    resolution: number,
    level: number,
    extension: number
  ) => Array<[Point, Point]>;
  connectSegments: (segments: Array<[Point, Point]>) => Point[][];
};

export interface PolygonFillBase {
  ctx: CanvasRenderingContext2D;
  vertices: Point[];
  brushSettings: BrushSettings;
}

export interface ContourFillParams extends PolygonFillBase {
  isPreview?: boolean;
  dependencies: ShapeFillDependencies;
  spacingOverride?: number;
  randomSeed?: number;
  previewDetail?: 'minimal' | 'full';
  strokeColorOverride?: string;
}

export interface LinesFillParams extends PolygonFillBase {
  lineOptions?: ContourLineOptions;
}

export type Lines2FillParams = LinesFillParams;

export interface DelaunayFillParams extends PolygonFillBase {
  boundWidth: number;
  boundHeight: number;
  isPreview?: boolean;
  strokeColorOverride?: string;
}

export interface FlowFillParams extends PolygonFillBase {
  dependencies: ShapeFillDependencies;
  seedSpacing?: number;
  stepSize?: number;
  maxSteps?: number;
  useOrthogonal?: boolean;
  fieldResolution?: number;
  randomSeed?: number;
  strokeColorOverride?: string;
  isPreview?: boolean;
}
