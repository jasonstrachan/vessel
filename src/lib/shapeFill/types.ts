export type Vec2 = {
  x: number;
  y: number;
};

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export interface ShapeDefinition {
  id: string;
  points: Vec2[];
  centroid: Vec2;
  bounds: Bounds;
}

export interface FillParams {
  spacing: number;
  rotation: number;
  thickness: number;
  variance?: number;
  seed?: number;
  [key: string]: number | undefined;
}

export interface FillResult {
  lines?: Vec2[][];
  dots?: Vec2[];
  polygons?: Vec2[][];
}

export interface StrokeJob {
  id: number;
  origin: Vec2;
  direction: Vec2;
  length: number;
  thickness: number;
  jitter?: number;
  weight?: number;
  seed?: number;
  [key: string]: unknown;
}

export interface FieldGeneratorConfig {
  shape: ShapeDefinition;
  params: FillParams;
  bounds: Bounds;
  pixelDensity?: number;
  samplesPerStroke?: number;
  maxStrokeCount?: number;
  seed?: number;
  preview?: boolean;
  [key: string]: unknown;
}

export interface FieldGeneratorResult {
  jobs: StrokeJob[];
  totalLength: number;
  rejectedJobs: number;
  timeMs?: number;
  buffers?: {
    positions?: Float32Array;
    directions?: Float32Array;
    metadata?: Uint32Array;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export enum FillStage {
  Drawing = 'Drawing',
  AdjustingParam = 'AdjustingParam',
  Finalized = 'Finalized',
}

export interface ShapeFillSession {
  stage: FillStage;
  points: Vec2[];
  params: Partial<FillParams>;
  paramQueue: (keyof FillParams)[];
  shape?: ShapeDefinition;
  currentParam?: keyof FillParams;
}

export type FillParameterKey = keyof FillParams;

export interface FillStrategy {
  id: string;
  label: string;
  defaults: FillParams;
  apply(shape: ShapeDefinition, params: FillParams): FillResult;
}
