export type Vec2 = { x: number; y: number };

export interface ShapeDefinition {
  id: string;
  points: Vec2[];
  centroid: Vec2;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export type ShapeFillId = 'hatch' | 'contour' | 'stipple';
export type ShapeFillParamKey = 'spacing' | 'rotation' | 'thickness' | 'variance' | 'seed';

export interface FillParams {
  spacing: number;
  rotation: number;
  thickness: number;
  variance?: number;
  seed?: number;
  organic?: number;
  cross?: boolean;
}

export interface FillResult {
  lines?: Vec2[][];
  dots?: Vec2[];
  polygons?: Vec2[][];
  lineWidth?: number;
  dotRadius?: number;
  clipPath?: Vec2[];
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
  paramQueue: ShapeFillParamKey[];
  shape?: ShapeDefinition;
  currentParam?: ShapeFillParamKey;
  cursorAnchorParam?: ShapeFillParamKey;
  cursorAnchorDirection?: Vec2;
  lastCursor?: Vec2;
}

export interface FillStrategy {
  id: ShapeFillId;
  label: string;
  defaults: FillParams;
  apply: (shape: ShapeDefinition, params: FillParams) => FillResult;
  ui: FillUIControl[];
}

export type FillUIControl =
  | {
      key: ShapeFillParamKey;
      type: 'number';
      label: string;
      min: number;
      max: number;
      step: number;
      default: number;
    }
  | {
      key: 'organic';
      type: 'number';
      label: string;
      min: number;
      max: number;
      step: number;
      default: number;
    }
  | {
      key: 'cross';
      type: 'boolean';
      label: string;
      default: boolean;
    };
