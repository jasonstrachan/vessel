import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import type { SampledPathPalette } from '@/lib/colorCycle/sampledPathPalette';
import type { LayerTransform } from '@/utils/layerAlignment';
import type {
  AdjustmentLayerData,
  ContentBounds,
  DisplayFilterConfig,
  ExportContainerLayout,
  InterlacePatternPreset,
  Layer,
  LayerAlignmentSettings,
  Project,
  TxtShape,
  TxtShapePlaybackSettings,
  UiShape,
  WebGLExportBundleFormat,
} from '@/types';

export type WebGLViewportMode = 'fixed' | 'fill' | 'fit' | 'cover';

export type WebGLExportProgressPhase =
  | 'blocked'
  | 'preparing'
  | 'layers'
  | 'packaging'
  | 'complete'
  | 'failed';

export interface GobletSingleHtmlBreakdown {
  runtimeBytes: number;
  ccBufferBytes: number;
  maskBytes: number;
  textureBytes: number;
  sequentialFrameBytes: number;
  previewBytes: number;
  fallbackBytes: number;
  otherBytes: number;
}

export interface GobletSizeReport {
  format: 'json' | 'zip' | 'single-html';
  totalBytes: number;
  metadataBytes: number;
  runtimeBytes: number;
  htmlBytes: number;
  ccBufferBytes: number;
  maskBytes: number;
  textureBytes: number;
  sequentialFrameBytes: number;
  previewBytes: number;
  fallbackBytes: number;
  binarySidecarBytes: number;
  binarySidecarCount: number;
  duplicatedMetadataBytes: number;
  singleHtmlBreakdown?: GobletSingleHtmlBreakdown;
}

export type WebGLExportLayerStatus =
  | 'waiting'
  | 'exporting'
  | 'skipped-hidden'
  | 'skipped-empty'
  | 'hydrating-cc-archive'
  | 'building-cc-payload'
  | 'validating-cc-payload'
  | 'packing-cc-payload'
  | 'exported'
  | 'static-preview'
  | 'done'
  | 'failed'
  | 'skipped';

export interface WebGLExportProgressEvent {
  phase: WebGLExportProgressPhase;
  percent: number;
  message?: string;
  layer?: {
    id: string;
    name: string;
    status: WebGLExportLayerStatus;
    message?: string;
    colorCycle?: {
      source?: string;
      payloadPixels?: number;
      nonZeroPaint?: number;
      usedSlots?: number;
      paletteSlots?: number;
      diagnostics?: string[];
    };
  };
  error?: {
    message: string;
    stack?: string;
  };
}

export interface WebGLViewport {
  mode: WebGLViewportMode;
  designWidth: number;
  designHeight: number;
}

export interface WebGLLayerAsset {
  texture?: string;
  textureFrames?: string[];
  textureFrameMap?: number[];
}

export type CanvasExportMimeType = 'image/avif' | 'image/webp' | 'image/png';

export type SerializedGradientStops = Array<{ position: number; color: string }>;

export type SerializedSlotPalette = {
  slot: number;
  stops: SerializedGradientStops;
  seamProfile?: GradientSeamProfile;
};

export type SerializedGradientDefinition = {
  id: number;
  stops: SerializedGradientStops;
  seamProfile?: GradientSeamProfile;
  sampledPath?: SampledPathPalette;
};

export type NumericExportBuffer = number[] | Uint8Array | Uint16Array | string;

export interface CanvasExportFormatOption {
  type: CanvasExportMimeType;
  quality?: number;
}

export interface WebGLSerializedBrushState {
  width: number;
  height: number;
  indexBuffer: NumericExportBuffer;
  gradientIdBuffer?: NumericExportBuffer;
  gradientDefIdBuffer?: NumericExportBuffer;
  speedBuffer?: NumericExportBuffer;
  flowBuffer?: NumericExportBuffer;
  phaseBuffer?: NumericExportBuffer;
  gradientStops: SerializedGradientStops;
  palette?: Array<string | number>;
  animationOffset: number;
  animationSpeed?: number;
  legacySpeedCps?: number;
  targetFPS?: number;
  flowDirection?: 'forward' | 'reverse' | 'pingpong';
  alphaMode?: 'source' | 'opaque-indices';
  stampDitherEnabled?: boolean;
}

