/**
 * ColorCycleBrushCanvas2D - Canvas 2D implementation of color cycling
 * Replaces WebGL with efficient indexed color system using Canvas 2D
 * Maintains API compatibility with original ColorCycleBrush
 */

import { ColorCycleAnimator } from '../../lib/ColorCycleAnimator';
// Debug logs suppressed for color cycle brush
import { GradientStop } from '../../lib/GradientPalette';
import { applyPressureCurve } from '../../utils/pressureCurve';
import { fillConcentric, fillLinear } from './ccGradientFillDither';
import {
  applyStampDitherStamp,
  clearStampDitherRuntime,
  createStampDitherRuntime,
  ensureStampDitherBaseBuffers,
  ensureStampDitherBuffers,
  ensureStampDitherTag,
  finalizeStampDither,
  recomposeStampDitherOverlay,
  resolveStampDitherBucket,
  resolveStampDitherCoverage,
  scheduleStampDitherRecompose,
  STAMP_DITHER_BUCKETS,
  type StampDitherAlgorithm,
  type StampDitherConfig,
  type StampDitherState,
} from './strokeStampDither';
import { useAppStore } from '@/stores/useAppStore';
import { canvasPool } from '@/utils/canvasPool';
import { ccDebugOn, ccLog, ccWarn } from '@/utils/colorCycle/ccDebug';
import { fillCcGradientDither } from '@/utils/colorCycle/ccGradientDither';
import { computeConcentricMaxDistance, fillConcentricIndices } from '@/utils/colorCycle/concentricFillCore';
import { applyEdgePadding } from '@/utils/colorCycle/fillMath';
import { simplifyToVertexLimit } from '@/utils/polygonSimplify';
import { getMaskManager } from '@/layers/MaskManager';
import { CC_PERF, recordColorCycleFillPerf } from '@/utils/perf/ccPerfProbe';
import { debugLog, isDebugEnabled } from '@/utils/debug';
import { runConcentricFillJob, runPerceptualDitherJob } from '@/workers/colorCycleFillClient';
import type { PaletteMapEntry } from '@/workers/colorCycleFillTypes';
import type { PatternStyle } from '@/utils/ditherAlgorithms';
import { applySierraLiteLostEdgeMask } from '@/utils/ditherAlgorithms';
import type { CustomBrushColorCycleData, DerivedGradientSpec } from '@/types';
import { FLOW_SLOT_MASK, type FlowMode } from '@/lib/colorCycle/flowEncoding';
import {
  decodeColorCycleSpeedByte,
  encodeColorCycleSpeedByte,
  sanitizeBrushColorCycleSpeed,
} from '@/utils/colorCycleSpeed';
import { resolveCcFlowSpeedMultiplier } from '@/utils/colorCycleFlowVelocity';
import {
  appendGradientSeamProfileSignature,
  normalizeGradientSeamProfile,
  type GradientSeamProfile,
} from '@/lib/colorCycle/gradientSeamProfile';
import { ensurePalette } from '@/lib/colorCycle/paletteService';
import { resolveLayerColorCycleBaseSpeedFromLayer } from '@/utils/colorCycleLayerSpeed';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';
import { hashNumbers } from '@/utils/risographTexture';
import type { CommitCommittedLayerStateOptions } from '@/hooks/brushEngine/colorCycleCommittedState';
import { getActiveMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';

type CcCustomStampPerfStats = {
  sourceHit: number;
  sourceMiss: number;
  scaledHit: number;
  scaledMiss: number;
  maskHit: number;
  maskMiss: number;
  paintCalls: number;
  paintTotalMs: number;
  writePixels: number;
};

type BrushPerfWindow = Window & {
  __vesselBrushProfileEnabled?: boolean;
  __vesselBrushProfile?: {
    ccCustomStamp?: CcCustomStampPerfStats;
  };
};

const getBrushProfileNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const summarizeCcDebugStops = (
  stops: Array<{ position: number; color: string; opacity?: number }> | null | undefined
) => (stops ?? []).slice(0, 8).map((stop) => ({
  p: Number(stop.position.toFixed(3)),
  c: stop.color,
}));

const getCcCustomStampProfile = (): CcCustomStampPerfStats | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const win = window as BrushPerfWindow;
  if (!win.__vesselBrushProfileEnabled) {
    return null;
  }
  if (!win.__vesselBrushProfile) {
    win.__vesselBrushProfile = {};
  }
  if (!win.__vesselBrushProfile.ccCustomStamp) {
    win.__vesselBrushProfile.ccCustomStamp = {
      sourceHit: 0,
      sourceMiss: 0,
      scaledHit: 0,
      scaledMiss: 0,
      maskHit: 0,
      maskMiss: 0,
      paintCalls: 0,
      paintTotalMs: 0,
      writePixels: 0,
    };
  }
  return win.__vesselBrushProfile.ccCustomStamp;
};

// Stamp dithering has two concepts:
// 1) Live stamp coverage mask / tiling (what users see during drawing)
// 2) Optional finalize-only error diffusion pass (expensive / different look)

type ColorCycleBrushCanvas2DOptions = {
  brushSize?: number;
  fps?: number;
  forceCanvas2D?: boolean;
  useOffscreenCanvas?: boolean;
  useWebWorkers?: boolean;
  useWASM?: boolean;
  useImageBitmap?: boolean;
  usePerceptualDitherWorker?: boolean;
};

interface CustomStampInput {
  imageData: ImageData;
  width: number;
  height: number;
  cacheKey?: string;
  isResampler?: boolean;
  colorCycle?: CustomBrushColorCycleData;
}

type RgbColor = { r: number; g: number; b: number };
type Vec2 = { x: number; y: number };
type FillMode = 'linear' | 'concentric';

type FillOptions = {
  continuous?: boolean;
  ditherLevels?: number;
  ccGradient?: boolean;
  ditherPixelSize?: number;
  ditherPairBandCount?: number;
  ditherPaletteSpread?: number;
  ditherBackgroundFill?: boolean;
  ditherSampledStops?: StoredStop[];
  ditherBaseOffsetOverride?: number;
  paintSlotOverride?: number;
  roi?: { x: number; y: number; width: number; height: number };
  spacing?: number;
  lostEdge?: number;
};

const summarizeStoredStopsForDebug = (stops: StoredStop[] | null | undefined) =>
  (stops ?? []).slice(0, 8).map((stop) => ({
    p: Number(stop.position.toFixed(3)),
    c: stop.color,
  }));

type LayerStrokeState = {
  hasContent: boolean;
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
  snapshot?: StrokeDataSnapshot;
};
    
type AnimatorSerializedState = ReturnType<ColorCycleAnimator['serialize']>;

interface AnimatorIndexSnapshot {
  width: number;
  height: number;
  data: ArrayBuffer;
  gradientIdData?: ArrayBuffer;
  speedData?: ArrayBuffer;
  flowData?: ArrayBuffer;
  gradientStops?: GradientStop[];
  gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
  slotPalettes?: Array<{ slot: number; stops: GradientStop[] }>;
  activeGradientId?: string;
  paintSlot?: number;
  legacyRemap?: { from: number; to: number };
}

interface StrokeDataSnapshot {
  paintBuffer: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  flowBuffer?: ArrayBuffer;
  hasContent: boolean;
  strokeCounter: number;
}

interface SerializedLayerState {
  layerId: string;
  data: AnimatorSerializedState;
  strokeData?: StrokeDataSnapshot;
  gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
  slotPalettes?: Array<{ slot: number; stops: GradientStop[] }>;
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

type LayerSnapshotEntry = {
  layerId: string;
  paintBuffer?: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  flowBuffer?: ArrayBuffer;
  hasContent?: boolean;
  strokeCounter?: number;
  animatorIndex?: AnimatorIndexSnapshot;
};

type LayerSnapshots = Map<string, ArrayBuffer> | LayerSnapshotEntry[];

interface ColorCycleBrushCanvasState {
  cycleSpeed?: number;
  layerBaseSpeed?: number;
  playbackSpeedScale?: number;
  fps?: number;
  brushSize?: number;
  layerSnapshots?: LayerSnapshots;
  stampShape?: StampShape;
  stampDitherEnabled?: boolean;
  stampDitherPixelSize?: number;
  stampDitherAlgorithm?: StampDitherAlgorithm;
  stampDitherPatternStyle?: PatternStyle;
  stampDitherBgFill?: boolean;
  stampDitherClears?: boolean;
  stampDitherPressureLinked?: boolean;
  pxlEdgeEnabled?: boolean;
  [key: string]: unknown;
}

type StampShape = 'square' | 'round' | 'triangle' | 'diamond' | 'diamond5' | 'diamond7' | 'diamond9';

type DefPaletteCache = {
  signature: string;
  palettesById: Map<number, Uint32Array>;
  rgbaById: Map<number, Uint8ClampedArray | Uint8Array>;
  signaturesById: Map<number, string>;
};

interface ColorCycleBrushCanvasSerialized {
  layers: SerializedLayerState[];
  cycleSpeed: number;
  layerBaseSpeed?: number;
  playbackSpeedScale?: number;
  fps: number;
  brushSize: number;
  stampShape?: StampShape;
  stampDitherEnabled?: boolean;
  stampDitherPixelSize?: number;
  stampDitherAlgorithm?: StampDitherAlgorithm;
  stampDitherPatternStyle?: PatternStyle;
  stampDitherBgFill?: boolean;
  stampDitherClears?: boolean;
  stampDitherPressureLinked?: boolean;
  pxlEdgeEnabled?: boolean;
}

interface StampMaskCacheEntry {
  alpha: Uint8Array;
  width: number;
  height: number;
  rotationBucket: number;
}

const STAMP_MASK_ROTATION_TOLERANCE = Math.PI / 180; // ~1°
const STAMP_MASK_CACHE_LIMIT = 80;
const COLOR_CYCLE_FILL_WORKER_AREA = 240_000; // pixels
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const createYieldController = () => {
  let sliceStart = nowMs();
  return async (iteration: number) => {
    if ((iteration & 0x3f) !== 0) {
      return;
    }
    const now = nowMs();
    if (now - sliceStart > 8) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      sliceStart = nowMs();
    }
  };
};

const resolveBrushSizeBucket = (size: number): number => {
  if (!Number.isFinite(size) || size <= 0) return 0;
  return Math.max(1, 1 << Math.floor(Math.log2(size)));
};

type RestoreOpts = {
  mode?: 'normal' | 'history';
  preservePaintBuffer?: boolean;
};

const shouldUseFillWorker = (width: number, height: number) => {
  if (typeof window === 'undefined') {
    return false;
  }
  const area = width * height;
  if (area < COLOR_CYCLE_FILL_WORKER_AREA) {
    return false;
  }
  const cores = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? 4;
  // Favor worker on lower or moderate core counts, but still allow on large canvases
  return cores <= 12 || area >= COLOR_CYCLE_FILL_WORKER_AREA * 2;
};

const paletteEntriesFromMap = (map: Map<string, number>): PaletteMapEntry[] => {
  return Array.from(map.entries()).map(([key, index]) => {
    const parts = key.split(',').map((value) => Number(value));
    const [r, g, b] = parts as [number, number, number];
    return { rgb: [r, g, b], index };
  });
};

export class ColorCycleBrushCanvas2D {
  private static readonly REDUCED_INIT_SIZE = 256;
  private animators: Map<string, ColorCycleAnimator> = new Map();
  private activeLayerId: string | null = null;
  private defPaletteCacheByLayer: Map<string, DefPaletteCache> = new Map();
  
  // Canvas references
  private webglCanvas: HTMLCanvasElement; // Keep name for compatibility
  private compositeCanvas: HTMLCanvasElement;
  private compositeCtx: CanvasRenderingContext2D;
  private forceCanvas2D: boolean = false;
  private concentricWorkerJobId: number = 0;
  
  // Core settings (match original API)
  private brushSize: number;
  private cycleSpeed: number;
  private layerBaseSpeed: number;
  private playbackSpeedScale: number;
  private fps: number;
  private gradientBands: number = 12; // Number of color bands in gradients
  private bandSpacing: number = 5; // Pixel spacing between bands
  private pressureEnabled: boolean = false; // Track if pressure is enabled
  private minPressure: number = 1; // Min size as percentage of base size (1-1000)
  private maxPressure: number = 200; // Max size as percentage of base size (1-1000) - 200 = 2x size at max pressure
  private ditherEnabled: boolean = false; // Sierra Lite dithering for shape fills
  private ditherStrength: number = 1.0; // 0..1 scaling for error diffusion
  private ditherPixelSize: number = 1; // coarse cell size for dithering (>=1)
  private pxlEdgeEnabled: boolean = false;
  private perceptualDither: boolean = false; // Use color-space dithering then map to indices
  private currentGradientStops: GradientStop[] = [
    { position: 0, color: '#000000' },
    { position: 1, color: '#ffffff' }
  ];
  
  // Canvas dimensions
  private width: number;
  private height: number;
  
  // Animation state
  private isAnimating: boolean = false;
  private isPaused: boolean = false;

  // Single playback driver (one RAF + accumulator)
  private animationFrameId: number | null = null;
  private lastAnimationTimestamp: number = 0;
  private playbackAccumulatorMs: number = 0;
  
  // Stroke tracking
  private strokeCounter: number = 0;
  private lastPoint: { x: number; y: number } | null = null;
  private isDrawing: boolean = false;
  
  // Stamp tracking for gradient progression
  private stampCounter: number = 0;
  private totalGradientSteps: number = 256; // Total colors in gradient
  private flowMode: 'forward' | 'reverse' | 'pingpong' = 'forward';
  private legacyFlowMode: FlowMode = 'forward';
  
  // Batched rendering
  private renderScheduled: boolean = false;
  private dirtyLayers: Set<string> = new Set();

  // Stamp geometry
  private stampShape: StampShape = 'square';
  
  // Frame callback
  private onFrameRendered?: () => void;

  private _isHistoryRestore = false;
  
  // Layer tracking for API compatibility
  private layerStrokes: Map<string, LayerStrokeState> = new Map();

  private customStampSourceCache: WeakMap<ImageData, HTMLCanvasElement> = new WeakMap();
  private customStampCanvasCache: Map<string, HTMLCanvasElement> = new Map();
  private customStampMaskCache: Map<string, StampMaskCacheEntry> = new Map();

  private resolvePressureBrushSize(pressure: number): number {
    if (!this.pressureEnabled) {
      return Math.max(1, this.brushSize);
    }

    const safePressure = Number.isFinite(pressure) ? Math.max(0, Math.min(1, pressure)) : 1;
    const multiplier = applyPressureCurve(
      safePressure,
      this.minPressure,
      this.maxPressure,
      'linear'
    );
    return Math.max(1, this.brushSize * multiplier);
  }
  private gradientSignatures: Map<string, string> = new Map();
  private gradientSlotsByLayer: Map<string, Map<number, GradientStop[]>> = new Map();
  private gradientSlotSignaturesByLayer: Map<string, Map<number, string>> = new Map();
  private activeGradientSlots: Map<string, number> = new Map();
  private stampDitherEnabled: boolean = false;
  private stampDitherPixelSize: number = 1;
  private stampDitherAlgorithm: StampDitherAlgorithm = 'sierra-lite';
  private stampDitherPatternStyle: PatternStyle = 'dots';
  private stampDitherRuntime: ReturnType<typeof createStampDitherRuntime> = createStampDitherRuntime();
  private stampDitherBgFill: boolean = true;
  private stampDitherPressureLinked: boolean = false;
  private preserveGradientPhaseOnChange: boolean = false;
  private perfStroke?: {
    startMs: number;
    sampleEvery: number;
    stampCounter: number;
    stampSampleCounter: number;
    durations: {
      beginStrokeTotalMs: number;
      clearPrimaryMs: number;
      clearMaskMs: number;
      clearBaseMaskMs: number;
      allocOrResizeMs: number;
      stampTotalMs: number;
      stampMaskPassMs: number;
      stampApplyPassMs: number;
      midstrokeRecomposeMs: number;
      endStrokeFinalizeMs: number;
      endStrokeRecomposeOverlayMs: number;
      serializeMs: number;
    };
    stats: {
      canvasW: number;
      canvasH: number;
      brushBucket: number;
      stampBoundsArea: number;
      dirtyRectArea: number;
      stampBoundsMinX: number;
      stampBoundsMinY: number;
      stampBoundsMaxX: number;
      stampBoundsMaxY: number;
      dirtyMinX: number;
      dirtyMinY: number;
      dirtyMaxX: number;
      dirtyMaxY: number;
    };
  };
  private performanceOptions: Required<
    Pick<
      ColorCycleBrushCanvas2DOptions,
      'useOffscreenCanvas' | 'useWebWorkers' | 'useWASM' | 'useImageBitmap' | 'usePerceptualDitherWorker'
    >
  >;
  
