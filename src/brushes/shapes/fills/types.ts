import type { BrushSettings, ContourLinesBasis } from '@/types';
import type { ShapeFillScheduler } from '@/lib/shapeFill/ShapeFillScheduler';
import type { StrokeJob } from '@/lib/shapeFill';
import type { ViewTransform } from '@/lib/shapeFill/ShapeAdjustHelper';
import type { SignedDistanceFieldResult } from '@/lib/shapeFill/cpu/contourGeometry';

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
  runtimeContext?: {
    overlayCanvas?: HTMLCanvasElement | null;
    finalCanvas?: HTMLCanvasElement | null;
    viewTransform?: ViewTransform;
    devicePixelRatio?: number;
  };
};

export type ShapeFillDependencies = {
  applyRisographEffect: (ctx: CanvasRenderingContext2D, vertices: Point[], intensity: number) => void;
  createSignedDistanceField: (
    vertices: Point[],
    options: {
      canvasWidth: number;
      canvasHeight: number;
      resolution?: number;
      margin?: number;
      seed?: number;
    }
  ) => SignedDistanceFieldResult;
  extractContour: (
    field: SignedDistanceFieldResult,
    level: number,
    smoothness?: number
  ) => Array<[Point, Point]>;
  connectSegments: (segments: Array<[Point, Point]>, tolerance?: number, minPerimeter?: number) => Point[][];
  gpuScheduler?: ShapeFillScheduler;
  getOverlayCanvas?: () => HTMLCanvasElement | null;
  getCompositeCanvas?: () => HTMLCanvasElement | null;
  getViewTransform?: () => ViewTransform | undefined;
  recordShapeFillJob?: (job: StrokeJob, metadata: { brushSettings?: BrushSettings; mode?: string; runtimeContext?: ContourLineOptions['runtimeContext'] }) => void;
  flushShapeFillJobs?: (finalCanvas: HTMLCanvasElement | null | undefined, description?: string, overrideLayerId?: string) => void;
};

export interface PolygonFillBase {
  ctx: CanvasRenderingContext2D;
  vertices: Point[];
  brushSettings: BrushSettings;
  runtimeContext?: ContourLineOptions['runtimeContext'];
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
  dependencies?: ShapeFillDependencies;
  isPreview?: boolean;
  strokeColorOverride?: string;
}

export type Lines2FillParams = LinesFillParams;
