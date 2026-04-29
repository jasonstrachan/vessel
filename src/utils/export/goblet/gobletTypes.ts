import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import type { LayerTransform } from '@/utils/layerAlignment';
import type {
  ContentBounds,
  DisplayFilterConfig,
  ExportContainerLayout,
  Layer,
  LayerAlignmentSettings,
  Project,
  WebGLExportBundleFormat,
} from '@/types';

export type WebGLViewportMode = 'fixed' | 'fill' | 'fit' | 'cover';

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

export interface CanvasExportFormatOption {
  type: CanvasExportMimeType;
  quality?: number;
}

export interface WebGLSerializedBrushState {
  width: number;
  height: number;
  indexBuffer: number[] | string;
  gradientIdBuffer?: number[] | string;
  gradientDefIdBuffer?: number[] | string;
  speedBuffer?: number[] | string;
  flowBuffer?: number[] | string;
  phaseBuffer?: number[] | string;
  gradientStops: SerializedGradientStops;
  palette?: Array<string | number>;
  animationOffset: number;
  animationSpeed?: number;
  legacySpeedCps?: number;
  targetFPS?: number;
  flowDirection?: 'forward' | 'reverse' | 'pingpong';
  alphaMode?: 'source' | 'opaque-indices';
}

export interface WebGLSerializedColorCycle {
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
  alphaMask?: WebGLSerializedAlphaMask;
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
  stackIndex?: number;
  version?: number;
}

export interface WebGLExportAnimationMetadata {
  fps: number;
  totalFrames: number;
  durationSeconds: number;
  perfectLoop: boolean;
}

export interface WebGLExportMetadata {
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
  layers: WebGLLayerMetadata[];
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
}
