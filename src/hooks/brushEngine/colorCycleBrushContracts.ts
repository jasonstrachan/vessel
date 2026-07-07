import type {
  ColorCycleLayerDirtyBatch,
  ColorCycleLayerDocument,
  ColorCycleLayerDocumentRead,
} from '@/lib/colorCycle/document';
import type { FlowMode } from '@/lib/colorCycle/flowEncoding';
import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import type { GradientStop } from '@/lib/GradientPalette';
import type { BrushSettings } from '@/types';
import type { PatternStyle } from '@/utils/ditherAlgorithms';

import type { StampDitherAlgorithm } from './strokeStampDither';
export type StampShape = 'square' | 'round' | 'triangle' | 'diamond' | 'diamond5' | 'diamond7' | 'diamond9' | 'checkered';

export type ColorCycleBrushCanvas2DOptions = {
  brushSize?: number;
  fps?: number;
  forceCanvas2D?: boolean;
  useOffscreenCanvas?: boolean;
  useWebWorkers?: boolean;
  useWASM?: boolean;
  useImageBitmap?: boolean;
  usePerceptualDitherWorker?: boolean;
};

export type CCBrushSettings = {
  brushSize: number;
  cycleSpeed: number;
  layerBaseSpeed: number;
  playbackSpeedScale: number;
  fps: number;
  gradientBands: number;
  bandSpacing: number;
  pressureEnabled: boolean;
  minPressure: number;
  maxPressure: number;
  ditherEnabled: boolean;
  ditherStrength: number;
  ditherPixelSize: number;
  pxlEdgeEnabled: boolean;
  perceptualDither: boolean;
  stampShape: StampShape;
  stampDitherEnabled: boolean;
  stampDitherPixelSize: number;
  stampDitherAlgorithm: StampDitherAlgorithm;
  stampDitherPatternStyle: PatternStyle;
  stampDitherPatternTileId: string | null;
  stampDitherPatternTileScale: number | null;
  stampDitherPatternTileInvert: boolean | null;
  stampDitherPatternTileThreshold: number | null;
  stampDitherPatternTileOffsetX: number | null;
  stampDitherPatternTileOffsetY: number | null;
  stampDitherBgFill: boolean;
  stampDitherPressureLinked: boolean;
  flowMode: FlowMode;
  legacyFlowMode: FlowMode;
};

export type CCBrushSettingsPatch = Partial<CCBrushSettings>;

export type ColorCycleBrushDocumentControls = {
  getColorCycleLayerDocument?: (layerId: string) => { read(): ColorCycleLayerDocumentRead } | undefined;
  setColorCycleLayerDocument?: (layerId: string, document: ColorCycleLayerDocument) => void;
  removeColorCycleLayerDocument?: (layerId: string) => void;
};

export type ColorCycleBrushSurfaceControls = {
  setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
  getCanvas(): HTMLCanvasElement;
  render(...args: unknown[]): void;
  renderColorCycle?: (ctx: CanvasRenderingContext2D, applyOpacity?: boolean) => void;
  renderDirectToCanvas(canvas: HTMLCanvasElement, layerId?: string): void;
  flushPendingRender?: () => void;
  setOnFrameRendered(callback: (dirtyBatches: ColorCycleLayerDirtyBatch[]) => void): void;
};

export type ColorCycleBrushLayerControls = {
  setLayerId?: (layerId: string) => void;
  getLayerId?: () => string | null | undefined;
  setActiveLayer?: (layerId: string) => void;
  setIsolated?: (isolated: boolean) => void;
};

export type ColorCycleBrushSettingsControls = {
  applySettings?: (settings: CCBrushSettingsPatch) => void;
  getSettings?: () => CCBrushSettings;
  setBrushSize(size: number): void;
  setFPS(fps: number): void;
  setSpeed(speed: number): void;
  setLayerBaseSpeed?: (speed: number) => void;
  setPlaybackSpeedScale?: (scale: number) => void;
  setGradientBands(bands: number): void;
  setBandSpacing(spacing: number): void;
  setDitherEnabled(enabled: boolean): void;
  setDitherStrength?: (value: number) => void;
  setDitherPixelSize(value: number): void;
  setPxlEdgeEnabled?: (enabled: boolean) => void;
  setStampDitherEnabled(enabled: boolean): void;
  setPressureEnabled(enabled: boolean): void;
  setMinPressure(value: number): void;
  setMaxPressure(value: number): void;
  setStampShape(shape: StampShape): void;
  setFlowMode?: (mode: FlowMode) => void;
  setFlowDirection(direction: 'forward' | 'backward'): void;
  setLegacyFlowMode?: (mode: FlowMode) => void;
  setStampDitherAlgorithm?: (algorithm?: StampDitherAlgorithm) => void;
  setStampDitherPatternStyle?: (style?: PatternStyle) => void;
  setStampDitherPatternTileSettings?: (settings: Pick<
    BrushSettings,
    | 'patternTileId'
    | 'patternTileScale'
    | 'patternTileInvert'
    | 'patternTileThreshold'
    | 'patternTileOffsetX'
    | 'patternTileOffsetY'
  >) => void;
  setStampDitherPressureLinked?: (enabled: boolean) => void;
  setStampDitherBgFill?: (enabled: boolean) => void;
  setStampDitherClears?: (enabled: boolean) => void;
  setStampDitherPixelSize?: (size: number) => void;
};