export interface WebGLSerializedColorCycle {
  playbackClock?: {
    timeSeconds: number;
    speedScale: number;
    timeCurve?: { durationSeconds: number; samples: number[] };
    opacityCurve?: { durationSeconds: number; samples: number[] };
  };
  mode: NonNullable<Layer['colorCycleData']>['mode'] | 'brush';
  gradient?: SerializedGradientStops;
  gradientRef?: number;
  brushSpeed?: number | null;
  controllerSpeedCps?: number | null;
  layerBaseSpeedCps?: number | null;
  speedMode?: 'slot' | 'buffer';
  slotSpeeds?: Array<{ slot: number; speed: number }>;
  speedMin?: number;
  speedMax?: number;
  isAnimating: boolean;
  recolorSettings?: Record<string, unknown> & {
    width?: number;
    height?: number;
  };
  brushState?: WebGLSerializedBrushState;
  slotPalettes?: SerializedSlotPalette[];
  gradientDefStore?: SerializedGradientDefinition[];
  alphaMask?: WebGLSerializedAlphaMask;
  softEdgeMask?: WebGLSerializedAlphaMask;
  coverageBoundsPx?: WebGLLayerBounds;
  coverageBoundsSourcePx?: WebGLLayerBounds;
}

export interface WebGLSerializedSequential {
  fps: number;
  totalFrames: number;
  durationSeconds: number;
  perfectLoop: boolean;
}

export interface BrushStateRuntimePayload {
  width: number;
  height: number;
  indices: number[];
  palette?: Array<string | number>;
}

export interface ColorCycleRuntimeMetadata {
  brushState?: BrushStateRuntimePayload;
  sourceCropPx?: WebGLLayerBounds;
  sourceCropBasis?: { width: number; height: number };
}

export interface ColorCycleSerializationResult {
  colorCycle?: WebGLSerializedColorCycle;
  runtime?: ColorCycleRuntimeMetadata;
}

export interface WebGLSerializedAlphaMask {
  width: number;
  height: number;
  data: number[] | string;
}

export interface SerializedAlphaMaskResult {
  payload: WebGLSerializedAlphaMask;
  values: Uint8Array;
  coverageBounds?: WebGLLayerBounds;
}

export interface ColorCycleMaskDataset {
  width: number;
  height: number;
  values: Uint8Array;
  coverage?: WebGLLayerBounds;
}

export interface ColorCycleCoverageResult {
  source: WebGLLayerBounds;
  document: WebGLLayerBounds;
}

export interface WebGLLayerSource {
  width: number;
  height: number;
}

/**
 * Rectangle describing a layer in design-space coordinates.
 */
export interface WebGLLayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WebGLLayerBoundsPercent = WebGLLayerBounds;

export interface WebGLLayerPlacement {
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  transform: LayerTransform;
}

export interface AlignmentExportPayload {
  fit: LayerAlignmentSettings['fit'];
  horizontal: LayerAlignmentSettings['horizontal'];
  vertical: LayerAlignmentSettings['vertical'];
  positioning: LayerAlignmentSettings['positioning'];
  offsetPercent?: { x: number; y: number };
}

export interface WebGLLayerMetadata {
  id: string;
  name: string;
  type: Layer['layerType'];
  visible?: boolean;
  opacity?: number;
  blendMode?: Layer['blendMode'];
  source: WebGLLayerSource;
  pixelBoundsPx?: WebGLLayerBounds;
  documentBoundsPx: WebGLLayerBounds;
  documentBoundsPercent: WebGLLayerBoundsPercent;
  layoutPlacement?: WebGLLayerPlacement;
  alignment: AlignmentExportPayload;
  contentBounds?: ContentBounds;
  paintedSize?: { width: number; height: number };
  assets?: WebGLLayerAsset;
  colorCycle?: WebGLSerializedColorCycle;
  sequential?: WebGLSerializedSequential;
  adjustment?: AdjustmentLayerData;
  stackIndex?: number;
  version?: number;
}

export interface WebGLExportAnimationMetadata {
  fps: number;
  totalFrames: number;
  durationSeconds: number;
  perfectLoop: boolean;
}

