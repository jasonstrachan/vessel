import type { GradientStop } from '@/lib/GradientPalette';
import type { FlowMode } from '@/lib/colorCycle/flowEncoding';
import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import type {
  ColorCycleBrushLayerSnapshot,
  ColorCycleStrokeSnapshot,
} from '@/lib/colorCycle/document';
import type { DerivedGradientSpec } from '@/types';
import type {
  CCMutationSnapshot,
  ScalarBufferSummary,
} from '@/utils/colorCycle/ccMutationAudit';
import type { PatternStyle } from '@/utils/ditherAlgorithms';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';
import type { ColorCycleSampledMotion } from '@/types';

import type { StampShape } from './colorCycleBrushContracts';
import type {
  StampDitherAlgorithm,
  StampDitherState,
} from './strokeStampDither';

export type RgbColor = { r: number; g: number; b: number };
export type Vec2 = { x: number; y: number };
export type FillMode = 'linear' | 'concentric';

export type FillOptions = {
  continuous?: boolean;
  ditherLevels?: number;
  ccGradient?: boolean;
  ditherPixelSize?: number;
  ditherPairBandCount?: number;
  ditherPaletteSpread?: number;
  ditherPatternDiversity?: number;
  ditherBackgroundFill?: boolean;
  ditherFlatCycle?: boolean;
  ditherFlatCycleBands?: number;
  ditherSampledStops?: StoredStop[];
  ditherBaseOffsetOverride?: number;
  paintSlotOverride?: number;
  paintDefIdOverride?: number;
  shapePhaseSeedMarkId?: string | null;
  sampledMotionOverride?: ColorCycleSampledMotion;
  roi?: { x: number; y: number; width: number; height: number };
  linearGradientSpan?: number;
  spacing?: number;
  lostEdge?: number;
};

export type LayerStrokeState = {
  hasContent: boolean;
  contentIsOptimistic: boolean;
  strokeCounter: number;
  stampCounter: number;
  strokePhaseUnits: number;
  strokeCycleSpeed: number;
  strokeSpeedByte: number;
  lastPoint: Vec2 | null;
  skipStampDitherFinalize?: boolean;
  buffers: {
    paint: Uint8Array;
    gid: Uint8Array;
    spd: Uint8Array;
    flow: Uint8Array;
    phase: Uint8Array;
    def: Uint16Array;
  };
  flow: {
    activeSlot: number;
    encoded: boolean;
    mode?: FlowMode;
  };
  externalBase: {
    hasExternalBase: boolean;
  };
  stampDither?: StampDitherState;
  snapshot?: ColorCycleStrokeSnapshot;
};

export type ColorCycleRuntimeMutationReason =
  | 'brush-stroke-write'
  | 'selection-region-clear'
  | 'shape-erase'
  | 'transparency-lock-erase'
  | 'manual-clear-layer'
  | 'non-cc-brush-cleanup'
  | 'snapshot-apply'
  | 'history-restore'
  | 'project-load-restore'
  | 'runtime-reset';

export type ColorCycleRuntimeMutationSource =
  | 'stroke'
  | 'region'
  | 'clear'
  | 'snapshot'
  | 'restore'
  | 'history'
  | 'project-load'
  | 'reset';

export type ColorCycleRuntimeMutationAuditSnapshot = {
  layer: CCMutationSnapshot;
  buffers: {
    paint: ScalarBufferSummary;
    gradientId: ScalarBufferSummary;
    gradientDefId: ScalarBufferSummary;
    speed: ScalarBufferSummary;
    flow: ScalarBufferSummary;
    phase: ScalarBufferSummary;
  };
};

export type AnimatorSerializedState = ReturnType<ColorCycleAnimator['serialize']>;
export type StrokeDataSnapshot = ColorCycleStrokeSnapshot;

export interface AnimatorIndexSnapshot {
  width: number;
  height: number;
  data: ArrayBuffer;
  gradientIdData?: ArrayBuffer;
  speedData?: ArrayBuffer;
  flowData?: ArrayBuffer;
  phaseData?: ArrayBuffer;
  gradientStops?: GradientStop[];
  gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
  slotPalettes?: Array<{ slot: number; stops: GradientStop[]; seamProfile?: GradientSeamProfile }>;
  activeGradientId?: string;
  paintSlot?: number;
  legacyRemap?: { from: number; to: number };
}

