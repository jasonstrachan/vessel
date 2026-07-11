export type CcPackingPoint = Readonly<{ x: number; y: number }>;

export type CcPackingCut = Readonly<{
  from: CcPackingPoint;
  to: CcPackingPoint;
}>;

export type CcPackingChannels = Readonly<{
  paint: Uint8Array;
  gradientId: Uint8Array;
  gradientDefId: Uint16Array;
  speed: Uint8Array;
  flow: Uint8Array;
  phase: Uint8Array;
  alphaMask?: Uint8Array;
  softEdgeMask?: Uint8Array;
}>;

export type CcPackingLayerInput = Readonly<{
  layerId: string;
  layerName?: string;
  width: number;
  height: number;
  channels: CcPackingChannels;
}>;

export type CcShapeSeparationOverride = Readonly<{
  /** Explicit heuristic: treat gradient-definition discontinuities as component boundaries. */
  splitByGradientDefId?: boolean;
  expectedShapeCount?: number;
  seedGroups?: readonly (readonly CcPackingPoint[])[];
  cuts?: readonly CcPackingCut[];
}>;

export type CcExtractedShape = Readonly<{
  id: string;
  layerId: string;
  sourceBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  width: number;
  height: number;
  area: number;
  centerOfMass: CcPackingPoint;
  mask: Uint8Array;
  channels: CcPackingChannels;
}>;

export type CcQuarterTurn = 0 | 90 | 180 | 270;

export type CcRotatedShape = Readonly<{
  source: CcExtractedShape;
  rotation: CcQuarterTurn;
  width: number;
  height: number;
  centerOfMass: CcPackingPoint;
  mask: Uint8Array;
  channels: CcPackingChannels;
}>;

export type CcPackedShapePlacement = Readonly<{
  shapeId: string;
  layerId: string;
  x: number;
  y: number;
  rotation: CcQuarterTurn;
  rotated: CcRotatedShape;
  supportShapeIds: readonly string[];
  supportSpan: number;
  stabilityMargin: number;
}>;

export type CcShapePackingOptions = Readonly<{
  canvasWidth: number;
  canvasHeight: number;
  padding?: number;
  rotations?: readonly CcQuarterTurn[];
  beamWidth?: number;
  minimumSupportSpanRatio?: number;
  allowNonGravityNesting?: boolean;
  allowPartialPreview?: boolean;
  allowOverlap?: boolean;
}>;

export type CcShapePackingMetrics = Readonly<{
  shapeCount: number;
  occupiedArea: number;
  packedHeight: number;
  horizontalSpan: number;
  boundingWasteArea: number;
  packingDensity: number;
  exploredStateCount: number;
  orderingCount: number;
}>;

export type CcShapePackingResult = Readonly<{
  placements: readonly CcPackedShapePlacement[];
  metrics: CcShapePackingMetrics;
}>;

export class CcShapePackingError extends Error {
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = 'CcShapePackingError';
    this.code = code;
    this.details = details;
  }
}
