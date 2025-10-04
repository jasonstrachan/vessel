import type { BrushSettings } from '@/types';

export interface Vec2 {
  x: number;
  y: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface StrokeResolution {
  /** Width of the render target in device pixels */
  width: number;
  /** Height of the render target in device pixels */
  height: number;
  /** Scale factor relative to the final output (1 = full res, 0.5 = half res) */
  scale: number;
  /** World units per texel for the field evaluation (defaults to 1.0 for per-pixel sampling) */
  fieldResolution?: number;
}

export interface StrokeJob {
  /** Stable identifier so downstream passes can correlate updates */
  id: string;
  /** Vertices expressed in canvas space; will be quantized if pixel mode is active */
  vertices: readonly Vec2[] | Float32Array;
  /** Optional precomputed bounds to skip recalculation */
  bounds?: BoundingBox;
  /** Active brush settings snapshot when the stroke was queued */
  brushSettings?: BrushSettings;
  /** Deterministic seed for stochastic passes */
  seed?: number;
  /** Per-job dynamic parameters forwarded to GPU/worker pipelines */
  dynamicParams?: Record<string, number>;
  /** Preview render target description */
  previewResolution?: StrokeResolution;
  /** Final render target description */
  finalResolution?: StrokeResolution;
  /** When true, coordinates snap to whole pixels prior to upload */
  pixelMode?: boolean;
  /** Indicates ShapeAdjustHelper is still streaming updates */
  pendingGizmo?: boolean;
  /** Tile margin override in world units */
  margin?: number;
  /** Arbitrary metadata for diagnostics */
  metadata?: Record<string, unknown>;
}

export interface StrokeJobUpdate {
  jobId: string;
  /** Only the fields listed here will be patched into the original stroke */
  brushSettingsPatch?: Partial<BrushSettings>;
  /** Optional override for seed-based parameters */
  seed?: number;
  /** Free-form parameter bundle to feed shaders (kept flexible for helper bands) */
  params?: Record<string, number>;
}

export interface TileDescriptor {
  /** Unique key composed as `${tileX}:${tileY}` for stable cache lookups */
  id: string;
  /** Tile origin in world/canvas coordinates */
  origin: Vec2;
  /** Tile extent (width/height) in world units inclusive of overlap */
  size: Vec2;
  /** Resolution for this tile expressed as world units per texel */
  resolution: number;
  /** Grid width in texels computed from size/resolution */
  gridWidth: number;
  /** Grid height in texels computed from size/resolution */
  gridHeight: number;
  /** Overlap margin applied when composing contiguous tiles */
  overlap: number;
  /** Index of the tile in the breadth-first streaming order */
  order: number;
}

export interface FieldGeneratorConfig {
  /** Default texel resolution if none is supplied by stroke */
  defaultResolution?: number;
  /** Tile dimensions in world units */
  tileSize?: number;
  /** Overlap in world units; should match plan notes (64 by default) */
  overlap?: number;
  /** Additional padding around geometry before tiling */
  margin?: number;
  /** Workgroup size for compute shader dispatch */
  workgroupSize?: number;
}

export interface FieldTileGPUResource {
  descriptor: TileDescriptor;
  /** Storage texture holding distance (R), gradient.xy (G/B), sign (A) */
  distanceTexture: GPUTexture;
  /** Dedicated storage buffer sized for debug readbacks when needed */
  distanceReadback?: GPUBuffer;
  /** Uniform buffer used for dispatch; returned so schedulers can reuse */
  uniformBuffer: GPUBuffer;
}

export interface FieldGeneratorResult {
  jobId: string;
  /** GPU resources keyed by tile */
  tiles: FieldTileGPUResource[];
  /** Shared vertex buffer uploaded for this job */
  vertexBuffer: GPUBuffer;
  /** Stats for profiling and instrumentation */
  metrics: {
    tilesProcessed: number;
    workgroupsDispatched: number;
    generationTimeMs: number;
  };
  /** Release textures/buffers once downstream passes complete */
  release(): void;
}