export interface SerializedLayerState {
  layerId: string;
  data: AnimatorSerializedState;
  strokeData?: ColorCycleStrokeSnapshot;
  gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
  slotPalettes?: Array<{ slot: number; stops: GradientStop[]; seamProfile?: GradientSeamProfile }>;
  gradientDefStore?: Array<{
    id: number;
    kind: 'linear' | 'concentric';
    stops: GradientStop[];
    hash: string;
    source: 'manual' | 'fg' | 'sampled';
    seamProfile?: GradientSeamProfile;
    createdAtMs: number;
    slot?: number;
    speedCps?: number;
  }>;
  nextGradientDefId?: number;
  paintSlot?: number;
  legacyRemap?: { from: number; to: number };
  fgActiveSlot?: number;
  fgDerivedKey?: string;
  fgDerivedGradients?: Array<{
    key: string;
    slot: number;
    spec: DerivedGradientSpec;
  }>;
  derivedGradients?: Array<{
    key: string;
    slot: number;
    spec: DerivedGradientSpec;
  }>;
  activeGradientId?: string;
}

export type SerializedLayerColorCycleMeta = Omit<SerializedLayerState, 'layerId' | 'data' | 'strokeData'>;

export type LayerSnapshotEntry = Partial<ColorCycleBrushLayerSnapshot> & {
  layerId: string;
  animatorIndex?: AnimatorIndexSnapshot;
};

export type LayerSnapshots = Map<string, ArrayBuffer> | LayerSnapshotEntry[];

export interface ColorCycleBrushCanvasState {
  cycleSpeed?: number;
  layerBaseSpeed?: number;
  playbackSpeedScale?: number;
  fps?: number;
  brushSize?: number;
  layerSnapshots?: LayerSnapshots;
  ditherEnabled?: boolean;
  ditherStrength?: number;
  ditherPixelSize?: number;
  perceptualDither?: boolean;
  stampShape?: StampShape;
  stampDitherEnabled?: boolean;
  stampDitherPixelSize?: number;
  stampDitherAlgorithm?: StampDitherAlgorithm;
  stampDitherPatternStyle?: PatternStyle;
  stampDitherPatternTileId?: string | null;
  stampDitherPatternTileScale?: number | null;
  stampDitherPatternTileInvert?: boolean | null;
  stampDitherPatternTileThreshold?: number | null;
  stampDitherPatternTileOffsetX?: number | null;
  stampDitherPatternTileOffsetY?: number | null;
  stampDitherBgFill?: boolean;
  stampDitherClears?: boolean;
  stampDitherPressureLinked?: boolean;
  pxlEdgeEnabled?: boolean;
  [key: string]: unknown;
}

export interface ColorCycleBrushCanvasSerialized {
  layers: SerializedLayerState[];
  cycleSpeed: number;
  layerBaseSpeed?: number;
  playbackSpeedScale?: number;
  fps: number;
  brushSize: number;
  ditherEnabled?: boolean;
  ditherStrength?: number;
  ditherPixelSize?: number;
  perceptualDither?: boolean;
  stampShape?: StampShape;
  stampDitherEnabled?: boolean;
  stampDitherPixelSize?: number;
  stampDitherAlgorithm?: StampDitherAlgorithm;
  stampDitherPatternStyle?: PatternStyle;
  stampDitherPatternTileId?: string | null;
  stampDitherPatternTileScale?: number | null;
  stampDitherPatternTileInvert?: boolean | null;
  stampDitherPatternTileThreshold?: number | null;
  stampDitherPatternTileOffsetX?: number | null;
  stampDitherPatternTileOffsetY?: number | null;
  stampDitherBgFill?: boolean;
  stampDitherClears?: boolean;
  stampDitherPressureLinked?: boolean;
  pxlEdgeEnabled?: boolean;
}