export interface WebGLSerializedInterlaceGroup {
  id: string;
  layerIds: string[];
  settings: {
    cellSize: number;
    dominance: number;
    patternPreset: InterlacePatternPreset;
    motionMode: 'fixed' | 'travel';
    direction: 'left' | 'right';
    travelCycles: number;
    loopDurationSeconds: number;
    seed: number;
  };
}

export interface WebGLSerializedAdjustmentGroup {
  id: string;
  layerIds: string[];
}

type GobletAutomationObjectBase = {
  id: string;
  x: number;
  y: number;
  layerId?: string;
  parentId?: string;
  clipId?: string;
  maskId?: string;
  anchorX?: number;
  anchorY?: number;
  blendMode?: 'source-over' | 'multiply' | 'screen' | 'darken' | 'lighten';
  opacity?: number;
  visible?: boolean;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
};

type GobletAutomationImageSource = (
  | { resourceId: string; dataUrl?: never }
  | { dataUrl: string; resourceId?: never }
);

export type GobletAutomationObject = GobletAutomationObjectBase & (
  | { kind: 'artwork'; width?: number; height?: number }
  | { kind: 'group' }
  | { kind: 'instance'; symbolId: string }
  | { kind: 'cursor'; hand?: boolean; pressed?: boolean }
  | { kind: 'rect'; width: number; height: number; fill: string }
  | ({
      kind: 'sprite';
      width: number;
      height: number;
      sourceX?: number;
      sourceY?: number;
      sourceWidth?: number;
      sourceHeight?: number;
    } & GobletAutomationImageSource)
);

export type GobletAutomationImageResource = {
  id: string;
  kind: 'image';
  dataUrl: string;
};

export type GobletAutomationSymbolObject = Exclude<
  GobletAutomationObject,
  { kind: 'artwork' } | { kind: 'instance' }
>;

export type GobletAutomationSymbol = {
  id: string;
  objects: GobletAutomationSymbolObject[];
};

export type GobletAutomationClip = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GobletAutomationMask = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX?: number;
  anchorY?: number;
  invert?: boolean;
  opacity?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  sourceX?: number;
  sourceY?: number;
  sourceWidth?: number;
  sourceHeight?: number;
} & GobletAutomationImageSource;

type GobletAutomationDataChannelBase = {
  id: string;
  intervalSeconds: number;
  startSeconds?: number;
  interpolation?: 'linear' | 'step';
};

export type GobletAutomationDataChannel = GobletAutomationDataChannelBase & (
  | {
      values: number[];
      encoding?: never;
      encodedValues?: never;
      sampleCount?: never;
    }
  | {
      encoding: 'f32le-base64';
      encodedValues: string;
      sampleCount: number;
      values?: never;
    }
);

type GobletAutomationKeyframe<T extends number | boolean> = {
  time: number;
  value: T;
  easing?: 'linear' | 'minimum-jerk' | 'step';
};

export type GobletAutomationTrack = {
  targetId: string;
  loopStartSeconds?: number;
  loopDurationSeconds?: number;
} & (
  | {
      property: 'x' | 'y' | 'opacity' | 'rotation' | 'scaleX' | 'scaleY' | 'sourceX' | 'sourceY' | 'playbackTime';
      keyframes: Array<GobletAutomationKeyframe<number>>;
      dataChannelId?: never;
      valueScale?: never;
      valueOffset?: never;
    }
  | {
      property: 'x' | 'y' | 'opacity' | 'rotation' | 'scaleX' | 'scaleY' | 'sourceX' | 'sourceY' | 'playbackTime';
      dataChannelId: string;
      valueScale?: number;
      valueOffset?: number;
      keyframes?: never;
    }
  | {
      property: 'visible' | 'hand' | 'pressed';
      keyframes: Array<GobletAutomationKeyframe<boolean>>;
      dataChannelId?: never;
      valueScale?: never;
      valueOffset?: never;
    }
);

export interface GobletAutomation {
  schemaVersion: 1;
  durationSeconds: number;
  clips?: GobletAutomationClip[];
  masks?: GobletAutomationMask[];
  dataChannels?: GobletAutomationDataChannel[];
  resources?: GobletAutomationImageResource[];
  symbols?: GobletAutomationSymbol[];
  objects: GobletAutomationObject[];
  tracks: GobletAutomationTrack[];
}