export type ColorCycleBrushLifecycleControls = {
  startStroke?(layerId?: string, clearBuffer?: boolean): void;
  endStroke(layerId?: string): void;
  cleanup?: () => void;
  destroy?: () => void;
  clear(): void;
  reset?: () => void;
};

export type ColorCycleBrushPlaybackControls = {
  isPlaying(): boolean;
  setPlaying(playing: boolean): void;
  startAnimation(): void;
  stopAnimation(): void;
  updateAnimation(): void;
  pause?: () => void;
  setPhase(phase: number): void;
};

export type ColorCyclePlaybackBrushContext = {
  isPlaying?: () => boolean;
  setPlaying?: (playing: boolean) => void;
  startAnimation?: () => void;
  stopAnimation?: () => void;
  updateAnimation?: () => void;
  pause?: () => void;
  setLegacyFlowMode?: (mode: FlowMode) => void;
  setFlowMode?: (mode: FlowMode) => void;
  setFlowDirection?: (direction: 'forward' | 'backward') => void;
};

export type ColorCycleExportPlaybackBrushContext =
  & ColorCyclePlaybackBrushContext
  & {
    setPhase?: (phase: number) => void;
    applySettings?: (settings: Pick<CCBrushSettingsPatch, 'fps'>) => void;
  };

export type ColorCycleSurfaceBrushContext =
  & ColorCyclePlaybackBrushContext
  & {
    getCanvas?: () => HTMLCanvasElement | OffscreenCanvas | null;
    setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
    renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
  };

export type ColorCycleGradientApplyBrushContext = {
  commitCurrentStroke?: (layerId?: string) => void;
  flush?: (layerId?: string) => void;
  setGradientSlotStops?: (
    layerId: string,
    slot: number,
    stops: GradientStop[],
    seamProfile?: GradientSeamProfile,
  ) => void;
  setGradientSlot?: (
    layerId: string,
    slot: number,
    stops: GradientStop[],
    seamProfile?: GradientSeamProfile,
  ) => void;
  setActiveGradientSlot?: (layerId: string, slot: number) => void;
  syncGradientDefRuntime?: (layerId: string) => void;
};

export type ColorCycleShapeFillBrushContext =
  & ColorCycleSurfaceBrushContext
  & {
    applySettings?: (settings: CCBrushSettingsPatch) => void;
    setDitherPixelSize?: (value: number) => void;
    commitCurrentStroke?: ColorCycleGradientApplyBrushContext['commitCurrentStroke'];
    flush?: ColorCycleGradientApplyBrushContext['flush'];
    setGradient?: (stops: GradientStop[], layerId?: string) => void;
    setGradientSlotStops?: ColorCycleGradientApplyBrushContext['setGradientSlotStops'];
    setGradientSlot?: ColorCycleGradientApplyBrushContext['setGradientSlot'];
    setActiveGradientSlot?: ColorCycleGradientApplyBrushContext['setActiveGradientSlot'];
    bindGradientDefIdToSlot?: (
      layerId: string,
      defId: number,
      slot: number,
      bbox?: { minX: number; minY: number; width: number; height: number },
      previewSlot?: number | null,
    ) => void;
    commitToLayer?: (targetCanvas: HTMLCanvasElement, layerId: string, opacity?: number) => void;
    getColorCycleLayerDocument?: (layerId: string) => { read(): ColorCycleLayerDocumentRead } | undefined;
  };

export type ColorCycleHistoryBrushContext = {
  getCanvas?: () => HTMLCanvasElement | OffscreenCanvas | null;
  setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
  renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
  getColorCycleLayerDocument?: (layerId: string) => { read(): ColorCycleLayerDocumentRead } | undefined;
  commitToLayer?: (targetCanvas: HTMLCanvasElement, layerId: string) => void;
  updateColorCycleTexture?: () => void;
  render?: (forceFullOpacity?: boolean) => void;
  flush?: (layerId: string) => void;
};

