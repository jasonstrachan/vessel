export type MeshLayout = 'pos2' | 'pos2uv2';

export type MeshAabb = [number, number, number, number];

export interface Mesh {
  verts: Float32Array;
  indices: Uint32Array;
  layout: MeshLayout;
  aabb: MeshAabb;
  revision: number;
}

export type FillSolid = {
  type: 'solid';
  rgba: [number, number, number, number];
};

export type GradientStop = {
  t: number;
  rgba: [number, number, number, number];
};

export type FillLinear = {
  type: 'linear';
  p0: [number, number];
  p1: [number, number];
  stops: GradientStop[];
};

export type FillImage = {
  type: 'image';
  tex: string;
  uv: 'contain' | 'cover' | 'stretch';
  tx?: Float32Array;
};

export type ContourJoin = 'miter' | 'round' | 'bevel';

export type FillContour = {
  type: 'contour';
  spacing: number;
  join: ContourJoin;
  miterLimit: number;
  base: FillSolid | FillLinear | FillImage;
};

export type Fill = FillSolid | FillLinear | FillImage | FillContour;

export type PathCommand = 'moveTo' | 'lineTo' | 'closePath';

export interface SerializedPath {
  commands: PathCommand[];
  data: Float32Array;
}

export interface BuildRequest {
  kind: 'build';
  revision: number;
  paths: SerializedPath[];
  fill: Fill;
  preview: boolean;
  scaleBucket: number;
}

export interface MeshResponse {
  kind: 'mesh';
  mesh: Mesh;
  preview: boolean;
}

export type WorkerMessage = BuildRequest;
export type WorkerResponse = MeshResponse;