  constructor(canvas: HTMLCanvasElement, options: ColorCycleBrushCanvas2DOptions = {}) {
    
    // Validate canvas
    if (!canvas) {
      throw new Error('Canvas element is required');
    }
    
    if (!canvas.width || !canvas.height) {
      throw new Error('Canvas must have valid dimensions');
    }
    
    // Use provided canvas as the "WebGL" canvas for compatibility
    this.webglCanvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
    
    // Create composite canvas for final rendering
    this.compositeCanvas = document.createElement('canvas');
    this.compositeCanvas.width = this.width;
    this.compositeCanvas.height = this.height;
    
    const ctx = this.compositeCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true
    });
    
    if (!ctx) {
      throw new Error('Failed to create 2D context');
    }
    
    this.compositeCtx = ctx;
    this.compositeCtx.imageSmoothingEnabled = false;
    
    this.forceCanvas2D = options.forceCanvas2D ?? false;
    this.performanceOptions = {
      useOffscreenCanvas: options.useOffscreenCanvas ?? true,
      useWebWorkers: options.useWebWorkers ?? true,
      useWASM: options.useWASM ?? true,
      useImageBitmap: options.useImageBitmap ?? true,
      usePerceptualDitherWorker: options.usePerceptualDitherWorker ?? false,
    };

    // Core settings
    this.brushSize = options.brushSize || 20;
    this.cycleSpeed = 0.1;
    this.layerBaseSpeed = 1;
    this.playbackSpeedScale = 1;
    this.fps = options.fps || 60;
    this.pressureEnabled = false;
    this.minPressure = 1;
    this.maxPressure = 200; // Default to 2x size at max pressure
    this.clearStampDitherCache();
  }

  private resetPerfStroke() {
    if (!CC_PERF.on) {
      this.perfStroke = undefined;
      return;
    }
    this.perfStroke = {
      startMs: nowMs(),
      sampleEvery: 20,
      stampCounter: 0,
      stampSampleCounter: 0,
      durations: {
        beginStrokeTotalMs: 0,
        clearPrimaryMs: 0,
        clearMaskMs: 0,
        clearBaseMaskMs: 0,
        allocOrResizeMs: 0,
        stampTotalMs: 0,
        stampMaskPassMs: 0,
        stampApplyPassMs: 0,
        midstrokeRecomposeMs: 0,
        endStrokeFinalizeMs: 0,
        endStrokeRecomposeOverlayMs: 0,
        serializeMs: 0,
      },
      stats: {
        canvasW: this.width,
        canvasH: this.height,
        brushBucket: resolveBrushSizeBucket(this.brushSize),
        stampBoundsArea: 0,
        dirtyRectArea: 0,
        stampBoundsMinX: this.width,
        stampBoundsMinY: this.height,
        stampBoundsMaxX: -1,
        stampBoundsMaxY: -1,
        dirtyMinX: this.width,
        dirtyMinY: this.height,
        dirtyMaxX: -1,
        dirtyMaxY: -1,
      },
    };
  }

  private updatePerfStampBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
    const perf = this.perfStroke;
    if (!perf) return;
    perf.stats.stampBoundsMinX = Math.min(perf.stats.stampBoundsMinX, bounds.minX);
    perf.stats.stampBoundsMinY = Math.min(perf.stats.stampBoundsMinY, bounds.minY);
    perf.stats.stampBoundsMaxX = Math.max(perf.stats.stampBoundsMaxX, bounds.maxX);
    perf.stats.stampBoundsMaxY = Math.max(perf.stats.stampBoundsMaxY, bounds.maxY);
  }

  private finalizePerfBounds() {
    const perf = this.perfStroke;
    if (!perf) return;
    const { stampBoundsMinX, stampBoundsMinY, stampBoundsMaxX, stampBoundsMaxY } = perf.stats;
    if (stampBoundsMaxX >= stampBoundsMinX && stampBoundsMaxY >= stampBoundsMinY) {
      perf.stats.stampBoundsArea = (stampBoundsMaxX - stampBoundsMinX + 1) * (stampBoundsMaxY - stampBoundsMinY + 1);
    } else {
      perf.stats.stampBoundsArea = 0;
    }
  }

  private logPerfStroke(layerId: string) {
    const perf = this.perfStroke;
    if (!perf || !CC_PERF.on || !isDebugEnabled('cc-perf')) return;
    this.finalizePerfBounds();
    const stats = perf.stats;
    const durations = perf.durations;
    debugLog('cc-perf', '[perf] cc-stroke', {
      layerId,
      canvas: `${stats.canvasW}x${stats.canvasH}`,
      brushBucket: stats.brushBucket,
      stamps: perf.stampCounter,
      stampBoundsArea: stats.stampBoundsArea,
      dirtyRectArea: stats.dirtyRectArea,
      beginStroke_total: durations.beginStrokeTotalMs.toFixed(2),
      clear_primary: durations.clearPrimaryMs.toFixed(2),
      clear_mask: durations.clearMaskMs.toFixed(2),
      clear_baseMask: durations.clearBaseMaskMs.toFixed(2),
      alloc_or_resize_buffers: durations.allocOrResizeMs.toFixed(2),
      stamp_total: durations.stampTotalMs.toFixed(2),
      stamp_mask_pass: durations.stampMaskPassMs.toFixed(2),
      stamp_apply_pass: durations.stampApplyPassMs.toFixed(2),
      midstroke_recompose: durations.midstrokeRecomposeMs.toFixed(2),
      endStroke_finalize: durations.endStrokeFinalizeMs.toFixed(2),
      endStroke_recompose_overlay: durations.endStrokeRecomposeOverlayMs.toFixed(2),
      serialize: durations.serializeMs.toFixed(2),
    });
  }

  private createLayerStrokeState(options?: { hasContent?: boolean; bufferSize?: number }): LayerStrokeState {
    const size = Math.max(0, Math.floor(options?.bufferSize ?? this.width * this.height));
    const initialStrokeCycleSpeed = this.getResolvedWriteCycleSpeed();
    const initialStrokeSpeedByte = encodeColorCycleSpeedByte(initialStrokeCycleSpeed);
    return {
      hasContent: Boolean(options?.hasContent),
      strokeCounter: 0,
      stampCounter: 0,
      strokePhaseUnits: 0,
      strokeCycleSpeed: initialStrokeCycleSpeed,
      strokeSpeedByte: initialStrokeSpeedByte,
      lastPoint: null,
      buffers: {
        paint: new Uint8Array(size),
        gid: new Uint8Array(size),
        spd: new Uint8Array(size),
        flow: new Uint8Array(size),
        def: new Uint16Array(size),
      },
      flow: {
        activeSlot: 0,
        encoded: false,
        mode: undefined,
      },
      externalBase: {
        hasExternalBase: false,
      },
      stampDither: undefined,
      snapshot: undefined,
    };
  }

  private ensureStrokeState(layerId: string): LayerStrokeState {
    let strokeData = this.layerStrokes.get(layerId);
    if (!strokeData) {
      strokeData = this.createLayerStrokeState({ hasContent: false });
      this.layerStrokes.set(layerId, strokeData);
    }
    return strokeData;
  }

  markLayerHasExternalBase(layerId: string) {
    if (!layerId) {
      return;
    }
    const strokeData = this.ensureStrokeState(layerId);
    strokeData.externalBase.hasExternalBase = true;
    this.layerStrokes.set(layerId, strokeData);
  }

  private createAnimator(layerId: string, options: { initial: 'reduced' | 'full' }): ColorCycleAnimator {
    const useReduced = options.initial === 'reduced';
    const initSize = ColorCycleBrushCanvas2D.REDUCED_INIT_SIZE;
    const initWidth = useReduced ? initSize : this.width;
    const initHeight = useReduced ? initSize : this.height;

    const animator = new ColorCycleAnimator({
      width: initWidth,
      height: initHeight,
      fps: this.fps,
      // Keep playback neutral so per-pixel speed bytes are absolute and
      // unaffected by later write-speed slider changes.
      speed: 1,
      autoStart: false,
      lazyInit: true,
      forceCanvas2D: this.forceCanvas2D
    });
    animator.setSpeed(this.playbackSpeedScale);
    animator.setFlowMode(this.legacyFlowMode);
    this.animators.set(layerId, animator);

    if (!this.layerStrokes.has(layerId)) {
      this.layerStrokes.set(layerId, this.createLayerStrokeState({ hasContent: false, bufferSize: 0 }));
    }

    return animator;
  }

  private ensureFullResolution(layerId: string, reason: 'stroke' | 'fill' | 'restore'): ColorCycleAnimator {
    const animator = this.animators.get(layerId) ?? this.createAnimator(layerId, { initial: 'full' });
    const { width, height } = animator.getDimensions();
    if (width !== this.width || height !== this.height) {
      animator.resize(this.width, this.height);
    }

    const strokeData = this.layerStrokes.get(layerId);
    if (strokeData) {
      const expected = this.width * this.height;
      if (strokeData.buffers.paint.length !== expected) {
        strokeData.buffers.paint = new Uint8Array(expected);
      }
      if (strokeData.buffers.gid.length !== expected) {
        strokeData.buffers.gid = new Uint8Array(expected);
      }
      if (strokeData.buffers.spd.length !== expected) {
        strokeData.buffers.spd = new Uint8Array(expected);
      }
      if (strokeData.buffers.flow.length !== expected) {
        strokeData.buffers.flow = new Uint8Array(expected);
      }
      if (strokeData.buffers.def.length !== expected) {
        strokeData.buffers.def = new Uint16Array(expected);
      }
    }

    if (process.env.NODE_ENV !== 'production' && reason === 'stroke') {
      const dims = animator.getDimensions();
      console.assert(
        dims.width === this.width && dims.height === this.height,
        '[CC] Animator size mismatch during stroke',
        { layerId, reason, animator: dims, brush: { width: this.width, height: this.height } }
      );
    }

    return animator;
  }

  private bindStrokeBuffersToAnimator(strokeData: LayerStrokeState, animator: ColorCycleAnimator): void {
    const expected = this.width * this.height;
    const handle = animator.beginDirectFill();
    if (handle.data && handle.data.length === expected) {
      strokeData.buffers.paint = handle.data;
    }
    if (handle.gradientId && handle.gradientId.length === expected) {
      strokeData.buffers.gid = handle.gradientId;
    }
    if (handle.speedData && handle.speedData.length === expected) {
      strokeData.buffers.spd = handle.speedData;
    }
    if (handle.flowData && handle.flowData.length === expected) {
      strokeData.buffers.flow = handle.flowData;
    }
    animator.endDirectFill({ markDirty: false });
    animator.setDefIdData(strokeData.buffers.def);
  }

  private assertStrokeHandleSize(
    handle: { width: number; height: number } | null | undefined,
    context: string
  ): void {
    if (process.env.NODE_ENV === 'production' || !handle) {
      return;
    }
    console.assert(
      handle.width === this.width && handle.height === this.height,
      `[CC] ${context} handle size mismatch`,
      { handle: { width: handle.width, height: handle.height }, brush: { width: this.width, height: this.height } }
    );
  }

  private ensureStampDitherState(strokeData: LayerStrokeState): StampDitherState {
    if (!strokeData.stampDither) {
      strokeData.stampDither = {};
    }
    return strokeData.stampDither;
  }

  private getStampDitherStrokeData(
    strokeData: LayerStrokeState
  ): StampDitherState & {
    paintBuffer: Uint8Array;
    gradientIdBuffer?: Uint8Array;
    speedBuffer?: Uint8Array;
    flowBuffer?: Uint8Array;
  } {
    const stampDither = this.ensureStampDitherState(strokeData);
    const stampStroke = stampDither as StampDitherState & {
      paintBuffer: Uint8Array;
      gradientIdBuffer?: Uint8Array;
      speedBuffer?: Uint8Array;
      flowBuffer?: Uint8Array;
    };
    stampStroke.paintBuffer = strokeData.buffers.paint;
    stampStroke.gradientIdBuffer = strokeData.buffers.gid;
    stampStroke.speedBuffer = strokeData.buffers.spd;
    stampStroke.flowBuffer = strokeData.buffers.flow;
    return stampStroke;
  }

  /**
   * Get or create animator for a layer
   */
  private getAnimator(layerId: string): ColorCycleAnimator {
    ccLog('getAnimator()', { layerId, has: this.animators.has(layerId), size: this.animators.size });
    // Add validation
    if (!layerId) {
      throw new Error('Layer ID is required');
    }
    
    if (!this.animators.has(layerId)) {
      const strokeData = this.layerStrokes.get(layerId);
      const initial = strokeData?.hasContent ? 'full' : 'reduced';
      this.createAnimator(layerId, { initial });
    }
    
    const animator = this.animators.get(layerId);
    if (!animator) {
      throw new Error(`Failed to get or create animator for layer: ${layerId}`);
    }
    
    return animator;
  }

  private resolveFlowSlot(_strokeData: LayerStrokeState | null | undefined, activeSlot: number): number {
    if (!Number.isFinite(activeSlot)) {
      return 0;
    }
    return Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(activeSlot)));
  }

  private buildDefPaletteSignature(
    defs: Array<{ id: number; hash: string; seamProfile?: GradientSeamProfile }>
  ): string {
    return defs
      .map((entry) => `${entry.id}:${appendGradientSeamProfileSignature(entry.hash, entry.seamProfile)}`)
      .sort()
      .join('|');
  }

  private getDefPaletteCache(
    layerId: string,
    defs: Array<{
      id: number;
      hash: string;
      stops: GradientStop[];
      seamProfile?: GradientSeamProfile;
    }> | undefined
  ): DefPaletteCache | null {
    if (!defs || defs.length === 0) {
      this.defPaletteCacheByLayer.delete(layerId);
      return null;
    }

    const signature = this.buildDefPaletteSignature(defs);
    const existing = this.defPaletteCacheByLayer.get(layerId);
    if (existing && existing.signature === signature) {
      return existing;
    }

    const palettesById = new Map<number, Uint32Array>();
    const rgbaById = new Map<number, Uint8ClampedArray | Uint8Array>();
    const signaturesById = new Map<number, string>();

    for (const def of defs) {
      if (!def || !def.stops || def.stops.length === 0) {
        continue;
      }
      const handle = ensurePalette({
        stops: def.stops,
        seamProfile: normalizeGradientSeamProfile(def.seamProfile),
      });
      palettesById.set(def.id, handle.uint32);
      rgbaById.set(def.id, handle.rgba);
      signaturesById.set(def.id, appendGradientSeamProfileSignature(def.hash, def.seamProfile));
    }

    const nextCache: DefPaletteCache = {
      signature,
      palettesById,
      rgbaById,
      signaturesById,
    };
    this.defPaletteCacheByLayer.set(layerId, nextCache);
    return nextCache;
  }

  private applyDefBindingsForLayer(
    layerId: string,
    animator: ColorCycleAnimator,
    strokeData: LayerStrokeState | undefined,
    defs: Array<{ id: number; hash: string; stops: GradientStop[]; seamProfile?: GradientSeamProfile }> | undefined
  ): void {
    if (typeof (animator as { setDefIdData?: (data?: Uint16Array | null) => void }).setDefIdData === 'function') {
      (animator as { setDefIdData: (data?: Uint16Array | null) => void }).setDefIdData(strokeData?.buffers.def);
    }
    const cache = this.getDefPaletteCache(layerId, defs);
    if (typeof (animator as {
      setDefPaletteCache?: (cache?: {
        palettesById: Map<number, Uint32Array>;
        rgbaById: Map<number, Uint8ClampedArray | Uint8Array>;
        signaturesById: Map<number, string>;
      } | null) => void;
    }).setDefPaletteCache === 'function') {
      if (cache) {
        (animator as {
          setDefPaletteCache: (cache: {
            palettesById: Map<number, Uint32Array>;
            rgbaById: Map<number, Uint8ClampedArray | Uint8Array>;
            signaturesById: Map<number, string>;
          }) => void;
        }).setDefPaletteCache(cache);
      } else {
        (animator as { setDefPaletteCache: (cache: null) => void }).setDefPaletteCache(null);
      }
    }
  }
  
  /**
   * Paint at position (API compatible)
   */
  private prepareStrokeContext(layerId: string) {
    const id = layerId;
    const animator = this.ensureFullResolution(id, 'stroke');
    let strokeData = this.layerStrokes.get(id);
    if (!strokeData) {
      strokeData = this.createLayerStrokeState({ hasContent: true });
      this.layerStrokes.set(id, strokeData);
    } else if (!strokeData.hasContent) {
      strokeData.hasContent = true;
      if (strokeData.buffers.paint.length !== this.width * this.height) {
        strokeData.buffers.paint = new Uint8Array(this.width * this.height);
      }
      if (strokeData.buffers.gid.length !== this.width * this.height) {
        strokeData.buffers.gid = new Uint8Array(this.width * this.height);
      }
      if (strokeData.buffers.spd.length !== this.width * this.height) {
        strokeData.buffers.spd = new Uint8Array(this.width * this.height);
      }
      if (strokeData.buffers.flow.length !== this.width * this.height) {
        strokeData.buffers.flow = new Uint8Array(this.width * this.height);
      }
      if (strokeData.buffers.def.length !== this.width * this.height) {
        strokeData.buffers.def = new Uint16Array(this.width * this.height);
      }
    }

    const activeSlot = strokeData.flow.activeSlot ?? this.activeGradientSlots.get(id) ?? 0;
    strokeData.flow.activeSlot = activeSlot;

    return { id, animator, strokeData };
  }

  private resolvePhaseAdvancePerStamp(): number {
    return 1;
  }

  private getWriteCycleSpeed(strokeData?: LayerStrokeState | null): number {
    const hasActiveStrokeSpeed =
      Boolean(strokeData) &&
      strokeData!.strokeCounter === this.strokeCounter &&
      Number.isFinite(strokeData!.strokeCycleSpeed);
    if (hasActiveStrokeSpeed) {
      return strokeData!.strokeCycleSpeed;
    }
    return this.getResolvedWriteCycleSpeed();
  }

  private getResolvedWriteCycleSpeed(rawSpeed?: number | null): number {
    const writeSpeed = sanitizeBrushColorCycleSpeed(
      rawSpeed,
      Number.isFinite(this.cycleSpeed) ? this.cycleSpeed : 0.1
    );
    const baseSpeed = sanitizeBrushColorCycleSpeed(
      this.layerBaseSpeed,
      1
    );
    return sanitizeBrushColorCycleSpeed(writeSpeed * baseSpeed, writeSpeed);
  }

  private getWriteSpeedByte(strokeData?: LayerStrokeState | null): number {
    const hasActiveStrokeSpeed =
      Boolean(strokeData) &&
      strokeData!.strokeCounter === this.strokeCounter &&
      Number.isFinite(strokeData!.strokeSpeedByte);
    if (hasActiveStrokeSpeed) {
      return strokeData!.strokeSpeedByte;
    }
    return encodeColorCycleSpeedByte(this.getWriteCycleSpeed(strokeData));
  }

  private getCcGradientFillSpeedByte(strokeData?: LayerStrokeState | null): number {
    const baseSpeed = this.getWriteCycleSpeed(strokeData);
    if (!Number.isFinite(baseSpeed) || baseSpeed <= 0) {
      return 0;
    }
    return encodeColorCycleSpeedByte(baseSpeed);
  }

  private getFlowByteForMode(flowMode: FlowMode = this.flowMode): number {
    if (flowMode === 'reverse') {
      return 2;
    }
    if (flowMode === 'pingpong') {
      return 3;
    }
    return 1;
  }

  private resolveShapeAnimationBytes(
    strokeData?: LayerStrokeState | null,
    options?: { ccGradient?: boolean }
  ): { speedByte: number; flowByte: number } {
    return {
      speedByte: options?.ccGradient
        ? this.getCcGradientFillSpeedByte(strokeData)
        : this.getWriteSpeedByte(strokeData),
      flowByte: this.getFlowByteForMode(),
    };
  }

  private logSetIndexSample(layerId: string, x: number, y: number) {
    if ((x & 31) === 0 && (y & 31) === 0) {
      ccLog('setIndex sample', { id: layerId, x, y });
    }
  }

  private mapBandIndexToPaletteIndex(bandIndex: number, bandsToUse: number): number {
    const clampedBands = Math.max(1, Math.min(255, Math.floor(bandsToUse)));
    if (clampedBands <= 1) {
      return 1;
    }
    const normalized = Math.max(0, Math.min(1, bandIndex / (clampedBands - 1)));
    const paletteIndex = 1 + Math.round(normalized * 254); // Offset keeps index 0 reserved for transparency
    return Math.max(1, Math.min(255, paletteIndex));
  }

  private computeColorBandIndex(strokeData: LayerStrokeState): number {
    const bands = Math.max(2, Math.min(254, Math.floor(this.gradientBands || 12)));
    const phaseIndex = ((strokeData.strokePhaseUnits % 255) + 255) % 255;
    const normalized = bands <= 1 ? 0 : phaseIndex / 254;
    const bandIndex = Math.max(0, Math.min(bands - 1, Math.round(normalized * (bands - 1))));
    return this.mapBandIndexToPaletteIndex(bandIndex, bands);
  }

  private computeColorBandIndexPerStamp(strokeData: LayerStrokeState): number {
    return this.computeColorBandIndex(strokeData);
  }

  private resolveStrokeFlowCycleSpeed(speedSamplePxPerMs?: number): number {
    const baseSpeed = this.getResolvedWriteCycleSpeed();
    const speedMultiplier = resolveCcFlowSpeedMultiplier(speedSamplePxPerMs);
    if (speedMultiplier <= 1) {
      return baseSpeed;
    }

    return sanitizeBrushColorCycleSpeed(
      baseSpeed * speedMultiplier,
      baseSpeed
    );
  }

  private applyStrokeFlowSpeed(strokeData: LayerStrokeState, speedSamplePxPerMs?: number): void {
    const resolvedSpeed = this.resolveStrokeFlowCycleSpeed(speedSamplePxPerMs);
    strokeData.strokeCycleSpeed = resolvedSpeed;
    strokeData.strokeSpeedByte = encodeColorCycleSpeedByte(resolvedSpeed);
  }

  private advanceStrokePhase(strokeData: LayerStrokeState): void {
    const advance = this.resolvePhaseAdvancePerStamp();
    strokeData.strokePhaseUnits = (strokeData.strokePhaseUnits + advance) % 255;
  }


  private getSourceCanvasForStamp(stamp: CustomStampInput): HTMLCanvasElement {
    const profile = getCcCustomStampProfile();
    let source = this.customStampSourceCache.get(stamp.imageData);
    if (!source) {
      if (profile) profile.sourceMiss += 1;
      source = document.createElement('canvas');
      source.width = stamp.width;
      source.height = stamp.height;
      const ctx = source.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
      if (ctx) {
        ctx.putImageData(stamp.imageData, 0, 0);
      }
      this.customStampSourceCache.set(stamp.imageData, source);
    } else if (profile) {
      profile.sourceHit += 1;
    }
    return source;
  }

  private getScaledStampCanvas(stamp: CustomStampInput, width: number, height: number): HTMLCanvasElement {
    const profile = getCcCustomStampProfile();
    const baseKey = stamp.cacheKey || `anon:${stamp.imageData.width}x${stamp.imageData.height}`;
    const key = `${baseKey}:${width}x${height}`;
    let cached = this.customStampCanvasCache.get(key);
    if (!cached) {
      if (profile) profile.scaledMiss += 1;
      const source = this.getSourceCanvasForStamp(stamp);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
      if (!ctx) {
        return source;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, width, height);
      cached = canvas;
      this.customStampCanvasCache.set(key, canvas);
      if (this.customStampCanvasCache.size > 40) {
        const firstKey = this.customStampCanvasCache.keys().next().value;
        if (firstKey) {
          this.customStampCanvasCache.delete(firstKey);
        }
      }
    } else if (profile) {
      profile.scaledHit += 1;
    }
    return cached;
  }

  private static quantizeRotation(rotation: number): number {
    if (!Number.isFinite(rotation) || Math.abs(rotation) < STAMP_MASK_ROTATION_TOLERANCE * 0.5) {
      return 0;
    }
    return Math.round(rotation / STAMP_MASK_ROTATION_TOLERANCE);
  }

  private getStampMaskCacheKey(
    stamp: CustomStampInput,
    width: number,
    height: number,
    rotation: number
  ): string {
    const baseKey = stamp.cacheKey || `anon:${stamp.imageData.width}x${stamp.imageData.height}`;
    const rotationBucket = ColorCycleBrushCanvas2D.quantizeRotation(rotation);
    return `${baseKey}:${width}x${height}:rot=${rotationBucket}`;
  }

  private getStampMask(
    stamp: CustomStampInput,
    scaledCanvas: HTMLCanvasElement,
    scaledWidth: number,
    scaledHeight: number,
    targetWidth: number,
    targetHeight: number,
    rotation: number
  ): StampMaskCacheEntry | null {
    const profile = getCcCustomStampProfile();
    const cacheKey = this.getStampMaskCacheKey(stamp, targetWidth, targetHeight, rotation);
    const cached = this.customStampMaskCache.get(cacheKey);
    if (cached) {
      if (profile) profile.maskHit += 1;
      return cached;
    }
    if (profile) profile.maskMiss += 1;

    const tempCanvas = canvasPool.acquire(targetWidth, targetHeight);
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
    if (!tempCtx) {
      canvasPool.release(tempCanvas);
      return null;
    }

    tempCtx.clearRect(0, 0, targetWidth, targetHeight);
    tempCtx.imageSmoothingEnabled = false;
    tempCtx.save();
    tempCtx.translate(targetWidth / 2, targetHeight / 2);
    if (rotation) {
      tempCtx.rotate(rotation);
    }
    tempCtx.drawImage(
      scaledCanvas,
      -scaledWidth / 2,
      -scaledHeight / 2,
      scaledWidth,
      scaledHeight
    );
    tempCtx.restore();

    const maskData = tempCtx.getImageData(0, 0, targetWidth, targetHeight).data;
    const alpha = new Uint8Array(targetWidth * targetHeight);
    if (maskData.length !== targetWidth * targetHeight * 4) {
      // In non-browser test environments mocked contexts may return placeholder
      // buffers; fall back to an opaque mask so stamping still exercises logic.
      alpha.fill(255);
    } else {
      for (let src = 3, dst = 0; dst < alpha.length; src += 4, dst++) {
        alpha[dst] = maskData[src];
      }
    }

    canvasPool.release(tempCanvas);

    const entry: StampMaskCacheEntry = {
      alpha,
      width: targetWidth,
      height: targetHeight,
      rotationBucket: ColorCycleBrushCanvas2D.quantizeRotation(rotation)
    };

    this.customStampMaskCache.set(cacheKey, entry);
    if (this.customStampMaskCache.size > STAMP_MASK_CACHE_LIMIT) {
      const firstKey = this.customStampMaskCache.keys().next().value;
      if (firstKey) {
        this.customStampMaskCache.delete(firstKey);
      }
    }

    return entry;
  }

  paint(
    x: number,
    y: number,
    layerId?: string,
    pressure: number = 1.0,
    _rotation: number = 0,
    speedSamplePxPerMs?: number
  ) {
    if (typeof window !== 'undefined') {
      const globalWindow = window as typeof window & {
        __CC_probe?: { start: number; paint: number; end: number; last: Record<string, unknown> };
      };
      globalWindow.__CC_probe ??= { start: 0, paint: 0, end: 0, last: {} };
      globalWindow.__CC_probe.paint += 1;
      globalWindow.__CC_probe.last = { ...globalWindow.__CC_probe.last, layerId };
      if (globalWindow.__CC_probe.paint % 20 === 1) {
      // removed debug log
      }
    }
    void _rotation;
    
    // Debug logging removed for paint hot path
    
    // Validate coordinates
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      console.warn(`Invalid paint coordinates: x=${x}, y=${y}`);
      return;
    }
    
    const targetLayerId = layerId || this.activeLayerId || 'default';
    const { id, animator, strokeData } = this.prepareStrokeContext(targetLayerId);

    if (strokeData) {
      this.applyStrokeFlowSpeed(strokeData, speedSamplePxPerMs);
      this.advanceStrokePhase(strokeData);
      const colorIndex = this.computeColorBandIndex(strokeData);
      const activeSlot = strokeData.flow.activeSlot ?? this.activeGradientSlots.get(id) ?? 0;
      const flowSlot = this.resolveFlowSlot(strokeData, activeSlot);
      const speedByte = this.getWriteSpeedByte(strokeData);
      if (typeof (animator as { setStrokeSpeedByte?: (value: number) => void }).setStrokeSpeedByte === 'function') {
        (animator as { setStrokeSpeedByte: (value: number) => void }).setStrokeSpeedByte(speedByte);
      }
      try {
        animator.setFlowMode(this.flowMode);
      } catch {}
      
      // Keep stroke pressure response continuous across all stamp shapes.
      const pressureSize = this.resolvePressureBrushSize(pressure);
      
      // Detailed paint debug removed
      
      const useStampDither = this.stampDitherEnabled;
      const primaryIndex = colorIndex;

      // Paint with specific color index and pressure-modulated size
      if (useStampDither) {
        const config: StampDitherConfig = {
          algorithm: this.stampDitherAlgorithm ?? 'sierra-lite',
          pixelSize: this.stampDitherPixelSize,
          patternStyle: this.stampDitherPatternStyle,
          bgFill: this.stampDitherBgFill,
          pressureLinked: this.stampDitherPressureLinked,
          seed: strokeData.stampDither?.stampDitherSeed ?? 0,
        };
        const perf = this.perfStroke;
        const stampStart = perf ? nowMs() : 0;
        let lastMaskMs = 0;
        let lastApplyMs = 0;
        let lastBounds: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
        applyStampDitherStamp({
          animator,
          state: this.getStampDitherStrokeData(strokeData),
          config,
          runtime: this.stampDitherRuntime,
          stampShape: this.stampShape,
          x,
          y,
          pressure,
          pressureSize,
          primaryIndex,
          flowSlot,
          cycleSpeed: this.getWriteCycleSpeed(strokeData),
          width: this.width,
          height: this.height,
          isAnimating: this.isAnimating,
          onScheduleRecompose: (tileScale) => {
            const stampState = this.ensureStampDitherState(strokeData);
            stampState.stampDitherRecomposeScale = tileScale;
            scheduleStampDitherRecompose({
              state: this.getStampDitherStrokeData(strokeData),
              onRecompose: (nextScale) => {
                const perfLocal = this.perfStroke;
                const recomposeStart = perfLocal ? nowMs() : 0;
                recomposeStampDitherOverlay({
                  state: this.getStampDitherStrokeData(strokeData),
                  config,
                  runtime: this.stampDitherRuntime,
                  animator,
                  flowSlot,
                  cycleSpeed: this.getWriteCycleSpeed(strokeData),
                  tileScale: nextScale,
                });
                if (perfLocal) {
                  perfLocal.durations.midstrokeRecomposeMs += Math.max(0, nowMs() - recomposeStart);
                }
              },
            });
          },
          perf: perf
            ? {
                onMask: (ms, bounds) => {
                  perf.durations.stampMaskPassMs += ms;
                  lastMaskMs = ms;
                  lastBounds = bounds;
                  this.updatePerfStampBounds(bounds);
                },
                onApply: (ms) => {
                  perf.durations.stampApplyPassMs += ms;
                  lastApplyMs = ms;
                },
              }
            : undefined,
        });
        if (perf) {
          const stampMs = Math.max(0, nowMs() - stampStart);
          perf.durations.stampTotalMs += stampMs;
          perf.stampCounter += 1;
          if (CC_PERF.verbose && perf.sampleEvery > 0 && perf.stampCounter % perf.sampleEvery === 0) {
            const boundsArea = lastBounds
              ? (lastBounds.maxX - lastBounds.minX + 1) * (lastBounds.maxY - lastBounds.minY + 1)
              : 0;
            console.log('[perf] cc-stamp', {
              stamp: perf.stampCounter,
              canvas: `${perf.stats.canvasW}x${perf.stats.canvasH}`,
              brushBucket: perf.stats.brushBucket,
              stampBoundsArea: boundsArea,
              stamp_total: stampMs.toFixed(2),
              stamp_mask_pass: lastMaskMs.toFixed(2),
              stamp_apply_pass: lastApplyMs.toFixed(2),
            });
          }
        }
      } else if (this.stampShape === 'triangle') {
        const perf = this.perfStroke;
        const stampStart = perf ? nowMs() : 0;
        animator.paintTriangle(x, y, pressureSize, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
        if (perf) {
          perf.durations.stampTotalMs += Math.max(0, nowMs() - stampStart);
          perf.stampCounter += 1;
        }
      } else if (this.stampShape === 'round') {
        const perf = this.perfStroke;
        const stampStart = perf ? nowMs() : 0;
        animator.paintCircle(x, y, pressureSize, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
        if (perf) {
          perf.durations.stampTotalMs += Math.max(0, nowMs() - stampStart);
          perf.stampCounter += 1;
        }
      } else if (this.stampShape === 'diamond') {
        const perf = this.perfStroke;
        const stampStart = perf ? nowMs() : 0;
        animator.paintDiamond(x, y, pressureSize, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
        if (perf) {
          perf.durations.stampTotalMs += Math.max(0, nowMs() - stampStart);
          perf.stampCounter += 1;
        }
      } else if (this.stampShape === 'diamond5') {
        const perf = this.perfStroke;
        const stampStart = perf ? nowMs() : 0;
        const diamond5Scale = Math.max(1, Math.round(pressureSize / 5));
        animator.paintDiamond5Pixelated(x, y, diamond5Scale, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
        if (perf) {
          perf.durations.stampTotalMs += Math.max(0, nowMs() - stampStart);
          perf.stampCounter += 1;
        }
      } else if (this.stampShape === 'diamond7') {
        const perf = this.perfStroke;
        const stampStart = perf ? nowMs() : 0;
        const diamond7Scale = Math.max(1, Math.round(pressureSize / 7));
        animator.paintDiamond7Pixelated(x, y, diamond7Scale, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
        if (perf) {
          perf.durations.stampTotalMs += Math.max(0, nowMs() - stampStart);
          perf.stampCounter += 1;
        }
      } else if (this.stampShape === 'diamond9') {
        const perf = this.perfStroke;
        const stampStart = perf ? nowMs() : 0;
        const diamond9Scale = Math.max(1, Math.round(pressureSize / 9));
        animator.paintDiamond9Pixelated(x, y, diamond9Scale, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
        if (perf) {
          perf.durations.stampTotalMs += Math.max(0, nowMs() - stampStart);
          perf.stampCounter += 1;
        }
      } else {
        const perf = this.perfStroke;
        const stampStart = perf ? nowMs() : 0;
        animator.paintSquare(x, y, pressureSize, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
        if (perf) {
          perf.durations.stampTotalMs += Math.max(0, nowMs() - stampStart);
          perf.stampCounter += 1;
        }
      }
      
      // Update tracking
      strokeData.lastPoint = { x, y };
      strokeData.stampCounter++;
    }

    // Mark layer as dirty for batched rendering
    this.dirtyLayers.add(id);
    
    // If animation just resumed but the global driver hasn't scheduled yet, flush immediately.
    const needsImmediateRender = this.isAnimating && this.animationFrameId === null;
    const hasPresentationSurface =
      !!this.webglCanvas && (!(this.webglCanvas instanceof HTMLCanvasElement) || this.webglCanvas.isConnected);
    if (needsImmediateRender && hasPresentationSurface) {
      try {
        animator.forceRender();
      } catch {}
      this.render(false);
    }

    // Schedule batched render if not animating
    if (!this.isAnimating && !this.renderScheduled && hasPresentationSurface) {
      this.renderScheduled = true;
      requestAnimationFrame(() => {
        this.renderScheduled = false;
        
        // Render all dirty layers
        if (this.dirtyLayers.size > 0) {
          // Force render on all dirty animators
          this.dirtyLayers.forEach(layerId => {
            const animator = this.animators.get(layerId);
            if (animator) {
              animator.forceRender();
            }
          });
          
          // Clear dirty set
          this.dirtyLayers.clear();
          
          // Composite all layers
          this.render(false);
        }
      });
    }
    
    // quiet
  }

  paintCustomStamp(
    stamp: CustomStampInput,
    x: number,
    y: number,
    layerId?: string,
    pressure: number = 1.0,
    rotation: number = 0,
    speedSamplePxPerMs?: number
  ) {
    if (!stamp?.imageData) {
      return;
    }
    const profile = getCcCustomStampProfile();
    const paintStart = profile ? getBrushProfileNow() : 0;
    let wrotePixels = 0;

    const targetLayerId = layerId || this.activeLayerId || 'default';
    const { id, animator, strokeData } = this.prepareStrokeContext(targetLayerId);
    this.applyStrokeFlowSpeed(strokeData, speedSamplePxPerMs);
    this.advanceStrokePhase(strokeData);
    const colorIndex = this.computeColorBandIndexPerStamp(strokeData);
    const speedByte = this.getWriteSpeedByte(strokeData);
    if (typeof (animator as { setStrokeSpeedByte?: (value: number) => void }).setStrokeSpeedByte === 'function') {
      (animator as { setStrokeSpeedByte: (value: number) => void }).setStrokeSpeedByte(speedByte);
    }
    try {
      animator.setFlowMode(this.flowMode);
    } catch {}

    const targetSize = this.resolvePressureBrushSize(pressure);

    const baseWidth = Math.max(1, stamp.width);
    const baseHeight = Math.max(1, stamp.height);
    const maxDimension = Math.max(baseWidth, baseHeight);
    const scale = maxDimension > 0 ? targetSize / maxDimension : 1;
    const scaledWidth = Math.max(1, Math.round(baseWidth * scale));
    const scaledHeight = Math.max(1, Math.round(baseHeight * scale));

    const scaledCanvas = this.getScaledStampCanvas(stamp, scaledWidth, scaledHeight);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const rotatedWidth = Math.abs(scaledWidth * cos) + Math.abs(scaledHeight * sin);
    const rotatedHeight = Math.abs(scaledWidth * sin) + Math.abs(scaledHeight * cos);
    const targetWidth = Math.max(1, Math.ceil(rotatedWidth));
    const targetHeight = Math.max(1, Math.ceil(rotatedHeight));

    const maskEntry = this.getStampMask(
      stamp,
      scaledCanvas,
      scaledWidth,
      scaledHeight,
      targetWidth,
      targetHeight,
      rotation
    );
    if (!maskEntry) {
      return;
    }

    const originX = Math.round(x - maskEntry.width / 2);
    const originY = Math.round(y - maskEntry.height / 2);
    const alpha = maskEntry.alpha;
    const colorCycle = stamp.colorCycle;
    const capturedPhaseMap =
      colorCycle?.schemaVersion === 2 && colorCycle.mode === 'captured-data'
        ? (
            colorCycle.phaseMap && colorCycle.phaseMap.length === colorCycle.mapWidth * colorCycle.mapHeight
              ? colorCycle.phaseMap
              : colorCycle.indexMap && colorCycle.indexMap.length === colorCycle.mapWidth * colorCycle.mapHeight
                ? colorCycle.indexMap
                : undefined
          )
        : undefined;
    const capturedMapWidth = colorCycle?.schemaVersion === 2 ? colorCycle.mapWidth : 0;
    const capturedMapHeight = colorCycle?.schemaVersion === 2 ? colorCycle.mapHeight : 0;
    const cycleSpan =
      colorCycle?.schemaVersion === 2
        ? Math.max(1, Math.min(255, Math.round(colorCycle.sourceCycleLength || 256) - 1))
        : 255;
    const phaseOffset = cycleSpan > 0
      ? Math.floor(((strokeData.strokePhaseUnits % cycleSpan) + cycleSpan) % cycleSpan)
      : 0;

    for (let py = 0; py < maskEntry.height; py++) {
      const targetY = originY + py;
      if (targetY < 0 || targetY >= this.height) continue;
      const rowOffset = py * maskEntry.width;
      for (let px = 0; px < maskEntry.width; px++) {
        const targetX = originX + px;
        if (targetX < 0 || targetX >= this.width) continue;
        if (alpha[rowOffset + px] < 16) continue;
        this.logSetIndexSample(id, targetX, targetY);
        const flowSlot = this.resolveFlowSlot(strokeData, strokeData.flow.activeSlot ?? 0);
        if (
          capturedPhaseMap &&
          capturedMapWidth > 0 &&
          capturedMapHeight > 0 &&
          rotation === 0
        ) {
          const srcX = Math.max(
            0,
            Math.min(
              capturedMapWidth - 1,
              Math.floor((px * capturedMapWidth) / Math.max(1, maskEntry.width))
            )
          );
          const srcY = Math.max(
            0,
            Math.min(
              capturedMapHeight - 1,
              Math.floor((py * capturedMapHeight) / Math.max(1, maskEntry.height))
            )
          );
          const sourceIndex = capturedPhaseMap[srcY * capturedMapWidth + srcX] ?? 0;
          if (sourceIndex <= 0) {
            continue;
          }
          const mapped = ((Math.max(1, sourceIndex) - 1 + phaseOffset) % cycleSpan) + 1;
          animator.setIndex(targetX, targetY, mapped, flowSlot);
          wrotePixels += 1;
        } else {
          animator.setIndex(targetX, targetY, colorIndex, flowSlot);
          wrotePixels += 1;
        }
      }
    }

    strokeData.lastPoint = { x, y };
    strokeData.stampCounter++;

    this.dirtyLayers.add(id);

    if (!this.isAnimating && !this.renderScheduled) {
      this.renderScheduled = true;
      requestAnimationFrame(() => {
        this.renderScheduled = false;

        if (this.dirtyLayers.size > 0) {
          this.dirtyLayers.forEach(layerIdDirty => {
            const layerAnimator = this.animators.get(layerIdDirty);
            if (layerAnimator) {
              layerAnimator.forceRender();
            }
          });

          this.dirtyLayers.clear();
          this.render(false);
        }
      });
    }
    if (profile) {
      profile.paintCalls += 1;
      profile.paintTotalMs += getBrushProfileNow() - paintStart;
      profile.writePixels += wrotePixels;
    }
  }

  private applyGradientForLayer(
    layerId: string,
    stops: GradientStop[],
    seamProfile: GradientSeamProfile = 'hard',
  ) {
    const animator = this.getAnimator(layerId);
    const activeSlot = this.activeGradientSlots.get(layerId) ?? 0;

    const signature = ColorCycleBrushCanvas2D.computeGradientSignature(stops, seamProfile);
    const previousSignature = this.gradientSignatures.get(layerId);
    const gradientChanged = signature !== previousSignature;

    if (gradientChanged) {
      this.gradientSignatures.set(layerId, signature);
    }

    // Update gradient for the active slot
    if (typeof animator.setGradientSlot === 'function') {
      animator.setGradientSlot(activeSlot, stops, seamProfile);
      animator.setActiveGradientSlot?.(activeSlot);
    } else {
      animator.setGradient(stops, seamProfile);
    }

    // Cache stops for perceptual dithering paths
    try {
      this.currentGradientStops = Array.isArray(stops) && stops.length > 0 ? [...stops] : this.currentGradientStops;
    } catch {}
    
    if (gradientChanged && !this.preserveGradientPhaseOnChange) {
      // Reset stamp sequencing so the new gradient starts from the first band
      this.stampCounter = 0;

      const strokeData = this.layerStrokes.get(layerId);
      if (strokeData) {
        strokeData.stampCounter = 0;
      }
    }
  }

  /** Preserve gradient phase when swapping gradient stops (foreground-derived mode). */
  setPreserveGradientPhase(enabled: boolean) {
    this.preserveGradientPhaseOnChange = !!enabled;
  }

  /**
   * Set gradient (API compatible)
   */
  setGradient(stops: GradientStop[], layerId?: string) {
    const id = layerId || this.activeLayerId || 'default';
    const slot = this.activeGradientSlots.get(id) ?? 0;
    this.setGradientSlot(id, slot, stops);
    this.setActiveGradientSlot(id, slot);
  }

  /**
   * Register gradient stops for a specific slot without changing the active slot.
   */
  setGradientSlot(
    layerId: string,
    slot: number,
    stops: GradientStop[],
    seamProfile: GradientSeamProfile = 'hard',
  ) {
    const id = layerId || this.activeLayerId || 'default';
    const clampedSlot = Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot)));

    let slotMap = this.gradientSlotsByLayer.get(id);
    if (!slotMap) {
      slotMap = new Map();
      this.gradientSlotsByLayer.set(id, slotMap);
    }

    let signatureMap = this.gradientSlotSignaturesByLayer.get(id);
    if (!signatureMap) {
      signatureMap = new Map();
      this.gradientSlotSignaturesByLayer.set(id, signatureMap);
    }

    const signature = ColorCycleBrushCanvas2D.computeGradientSignature(stops, seamProfile);
    const previousSignature = signatureMap.get(clampedSlot);
    const signatureChanged = signature !== previousSignature;

    if (!signatureChanged) {
      const activeSlot = this.activeGradientSlots.get(id);
      if (activeSlot === clampedSlot && this.gradientSignatures.get(id) !== signature) {
        this.applyGradientForLayer(id, stops, seamProfile);
      }
      return;
    }

    signatureMap.set(clampedSlot, signature);
    slotMap.set(clampedSlot, stops);

    if (this.activeGradientSlots.get(id) === clampedSlot) {
      this.applyGradientForLayer(id, stops, seamProfile);
    }
  }

  /**
   * Register gradient stops for a slot (palette update only).
   * This does not toggle the active slot, and is safe to call for inactive slots.
   */
  setGradientSlotStops(
    layerId: string,
    slot: number,
    stops: GradientStop[],
    seamProfile: GradientSeamProfile = 'hard',
  ) {
    const id = layerId || this.activeLayerId || 'default';
    const clampedSlot = Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot)));

    let slotMap = this.gradientSlotsByLayer.get(id);
    if (!slotMap) {
      slotMap = new Map();
      this.gradientSlotsByLayer.set(id, slotMap);
    }

    let signatureMap = this.gradientSlotSignaturesByLayer.get(id);
    if (!signatureMap) {
      signatureMap = new Map();
      this.gradientSlotSignaturesByLayer.set(id, signatureMap);
    }

    const signature = ColorCycleBrushCanvas2D.computeGradientSignature(stops, seamProfile);
    const previousSignature = signatureMap.get(clampedSlot);
    const signatureChanged = signature !== previousSignature;

    if (!signatureChanged) {
      return;
    }

    signatureMap.set(clampedSlot, signature);
    slotMap.set(clampedSlot, stops);

    if (this.activeGradientSlots.get(id) === clampedSlot) {
      this.applyGradientForLayer(id, stops, seamProfile);
      return;
    }

    const animator = this.getAnimator(id);
    if (typeof animator.setGradientSlot === 'function') {
      animator.setGradientSlot(clampedSlot, stops, seamProfile);
    }
  }

  /**
   * Set the active gradient slot for a layer and apply it to the animator.
   */
  setActiveGradientSlot(layerId: string, slot: number) {
    const id = layerId || this.activeLayerId || 'default';
    const clampedSlot = Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot)));
    if (this.activeGradientSlots.get(id) === clampedSlot) {
      return;
    }
    this.activeGradientSlots.set(id, clampedSlot);
    this.activeLayerId = id;
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.flow.activeSlot = clampedSlot;
    }

    const slotMap = this.gradientSlotsByLayer.get(id);
    const stops = slotMap?.get(clampedSlot);
    if (stops && stops.length > 0) {
      this.applyGradientForLayer(id, stops);
    }
  }

  /**
   * Read the active gradient slot for a layer.
   */
  getActiveGradientSlot(layerId?: string): number {
    const id = layerId || this.activeLayerId || 'default';
    return this.activeGradientSlots.get(id) ?? 0;
  }

  /**
   * Refresh gradient-def palette bindings from the current layer store state.
   * This is required when gradient defs change outside the normal shape finalize flow,
   * such as color-adjust previews on color-cycle layers.
   */
  syncGradientDefRuntime(layerId: string) {
    const id = layerId || this.activeLayerId || 'default';
    const animator = this.animators.get(id);
    const strokeData = this.layerStrokes.get(id);
    if (!animator || !strokeData) {
      return;
    }

    try {
      const layer = useAppStore.getState().layers.find((entry) => entry.id === id);
      const defs = layer?.colorCycleData?.gradientDefStore as Array<{
        id: number;
        hash: string;
        stops: GradientStop[];
      }> | undefined;
      this.applyDefBindingsForLayer(id, animator, strokeData, defs);
      animator.forceRender();
      this.dirtyLayers.add(id);
      this.render(false);
    } catch {}
  }

  /**
   * Clear paint buffer for a layer (used for shape mode)
   */
  clearPaintBuffer(layerId?: string) {
    const id = layerId || this.activeLayerId || 'default';
    if (this._isHistoryRestore) {
      if (process.env.NODE_ENV !== 'production') {
        console.assert(false, '[ColorCycleBrush] clearPaintBuffer invoked during history restore');
      }
      return;
    }
    const strokeData = this.ensureStrokeState(id);
    strokeData.buffers.paint.fill(0);
    strokeData.buffers.gid.fill(0);
    strokeData.buffers.spd.fill(0);
    strokeData.buffers.flow.fill(0);
    strokeData.buffers.def.fill(0);
    strokeData.hasContent = false;
    strokeData.externalBase.hasExternalBase = false;

    const animator = this.ensureFullResolution(id, 'stroke');
    animator.setIndexBufferFromArray(
      strokeData.buffers.paint,
      strokeData.buffers.gid,
      strokeData.buffers.spd,
      strokeData.buffers.flow
    );
    animator.setDefIdData(strokeData.buffers.def);
    animator.forceRender();
    this.render(false);
  }

  /**
   * Bind committed gradient def ids to pixels that match a slot.
   * This updates the authoritative def buffer without reading from animator state.
   */
  bindGradientDefIdToSlot(
    layerId: string,
    defId: number,
    slot: number,
    bbox?: {
      minX: number;
      minY: number;
      width: number;
      height: number;
    },
    previewSlot?: number | null
  ) {
    const strokeData = this.ensureStrokeState(layerId);
    const expected = this.width * this.height;
    if (strokeData.buffers.def.length !== expected) {
      strokeData.buffers.def = new Uint16Array(expected);
    }
    if (strokeData.buffers.gid.length !== expected) {
      strokeData.buffers.gid = new Uint8Array(expected);
    }
    if (strokeData.buffers.paint.length !== expected) {
      strokeData.buffers.paint = new Uint8Array(expected);
    }

    const defBuffer = strokeData.buffers.def;
    const gidBuffer = strokeData.buffers.gid;
    const paintBuffer = strokeData.buffers.paint;

    const minX = Math.max(0, Math.floor(bbox?.minX ?? 0));
    const minY = Math.max(0, Math.floor(bbox?.minY ?? 0));
    const maxX = Math.min(this.width - 1, Math.floor((bbox?.minX ?? 0) + (bbox?.width ?? this.width) - 1));
    const maxY = Math.min(this.height - 1, Math.floor((bbox?.minY ?? 0) + (bbox?.height ?? this.height) - 1));

    const previewSlotMasked =
      typeof previewSlot === 'number' ? (previewSlot & FLOW_SLOT_MASK) : null;
    const committedSlotMasked = slot & FLOW_SLOT_MASK;
    const effectivePreviewSlot =
      previewSlotMasked !== null && previewSlotMasked !== committedSlotMasked ? previewSlotMasked : null;
    let leftoverPreview = 0;
    for (let y = minY; y <= maxY; y += 1) {
      const row = y * this.width;
      for (let x = minX; x <= maxX; x += 1) {
        const idx = row + x;
        if (paintBuffer[idx] === 0) {
          defBuffer[idx] = 0;
          continue;
        }
        const gid = gidBuffer[idx];
        const curSlot = gid & FLOW_SLOT_MASK;
        if (effectivePreviewSlot !== null && curSlot === effectivePreviewSlot) {
          gidBuffer[idx] = (gid & ~FLOW_SLOT_MASK) | committedSlotMasked;
          defBuffer[idx] = defId;
        } else if (curSlot === committedSlotMasked) {
          defBuffer[idx] = defId;
        }
        if (process.env.NODE_ENV !== 'production' && effectivePreviewSlot !== null) {
          if ((gidBuffer[idx] & FLOW_SLOT_MASK) === effectivePreviewSlot) {
            leftoverPreview += 1;
          }
        }
      }
    }
    if (process.env.NODE_ENV !== 'production' && effectivePreviewSlot !== null) {
      console.assert(leftoverPreview === 0, '[CC] preview slot leaked into committed stroke', {
        layerId,
        leftover: leftoverPreview,
        previewSlot: effectivePreviewSlot,
        committedSlot: committedSlotMasked,
      });
    }

    try {
      const animator = this.animators.get(layerId) ?? this.getAnimator(layerId);
      const layer = useAppStore.getState().layers.find((entry) => entry.id === layerId);
      const defs = layer?.colorCycleData?.gradientDefStore as Array<{
        id: number;
        hash: string;
        stops: GradientStop[];
      }> | undefined;
      this.applyDefBindingsForLayer(layerId, animator, strokeData, defs);
    } catch {}

    strokeData.snapshot = {
      ...(strokeData.snapshot ?? {
        paintBuffer: strokeData.buffers.paint.slice().buffer,
        gradientIdBuffer: strokeData.buffers.gid.slice().buffer,
        speedBuffer: strokeData.buffers.spd.slice().buffer,
        flowBuffer: strokeData.buffers.flow.slice().buffer,
        hasContent: strokeData.hasContent,
        strokeCounter: strokeData.strokeCounter,
      }),
      gradientDefIdBuffer: defBuffer.slice().buffer,
    };
  }

  private syncGradientDefBufferToLayerStore(layerId: string): void {
    if (typeof this.getLayerSnapshot !== 'function') {
      return;
    }
    const snapshot = this.getLayerSnapshot(layerId);
    if (!snapshot?.gradientDefIdBuffer) {
      return;
    }
    const state = useAppStore.getState();
    const layer = state.layers.find((entry) => entry.id === layerId);
    if (!layer?.colorCycleData) {
      return;
    }
    state.updateLayer(layerId, {
      colorCycleData: {
        ...layer.colorCycleData,
        gradientDefIdBuffer: snapshot.gradientDefIdBuffer,
      },
    });
  }

  commitCommittedLayerState(options: CommitCommittedLayerStateOptions): void {
    const { layerId, targetCanvas = null, opacity = 1, binding } = options;
    if (binding) {
      this.bindGradientDefIdToSlot(
        layerId,
        binding.defId,
        binding.slot,
        binding.bbox,
        binding.previewSlot
      );
      this.syncGradientDefBufferToLayerStore(layerId);
    }

    if (!targetCanvas) {
      return;
    }

    if (opacity !== 1) {
      this.commitToLayer(targetCanvas, layerId, opacity);
      return;
    }

    this.renderDirectToCanvas(targetCanvas, layerId);
  }

  getCommittedIndexData(layerId: string): Uint8Array | null {
    try {
      const animator = this.animators.get(layerId) ?? this.getAnimator(layerId);
      const buffers = animator.getIndexBuffers();
      return buffers?.data ?? null;
    } catch {
      return null;
    }
  }

  getCommittedGradientIdData(layerId: string): Uint8Array | null {
    try {
      const animator = this.animators.get(layerId) ?? this.getAnimator(layerId);
      const buffers = animator.getIndexBuffers();
      return buffers?.gid ?? null;
    } catch {
      return null;
    }
  }

  getCommittedPaletteRGBABySlot(layerId: string): Array<Uint8ClampedArray | Uint8Array | null> | null {
    try {
      const animator = this.animators.get(layerId) ?? this.getAnimator(layerId);
      return animator.getPaletteRGBABySlot();
    } catch {
      return null;
    }
  }

  getCommittedDimensions(layerId: string): { width: number; height: number } | null {
    try {
      const animator = this.animators.get(layerId) ?? this.getAnimator(layerId);
      return animator.getDimensions();
    } catch {
      return null;
    }
  }

  remapCommittedGradientSlot(
    layerId: string,
    fromSlot: number,
    toSlot: number,
    bbox?: { minX: number; minY: number; width: number; height: number }
  ): void {
    const animator = this.animators.get(layerId) ?? this.getAnimator(layerId);
    const buffers = animator.getIndexBuffers();
    const indexData = buffers?.data;
    const gidData = buffers?.gid;
    if (!indexData || !gidData) {
      return;
    }
    const { width, height } = animator.getDimensions();
    const expected = width * height;
    if (indexData.length !== expected || gidData.length !== expected) {
      return;
    }
    const from = Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(fromSlot)));
    const to = Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(toSlot)));
    if (from === to) {
      return;
    }
    const minX = Math.max(0, Math.floor(bbox?.minX ?? 0));
    const minY = Math.max(0, Math.floor(bbox?.minY ?? 0));
    const maxX = Math.min(width - 1, Math.floor((bbox?.minX ?? 0) + (bbox?.width ?? width) - 1));
    const maxY = Math.min(height - 1, Math.floor((bbox?.minY ?? 0) + (bbox?.height ?? height) - 1));
    for (let y = minY; y <= maxY; y += 1) {
      const row = y * width;
      for (let x = minX; x <= maxX; x += 1) {
        const idx = row + x;
        if (indexData[idx] === 0) {
          continue;
        }
        const gid = gidData[idx];
        const curSlot = gid & FLOW_SLOT_MASK;
        if (curSlot === from) {
          gidData[idx] = (gid & ~FLOW_SLOT_MASK) | to;
        }
      }
    }
    animator.markDirty({ x: minX, y: minY, width: Math.max(1, maxX - minX + 1), height: Math.max(1, maxY - minY + 1) });
  }

  private paintBufferHasContent(
    paint: Uint8Array | undefined,
    width: number,
    height: number
  ): boolean {
    try {
      if (!paint || paint.length === 0 || width <= 0 || height <= 0) {
        return false;
      }
      const limit = Math.min(width * height, paint.length);
      for (let index = 0; index < limit; index += 1) {
        if (paint[index] !== 0) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }


  private captureRegionU8(
    src: Uint8Array,
    fullW: number,
    bbox: { minX: number; minY: number; width: number; height: number }
  ): Uint8Array {
    const out = new Uint8Array(bbox.width * bbox.height);
    for (let row = 0; row < bbox.height; row += 1) {
      const y = bbox.minY + row;
      const srcOff = y * fullW + bbox.minX;
      out.set(src.subarray(srcOff, srcOff + bbox.width), row * bbox.width);
    }
    return out;
  }

  private applyLostEdgeFromWrittenMask(options: {
    writtenMask: Uint8Array;
    prevIdx: Uint8Array;
    prevGid: Uint8Array;
    prevSpd: Uint8Array;
    prevFlow: Uint8Array;
    paint: Uint8Array;
    gid: Uint8Array;
    spd: Uint8Array;
    flow: Uint8Array;
    fullW: number;
    bbox: { minX: number; minY: number; width: number; height: number };
    lostEdge: number;
  }) {
    const {
      writtenMask,
      prevIdx,
      prevGid,
      prevSpd,
      prevFlow,
      paint,
      gid,
      spd,
      flow,
      fullW,
      bbox,
      lostEdge,
    } = options;
    const keep = applySierraLiteLostEdgeMask(writtenMask, bbox.width, bbox.height, lostEdge);
    for (let row = 0; row < bbox.height; row += 1) {
      const y = bbox.minY + row;
      const dstRow = y * fullW + bbox.minX;
      const localRow = row * bbox.width;
      for (let col = 0; col < bbox.width; col += 1) {
        const p = localRow + col;
        if (writtenMask[p] === 0) continue;
        if (keep[p] >= 128) continue;
        const dst = dstRow + col;
        paint[dst] = prevIdx[p];
        gid[dst] = prevGid[p];
        spd[dst] = prevSpd[p];
        flow[dst] = prevFlow[p];
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      const violations: Array<{ x: number; y: number }> = [];
      for (let row = 0; row < bbox.height; row += 1) {
        const y = bbox.minY + row;
        const dstRow = y * fullW + bbox.minX;
        const localRow = row * bbox.width;
        for (let col = 0; col < bbox.width; col += 1) {
          const p = localRow + col;
          if (writtenMask[p] !== 0) continue;
          const dst = dstRow + col;
          if (
            paint[dst] !== prevIdx[p] ||
            gid[dst] !== prevGid[p] ||
            spd[dst] !== prevSpd[p] ||
            flow[dst] !== prevFlow[p]
          ) {
            violations.push({ x: bbox.minX + col, y });
            paint[dst] = prevIdx[p];
            gid[dst] = prevGid[p];
            spd[dst] = prevSpd[p];
            if (violations.length >= 5) break;
          }
        }
        if (violations.length >= 5) break;
      }
      if (violations.length > 0) {
        console.warn('[CC lost-edge] write mask violation; restoring pixels', {
          count: violations.length,
          sample: violations,
        });
      }
    }
  }

  private renderAnimatorToContext(
    animator: ColorCycleAnimator,
    ctx: CanvasRenderingContext2D,
    targetCanvas: HTMLCanvasElement
  ): void {
    const { width, height } = animator.getDimensions();
    if (width <= 0 || height <= 0) {
      return;
    }
    if (width === targetCanvas.width && height === targetCanvas.height) {
      animator.renderToCanvas2D(ctx);
      return;
    }
    const tempCanvas = canvasPool.acquire(width, height);
    const tempCtx = tempCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true,
    }) as CanvasRenderingContext2D | null;
    if (!tempCtx) {
      canvasPool.release(tempCanvas);
      return;
    }
    tempCtx.clearRect(0, 0, width, height);
    animator.renderToCanvas2D(tempCtx);
    ctx.drawImage(tempCanvas, 0, 0, width, height, 0, 0, targetCanvas.width, targetCanvas.height);
    canvasPool.release(tempCanvas);
  }

  // --- Perceptual dithering helpers ---
  private parseCssColor(color: string | RgbColor): RgbColor {
    if (typeof color === 'object' && color !== null && 'r' in color && 'g' in color && 'b' in color) {
      const { r, g, b } = color;
      return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return { r: 0, g: 0, b: 0 };
    }
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2] };
  }

  private interpolateColor(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number) {
    return {
      r: Math.round(a.r + (b.r - a.r) * t),
      g: Math.round(a.g + (b.g - a.g) * t),
      b: Math.round(a.b + (b.b - a.b) * t)
    };
  }

  private colorAtPosition(pos: number, stopsOverride?: GradientStop[]): { r: number; g: number; b: number } {
    const stops = stopsOverride ?? this.currentGradientStops;
    if (!stops || stops.length === 0) return { r: 0, g: 0, b: 0 };
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    if (pos <= sorted[0].position) return this.parseCssColor(sorted[0].color);
    if (pos >= sorted[sorted.length - 1].position) return this.parseCssColor(sorted[sorted.length - 1].color);
    for (let i = 0; i < sorted.length - 1; i++) {
      const s0 = sorted[i]; const s1 = sorted[i + 1];
      if (pos >= s0.position && pos <= s1.position) {
        const c0 = this.parseCssColor(s0.color); const c1 = this.parseCssColor(s1.color);
        const t = (pos - s0.position) / Math.max(1e-6, (s1.position - s0.position));
        return this.interpolateColor(c0, c1, t);
      }
    }
    return this.parseCssColor(sorted[sorted.length - 1].color);
  }

  private clearStampDitherCache() {
    clearStampDitherRuntime(this.stampDitherRuntime);
  }

  private hashStrokeDitherSeed(r: number, g: number, b: number, slot: number, strokeCounter: number): number {
    let h = (Math.round(r) & 255) | ((Math.round(g) & 255) << 8) | ((Math.round(b) & 255) << 16);
    h ^= (Math.round(slot) & 255) << 24;
    h ^= strokeCounter + 0x9e3779b9 + (h << 6) + (h >> 2);
    return h >>> 0;
  }



  private rgbToHex(c: { r: number; g: number; b: number }): string {
    const toHex = (v: number) => v.toString(16).padStart(2, '0');
    return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
  }

  private buildQuantizedGradientPalette(numColors: number): { css: string[]; mapRgbToIndex: Map<string, number> } {
    const colors: string[] = [];
    const map = new Map<string, number>();
    const n = Math.max(2, Math.floor(numColors));
    for (let i = 0; i < n; i++) {
      const pos = i / n;
      const rgb = this.colorAtPosition(pos);
      const hex = this.rgbToHex(rgb);
      colors.push(hex);
      // Pre-map this palette color to a gradient index using position → index mapping
      const idx = Math.min(255, Math.round(pos * 254) + 1); // clamp to final gradient stop
      map.set(`${rgb.r},${rgb.g},${rgb.b}`, idx);
    }
    return { css: colors, mapRgbToIndex: map };
  }

  /** Enable/disable perceptual dithering for shape fills. */
  setPerceptualDither(enabled: boolean) { this.perceptualDither = !!enabled; }

  async fillShapeDispatch(args: {
    mode: FillMode;
    vertices: Vec2[];
    layerId: string;
    direction?: Vec2;
    options?: FillOptions;
  }): Promise<void> {
    const { mode, vertices, layerId, direction, options } = args;
    if (!layerId) {
      throw new Error('fillShapeDispatch requires a layerId');
    }
    if (mode === 'linear') {
      if (!direction) {
        throw new Error('fillShapeDispatch(linear) requires direction');
      }
      return this.fillShapeLinear(vertices, direction, layerId, options?.spacing, options);
    }
    if (mode === 'concentric') {
      return this.fillShape(vertices, layerId, options?.spacing, options);
    }
  }

  /**
   * Start new stroke (API compatible)
   */
  startStroke(layerId?: string, clearBuffer: boolean = false) {
    const beginStrokeStart = nowMs();
    this.resetPerfStroke();
    if (typeof window !== 'undefined') {
      const globalWindow = window as typeof window & {
        __CC_probe?: { start: number; paint: number; end: number; last: Record<string, unknown> };
      };
      globalWindow.__CC_probe ??= { start: 0, paint: 0, end: 0, last: {} };
      globalWindow.__CC_probe.start += 1;
      globalWindow.__CC_probe.last = { ...globalWindow.__CC_probe.last, layerId };
      // removed debug log
    }
    const id = layerId || this.activeLayerId || 'default';
    

    this.activeLayerId = id;
    this.isDrawing = true;
    this.strokeCounter++;
    this.lastPoint = null;
    
    // Before starting a new stroke, optionally separate from any existing content
    // by committing previous content to the target layer (if present) and
    // clearing internal buffers. We keep this conservative to avoid unwanted
    // cross-layer writes; renderDirectToCanvas will be called by higher-level
    // handlers during finalize.
    const animator = this.ensureFullResolution(id, 'stroke');
    if (clearBuffer && !this._isHistoryRestore) {
      try { animator.clear(); } catch {}
    }
    if (typeof animator.startStroke === 'function') {
      animator.startStroke();
    }
    const strokeData = this.layerStrokes.get(id);
    const strokeStartSpeed = this.getResolvedWriteCycleSpeed();
    const speedByte = encodeColorCycleSpeedByte(strokeStartSpeed);
    try {
      if (typeof (animator as { setStrokeSpeedByte?: (value: number) => void }).setStrokeSpeedByte === 'function') {
        (animator as { setStrokeSpeedByte: (value: number) => void }).setStrokeSpeedByte(speedByte);
      }
    } catch {}

    if (strokeData && !strokeData.hasContent) {
      strokeData.hasContent = true;
    }
    if (strokeData) {
      const expected = this.width * this.height;
      if (strokeData.buffers.paint.length === expected) {
        try {
          animator.setIndexBufferFromArray(
            strokeData.buffers.paint,
            strokeData.buffers.gid,
            strokeData.buffers.spd,
            strokeData.buffers.flow
          );
        } catch {}
        try {
          this.bindStrokeBuffersToAnimator(strokeData, animator);
        } catch {}
      }
      strokeData.flow.activeSlot = this.activeGradientSlots.get(id) ?? strokeData.flow.activeSlot ?? 0;
      strokeData.flow.mode = this.flowMode;
      strokeData.flow.encoded = true;
      const seedSlot = strokeData.flow.activeSlot ?? 0;
      const colorIndex = this.computeColorBandIndex(strokeData);
      const seedPos = Math.max(0, Math.min(1, (colorIndex - 1) / 254));
      const seedRgb = this.colorAtPosition(seedPos);
      const nextSeed = this.hashStrokeDitherSeed(
        seedRgb.r,
        seedRgb.g,
        seedRgb.b,
        seedSlot,
        this.strokeCounter
      );
      if (clearBuffer && !this._isHistoryRestore) {
        const preservedStampCounter = strokeData.stampCounter;
        const preservedPhaseUnits = strokeData.strokePhaseUnits;
        strokeData.buffers.paint.fill(0);
        strokeData.buffers.gid.fill(0);
        strokeData.buffers.spd.fill(0);
        strokeData.buffers.flow.fill(0);
        strokeData.buffers.def.fill(0);
        strokeData.hasContent = false;
        // Preserve stamp counter for continuous gradient flow between shapes
        strokeData.stampCounter = preservedStampCounter;
        strokeData.strokePhaseUnits = preservedPhaseUnits;
      }
      strokeData.strokeCounter = this.strokeCounter;
      strokeData.strokeCycleSpeed = strokeStartSpeed;
      strokeData.strokeSpeedByte = speedByte;
      strokeData.lastPoint = null;
      if (this.stampDitherEnabled) {
        const perf = this.perfStroke;
        const stampState = this.ensureStampDitherState(strokeData);
        stampState.stampDitherSeed = nextSeed;
        stampState.stampDitherOrigin = null;
        stampState.stampDitherPressureState = null;
        stampState.stampDitherPressureStable = undefined;
        stampState.stampDitherPressureLast = undefined;
        stampState.stampDitherPressureLastTime = undefined;
        stampState.stampDitherPressureSampleCount = undefined;
        stampState.stampDitherBounds = null;
        stampState.stampDitherLastTileScale = null;
        stampState.stampDitherStrokeScale = undefined;
        stampState.stampDitherRecomposeLastMs = undefined;
        stampState.stampDitherRecomposePending = false;
        stampState.stampDitherRecomposeScale = undefined;
        stampState.stampDitherOriginUnits = null;
        stampState.stampDitherOriginBaseSize = undefined;
        stampState.stampDitherLockedBucket = undefined;
        stampState.stampSeqMeta = [];
        stampState.stampSeqToTileScale = undefined;
        const stampStroke = this.getStampDitherStrokeData(strokeData);
        stampStroke.stampDitherStrokeEpoch = ((stampStroke.stampDitherStrokeEpoch ?? 0) + 1) & 0xffff;
        if (stampStroke.stampDitherStrokeEpoch === 0) {
          stampStroke.stampDitherStrokeEpoch = 1;
        }
        const allocStart = perf ? nowMs() : 0;
        ensureStampDitherBuffers(stampStroke, this.width, this.height);
        ensureStampDitherTag(stampStroke, this.width, this.height);
        if (!this.stampDitherBgFill) {
          ensureStampDitherBaseBuffers(stampStroke, this.width, this.height);
        } else {
          stampStroke.stampDitherBaseIdx = undefined;
          stampStroke.stampDitherBaseGid = undefined;
          stampStroke.stampDitherBaseTag = undefined;
        }
        if (perf) perf.durations.allocOrResizeMs += Math.max(0, nowMs() - allocStart);
        stampStroke.stampDitherStampSeq = 0;
        stampStroke.stampDitherFillHandle = animator.beginDirectFill();
        this.assertStrokeHandleSize(stampStroke.stampDitherFillHandle, 'stamp dither');
        if (process.env.NODE_ENV !== 'production') {
          const h = stampStroke.stampDitherFillHandle;
          if (h && (h.width !== this.width || h.height !== this.height)) {
            console.warn('[CC] stamp dither handle size mismatch', {
              handle: { w: h.width, h: h.height },
              brush: { w: this.width, h: this.height },
            });
          }
        }
        const phaseForMask = 0.5;
        const idxForMask = this.computeColorBandIndex(strokeData);
        const coverage = resolveStampDitherCoverage(phaseForMask, idxForMask, this.isAnimating);
        const rawBucket = resolveStampDitherBucket(coverage);
        stampStroke.stampDitherLockedBucket = Math.min(
          STAMP_DITHER_BUCKETS - 2,
          Math.max(1, rawBucket)
        );
      } else {
        strokeData.stampDither = undefined;
      }
      
      // Keep stamp counter continuous across strokes for flowing gradients (unless cleared above)
      // Don't reset - let it accumulate for continuous color progression
    }
    if (this.perfStroke) {
      this.perfStroke.durations.beginStrokeTotalMs += Math.max(0, nowMs() - beginStrokeStart);
    }
  }
  
  /**
   * End stroke (API compatible)
   */
  endStroke(layerId?: string) {
    if (typeof window !== 'undefined') {
      const globalWindow = window as typeof window & {
        __CC_probe?: { start: number; paint: number; end: number; last: Record<string, unknown> };
      };
      globalWindow.__CC_probe ??= { start: 0, paint: 0, end: 0, last: {} };
      globalWindow.__CC_probe.end += 1;
      globalWindow.__CC_probe.last = { ...globalWindow.__CC_probe.last, layerId };
      // removed debug log
    }
    const id = layerId || this.activeLayerId || 'default';
    this.isDrawing = false;

    const animator = this.ensureFullResolution(id, 'stroke');
    const strokeData = this.layerStrokes.get(id);
    const perf = this.perfStroke;
    const shouldLog =
      process.env.NODE_ENV !== 'production' &&
      typeof globalThis !== 'undefined' &&
      (globalThis as { __CC_STAMP_DEBUG?: boolean }).__CC_STAMP_DEBUG === true;
    const hasDitherBounds = Boolean(strokeData?.stampDither?.stampDitherBounds);
    const sampleIndices = (label: string, data?: Uint8Array) => {
      if (!shouldLog || !hasDitherBounds || !data || data.length === 0) return;
      const count = Math.min(8, data.length);
      const step = Math.max(1, Math.floor(data.length / count));
      const samples: Array<{ i: number; v: number }> = [];
      for (let i = 0; i < data.length && samples.length < count; i += step) {
        samples.push({ i, v: data[i] });
      }
      try {
        console.log(`[CC endStroke] ${label}`, { len: data.length, samples });
      } catch {}
    };
    const probeIndexRegion = (label: string, buf?: Uint8Array) => {
      if (!shouldLog || !buf || !strokeData?.stampDither?.stampDitherBounds) return;
      const b = strokeData.stampDither.stampDitherBounds;
      const minX = Math.max(0, Math.floor(b.minX));
      const minY = Math.max(0, Math.floor(b.minY));
      const maxX = Math.min(this.width - 1, Math.ceil(b.maxX));
      const maxY = Math.min(this.height - 1, Math.ceil(b.maxY));
      if (maxX <= minX || maxY <= minY) return;
      const w = this.width;
      const seen = new Set<number>();
      let transitions = 0;
      const clampX = Math.min(maxX, minX + 128);
      const clampY = Math.min(maxY, minY + 128);
      for (let y = minY; y <= clampY; y += 1) {
        const row = y * w;
        let prev = buf[row + minX];
        seen.add(prev);
        for (let x = minX + 1; x <= clampX; x += 1) {
          const v = buf[row + x];
          seen.add(v);
          if (v !== prev) transitions += 1;
          prev = v;
        }
      }
      try {
        console.log('[CC index probe]', {
          label,
          unique: seen.size,
          transitions,
          bounds: { minX, minY, maxX: clampX, maxY: clampY }
        });
      } catch {}
    };

    if (strokeData) {
      // Cancel any pending recomposes so finalize cannot re-write after mouseup.
      if (strokeData.stampDither) {
        strokeData.stampDither.stampDitherRecomposePending = false;
        strokeData.stampDither.stampDitherRecomposeScale = undefined;
      }
    }

    const skipStampFinalize = strokeData?.skipStampDitherFinalize === true;
    if (skipStampFinalize && strokeData) {
      strokeData.skipStampDitherFinalize = false;
    }

    if (strokeData && this.stampDitherEnabled && !skipStampFinalize) {
      const algo = this.stampDitherAlgorithm ?? 'sierra-lite';
      const finalizeStart = perf ? nowMs() : 0;
      const activeSlot = strokeData.flow.activeSlot ?? this.activeGradientSlots.get(id) ?? 0;
      const flowSlot = this.resolveFlowSlot(strokeData, activeSlot);
      finalizeStampDither({
        animator,
        state: this.getStampDitherStrokeData(strokeData),
        config: {
          algorithm: algo,
          pixelSize: this.stampDitherPixelSize,
          patternStyle: this.stampDitherPatternStyle,
          bgFill: this.stampDitherBgFill,
          pressureLinked: this.stampDitherPressureLinked,
          seed: strokeData.stampDither?.stampDitherSeed ?? 0,
        },
        width: this.width,
        height: this.height,
        flowSlot,
        cycleSpeed: this.getWriteCycleSpeed(strokeData),
        ditherStrength: this.ditherStrength,
      });
      if (perf) {
        perf.durations.endStrokeFinalizeMs += Math.max(0, nowMs() - finalizeStart);
      }
    }
    if (strokeData?.stampDither?.stampDitherFillHandle) {
      const needsUpload = animator.hasWebGL?.() ?? false;
      if (shouldLog && hasDitherBounds) {
        const handle = strokeData.stampDither.stampDitherFillHandle;
        sampleIndices('pre endDirectFill.handle.data', handle?.data);
        sampleIndices('pre endDirectFill.strokeData', strokeData?.buffers.paint);
        probeIndexRegion('pre endDirectFill.strokeData', strokeData?.buffers.paint);
      }
      animator.endDirectFill({ markDirty: needsUpload });
      if (shouldLog && hasDitherBounds) {
        sampleIndices('post endDirectFill.strokeData', strokeData?.buffers.paint);
        probeIndexRegion('post endDirectFill.strokeData', strokeData?.buffers.paint);
      }
      strokeData.stampDither.stampDitherFillHandle = undefined;
    }
    animator.endStroke();
    animator.forceRender(); // Force render on stroke end
    if (shouldLog && hasDitherBounds) {
      sampleIndices('post forceRender.strokeData', strokeData?.buffers.paint);
      probeIndexRegion('post forceRender.strokeData', strokeData?.buffers.paint);
    }

    if (strokeData) {
      strokeData.lastPoint = null;
      strokeData.strokeCounter = this.strokeCounter;

      if (perf && strokeData.stampDither?.stampDitherBounds) {
        const b = strokeData.stampDither.stampDitherBounds;
        const minX = Math.max(0, Math.floor(b.minX));
        const minY = Math.max(0, Math.floor(b.minY));
        const maxX = Math.min(this.width - 1, Math.ceil(b.maxX));
        const maxY = Math.min(this.height - 1, Math.ceil(b.maxY));
        if (maxX >= minX && maxY >= minY) {
          perf.stats.dirtyMinX = Math.min(perf.stats.dirtyMinX, minX);
          perf.stats.dirtyMinY = Math.min(perf.stats.dirtyMinY, minY);
          perf.stats.dirtyMaxX = Math.max(perf.stats.dirtyMaxX, maxX);
          perf.stats.dirtyMaxY = Math.max(perf.stats.dirtyMaxY, maxY);
          perf.stats.dirtyRectArea = (maxX - minX + 1) * (maxY - minY + 1);
        }
      }

      const serializeStart = perf ? nowMs() : 0;
      const snapshotBuffer: ArrayBuffer = strokeData.buffers.paint.length > 0
        ? strokeData.buffers.paint.slice().buffer
        : new ArrayBuffer(0);
      const snapshotGradientIdBuffer: ArrayBuffer | undefined = strokeData.buffers.gid.slice().buffer;
      const snapshotSpeedBuffer: ArrayBuffer | undefined = strokeData.buffers.spd.slice().buffer;
      const snapshotFlowBuffer: ArrayBuffer | undefined = strokeData.buffers.flow.slice().buffer;
      const snapshotGradientDefIdBuffer: ArrayBuffer | undefined = strokeData.buffers.def.slice().buffer;

      const hasContent = this.paintBufferHasContent(
        strokeData.buffers.paint,
        this.width,
        this.height
      );
      strokeData.hasContent = hasContent;
      strokeData.snapshot = {
        paintBuffer: snapshotBuffer,
        gradientIdBuffer: snapshotGradientIdBuffer,
        gradientDefIdBuffer: snapshotGradientDefIdBuffer,
        speedBuffer: snapshotSpeedBuffer,
        flowBuffer: snapshotFlowBuffer,
        hasContent,
        strokeCounter: this.strokeCounter
      };
      if (perf) {
        perf.durations.serializeMs += Math.max(0, nowMs() - serializeStart);
      }
      if (strokeData.stampDither) {
        strokeData.stampDither.stampDitherStampSeq = 0;
        strokeData.stampDither.stampDitherBounds = null;
        strokeData.stampDither.stampDitherRecomposeLastMs = undefined;
        strokeData.stampDither.stampDitherRecomposePending = false;
        strokeData.stampDither.stampDitherRecomposeScale = undefined;
        strokeData.stampDither.stampSeqMeta = undefined;
        strokeData.stampDither.stampSeqToTileScale = undefined;
      }

      this.logPerfStroke(id);
      try {
        const storeState = useAppStore.getState();
        const layer = storeState.layers.find(layerItem => layerItem.id === id);
        if (layer?.colorCycleData) {
          storeState.updateLayer(layer.id, {
            colorCycleData: {
              ...layer.colorCycleData,
              hasContent
            }
          });
        }
      } catch {
        // Swallow store sync issues silently; brush state remains authoritative.
      }
    }

    // Final render
    this.render(false);
  }

  private snapshotFromBuffers(strokeData: LayerStrokeState): void {
    const paint = strokeData.buffers.paint;
    const gid = strokeData.buffers.gid;
    const spd = strokeData.buffers.spd;
    const flow = strokeData.buffers.flow;
    const def = strokeData.buffers.def;
    const hasContent = this.paintBufferHasContent(
      paint,
      this.width,
      this.height
    );
    strokeData.hasContent = hasContent;
    strokeData.snapshot = {
      paintBuffer: paint.length > 0 ? paint.slice().buffer : new ArrayBuffer(0),
      gradientIdBuffer: gid.length > 0 ? gid.slice().buffer : undefined,
      gradientDefIdBuffer: def.length > 0 ? def.slice().buffer : undefined,
      speedBuffer: spd.length > 0 ? spd.slice().buffer : undefined,
      flowBuffer: flow.length > 0 ? flow.slice().buffer : undefined,
      hasContent,
      strokeCounter: strokeData.strokeCounter,
    };
  }

  private applyLostEdgeToBuffersRegion(options: {
    paint: Uint8Array;
    gid?: Uint8Array;
    spd?: Uint8Array;
    width: number;
    height: number;
    bbox: { minX: number; minY: number; width: number; height: number };
    lostEdge?: number;
    prevPaintRegion?: Uint8Array | null;
  }) {
    const { paint, gid, spd, width, height, bbox, lostEdge, prevPaintRegion } = options;
    const strength = Number.isFinite(lostEdge) ? Math.max(0, Math.min(100, lostEdge as number)) : 0;
    if (!strength || strength <= 0) return;

    const minX = Math.max(0, Math.floor(bbox.minX));
    const minY = Math.max(0, Math.floor(bbox.minY));
    const maxX = Math.min(width - 1, Math.ceil(bbox.minX + bbox.width - 1));
    const maxY = Math.min(height - 1, Math.ceil(bbox.minY + bbox.height - 1));
    if (maxX < minX || maxY < minY) return;

    const regionW = Math.max(1, maxX - minX + 1);
    const regionH = Math.max(1, maxY - minY + 1);
    const coverage = new Uint8Array(regionW * regionH);

    for (let y = 0; y < regionH; y += 1) {
      const srcRow = (minY + y) * width + minX;
      const dstRow = y * regionW;
      for (let x = 0; x < regionW; x += 1) {
        const prev = prevPaintRegion ? prevPaintRegion[dstRow + x] : 0;
        const current = paint[srcRow + x] > 0 ? 255 : 0;
        coverage[dstRow + x] = current > 0 && prev === 0 ? 255 : 0;
      }
    }

    let mask: Uint8ClampedArray;
    try {
      mask = applySierraLiteLostEdgeMask(coverage, regionW, regionH, strength);
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[CC] Lost-edge mask failed:', error);
      }
      return;
    }

    for (let y = 0; y < regionH; y += 1) {
      const srcRow = (minY + y) * width + minX;
      const dstRow = y * regionW;
      for (let x = 0; x < regionW; x += 1) {
        const keep = mask[dstRow + x] >= 128;
        if (!keep) {
          const prev = prevPaintRegion ? prevPaintRegion[dstRow + x] : 0;
          if (prev !== 0) {
            continue;
          }
          const idx = srcRow + x;
          paint[idx] = 0;
          if (gid) gid[idx] = 0;
          if (spd) spd[idx] = 0;
        }
      }
    }
  }

  private capturePaintRegion(
    paint: Uint8Array,
    width: number,
    height: number,
    bbox: { minX: number; minY: number; width: number; height: number }
  ): Uint8Array {
    const minX = Math.max(0, Math.floor(bbox.minX));
    const minY = Math.max(0, Math.floor(bbox.minY));
    const maxX = Math.min(width - 1, Math.ceil(bbox.minX + bbox.width - 1));
    const maxY = Math.min(height - 1, Math.ceil(bbox.minY + bbox.height - 1));
    const regionW = Math.max(1, maxX - minX + 1);
    const regionH = Math.max(1, maxY - minY + 1);
    const snapshot = new Uint8Array(regionW * regionH);
    for (let y = 0; y < regionH; y += 1) {
      const srcRow = (minY + y) * width + minX;
      const dstRow = y * regionW;
      snapshot.set(paint.subarray(srcRow, srcRow + regionW), dstRow);
    }
    return snapshot;
  }

  /**
   * Finalize any in-progress stroke for the active layer
   * Convenience wrapper to support higher-level engines' undo granularity
   */
  finalizeCurrentStroke(layerId?: string) {
    // If we're currently drawing, end the stroke cleanly
    if (this.isDrawing) {
      try {
        this.endStroke(layerId);
      } catch (error) {
        console.warn('[ColorCycleBrush.finalizeCurrentStroke] Failed to end stroke:', error);
      }
    }
  }
  
  /**
   * Fill shape with linear gradient in specified direction
   */
  async fillShapeLinear(
    vertices: Array<{ x: number; y: number }>,
    direction: { x: number; y: number },
    layerId: string,
    spacing?: number,
    options?: FillOptions
  ) {
    if (!layerId) {
      throw new Error('fillShapeLinear requires a layerId');
    }

    // Validate input
    if (!vertices || !Array.isArray(vertices)) {
      console.warn('Invalid vertices provided to fillShapeLinear');
      return;
    }
    
    if (vertices.length < 3) {
      console.warn('fillShapeLinear requires at least 3 vertices');
      return;
    }
    
    const id = layerId;
    const yieldIfNeeded = createYieldController();
    
    // Initialize stroke data BEFORE getting animator
    if (!this.layerStrokes.has(id)) {
      this.layerStrokes.set(id, this.createLayerStrokeState({ hasContent: true }));
    }
    
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.hasContent = true;
      strokeData.skipStampDitherFinalize = true;
      if (strokeData.buffers.paint.length === 0) {
        strokeData.buffers.paint = new Uint8Array(this.width * this.height);
      }
      if (strokeData.buffers.gid.length === 0) {
        strokeData.buffers.gid = new Uint8Array(this.width * this.height);
      }
      if (strokeData.buffers.spd.length === 0) {
        strokeData.buffers.spd = new Uint8Array(this.width * this.height);
      }
      if (strokeData.buffers.flow.length === 0) {
        strokeData.buffers.flow = new Uint8Array(this.width * this.height);
      }
      if (strokeData.buffers.flow.length === 0) {
        strokeData.buffers.flow = new Uint8Array(this.width * this.height);
      }
      if (strokeData.buffers.def.length === 0) {
        strokeData.buffers.def = new Uint16Array(this.width * this.height);
      }
    }
    
    const animator = this.ensureFullResolution(id, 'fill');
    if (strokeData) {
      try {
        this.bindStrokeBuffersToAnimator(strokeData, animator);
      } catch {}
    }
    // quiet
    const activeSlot = Number.isFinite(options?.paintSlotOverride)
      ? Math.max(0, Math.round(options?.paintSlotOverride as number))
      : strokeData?.flow.activeSlot ?? this.activeGradientSlots.get(id) ?? 0;
    if (strokeData) {
      strokeData.flow.activeSlot = activeSlot;
      strokeData.flow.mode = this.flowMode;
      strokeData.flow.encoded = true;
    }
    const flowSlot = this.resolveFlowSlot(strokeData, activeSlot);
    const logCcFill = isDebugEnabled('cc-fill');
    if (logCcFill) {
      debugLog('cc-fill', '[CC fill] uses slot', {
        layerId: id,
        activeSlot,
        flowSlot,
        encoded: strokeData?.flow?.encoded,
      });
    }
    
    // Find bounds
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (const v of vertices) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    
    // Clamp to canvas bounds
    minX = Math.max(0, Math.floor(minX));
    maxX = Math.min(this.width - 1, Math.ceil(maxX));
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(this.height - 1, Math.ceil(maxY));

    const fullMinX = minX;
    const fullMaxX = maxX;
    const fullMinY = minY;
    const fullMaxY = maxY;

    let fillMinX = fullMinX;
    let fillMaxX = fullMaxX;
    let fillMinY = fullMinY;
    let fillMaxY = fullMaxY;
    if (options?.roi) {
      const roiMinX = Math.floor(options.roi.x);
      const roiMinY = Math.floor(options.roi.y);
      const roiMaxX = Math.ceil(options.roi.x + options.roi.width - 1);
      const roiMaxY = Math.ceil(options.roi.y + options.roi.height - 1);
      fillMinX = Math.max(fillMinX, roiMinX);
      fillMinY = Math.max(fillMinY, roiMinY);
      fillMaxX = Math.min(fillMaxX, roiMaxX);
      fillMaxY = Math.min(fillMaxY, roiMaxY);
      if (fillMinX > fillMaxX || fillMinY > fillMaxY) {
        return;
      }
    }
    
    // Calculate shape center for direction vector origin
    const centerX = (fullMinX + fullMaxX) / 2;
    const centerY = (fullMinY + fullMaxY) / 2;
    
    // Normalize direction vector
    const dirLength = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
    const dirX = direction.x / dirLength;
    const dirY = direction.y / dirLength;
    
    // Calculate projection range for normalization
    let minProjection = Infinity;
    let maxProjection = -Infinity;
    
    // Find min/max projections for all vertices
    for (const v of vertices) {
      const dx = v.x - centerX;
      const dy = v.y - centerY;
      const projection = dx * dirX + dy * dirY;
      minProjection = Math.min(minProjection, projection);
      maxProjection = Math.max(maxProjection, projection);
    }
    
    const projectionPadding = 0.5 * (Math.abs(dirX) + Math.abs(dirY));
    const paddedMinProjection = minProjection - projectionPadding;
    const paddedMaxProjection = maxProjection + projectionPadding;
    const projectionRange = paddedMaxProjection - paddedMinProjection;
    const safeProjectionRange = Math.abs(projectionRange) < 1e-6 ? 1 : projectionRange;
    const spacingValue = this.normalizeBandSpacingValue(spacing);
    const projectionSpan = Math.max(1, Math.abs(safeProjectionRange));
    const ccGradient = options?.ccGradient === true;
    const numBands = ccGradient
      ? Math.max(2, Math.min(64, Math.floor(this.gradientBands || 12)))
      : this.deriveBandCountFromDistance(projectionSpan, spacingValue);
    const continuous = options?.continuous === true;
    const lostEdge = Number.isFinite(options?.lostEdge)
      ? Math.max(0, Math.min(100, Math.round(options?.lostEdge as number)))
      : 0;
    const ditherLevels = Number.isFinite(options?.ditherLevels)
      ? Math.max(1, Math.min(254, Math.floor(options?.ditherLevels as number)))
      : null;
    const baseOffset = Number.isFinite(options?.ditherBaseOffsetOverride)
      ? Math.max(0, Math.min(254, Math.round(options?.ditherBaseOffsetOverride as number)))
      : this.stampCounter % 255;
    const { speedByte, flowByte } = this.resolveShapeAnimationBytes(strokeData, { ccGradient });
    if (logCcFill) {
      debugLog('cc-fill', '[CC fill] linear path flags', {
        hasGL: (() => {
          try {
            return animator.hasWebGL();
          } catch {
            return null;
          }
        })(),
        ditherEnabled: this.ditherEnabled,
        ditherPixelSize: this.ditherPixelSize,
        perceptual: this.perceptualDither,
        ccGradient,
        continuous,
        lostEdge,
      });
    }
    const indexFromNormalized = (pos: number): number => {
      const raw = Math.round(pos * 254);
      const shifted = (raw + baseOffset) % 255;
      return Math.max(1, Math.min(255, shifted + 1));
    };
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

    const bbox = {
      minX: Math.floor(fillMinX),
      minY: Math.floor(fillMinY),
      width: Math.max(1, Math.ceil(fillMaxX) - Math.floor(fillMinX) + 1),
      height: Math.max(1, Math.ceil(fillMaxY) - Math.floor(fillMinY) + 1)
    };
    const prevIdx = this.captureRegionU8(strokeData?.buffers.paint ?? new Uint8Array(0), this.width, bbox);
    const prevGid = strokeData?.buffers.gid
      ? this.captureRegionU8(strokeData.buffers.gid, this.width, bbox)
      : new Uint8Array(bbox.width * bbox.height);
    const prevSpd = strokeData?.buffers.spd
      ? this.captureRegionU8(strokeData.buffers.spd, this.width, bbox)
      : new Uint8Array(bbox.width * bbox.height);
    const prevFlow = strokeData?.buffers.flow
      ? this.captureRegionU8(strokeData.buffers.flow, this.width, bbox)
      : new Uint8Array(bbox.width * bbox.height);
    const writtenMask = new Uint8Array(bbox.width * bbox.height);
    const dirNorm = { x: dirX, y: dirY };

    // GPU path (linear fill) when available
    try {
      const hasGL = animator.hasWebGL();
      if (hasGL && !continuous && lostEdge <= 0) {
        if (this.ditherEnabled && this.perceptualDither) {
          throw new Error('Perceptual dither requires CPU fill');
        }
        const runtimeMax = animator.getGLFillMaxVerts() || 256;
        const GPU_MAX_VERTS = Math.max(8, Math.min(256, runtimeMax));
        let gpuVertices = vertices;
        if (vertices.length > GPU_MAX_VERTS) {
          const simplified = simplifyToVertexLimit(vertices, GPU_MAX_VERTS, { initialTolerance: 0.25, maxTolerance: 10, stepFactor: 1.45 });
          if (simplified.length <= GPU_MAX_VERTS) {
            gpuVertices = simplified;
          } else {
            ccWarn('[ColorCycleBrush] Linear GPU fallback (vertex budget)', {
              original: vertices.length,
              simplified: simplified.length,
              limit: GPU_MAX_VERTS,
            });
          }
        }

        if (gpuVertices.length >= 3 && gpuVertices.length <= GPU_MAX_VERTS) {
      const ditherStrength = this.ditherEnabled ? this.ditherStrength : 0;
          const ditherPixelSize = this.ditherEnabled ? Math.max(1, this.ditherPixelSize) : 1;
          const noiseSeed = (this.stampCounter & 0xffff) / 65535;
          const colorStep = numBands > 1 ? 254 / (numBands - 1) : 254;
          const gpuStart = nowMs();
          const ok = animator.gpuFillShape(gpuVertices, {
            mode: 'linear',
            bands: numBands,
            baseOffset,
            colorStep,
            maxDist: 1,
            bbox,
            direction: dirNorm,
            directionOrigin: { x: centerX, y: centerY },
            directionRange: { min: paddedMinProjection, range: safeProjectionRange },
            ditherStrength,
            ditherPixelSize,
            noiseSeed,
          }, flowSlot, speedByte, flowByte);
          if (ok) {
            if (logCcFill) {
              debugLog('cc-fill', '[CC fill] linear USED GPU', { bbox, bands: numBands });
            }
            this.stampCounter += numBands;
            if (strokeData) strokeData.stampCounter = this.stampCounter;
            this.dirtyLayers.add(id);
            animator.forceRender();
            this.render(false);
            recordColorCycleFillPerf({
              path: 'gpu',
              mode: 'linear',
              durationMs: nowMs() - gpuStart,
              area: bbox.width * bbox.height,
              vertices: gpuVertices.length,
            });
            if (strokeData) {
              this.snapshotFromBuffers(strokeData);
            }
            return;
          }
          ccWarn('[ColorCycleBrush] Linear GPU fill returned empty result', {
            vertices: gpuVertices.length,
            bands: numBands,
            ditherStrength,
          });
        }
      }
    } catch {}

    const directLinearHandle = animator.beginDirectFill();
    if (logCcFill) {
      debugLog('cc-fill', '[CC fill] linear USED CPU', { bbox, bands: numBands });
    }
    if (ccGradient && typeof animator.setStrokeSpeedByte === 'function') {
      animator.setStrokeSpeedByte(speedByte);
    }
    if (activeSlot !== 0) {
      animator.markGradientSlotUsed(activeSlot);
    }
    const linearBuffer = directLinearHandle.data;
    const linearGradientId = directLinearHandle.gradientId;
    const linearSpeedData = directLinearHandle.speedData;
    const linearFlowData = directLinearHandle.flowData;
    if (strokeData) {
      strokeData.buffers.paint = linearBuffer;
      strokeData.buffers.gid = linearGradientId;
      strokeData.buffers.spd = linearSpeedData;
      strokeData.buffers.flow = linearFlowData;
    }
    const linearBufferWidth = directLinearHandle.width;
    const linearBufferHeight = directLinearHandle.height;
    const writeLinearIndex = (x: number, y: number, colorIndex: number) => {
      if (x < 0 || y < 0 || x >= linearBufferWidth || y >= linearBufferHeight) {
        return;
      }
      const clamped = Math.max(0, Math.min(255, colorIndex | 0));
      const idx = y * linearBufferWidth + x;
      linearBuffer[idx] = clamped;
      linearGradientId[idx] = clamped === 0 ? 0 : flowSlot;
      linearSpeedData[idx] = clamped === 0 ? 0 : speedByte;
      linearFlowData[idx] = clamped === 0 ? 0 : flowByte;
      const localX = x - bbox.minX;
      const localY = y - bbox.minY;
      if (localX >= 0 && localY >= 0 && localX < bbox.width && localY < bbox.height) {
        if (clamped !== 0) writtenMask[localY * bbox.width + localX] = 255;
      }
    };

    try {
      const linearPerf = { start: nowMs(), logged: false };
      const logCpuLinear = () => {
        if (linearPerf.logged) {
          return;
        }
        linearPerf.logged = true;
        recordColorCycleFillPerf({
          path: 'cpu',
          mode: 'linear',
          durationMs: nowMs() - linearPerf.start,
          area: bbox.width * bbox.height,
          vertices: vertices.length,
        });
      };

      const fillAlgorithm = this.stampDitherAlgorithm ?? 'sierra-lite';
      const fillPatternStyle = this.stampDitherPatternStyle ?? 'dots';
      if (ccGradient && this.ditherEnabled) {
        const pairBandCount = Math.max(0, Math.floor(options?.ditherPairBandCount ?? 0));
        const quantLevels = ditherLevels ?? (pairBandCount > 0 ? Math.max(2, numBands) : 1);
        const pixelSize = Math.max(1, Math.floor(options?.ditherPixelSize ?? this.ditherPixelSize));
        const flatPairSpread = options?.ditherPaletteSpread ?? useAppStore.getState().tools.brushSettings.ditherPaletteSpread;
        const activeSession = getActiveMarkGradientSession(id);
        const sampledStopsOverride = options?.ditherSampledStops?.length ? options.ditherSampledStops : null;
        const paintSlot = useAppStore.getState().layers.find((layer) => layer.id === id)?.colorCycleData?.paintSlot ?? null;
        const modeChosen =
          pairBandCount <= 0 && fillAlgorithm === 'sierra-lite'
            ? 'flat-sierra'
            : 'banded';
        const flatSeed = hashNumbers(
          strokeData?.stampCounter ?? this.stampCounter,
          bbox.minX,
          bbox.minY,
          bbox.width,
          bbox.height,
          baseOffset
        );
        ccLog('shape fill linear preview dither', {
          markId: activeSession?.markId ?? null,
          layerId: id,
          source: sampledStopsOverride ? 'sampled-override' : (activeSession?.source ?? null),
          previewStopsLen: activeSession?.previewStopsStored?.length ?? 0,
          previewStops: summarizeCcDebugStops(activeSession?.previewStopsStored),
          sampledStopsOverrideLen: sampledStopsOverride?.length ?? 0,
          sampledStopsOverride: summarizeStoredStopsForDebug(sampledStopsOverride),
          pairBandCount,
          spread: flatPairSpread ?? null,
          algorithm: fillAlgorithm,
          baseOffset,
          ditherBaseOffsetOverride: options?.ditherBaseOffsetOverride ?? null,
          paintSlotOverride: options?.paintSlotOverride ?? null,
          paintSlot,
          activeSlot,
          modeChosen,
        });
        await fillCcGradientDither({
          vertices,
          minX: fillMinX,
          minY: fillMinY,
          maxX: fillMaxX,
          maxY: fillMaxY,
          pixelSize,
          levels: quantLevels,
          pairBandCount,
          baseOffset,
          flatPairSpread,
          flatSeed,
          algorithm: fillAlgorithm,
          patternStyle: fillPatternStyle,
          sampledStopsOverride: sampledStopsOverride ?? undefined,
          fillBackground: options?.ditherBackgroundFill !== false,
          pxlEdge: this.pxlEdgeEnabled,
          sampleNormalized: (x, y) => {
            const proj = (x - centerX) * dirX + (y - centerY) * dirY;
            return clamp01((proj - paddedMinProjection) / safeProjectionRange);
          },
          writeIndex: (x, y, index) => {
            writeLinearIndex(x, y, index);
          },
          logSetIndexSample: (x, y) => {
            this.logSetIndexSample(id, x, y);
          },
          yieldIfNeeded,
        });

            if (lostEdge > 0) {
              this.applyLostEdgeFromWrittenMask({
                writtenMask,
                prevIdx,
                prevGid,
                prevSpd,
                prevFlow,
                paint: linearBuffer,
                gid: linearGradientId,
                spd: linearSpeedData,
                flow: linearFlowData,
                fullW: linearBufferWidth,
                bbox,
                lostEdge,
              });
            }

        this.stampCounter += quantLevels;
        if (strokeData) strokeData.stampCounter = this.stampCounter;
        this.dirtyLayers.add(id);
        animator.markDirtyBounds(bbox);
        animator.forceRender();
        this.render(false);
        if (strokeData) {
          this.snapshotFromBuffers(strokeData);
        }
        logCpuLinear();
        return;
      }

    // If using perceptual dithering, optionally offload dithering/mapping to worker
    if (this.ditherEnabled && (this.perceptualDither || (ccGradient && fillAlgorithm !== 'sierra-lite'))) {
      try {
        const width = Math.max(1, Math.ceil(maxX) - Math.floor(minX) + 1);
        const height = Math.max(1, Math.ceil(maxY) - Math.floor(minY) + 1);
        const img = new ImageData(width, height);
        const data = img.data;
        const x0 = Math.floor(minX);
        const y0 = Math.floor(minY);

        const spans: Array<Array<[number, number]>> = [];
        for (let y = y0; y <= Math.ceil(maxY); y++) {
          await yieldIfNeeded(y - y0);
          const ints: number[] = [];
          for (let i = 0; i < vertices.length; i++) {
            const v1 = vertices[i];
            const v2 = vertices[(i + 1) % vertices.length];
            if (Math.abs(v2.y - v1.y) < 1e-4) continue;
            if ((v1.y <= y && v2.y > y) || (v2.y <= y && v1.y > y)) {
              const t = (y - v1.y) / (v2.y - v1.y);
              const x = v1.x + t * (v2.x - v1.x);
              ints.push(x);
            }
          }
          ints.sort((a, b) => a - b);
          const row: [number, number][] = [];
          for (let i = 0; i < ints.length - 1; i += 2) {
            const startX = Math.floor(ints[i]);
            const endX = this.pxlEdgeEnabled
              ? Math.ceil(ints[i + 1]) - 1
              : Math.ceil(ints[i + 1]);
            if (endX >= startX) {
              row.push([startX, endX]);
            }
          }
          spans.push(row);
        }

        const dirLength = Math.sqrt(direction.x * direction.x + direction.y * direction.y) || 1;
        const dirX = direction.x / dirLength;
        const dirY = direction.y / dirLength;
        const centerX = (minX + maxX) / 2; const centerY = (minY + maxY) / 2;
        let minProj = Infinity, maxProj = -Infinity;
        for (const v of vertices) {
          const dx = v.x - centerX; const dy = v.y - centerY;
          const p = dx * dirX + dy * dirY; if (p < minProj) minProj = p; if (p > maxProj) maxProj = p;
        }
        const projPadding = 0.5 * (Math.abs(dirX) + Math.abs(dirY));
        const paddedMinProj = minProj - projPadding;
        const paddedMaxProj = maxProj + projPadding;
        const projRange = Math.max(1e-6, paddedMaxProj - paddedMinProj);

        const useBlockQuantization = this.ditherEnabled && Math.max(1, this.ditherPixelSize) > 1;
        const blockSize = Math.max(1, this.ditherPixelSize);
        const quantizeSample = (value: number, base: number, extent: number) => {
          if (!useBlockQuantization || blockSize <= 1) return value + 0.5;
          const rel = value - base;
          const snapped = base + Math.floor(rel / blockSize) * blockSize + blockSize * 0.5;
          const limit = base + extent - 0.5;
          return Math.min(limit, Math.max(base, snapped));
        };

        for (let yy = 0; yy < height; yy++) {
          await yieldIfNeeded(yy);
          const y = y0 + yy;
          const rowSpans = spans[yy] || [];
          for (const [sx, ex] of rowSpans) {
            for (let x = sx; x <= ex; x++) {
              const xx = x - x0; if (xx < 0 || xx >= width) continue;
              const sampleX = quantizeSample(x, x0, width);
              const sampleY = quantizeSample(y, y0, height);
              const dx = sampleX - centerX; const dy = sampleY - centerY;
              const proj = dx * dirX + dy * dirY;
              const r = applyEdgePadding((proj - paddedMinProj) / Math.max(projRange, 1e-6));
              const { r: R, g: G, b: B } = this.colorAtPosition(r);
              const idx = (yy * width + xx) * 4;
              data[idx] = R; data[idx + 1] = G; data[idx + 2] = B; data[idx + 3] = 255;
            }
          }
        }

        const quantLevels = ditherLevels ?? numBands;
        const { css: paletteCss, mapRgbToIndex } = this.buildQuantizedGradientPalette(quantLevels);
        const paletteEntries = paletteEntriesFromMap(mapRgbToIndex);
        const workerEligible =
          this.performanceOptions.useWebWorkers &&
          this.performanceOptions.usePerceptualDitherWorker &&
          paletteEntries.length > 0 &&
          shouldUseFillWorker(width, height);
        if (workerEligible) {
          const pixelBuffer = new Uint8ClampedArray(img.data);
          try {
            const workerResult = await runPerceptualDitherJob({
              type: 'perceptual-dither',
              mode: 'linear',
              width,
              height,
              baseOffset,
              quantLevels,
              ditherPixelSize: Math.max(1, this.ditherPixelSize),
              paletteCss,
              paletteMapEntries: paletteEntries,
              pixels: pixelBuffer.buffer,
            });
            const indicesArray = new Uint8Array(workerResult.indices);
            for (let yy = 0; yy < height; yy++) {
              await yieldIfNeeded(yy);
              const y = y0 + yy;
              const rowSpans = spans[yy] || [];
              const rowBase = yy * width;
              for (const [sx, ex] of rowSpans) {
                for (let x = sx; x <= ex; x++) {
                  const xx = x - x0;
                  if (xx < 0 || xx >= width) continue;
                  const colorIndex = indicesArray[rowBase + xx];
                  if (colorIndex > 0) {
                    this.logSetIndexSample(id, x, y);
                    writeLinearIndex(x, y, colorIndex);
                  }
                }
              }
            }
            if (lostEdge > 0) {
          this.applyLostEdgeFromWrittenMask({
            writtenMask,
            prevIdx,
            prevGid,
            prevSpd,
            prevFlow,
            paint: linearBuffer,
            gid: linearGradientId,
            spd: linearSpeedData,
            flow: linearFlowData,
            fullW: linearBufferWidth,
            bbox,
            lostEdge,
          });
            }
            this.stampCounter += quantLevels;
            if (strokeData) strokeData.stampCounter = this.stampCounter;
            this.dirtyLayers.add(id);
            animator.forceRender();
            this.render(false);
            if (strokeData) {
              this.snapshotFromBuffers(strokeData);
            }
            logCpuLinear();
            return;
          } catch (error) {
            console.warn('[ColorCycleBrushCanvas2D] Worker perceptual fill failed; falling back to main thread.', error);
          }
        }

        const dithered: ImageData = fillLinear(img, {
          levels: quantLevels,
          pixelSize: Math.max(1, this.ditherPixelSize),
          algorithm: fillAlgorithm,
          patternStyle: fillPatternStyle,
          perceptual: true,
          customPalette: paletteCss,
        });
        const out = dithered.data;
        for (let yy = 0; yy < height; yy++) {
          await yieldIfNeeded(yy);
          const y = y0 + yy;
          const rowSpans = spans[yy] || [];
          for (const [sx, ex] of rowSpans) {
            for (let x = sx; x <= ex; x++) {
              const xx = x - x0; if (xx < 0 || xx >= width) continue;
              const p = (yy * width + xx) * 4;
              const key = `${out[p]},${out[p + 1]},${out[p + 2]}`;
              const gi = mapRgbToIndex.get(key);
              if (gi !== undefined) {
                this.logSetIndexSample(id, x, y);
                writeLinearIndex(x, y, gi);
              }
            }
          }
        }

        if (lostEdge > 0) {
          this.applyLostEdgeFromWrittenMask({
            writtenMask,
            prevIdx,
            prevGid,
            prevSpd,
            prevFlow,
            paint: linearBuffer,
            gid: linearGradientId,
            spd: linearSpeedData,
            flow: linearFlowData,
            fullW: linearBufferWidth,
            bbox,
            lostEdge,
          });
        }
        this.stampCounter += quantLevels;
        if (strokeData) strokeData.stampCounter = this.stampCounter;
        this.dirtyLayers.add(id);
        animator.forceRender();
        this.render(false);
        if (strokeData) {
          this.snapshotFromBuffers(strokeData);
        }
        logCpuLinear();
        return;
      } catch {
        // Fallback to existing path on any failure
      }
    }

    // Scanline fill with linear gradient + optional Sierra Lite dithering
    // Hoist invariants out of inner loops
    const bands = numBands;

    // BBox metrics and error buffers
    const bboxW = Math.max(1, Math.ceil(maxX) - Math.floor(minX) + 1);
    const bboxH = Math.max(1, Math.ceil(maxY) - Math.floor(minY) + 1);
    const ixBase = Math.floor(minX);
    const iyBase = Math.floor(minY);
    let errCurr = new Float32Array(bboxW);
    let errNext = new Float32Array(bboxW);

    // Deterministic threshold jitter to avoid patterns
    const noiseAt = (x: number, y: number): number => {
      let n = (x | 0) * 374761393 + (y | 0) * 668265263;
      n = (n ^ (n >>> 13)) * 1274126177;
      n = (n ^ (n >>> 16)) >>> 0;
      return (n & 0xffff) / 65536;
    };
    const thresholdJitter = 0.2; // +/-10% around 0.5
    const cellSize = Math.max(1, this.ditherEnabled ? this.ditherPixelSize : 1);
    const cellsAcross = Math.max(1, Math.ceil(bboxW / cellSize));
    const cellsDown = Math.max(1, Math.ceil(bboxH / cellSize));
    let cErrCurr = new Float32Array(cellsAcross);
    let cErrNext = new Float32Array(cellsAcross);
    // Cache per-cell output index so each cell uses one decision across its full height
    const cellOutIdx: Int16Array[] = Array.from({ length: cellsDown }, () => new Int16Array(cellsAcross).fill(-1));

    for (let y = Math.floor(minY), rowIdx = 0; y <= Math.ceil(maxY); y++, rowIdx++) {
      await yieldIfNeeded(rowIdx);
      // swap rows and clear next row accumulator (per-pixel dithering path)
      const _t = errCurr; errCurr = errNext; errNext = _t; errNext.fill(0);

      // For block dithering, only advance cell-error buffers when entering a new y-cell
      const inBlockMode = this.ditherEnabled && cellSize > 1;
      const isFirstRowOfCell = inBlockMode ? (rowIdx % cellSize) === 0 : false;
      if (inBlockMode && isFirstRowOfCell) {
        const _tc = cErrCurr; cErrCurr = cErrNext; cErrNext = _tc; cErrNext.fill(0);
      } else if (!inBlockMode) {
        // In per-pixel mode, keep previous behavior (advance each row)
        const _tc = cErrCurr; cErrCurr = cErrNext; cErrNext = _tc; cErrNext.fill(0);
      }

      const serpentine = (rowIdx & 1) === 1; // per-pixel path serpentine
      const serpentineCell = ((Math.floor(rowIdx / Math.max(1, cellSize)) & 1) === 1); // block path serpentine
      const intersections: number[] = [];
      
      // Find all edge intersections with this scanline
      for (let i = 0; i < vertices.length; i++) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % vertices.length];
        
        if (Math.abs(v2.y - v1.y) < 0.0001) continue;
        
        if ((v1.y <= y && v2.y > y) || (v2.y <= y && v1.y > y)) {
          const t = (y - v1.y) / (v2.y - v1.y);
          const x = v1.x + t * (v2.x - v1.x);
          intersections.push(x);
        }
      }
      
      intersections.sort((a, b) => a - b);
      
      // Fill between pairs of intersections
      for (let i = 0; i < intersections.length - 1; i += 2) {
        const startFloat = intersections[i];
        const endFloat = intersections[i + 1];
        if (endFloat <= startFloat) continue;

        const startX = Math.floor(startFloat);
        const endX = this.pxlEdgeEnabled
          ? Math.ceil(endFloat) - 1
          : Math.ceil(endFloat);
        if (endX < startX) {
          continue;
        }

        const quantizeCoord = (value: number, base: number, limit: number) => {
          const local = value - base;
          const snapped = base + Math.floor(local / cellSize) * cellSize + cellSize * 0.5;
          return Math.min(limit, Math.max(base, snapped));
        };

        const evaluateNormalized = (rawX: number, rawY: number, quantize: boolean) => {
          const px = quantize && cellSize > 1 ? quantizeCoord(rawX, ixBase, maxX) : rawX;
          const py = quantize && cellSize > 1 ? quantizeCoord(rawY, iyBase, maxY) : rawY;
      const proj = (px - centerX) * dirX + (py - centerY) * dirY;
      return clamp01((proj - paddedMinProjection) / safeProjectionRange);
    };

        if (this.ditherEnabled && cellSize > 1) {
          // Block-based Sierra Lite dithering with crisp edge clipping
          const xStartCell = Math.floor((startX - ixBase) / cellSize);
          const xEndCell = Math.floor((endX - ixBase) / cellSize);
          const cy = Math.floor((y - iyBase) / cellSize);

          const processCell = (cx: number) => {
            // If this cell already has a decision, reuse it for square pixels
            let cached = cellOutIdx[cy][cx];
            if (cached < 0) {
              const xBlock = ixBase + cx * cellSize;
              const xCenter = Math.min(endX, xBlock + Math.floor(cellSize / 2));
              const yCenterBlock = Math.min(Math.ceil(maxY), iyBase + cy * cellSize + Math.floor(cellSize / 2));

              // Projection at block center (quantized)
              const rawSampleX = xCenter + 0.5;
              const rawSampleY = yCenterBlock + 0.5;
              let r = evaluateNormalized(rawSampleX, rawSampleY, true);
              if (this.ditherEnabled) {
                const jitterScale = 0.35;
                const quantLevels = ditherLevels ?? Math.max(2, bands);
                const noiseSeedX = Math.floor(rawSampleX);
                const noiseSeedY = Math.floor(rawSampleY);
                const j = (noiseAt(noiseSeedX, noiseSeedY) - 0.5) * (jitterScale / quantLevels);
                r = clamp01(r + j);
              }

              const quantLevels = ditherLevels ?? Math.max(2, bands);
              const denom = Math.max(1, quantLevels - 1);
              const qStep = 1 / denom;
              const scaled = r * denom;
              const kLower = Math.min(quantLevels - 1, Math.floor(scaled));
              const lowerPos = kLower * qStep;
              const upperPos = Math.min(1, (kLower + 1) * qStep);
              const frac = Math.max(0, Math.min(1, scaled - kLower));
              const adj = frac + (cErrCurr[cx] || 0);
              const thr = 0.5 + (noiseAt(Math.floor(rawSampleX), Math.floor(rawSampleY)) - 0.5) * thresholdJitter;
              const chooseUpper = (kLower < quantLevels - 1) && (adj >= thr);
              const q = chooseUpper ? 1 : 0;
              const err = (frac - q) * this.ditherStrength;
              if (!serpentineCell) {
                if (cx + 1 < cellsAcross) cErrCurr[cx + 1] += err * 0.5;
                if (cx - 1 >= 0) cErrNext[cx - 1] += err * 0.25;
              } else {
                if (cx - 1 >= 0) cErrCurr[cx - 1] += err * 0.5;
                if (cx + 1 < cellsAcross) cErrNext[cx + 1] += err * 0.25;
              }
              cErrNext[cx] += err * 0.25;
              cached = chooseUpper ? indexFromNormalized(upperPos) : indexFromNormalized(lowerPos);
              cellOutIdx[cy][cx] = cached;
            }

            // Fill the block clipped to the current span for this row
            const xBlock = ixBase + cx * cellSize;
            const xTo = Math.min(endX, xBlock + cellSize - 1);
            const fillStart = Math.max(startX, xBlock);
            if (fillStart <= xTo) {
              for (let xx = fillStart; xx <= xTo; xx++) {
                this.logSetIndexSample(id, xx, y);
                writeLinearIndex(xx, y, cached);
              }
              }
            };

          if (!serpentineCell) {
            for (let cx = xStartCell; cx <= xEndCell; cx++) processCell(cx);
          } else {
            for (let cx = xEndCell; cx >= xStartCell; cx--) processCell(cx);
          }
        } else if (this.ditherEnabled) {
          // Per-pixel Sierra Lite dithering with serpentine scanning
          const quantLevels = ditherLevels ?? Math.max(2, bands);
          const denom = Math.max(1, quantLevels - 1);
          const qStep = 1 / denom;

          if (!serpentine) {
            for (let x = startX; x <= endX; x++) {
              let r = evaluateNormalized(x + 0.5, y + 0.5, false);
              if (this.ditherEnabled) {
                const jitterScale = 0.35;
                const quantLevels = ditherLevels ?? Math.max(2, bands);
                const j = (noiseAt(x, y) - 0.5) * (jitterScale / quantLevels);
                r = clamp01(r + j);
              }
              const scaled = r * denom;
              const kLower = Math.min(quantLevels - 1, Math.floor(scaled));
              const lowerPos = kLower * qStep;
              const upperPos = Math.min(1, (kLower + 1) * qStep);
              const frac = Math.max(0, Math.min(1, scaled - kLower));
              const ix = x - ixBase;
              const adj = frac + (errCurr[ix] || 0);
              const thr = 0.5 + (noiseAt(x, y) - 0.5) * thresholdJitter;
              const chooseUpper = (kLower < quantLevels - 1) && (adj >= thr);
              const q = chooseUpper ? 1 : 0;
              const err = (frac - q) * this.ditherStrength;
              if (ix + 1 < bboxW) errCurr[ix + 1] += err * 0.5;
              if (ix - 1 >= 0) errNext[ix - 1] += err * 0.25;
              errNext[ix] += err * 0.25;
              const outIdx = chooseUpper ? indexFromNormalized(upperPos) : indexFromNormalized(lowerPos);
              this.logSetIndexSample(id, x, y);
              writeLinearIndex(x, y, outIdx);
            }
          } else {
            for (let x = endX; x >= startX; x--) {
              let r = evaluateNormalized(x + 0.5, y + 0.5, false);
              if (this.ditherEnabled) {
                const jitterScale = 0.35;
                const quantLevels = ditherLevels ?? Math.max(2, bands);
                const j = (noiseAt(x, y) - 0.5) * (jitterScale / quantLevels);
                r = clamp01(r + j);
              }
              const scaled = r * denom;
              const kLower = Math.min(quantLevels - 1, Math.floor(scaled));
              const lowerPos = kLower * qStep;
              const upperPos = Math.min(1, (kLower + 1) * qStep);
              const frac = Math.max(0, Math.min(1, scaled - kLower));
              const ix = x - ixBase;
              const adj = frac + (errCurr[ix] || 0);
              const thr = 0.5 + (noiseAt(x, y) - 0.5) * thresholdJitter;
              const chooseUpper = (kLower < quantLevels - 1) && (adj >= thr);
              const q = chooseUpper ? 1 : 0;
              const err = (frac - q) * this.ditherStrength;
              if (ix - 1 >= 0) errCurr[ix - 1] += err * 0.5;
              if (ix + 1 < bboxW) errNext[ix + 1] += err * 0.25;
              errNext[ix] += err * 0.25;
              const outIdx = chooseUpper ? indexFromNormalized(upperPos) : indexFromNormalized(lowerPos);
              this.logSetIndexSample(id, x, y);
              writeLinearIndex(x, y, outIdx);
            }
          }
        } else if (continuous) {
          for (let x = startX; x <= endX; x++) {
            const r = evaluateNormalized(x + 0.5, y + 0.5, false);
            const outIdx = indexFromNormalized(r);
            this.logSetIndexSample(id, x, y);
            writeLinearIndex(x, y, outIdx);
          }
        } else {
          // No dithering: banded quantization anchored to gradient ends
          // Respect gradientBands so the UI "Bands" slider affects linear fills.
          const quantLevels = Math.max(2, bands);
          const denom = Math.max(1, quantLevels - 1);
          for (let x = startX; x <= endX; x++) {
            const r = evaluateNormalized(x + 0.5, y + 0.5, false);
            const scaled = r * denom;
            const k = Math.min(quantLevels - 1, Math.floor(scaled)); // ensure exactly quantLevels unique bands
            const pos = k / denom; // 0..1 range including endpoints
            const outIdx = indexFromNormalized(pos);
            this.logSetIndexSample(id, x, y);
            writeLinearIndex(x, y, outIdx);
          }
        }
      }
    }
    
    if (lostEdge > 0) {
      this.applyLostEdgeFromWrittenMask({
        writtenMask,
        prevIdx,
        prevGid,
        prevSpd,
        prevFlow,
        paint: linearBuffer,
        gid: linearGradientId,
        spd: linearSpeedData,
        flow: linearFlowData,
        fullW: linearBufferWidth,
        bbox,
        lostEdge,
      });
    }

    // Increment stamp counter for next shape
    this.stampCounter += numBands;
    if (strokeData) {
      strokeData.stampCounter = this.stampCounter;
    }
    
    // Mark layer as dirty for rendering
    this.dirtyLayers.add(id);
    animator.markDirtyBounds(bbox);
    
    // Force immediate render
    animator.forceRender();
    this.render(false);
    if (strokeData) {
      this.snapshotFromBuffers(strokeData);
    }
    if (ccDebugOn()) {
      try {
        const sampleX = Math.floor((bbox.minX + bbox.minX + bbox.width - 1) / 2);
        const sampleY = Math.floor((bbox.minY + bbox.minY + bbox.height - 1) / 2);
        const p = Math.max(0, Math.min(this.width * this.height - 1, sampleY * this.width + sampleX));
        const buffers = strokeData?.buffers;
        ccLog('shape fill sample', {
          cx: sampleX,
          cy: sampleY,
          p,
          idx: buffers?.paint?.[p],
          gid: buffers?.gid?.[p],
          activeSlot,
        });
      } catch {}
    }
    logCpuLinear();
    } finally {
      animator.endDirectFill();
    }
  }

  
  /**
   * Fill shape with smooth gradient bands from edge to center (concentric)
   */
  async fillShape(
    vertices: Array<{ x: number; y: number }>,
    layerId: string,
    spacing?: number,
    options?: FillOptions
  ) {
    if (!layerId) {
      throw new Error('fillShape requires a layerId');
    }

    // Validate input
    if (!vertices || !Array.isArray(vertices)) {
      console.warn('Invalid vertices provided to fillShape');
      return;
    }
    
    if (vertices.length < 3) {
      console.warn('fillShape requires at least 3 vertices');
      return;
    }
    
    const id = layerId;
    const yieldIfNeeded = createYieldController();
    
    // Initialize stroke data BEFORE getting animator
    if (!this.layerStrokes.has(id)) {
      this.layerStrokes.set(id, this.createLayerStrokeState({ hasContent: true }));
    }
    
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.hasContent = true;
      strokeData.skipStampDitherFinalize = true;
      // Ensure full-size buffer
      if (strokeData.buffers.paint.length === 0) {
        strokeData.buffers.paint = new Uint8Array(this.width * this.height);
      }
      if (strokeData.buffers.gid.length === 0) {
        strokeData.buffers.gid = new Uint8Array(this.width * this.height);
      }
      if (strokeData.buffers.spd.length === 0) {
        strokeData.buffers.spd = new Uint8Array(this.width * this.height);
      }
      if (strokeData.buffers.def.length === 0) {
        strokeData.buffers.def = new Uint16Array(this.width * this.height);
      }
    }
    
    const activeSlot = strokeData?.flow.activeSlot ?? this.activeGradientSlots.get(id) ?? 0;
    if (strokeData) {
      strokeData.flow.activeSlot = activeSlot;
      strokeData.flow.mode = this.flowMode;
      strokeData.flow.encoded = true;
    }
    const flowSlot = this.resolveFlowSlot(strokeData, activeSlot);
    const logCcFill = isDebugEnabled('cc-fill');
    if (logCcFill) {
      debugLog('cc-fill', '[CC fill] uses slot', {
        layerId: id,
        activeSlot,
        flowSlot,
        encoded: strokeData?.flow?.encoded,
      });
    }

    const animator = this.ensureFullResolution(id, 'fill');
    
    // Find bounds with proper initialization
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (const v of vertices) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    
    // Clamp to canvas bounds
    minX = Math.max(0, Math.floor(minX));
    maxX = Math.min(this.width - 1, Math.ceil(maxX));
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(this.height - 1, Math.ceil(maxY));

    const fullMinX = minX;
    const fullMaxX = maxX;
    const fullMinY = minY;
    const fullMaxY = maxY;

    let fillMinX = fullMinX;
    let fillMaxX = fullMaxX;
    let fillMinY = fullMinY;
    let fillMaxY = fullMaxY;
    if (options?.roi) {
      const roiMinX = Math.floor(options.roi.x);
      const roiMinY = Math.floor(options.roi.y);
      const roiMaxX = Math.ceil(options.roi.x + options.roi.width - 1);
      const roiMaxY = Math.ceil(options.roi.y + options.roi.height - 1);
      fillMinX = Math.max(fillMinX, roiMinX);
      fillMinY = Math.max(fillMinY, roiMinY);
      fillMaxX = Math.min(fillMaxX, roiMaxX);
      fillMaxY = Math.min(fillMaxY, roiMaxY);
      if (fillMinX > fillMaxX || fillMinY > fillMaxY) {
        return;
      }
    }
    
    // Use scanline fill with inline gradient calculation - simpler and more reliable
    // gradientBands represents number of color divisions
    // bandSpacing (or passed spacing) represents pixel distance between bands
    const noiseSeed = (this.stampCounter & 0xffff) / 65535;

    // Adaptive performance: for very large shapes, skip costly per-edge distance checks
    // and approximate distance using only span boundaries (left/right). This reduces
    // complexity from O(pixels * edges) to roughly O(pixels).
    const fullBboxWidth = Math.max(0, Math.ceil(fullMaxX) - Math.floor(fullMinX) + 1);
    const fullBboxHeight = Math.max(0, Math.ceil(fullMaxY) - Math.floor(fullMinY) + 1);
    const fullBBox = {
      minX: Math.floor(fullMinX),
      minY: Math.floor(fullMinY),
      width: Math.max(1, fullBboxWidth),
      height: Math.max(1, fullBboxHeight),
    };
    const bboxWidth = Math.max(0, Math.ceil(fillMaxX) - Math.floor(fillMinX) + 1);
    const bboxHeight = Math.max(0, Math.ceil(fillMaxY) - Math.floor(fillMinY) + 1);
    const bbox = {
      minX: Math.floor(fillMinX),
      minY: Math.floor(fillMinY),
      width: Math.max(1, bboxWidth),
      height: Math.max(1, bboxHeight),
    };
    const prevIdx = this.captureRegionU8(strokeData?.buffers.paint ?? new Uint8Array(0), this.width, bbox);
    const prevGid = strokeData?.buffers.gid
      ? this.captureRegionU8(strokeData.buffers.gid, this.width, bbox)
      : new Uint8Array(bbox.width * bbox.height);
    const prevSpd = strokeData?.buffers.spd
      ? this.captureRegionU8(strokeData.buffers.spd, this.width, bbox)
      : new Uint8Array(bbox.width * bbox.height);
    const prevFlow = strokeData?.buffers.flow
      ? this.captureRegionU8(strokeData.buffers.flow, this.width, bbox)
      : new Uint8Array(bbox.width * bbox.height);
    const writtenMask = new Uint8Array(bbox.width * bbox.height);
    // Hoist invariants
    const spacingValue = this.normalizeBandSpacingValue(spacing);
    const maxDist = computeConcentricMaxDistance(vertices, fullBBox);
    const ccGradient = options?.ccGradient === true;
    const lostEdge = Number.isFinite(options?.lostEdge)
      ? Math.max(0, Math.min(100, Math.round(options?.lostEdge as number)))
      : 0;
    const ditherLevels = Number.isFinite(options?.ditherLevels)
      ? Math.max(1, Math.min(254, Math.floor(options?.ditherLevels as number)))
      : null;
    const baseOffset = this.stampCounter % 255;
    const numBands = this.deriveBandCountFromDistance(maxDist, spacingValue);
    const stepPerBand = numBands > 1 ? 254 / (numBands - 1) : 254;
    const { speedByte, flowByte } = this.resolveShapeAnimationBytes(strokeData, { ccGradient });

    // Attempt GPU path first so most shapes stay off the CPU.
    if (!this.perceptualDither) {
      try {
        const hasGL = animator.hasWebGL();
        const tryGPU = hasGL && lostEdge <= 0;
        const ditherStrengthGpu = this.ditherEnabled ? this.ditherStrength : 0;
        const ditherPixelSizeGpu = this.ditherEnabled ? Math.max(1, this.ditherPixelSize) : 1;
        const runtimeMax = animator.getGLFillMaxVerts() || 256;
        const GPU_MAX_VERTS = Math.max(8, Math.min(256, runtimeMax));
        let gpuVertices = vertices;
        if (tryGPU && vertices.length > GPU_MAX_VERTS) {
          const simplified = simplifyToVertexLimit(vertices, GPU_MAX_VERTS, {
            initialTolerance: 0.25,
            maxTolerance: 10,
            stepFactor: 1.45,
          });
          if (simplified.length <= GPU_MAX_VERTS) {
            gpuVertices = simplified;
          } else {
            ccWarn('[ColorCycleBrush] Concentric GPU fallback (vertex budget)', {
              original: vertices.length,
              simplified: simplified.length,
              limit: GPU_MAX_VERTS,
            });
          }
        }
        if (tryGPU && gpuVertices.length <= GPU_MAX_VERTS) {
          try {
            const gpuStart = nowMs();
            const ok = animator.gpuFillShape(gpuVertices, {
              mode: 'concentric',
              bands: numBands,
              baseOffset,
              colorStep: stepPerBand,
              maxDist,
              bbox,
              ditherStrength: ditherStrengthGpu,
              ditherPixelSize: ditherPixelSizeGpu,
              noiseSeed,
        }, flowSlot, speedByte, flowByte);
        if (ok) {
          this.stampCounter += numBands;
          if (strokeData) strokeData.stampCounter = this.stampCounter;
          this.dirtyLayers.add(id);
          animator.forceRender();
          this.render(false);
          recordColorCycleFillPerf({
            path: 'gpu',
            mode: 'concentric',
            durationMs: nowMs() - gpuStart,
            area: bbox.width * bbox.height,
            vertices: gpuVertices.length,
          });
          if (strokeData) {
            this.snapshotFromBuffers(strokeData);
          }
          return;
        }
          } catch (error) {
            ccWarn('[ColorCycleBrush] Concentric GPU path threw; falling back to CPU', error);
          }
        }
      } catch (error) {
        ccWarn('[ColorCycleBrush] Concentric GPU setup failed; falling back to CPU', error);
      }
    }

    const concentricPerf = { start: nowMs(), logged: false };
    const logConcentricFill = (path: 'cpu' | 'worker') => {
      if (concentricPerf.logged) return;
      concentricPerf.logged = true;
      recordColorCycleFillPerf({
        path,
        mode: 'concentric',
        durationMs: nowMs() - concentricPerf.start,
        area: bbox.width * bbox.height,
        vertices: vertices.length,
      });
    };

    const directConcentricHandle = animator.beginDirectFill();
    if (ccGradient && typeof animator.setStrokeSpeedByte === 'function') {
      animator.setStrokeSpeedByte(speedByte);
    }
    if (activeSlot !== 0) {
      animator.markGradientSlotUsed(activeSlot);
    }
    const concentricBuffer = directConcentricHandle.data;
    const concentricGradientId = directConcentricHandle.gradientId;
    const concentricSpeedData = directConcentricHandle.speedData;
    const concentricFlowData = directConcentricHandle.flowData;
    if (strokeData) {
      strokeData.buffers.paint = concentricBuffer;
      strokeData.buffers.gid = concentricGradientId;
      strokeData.buffers.spd = concentricSpeedData;
      strokeData.buffers.flow = concentricFlowData;
    }
    const concentricWidth = directConcentricHandle.width;
    const concentricHeight = directConcentricHandle.height;
    const writeConcentricIndex = (x: number, y: number, colorIndex: number) => {
      if (x < 0 || y < 0 || x >= concentricWidth || y >= concentricHeight) {
        return;
      }
      const clamped = Math.max(0, Math.min(255, colorIndex | 0));
      const idx = y * concentricWidth + x;
      concentricBuffer[idx] = clamped;
      concentricGradientId[idx] = clamped === 0 ? 0 : flowSlot;
      concentricSpeedData[idx] = clamped === 0 ? 0 : speedByte;
      concentricFlowData[idx] = clamped === 0 ? 0 : flowByte;
      const localX = x - bbox.minX;
      const localY = y - bbox.minY;
      if (localX >= 0 && localY >= 0 && localX < bbox.width && localY < bbox.height) {
        if (clamped !== 0) writtenMask[localY * bbox.width + localX] = 255;
      }
    };
    const blitLocalBuffer = (local: Uint8Array) => {
      const bw = bbox.width;
      const bh = bbox.height;
      for (let row = 0; row < bh; row++) {
        const destY = bbox.minY + row;
        if (destY < 0 || destY >= concentricHeight) continue;
        const srcRowOffset = row * bw;
        const destRowOffset = destY * concentricWidth;
        for (let col = 0; col < bw; col++) {
          const value = local[srcRowOffset + col];
          if (value === 0) continue;
          const destX = bbox.minX + col;
          if (destX < 0 || destX >= concentricWidth) continue;
          const destIndex = destRowOffset + destX;
          concentricBuffer[destIndex] = value;
          concentricGradientId[destIndex] = value === 0 ? 0 : flowSlot;
          concentricSpeedData[destIndex] = value === 0 ? 0 : speedByte;
          concentricFlowData[destIndex] = value === 0 ? 0 : flowByte;
          writtenMask[srcRowOffset + col] = 255;
        }
      }
    };
    const finalizeFill = (path: 'cpu' | 'worker', countOverride?: number) => {
      const count = countOverride ?? numBands;
      if (lostEdge > 0) {
        this.applyLostEdgeFromWrittenMask({
          writtenMask,
          prevIdx,
          prevGid,
          prevSpd,
          prevFlow,
          paint: concentricBuffer,
          gid: concentricGradientId,
          spd: concentricSpeedData,
          flow: concentricFlowData,
          fullW: concentricWidth,
          bbox,
          lostEdge,
        });
      }
      this.stampCounter += count;
      if (strokeData) strokeData.stampCounter = this.stampCounter;
      this.dirtyLayers.add(id);
      animator.markDirtyBounds(bbox);
      animator.forceRender();
      this.render(false);
      logConcentricFill(path);
    };

    try {
      const fillAlgorithm = this.stampDitherAlgorithm ?? 'sierra-lite';
      const fillPatternStyle = this.stampDitherPatternStyle ?? 'dots';
      if (ccGradient && this.ditherEnabled) {
        const pairBandCount = Math.max(0, Math.floor(options?.ditherPairBandCount ?? 0));
        const quantLevels = ditherLevels ?? (pairBandCount > 0 ? Math.max(2, numBands) : 1);
        const pixelSize = Math.max(1, Math.floor(options?.ditherPixelSize ?? this.ditherPixelSize));
        const flatPairSpread = options?.ditherPaletteSpread ?? useAppStore.getState().tools.brushSettings.ditherPaletteSpread;
        const flatSeed = hashNumbers(
          strokeData?.stampCounter ?? this.stampCounter,
          bbox.minX,
          bbox.minY,
          bbox.width,
          bbox.height,
          maxDist,
          baseOffset
        );
        const edges = new Array(vertices.length);
        for (let i = 0; i < vertices.length; i += 1) {
          const v1 = vertices[i];
          const v2 = vertices[(i + 1) % vertices.length];
          const dx = v2.x - v1.x;
          const dy = v2.y - v1.y;
          edges[i] = { v1x: v1.x, v1y: v1.y, dx, dy, len2: dx * dx + dy * dy };
        }
        const safeMaxDist = Math.max(1e-6, maxDist);
        await fillCcGradientDither({
          vertices,
          minX: bbox.minX,
          minY: bbox.minY,
          maxX: bbox.minX + bbox.width - 1,
          maxY: bbox.minY + bbox.height - 1,
          pixelSize,
          levels: quantLevels,
          pairBandCount,
          baseOffset,
          flatPairSpread,
          flatSeed,
          algorithm: fillAlgorithm,
          patternStyle: fillPatternStyle,
          fillBackground: options?.ditherBackgroundFill !== false,
          pxlEdge: this.pxlEdgeEnabled,
          sampleNormalized: (x, y) => {
            let minDistSq = Infinity;
            for (let k = 0; k < edges.length; k += 1) {
              const e = edges[k];
              if (e.len2 <= 0) continue;
              const tNum = (x - e.v1x) * e.dx + (y - e.v1y) * e.dy;
              const tVal = Math.max(0, Math.min(1, tNum / e.len2));
              const px = e.v1x + tVal * e.dx;
              const py = e.v1y + tVal * e.dy;
              const ddx = x - px;
              const ddy = y - py;
              const d2 = ddx * ddx + ddy * ddy;
              if (d2 < minDistSq) {
                minDistSq = d2;
              }
            }
            return Math.min(1, Math.sqrt(Math.max(0, minDistSq)) / safeMaxDist);
          },
          writeIndex: (x, y, index) => {
            this.logSetIndexSample(id, x, y);
            writeConcentricIndex(x, y, index);
          },
          yieldIfNeeded,
        });
        finalizeFill('cpu', quantLevels);
        if (strokeData) {
          this.snapshotFromBuffers(strokeData);
        }
        return;
      }

      // Perceptual dithering path for concentric fill
      if (this.ditherEnabled && (this.perceptualDither || (ccGradient && fillAlgorithm !== 'sierra-lite'))) {
        try {
          const id2 = layerId || this.activeLayerId || 'default';
          const animator2 = this.getAnimator(id2);
          const bbox2 = { minX: Math.floor(minX), minY: Math.floor(minY), width: Math.max(1, Math.ceil(maxX) - Math.floor(minX) + 1), height: Math.max(1, Math.ceil(maxY) - Math.floor(minY) + 1) };
          const width2 = bbox2.width;
          const height2 = bbox2.height;
          const img2 = new ImageData(width2, height2);
          const data2 = img2.data;
          const x02 = bbox2.minX;
          const y02 = bbox2.minY;

          // Precompute edges once
          const edges2 = new Array(vertices.length);
          for (let j = 0; j < vertices.length; j++) {
            const v1 = vertices[j];
            const v2 = vertices[(j + 1) % vertices.length];
            const dx = v2.x - v1.x;
            const dy = v2.y - v1.y;
            const len2 = dx * dx + dy * dy;
            edges2[j] = { v1x: v1.x, v1y: v1.y, dx, dy, len2 };
          }

          // Build row spans (scanline polygon fill)
          const spans2: Array<Array<[number, number]>> = [];
          for (let y = y02; y <= Math.ceil(maxY); y++) {
            await yieldIfNeeded(y - y02);
            const ints: number[] = [];
            for (let i = 0; i < vertices.length; i++) {
              const v1 = vertices[i];
              const v2 = vertices[(i + 1) % vertices.length];
              if (Math.abs(v2.y - v1.y) < 1e-4) continue;
              if ((v1.y <= y && v2.y > y) || (v2.y <= y && v1.y > y)) {
                const t = (y - v1.y) / (v2.y - v1.y);
                const x = v1.x + t * (v2.x - v1.x);
                ints.push(x);
              }
            }
            ints.sort((a, b) => a - b);
            const row: [number, number][] = [];
            for (let i = 0; i < ints.length - 1; i += 2) {
              const startX = Math.floor(ints[i]);
              const endX = this.pxlEdgeEnabled
                ? Math.ceil(ints[i + 1]) - 1
                : Math.ceil(ints[i + 1]);
              if (endX >= startX) {
                row.push([startX, endX]);
              }
            }
            spans2.push(row);
          }

          // Precompute distance parameters (edge to center bands)
          const maxDist2 = Math.max(1e-6, maxDist);

          const useBlockQuantization = this.ditherEnabled && Math.max(1, this.ditherPixelSize) > 1;
          const blockSize = Math.max(1, this.ditherPixelSize);
          const quantizeSample = (value: number, base: number, extent: number) => {
            if (!useBlockQuantization || blockSize <= 1) return value + 0.5;
            const rel = value - base;
            const snapped = base + Math.floor(rel / blockSize) * blockSize + blockSize * 0.5;
            const limit = base + extent - 0.5;
            return Math.min(limit, Math.max(base, snapped));
          };

          // Fill gradient colors into buffer using concentric distance
          for (let yy = 0; yy < height2; yy++) {
            await yieldIfNeeded(yy);
            const y = y02 + yy;
            const rowSpans = spans2[yy] || [];
            for (const [sx, ex] of rowSpans) {
              for (let x = sx; x <= ex; x++) {
                const xx = x - x02;
                if (xx < 0 || xx >= width2) continue;
                const sampleX = quantizeSample(x, x02, width2);
                const sampleY = quantizeSample(y, y02, height2);
                let minDistSq = Infinity;
                const left = sampleX - sx;
                const right = ex - sampleX;
                const dLR = Math.min(left * left, right * right);
                minDistSq = Math.min(minDistSq, dLR);
                for (let k = 0; k < edges2.length; k++) {
                  const e = edges2[k];
                  if (e.len2 <= 0) continue;
                  const tNum = (sampleX - e.v1x) * e.dx + (sampleY - e.v1y) * e.dy;
                  const tVal = Math.max(0, Math.min(1, tNum / e.len2));
                  const px = e.v1x + tVal * e.dx;
                  const py = e.v1y + tVal * e.dy;
                  const ddx = sampleX - px;
                  const ddy = sampleY - py;
                  const d2 = ddx * ddx + ddy * ddy;
                  if (d2 < minDistSq) {
                    minDistSq = d2;
                    if (minDistSq <= 1) break;
                  }
                }
                const r = Math.min(1, Math.sqrt(minDistSq) / maxDist2);
                const { r: R, g: G, b: B } = this.colorAtPosition(r);
                const p = (yy * width2 + xx) * 4;
                data2[p] = R;
                data2[p + 1] = G;
                data2[p + 2] = B;
                data2[p + 3] = 255;
              }
            }
          }

          const quantLevels2 = numBands;
          const { css: paletteCss2, mapRgbToIndex: mapRgbToIndex2 } = this.buildQuantizedGradientPalette(quantLevels2);
          const dithered2: ImageData = fillConcentric(img2, {
            levels: quantLevels2,
            pixelSize: Math.max(1, this.ditherPixelSize),
            algorithm: fillAlgorithm,
            patternStyle: fillPatternStyle,
            perceptual: true,
            customPalette: paletteCss2,
          });
          const out2 = dithered2.data;
          for (let yy = 0; yy < height2; yy++) {
            await yieldIfNeeded(yy);
            const y = y02 + yy;
            const rowSpans = spans2[yy] || [];
            for (const [sx, ex] of rowSpans) {
              for (let x = sx; x <= ex; x++) {
                const xx = x - x02;
                if (xx < 0 || xx >= width2) continue;
                const p = (yy * width2 + xx) * 4;
                const key = `${out2[p]},${out2[p + 1]},${out2[p + 2]}`;
                const gi = mapRgbToIndex2.get(key);
                if (gi !== undefined) {
                  const shifted = (gi - 1 + baseOffset) % 255;
                  writeConcentricIndex(x, y, shifted + 1);
                }
              }
            }
          }

          this.stampCounter += quantLevels2;
          if (strokeData) strokeData.stampCounter = this.stampCounter;
          this.dirtyLayers.add(id2);
          animator2.forceRender();
          this.render(false);
          logConcentricFill('cpu');
          if (strokeData) {
            this.snapshotFromBuffers(strokeData);
          }
          return;
        } catch {
          // fall back to index-space path
        }
      }

      const preferWorker =
        this.performanceOptions.useWebWorkers &&
        !this.perceptualDither &&
        shouldUseFillWorker(bbox.width, bbox.height);
      if (preferWorker) {
        const workerVertices = new Float32Array(vertices.length * 2);
        for (let i = 0; i < vertices.length; i++) {
          workerVertices[i * 2] = vertices[i].x;
          workerVertices[i * 2 + 1] = vertices[i].y;
        }
        const workerJobId = ++this.concentricWorkerJobId;
        try {
          const workerResult = await runConcentricFillJob({
            type: 'concentric-fill',
            vertices: workerVertices,
            bbox,
            bands: numBands,
            baseOffset,
            maxDist,
            ditherEnabled: this.ditherEnabled,
            ditherStrength: this.ditherStrength,
            ditherPixelSize: this.ditherPixelSize,
            noiseSeed,
          });
          if (workerJobId === this.concentricWorkerJobId && workerResult) {
            const buffer = new Uint8Array(workerResult.indices);
            blitLocalBuffer(buffer);
            finalizeFill('worker');
            if (strokeData) {
              this.snapshotFromBuffers(strokeData);
            }
            return;
          }
        } catch (error) {
          ccWarn('[ColorCycleBrush] Concentric worker fill failed; retrying on CPU', error);
        }
      }

      await fillConcentricIndices(
        {
          vertices,
          bbox,
          bands: numBands,
          baseOffset,
          maxDist,
          ditherEnabled: this.ditherEnabled,
          ditherStrength: this.ditherStrength,
          ditherPixelSize: this.ditherPixelSize,
          noiseSeed,
        },
        {
          writeSample: (x, y, colorIndex) => {
            this.logSetIndexSample(id, x, y);
            writeConcentricIndex(x, y, colorIndex);
          },
          yieldIfNeeded,
        }
      );
      finalizeFill('cpu');
      if (strokeData) {
        this.snapshotFromBuffers(strokeData);
      }
    } finally {
      animator.endDirectFill();
    }
  }
  
  /**
   * Clear (API compatible)
   */
  clear() {
    if (this._isHistoryRestore) {
      if (process.env.NODE_ENV !== 'production') {
        console.assert(false, '[ColorCycleBrush] clear() invoked during history restore');
      }
      return;
    }
    this.animators.forEach(animator => animator.clear());
    this.layerStrokes.clear();
    this.render(false);
  }
  
  /**
   * Render current frame (API compatible)
   */
  render(_forceFullOpacity: boolean = false) {
    void _forceFullOpacity;
    if (!this.webglCanvas || (this.webglCanvas instanceof HTMLCanvasElement && !this.webglCanvas.isConnected)) {
      this.renderScheduled = false;
      this.dirtyLayers.clear();
      if (this.onFrameRendered) {
        this.onFrameRendered();
      }
      return;
    }

    // Always rebuild from animators (authoritative).
    this.compositeCtx.clearRect(0, 0, this.width, this.height);

    const state = useAppStore.getState();
    const defStoreByLayer = new Map(
      state.layers
        .filter((layer) => layer.layerType === 'color-cycle' && layer.colorCycleData?.gradientDefStore)
        .map((layer) => [layer.id, layer.colorCycleData?.gradientDefStore])
    );

    // Composite all layers with content
    this.animators.forEach((animator, layerId) => {
      const strokeData = this.layerStrokes.get(layerId);
      if (strokeData?.hasContent) {
        const defs = defStoreByLayer.get(layerId) as Array<{
          id: number;
          hash: string;
          stops: GradientStop[];
        }> | undefined;
        this.applyDefBindingsForLayer(layerId, animator, strokeData, defs);
        animator.renderToCanvas2D(this.compositeCtx);
      }
    });

    // Draw to webgl canvas (actually just a regular canvas)
    const webglCtx = this.webglCanvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (webglCtx) {
      const prevOp = webglCtx.globalCompositeOperation;
      webglCtx.globalCompositeOperation = 'copy';
      webglCtx.drawImage(this.compositeCanvas, 0, 0);
      webglCtx.globalCompositeOperation = prevOp;
    }
    
    this.dirtyLayers.clear();

    // Call frame callback
    if (this.onFrameRendered) {
      this.onFrameRendered();
    }
  }
  
  /**
   * Render directly to canvas (API compatible)
   */
  renderDirectToCanvas(targetCanvas: HTMLCanvasElement, layerId: string) {
    if (!targetCanvas) {
      console.warn('Target canvas is required for renderDirectToCanvas');
      return;
    }
    
    if (!layerId) {
      console.warn('Layer ID is required for renderDirectToCanvas');
      return;
    }
    
    // Ensure an animator exists for the layer to avoid noisy warnings
    let animator = this.animators.get(layerId);
    if (!animator) {
      try {
        animator = this.getAnimator(layerId);
      } catch {
        // If we still cannot create an animator, exit quietly
        return;
      }
    }
    if (!animator) {
      return;
    }

    const strokeData = this.layerStrokes.get(layerId);
    const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });

    if (!ctx) {
      console.warn('Failed to get 2D context from target canvas');
      return;
    }

    // Prefer the tracked hasContent flag, but fall back to sampling the animator index data
    // so previously restored frames still redraw when gradients change.
    let hasRenderableContent = strokeData?.hasContent ?? false;
    if (!hasRenderableContent) {
      try {
        hasRenderableContent = this.paintBufferHasContent(
          strokeData?.buffers.paint,
          this.width,
          this.height
        );
      } catch {}
    }

    if (!hasRenderableContent) {
      const shouldPreserveExternalBase = Boolean(strokeData?.externalBase.hasExternalBase);
      if (!shouldPreserveExternalBase) {
        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      }
      return;
    }

    try {
      const state = useAppStore.getState();
      const layer = state.layers.find((entry) => entry.id === layerId);
      const defs = layer?.colorCycleData?.gradientDefStore as Array<{
        id: number;
        hash: string;
        stops: GradientStop[];
      }> | undefined;
      this.applyDefBindingsForLayer(layerId, animator, strokeData, defs);
      animator.forceRender();
    } catch {}

    const prevComposite = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    const prevSmoothing = ctx.imageSmoothingEnabled;
    try {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } catch {}
      ctx.imageSmoothingEnabled = false;

      const shouldPreserveExternalBase = Boolean(strokeData?.externalBase.hasExternalBase);
      if (!shouldPreserveExternalBase) {
        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      }
      this.renderAnimatorToContext(animator, ctx, targetCanvas);
      try {
        const maskManager = getMaskManager();
        maskManager.applyMaskToCanvas(layerId, ctx);
      } catch {}
    } finally {
      ctx.globalCompositeOperation = prevComposite;
      ctx.globalAlpha = prevAlpha;
      if (typeof prevSmoothing === 'boolean') {
        ctx.imageSmoothingEnabled = prevSmoothing;
      }
    }
  }

  /**
   * Finalize any pending stroke and force a render so callers can commit
   * the latest frame to a canvas.
   */
  commitCurrentStroke(layerId: string) {
    try {
      this.finalizeCurrentStroke(layerId);
      const id = layerId;
      const animator = this.animators.get(id);
      if (animator) {
        animator.forceRender();
      }
    } catch (error) {
      console.warn('[ColorCycleBrush.commitCurrentStroke] Failed to finalize stroke:', error);
    }
  }

  /**
   * Commit current layer content to a target canvas. This is a convenience helper
   * used by higher-level handlers to separate strokes in history.
   */
  commitToLayer(targetCanvas: HTMLCanvasElement, layerId: string, opacity: number = 1) {
    // Validate inputs
    if (!targetCanvas) {
      console.warn('[ColorCycleBrush.commitToLayer] No target canvas provided');
      return;
    }
    if (!layerId) {
      console.warn('[ColorCycleBrush.commitToLayer] No layerId provided');
      return;
    }

    let animator = this.animators.get(layerId);
    if (!animator) {
      try {
        animator = this.getAnimator(layerId);
      } catch {
        // Could not create animator; nothing to commit
        return;
      }
    }

    const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      console.warn('[ColorCycleBrush.commitToLayer] Failed to acquire 2D context');
      return;
    }

    // Ensure animator has the latest frame
    try { animator.forceRender(); } catch {}

    const strokeData = this.layerStrokes.get(layerId);

    const shouldCommitLog =
      process.env.NODE_ENV !== 'production' &&
      typeof globalThis !== 'undefined' &&
      (globalThis as { __CC_STAMP_DEBUG?: boolean }).__CC_STAMP_DEBUG === true;
    if (shouldCommitLog) {
      try {
        const dimensions = animator.getDimensions();
        console.log('[CC commit] animator surface', {
          width: dimensions.width,
          height: dimensions.height,
          hasWebGL: animator.hasWebGL?.() ?? false,
        });
      } catch {}

      const sampleTransitions = (canvas: HTMLCanvasElement): {
        transitions: number | null;
        reason: 'ok' | 'no_ctx' | 'zero_size' | 'exception';
        error?: string;
      } => {
        try {
          const sampleCtx = canvas.getContext('2d', { willReadFrequently: true });
          if (!sampleCtx) return { transitions: null, reason: 'no_ctx' };
          const sampleW = Math.min(64, canvas.width);
          const sampleH = Math.min(64, canvas.height);
          if (sampleW <= 0 || sampleH <= 0) return { transitions: null, reason: 'zero_size' };
          const data = sampleCtx.getImageData(0, 0, sampleW, sampleH).data;
          let transitions = 0;
          for (let y = 0; y < sampleH; y += 1) {
            const row = y * sampleW * 4;
            for (let x = 1; x < sampleW; x += 1) {
              const idx = row + x * 4;
              const prev = idx - 4;
              if (
                data[idx] !== data[prev] ||
                data[idx + 1] !== data[prev + 1] ||
                data[idx + 2] !== data[prev + 2]
              ) {
                transitions += 1;
              }
            }
          }
          return { transitions, reason: 'ok' };
        } catch (error) {
          return { transitions: null, reason: 'exception', error: String(error) };
        }
      };

      try {
        const previewHasCtx = !!targetCanvas.getContext('2d');
        if (typeof window !== 'undefined') {
          const w = window as Window & { __ccDebug?: Record<string, unknown> };
          w.__ccDebug = {
            ...(w.__ccDebug ?? {}),
            commit: {
              previewCanvas: { w: targetCanvas.width, h: targetCanvas.height, hasCtx: previewHasCtx },
              animator: animator.getDimensions(),
              sampledAfterClear: false,
              isDrawing: this.isDrawing,
              strokeData: {
                hasContent: strokeData?.hasContent ?? false,
              },
            }
          };
        }
        const animatorTransitions = (() => {
          try {
            const data = strokeData?.buffers.paint;
            const width = this.width;
            const height = this.height;
            if (!data || width <= 0 || height <= 0) {
              return { transitions: null, reason: 'zero_size' as const };
            }
            const sampleW = Math.min(64, width);
            const sampleH = Math.min(64, height);
            const stepX = Math.max(1, Math.floor(width / sampleW));
            const stepY = Math.max(1, Math.floor(height / sampleH));
            let transitions = 0;
            for (let y = 0; y < height; y += stepY) {
              const row = y * width;
              let prev = data[row];
              for (let x = stepX; x < width; x += stepX) {
                const idx = row + x;
                const value = data[idx];
                if (value !== prev) {
                  transitions += 1;
                }
                prev = value;
              }
            }
            return { transitions, reason: 'ok' as const };
          } catch (error) {
            return { transitions: null, reason: 'exception' as const, error: String(error) };
          }
        })();
        const previewTransitions = sampleTransitions(targetCanvas);
        if (typeof window !== 'undefined') {
          const w = window as Window & { __ccDebug?: Record<string, unknown> };
          const commit = (w.__ccDebug as { commit?: Record<string, unknown> } | undefined)?.commit ?? {};
          w.__ccDebug = {
            ...(w.__ccDebug ?? {}),
            commit: {
              ...commit,
              transitions: { animatorTransitions, previewTransitions },
            }
          };
        }
        try {
          console.log('[CC commit] transitions', { animatorTransitions, previewTransitions });
        } catch {}
      } catch {}
    }

    const commitOpacity = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
    // Save state and composite using source-over at commit opacity.
    const prevComposite = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    const prevSmoothing = ctx.imageSmoothingEnabled;
    // Save full context state (transform, clip, etc.)
    try { ctx.save(); } catch {}
    try {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = commitOpacity;
      // Ensure no stray transforms affect placement
      try { ctx.setTransform(1, 0, 0, 1, 0, 0); } catch {}
      ctx.imageSmoothingEnabled = false;

      const shouldPreserveExternalBase = Boolean(strokeData?.externalBase.hasExternalBase);
      if (!shouldPreserveExternalBase) {
        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      }
      this.renderAnimatorToContext(animator, ctx, targetCanvas);

      try {
        const maskManager = getMaskManager();
        maskManager.applyMaskToCanvas(layerId, ctx);
      } catch {}
    } finally {
      // Restore prior state regardless of outcome
      ctx.globalCompositeOperation = prevComposite;
      ctx.globalAlpha = prevAlpha;
      ctx.imageSmoothingEnabled = prevSmoothing;
      try { ctx.restore(); } catch {}
    }
  }

  /**
   * Start animation (API compatible)
   */
  private frameIntervalMs(): number {
    const frameFps = Math.max(1, Math.min(120, this.fps || 60));
    return 1000 / frameFps;
  }

  private ensureAnimationLoop() {
    if (typeof window === 'undefined') {
      return;
    }
    if (this.animationFrameId !== null) {
      return;
    }
    this.lastAnimationTimestamp = 0;
    this.playbackAccumulatorMs = 0;
    this.animationFrameId = requestAnimationFrame(this.handleAnimationTick);
  }

  private cancelAnimationLoop() {
    if (this.animationFrameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.animationFrameId = null;
  }

  private handleAnimationTick = (timestamp: number) => {
    if (!this.isAnimating) {
      this.animationFrameId = null;
      return;
    }

    if (this.lastAnimationTimestamp === 0) {
      this.lastAnimationTimestamp = timestamp;
    }

    const delta = timestamp - this.lastAnimationTimestamp;
    this.lastAnimationTimestamp = timestamp;

    if (!this.isPaused) {
      const interval = this.frameIntervalMs();
      this.playbackAccumulatorMs += delta;
      const maxCatchup = interval * 4;
      if (this.playbackAccumulatorMs > maxCatchup) {
        this.playbackAccumulatorMs = interval;
      }
      while (this.playbackAccumulatorMs >= interval) {
        this.playbackAccumulatorMs -= interval;
        this.updateAnimation();
      }
    }

    this.animationFrameId = requestAnimationFrame(this.handleAnimationTick);
  };

  private flushScheduledRender() {
    if (!this.renderScheduled) {
      return;
    }
    this.renderScheduled = false;
    if (this.dirtyLayers.size === 0) {
      return;
    }

    this.dirtyLayers.forEach(layerId => {
      const animator = this.animators.get(layerId);
      if (animator) {
        try {
          animator.forceRender();
        } catch {}
      }
    });
    this.dirtyLayers.clear();
    this.render(false);
  }

  /**
   * Flush any pending renders (API compatible).
   */
  flush(_layerId?: string) {
    void _layerId;
    this.flushScheduledRender();
  }

  startAnimation() {
    if (this.isAnimating) {
      return;
    }
    
    // Flush any pending renders before starting animation
    this.flushScheduledRender();
    
    this.isAnimating = true;
    this.isPaused = false;
    this.ensureAnimationLoop();
  }
  
  /**
   * Stop animation (API compatible)
   */
  stopAnimation() {
    if (!this.isAnimating && this.animationFrameId === null) {
      return;
    }

    this.isAnimating = false;
    this.isPaused = false;
    this.cancelAnimationLoop();
    this.flushScheduledRender();

    this.animators.forEach((animator) => {
      try {
        animator.stop();
      } catch {}
    });
  }
  
  /**
   * Toggle play/pause (API compatible)
   */
  togglePlayPause() {
    // Correct toggle behavior:
    // - If not animating at all, start
    // - If animating but paused, resume
    // - If animating and not paused, pause
    if (!this.isAnimating) {
      this.startAnimation();
      return;
    }

    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
  }
  
  /**
   * Pause animation (API compatible)
   */
  pause() {
    if (!this.isAnimating) {
      this.isPaused = true;
      return;
    }
    this.isPaused = true;
  }
  
  /**
   * Resume animation (API compatible)
   */
  resume() {
    if (!this.isAnimating) {
      this.startAnimation();
      return;
    }
    if (!this.isPaused) {
      return;
    }
    this.isPaused = false;
    this.ensureAnimationLoop();
  }

  /** Legacy alias maintained for callers using the old API */
  pauseAnimation() {
    this.pause();
  }

  /** Legacy alias maintained for callers using the old API */
  resumeAnimation() {
    this.resume();
  }
  
  /**
   * Update animation (API compatible)
   */
  updateAnimation() {
    // Force animator update even if not animating locally
    // This ensures the animation progresses when called from external loop
    this.animators.forEach((animator, layerId) => {
      const strokeData = this.layerStrokes.get(layerId);
      if (strokeData?.hasContent) {
        // Directly update the animator's frame
        animator.updateFrame();
      }
    });
    
    // Always render when updateAnimation is called
    this.render(false);
  }

  /**
   * Set absolute animation phase across all animators and render
   */
  setPhase(phase: number) {
    const p = ((phase % 1) + 1) % 1;
    this.animators.forEach((animator) => {
      if (typeof animator.setPhase === 'function') {
        animator.setPhase(p);
      } else {
        // Fallback: set FPS-based step to approximate phase
        animator.updateFrame();
      }
    });
    this.render(false);
  }
  
  /**
   * Set animation speed (API compatible)
   */
  setSpeed(speed: number) {
    if (!Number.isFinite(speed) || speed < 0) {
      console.warn(`Invalid animation speed: ${speed}`);
      return;
    }
    // Write-speed only: this value is stamped into newly painted pixels.
    // Playback scaling is controlled separately via setPlaybackSpeedScale.
    this.cycleSpeed = sanitizeBrushColorCycleSpeed(speed);
    this.animators.forEach(animator => animator.setSpeed(this.playbackSpeedScale));
  }

  setLayerBaseSpeed(speed: number) {
    if (!Number.isFinite(speed) || speed < 0) {
      console.warn(`Invalid layer base speed: ${speed}`);
      return;
    }

    const nextBaseSpeed = sanitizeBrushColorCycleSpeed(speed);
    const previousBaseSpeed = sanitizeBrushColorCycleSpeed(this.layerBaseSpeed, 1);
    const ratio = previousBaseSpeed > 0 ? nextBaseSpeed / previousBaseSpeed : 1;

    this.layerBaseSpeed = nextBaseSpeed;

    if (!Number.isFinite(ratio) || ratio <= 0) {
      return;
    }

    const nextBaseSpeedByte = encodeColorCycleSpeedByte(nextBaseSpeed);
    let changedAnyLayer = false;

    this.layerStrokes.forEach((strokeData, layerId) => {
      let changedLayer = false;
      const speedBuffer = strokeData.buffers.spd;
      const paintBuffer = strokeData.buffers.paint;
      let sawEncodedSpeed = false;

      for (let i = 0; i < speedBuffer.length; i += 1) {
        const encoded = speedBuffer[i] ?? 0;
        if (encoded <= 0) {
          continue;
        }
        sawEncodedSpeed = true;
        const decoded = decodeColorCycleSpeedByte(encoded);
        const scaled = encodeColorCycleSpeedByte(decoded * ratio);
        if (scaled !== encoded) {
          speedBuffer[i] = scaled;
          changedLayer = true;
        }
      }

      if (!sawEncodedSpeed && paintBuffer.length === speedBuffer.length) {
        for (let i = 0; i < paintBuffer.length; i += 1) {
          const nextByte = paintBuffer[i] === 0 ? 0 : nextBaseSpeedByte;
          if (speedBuffer[i] !== nextByte) {
            speedBuffer[i] = nextByte;
            changedLayer = true;
          }
        }
      }

      if (strokeData.strokeCounter === this.strokeCounter && Number.isFinite(strokeData.strokeCycleSpeed)) {
        strokeData.strokeCycleSpeed = sanitizeBrushColorCycleSpeed(strokeData.strokeCycleSpeed * ratio);
        strokeData.strokeSpeedByte = encodeColorCycleSpeedByte(strokeData.strokeCycleSpeed);
      } else {
        strokeData.strokeCycleSpeed = this.getResolvedWriteCycleSpeed();
        strokeData.strokeSpeedByte = encodeColorCycleSpeedByte(strokeData.strokeCycleSpeed);
      }

      if (!changedLayer) {
        return;
      }

      changedAnyLayer = true;
      this.snapshotFromBuffers(strokeData);

      const animator = this.animators.get(layerId);
      if (animator) {
        const dims = animator.getDimensions();
        animator.markDirtyBounds({
          minX: 0,
          minY: 0,
          width: Math.max(1, dims.width),
          height: Math.max(1, dims.height),
        });
      }
    });

    this.animators.forEach(animator => animator.setSpeed(this.playbackSpeedScale));

    if (changedAnyLayer) {
      this.render(false);
    }
  }

  setPlaybackSpeedScale(scale: number) {
    if (!Number.isFinite(scale) || scale < 0) {
      console.warn(`Invalid playback speed scale: ${scale}`);
      return;
    }
    this.playbackSpeedScale = scale;
    this.animators.forEach((animator) => animator.setSpeed(scale));
  }
  
  /**
   * Set FPS (API compatible)
   */
  setFPS(fps: number) {
    if (!Number.isFinite(fps) || fps <= 0 || fps > 120) {
      console.warn(`Invalid FPS value: ${fps}. Expected value between 1 and 120`);
      return;
    }
    this.fps = fps;
    this.playbackAccumulatorMs = 0;
    this.lastAnimationTimestamp = 0;
    this.animators.forEach(animator => animator.setFPS(fps));
  }
  
  /**
   * Set brush size (API compatible)
   */
  setBrushSize(size: number) {
    if (!Number.isFinite(size) || size <= 0) {
      console.warn(`Invalid brush size: ${size}`);
      return;
    }
    this.brushSize = size;
  }
  
  /**
   * Set gradient bands (number of color bands in the gradient)
   * Controls how many distinct color zones appear in shapes
   */
  setGradientBands(bands: number) {
    if (!Number.isFinite(bands) || bands < 1) {
      console.warn(`Invalid gradient bands: ${bands}, using default`);
      return;
    }
    this.gradientBands = Math.max(1, Math.min(254, Math.floor(bands)));
  }
  
  /**
   * Set band spacing (pixel distance between bands)
   */
  setBandSpacing(spacing: number) {
    if (!Number.isFinite(spacing) || spacing <= 0) {
      console.warn(`Invalid band spacing: ${spacing}, using default`);
      return;
    }
    const clamped = Math.max(1, Math.min(512, Math.round(spacing)));
    this.bandSpacing = clamped;
  }

  private normalizeBandSpacingValue(spacing?: number): number {
    if (typeof spacing !== 'number' || !Number.isFinite(spacing) || spacing <= 0) {
      return Math.max(1, this.bandSpacing || 12);
    }
    return Math.max(1, Math.min(512, Math.round(spacing)));
  }

  private deriveBandCountFromDistance(distance: number, spacing?: number): number {
    const fixedBands = Number.isFinite(this.gradientBands)
      ? Math.max(2, Math.min(254, Math.floor(this.gradientBands)))
      : null;
    if (fixedBands !== null) {
      return fixedBands;
    }
    if (!Number.isFinite(distance) || distance <= 0) {
      return 12;
    }
    const spacingPx = this.normalizeBandSpacingValue(spacing);
    const raw = Math.max(2, distance / spacingPx);
    return Math.max(2, Math.min(254, Math.round(raw)));
  }

  /**
   * Set stamp shape for stroke rendering
   */
  setStampShape(shape: StampShape) {
    if (shape === 'triangle') {
      this.stampShape = 'triangle';
    } else if (shape === 'diamond') {
      this.stampShape = 'diamond';
    } else if (shape === 'diamond5') {
      this.stampShape = 'diamond5';
    } else if (shape === 'diamond7') {
      this.stampShape = 'diamond7';
    } else if (shape === 'diamond9') {
      this.stampShape = 'diamond9';
    } else if (shape === 'round') {
      this.stampShape = 'round';
    } else {
      this.stampShape = 'square';
    }
  }
  
  /**
   * Set pressure enabled state
   */
  setPressureEnabled(enabled: boolean) {
    this.pressureEnabled = enabled;
  }
  
  /**
   * Set min pressure (size percentage)
   */
  setMinPressure(min: number) {
    this.minPressure = Math.max(1, Math.min(1000, min));
  }
  
  /**
   * Set max pressure (size percentage)
   */
  setMaxPressure(max: number) {
    this.maxPressure = Math.max(1, Math.min(1000, max));
    // Ensure max is always >= min
    if (this.maxPressure < this.minPressure) {
      this.maxPressure = this.minPressure;
    }
  }

  /** Enable/disable dithering for color cycle shape fills */
  setDitherEnabled(enabled: boolean) {
    this.ditherEnabled = !!enabled;
    if (this.ditherEnabled) {
      // Default to maximum strength when toggled ON
      this.ditherStrength = 1.0;
    }
  }

  /** Optionally adjust dithering strength (0..1). */
  setDitherStrength(strength: number) {
    this.ditherStrength = Math.max(0, Math.min(1, strength));
  }

  /** Set coarse pixel size for dithering cells (>=1). */
  setDitherPixelSize(size: number) {
    this.ditherPixelSize = Math.max(1, Math.floor(size));
  }


  /** Keep scanline fills aligned to whole edge pixels. */
  setPxlEdgeEnabled(enabled: boolean) {
    this.pxlEdgeEnabled = !!enabled;
  }
  
  /** Toggle stamp-level dithering for Color Cycle strokes. */
  setStampDitherEnabled(enabled: boolean) {
    this.stampDitherEnabled = !!enabled;
    if (this.stampDitherEnabled) {
      this.clearStampDitherCache();
    } else {
      this.layerStrokes.forEach((stroke) => {
        stroke.stampDither = undefined;
      });
    }
  }

  /** Select the dithering algorithm for stamp masks. */
  setStampDitherAlgorithm(algorithm?: StampDitherAlgorithm) {
    const next = algorithm || 'sierra-lite';
    if (next === this.stampDitherAlgorithm) {
      return;
    }
    this.stampDitherAlgorithm = next;
    this.clearStampDitherCache();
  }

  /** Select the dithering pattern style when using pattern algorithm. */
  setStampDitherPatternStyle(style?: PatternStyle) {
    const next = style || 'dots';
    if (next === this.stampDitherPatternStyle) {
      return;
    }
    this.stampDitherPatternStyle = next;
    this.clearStampDitherCache();
  }

  /** Adjust stamp dithering pixel size multiplier (>=1). */
  setStampDitherPixelSize(size: number) {
    const next = Math.max(1, Math.floor(size));
    if (next === this.stampDitherPixelSize) {
      return;
    }
    this.stampDitherPixelSize = next;
    this.clearStampDitherCache();
  }

  /** Toggle pressure-linked stamp dithering resolution. */
  setStampDitherPressureLinked(enabled: boolean) {
    this.stampDitherPressureLinked = !!enabled;
    this.layerStrokes.forEach((stroke) => {
      if (stroke.stampDither) {
        stroke.stampDither.stampDitherPressureState = null;
      }
    });
  }

  /** Toggle whether stamp dithering keeps background fill. */
  setStampDitherBgFill(enabled: boolean) {
    this.stampDitherBgFill = !!enabled;
  }

  /** Toggle whether stamp dithering should clear skipped pixels (legacy alias). */
  setStampDitherClears(enabled: boolean) {
    this.stampDitherBgFill = !enabled;
  }
  
  /**
   * Is playing? (API compatible)
   */
  isPlaying(): boolean {
    return this.isAnimating && !this.isPaused;
  }
  
  /**
   * Set frame callback (API compatible)
   */
  setOnFrameRendered(callback: () => void) {
    this.onFrameRendered = callback;
  }
  
  /**
   * Set active layer ID
   */
  setActiveLayer(layerId: string) {
    ccLog('setActiveLayer()', { layerId });
    this.activeLayerId = layerId;
  }
  
  /**
   * @deprecated Use startAnimation() or stopAnimation() directly
   * Set playing state - wrapper for backward compatibility
   */
  setPlaying(playing: boolean) {
    if (playing) {
      this.startAnimation();
    } else {
      this.stopAnimation();
    }
  }
  
  /**
   * Layer isolation methods for multi-layer support
   */
  private layerId: string | null = null;
  private isolated: boolean = false;
  
  /**
   * Set the layer ID this brush instance belongs to
   * Note: This overrides the deprecated setLayerId above
   */
  setLayerId(layerId: string): void {
    ccLog('setLayerId()', { layerId });
    this.layerId = layerId;
    // Also call setActiveLayer for compatibility
    this.setActiveLayer(layerId);
    // quiet
  }
  
  /**
   * Get the layer ID this brush instance belongs to
   */
  getLayerId(): string | null {
    return this.layerId;
  }
  
  /**
   * Mark this brush as isolated (no shared resources)
   */
  setIsolated(isolated: boolean): void {
    this.isolated = isolated;
  }
  
  /**
   * Get canvas for validation
   */
  getCanvas(): HTMLCanvasElement {
    return this.webglCanvas;
  }

  /**
   * Replace the target canvas that receives composite draws. Useful when undo/redo
   * reattaches a fresh DOM node for the color-cycle layer.
   */
  setTargetCanvas(canvas: HTMLCanvasElement | null): void {
    if (!canvas || canvas === this.webglCanvas) {
      return;
    }

    const nextWidth = canvas.width || this.width;
    const nextHeight = canvas.height || this.height;
    const dimensionsChanged = nextWidth !== this.width || nextHeight !== this.height;

    this.webglCanvas = canvas;

    if (dimensionsChanged) {
      this.width = nextWidth;
      this.height = nextHeight;

      this.compositeCanvas.width = this.width;
      this.compositeCanvas.height = this.height;
      const ctx = this.compositeCanvas.getContext('2d', {
        willReadFrequently: true,
        alpha: true
      }) as CanvasRenderingContext2D | null;
      if (ctx) {
        this.compositeCtx = ctx;
        this.compositeCtx.imageSmoothingEnabled = false;
      }

      this.animators.forEach((animator) => {
        try {
          animator.resize(this.width, this.height);
        } catch {
          // Ignore resize failures; ensureFullResolution will correct on next use.
        }
      });

      this.layerStrokes.forEach((strokeData) => {
        const expected = this.width * this.height;
        if (strokeData.buffers.paint.length !== expected) {
          strokeData.buffers.paint = new Uint8Array(expected);
          strokeData.buffers.gid = new Uint8Array(expected);
          strokeData.buffers.spd = new Uint8Array(expected);
          strokeData.buffers.flow = new Uint8Array(expected);
          strokeData.buffers.def = new Uint16Array(expected);
        }
      });
    }

    try {
      this.render(false);
    } catch {
      // Best-effort refresh; failures should not break stroke flow.
    }
  }

  setUseCanvas2D(useCanvas2D: boolean): void {
    if (this.forceCanvas2D === useCanvas2D) {
      return;
    }

    this.forceCanvas2D = useCanvas2D;

    this.animators.forEach((animator) => {
      try {
        animator.setForceCanvas2D(useCanvas2D);
        animator.forceRender();
      } catch {}
    });

    // Re-render composite canvas to reflect the active rendering path
    try {
      this.render(false);
    } catch {}
  }

  isUsingWebGL(): boolean {
    if (this.forceCanvas2D) {
      return false;
    }

    for (const animator of this.animators.values()) {
      if (animator.hasWebGL()) {
        return true;
      }
    }

    return false;
  }
  
  /**
   * Check if WebGL context is lost (always false for Canvas2D)
   */
  isContextLost(): boolean {
    return false; // Canvas2D doesn't lose context
  }
  
  /**
   * Check if buffers are valid
   */
  hasValidBuffers(): boolean {
    // Treat a brand-new brush with no stroke data as valid and lazily initialize.
    if (this.activeLayerId) {
      let layerData = this.layerStrokes.get(this.activeLayerId);
      if (!layerData) {
        // Lazy-init an empty stroke buffer so validation doesn't force recreation loops
        const expectedSize = Math.max(1, this.width * this.height);
        layerData = this.createLayerStrokeState({ hasContent: false, bufferSize: expectedSize });
        this.layerStrokes.set(this.activeLayerId, layerData);
      }
      return !!layerData.buffers.paint;
    }
    // No active layer is also valid
    return true;
  }
  
  /**
   * Cleanup resources and stop animations
   */
  cleanup() {
    // Cancel any pending renders
    this.renderScheduled = false;
    this.dirtyLayers.clear();
    
    this.stopAnimation();
    
    // Clean up all animators
    this.animators.forEach((animator) => {
      try {
        animator.stop();
      } catch {}
      // Properly clean up animator resources and return canvas to pool
      try {
        animator.cleanup();
      } catch {}
    });
    
    this.animators.clear();
    this.layerStrokes.clear();
  }
  
  /**
   * @deprecated Use cleanup() instead
   * Alias for cleanup() to maintain API compatibility
   */
  destroy() {
    this.cleanup();
  }
  
  /**
   * Set flow direction (API compatible)
   */
  setFlowMode(_mode: 'forward' | 'reverse' | 'pingpong') {
    void _mode;
    this.flowMode = 'forward';
  }

  setLegacyFlowMode(_mode: 'forward' | 'reverse' | 'pingpong') {
    void _mode;
    this.legacyFlowMode = 'forward';
    this.animators.forEach(animator => animator.setFlowMode('forward'));
  }

  setFlowDirection(direction: 'forward' | 'backward') {
    this.setFlowMode(direction === 'backward' ? 'reverse' : 'forward');
  }

  getFlowMode(): 'forward' | 'reverse' | 'pingpong' {
    return this.flowMode;
  }

  get flowDirection(): 'forward' | 'backward' {
    return this.flowMode === 'reverse' ? 'backward' : 'forward';
  }

  set flowDirection(direction: 'forward' | 'backward') {
    this.setFlowDirection(direction);
  }
  
  /**
   * Toggle flow direction (API compatible)
   */
  toggleFlowDirection() {
    this.setFlowMode('forward');
  }
  
  /**
   * Get full state (API compatible)
   */
  getFullState() {
    return this.serialize();
  }
  
  /**
   * Restore full state (API compatible)
   */
  restoreFullState(state: ColorCycleBrushCanvasState = {}, opts: RestoreOpts = {}) {
    const { layerSnapshots } = state;
    const asHistory = opts.mode === 'history' || opts.preservePaintBuffer === true;
    this._isHistoryRestore = asHistory;
    const shouldAssertNoClear = process.env.NODE_ENV !== 'production' && asHistory;
    let clearedDuringRestore = false;
    let highestStrokeCounter = asHistory ? 0 : this.strokeCounter;
    try {
      if (state.cycleSpeed !== undefined) this.cycleSpeed = state.cycleSpeed;
      if (state.layerBaseSpeed !== undefined) {
        this.layerBaseSpeed = sanitizeBrushColorCycleSpeed(state.layerBaseSpeed, 1);
      }
      if (state.playbackSpeedScale !== undefined) {
        this.setPlaybackSpeedScale(state.playbackSpeedScale);
      }
      if (state.fps !== undefined) this.fps = state.fps;
      if (state.brushSize !== undefined) this.brushSize = state.brushSize;
      if (
        state.stampShape === 'triangle' ||
        state.stampShape === 'square' ||
        state.stampShape === 'diamond' ||
        state.stampShape === 'diamond5' ||
        state.stampShape === 'diamond7' ||
        state.stampShape === 'diamond9' ||
        state.stampShape === 'round'
      ) {
        this.setStampShape(state.stampShape);
      }
      if (typeof state.stampDitherEnabled === 'boolean') {
        this.setStampDitherEnabled(state.stampDitherEnabled);
      }
      if (typeof state.stampDitherPixelSize === 'number') {
        this.setStampDitherPixelSize(state.stampDitherPixelSize);
      }
      if (state.stampDitherAlgorithm) {
        this.setStampDitherAlgorithm(state.stampDitherAlgorithm);
      }
      if (state.stampDitherPatternStyle) {
        this.setStampDitherPatternStyle(state.stampDitherPatternStyle);
      }
      if (typeof state.stampDitherBgFill === 'boolean') {
        this.setStampDitherBgFill(state.stampDitherBgFill);
      } else if (typeof state.stampDitherClears === 'boolean') {
        this.setStampDitherClears(state.stampDitherClears);
      }
      if (typeof state.stampDitherPressureLinked === 'boolean') {
        this.setStampDitherPressureLinked(state.stampDitherPressureLinked);
      }
      if (typeof state.pxlEdgeEnabled === 'boolean') {
        this.setPxlEdgeEnabled(state.pxlEdgeEnabled);
      }
      
      if (layerSnapshots && !asHistory) {
        const clearForLayer = (layerId: string) => {
          clearedDuringRestore = true;
          const sd = this.layerStrokes.get(layerId);
          if (sd) {
            console.log('[ColorCycleBrush] Paint buffer cleared during restore for layer:', layerId?.substring(0, 20));
            sd.buffers.paint.fill(0);
            sd.buffers.gid.fill(0);
            sd.buffers.spd.fill(0);
            sd.buffers.flow.fill(0);
            sd.buffers.def.fill(0);
            sd.hasContent = false;
            sd.strokeCounter = 0;
            sd.lastPoint = null;
            sd.stampCounter = 0;
            sd.strokePhaseUnits = 0;
            sd.snapshot = undefined;
            sd.stampDither = undefined;
          }
          const animator = this.animators.get(layerId);
          if (animator) {
            try { animator.clear(); } catch {}
          }
        };

        if (layerSnapshots instanceof Map) {
          layerSnapshots.forEach((_buffer, layerId) => clearForLayer(layerId));
        } else if (Array.isArray(layerSnapshots)) {
          for (const snapshot of layerSnapshots) {
            if (snapshot?.layerId) {
              clearForLayer(snapshot.layerId);
            }
          }
        }
        this.compositeCtx.clearRect(0, 0, this.width, this.height);
      }

      if (layerSnapshots) {
        if (layerSnapshots instanceof Map) {
          layerSnapshots.forEach((buffer, layerId) => {
            this.applyLayerSnapshot(layerId, {
              paintBuffer: buffer,
              gradientIdBuffer: undefined,
              hasContent: !!buffer && (buffer as ArrayBuffer).byteLength > 0,
              strokeCounter: 0
            }, /*extra*/ undefined);
          });
        } else if (Array.isArray(layerSnapshots)) {
          layerSnapshots.forEach((snapshot) => {
            if (!snapshot || !snapshot.layerId) {
              return;
            }
            const {
              paintBuffer,
              gradientIdBuffer,
              speedBuffer,
              flowBuffer,
              hasContent,
              strokeCounter,
              animatorIndex
            } = snapshot;
            const buffer = paintBuffer ?? new ArrayBuffer(0);
            if (typeof strokeCounter === 'number') {
              highestStrokeCounter = Math.max(highestStrokeCounter, strokeCounter);
            }
            this.applyLayerSnapshot(snapshot.layerId, {
              paintBuffer: buffer,
              gradientIdBuffer,
              speedBuffer,
              flowBuffer,
              hasContent: Boolean(hasContent) || buffer.byteLength > 0,
              strokeCounter: strokeCounter ?? 0
            }, animatorIndex);
          });
        }
      }
      if (asHistory) {
        this.strokeCounter = highestStrokeCounter;
      }
      
    } finally {
      if (shouldAssertNoClear) {
        console.assert(!clearedDuringRestore, '[ColorCycleBrush] Cleared stroke data during history restore');
      }
      this._isHistoryRestore = false;
    }
  }

  /**
   * Debug helper: verify that the animator canvas for a layer is cleared (alpha == 0)
   */
  verifyPaintBufferCleared(layerId: string): boolean {
    const id = layerId;
    const animator = this.animators.get(id);
    if (!animator) {
      console.log('[Debug] No animator exists for layer:', id);
      return true;
    }
    const strokeData = this.layerStrokes.get(id);
    try {
      if (!strokeData?.buffers.paint) {
        console.log('[Debug] No paint buffer data on layer');
        return true;
      }
      const hasContent = this.paintBufferHasContent(
        strokeData.buffers.paint,
        this.width,
        this.height
      );
      console.log('[Debug] Animator buffer has content:', hasContent, 'layer:', id);
      return !hasContent;
    } catch (error) {
      console.warn('[Debug] Failed to verify animator canvas content:', error);
      return false;
    }
  }
  
  /**
   * Serialize state (API compatible simplified)
   */
  serialize(): ColorCycleBrushCanvasSerialized {
    ccLog('Brush.serialize()', {
      layerCount: this.animators.size,
      layerIds: Array.from(this.animators.keys()),
      hasActive: Boolean(this.activeLayerId),
      active: this.activeLayerId ?? null
    });
    const layers: SerializedLayerState[] = [];
    const storeLayers = useAppStore.getState().layers;
    const layerMetaById = new Map(
      storeLayers
        .filter((layer) => layer.layerType === 'color-cycle' && layer.colorCycleData)
        .map((layer) => [layer.id, layer.colorCycleData])
    );

    this.animators.forEach((animator, layerId) => {
      const strokeData = this.layerStrokes.get(layerId);
      const hadSnapshot = Boolean(strokeData?.snapshot?.paintBuffer?.byteLength);
      if (strokeData?.hasContent && !hadSnapshot) {
        this.snapshotFromBuffers(strokeData);
      }
      const snapshot = strokeData?.snapshot;
      const hasContent = snapshot?.hasContent ?? strokeData?.hasContent ?? false;

      let paintBuffer: ArrayBuffer = new ArrayBuffer(0);
      let gradientIdBuffer: ArrayBuffer | undefined = undefined;
      let gradientDefIdBuffer: ArrayBuffer | undefined = undefined;
      let speedBuffer: ArrayBuffer | undefined = undefined;
      let flowBuffer: ArrayBuffer | undefined = undefined;
      const paintU8 = strokeData?.buffers.paint instanceof Uint8Array ? strokeData.buffers.paint : undefined;
      const gidU8 = strokeData?.buffers.gid instanceof Uint8Array ? strokeData.buffers.gid : undefined;
      const defU16 = strokeData?.buffers.def instanceof Uint16Array ? strokeData.buffers.def : undefined;
      const spdU8 = strokeData?.buffers.spd instanceof Uint8Array ? strokeData.buffers.spd : undefined;
      const flowU8 = strokeData?.buffers.flow instanceof Uint8Array ? strokeData.buffers.flow : undefined;
      const hasBuffers =
        (snapshot?.paintBuffer?.byteLength ?? 0) > 0 || (paintU8?.length ?? 0) > 0;
      if (hasBuffers) {
        if (snapshot?.paintBuffer && snapshot.paintBuffer.byteLength > 0) {
          paintBuffer = snapshot.paintBuffer.slice(0);
        } else if (paintU8 && paintU8.length > 0) {
          paintBuffer = paintU8.slice().buffer;
        }
        if (snapshot?.gradientIdBuffer && snapshot.gradientIdBuffer.byteLength > 0) {
          gradientIdBuffer = snapshot.gradientIdBuffer.slice(0);
        } else if (gidU8 && gidU8.length > 0) {
          gradientIdBuffer = gidU8.slice().buffer;
        }
        if (snapshot?.gradientDefIdBuffer && snapshot.gradientDefIdBuffer.byteLength > 0) {
          gradientDefIdBuffer = snapshot.gradientDefIdBuffer.slice(0);
        } else if (defU16 && defU16.length > 0) {
          gradientDefIdBuffer = defU16.slice().buffer;
        }
        if (snapshot?.speedBuffer && snapshot.speedBuffer.byteLength > 0) {
          speedBuffer = snapshot.speedBuffer.slice(0);
        } else if (spdU8 && spdU8.length > 0) {
          speedBuffer = spdU8.slice().buffer;
        }
        if (snapshot?.flowBuffer && snapshot.flowBuffer.byteLength > 0) {
          flowBuffer = snapshot.flowBuffer.slice(0);
        } else if (flowU8 && flowU8.length > 0) {
          flowBuffer = flowU8.slice().buffer;
        }
      }
      const strokeCounter = strokeData?.strokeCounter ?? snapshot?.strokeCounter ?? this.strokeCounter;
      const colorCycleMeta = layerMetaById.get(layerId);
      const gradientDefs = colorCycleMeta?.gradientDefs
        ? colorCycleMeta.gradientDefs.map((entry) => ({
            id: entry.id,
            name: entry.name,
            currentSlot: entry.currentSlot,
          }))
        : undefined;
      const slotPalettes = colorCycleMeta?.slotPalettes
        ? colorCycleMeta.slotPalettes.map((entry) => ({
            slot: entry.slot,
            stops: entry.stops.map((stop) => ({ position: stop.position, color: stop.color })),
          }))
        : undefined;
      const gradientDefStore = colorCycleMeta?.gradientDefStore
        ? colorCycleMeta.gradientDefStore.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            stops: entry.stops.map((stop) => ({ position: stop.position, color: stop.color })),
            hash: entry.hash,
            source: entry.source,
            seamProfile: entry.seamProfile,
            createdAtMs: entry.createdAtMs,
            slot: entry.slot,
            speedCps: entry.speedCps,
          }))
        : undefined;
      const fgDerivedGradients = colorCycleMeta?.fgDerivedGradients ?? colorCycleMeta?.derivedGradients;
      const derivedGradients = fgDerivedGradients
        ? fgDerivedGradients.map((entry) => ({
            key: entry.key,
            slot: entry.slot,
            spec: { ...entry.spec },
          }))
        : undefined;
      const activeGradientId = colorCycleMeta?.activeGradientId;
      const paintSlot = colorCycleMeta?.paintSlot;
      const legacyRemap = colorCycleMeta?.legacyRemap;
      const fgActiveSlot = colorCycleMeta?.fgActiveSlot;
      const fgDerivedKey = colorCycleMeta?.fgDerivedKey;

      layers.push({
        layerId,
        data: animator.serialize(),
        gradientDefs,
        slotPalettes,
        gradientDefStore,
        nextGradientDefId: colorCycleMeta?.nextGradientDefId,
        paintSlot,
        legacyRemap,
        fgActiveSlot,
        fgDerivedKey,
        fgDerivedGradients: derivedGradients,
        derivedGradients,
        activeGradientId,
        strokeData: {
          paintBuffer,
          gradientIdBuffer,
          gradientDefIdBuffer,
          speedBuffer,
          flowBuffer,
          hasContent,
          strokeCounter
        }
      });
    });

    return {
      layers,
      cycleSpeed: this.cycleSpeed,
      layerBaseSpeed: this.layerBaseSpeed,
      playbackSpeedScale: this.playbackSpeedScale,
      fps: this.fps,
      brushSize: this.brushSize,
      stampShape: this.stampShape,
      stampDitherEnabled: this.stampDitherEnabled,
      stampDitherPixelSize: this.stampDitherPixelSize,
      stampDitherAlgorithm: this.stampDitherAlgorithm,
      stampDitherPatternStyle: this.stampDitherPatternStyle,
      stampDitherBgFill: this.stampDitherBgFill,
      stampDitherClears: !this.stampDitherBgFill,
      stampDitherPressureLinked: this.stampDitherPressureLinked,
      pxlEdgeEnabled: this.pxlEdgeEnabled,
    };
  }
  
  /**
   * Deserialize state (API compatible simplified)
   */
  static deserialize(data: ColorCycleBrushCanvasSerialized, canvas: HTMLCanvasElement): ColorCycleBrushCanvas2D {
    const instance = new ColorCycleBrushCanvas2D(canvas, {
      brushSize: data.brushSize,
      fps: data.fps
    });

    if (typeof data.cycleSpeed === 'number') {
      instance.setSpeed(data.cycleSpeed);
    }
    if (typeof data.layerBaseSpeed === 'number') {
      instance.setLayerBaseSpeed(data.layerBaseSpeed);
    }
    if (typeof data.playbackSpeedScale === 'number') {
      instance.setPlaybackSpeedScale(data.playbackSpeedScale);
    }

    if (data.stampShape) {
      instance.setStampShape(data.stampShape);
    }
    if (typeof data.stampDitherEnabled === 'boolean') {
      instance.setStampDitherEnabled(data.stampDitherEnabled);
    }
    if (typeof data.stampDitherPixelSize === 'number') {
      instance.setStampDitherPixelSize(data.stampDitherPixelSize);
    }
    if (data.stampDitherAlgorithm) {
      instance.setStampDitherAlgorithm(data.stampDitherAlgorithm);
    }
    if (data.stampDitherPatternStyle) {
      instance.setStampDitherPatternStyle(data.stampDitherPatternStyle);
    }
    if (typeof data.stampDitherPressureLinked === 'boolean') {
      instance.setStampDitherPressureLinked(data.stampDitherPressureLinked);
    }
    if (typeof data.stampDitherBgFill === 'boolean') {
      instance.setStampDitherBgFill(data.stampDitherBgFill);
    } else if (typeof data.stampDitherClears === 'boolean') {
      instance.setStampDitherClears(data.stampDitherClears);
    }
    if (typeof data.pxlEdgeEnabled === 'boolean') {
      instance.setPxlEdgeEnabled(data.pxlEdgeEnabled);
    }

    data.layers?.forEach((layer) => {
      const strokeData = layer.strokeData;
      const sourceBuffer = strokeData?.paintBuffer;
      const gradientSource = strokeData?.gradientIdBuffer;
      const gradientDefSource = strokeData?.gradientDefIdBuffer;
      const speedSource = strokeData?.speedBuffer;
      const flowSource = strokeData?.flowBuffer;
      const clonedArray = sourceBuffer
        ? new Uint8Array(sourceBuffer).slice()
        : new Uint8Array(0);
      const clonedBuffer = clonedArray.buffer as ArrayBuffer;
      const clonedGradientArray = gradientSource
        ? new Uint8Array(gradientSource).slice()
        : undefined;
      const clonedGradientBuffer = clonedGradientArray ? clonedGradientArray.buffer as ArrayBuffer : undefined;
      const clonedGradientDefArray = gradientDefSource
        ? new Uint16Array(gradientDefSource).slice()
        : undefined;
      const clonedGradientDefBuffer = clonedGradientDefArray
        ? clonedGradientDefArray.buffer as ArrayBuffer
        : undefined;
      const clonedSpeedArray = speedSource
        ? new Uint8Array(speedSource).slice()
        : undefined;
      const clonedSpeedBuffer = clonedSpeedArray ? clonedSpeedArray.buffer as ArrayBuffer : undefined;
      const clonedFlowArray = flowSource
        ? new Uint8Array(flowSource).slice()
        : undefined;
      const clonedFlowBuffer = clonedFlowArray ? clonedFlowArray.buffer as ArrayBuffer : undefined;
      const indexBuffer = layer.data?.indexBuffer;
      const animatorIndex =
        indexBuffer && typeof indexBuffer.width === 'number' && typeof indexBuffer.height === 'number'
          ? {
              width: indexBuffer.width,
              height: indexBuffer.height,
              data: indexBuffer.data ? new Uint8Array(indexBuffer.data).slice().buffer : new Uint8Array().buffer,
              gradientIdData: indexBuffer.gradientId
                ? new Uint8Array(indexBuffer.gradientId).slice().buffer
                : undefined,
              speedData: indexBuffer.speedData
                ? new Uint8Array(indexBuffer.speedData).slice().buffer
                : undefined,
              flowData: indexBuffer.flowData
                ? new Uint8Array(indexBuffer.flowData).slice().buffer
                : undefined,
              gradientStops: layer.data?.gradient?.gradientStops ?? undefined,
              gradientDefs: layer.gradientDefs,
              slotPalettes: layer.slotPalettes,
              activeGradientId: layer.activeGradientId,
              paintSlot: layer.paintSlot,
              legacyRemap: layer.legacyRemap,
            }
          : undefined;
      instance.applyLayerSnapshot(layer.layerId, {
        paintBuffer: clonedBuffer,
        gradientIdBuffer: clonedGradientBuffer,
        gradientDefIdBuffer: clonedGradientDefBuffer,
        speedBuffer: clonedSpeedBuffer,
        flowBuffer: clonedFlowBuffer,
        hasContent: Boolean(strokeData?.hasContent) || clonedBuffer.byteLength > 0,
        strokeCounter: strokeData?.strokeCounter ?? 0
      }, animatorIndex);
    });

    return instance;
  }

  /**
   * Export a snapshot of a layer's stroke data
   */
  getLayerSnapshot(layerId: string): {
    paintBuffer: ArrayBuffer;
    gradientIdBuffer?: ArrayBuffer;
    gradientDefIdBuffer?: ArrayBuffer;
    speedBuffer?: ArrayBuffer;
    flowBuffer?: ArrayBuffer;
    hasContent: boolean;
    strokeCounter: number;
  } | null {
    const strokeData = this.layerStrokes.get(layerId);
    if (!strokeData) return null;
    const snapshot = strokeData.snapshot;
    const paintBuffer = snapshot?.paintBuffer && snapshot.paintBuffer.byteLength > 0
      ? snapshot.paintBuffer.slice(0)
      : strokeData.buffers.paint.length > 0
        ? strokeData.buffers.paint.slice().buffer
        : new ArrayBuffer(0);
    const gradientIdBuffer = snapshot?.gradientIdBuffer && snapshot.gradientIdBuffer.byteLength > 0
      ? snapshot.gradientIdBuffer.slice(0)
      : strokeData.buffers.gid.length > 0
        ? strokeData.buffers.gid.slice().buffer
        : undefined;
    const gradientDefIdBuffer = snapshot?.gradientDefIdBuffer && snapshot.gradientDefIdBuffer.byteLength > 0
      ? snapshot.gradientDefIdBuffer.slice(0)
      : strokeData.buffers.def.length > 0
        ? strokeData.buffers.def.slice().buffer
        : undefined;
    const speedBuffer = snapshot?.speedBuffer && snapshot.speedBuffer.byteLength > 0
      ? snapshot.speedBuffer.slice(0)
      : strokeData.buffers.spd.length > 0
        ? strokeData.buffers.spd.slice().buffer
        : undefined;
    const flowBuffer = snapshot?.flowBuffer && snapshot.flowBuffer.byteLength > 0
      ? snapshot.flowBuffer.slice(0)
      : strokeData.buffers.flow.length > 0
        ? strokeData.buffers.flow.slice().buffer
        : undefined;
    return {
      paintBuffer,
      gradientIdBuffer,
      gradientDefIdBuffer,
      speedBuffer,
      flowBuffer,
      hasContent: snapshot?.hasContent ?? !!strokeData.hasContent,
      strokeCounter: strokeData.strokeCounter ?? snapshot?.strokeCounter ?? 0
    };
  }

  /**
   * Apply a snapshot to a layer's stroke data
   */
  applyLayerSnapshot(layerId: string, snapshot: StrokeDataSnapshot, animatorIndex?: AnimatorIndexSnapshot) {
    // Ensure animator exists for this layer
    const animator = this.ensureFullResolution(layerId, 'restore');
    const buffer =
      snapshot.paintBuffer && snapshot.paintBuffer.byteLength > 0
        ? snapshot.paintBuffer
        : (animatorIndex?.data ?? new ArrayBuffer(0));
    const gradientBuffer =
      snapshot.gradientIdBuffer && snapshot.gradientIdBuffer.byteLength > 0
        ? snapshot.gradientIdBuffer
        : animatorIndex?.gradientIdData;
    const gradientDefBuffer =
      snapshot.gradientDefIdBuffer && snapshot.gradientDefIdBuffer.byteLength > 0
        ? snapshot.gradientDefIdBuffer
        : undefined;
    const speedBuffer =
      snapshot.speedBuffer && snapshot.speedBuffer.byteLength > 0
        ? snapshot.speedBuffer
        : animatorIndex?.speedData;
    const flowBuffer =
      snapshot.flowBuffer && snapshot.flowBuffer.byteLength > 0
        ? snapshot.flowBuffer
        : animatorIndex?.flowData;
    const existing = this.layerStrokes.get(layerId);
    const expectedSize = this.width * this.height;
    const incoming = new Uint8Array(buffer);
    const incomingGradient = gradientBuffer ? new Uint8Array(gradientBuffer) : null;
    const incomingGradientDef = gradientDefBuffer ? new Uint16Array(gradientDefBuffer) : null;
    const incomingSpeed = speedBuffer ? new Uint8Array(speedBuffer) : null;
    const incomingFlow = flowBuffer ? new Uint8Array(flowBuffer) : null;
    const expectsContent = Boolean(snapshot.hasContent);
    const hadExistingContent = existing?.hasContent ?? false;
    try {
      if (incoming.length !== expectedSize) {
        // Ensure animator is at the correct size for the current canvas
        animator!.resize(this.width, this.height);
      }
    } catch {}
    const strokeData = existing || this.createLayerStrokeState({ hasContent: false, bufferSize: expectedSize });
    if (strokeData.buffers.paint.length !== expectedSize) {
      strokeData.buffers.paint = new Uint8Array(expectedSize);
    }
    if (strokeData.buffers.gid.length !== expectedSize) {
      strokeData.buffers.gid = new Uint8Array(expectedSize);
    }
    if (strokeData.buffers.spd.length !== expectedSize) {
      strokeData.buffers.spd = new Uint8Array(expectedSize);
    }
    if (strokeData.buffers.flow.length !== expectedSize) {
      strokeData.buffers.flow = new Uint8Array(expectedSize);
    }
    if (strokeData.buffers.def.length !== expectedSize) {
      strokeData.buffers.def = new Uint16Array(expectedSize);
    }
    // Copy buffer (best-effort): if sizes differ, copy the overlapping region
    if (incoming.length > 0) {
      if (incoming.length === expectedSize) {
        strokeData.buffers.paint.set(incoming);
      } else {
        const copyLen = Math.min(expectedSize, incoming.length);
        strokeData.buffers.paint.fill(0);
        strokeData.buffers.paint.set(incoming.subarray(0, copyLen));
      }
    } else if (!expectsContent && hadExistingContent) {
      // Snapshot explicitly represents an empty state — clear prior contents lazily.
      strokeData.buffers.paint.fill(0);
      strokeData.buffers.def.fill(0);
    }
    if (incomingGradient) {
      if (incomingGradient.length === expectedSize) {
        strokeData.buffers.gid.set(incomingGradient);
      } else {
        const copyLen = Math.min(expectedSize, incomingGradient.length);
        strokeData.buffers.gid.fill(0);
        strokeData.buffers.gid.set(incomingGradient.subarray(0, copyLen));
      }
      const remapSlot = animatorIndex?.legacyRemap?.to ?? 0;
      const remapFrom = animatorIndex?.legacyRemap?.from ?? 63;
      for (let i = 0; i < strokeData.buffers.gid.length; i += 1) {
        let raw = strokeData.buffers.gid[i] & FLOW_SLOT_MASK;
        if (raw === remapFrom) {
          raw = remapSlot;
        }
        strokeData.buffers.gid[i] = raw;
      }
    } else if (!expectsContent && hadExistingContent) {
      strokeData.buffers.gid.fill(0);
    }
    if (incomingGradientDef) {
      if (incomingGradientDef.length === expectedSize) {
        strokeData.buffers.def.set(incomingGradientDef);
      } else {
        const copyLen = Math.min(expectedSize, incomingGradientDef.length);
        strokeData.buffers.def.fill(0);
        strokeData.buffers.def.set(incomingGradientDef.subarray(0, copyLen));
      }
    } else if (!expectsContent && hadExistingContent) {
      strokeData.buffers.def.fill(0);
    }
    if (incomingSpeed) {
      if (incomingSpeed.length === expectedSize) {
        strokeData.buffers.spd.set(incomingSpeed);
      } else {
        const copyLen = Math.min(expectedSize, incomingSpeed.length);
        strokeData.buffers.spd.fill(0);
        strokeData.buffers.spd.set(incomingSpeed.subarray(0, copyLen));
      }
    } else if (!expectsContent && hadExistingContent) {
      strokeData.buffers.spd.fill(0);
    }
    if (incomingFlow) {
      if (incomingFlow.length === expectedSize) {
        strokeData.buffers.flow.set(incomingFlow);
      } else {
        const copyLen = Math.min(expectedSize, incomingFlow.length);
        strokeData.buffers.flow.fill(0);
        strokeData.buffers.flow.set(incomingFlow.subarray(0, copyLen));
      }
    } else if (!expectsContent && hadExistingContent) {
      strokeData.buffers.flow.fill(0);
    }
    if (!incomingSpeed && strokeData.buffers.spd.length === expectedSize) {
      try {
        const state = useAppStore.getState();
        const layer = state.layers.find((candidate) => candidate.id === layerId);
        const fallbackSpeed =
          resolveLayerColorCycleBaseSpeedFromLayer(layer)
            ?? state.tools.brushSettings.colorCycleSpeed
            ?? 0.1;
        const speedByte = encodeColorCycleSpeedByte(sanitizeBrushColorCycleSpeed(fallbackSpeed));
        for (let i = 0; i < strokeData.buffers.paint.length; i += 1) {
          strokeData.buffers.spd[i] = strokeData.buffers.paint[i] === 0 ? 0 : speedByte;
        }
      } catch {}
    }
    if (!incomingFlow && strokeData.buffers.flow.length === expectedSize) {
      try {
        const state = useAppStore.getState();
        const layer = state.layers.find((candidate) => candidate.id === layerId);
        const flowMode =
          layer?.colorCycleData?.flowMode
            ?? this.flowMode
            ?? 'forward';
        const flowByte = this.getFlowByteForMode(flowMode);
        for (let i = 0; i < strokeData.buffers.paint.length; i += 1) {
          strokeData.buffers.flow[i] = strokeData.buffers.paint[i] === 0 ? 0 : flowByte;
        }
      } catch {}
    }
    let hasLayerContent = expectsContent;
    if (!hasLayerContent && animatorIndex?.data) {
      try {
        const dataArr = new Uint8Array(animatorIndex.data);
        if (dataArr.some((value) => value !== 0)) {
          hasLayerContent = true;
        }
      } catch {}
    }

    if (animatorIndex?.slotPalettes?.length) {
      for (const palette of animatorIndex.slotPalettes) {
        this.setGradientSlotStops(layerId, palette.slot, palette.stops);
      }
    }
    if (typeof animatorIndex?.paintSlot === 'number') {
      this.setActiveGradientSlot(layerId, animatorIndex.paintSlot);
    } else if (animatorIndex?.gradientDefs?.length && animatorIndex.activeGradientId) {
      const activeDef = animatorIndex.gradientDefs.find((entry) => entry.id === animatorIndex.activeGradientId);
      if (activeDef) {
        this.setActiveGradientSlot(layerId, activeDef.currentSlot);
      }
    }

    strokeData.hasContent = hasLayerContent;
    strokeData.externalBase.hasExternalBase = false;
    strokeData.strokeCounter = snapshot.strokeCounter || 0;
    strokeData.lastPoint = null;
    strokeData.stampCounter = 0;
    strokeData.strokePhaseUnits = 0;
    strokeData.stampDither = undefined;
    const liveHandle = animator ? animator.beginDirectFill() : null;
    const livePaint =
      incoming.length === expectedSize
        ? incoming
        : animatorIndex?.data
          ? new Uint8Array(animatorIndex.data)
          : liveHandle?.data ?? strokeData.buffers.paint;
    const liveGid = animatorIndex?.gradientIdData
      ? new Uint8Array(animatorIndex.gradientIdData)
      : liveHandle?.gradientId ?? strokeData.buffers.gid;
    const liveSpeed = animatorIndex?.speedData
      ? new Uint8Array(animatorIndex.speedData)
      : liveHandle?.speedData ?? strokeData.buffers.spd;
    const liveFlow = animatorIndex?.flowData
      ? new Uint8Array(animatorIndex.flowData)
      : liveHandle?.flowData ?? strokeData.buffers.flow;
    const liveDef = strokeData.buffers.def;
    if (liveHandle) {
      animator?.endDirectFill({ markDirty: false });
    }
    strokeData.snapshot = {
      paintBuffer: hasLayerContent && livePaint && livePaint.length > 0
        ? livePaint.slice().buffer
        : new ArrayBuffer(0),
      gradientIdBuffer: hasLayerContent && liveGid && liveGid.length > 0
        ? liveGid.slice().buffer
        : snapshot.gradientIdBuffer?.slice(0),
      gradientDefIdBuffer: hasLayerContent && liveDef && liveDef.length > 0
        ? liveDef.slice().buffer
        : snapshot.gradientDefIdBuffer?.slice(0),
      speedBuffer: hasLayerContent && liveSpeed && liveSpeed.length > 0
        ? liveSpeed.slice().buffer
        : snapshot.speedBuffer?.slice(0),
      flowBuffer: hasLayerContent && liveFlow && liveFlow.length > 0
        ? liveFlow.slice().buffer
        : snapshot.flowBuffer?.slice(0),
      hasContent: hasLayerContent,
      strokeCounter: strokeData.strokeCounter
    };
    this.layerStrokes.set(layerId, strokeData);

    // Keep animator in sync with externally supplied paint buffer so renders reflect new data.
    try {
      const uploadPaint = incoming.length === expectedSize ? incoming : strokeData.buffers.paint;
      const uploadGid = incomingGradient ?? strokeData.buffers.gid ?? undefined;
      const uploadSpd = incomingSpeed ?? strokeData.buffers.spd ?? undefined;
      const uploadFlow = incomingFlow ?? strokeData.buffers.flow ?? undefined;
      animator?.setIndexBufferFromArray(uploadPaint, uploadGid, uploadSpd, uploadFlow);
      if (animator && strokeData) {
        this.bindStrokeBuffersToAnimator(strokeData, animator);
        try {
          const layer = useAppStore.getState().layers.find((entry) => entry.id === layerId);
          const defs = layer?.colorCycleData?.gradientDefStore as Array<{
            id: number;
            hash: string;
            stops: GradientStop[];
          }> | undefined;
          this.applyDefBindingsForLayer(layerId, animator, strokeData, defs);
        } catch {}
      }
      if (hasLayerContent) {
        this.snapshotFromBuffers(strokeData);
      }
      const dims = animator?.getDimensions?.();
      if (dims) {
        animator.markDirtyBounds({ minX: 0, minY: 0, width: dims.width, height: dims.height });
      }
    } catch {}

    // Mark layer dirty so next render updates
    this.dirtyLayers.add(layerId);

    // quiet
  }

  applyPaintPatch(
    layerId: string,
    roi: { x: number; y: number; width: number; height: number },
    bytes: Uint8Array,
    extras?: {
      gradientIdBytes?: Uint8Array;
      speedBytes?: Uint8Array;
      flowBytes?: Uint8Array;
    }
  ): boolean {
    const width = this.width;
    const height = this.height;
    if (!width || !height) {
      return false;
    }

    const x = Math.max(0, Math.floor(roi.x));
    const y = Math.max(0, Math.floor(roi.y));
    const right = Math.min(width, Math.ceil(roi.x + roi.width));
    const bottom = Math.min(height, Math.ceil(roi.y + roi.height));
    const patchWidth = right - x;
    const patchHeight = bottom - y;
    if (patchWidth <= 0 || patchHeight <= 0) {
      return false;
    }
    if (bytes.length < patchWidth * patchHeight) {
      return false;
    }
    if (extras?.gradientIdBytes && extras.gradientIdBytes.length < patchWidth * patchHeight) {
      return false;
    }
    if (extras?.speedBytes && extras.speedBytes.length < patchWidth * patchHeight) {
      return false;
    }
    if (extras?.flowBytes && extras.flowBytes.length < patchWidth * patchHeight) {
      return false;
    }

    const strokeData = this.ensureStrokeState(layerId);
    const animator = this.ensureFullResolution(layerId, 'restore');
    this.bindStrokeBuffersToAnimator(strokeData, animator);

    const paint = strokeData.buffers.paint;
    const gid = strokeData.buffers.gid;
    const spd = strokeData.buffers.spd;
    const flow = strokeData.buffers.flow;
    let hasNonZero = strokeData.hasContent;
    let srcIndex = 0;
    for (let row = 0; row < patchHeight; row += 1) {
      const destBase = (y + row) * width + x;
      for (let col = 0; col < patchWidth; col += 1) {
        const value = bytes[srcIndex++] ?? 0;
        const destIndex = destBase + col;
        paint[destIndex] = value;
        if (extras?.gradientIdBytes) {
          gid[destIndex] = extras.gradientIdBytes[srcIndex - 1] ?? 0;
        }
        if (extras?.speedBytes) {
          spd[destIndex] = extras.speedBytes[srcIndex - 1] ?? 0;
        }
        if (extras?.flowBytes) {
          flow[destIndex] = extras.flowBytes[srcIndex - 1] ?? 0;
        }
        if (!hasNonZero && value !== 0) {
          hasNonZero = true;
        }
      }
    }

    strokeData.hasContent = hasNonZero;
    this.layerStrokes.set(layerId, strokeData);

    try {
      animator.setIndexBufferFromArray(
        strokeData.buffers.paint,
        strokeData.buffers.gid,
        strokeData.buffers.spd,
        strokeData.buffers.flow
      );
      this.bindStrokeBuffersToAnimator(strokeData, animator);
      this.snapshotFromBuffers(strokeData);
    } catch {}

    try {
      animator.markDirtyBounds({
        minX: x,
        minY: y,
        width: patchWidth,
        height: patchHeight,
      });
    } catch {}

    this.dirtyLayers.add(layerId);
    return hasNonZero;
  }

  /**
   * Update gradient (async version for compatibility with tests)
   */
  async updateGradient(gradient: Array<{ position: number; color: string; opacity?: number }>): Promise<void> {
    const layerId = this.activeLayerId ?? 'default';
    this.setLayerId(layerId);
    this.setActiveLayer(layerId);
    this.setGradient(gradient, layerId);
  }

  /**
   * Start cycling animation
   */
  startCycling(): void {
    this.resumeAnimation();
  }

  /**
   * Stop cycling animation
   */
  stopCycling(): void {
    this.pauseAnimation();
  }

  /**
   * Dispose resources and cleanup
   */
  dispose(): void {
    // Stop all animations
    this.pauseAnimation();
    
    // Clear all animators
    for (const [layerId, animator] of this.animators) {
      try {
        const anyAnimator = animator as unknown as {
          dispose?: () => void;
          destroy?: () => void;
          cleanup?: () => void;
          stop: () => void;
        };
        if (typeof anyAnimator.dispose === 'function') {
          anyAnimator.dispose();
        } else if (typeof anyAnimator.destroy === 'function') {
          anyAnimator.destroy();
        } else if (typeof anyAnimator.cleanup === 'function') {
          anyAnimator.cleanup();
        } else {
          anyAnimator.stop();
        }
      } catch (error) {
        console.warn(`Error disposing animator for layer ${layerId}:`, error);
      }
    }
    this.animators.clear();
    
    // Clear stroke data
    this.layerStrokes.clear();
    this.dirtyLayers.clear();
    this.gradientSignatures.clear();
    this.gradientSlotsByLayer.clear();
    this.gradientSlotSignaturesByLayer.clear();
    this.activeGradientSlots.clear();
    this.defPaletteCacheByLayer.clear();
    
    console.log('ColorCycleBrushCanvas2D disposed');
  }

  private static computeGradientSignature(
    stops: GradientStop[],
    seamProfile: GradientSeamProfile = 'hard',
  ): string {
    if (!stops || stops.length === 0) {
      return appendGradientSeamProfileSignature('[]', seamProfile);
    }

    const signature = stops
      .map((stop) => {
        const pos = Number.isFinite(stop.position) ? stop.position.toFixed(6) : 'NaN';
        const color = stop.color;
        if (typeof color === 'string') {
          return `${pos}:${color}`;
        }
        if (color && typeof color === 'object') {
          const { r = 0, g = 0, b = 0 } = color as { r?: number; g?: number; b?: number };
          return `${pos}:${Math.round(r)}-${Math.round(g)}-${Math.round(b)}`;
        }
        return `${pos}:?`;
      })
      .join('|');
    return appendGradientSeamProfileSignature(signature, seamProfile);
  }
}