export type ColorCycleSerializedStateBrushContext = {
  getColorCycleLayerDocument?: (layerId: string) => { read(): ColorCycleLayerDocumentRead } | undefined;
};

export type ColorCycleSelectionMutationBrushContext =
  & ColorCycleSerializedStateBrushContext
  & {
    getCanvas?: () => HTMLCanvasElement | null;
    renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
  };

export type ColorCycleLayerActivationBrushContext = {
  endStroke?: (layerId?: string) => void;
  setActiveLayer?: (layerId: string) => void;
};

export type ColorCycleClearBrushContext = {
  clear?: () => void;
};

export type ColorCycleInitBrushContext = {
  applySettings?: (settings: CCBrushSettingsPatch) => void;
  setOnFrameRendered: (callback: (dirtyBatches: ColorCycleLayerDirtyBatch[]) => void) => void;
  endStroke: (layerId: string) => void;
};

export type ColorCycleCropBrushContext =
  & ColorCycleSerializedStateBrushContext
  & {
    isPlaying?: () => boolean;
  };

export type ColorCycleCommitBrushContext =
  & ColorCycleSurfaceBrushContext
  & {
    getColorCycleLayerDocument?: (layerId: string) => { read(): ColorCycleLayerDocumentRead } | undefined;
    commitCurrentStroke?: (layerId?: string) => void;
    finalizeCurrentStroke?: (layerId?: string) => void;
    commitToLayer?: (canvas: HTMLCanvasElement, layerId: string, opacity?: number) => void;
    clearPaintBuffer?: (layerId?: string) => void;
    flush?: (layerId?: string) => void;
    updateColorCycleTexture?: () => void;
    setGradientSlotStops?: (
      layerId: string,
      slot: number,
      stops: GradientStop[],
      seamProfile?: GradientSeamProfile,
    ) => void;
    bindGradientDefIdToSlot?: (
      layerId: string,
      defId: number,
      slot: number,
      bbox?: { minX: number; minY: number; width: number; height: number },
      previewSlot?: number | null,
    ) => void;
  };

export type ColorCycleSpeedSettingsBrushContext = {
  applySettings?: (settings: Pick<CCBrushSettingsPatch, 'cycleSpeed'>) => void;
  setSpeed?: (speed: number) => void;
};

export type ColorCycleBrushGradientControls = {
  commitCurrentStroke(layerId?: string): void;
  flush(layerId?: string): void;
  setGradient?(stops: GradientStop[], layerId?: string): void;
  setGradientSlotStops?(layerId: string, slot: number, stops: GradientStop[], seamProfile?: GradientSeamProfile): void;
  setGradientSlot?(layerId: string, slot: number, stops: GradientStop[], seamProfile?: GradientSeamProfile): void;
  setActiveGradientSlot(layerId: string, slot: number): void;
  getActiveGradientSlot?(layerId?: string): number;
  syncGradientDefRuntime?(layerId: string): void;
  setPreserveGradientPhase?(enabled: boolean): void;
};

export type ColorCycleBrushPaintControls = {
  paint(...args: unknown[]): unknown;
  paintCustomStamp?(...args: unknown[]): unknown;
  fillShapeDispatch?(...args: unknown[]): unknown;
  markLayerHasExternalBase?(layerId: string, hasExternalBase?: boolean): void;
};

export type ColorCycleBrushImplementation =
  & ColorCycleBrushDocumentControls
  & ColorCycleBrushSurfaceControls
  & ColorCycleBrushLayerControls
  & ColorCycleBrushSettingsControls
  & ColorCycleBrushLifecycleControls
  & ColorCycleBrushPlaybackControls
  & ColorCycleBrushGradientControls
  & ColorCycleBrushPaintControls
  & {
    usesWebGL?: boolean;
    setUseCanvas2D?: (useCanvas2D: boolean) => void;
    isUsingWebGL?: () => boolean;
  };

/**
 * Composition-root runtime host only.
 *
 * Registry/manager code may keep this object for lifecycle and facade
 * construction, but controller/service callers should consume the narrow
 * ColorCycle*BrushContext facades above instead of this full surface.
 */
export type ColorCycleBrushRuntimeHost = ColorCycleBrushImplementation;

export type ColorCycleBrushConstructor = new (
  canvas: HTMLCanvasElement,
  options?: ColorCycleBrushCanvas2DOptions,
) => ColorCycleBrushRuntimeHost;