export interface GobletDynamicFeatureManifest {
  schemaVersion: 1;
  authored: string[];
  compiled: string[];
  requirements?: GobletDynamicFeatureRequirement[];
}

export interface GobletDynamicFeatureRequirement {
  featureId: string;
  objects?: GobletDynamicFeatureObjectRequirement[];
  /**
   * Layers whose sequential frame textures are the deterministic fallback for
   * this authored feature. This lets future 2D features compile to pixels when
   * they cannot be expressed compactly with Renderer v1 scene objects.
   */
  rasterLayerIds?: string[];
}

export interface GobletDynamicFeatureObjectRequirement {
  objectId: string;
  trackProperties: GobletAutomationTrack['property'][];
}

export interface WebGLExportMetadata {
  extensions?: Record<string, unknown>;
  format: 'vessel-goblet' | 'vessel-goblet2';
  version: 1;
  exportedAt: string;
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    backgroundColor: string;
  };
  colorCycle?: {
    schemaVersion: number;
  };
  viewport: WebGLViewport;
  container: ExportContainerLayout;
  animation: WebGLExportAnimationMetadata;
  settings: {
    includeHiddenLayers: boolean;
    embedCanvasFallback: boolean;
    minifyOutput: boolean;
    pixelPerfectStack: boolean;
    perfectLoop: boolean;
    bundleFormat: WebGLExportBundleFormat;
    displayFilters: DisplayFilterConfig[];
    viewportPreset?: 'default' | 'embed-fill' | 'embed-fit' | 'fixed';
    htmlTitle: string;
    htmlBackgroundColor: string;
    transparencyBackgroundMode: 'checker' | 'gray';
  };
  textShapes?: TxtShape[];
  txtShapePlayback?: TxtShapePlaybackSettings;
  uiShapes?: UiShape[];
  uiImageAssets?: Project['uiImageAssets'];
  automation?: GobletAutomation;
  dynamicFeatures?: GobletDynamicFeatureManifest;
  layers: WebGLLayerMetadata[];
  interlaceGroups?: WebGLSerializedInterlaceGroup[];
  adjustmentGroups?: WebGLSerializedAdjustmentGroup[];
  gradients?: SerializedGradientStops[];
  preview?: {
    type: CanvasExportMimeType;
    width: number;
    height: number;
    dataUrl: string;
  };
  fallback?: {
    type: CanvasExportMimeType;
    dataUrl: string;
  };
}

export interface WebGLExportRequest {
  project: Project;
  layers: Layer[];
  layout: ExportContainerLayout;
  viewport: Partial<WebGLViewport> & {
    mode?: WebGLViewportMode;
    designWidth?: number;
    designHeight?: number;
    width?: number;
    height?: number;
  };
  fps: number;
  totalFrames: number;
  durationSeconds: number;
  perfectLoop: boolean;
  includeHiddenLayers: boolean;
  embedCanvasFallback: boolean;
  minify: boolean;
  pixelPerfectStack?: boolean;
  filenameBase: string;
  bundleFormat?: WebGLExportBundleFormat;
  gobletVersion?: 'goblet1' | 'goblet2';
  enableGobletDiagnostics?: boolean;
  assetPrefix?: string;
  compositeLayersToCanvas?: (targetCanvas: HTMLCanvasElement) => void;
  compositeLayersToCanvasSync?: (targetCanvas: HTMLCanvasElement) => boolean;
  htmlTitle?: string;
  htmlBackgroundColor?: string;
  transparencyBackgroundMode?: 'checker' | 'gray';
  displayFilters?: DisplayFilterConfig[];
  colorCyclePlaybackSpeedScale?: number;
  colorCycleLayerSpeedScale?: number;
  colorCycleToolSpeed?: number;
  viewportPreset?: 'default' | 'embed-fill' | 'embed-fit' | 'fixed';
  onProgress?: (event: WebGLExportProgressEvent) => void;
  onSizeReport?: (report: GobletSizeReport) => void;
  signal?: AbortSignal;
}
