/**
 * ColorCycleBrushCanvas2D - Canvas 2D implementation of color cycling
 * Replaces WebGL with efficient indexed color system using Canvas 2D
 * Maintains API compatibility with original ColorCycleBrush
 */

import { ColorCycleAnimator } from '../../lib/ColorCycleAnimator';
// Debug logs suppressed for color cycle brush
import { GradientStop } from '../../lib/GradientPalette';
import { applyPressureCurve } from '../../utils/pressureCurve';
import { applyDitheringWithFillResolution } from './dithering';
import { useAppStore } from '@/stores/useAppStore';
import { canvasPool } from '@/utils/canvasPool';
import { ccLog, ccWarn } from '@/utils/colorCycle/ccDebug';
import { fillConcentricIndices } from '@/utils/colorCycle/concentricFillCore';
import { applyEdgePadding } from '@/utils/colorCycle/fillMath';
import { simplifyToVertexLimit } from '@/utils/polygonSimplify';
import { getMaskManager } from '@/layers/MaskManager';
import { recordColorCycleFillPerf } from '@/utils/perf/ccPerfProbe';
import { runConcentricFillJob, runPerceptualDitherJob } from '@/workers/colorCycleFillClient';
import type { PaletteMapEntry } from '@/workers/colorCycleFillTypes';
import {
  applyPressureDither,
  BAYER_8x8_MATRIX,
  BLUE_NOISE_16x16,
  VOID_CLUSTER_8x8,
} from '@/utils/ditherAlgorithms';
import type { DitherAlgorithm, PatternStyle } from '@/utils/ditherAlgorithms';
import { computePressureResolution, createPressureResolutionState } from '@/utils/pressureResolution';
import type { DerivedGradientSpec } from '@/types';
import { FLOW_SLOT_MASK, encodeFlowSlot, type FlowMode } from '@/lib/colorCycle/flowEncoding';

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
}

type RgbColor = { r: number; g: number; b: number };
type ErrorDiffusionTap = { dx: number; dy: number; weight: number };
type StrokeFillHandle = ReturnType<ColorCycleAnimator['beginDirectFill']>;

type LayerStrokeState = {
  paintBuffer: Uint8Array;
  gradientIdBuffer?: Uint8Array;
  hasContent: boolean;
  strokeCounter: number;
  strokeLength: number;
  lastPoint: { x: number; y: number } | null;
  gradientLayerIndices: number[];
  currentGradientIndex: number;
  stampCounter: number;
  activeGradientSlot: number;
  hasExternalBase?: boolean;
  lastSnapshot?: StrokeDataSnapshot;
  stampDitherOrigin?: { x: number; y: number } | null;
  stampDitherSeed?: number;
  stampDitherPressureState?: ReturnType<typeof createPressureResolutionState> | null;
  stampDitherOwner?: Uint16Array;
  stampDitherStampSeq?: number;
  stampDitherPrimaryBuffer?: Uint8Array;
  stampDitherBaseIdx?: Uint8Array;
  stampDitherBaseGid?: Uint8Array;
  stampDitherBaseMask?: Uint8Array;
  stampDitherLockedBucket?: number;
  stampDitherStrokeScale?: number;
  stampDitherOriginUnits?: { x: number; y: number } | null; // 0..TILE-1, scale-free
  stampDitherOriginBaseSize?: number;
  stampDitherBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  stampDitherLastTileScale?: number | null;
  stampDitherChoice?: Uint8Array;
  stampSeqMeta?: Array<[number, number]>;
  stampSeqToTileScale?: Uint16Array;
  stampDitherRecomposeLastMs?: number;
  stampDitherRecomposePending?: boolean;
  stampDitherRecomposeScale?: number;
  stampDitherFillHandle?: StrokeFillHandle;
  stampFlowMode?: FlowMode;
  stampFlowEncoded?: boolean;
};
    
type AnimatorSerializedState = ReturnType<ColorCycleAnimator['serialize']>;

interface AnimatorIndexSnapshot {
  width: number;
  height: number;
  data: ArrayBuffer;
  gradientIdData?: ArrayBuffer;
  gradientStops?: GradientStop[];
  gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
  slotPalettes?: Array<{ slot: number; stops: GradientStop[] }>;
  activeGradientId?: string;
}

interface StrokeDataSnapshot {
  paintBuffer: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  hasContent: boolean;
  strokeCounter: number;
}

interface SerializedLayerState {
  layerId: string;
  data: AnimatorSerializedState;
  strokeData?: StrokeDataSnapshot;
  gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
  slotPalettes?: Array<{ slot: number; stops: GradientStop[] }>;
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
  hasContent?: boolean;
  strokeCounter?: number;
  animatorIndex?: AnimatorIndexSnapshot;
};

type LayerSnapshots = Map<string, ArrayBuffer> | LayerSnapshotEntry[];

interface ColorCycleBrushCanvasState {
  cycleSpeed?: number;
  fps?: number;
  brushSize?: number;
  layerSnapshots?: LayerSnapshots;
  stampShape?: StampShape;
  stampDitherEnabled?: boolean;
  stampDitherPixelSize?: number;
  stampDitherAlgorithm?: DitherAlgorithm;
  stampDitherPatternStyle?: PatternStyle;
  stampDitherBgFill?: boolean;
  stampDitherClears?: boolean;
  stampDitherPressureLinked?: boolean;
  [key: string]: unknown;
}

type StampShape = 'square' | 'round' | 'triangle' | 'diamond';

interface ColorCycleBrushCanvasSerialized {
  layers: SerializedLayerState[];
  cycleSpeed: number;
  fps: number;
  brushSize: number;
  stampShape?: StampShape;
  stampDitherEnabled?: boolean;
  stampDitherPixelSize?: number;
  stampDitherAlgorithm?: DitherAlgorithm;
  stampDitherPatternStyle?: PatternStyle;
  stampDitherBgFill?: boolean;
  stampDitherClears?: boolean;
  stampDitherPressureLinked?: boolean;
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
const STAMP_DITHER_BUCKETS = 64;
const STAMP_DITHER_TILE_BASE_MIN = 64;
const STAMP_DITHER_TILE_BASE_MAX = 128;
const STAMP_DITHER_TILE_TARGET = 128;
const STAMP_DITHER_PHASE_STEPS = 8;
const STAMP_DITHER_COVERAGE_MIN = 0.25;
const STAMP_DITHER_COVERAGE_MAX = 0.75;
const STAMP_DITHER_COVERAGE_CLAMP_MIN = 0.35;
const STAMP_DITHER_COVERAGE_CLAMP_MAX = 0.65;

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
  private animators: Map<string, ColorCycleAnimator> = new Map();
  private activeLayerId: string | null = null;
  
  // Canvas references
  private webglCanvas: HTMLCanvasElement; // Keep name for compatibility
  private compositeCanvas: HTMLCanvasElement;
  private compositeCtx: CanvasRenderingContext2D;
  private forceCanvas2D: boolean = false;
  private concentricWorkerJobId: number = 0;
  
  // Core settings (match original API)
  private brushSize: number;
  private cycleSpeed: number;
  private fps: number;
  private gradientBands: number = 12; // Number of color bands in gradients
  private bandSpacing: number = 5; // Pixel spacing between bands
  private pressureEnabled: boolean = false; // Track if pressure is enabled
  private minPressure: number = 1; // Min size as percentage of base size (1-1000)
  private maxPressure: number = 200; // Max size as percentage of base size (1-1000) - 200 = 2x size at max pressure
  private ditherEnabled: boolean = false; // Sierra Lite dithering for shape fills
  private ditherStrength: number = 1.0; // 0..1 scaling for error diffusion
  private ditherPixelSize: number = 1; // coarse cell size for dithering (>=1)
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
  private strokeLength: number = 0;
  private lastPoint: { x: number; y: number } | null = null;
  private isDrawing: boolean = false;
  
  // Stamp tracking for gradient progression
  private stampCounter: number = 0;
  private totalGradientSteps: number = 256; // Total colors in gradient
  private flowMode: 'forward' | 'reverse' | 'pingpong' = 'reverse';
  private legacyFlowMode: FlowMode = 'reverse';
  
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
  private deferredAnimatorSizes: WeakMap<ColorCycleAnimator, { width: number; height: number }> = new WeakMap();

  private customStampSourceCache: WeakMap<ImageData, HTMLCanvasElement> = new WeakMap();
  private customStampCanvasCache: Map<string, HTMLCanvasElement> = new Map();
  private customStampMaskCache: Map<string, StampMaskCacheEntry> = new Map();
  private gradientSignatures: Map<string, string> = new Map();
  private gradientSlotsByLayer: Map<string, Map<number, GradientStop[]>> = new Map();
  private gradientSlotSignaturesByLayer: Map<string, Map<number, string>> = new Map();
  private activeGradientSlots: Map<string, number> = new Map();
  private stampDitherEnabled: boolean = false;
  private stampDitherPixelSize: number = 1;
  private stampDitherAlgorithm: DitherAlgorithm = 'sierra-lite';
  private stampDitherPatternStyle: PatternStyle = 'dots';
  private stampDitherBaseTiles: Map<string, Uint8Array> = new Map();
  private stampDitherTiles: Map<string, Uint8Array> = new Map();
  private stampDitherBgFill: boolean = true;
  private stampDitherPressureLinked: boolean = false;
  private preserveGradientPhaseOnChange: boolean = false;
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
    this.fps = options.fps || 30;
    this.pressureEnabled = false;
    this.minPressure = 1;
    this.maxPressure = 200; // Default to 2x size at max pressure
    this.clearStampDitherCache();
  }

  private ensureStrokeState(layerId: string): LayerStrokeState {
    let strokeData = this.layerStrokes.get(layerId);
    if (!strokeData) {
      strokeData = {
        paintBuffer: new Uint8Array(this.width * this.height),
        gradientIdBuffer: new Uint8Array(this.width * this.height),
        hasContent: false,
        strokeCounter: 0,
        strokeLength: 0,
        lastPoint: null,
        gradientLayerIndices: [],
        currentGradientIndex: 0,
        stampCounter: 0,
        activeGradientSlot: 0,
        hasExternalBase: false,
        stampDitherOrigin: null,
        stampDitherPressureState: null,
        stampDitherOwner: undefined,
        stampDitherStampSeq: 0,
        stampDitherPrimaryBuffer: undefined,
        stampDitherBaseIdx: undefined,
        stampDitherBaseGid: undefined,
        stampDitherBounds: null,
        stampDitherLastTileScale: null
      };
      this.layerStrokes.set(layerId, strokeData);
    }
    return strokeData;
  }

  markLayerHasExternalBase(layerId: string) {
    const strokeData = this.ensureStrokeState(layerId);
    strokeData.hasExternalBase = true;
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
      // quiet
      // PERFORMANCE FIX: Lazy initialization with smaller initial size
      const strokeData = this.layerStrokes.get(layerId);
      const useReducedSize = !strokeData?.hasContent;
      const initWidth = useReducedSize ? 256 : this.width;
      const initHeight = useReducedSize ? 256 : this.height;
      
      // quiet
      
      // Measure ColorCycleAnimator creation
      // debug timing (dev-only)
      // quiet
      const animator = new ColorCycleAnimator({
        width: initWidth,
        height: initHeight,
        fps: this.fps,
        speed: this.cycleSpeed,
        autoStart: false,
        lazyInit: true,
        forceCanvas2D: this.forceCanvas2D
      });
      // quiet
      animator.setFlowMode(this.legacyFlowMode);
      
      // Defer full initialization until first paint
      this.deferredAnimatorSizes.set(animator, { width: this.width, height: this.height });

      this.animators.set(layerId, animator);
      
      // Measure stroke data setup
      // quiet
      if (!this.layerStrokes.has(layerId)) {
        this.layerStrokes.set(layerId, {
          paintBuffer: new Uint8Array(0), // Start with empty buffer
          gradientIdBuffer: new Uint8Array(0),
          hasContent: false,
          strokeCounter: 0,
          strokeLength: 0,
          lastPoint: null,
          gradientLayerIndices: [],
          currentGradientIndex: 0,
          stampCounter: 0,
          activeGradientSlot: 0,
          hasExternalBase: false,
          stampDitherOrigin: null,
          stampDitherPressureState: null,
          stampDitherOwner: undefined,
          stampDitherStampSeq: 0,
          stampDitherPrimaryBuffer: undefined,
          stampDitherBaseIdx: undefined,
          stampDitherBaseGid: undefined,
          stampDitherBounds: null,
          stampDitherLastTileScale: null
        });
      }
      // quiet

      // quiet
    }
    
    const animator = this.animators.get(layerId);
    if (!animator) {
      throw new Error(`Failed to get or create animator for layer: ${layerId}`);
    }
    
    // Resize on first actual use if needed
    const strokeData = this.layerStrokes.get(layerId);
    const deferredSize = this.deferredAnimatorSizes.get(animator);
    if (deferredSize && strokeData?.hasContent) {
      const { width, height } = deferredSize;
      animator.resize(width, height);
      this.deferredAnimatorSizes.delete(animator);
      
      // Also resize paint buffer
      strokeData.paintBuffer = new Uint8Array(width * height);
      strokeData.gradientIdBuffer = new Uint8Array(width * height);
    }
    
    return animator;
  }

  private resolveFlowSlot(strokeData: LayerStrokeState | null | undefined, activeSlot: number): number {
    if (!strokeData?.stampFlowEncoded || !strokeData.stampFlowMode) {
      return activeSlot;
    }
    if (activeSlot > FLOW_SLOT_MASK) {
      return activeSlot;
    }
    return encodeFlowSlot(activeSlot, strokeData.stampFlowMode);
  }
  
  /**
   * Paint at position (API compatible)
   */
  private prepareStrokeContext(layerId: string) {
    const id = layerId;
    const animator = this.getAnimator(id);
    let strokeData = this.layerStrokes.get(id);
    if (!strokeData) {
      strokeData = {
        paintBuffer: new Uint8Array(this.width * this.height),
        gradientIdBuffer: new Uint8Array(this.width * this.height),
        hasContent: true,
        strokeCounter: 0,
        strokeLength: 0,
        lastPoint: null,
        gradientLayerIndices: [],
        currentGradientIndex: 0,
        stampCounter: 0,
        activeGradientSlot: 0,
        hasExternalBase: false,
        stampDitherOrigin: null,
        stampDitherPressureState: null,
        stampDitherOwner: undefined,
        stampDitherStampSeq: 0,
        stampDitherPrimaryBuffer: undefined,
        stampDitherBaseIdx: undefined,
        stampDitherBaseGid: undefined,
        stampDitherBounds: null,
        stampDitherLastTileScale: null
      };
      this.layerStrokes.set(id, strokeData);
    } else if (!strokeData.hasContent) {
      strokeData.hasContent = true;
      if (strokeData.paintBuffer.length !== this.width * this.height) {
        strokeData.paintBuffer = new Uint8Array(this.width * this.height);
      }
      if (!strokeData.gradientIdBuffer || strokeData.gradientIdBuffer.length !== this.width * this.height) {
        strokeData.gradientIdBuffer = new Uint8Array(this.width * this.height);
      }
    }

    const deferredSize = this.deferredAnimatorSizes.get(animator);
    if (deferredSize) {
      const { width, height } = deferredSize;
      animator.resize(width, height);
      this.deferredAnimatorSizes.delete(animator);
      if (strokeData.paintBuffer.length !== width * height) {
        strokeData.paintBuffer = new Uint8Array(width * height);
      }
      if (!strokeData.gradientIdBuffer || strokeData.gradientIdBuffer.length !== width * height) {
        strokeData.gradientIdBuffer = new Uint8Array(width * height);
      }
    }

    const activeSlot = strokeData.activeGradientSlot ?? this.activeGradientSlots.get(id) ?? 0;
    strokeData.activeGradientSlot = activeSlot;

    return { id, animator, strokeData };
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
    const phaseIndex = Math.max(0, Math.min(254, strokeData.stampCounter % 255));
    const normalized = bands <= 1 ? 0 : phaseIndex / 254;
    const bandIndex = Math.max(0, Math.min(bands - 1, Math.round(normalized * (bands - 1))));
    return this.mapBandIndexToPaletteIndex(bandIndex, bands);
  }

  private resolveStampDitherCoverage(phase: number, colorIndex: number): number {
    const basePhase = this.isAnimating ? phase : 0.5;
    const clamped = Math.max(0, Math.min(1, basePhase));
    const steps = Math.max(2, STAMP_DITHER_PHASE_STEPS);
    const snapped = Math.round(clamped * (steps - 1)) / (steps - 1);
    const eased = STAMP_DITHER_COVERAGE_MIN +
      (STAMP_DITHER_COVERAGE_MAX - STAMP_DITHER_COVERAGE_MIN) * snapped;
    const normalizedIndex = Math.max(0, Math.min(1, (colorIndex - 1) / 254));
    const extremity = Math.abs(normalizedIndex - 0.5) * 2;
    const pullToMid = Math.min(1, extremity * 0.85);
    const blended = eased + (0.5 - eased) * pullToMid;
    return Math.max(STAMP_DITHER_COVERAGE_CLAMP_MIN, Math.min(STAMP_DITHER_COVERAGE_CLAMP_MAX, blended));
  }

  private getSourceCanvasForStamp(stamp: CustomStampInput): HTMLCanvasElement {
    let source = this.customStampSourceCache.get(stamp.imageData);
    if (!source) {
      source = document.createElement('canvas');
      source.width = stamp.width;
      source.height = stamp.height;
      const ctx = source.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
      if (ctx) {
        ctx.putImageData(stamp.imageData, 0, 0);
      }
      this.customStampSourceCache.set(stamp.imageData, source);
    }
    return source;
  }

  private getScaledStampCanvas(stamp: CustomStampInput, width: number, height: number): HTMLCanvasElement {
    const baseKey = stamp.cacheKey || `anon:${stamp.imageData.width}x${stamp.imageData.height}`;
    const key = `${baseKey}:${width}x${height}`;
    let cached = this.customStampCanvasCache.get(key);
    if (!cached) {
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
    const cacheKey = this.getStampMaskCacheKey(stamp, targetWidth, targetHeight, rotation);
    const cached = this.customStampMaskCache.get(cacheKey);
    if (cached) {
      return cached;
    }

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

  paint(x: number, y: number, layerId?: string, pressure: number = 1.0, _rotation: number = 0) {
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
      const colorIndex = this.computeColorBandIndex(strokeData);
      const activeSlot = strokeData.activeGradientSlot ?? this.activeGradientSlots.get(id) ?? 0;
      const flowSlot = this.resolveFlowSlot(strokeData, activeSlot);
      
      // Calculate pressure-modulated brush size using smooth curve
      const pressureSize = this.pressureEnabled 
        ? Math.max(1, Math.round(this.brushSize * applyPressureCurve(
            pressure,
            this.minPressure,    // Already in percentage format (1-1000)
            this.maxPressure,    // Already in percentage format (1-1000)
            's-curve'            // Use smooth S-curve
          )))
        : this.brushSize;
      
      // Detailed paint debug removed
      
      const useStampDither = this.stampDitherEnabled;
      const baseTileScale = Math.max(1, this.stampDitherPixelSize);
      let tileScale = baseTileScale;
      if (useStampDither && this.stampDitherPressureLinked) {
        const pressureState =
          strokeData.stampDitherPressureState ?? createPressureResolutionState(1);
        strokeData.stampDitherPressureState = pressureState;
        const computed = computePressureResolution(
          baseTileScale,
          pressure,
          true,
          pressureState,
          undefined,
          Math.max(1, baseTileScale * 4)
        );
        tileScale = Math.max(1, Math.round(computed));
      } else {
        strokeData.stampDitherPressureState = null;
      }
      if (strokeData.stampDitherStrokeScale == null) {
        strokeData.stampDitherStrokeScale = tileScale;
      } else {
        strokeData.stampDitherStrokeScale = tileScale;
      }
      const tileScaleInt = tileScale;
      let tileSize = useStampDither ? STAMP_DITHER_TILE_BASE_MIN * tileScaleInt : undefined;
      let primaryIndex = colorIndex;
      let tile: Uint8Array | undefined;
      let maskOriginX: number | undefined;
      let maskOriginY: number | undefined;
      let stampBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

      if (useStampDither) {
        if (!this.stampDitherBgFill && !strokeData.stampDitherBaseMask) {
          this.ensureStampDitherBaseBuffers(strokeData);
        }
        if (strokeData.stampDitherLockedBucket == null) {
          const phaseForMask = 0.5;
          const idxForMask = this.computeColorBandIndex(strokeData);
          const coverage = this.resolveStampDitherCoverage(phaseForMask, idxForMask);
          const rawBucket = this.resolveStampDitherBucket(coverage);
          strokeData.stampDitherLockedBucket = Math.min(
            STAMP_DITHER_BUCKETS - 2,
            Math.max(1, rawBucket)
          );
        }

      const lastScale = strokeData.stampDitherLastTileScale;
      if (lastScale == null) {
        strokeData.stampDitherLastTileScale = tileScaleInt;
      } else if (lastScale !== tileScaleInt) {
        strokeData.stampDitherLastTileScale = tileScaleInt;
        this.scheduleStampDitherRecompose(strokeData, animator, flowSlot, tileScaleInt);
      }

        const rawAlgo = this.stampDitherAlgorithm || 'sierra-lite';
        const algo = rawAlgo === 'pattern' ? 'pattern' : 'sierra-lite';
        if (algo === 'pattern') {
          const baseSize = this.resolveStampDitherBaseSize(tileScaleInt);
          if (!strokeData.stampDitherOriginUnits || strokeData.stampDitherOriginBaseSize !== baseSize) {
            const seed = strokeData.stampDitherSeed ?? 0;
            strokeData.stampDitherOriginUnits = {
              x: (seed % baseSize) | 0,
              y: ((seed >>> 16) % baseSize) | 0,
            };
            strokeData.stampDitherOriginBaseSize = baseSize;
          }
          tileSize = baseSize * tileScaleInt;
          const originU = strokeData.stampDitherOriginUnits ?? { x: 0, y: 0 };
          maskOriginX = -originU.x * tileScaleInt;
          maskOriginY = -originU.y * tileScaleInt;
          strokeData.stampDitherOrigin = { x: maskOriginX, y: maskOriginY };

          const bucket = strokeData.stampDitherLockedBucket ?? 1;
          tile = this.getStampDitherTile(bucket, tileScaleInt, baseSize, 'pattern', this.stampDitherPatternStyle);
        } else {
          const baseSize = this.resolveStampDitherBaseSize(tileScaleInt);
          if (!strokeData.stampDitherOriginUnits || strokeData.stampDitherOriginBaseSize !== baseSize) {
            const seed = strokeData.stampDitherSeed ?? 0;
            strokeData.stampDitherOriginUnits = {
              x: (seed % baseSize) | 0,
              y: ((seed >>> 16) % baseSize) | 0,
            };
            strokeData.stampDitherOriginBaseSize = baseSize;
          }
          tileSize = baseSize * tileScaleInt;
          const originU = strokeData.stampDitherOriginUnits ?? { x: 0, y: 0 };
          maskOriginX = -originU.x * tileScaleInt;
          maskOriginY = -originU.y * tileScaleInt;
          strokeData.stampDitherOrigin = { x: maskOriginX, y: maskOriginY };
          const bucket = strokeData.stampDitherLockedBucket ?? 1;
          tile = this.getStampDitherTile(bucket, tileScaleInt, baseSize, 'sierra-lite');
        }

        const nextSeq = (strokeData.stampDitherStampSeq ?? 0) + 1;
        strokeData.stampDitherStampSeq = nextSeq > 0xffff ? 0xffff : nextSeq;
        const stampSeq = strokeData.stampDitherStampSeq ?? 1;

        stampBounds = this.applyStampDitherMask(
          strokeData,
          this.stampShape,
          x,
          y,
          pressureSize,
          primaryIndex,
          stampSeq
        );
        if (stampBounds && strokeData.stampSeqMeta) {
          strokeData.stampSeqMeta.push([stampSeq, tileScaleInt]);
        }
      }

      // Paint with specific color index and pressure-modulated size
      if (this.stampShape === 'triangle') {
        if (useStampDither && tile && tileSize && stampBounds) {
          const bounds = stampBounds;
          this.applyStampDitherToRegion(
            strokeData,
            animator,
            bounds,
            tile,
            tileSize,
            maskOriginX ?? stampBounds.minX,
            maskOriginY ?? stampBounds.minY,
            flowSlot,
            strokeData.stampDitherStampSeq ?? 1
          );
        } else {
          animator.paintTriangle(x, y, pressureSize, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
        }
      } else if (this.stampShape === 'round') {
        if (useStampDither && tile && tileSize && stampBounds) {
          const bounds = stampBounds;
          this.applyStampDitherToRegion(
            strokeData,
            animator,
            bounds,
            tile,
            tileSize,
            maskOriginX ?? stampBounds.minX,
            maskOriginY ?? stampBounds.minY,
            flowSlot,
            strokeData.stampDitherStampSeq ?? 1
          );
        } else {
          animator.paintCircle(x, y, pressureSize, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
        }
      } else if (this.stampShape === 'diamond') {
        if (useStampDither && tile && tileSize && stampBounds) {
          const bounds = stampBounds;
          this.applyStampDitherToRegion(
            strokeData,
            animator,
            bounds,
            tile,
            tileSize,
            maskOriginX ?? stampBounds.minX,
            maskOriginY ?? stampBounds.minY,
            flowSlot,
            strokeData.stampDitherStampSeq ?? 1
          );
        } else {
          animator.paintDiamond(x, y, pressureSize, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
        }
      } else if (useStampDither && tile && tileSize && stampBounds) {
        const bounds = stampBounds;
        this.applyStampDitherToRegion(
          strokeData,
          animator,
          bounds,
          tile,
          tileSize,
          maskOriginX ?? stampBounds.minX,
          maskOriginY ?? stampBounds.minY,
          flowSlot,
          strokeData.stampDitherStampSeq ?? 1
        );
      } else {
        animator.paintSquare(x, y, pressureSize, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
      }
      
      // Update tracking
      strokeData.strokeLength++;
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
    rotation: number = 0
  ) {
    if (!stamp?.imageData) {
      return;
    }

    const targetLayerId = layerId || this.activeLayerId || 'default';
    const { id, animator, strokeData } = this.prepareStrokeContext(targetLayerId);
    const colorIndex = this.computeColorBandIndex(strokeData);

    const pressureMultiplier = this.pressureEnabled
      ? applyPressureCurve(pressure, this.minPressure, this.maxPressure, 's-curve')
      : 1;
    const targetSize = Math.max(1, Math.round(this.brushSize * pressureMultiplier));

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

    for (let py = 0; py < maskEntry.height; py++) {
      const targetY = originY + py;
      if (targetY < 0 || targetY >= this.height) continue;
      const rowOffset = py * maskEntry.width;
      for (let px = 0; px < maskEntry.width; px++) {
        const targetX = originX + px;
        if (targetX < 0 || targetX >= this.width) continue;
        if (alpha[rowOffset + px] < 16) continue;
        this.logSetIndexSample(id, targetX, targetY);
        const flowSlot = this.resolveFlowSlot(strokeData, strokeData.activeGradientSlot ?? 0);
        animator.setIndex(targetX, targetY, colorIndex, flowSlot);
      }
    }

    strokeData.strokeLength++;
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
  }

  private applyGradientForLayer(layerId: string, stops: GradientStop[]) {
    const animator = this.getAnimator(layerId);
    const activeSlot = this.activeGradientSlots.get(layerId) ?? 0;

    const signature = ColorCycleBrushCanvas2D.computeGradientSignature(stops);
    const previousSignature = this.gradientSignatures.get(layerId);
    const gradientChanged = signature !== previousSignature;

    if (gradientChanged) {
      this.gradientSignatures.set(layerId, signature);
    }

    // Update gradient for the active slot
    if (typeof animator.setGradientSlot === 'function') {
      animator.setGradientSlot(activeSlot, stops);
      animator.setActiveGradientSlot?.(activeSlot);
    } else {
      animator.setGradient(stops);
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
        strokeData.currentGradientIndex = strokeData.gradientLayerIndices.length;
        strokeData.gradientLayerIndices.push(strokeData.currentGradientIndex);
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
  setGradientSlot(layerId: string, slot: number, stops: GradientStop[]) {
    const id = layerId || this.activeLayerId || 'default';
    const clampedSlot = Math.max(0, Math.min(255, Math.round(slot)));

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

    const signature = ColorCycleBrushCanvas2D.computeGradientSignature(stops);
    const previousSignature = signatureMap.get(clampedSlot);
    const signatureChanged = signature !== previousSignature;

    if (!signatureChanged) {
      const activeSlot = this.activeGradientSlots.get(id);
      if (activeSlot === clampedSlot && this.gradientSignatures.get(id) !== signature) {
        this.applyGradientForLayer(id, stops);
      }
      return;
    }

    signatureMap.set(clampedSlot, signature);
    slotMap.set(clampedSlot, stops);

    if (this.activeGradientSlots.get(id) === clampedSlot) {
      this.applyGradientForLayer(id, stops);
    } else {
      const animator = this.getAnimator(id);
      if (typeof animator.setGradientSlot === 'function') {
        animator.setGradientSlot(clampedSlot, stops);
      }
    }
  }

  /**
   * Set the active gradient slot for a layer and apply it to the animator.
   */
  setActiveGradientSlot(layerId: string, slot: number) {
    const id = layerId || this.activeLayerId || 'default';
    const clampedSlot = Math.max(0, Math.min(255, Math.round(slot)));
    this.activeGradientSlots.set(id, clampedSlot);
    this.activeLayerId = id;
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.activeGradientSlot = clampedSlot;
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
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      // Clear the paint buffer to start fresh and mark the layer as having no live stroke content.
      strokeData.paintBuffer.fill(0);
      strokeData.hasContent = false;
      strokeData.hasExternalBase = true;
      // Preserve stampCounter to maintain gradient offset continuity across shapes
      // (intentionally left unchanged here).
      // Ensure our composite canvas is clean for the next draw
      this.compositeCtx.clearRect(0, 0, this.width, this.height);
    }
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

  private colorAtPosition(pos: number): { r: number; g: number; b: number } {
    const stops = this.currentGradientStops;
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
    this.stampDitherBaseTiles.clear();
    this.stampDitherTiles.clear();
  }

  private resolveStampDitherBucket(fraction: number): number {
    const clamped = Math.max(0, Math.min(1, fraction));
    return Math.round(clamped * (STAMP_DITHER_BUCKETS - 1));
  }

  private resolveStampDitherBaseSize(tileScale: number): number {
    const scale = Math.max(1, Math.floor(tileScale));
    const raw = Math.ceil(STAMP_DITHER_TILE_TARGET / scale);
    const clamped = Math.max(STAMP_DITHER_TILE_BASE_MIN, Math.min(STAMP_DITHER_TILE_BASE_MAX, raw));
    const rounded = Math.ceil(clamped / 8) * 8;
    return Math.max(STAMP_DITHER_TILE_BASE_MIN, Math.min(STAMP_DITHER_TILE_BASE_MAX, rounded));
  }

  private resolveStampDitherTileSample(
    tile: Uint8Array,
    tileSize: number,
    worldX: number,
    worldY: number,
    originX: number,
    originY: number,
    seed: number
  ): number {
    const size = Math.max(1, Math.floor(tileSize));
    const relX = worldX - originX;
    const relY = worldY - originY;
    const blockX = Math.floor(relX / size);
    const blockY = Math.floor(relY / size);
    let h = seed ^ Math.imul(blockX + 1, 0x27d4eb2d) ^ Math.imul(blockY + 1, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h ^= h >>> 12;
    const flipX = (h & 1) === 1;
    const flipY = (h & 2) === 2;
    const swap = (h & 4) === 4;
    const offsetX = (h >>> 3) % size;
    const offsetY = (h >>> 19) % size;

    let x = ((relX % size) + size) % size;
    let y = ((relY % size) + size) % size;
    x = (x + offsetX) % size;
    y = (y + offsetY) % size;
    if (swap) {
      const tmp = x;
      x = y;
      y = tmp;
    }
    if (flipX) x = size - 1 - x;
    if (flipY) y = size - 1 - y;

    const idx = (y * size + x) % tile.length;
    return tile[idx] ? 0.0 : 1.0;
  }

  private resolveStampDitherSecondaryIndex(primaryIndex: number): number {
    const offset = 64;
    if (!Number.isFinite(primaryIndex)) {
      return 1;
    }
    let next = Math.round(primaryIndex + offset);
    while (next > 255) {
      next -= 255;
    }
    if (next === primaryIndex) {
      next = primaryIndex > 1 ? primaryIndex - 1 : Math.min(255, primaryIndex + 1);
    }
    return Math.max(1, Math.min(255, next));
  }

  private isErrorDiffusionAlgorithm(algo?: DitherAlgorithm): boolean {
    switch (algo) {
      case 'floyd-steinberg':
      case 'jarvis-judice-ninke':
      case 'stucki':
      case 'burkes':
      case 'sierra-3':
      case 'sierra-2':
      case 'sierra-lite':
      case 'atkinson':
        return true;
      default:
        return false;
    }
  }

  private getErrorDiffusionKernel(algo: DitherAlgorithm): {
    taps: ErrorDiffusionTap[];
    divisor: number;
    serpentine: boolean;
    errorScale: number;
  } {
    switch (algo) {
      case 'floyd-steinberg':
        return {
          taps: [
            { dx: 1, dy: 0, weight: 7 },
            { dx: -1, dy: 1, weight: 3 },
            { dx: 0, dy: 1, weight: 5 },
            { dx: 1, dy: 1, weight: 1 },
          ],
          divisor: 16,
          serpentine: true,
          errorScale: 1,
        };
      case 'jarvis-judice-ninke':
        return {
          taps: [
            { dx: 1, dy: 0, weight: 7 }, { dx: 2, dy: 0, weight: 5 },
            { dx: -2, dy: 1, weight: 3 }, { dx: -1, dy: 1, weight: 5 }, { dx: 0, dy: 1, weight: 7 }, { dx: 1, dy: 1, weight: 5 }, { dx: 2, dy: 1, weight: 3 },
            { dx: -2, dy: 2, weight: 1 }, { dx: -1, dy: 2, weight: 3 }, { dx: 0, dy: 2, weight: 5 }, { dx: 1, dy: 2, weight: 3 }, { dx: 2, dy: 2, weight: 1 },
          ],
          divisor: 48,
          serpentine: true,
          errorScale: 1,
        };
      case 'stucki':
        return {
          taps: [
            { dx: 1, dy: 0, weight: 8 }, { dx: 2, dy: 0, weight: 4 },
            { dx: -2, dy: 1, weight: 2 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 8 }, { dx: 1, dy: 1, weight: 4 }, { dx: 2, dy: 1, weight: 2 },
            { dx: -2, dy: 2, weight: 1 }, { dx: -1, dy: 2, weight: 2 }, { dx: 0, dy: 2, weight: 4 }, { dx: 1, dy: 2, weight: 2 }, { dx: 2, dy: 2, weight: 1 },
          ],
          divisor: 42,
          serpentine: true,
          errorScale: 1,
        };
      case 'burkes':
        return {
          taps: [
            { dx: 1, dy: 0, weight: 8 }, { dx: 2, dy: 0, weight: 4 },
            { dx: -2, dy: 1, weight: 2 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 8 }, { dx: 1, dy: 1, weight: 4 }, { dx: 2, dy: 1, weight: 2 },
          ],
          divisor: 32,
          serpentine: true,
          errorScale: 1,
        };
      case 'sierra-3':
        return {
          taps: [
            { dx: 1, dy: 0, weight: 5 }, { dx: 2, dy: 0, weight: 3 },
            { dx: -2, dy: 1, weight: 2 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 5 }, { dx: 1, dy: 1, weight: 4 }, { dx: 2, dy: 1, weight: 2 },
            { dx: -1, dy: 2, weight: 2 }, { dx: 0, dy: 2, weight: 3 }, { dx: 1, dy: 2, weight: 2 },
          ],
          divisor: 32,
          serpentine: true,
          errorScale: 1,
        };
      case 'sierra-2':
        return {
          taps: [
            { dx: 1, dy: 0, weight: 4 }, { dx: 2, dy: 0, weight: 3 },
            { dx: -2, dy: 1, weight: 1 }, { dx: -1, dy: 1, weight: 2 }, { dx: 0, dy: 1, weight: 3 }, { dx: 1, dy: 1, weight: 2 }, { dx: 2, dy: 1, weight: 1 },
          ],
          divisor: 32,
          serpentine: true,
          errorScale: 1,
        };
      case 'atkinson':
        return {
          taps: [
            { dx: 1, dy: 0, weight: 1 }, { dx: 2, dy: 0, weight: 1 },
            { dx: -1, dy: 1, weight: 1 }, { dx: 0, dy: 1, weight: 1 }, { dx: 1, dy: 1, weight: 1 },
            { dx: 0, dy: 2, weight: 1 },
          ],
          divisor: 8,
          serpentine: true,
          errorScale: 0.75,
        };
      case 'sierra-lite':
      default:
        return {
          taps: [
            { dx: 1, dy: 0, weight: 2 },
            { dx: -1, dy: 1, weight: 1 },
            { dx: 0, dy: 1, weight: 1 },
          ],
          divisor: 4,
          serpentine: true,
          errorScale: 1,
        };
    }
  }

  private hashStrokeDitherSeed(
    r: number,
    g: number,
    b: number,
    slot: number,
    strokeCounter: number
  ): number {
    let h = 0x811c9dc5;
    h = Math.imul(h ^ (r & 0xff), 0x01000193);
    h = Math.imul(h ^ (g & 0xff), 0x01000193);
    h = Math.imul(h ^ (b & 0xff), 0x01000193);
    h = Math.imul(h ^ (slot & 0xff), 0x01000193);
    h = Math.imul(h ^ (strokeCounter & 0xffffffff), 0x01000193);
    return h >>> 0;
  }

  private hashCellNoise(seed: number, cellX: number, cellY: number): number {
    let h = seed ^ Math.imul(cellX + 1, 0x27d4eb2d) ^ Math.imul(cellY + 1, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h ^= h >>> 12;
    return (h >>> 0) / 4294967295;
  }

  private buildStampSeqToTileScale(strokeData: LayerStrokeState, fallbackScale: number): Uint16Array {
    const maxSeq = strokeData.stampDitherStampSeq ?? 0;
    let lut = strokeData.stampSeqToTileScale;
    if (!lut || lut.length !== maxSeq + 1) {
      lut = new Uint16Array(maxSeq + 1);
    } else {
      lut.fill(0);
    }
    const meta = strokeData.stampSeqMeta ?? [];
    for (const [seq, scale] of meta) {
      if (seq >= 0 && seq <= maxSeq) {
        lut[seq] = Math.max(1, Math.min(0xffff, scale | 0));
      }
    }
    if (lut.length > 0 && fallbackScale > 0) {
      lut[0] = Math.max(1, Math.min(0xffff, fallbackScale | 0));
    }
    strokeData.stampSeqToTileScale = lut;
    return lut;
  }

  private finalizeStrokeErrorDiffusion(
    animator: ColorCycleAnimator,
    strokeData: LayerStrokeState,
    activeSlot: number
  ) {
    const bounds = strokeData.stampDitherBounds;
    const owner = strokeData.stampDitherOwner;
    const primary = strokeData.stampDitherPrimaryBuffer;
    if (!bounds || !owner || !primary) return;

    const algo = this.stampDitherAlgorithm ?? 'sierra-lite';
    if (!this.isErrorDiffusionAlgorithm(algo)) return;

    const fallbackScale = Math.max(1, strokeData.stampDitherStrokeScale ?? this.stampDitherPixelSize);
    const lut = this.buildStampSeqToTileScale(strokeData, fallbackScale);

    const width = this.width;
    const height = this.height;
    const minX = Math.max(0, Math.min(width - 1, bounds.minX));
    const maxX = Math.max(0, Math.min(width - 1, bounds.maxX));
    const minY = Math.max(0, Math.min(height - 1, bounds.minY));
    const maxY = Math.max(0, Math.min(height - 1, bounds.maxY));
    if (maxX < minX || maxY < minY) return;

    const choice = strokeData.stampDitherChoice && strokeData.stampDitherChoice.length === width * height
      ? strokeData.stampDitherChoice
      : new Uint8Array(width * height);
    strokeData.stampDitherChoice = choice;

    const scaleBounds = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
    for (let y = minY; y <= maxY; y += 1) {
      const row = y * width;
      for (let x = minX; x <= maxX; x += 1) {
        const idx = row + x;
        const seq = owner[idx];
        if (seq === 0) continue;
        const scale = lut[seq] || fallbackScale;
        let entry = scaleBounds.get(scale);
        if (!entry) {
          entry = { minX: x, minY: y, maxX: x, maxY: y };
          scaleBounds.set(scale, entry);
          continue;
        }
        entry.minX = Math.min(entry.minX, x);
        entry.minY = Math.min(entry.minY, y);
        entry.maxX = Math.max(entry.maxX, x);
        entry.maxY = Math.max(entry.maxY, y);
      }
    }

    if (scaleBounds.size === 0) return;

    const bucket = strokeData.stampDitherLockedBucket ?? 1;
    const coverage = bucket / Math.max(1, STAMP_DITHER_BUCKETS - 1);
    const kernel = this.getErrorDiffusionKernel(algo);
    const errorIntensity = Math.max(0, Math.min(1, this.ditherStrength)) * kernel.errorScale;
    const jitterScale = 0.1 * errorIntensity;
    const seed = strokeData.stampDitherSeed ?? 0;

    for (const [scale, scaleBound] of scaleBounds) {
      const cellSize = Math.max(1, Math.max(1, scale));
      const minCellX = Math.floor(scaleBound.minX / cellSize);
      const maxCellX = Math.floor(scaleBound.maxX / cellSize);
      const minCellY = Math.floor(scaleBound.minY / cellSize);
      const maxCellY = Math.floor(scaleBound.maxY / cellSize);
      const gridW = Math.max(1, maxCellX - minCellX + 1);
      const gridH = Math.max(1, maxCellY - minCellY + 1);
      const cellCount = gridW * gridH;

      const cellMask = new Uint8Array(cellCount);
      for (let y = scaleBound.minY; y <= scaleBound.maxY; y += 1) {
        const row = y * width;
        const cellY = Math.floor(y / cellSize) - minCellY;
        for (let x = scaleBound.minX; x <= scaleBound.maxX; x += 1) {
          const idx = row + x;
          const seq = owner[idx];
          if (seq === 0) continue;
          const seqScale = lut[seq] || fallbackScale;
          if (seqScale !== scale) continue;
          const cellX = Math.floor(x / cellSize) - minCellX;
          const cellIdx = cellY * gridW + cellX;
          cellMask[cellIdx] = 1;
        }
      }

      const cellChoice = new Uint8Array(cellCount);
      const errBuf = new Float32Array(cellCount);

      for (let cy = 0; cy < gridH; cy += 1) {
        const leftToRight = kernel.serpentine ? (cy & 1) === 0 : true;
        const xStart = leftToRight ? 0 : gridW - 1;
        const xEnd = leftToRight ? gridW : -1;
        const xStep = leftToRight ? 1 : -1;

        for (let cx = xStart; cx !== xEnd; cx += xStep) {
          const cellIdx = cy * gridW + cx;
          if (cellMask[cellIdx] === 0) continue;
          const globalCellX = cx + minCellX;
          const globalCellY = cy + minCellY;
          const jitter = jitterScale > 0 ? (this.hashCellNoise(seed, globalCellX, globalCellY) - 0.5) * 2 * jitterScale : 0;
          const value = Math.max(0, Math.min(1, coverage + errBuf[cellIdx] + jitter));
          const quant = value >= 0.5 ? 1 : 0;
          cellChoice[cellIdx] = quant;
          const error = (value - quant) * errorIntensity;
          if (error === 0) continue;
          for (const tap of kernel.taps) {
            const nx = cx + (leftToRight ? tap.dx : -tap.dx);
            const ny = cy + tap.dy;
            if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
            const nIdx = ny * gridW + nx;
            if (cellMask[nIdx] === 0) continue;
            errBuf[nIdx] += (error * tap.weight) / kernel.divisor;
          }
        }
      }

      for (let y = scaleBound.minY; y <= scaleBound.maxY; y += 1) {
        const row = y * width;
        const cellY = Math.floor(y / cellSize) - minCellY;
        for (let x = scaleBound.minX; x <= scaleBound.maxX; x += 1) {
          const idx = row + x;
          const seq = owner[idx];
          if (seq === 0) continue;
          const seqScale = lut[seq] || fallbackScale;
          if (seqScale !== scale) continue;
          const cellX = Math.floor(x / cellSize) - minCellX;
          const cellIdx = cellY * gridW + cellX;
          choice[idx] = cellChoice[cellIdx];
        }
      }
    }

    const handle = strokeData.stampDitherFillHandle ?? animator.beginDirectFill();
    const shouldCloseHandle = !strokeData.stampDitherFillHandle;
    const data = handle.data;
    const gid = handle.gradientId;
    const flowSlot = this.resolveFlowSlot(strokeData, activeSlot);
    const bgFillOff = !this.stampDitherBgFill;
    const base = strokeData.stampDitherBaseIdx;
    const baseG = strokeData.stampDitherBaseGid;
    const baseMask = strokeData.stampDitherBaseMask;

    for (let y = minY; y <= maxY; y += 1) {
      const row = y * width;
      for (let x = minX; x <= maxX; x += 1) {
        const idx = row + x;
        if (owner[idx] === 0) continue;
        const usePrimary = choice[idx] === 1;
        const primaryIndex = primary[idx];
        if (usePrimary) {
          data[idx] = primaryIndex;
          gid[idx] = primaryIndex === 0 ? 0 : flowSlot;
          continue;
        }
        if (bgFillOff) {
          if (base && baseMask && base.length === data.length) {
            const v = base[idx];
            data[idx] = v;
            if (v === 0) {
              gid[idx] = 0;
            } else if (baseG && baseG.length === gid.length) {
              gid[idx] = baseG[idx];
            } else {
              gid[idx] = flowSlot;
            }
          }
          continue;
        }
        const secondary = this.resolveStampDitherSecondaryIndex(primaryIndex);
        data[idx] = secondary;
        gid[idx] = secondary === 0 ? 0 : flowSlot;
      }
    }

    if (shouldCloseHandle) {
      const needsUpload = animator.hasWebGL?.() ?? false;
      animator.endDirectFill({ markDirty: needsUpload });
    }
    animator.markDirtyBounds({
      minX,
      minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    });
  }

  private ensureStampDitherBuffers(strokeData: LayerStrokeState) {
    const size = Math.max(1, this.width * this.height);
    if (!strokeData.stampDitherPrimaryBuffer || strokeData.stampDitherPrimaryBuffer.length !== size) {
      strokeData.stampDitherPrimaryBuffer = new Uint8Array(size);
    }
  }

  private ensureStampDitherBaseBuffers(strokeData: LayerStrokeState) {
    const size = Math.max(1, this.width * this.height);
    if (!strokeData.stampDitherBaseIdx || strokeData.stampDitherBaseIdx.length !== size) {
      strokeData.stampDitherBaseIdx = new Uint8Array(size);
    }
    if (!strokeData.stampDitherBaseGid || strokeData.stampDitherBaseGid.length !== size) {
      strokeData.stampDitherBaseGid = new Uint8Array(size);
    }
    if (!strokeData.stampDitherBaseMask || strokeData.stampDitherBaseMask.length !== size) {
      strokeData.stampDitherBaseMask = new Uint8Array(size);
    } else {
      strokeData.stampDitherBaseMask.fill(0);
    }
  }

  private ensureStampDitherOwner(strokeData: LayerStrokeState) {
    const size = Math.max(1, this.width * this.height);
    if (!strokeData.stampDitherOwner || strokeData.stampDitherOwner.length !== size) {
      strokeData.stampDitherOwner = new Uint16Array(size);
    }
  }

  private recomposeStampDitherOverlay(
    strokeData: LayerStrokeState,
    animator: ColorCycleAnimator,
    activeSlot: number,
    tileScale: number
  ) {
    const bounds = strokeData.stampDitherBounds;
    const owner = strokeData.stampDitherOwner;
    const primary = strokeData.stampDitherPrimaryBuffer;
    const base = strokeData.stampDitherBaseIdx;
    const baseG = strokeData.stampDitherBaseGid;
    const baseMask = strokeData.stampDitherBaseMask;
    if (!bounds || !owner || !primary) return;
    const rawAlgo = this.stampDitherAlgorithm || 'sierra-lite';
    const algo = rawAlgo === 'pattern' ? 'pattern' : 'sierra-lite';
    const bucket = strokeData.stampDitherLockedBucket ?? 1;
    const coverage = bucket / Math.max(1, STAMP_DITHER_BUCKETS - 1);
    const seed = strokeData.stampDitherSeed ?? 0;
    const bgFillOff = !this.stampDitherBgFill;
    if (bgFillOff && (!base || !baseMask)) {
      return;
    }
    const flowSlot = this.resolveFlowSlot(strokeData, activeSlot);
    const basePixelSize = Math.max(1, this.stampDitherPixelSize);
    const fallbackScale = Math.max(1, tileScale || basePixelSize);
    const lut = this.buildStampSeqToTileScale(strokeData, fallbackScale);
    const tileCache = new Map<number, { tile: Uint8Array; tileClamp: number; originX: number; originY: number }>();

    const handle = strokeData.stampDitherFillHandle ?? animator.beginDirectFill();
    const shouldCloseHandle = !strokeData.stampDitherFillHandle;
    const data = handle.data;
    const gid = handle.gradientId;
    const w = handle.width;
    const h = handle.height;
    const minX = Math.max(0, Math.min(w - 1, bounds.minX));
    const maxX = Math.max(0, Math.min(w - 1, bounds.maxX));
    const minY = Math.max(0, Math.min(h - 1, bounds.minY));
    const maxY = Math.max(0, Math.min(h - 1, bounds.maxY));

    for (let y = minY; y <= maxY; y += 1) {
      const row = y * w;
      for (let x = minX; x <= maxX; x += 1) {
        const idx = row + x;
        if (owner[idx] === 0) continue;
        const seqScale = lut[owner[idx]] || fallbackScale;
        let tileEntry = tileCache.get(seqScale);
        if (!tileEntry) {
          const baseSize = this.resolveStampDitherBaseSize(seqScale);
          const originU = {
            x: (seed % baseSize) | 0,
            y: ((seed >>> 16) % baseSize) | 0,
          };
          const originX = -originU.x * seqScale;
          const originY = -originU.y * seqScale;
          const tileClamp = baseSize * seqScale;
          const tile = this.getStampDitherTile(
            bucket,
            seqScale,
            baseSize,
            algo === 'pattern' ? undefined : 'sierra-lite',
            this.stampDitherPatternStyle
          );
          tileEntry = { tile, tileClamp, originX, originY };
          tileCache.set(seqScale, tileEntry);
        }
        const localY = ((y - tileEntry.originY) % tileEntry.tileClamp + tileEntry.tileClamp) % tileEntry.tileClamp;
        const tileRow = localY * tileEntry.tileClamp;
        const localX = ((x - tileEntry.originX) % tileEntry.tileClamp + tileEntry.tileClamp) % tileEntry.tileClamp;
        const tIdx = tileRow + localX;
        const p = primary[idx];
        const usePrimary =
          algo === 'pattern'
            ? (tileEntry.tile[tIdx] === 1)
            : (this.resolveStampDitherTileSample(
                tileEntry.tile,
                tileEntry.tileClamp,
                x,
                y,
                tileEntry.originX,
                tileEntry.originY,
                seed
              ) <= coverage);
        if (usePrimary) {
          data[idx] = p;
          gid[idx] = p === 0 ? 0 : flowSlot;
          continue;
        }
        if (bgFillOff) {
          if (base && baseMask && base.length === data.length) {
            const v = base[idx];
            data[idx] = v;
            if (v === 0) {
              gid[idx] = 0;
            } else if (baseG && baseG.length === gid.length) {
              gid[idx] = baseG[idx];
            } else {
              gid[idx] = flowSlot;
            }
          }
          continue;
        }
        const secondary = this.resolveStampDitherSecondaryIndex(p);
        data[idx] = secondary;
        gid[idx] = secondary === 0 ? 0 : flowSlot;
      }
    }

    if (shouldCloseHandle) {
      const needsUpload = animator.hasWebGL?.() ?? false;
      animator.endDirectFill({ markDirty: needsUpload });
    }
    animator.markDirtyBounds({
      minX,
      minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    });
  }

  private scheduleStampDitherRecompose(
    strokeData: LayerStrokeState,
    animator: ColorCycleAnimator,
    activeSlot: number,
    tileScale: number
  ) {
    const now = nowMs();
    const last = strokeData.stampDitherRecomposeLastMs ?? 0;
    const minInterval = 50;
    strokeData.stampDitherRecomposeScale = tileScale;
    if (strokeData.stampDitherRecomposePending) {
      return;
    }
    const run = () => {
      strokeData.stampDitherRecomposePending = false;
      strokeData.stampDitherRecomposeLastMs = nowMs();
      const nextScale = strokeData.stampDitherRecomposeScale ?? tileScale;
      this.recomposeStampDitherOverlay(strokeData, animator, activeSlot, nextScale);
    };
    const elapsed = now - last;
    strokeData.stampDitherRecomposePending = true;
    if (elapsed >= minInterval) {
      requestAnimationFrame(run);
    } else {
      const delay = Math.max(0, minInterval - elapsed);
      setTimeout(() => {
        requestAnimationFrame(run);
      }, delay);
    }
  }

  private updateStampDitherBounds(
    strokeData: LayerStrokeState,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ) {
    const clampedMinX = Math.max(0, Math.min(this.width - 1, minX));
    const clampedMaxX = Math.max(0, Math.min(this.width - 1, maxX));
    const clampedMinY = Math.max(0, Math.min(this.height - 1, minY));
    const clampedMaxY = Math.max(0, Math.min(this.height - 1, maxY));
    if (!strokeData.stampDitherBounds) {
      strokeData.stampDitherBounds = {
        minX: clampedMinX,
        minY: clampedMinY,
        maxX: clampedMaxX,
        maxY: clampedMaxY,
      };
      return;
    }
    strokeData.stampDitherBounds.minX = Math.min(strokeData.stampDitherBounds.minX, clampedMinX);
    strokeData.stampDitherBounds.minY = Math.min(strokeData.stampDitherBounds.minY, clampedMinY);
    strokeData.stampDitherBounds.maxX = Math.max(strokeData.stampDitherBounds.maxX, clampedMaxX);
    strokeData.stampDitherBounds.maxY = Math.max(strokeData.stampDitherBounds.maxY, clampedMaxY);
  }

  private applyStampDitherMask(
    strokeData: LayerStrokeState,
    shape: StampShape,
    x: number,
    y: number,
    brushSize: number,
    primaryIndex: number,
    stampSeq: number
  ): { minX: number; minY: number; maxX: number; maxY: number } {
    this.ensureStampDitherBuffers(strokeData);
    this.ensureStampDitherOwner(strokeData);
    const primary = strokeData.stampDitherPrimaryBuffer!;
    const owner = strokeData.stampDitherOwner!;
    const captureBase = !this.stampDitherBgFill && !!strokeData.stampDitherBaseMask;
    const baseMask = strokeData.stampDitherBaseMask;
    const baseIdx = strokeData.stampDitherBaseIdx;
    const baseGid = strokeData.stampDitherBaseGid;
    const paint = strokeData.paintBuffer;
    const gid = strokeData.gradientIdBuffer;
    const captureIfNeeded = (idx: number) => {
      if (!captureBase || !baseMask || !baseIdx) return;
      if (baseMask[idx] === 1) return;
      baseMask[idx] = 1;
      baseIdx[idx] = paint[idx];
      if (baseGid && gid) {
        baseGid[idx] = gid[idx];
      }
    };

    if (shape === 'triangle') {
      const halfSize = brushSize / 2;
      const topX = x;
      const topY = y - halfSize;
      const leftX = x - halfSize;
      const leftY = y + halfSize;
      const rightX = x + halfSize;
      const rightY = y + halfSize;
      const minX = Math.max(0, Math.floor(Math.min(leftX, rightX, topX)));
      const maxX = Math.min(this.width - 1, Math.floor(Math.max(leftX, rightX, topX)));
      const minY = Math.max(0, Math.floor(Math.min(topY, leftY, rightY)));
      const maxY = Math.min(this.height - 1, Math.floor(Math.max(topY, leftY, rightY)));
      const sign = (px: number, py: number, ax: number, ay: number, bx: number, by: number) =>
        (px - bx) * (ay - by) - (ax - bx) * (py - by);

      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const sampleX = px + 0.5;
          const sampleY = py + 0.5;
          const b1 = sign(sampleX, sampleY, topX, topY, leftX, leftY) <= 0;
          const b2 = sign(sampleX, sampleY, leftX, leftY, rightX, rightY) <= 0;
          const b3 = sign(sampleX, sampleY, rightX, rightY, topX, topY) <= 0;
          if ((b1 === b2) && (b2 === b3)) {
            const idx = py * this.width + px;
            captureIfNeeded(idx);
            primary[idx] = primaryIndex;
            owner[idx] = stampSeq;
          }
        }
      }
      this.updateStampDitherBounds(strokeData, minX, minY, maxX, maxY);
      return { minX, minY, maxX, maxY };
    }

    if (shape === 'round') {
      const radius = brushSize / 2;
      const radiusSq = radius * radius;
      const minX = Math.max(0, Math.floor(x - radius));
      const maxX = Math.min(this.width - 1, Math.ceil(x + radius));
      const minY = Math.max(0, Math.floor(y - radius));
      const maxY = Math.min(this.height - 1, Math.ceil(y + radius));
      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const dx = px + 0.5 - x;
          const dy = py + 0.5 - y;
          if (dx * dx + dy * dy > radiusSq) continue;
          const idx = py * this.width + px;
          captureIfNeeded(idx);
          primary[idx] = primaryIndex;
          owner[idx] = stampSeq;
        }
      }
      this.updateStampDitherBounds(strokeData, minX, minY, maxX, maxY);
      return { minX, minY, maxX, maxY };
    }

    if (shape === 'diamond') {
      const radius = brushSize / 2;
      const minX = Math.max(0, Math.floor(x - radius));
      const maxX = Math.min(this.width - 1, Math.floor(x + radius));
      const minY = Math.max(0, Math.floor(y - radius));
      const maxY = Math.min(this.height - 1, Math.floor(y + radius));
      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const dx = Math.abs(px + 0.5 - x);
          const dy = Math.abs(py + 0.5 - y);
          if (dx + dy > radius) continue;
          const idx = py * this.width + px;
          captureIfNeeded(idx);
          primary[idx] = primaryIndex;
          owner[idx] = stampSeq;
        }
      }
      this.updateStampDitherBounds(strokeData, minX, minY, maxX, maxY);
      return { minX, minY, maxX, maxY };
    }

    // square (default)
    const halfSize = brushSize / 2;
    const minX = Math.max(0, Math.floor(x - halfSize));
    const maxX = Math.min(this.width - 1, Math.floor(x + halfSize));
    const minY = Math.max(0, Math.floor(y - halfSize));
    const maxY = Math.min(this.height - 1, Math.floor(y + halfSize));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const idx = py * this.width + px;
        captureIfNeeded(idx);
        primary[idx] = primaryIndex;
        owner[idx] = stampSeq;
      }
    }
    this.updateStampDitherBounds(strokeData, minX, minY, maxX, maxY);
    return { minX, minY, maxX, maxY };
  }

  private buildBaseStampDitherTile(
    bucket: number,
    baseSize: number,
    algo: DitherAlgorithm,
    pattern: PatternStyle
  ): Uint8Array {
    const tileSize = Math.max(1, Math.floor(baseSize));
    const clampedBucket = Math.max(0, Math.min(STAMP_DITHER_BUCKETS - 1, bucket));
    const coverage = clampedBucket / Math.max(1, STAMP_DITHER_BUCKETS - 1);
    if (algo === 'pattern') {
      const mod = (value: number, base: number) => ((value % base) + base) % base;
      const result = new Uint8Array(tileSize * tileSize);
      for (let y = 0; y < tileSize; y += 1) {
        for (let x = 0; x < tileSize; x += 1) {
          let patternValue = 0;
          switch (pattern) {
            case 'dots': {
              const dotSize = 4;
              const dx = mod(x, dotSize) - dotSize / 2;
              const dy = mod(y, dotSize) - dotSize / 2;
              const distance = Math.sqrt(dx * dx + dy * dy) / (dotSize / 2);
              patternValue = Math.min(1, distance);
              break;
            }
            case 'lines': {
              const spacing = 4;
              const diagonal = mod(x + y, spacing);
              patternValue = diagonal / spacing;
              break;
            }
            case 'vertical-lines': {
              const spacing = 4;
              patternValue = mod(x, spacing) / spacing;
              break;
            }
            case 'horizontal-lines': {
              const spacing = 4;
              patternValue = mod(y, spacing) / spacing;
              break;
            }
            case 'crosshatch': {
              const spacing = 4;
              const vertical = mod(x, spacing) / spacing;
              const horizontal = mod(y, spacing) / spacing;
              patternValue = Math.min(vertical, horizontal);
              break;
            }
            case 'diagonal': {
              const spacing = 8;
              const dx = Math.abs(mod(x, spacing) - spacing / 2);
              const dy = Math.abs(mod(y, spacing) - spacing / 2);
              patternValue = (dx + dy) / spacing;
              break;
            }
            case 'tone-adaptive': {
              const lum = coverage;
              if (lum < 0.33) {
                const spacing = 3;
                patternValue = mod(x, spacing) / spacing;
              } else if (lum < 0.66) {
                const spacing = 4;
                const diag = mod(x + y, spacing);
                patternValue = diag / spacing;
              } else {
                const spacing = 5;
                patternValue = mod(y, spacing) / spacing;
              }
              break;
            }
          }
          result[y * tileSize + x] = patternValue <= coverage ? 1 : 0;
        }
      }
      return result;
    }
    const result = new Uint8Array(tileSize * tileSize);
    const fillFromMatrix = (matrix: number[][]) => {
      const matrixSize = matrix.length;
      for (let y = 0; y < tileSize; y += 1) {
        const row = matrix[y % matrixSize];
        for (let x = 0; x < tileSize; x += 1) {
          const threshold = row[x % matrixSize];
          result[y * tileSize + x] = threshold <= coverage ? 1 : 0;
        }
      }
    };

    if (algo === 'bayer') {
      fillFromMatrix(BAYER_8x8_MATRIX);
      return result;
    }
    if (algo === 'blue-noise') {
      fillFromMatrix(BLUE_NOISE_16x16);
      return result;
    }
    if (algo === 'void-and-cluster') {
      fillFromMatrix(VOID_CLUSTER_8x8);
      return result;
    }
    const ramp = new Uint8ClampedArray(tileSize * tileSize * 4);
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        const idx = (y * tileSize + x) * 4;
        const base = (x + y) / (2 * (tileSize - 1));
        const value = Math.round(Math.min(1, Math.max(0, base * 0.85 + 0.075)) * 255);
        ramp[idx] = value;
        ramp[idx + 1] = value;
        ramp[idx + 2] = value;
        ramp[idx + 3] = 255;
      }
    }
    const dithered = applyPressureDither(
      new ImageData(ramp, tileSize, tileSize),
      {
        algorithm: algo,
        pressure: 0.5,
        intensity: 1.0,
        bayerMatrixSize: 8,
        palette: [
          [0, 0, 0],
          [255, 255, 255],
        ],
      }
    );
    for (let i = 0; i < result.length; i += 1) {
      const idx = i * 4;
      const value = (dithered.data[idx] + dithered.data[idx + 1] + dithered.data[idx + 2]) / 3;
      result[i] = value <= coverage * 255 ? 1 : 0;
    }
    return result;
  }

  private applyStampDitherToRegion(
    strokeData: LayerStrokeState,
    animator: ColorCycleAnimator,
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    tile: Uint8Array,
    tileSize: number,
    maskOriginX: number,
    maskOriginY: number,
    activeSlot: number,
    stampSeq: number
  ) {
    const primary = strokeData.stampDitherPrimaryBuffer;
    const owner = strokeData.stampDitherOwner;
    if (!primary || !owner) {
      return;
    }

    const handle = strokeData.stampDitherFillHandle ?? animator.beginDirectFill();
    const shouldCloseHandle = !strokeData.stampDitherFillHandle;
    const data = handle.data;
    const gradientId = handle.gradientId;
    const width = handle.width;
    const minX = Math.max(0, Math.min(width - 1, bounds.minX));
    const maxX = Math.max(0, Math.min(width - 1, bounds.maxX));
    const minY = Math.max(0, Math.min(handle.height - 1, bounds.minY));
    const maxY = Math.max(0, Math.min(handle.height - 1, bounds.maxY));
    const tileClamp = Math.max(1, Math.floor(tileSize));
    const bgFillOff = !this.stampDitherBgFill;
    const flowSlot = this.resolveFlowSlot(strokeData, activeSlot);
    const bucket = strokeData.stampDitherLockedBucket ?? 1;
    const coverage = bucket / Math.max(1, STAMP_DITHER_BUCKETS - 1);

    for (let py = minY; py <= maxY; py++) {
      const rowOffset = py * width;
      const localY = ((py - maskOriginY) % tileClamp + tileClamp) % tileClamp;
      const tileRow = localY * tileClamp;
      let localX = ((minX - maskOriginX) % tileClamp + tileClamp) % tileClamp;
      for (let px = minX; px <= maxX; px++) {
        const idx = rowOffset + px;
        if (owner[idx] !== stampSeq) {
          localX += 1;
          if (localX === tileClamp) localX = 0;
          continue;
        }
        const tileIdx = tileRow + localX;
        const usePrimary = tile ? (tile[tileIdx] === 1) : false;
        if (bgFillOff && !usePrimary) {
          const base = strokeData.stampDitherBaseIdx;
          const baseG = strokeData.stampDitherBaseGid;
          const baseMask = strokeData.stampDitherBaseMask;
          if (base && baseMask && base.length === data.length) {
            const v = base[idx];
            data[idx] = v;
            if (v === 0) {
              gradientId[idx] = 0;
            } else if (baseG && baseG.length === gradientId.length) {
              gradientId[idx] = baseG[idx];
            } else {
              gradientId[idx] = flowSlot;
            }
          } else {
            localX += 1;
            if (localX === tileClamp) localX = 0;
            continue;
          }
          localX += 1;
          if (localX === tileClamp) localX = 0;
          continue;
        }
        const primaryIndex = primary[idx];

        if (usePrimary) {
          data[idx] = primaryIndex;
          gradientId[idx] = primaryIndex === 0 ? 0 : flowSlot;
          localX += 1;
          if (localX === tileClamp) localX = 0;
          continue;
        }

        const secondary = this.resolveStampDitherSecondaryIndex(primaryIndex);
        data[idx] = secondary;
        gradientId[idx] = secondary === 0 ? 0 : flowSlot;
        localX += 1;
        if (localX === tileClamp) localX = 0;
      }
    }

    if (shouldCloseHandle) {
      const needsUpload = animator.hasWebGL?.() ?? false;
      animator.endDirectFill({ markDirty: needsUpload });
    }
    animator.markDirtyBounds({
      minX,
      minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    });
  }

  private scaleStampDitherTile(base: Uint8Array, scale: number, baseSize: number): Uint8Array {
    if (scale <= 1) {
      return base;
    }
    const baseTileSize = Math.max(1, Math.floor(baseSize));
    const scaledSize = baseTileSize * scale;
    const scaled = new Uint8Array(scaledSize * scaledSize);
    for (let y = 0; y < scaledSize; y++) {
      const baseY = Math.floor(y / scale);
      for (let x = 0; x < scaledSize; x++) {
        const baseX = Math.floor(x / scale);
        const baseIdx = baseY * baseTileSize + baseX;
        scaled[y * scaledSize + x] = base[baseIdx];
      }
    }
    return scaled;
  }

  private getBaseStampDitherTile(
    bucket: number,
    baseSize: number,
    algoOverride?: DitherAlgorithm,
    patternOverride?: PatternStyle
  ): Uint8Array {
    const normalizedBucket = Math.max(0, Math.min(STAMP_DITHER_BUCKETS - 1, bucket | 0));
    const algo = algoOverride ?? this.stampDitherAlgorithm ?? 'sierra-lite';
    const pattern = patternOverride ?? this.stampDitherPatternStyle ?? 'dots';
    const sizeKey = Math.max(1, Math.floor(baseSize));
    const cacheKey = `${algo}|${pattern}|${normalizedBucket}|${sizeKey}`;
    let tile = this.stampDitherBaseTiles.get(cacheKey);
    if (!tile) {
      tile = this.buildBaseStampDitherTile(normalizedBucket, sizeKey, algo, pattern);
      this.stampDitherBaseTiles.set(cacheKey, tile);
    }
    return tile;
  }

  private getStampDitherTile(
    bucket: number,
    overrideScale: number,
    baseSize: number,
    algoOverride?: DitherAlgorithm,
    patternOverride?: PatternStyle
  ): Uint8Array {
    const normalizedBucket = Math.max(0, Math.min(STAMP_DITHER_BUCKETS - 1, bucket | 0));
    const algo = algoOverride ?? this.stampDitherAlgorithm ?? 'sierra-lite';
    const pattern = patternOverride ?? this.stampDitherPatternStyle ?? 'dots';
    const scale = Math.max(1, Math.floor(overrideScale));
    const sizeKey = Math.max(1, Math.floor(baseSize));
    const cacheKey = `${algo}|${pattern}|${normalizedBucket}|${sizeKey}|${scale}`;
    let tile = this.stampDitherTiles.get(cacheKey);
    if (!tile) {
      const baseTile = this.getBaseStampDitherTile(normalizedBucket, sizeKey, algo, pattern);
      tile = scale === 1 ? baseTile : this.scaleStampDitherTile(baseTile, scale, sizeKey);
      this.stampDitherTiles.set(cacheKey, tile);
    }
    return tile;
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
      const pos = n === 1 ? 0 : i / (n - 1);
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

  /**
   * Start new stroke (API compatible)
   */
  startStroke(layerId?: string, clearBuffer: boolean = false) {
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
    this.strokeLength = 0;
    this.lastPoint = null;
    
    // Before starting a new stroke, optionally separate from any existing content
    // by committing previous content to the target layer (if present) and
    // clearing internal buffers. We keep this conservative to avoid unwanted
    // cross-layer writes; renderDirectToCanvas will be called by higher-level
    // handlers during finalize.
    const animator = this.getAnimator(id);
    if (clearBuffer && !this._isHistoryRestore) {
      try { animator.clear(); } catch {}
    }
    animator.startStroke();
    
    const strokeData = this.layerStrokes.get(id);
    if (strokeData && !strokeData.hasContent) {
      strokeData.hasContent = true;
    }
    if (strokeData) {
      const expected = this.width * this.height;
      if (strokeData.paintBuffer.length === expected) {
        try {
          animator.setIndexBufferFromArray(
            strokeData.paintBuffer,
            strokeData.gradientIdBuffer
          );
        } catch {}
      }
      strokeData.activeGradientSlot = this.activeGradientSlots.get(id) ?? strokeData.activeGradientSlot ?? 0;
      strokeData.stampFlowMode = this.flowMode;
      strokeData.stampFlowEncoded = true;
      const seedSlot = strokeData.activeGradientSlot ?? 0;
      const colorIndex = this.computeColorBandIndex(strokeData);
      const seedPos = Math.max(0, Math.min(1, (colorIndex - 1) / 254));
      const seedRgb = this.colorAtPosition(seedPos);
      strokeData.stampDitherSeed = this.hashStrokeDitherSeed(
        seedRgb.r,
        seedRgb.g,
        seedRgb.b,
        seedSlot,
        this.strokeCounter
      );
      if (clearBuffer && !this._isHistoryRestore) {
        const preservedStampCounter = strokeData.stampCounter;
        strokeData.paintBuffer.fill(0);
        strokeData.gradientIdBuffer?.fill(0);
        strokeData.hasContent = false;
        // Preserve stamp counter for continuous gradient flow between shapes
        strokeData.stampCounter = preservedStampCounter;
      }
      strokeData.strokeCounter = this.strokeCounter;
      strokeData.strokeLength = 0;
      strokeData.lastPoint = null;
      strokeData.stampDitherOrigin = null;
      strokeData.stampDitherPressureState = null;
      strokeData.stampDitherBounds = null;
      strokeData.stampDitherLastTileScale = null;
      strokeData.stampDitherStrokeScale = undefined;
      strokeData.stampSeqMeta = [];
      strokeData.stampSeqToTileScale = undefined;
      strokeData.stampDitherRecomposeLastMs = undefined;
      strokeData.stampDitherRecomposePending = false;
      strokeData.stampDitherRecomposeScale = undefined;
      strokeData.stampDitherOriginUnits = null;
      strokeData.stampDitherOriginBaseSize = undefined;
      strokeData.stampDitherLockedBucket = undefined;
      if (this.stampDitherEnabled) {
        this.ensureStampDitherBuffers(strokeData);
        this.ensureStampDitherOwner(strokeData);
        strokeData.stampDitherPrimaryBuffer?.fill(0);
        strokeData.stampDitherOwner?.fill(0);
        strokeData.stampDitherStampSeq = 0;
        strokeData.stampDitherFillHandle = animator.beginDirectFill();
        if (!this.stampDitherBgFill) {
          this.ensureStampDitherBaseBuffers(strokeData);
        } else {
          strokeData.stampDitherBaseIdx = undefined;
          strokeData.stampDitherBaseGid = undefined;
          strokeData.stampDitherBaseMask = undefined;
        }
        const phaseForMask = 0.5;
        const idxForMask = this.computeColorBandIndex(strokeData);
        const coverage = this.resolveStampDitherCoverage(phaseForMask, idxForMask);
        const rawBucket = this.resolveStampDitherBucket(coverage);
        strokeData.stampDitherLockedBucket = Math.min(
          STAMP_DITHER_BUCKETS - 2,
          Math.max(1, rawBucket)
        );
        strokeData.hasExternalBase = false;
      } else {
        strokeData.stampDitherBaseIdx = undefined;
        strokeData.stampDitherBaseGid = undefined;
        strokeData.stampDitherBaseMask = undefined;
        strokeData.stampDitherOwner = undefined;
        strokeData.stampDitherFillHandle = undefined;
      }
      
      // Keep stamp counter continuous across strokes for flowing gradients (unless cleared above)
      // Don't reset - let it accumulate for continuous color progression
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

    const animator = this.getAnimator(id);
    const strokeData = this.layerStrokes.get(id);
    if (strokeData && this.stampDitherEnabled) {
      const algo = this.stampDitherAlgorithm ?? 'sierra-lite';
      if (this.isErrorDiffusionAlgorithm(algo)) {
        const activeSlot = strokeData.activeGradientSlot ?? this.activeGradientSlots.get(id) ?? 0;
        this.finalizeStrokeErrorDiffusion(animator, strokeData, activeSlot);
      }
    }
    if (strokeData?.stampDitherFillHandle) {
      const needsUpload = animator.hasWebGL?.() ?? false;
      animator.endDirectFill({ markDirty: needsUpload });
      strokeData.stampDitherFillHandle = undefined;
    }
    animator.endStroke();
    animator.forceRender(); // Force render on stroke end

    if (strokeData) {
      strokeData.lastPoint = null;
      strokeData.strokeCounter = this.strokeCounter;
      strokeData.hasContent = true;

      let snapshotBuffer: ArrayBuffer = strokeData.paintBuffer.length > 0
        ? strokeData.paintBuffer.slice().buffer
        : new ArrayBuffer(0);
      let snapshotGradientIdBuffer: ArrayBuffer | undefined = strokeData.gradientIdBuffer?.slice().buffer;

      try {
        const serializedAnimator = animator.serialize();
        const bufferData = serializedAnimator?.indexBuffer?.data;
        const gradientIdData = serializedAnimator?.indexBuffer?.gradientId;
        let liveBuffer: Uint8Array | undefined;
        if (bufferData) {
          liveBuffer = bufferData.slice();
          strokeData.paintBuffer = liveBuffer;
          snapshotBuffer = liveBuffer.byteLength > 0
            ? liveBuffer.slice().buffer
            : new ArrayBuffer(0);
        }
        if (gradientIdData) {
          const liveGradientId = gradientIdData.slice();
          strokeData.gradientIdBuffer = liveGradientId;
          snapshotGradientIdBuffer = liveGradientId.byteLength > 0
            ? liveGradientId.slice().buffer
            : new ArrayBuffer(0);
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[ColorCycleBrush.endStroke] Failed to snapshot paint buffer:', error);
        }
      }

      strokeData.lastSnapshot = {
        paintBuffer: snapshotBuffer,
        gradientIdBuffer: snapshotGradientIdBuffer,
        hasContent: true,
        strokeCounter: this.strokeCounter
      };
      strokeData.stampDitherBaseIdx = undefined;
      strokeData.stampDitherBaseGid = undefined;
      strokeData.stampDitherBaseMask = undefined;
      strokeData.stampDitherOwner = undefined;
      strokeData.stampDitherStampSeq = 0;
      strokeData.stampDitherBounds = null;
      strokeData.stampSeqMeta = undefined;
      strokeData.stampSeqToTileScale = undefined;
      strokeData.stampDitherRecomposeLastMs = undefined;
      strokeData.stampDitherRecomposePending = false;
      strokeData.stampDitherRecomposeScale = undefined;

      try {
        const storeState = useAppStore.getState();
        const layer = storeState.layers.find(layerItem => layerItem.id === id);
        if (layer?.colorCycleData) {
          storeState.updateLayer(layer.id, {
            colorCycleData: {
              ...layer.colorCycleData,
              hasContent: true
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
    spacing?: number
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
      this.layerStrokes.set(id, {
        paintBuffer: new Uint8Array(this.width * this.height),
        gradientIdBuffer: new Uint8Array(this.width * this.height),
        hasContent: true,
        strokeCounter: 0,
        strokeLength: 0,
        lastPoint: null,
        gradientLayerIndices: [],
        currentGradientIndex: 0,
        stampCounter: 0,
        activeGradientSlot: 0,
        stampDitherOrigin: null,
        stampDitherPressureState: null,
        stampDitherOwner: undefined,
        stampDitherStampSeq: 0,
        stampDitherPrimaryBuffer: undefined,
        stampDitherBaseIdx: undefined,
        stampDitherBaseGid: undefined,
        stampDitherBounds: null,
        stampDitherLastTileScale: null
      });
    }
    
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.hasContent = true;
      if (strokeData.paintBuffer.length === 0) {
        strokeData.paintBuffer = new Uint8Array(this.width * this.height);
      }
      if (!strokeData.gradientIdBuffer || strokeData.gradientIdBuffer.length === 0) {
        strokeData.gradientIdBuffer = new Uint8Array(this.width * this.height);
      }
    }
    
    const animator = this.getAnimator(id);
    // quiet
    const activeSlot = strokeData?.activeGradientSlot ?? this.activeGradientSlots.get(id) ?? 0;
    if (strokeData) {
      strokeData.activeGradientSlot = activeSlot;
      strokeData.stampFlowMode = this.flowMode;
      strokeData.stampFlowEncoded = true;
    }
    const flowSlot = this.resolveFlowSlot(strokeData, activeSlot);
    
    // Ensure animator is at full resolution
    const deferredSize = this.deferredAnimatorSizes.get(animator);
    if (deferredSize) {
      const { width, height } = deferredSize;
      animator.resize(width, height);
      this.deferredAnimatorSizes.delete(animator);
      
      if (strokeData) {
        strokeData.paintBuffer = new Uint8Array(width * height);
        strokeData.gradientIdBuffer = new Uint8Array(width * height);
      }
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
    
    // Calculate shape center for direction vector origin
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
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
    
    const projectionRange = maxProjection - minProjection;
    const safeProjectionRange = Math.abs(projectionRange) < 1e-6 ? 1 : projectionRange;
    const spacingValue = this.normalizeBandSpacingValue(spacing);
    const projectionSpan = Math.max(1, Math.abs(safeProjectionRange));
    const numBands = this.deriveBandCountFromDistance(projectionSpan, spacingValue);
    const baseOffset = this.stampCounter % 255;
    const indexFromNormalized = (pos: number): number => {
      const raw = Math.round(pos * 254);
      const shifted = (raw + baseOffset) % 255;
      return Math.max(1, Math.min(255, shifted + 1));
    };
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

    const bbox = {
      minX: Math.floor(minX),
      minY: Math.floor(minY),
      width: Math.max(1, Math.ceil(maxX) - Math.floor(minX) + 1),
      height: Math.max(1, Math.ceil(maxY) - Math.floor(minY) + 1)
    };
    const dirNorm = { x: dirX, y: dirY };

    // GPU path (linear fill) when available
    try {
      const hasGL = animator.hasWebGL();
      if (hasGL) {
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
            directionRange: { min: minProjection, range: safeProjectionRange },
            ditherStrength,
            ditherPixelSize,
            noiseSeed,
          }, flowSlot);
          if (ok) {
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
    if (activeSlot !== 0) {
      animator.markGradientSlotUsed(activeSlot);
    }
    const linearBuffer = directLinearHandle.data;
    const linearGradientId = directLinearHandle.gradientId;
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

    // If using perceptual dithering, optionally offload dithering/mapping to worker
    if (this.ditherEnabled && this.perceptualDither) {
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
            row.push([Math.floor(ints[i]), Math.ceil(ints[i + 1])]);
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
        const projRange = Math.max(1e-6, maxProj - minProj);

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
              const r = applyEdgePadding((proj - minProj) / Math.max(projRange, 1e-6));
              const { r: R, g: G, b: B } = this.colorAtPosition(r);
              const idx = (yy * width + xx) * 4;
              data[idx] = R; data[idx + 1] = G; data[idx + 2] = B; data[idx + 3] = 255;
            }
          }
        }

        const quantLevels = numBands;
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
            this.stampCounter += quantLevels;
            if (strokeData) strokeData.stampCounter = this.stampCounter;
            this.dirtyLayers.add(id);
            animator.forceRender();
            this.render(false);
            logCpuLinear();
            return;
          } catch (error) {
            console.warn('[ColorCycleBrushCanvas2D] Worker perceptual fill failed; falling back to main thread.', error);
          }
        }

        const dithered: ImageData = applyDitheringWithFillResolution(img, quantLevels, Math.max(1, this.ditherPixelSize), 'sierra-lite', undefined, paletteCss);
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

        this.stampCounter += quantLevels;
        if (strokeData) strokeData.stampCounter = this.stampCounter;
        this.dirtyLayers.add(id);
        animator.forceRender();
        this.render(false);
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
        const endX = Math.ceil(endFloat);

        const quantizeCoord = (value: number, base: number, limit: number) => {
          const local = value - base;
          const snapped = base + Math.floor(local / cellSize) * cellSize + cellSize * 0.5;
          return Math.min(limit, Math.max(base, snapped));
        };

        const evaluateNormalized = (rawX: number, rawY: number, quantize: boolean) => {
          const px = quantize && cellSize > 1 ? quantizeCoord(rawX, ixBase, maxX) : rawX;
          const py = quantize && cellSize > 1 ? quantizeCoord(rawY, iyBase, maxY) : rawY;
          const proj = (px - centerX) * dirX + (py - centerY) * dirY;
          return clamp01((proj - minProjection) / safeProjectionRange);
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
                const quantLevels = Math.max(2, bands);
                const noiseSeedX = Math.floor(rawSampleX);
                const noiseSeedY = Math.floor(rawSampleY);
                const j = (noiseAt(noiseSeedX, noiseSeedY) - 0.5) * (jitterScale / quantLevels);
                r = clamp01(r + j);
              }

              const quantLevels = Math.max(2, bands);
              const qStep = 1 / quantLevels;
              const scaled = r * quantLevels;
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
          const quantLevels = Math.max(2, bands);
          const qStep = 1 / quantLevels;

          if (!serpentine) {
            for (let x = startX; x <= endX; x++) {
              let r = evaluateNormalized(x + 0.5, y + 0.5, false);
              if (this.ditherEnabled) {
                const jitterScale = 0.35;
                const quantLevels = Math.max(2, bands);
                const j = (noiseAt(x, y) - 0.5) * (jitterScale / quantLevels);
                r = clamp01(r + j);
              }
              const scaled = r * quantLevels;
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
                const quantLevels = Math.max(2, bands);
                const j = (noiseAt(x, y) - 0.5) * (jitterScale / quantLevels);
                r = clamp01(r + j);
              }
              const scaled = r * quantLevels;
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
        } else {
          // No dithering: banded quantization anchored to gradient ends
          // Respect gradientBands so the UI "Bands" slider affects linear fills.
          const quantLevels = bands;
          for (let x = startX; x <= endX; x++) {
            const r = evaluateNormalized(x + 0.5, y + 0.5, false);
            const scaled = r * quantLevels;
            const k = Math.min(quantLevels - 1, Math.floor(scaled)); // ensure exactly quantLevels unique bands
            const pos = k / quantLevels; // 0..1 range without duplicating endpoints
            const outIdx = indexFromNormalized(pos);
            this.logSetIndexSample(id, x, y);
            writeLinearIndex(x, y, outIdx);
          }
        }
      }
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
    logCpuLinear();
    } finally {
      animator.endDirectFill();
    }
  }

  
  /**
   * Fill shape with smooth gradient bands from edge to center (concentric)
   */
  async fillShape(vertices: Array<{ x: number; y: number }>, layerId: string, spacing?: number) {
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
      this.layerStrokes.set(id, {
        paintBuffer: new Uint8Array(this.width * this.height),
        gradientIdBuffer: new Uint8Array(this.width * this.height),
        hasContent: true, // Mark as having content immediately
        strokeCounter: 0,
        strokeLength: 0,
        lastPoint: null,
        gradientLayerIndices: [],
        currentGradientIndex: 0,
        stampCounter: 0,
        activeGradientSlot: 0,
        stampDitherOrigin: null,
        stampDitherPressureState: null,
        stampDitherOwner: undefined,
        stampDitherStampSeq: 0,
        stampDitherPrimaryBuffer: undefined,
        stampDitherBaseIdx: undefined,
        stampDitherBaseGid: undefined,
        stampDitherBounds: null,
        stampDitherLastTileScale: null
      });
    }
    
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.hasContent = true;
      // Ensure full-size buffer
      if (strokeData.paintBuffer.length === 0) {
        strokeData.paintBuffer = new Uint8Array(this.width * this.height);
      }
      if (!strokeData.gradientIdBuffer || strokeData.gradientIdBuffer.length === 0) {
        strokeData.gradientIdBuffer = new Uint8Array(this.width * this.height);
      }
    }
    
    const activeSlot = strokeData?.activeGradientSlot ?? this.activeGradientSlots.get(id) ?? 0;
    if (strokeData) {
      strokeData.activeGradientSlot = activeSlot;
      strokeData.stampFlowMode = this.flowMode;
      strokeData.stampFlowEncoded = true;
    }
    const flowSlot = this.resolveFlowSlot(strokeData, activeSlot);

    const animator = this.getAnimator(id);

    // Ensure animator is at full resolution for fill operations
    const deferredSize = this.deferredAnimatorSizes.get(animator);
    if (deferredSize) {
      const { width, height } = deferredSize;
      animator.resize(width, height);
      this.deferredAnimatorSizes.delete(animator);

      if (strokeData) {
        strokeData.paintBuffer = new Uint8Array(width * height);
        strokeData.gradientIdBuffer = new Uint8Array(width * height);
      }
    }
    
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
    
    // Use scanline fill with inline gradient calculation - simpler and more reliable
    // gradientBands represents number of color divisions
    // bandSpacing (or passed spacing) represents pixel distance between bands
    const baseOffset = this.stampCounter % 255;
    const noiseSeed = (this.stampCounter & 0xffff) / 65535;

    // Adaptive performance: for very large shapes, skip costly per-edge distance checks
    // and approximate distance using only span boundaries (left/right). This reduces
    // complexity from O(pixels * edges) to roughly O(pixels).
    const bboxWidth = Math.max(0, Math.ceil(maxX) - Math.floor(minX) + 1);
    const bboxHeight = Math.max(0, Math.ceil(maxY) - Math.floor(minY) + 1);
    const bbox = {
      minX: Math.floor(minX),
      minY: Math.floor(minY),
      width: Math.max(1, bboxWidth),
      height: Math.max(1, bboxHeight),
    };
    // Hoist invariants
    const shapeWidth = maxX - minX;
    const shapeHeight = maxY - minY;
    const shapeSize = Math.max(shapeWidth, shapeHeight);
    const spacingValue = this.normalizeBandSpacingValue(spacing);
    const baseSpacing = this.normalizeBandSpacingValue(this.bandSpacing);
    const spacingScalar = spacingValue / Math.max(1, baseSpacing);
    const maxDist = Math.max(50, (shapeSize / 2) * spacingScalar);
    const numBands = this.deriveBandCountFromDistance(maxDist, spacingValue);
    const stepPerBand = numBands > 1 ? 254 / (numBands - 1) : 254;

    // Attempt GPU path first so most shapes stay off the CPU.
    if (!this.perceptualDither) {
      try {
        const hasGL = animator.hasWebGL();
        const tryGPU = hasGL;
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
        }, flowSlot);
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
    if (activeSlot !== 0) {
      animator.markGradientSlotUsed(activeSlot);
    }
    const concentricBuffer = directConcentricHandle.data;
    const concentricGradientId = directConcentricHandle.gradientId;
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
        }
      }
    };
    const finalizeFill = (path: 'cpu' | 'worker') => {
      this.stampCounter += numBands;
      if (strokeData) strokeData.stampCounter = this.stampCounter;
      this.dirtyLayers.add(id);
      animator.markDirtyBounds(bbox);
      animator.forceRender();
      this.render(false);
      logConcentricFill(path);
    };

    try {
      // Perceptual dithering path for concentric fill
      if (this.ditherEnabled && this.perceptualDither) {
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
              row.push([Math.floor(ints[i]), Math.ceil(ints[i + 1])]);
            }
            spans2.push(row);
          }

          // Precompute distance parameters (edge to center bands)
          const shapeWidth2 = maxX - minX;
          const shapeHeight2 = maxY - minY;
          const shapeSize2 = Math.max(shapeWidth2, shapeHeight2);
          const maxDist2 = Math.max(50, shapeSize2 / 2);

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
          const applyDitherFR = applyDitheringWithFillResolution;
          const dithered2: ImageData = applyDitherFR(
            img2,
            quantLevels2,
            Math.max(1, this.ditherPixelSize),
            'sierra-lite',
            undefined,
            paletteCss2
          );
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
    // Determine if any layer actually has stroke content to render.
    // If not, do NOT clear/draw onto the layer canvas — this preserves
    // already committed pixels on the color-cycle layer after mouseup.
    let anyContent = false;
    this.animators.forEach((_, layerId) => {
      const strokeData = this.layerStrokes.get(layerId);
      if (strokeData?.hasContent) anyContent = true;
    });

    if (!anyContent) {
      // No live stroke data to composite; leave the layer canvas untouched.
      this.compositeCtx.clearRect(0, 0, this.width, this.height);
      this.dirtyLayers.clear();
      if (this.onFrameRendered) {
        this.onFrameRendered();
      }
      return;
    }

    // Clear composite canvas
    this.compositeCtx.clearRect(0, 0, this.width, this.height);

    // Composite all layers with content
    this.animators.forEach((animator, layerId) => {
      const strokeData = this.layerStrokes.get(layerId);
      if (strokeData?.hasContent) {
        animator.drawTo(this.compositeCtx);
      }
    });

    // Draw to webgl canvas (actually just a regular canvas)
    const webglCtx = this.webglCanvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (webglCtx) {
      webglCtx.globalAlpha = 1.0;
      const prevOp = webglCtx.globalCompositeOperation;
      if (this.isDrawing) {
        webglCtx.globalCompositeOperation = 'copy';
        webglCtx.drawImage(this.compositeCanvas, 0, 0);
      } else {
        webglCtx.globalCompositeOperation = 'source-over';
        webglCtx.drawImage(this.compositeCanvas, 0, 0);
      }
      webglCtx.globalCompositeOperation = prevOp;
      webglCtx.globalAlpha = 1.0;
    }
    
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
    const hadExternalBase = Boolean(strokeData?.hasExternalBase);
    const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });

    if (!ctx) {
      console.warn('Failed to get 2D context from target canvas');
      return;
    }

    // Prefer the tracked hasContent flag, but fall back to sampling the animator canvas
    // so previously restored frames still redraw when gradients change.
    let hasRenderableContent = strokeData?.hasContent ?? false;
    if (!hasRenderableContent) {
      try {
        const srcCanvas = animator.getCanvas?.();
        const sampleCtx = srcCanvas
          ? srcCanvas.getContext('2d', { willReadFrequently: true })
          : null;
        if (srcCanvas && sampleCtx) {
          const sampleWidth = Math.min(16, srcCanvas.width);
          const sampleHeight = Math.min(16, srcCanvas.height);
          const sample = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
          for (let i = 3; i < sample.length; i += 4) {
            if (sample[i] > 0) {
              hasRenderableContent = true;
              break;
            }
          }
        }
      } catch {}
    }

    if (!hasRenderableContent) {
      // IMPORTANT: Do NOT clear the canvas here. When undo/redo restores pixel data directly
      // to the layer canvas, skipping the draw preserves those pixels.
      return;
    }

    try { animator.forceRender(); } catch {}

    const srcCanvas = animator.getCanvas();
    const prevComposite = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    const prevSmoothing = ctx.imageSmoothingEnabled;

    try {
      if (hadExternalBase && strokeData) {
        const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
        if (srcCtx) {
          const prevMode = srcCtx.globalCompositeOperation;
          try {
            srcCtx.globalCompositeOperation = 'destination-over';
            srcCtx.drawImage(targetCanvas, 0, 0);
          } finally {
            srcCtx.globalCompositeOperation = prevMode;
          }
        }
        strokeData.hasExternalBase = false;
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } catch {}
      ctx.imageSmoothingEnabled = false;

      // Clear before drawing when animator owns the full contents of the layer.
      if (!hadExternalBase) {
      ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    }
    ctx.drawImage(srcCanvas, 0, 0);
    try {
      const maskManager = getMaskManager();
      maskManager.applyMaskToCanvas(layerId, ctx);
    } catch {}
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
  commitToLayer(targetCanvas: HTMLCanvasElement, layerId: string) {
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

    const srcCanvas = animator.getCanvas();

    const strokeData = this.layerStrokes.get(layerId);
    const hadExternalBase = Boolean(strokeData?.hasExternalBase);
    if (hadExternalBase && strokeData) {
      const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
      if (srcCtx) {
        const prevMode = srcCtx.globalCompositeOperation;
        try {
          srcCtx.globalCompositeOperation = 'destination-over';
          srcCtx.drawImage(targetCanvas, 0, 0);
        } finally {
          srcCtx.globalCompositeOperation = prevMode;
        }
      }
      strokeData.hasExternalBase = false;
    }

    // If the target is the same canvas as the animator's internal canvas,
    // do not draw onto itself. forceRender() already updated pixels.
    if (srcCanvas === targetCanvas) {
      // Skip drawing to same canvas; already up to date
      return;
    }

    // Save state and composite using source-over at full opacity
    const prevComposite = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    const prevSmoothing = ctx.imageSmoothingEnabled;
    // Save full context state (transform, clip, etc.)
    try { ctx.save(); } catch {}
    try {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      // Ensure no stray transforms affect placement
      try { ctx.setTransform(1, 0, 0, 1, 0, 0); } catch {}
      ctx.imageSmoothingEnabled = false;

      if (!hadExternalBase) {
        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      }

      // Handle potential size mismatches defensively
      if (srcCanvas.width !== targetCanvas.width || srcCanvas.height !== targetCanvas.height) {
        ctx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, 0, 0, targetCanvas.width, targetCanvas.height);
      } else {
        ctx.drawImage(srcCanvas, 0, 0);
      }

      // Optional alpha sampling removed from production path
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
    const frameFps = Math.max(1, Math.min(120, this.fps || 30));
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
    this.cycleSpeed = speed;
    this.animators.forEach(animator => animator.setSpeed(speed));
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
    if (!Number.isFinite(bands) || bands < 2 || bands > 254) {
      console.warn(`Invalid gradient bands: ${bands}, using default`);
      return;
    }
    this.gradientBands = Math.floor(bands);
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
  
  /** Toggle stamp-level dithering for Color Cycle strokes. */
  setStampDitherEnabled(enabled: boolean) {
    this.stampDitherEnabled = !!enabled;
    if (this.stampDitherEnabled) {
      this.clearStampDitherCache();
    }
  }

  /** Select the dithering algorithm for stamp masks. */
  setStampDitherAlgorithm(algorithm?: DitherAlgorithm) {
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
    this.stampDitherTiles.clear();
  }

  /** Toggle pressure-linked stamp dithering resolution. */
  setStampDitherPressureLinked(enabled: boolean) {
    this.stampDitherPressureLinked = !!enabled;
    this.layerStrokes.forEach((stroke) => {
      stroke.stampDitherPressureState = null;
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
          // Ignore resize failures; animator will lazy-resize on next use.
        }
      });

      this.layerStrokes.forEach((strokeData) => {
        const expected = this.width * this.height;
        if (strokeData.paintBuffer.length !== expected) {
          strokeData.paintBuffer = new Uint8Array(expected);
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
        layerData = {
          paintBuffer: new Uint8Array(expectedSize),
          gradientIdBuffer: new Uint8Array(expectedSize),
          hasContent: false,
          strokeCounter: 0,
          strokeLength: 0,
          lastPoint: null,
          gradientLayerIndices: [],
          currentGradientIndex: 0,
          stampCounter: 0,
          activeGradientSlot: 0,
          stampDitherOrigin: null,
          stampDitherPressureState: null,
          stampDitherOwner: undefined,
          stampDitherStampSeq: 0,
          stampDitherPrimaryBuffer: undefined,
          stampDitherBaseIdx: undefined,
          stampDitherBaseGid: undefined,
          stampDitherBounds: null,
          stampDitherLastTileScale: null
        };
        this.layerStrokes.set(this.activeLayerId, layerData);
      }
      return !!layerData.paintBuffer;
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
  setFlowMode(mode: 'forward' | 'reverse' | 'pingpong') {
    this.flowMode = mode;
  }

  setLegacyFlowMode(mode: 'forward' | 'reverse' | 'pingpong') {
    this.legacyFlowMode = mode;
    this.animators.forEach(animator => animator.setFlowMode(mode));
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
    if (this.flowMode === 'pingpong') {
      this.setFlowMode('forward');
      return;
    }
    this.setFlowMode(this.flowMode === 'forward' ? 'reverse' : 'forward');
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
      if (state.fps !== undefined) this.fps = state.fps;
      if (state.brushSize !== undefined) this.brushSize = state.brushSize;
      if (state.stampShape === 'triangle' || state.stampShape === 'square' || state.stampShape === 'diamond') {
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
      
      if (layerSnapshots && !asHistory) {
        const clearForLayer = (layerId: string) => {
          clearedDuringRestore = true;
          const sd = this.layerStrokes.get(layerId);
          if (sd) {
            console.log('[ColorCycleBrush] Paint buffer cleared during restore for layer:', layerId?.substring(0, 20));
            sd.paintBuffer.fill(0);
            sd.gradientIdBuffer?.fill(0);
            sd.hasContent = false;
            sd.strokeCounter = 0;
            sd.strokeLength = 0;
            sd.lastPoint = null;
            sd.stampCounter = 0;
            sd.lastSnapshot = undefined;
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
            const { paintBuffer, gradientIdBuffer, hasContent, strokeCounter, animatorIndex } = snapshot;
            const buffer = paintBuffer ?? new ArrayBuffer(0);
            if (typeof strokeCounter === 'number') {
              highestStrokeCounter = Math.max(highestStrokeCounter, strokeCounter);
            }
            this.applyLayerSnapshot(snapshot.layerId, {
              paintBuffer: buffer,
              gradientIdBuffer,
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
    if (!animator || !animator.getCanvas) {
      console.log('[Debug] No animator/canvas exists for layer:', id);
      return true;
    }
    try {
      const canvas = animator.getCanvas();
      const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
      if (!ctx) {
        console.log('[Debug] No 2D context on animator canvas');
        return true;
      }
      const w = Math.min(32, canvas.width);
      const h = Math.min(32, canvas.height);
      const img = ctx.getImageData(0, 0, w, h);
      const hasContent = (() => {
        const data = img.data;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > 0) return true;
        }
        return false;
      })();
      console.log('[Debug] Animator canvas has content:', hasContent, 'layer:', id);
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
      const snapshot = strokeData?.lastSnapshot;

      const hasContent = snapshot?.hasContent ?? strokeData?.hasContent ?? false;

      let paintBuffer: ArrayBuffer = new ArrayBuffer(0);
      let gradientIdBuffer: ArrayBuffer | undefined = undefined;
      if (hasContent) {
        if (snapshot?.paintBuffer && snapshot.paintBuffer.byteLength > 0) {
          paintBuffer = snapshot.paintBuffer.slice(0);
        } else if (strokeData?.paintBuffer && strokeData.paintBuffer.length > 0) {
          paintBuffer = strokeData.paintBuffer.slice().buffer;
        }
        if (snapshot?.gradientIdBuffer && snapshot.gradientIdBuffer.byteLength > 0) {
          gradientIdBuffer = snapshot.gradientIdBuffer.slice(0);
        } else if (strokeData?.gradientIdBuffer && strokeData.gradientIdBuffer.length > 0) {
          gradientIdBuffer = strokeData.gradientIdBuffer.slice().buffer;
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
      const derivedGradients = colorCycleMeta?.derivedGradients
        ? colorCycleMeta.derivedGradients.map((entry) => ({
            key: entry.key,
            slot: entry.slot,
            spec: { ...entry.spec },
          }))
        : undefined;
      const activeGradientId = colorCycleMeta?.activeGradientId;

      layers.push({
        layerId,
        data: animator.serialize(),
        gradientDefs,
        slotPalettes,
        derivedGradients,
        activeGradientId,
        strokeData: {
          paintBuffer,
          gradientIdBuffer,
          hasContent,
          strokeCounter
        }
      });
    });

    return {
      layers,
      cycleSpeed: this.cycleSpeed,
      fps: this.fps,
      brushSize: this.brushSize,
      stampShape: this.stampShape,
      stampDitherEnabled: this.stampDitherEnabled,
      stampDitherPixelSize: this.stampDitherPixelSize,
      stampDitherAlgorithm: this.stampDitherAlgorithm,
      stampDitherPatternStyle: this.stampDitherPatternStyle,
      stampDitherBgFill: this.stampDitherBgFill,
      stampDitherClears: !this.stampDitherBgFill,
      stampDitherPressureLinked: this.stampDitherPressureLinked
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

    data.layers?.forEach((layer) => {
      const strokeData = layer.strokeData;
      const sourceBuffer = strokeData?.paintBuffer;
      const gradientSource = strokeData?.gradientIdBuffer;
      const clonedArray = sourceBuffer
        ? new Uint8Array(sourceBuffer).slice()
        : new Uint8Array(0);
      const clonedBuffer = clonedArray.buffer as ArrayBuffer;
      const clonedGradientArray = gradientSource
        ? new Uint8Array(gradientSource).slice()
        : undefined;
      const clonedGradientBuffer = clonedGradientArray ? clonedGradientArray.buffer as ArrayBuffer : undefined;
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
              gradientStops: layer.data?.gradient?.gradientStops ?? undefined,
              gradientDefs: layer.gradientDefs,
              slotPalettes: layer.slotPalettes,
              activeGradientId: layer.activeGradientId
            }
          : undefined;
      instance.applyLayerSnapshot(layer.layerId, {
        paintBuffer: clonedBuffer,
        gradientIdBuffer: clonedGradientBuffer,
        hasContent: Boolean(strokeData?.hasContent) || clonedBuffer.byteLength > 0,
        strokeCounter: strokeData?.strokeCounter ?? 0
      }, animatorIndex);
    });

    return instance;
  }

  /**
   * Export a snapshot of a layer's stroke data
   */
  getLayerSnapshot(layerId: string): { paintBuffer: ArrayBuffer; gradientIdBuffer?: ArrayBuffer; hasContent: boolean; strokeCounter: number } | null {
    const strokeData = this.layerStrokes.get(layerId);
    if (!strokeData) return null;
    const snapshot = strokeData.lastSnapshot;
    const paintBuffer = snapshot?.paintBuffer && snapshot.paintBuffer.byteLength > 0
      ? snapshot.paintBuffer.slice(0)
      : strokeData.paintBuffer.length > 0
        ? strokeData.paintBuffer.slice().buffer
        : new ArrayBuffer(0);
    const gradientIdBuffer = snapshot?.gradientIdBuffer && snapshot.gradientIdBuffer.byteLength > 0
      ? snapshot.gradientIdBuffer.slice(0)
      : strokeData.gradientIdBuffer && strokeData.gradientIdBuffer.length > 0
        ? strokeData.gradientIdBuffer.slice().buffer
        : undefined;
    return {
      paintBuffer,
      gradientIdBuffer,
      hasContent: snapshot?.hasContent ?? !!strokeData.hasContent,
      strokeCounter: strokeData.strokeCounter ?? snapshot?.strokeCounter ?? 0
    };
  }

  /**
   * Apply a snapshot to a layer's stroke data
   */
  applyLayerSnapshot(layerId: string, snapshot: StrokeDataSnapshot, animatorIndex?: AnimatorIndexSnapshot) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[ColorCycleBrush] applyLayerSnapshot', {
        layerId,
        bufferBytes: snapshot.paintBuffer?.byteLength ?? 0,
        hasContent: snapshot.hasContent,
        strokeCounter: snapshot.strokeCounter,
        stack: new Error().stack?.split('\n').slice(0, 4).join('\n'),
      });
    }
    // Ensure animator exists for this layer
    let animator = this.animators.get(layerId);
    if (!animator) {
      animator = this.getAnimator(layerId);
    }
    const buffer = snapshot.paintBuffer || new ArrayBuffer(0);
    const gradientBuffer = snapshot.gradientIdBuffer ?? animatorIndex?.gradientIdData;
    const existing = this.layerStrokes.get(layerId);
    const expectedSize = this.width * this.height;
    const incoming = new Uint8Array(buffer);
    const incomingGradient = gradientBuffer ? new Uint8Array(gradientBuffer) : null;
    const expectsContent = Boolean(snapshot.hasContent);
    const hadExistingContent = existing?.hasContent ?? false;
    try {
      if (incoming.length !== expectedSize) {
        // Ensure animator is at the correct size for the current canvas
        animator!.resize(this.width, this.height);
      }
    } catch {}
    const strokeData = existing || {
      paintBuffer: new Uint8Array(expectedSize),
      gradientIdBuffer: new Uint8Array(expectedSize),
      hasContent: false,
      strokeCounter: 0,
      strokeLength: 0,
      lastPoint: null,
      gradientLayerIndices: [],
      currentGradientIndex: 0,
      stampCounter: 0,
      activeGradientSlot: 0,
      hasExternalBase: false,
      stampDitherOrigin: null,
      stampDitherPressureState: null,
      stampDitherOwner: undefined,
      stampDitherStampSeq: 0,
      stampDitherPrimaryBuffer: undefined,
      stampDitherBaseIdx: undefined,
      stampDitherBaseGid: undefined,
      stampDitherBounds: null,
      stampDitherLastTileScale: null
    };
    if (strokeData.paintBuffer.length !== expectedSize) {
      strokeData.paintBuffer = new Uint8Array(expectedSize);
    }
    if (incomingGradient && (!strokeData.gradientIdBuffer || strokeData.gradientIdBuffer.length !== expectedSize)) {
      strokeData.gradientIdBuffer = new Uint8Array(expectedSize);
    }
    // Copy buffer (best-effort): if sizes differ, copy the overlapping region
    if (incoming.length > 0) {
      if (incoming.length === expectedSize) {
        strokeData.paintBuffer.set(incoming);
      } else {
        const copyLen = Math.min(expectedSize, incoming.length);
        strokeData.paintBuffer.fill(0);
        strokeData.paintBuffer.set(incoming.subarray(0, copyLen));
      }
    } else if (!expectsContent && hadExistingContent) {
      // Snapshot explicitly represents an empty state — clear prior contents lazily.
      strokeData.paintBuffer.fill(0);
    }
    if (incomingGradient && strokeData.gradientIdBuffer) {
      if (incomingGradient.length === expectedSize) {
        strokeData.gradientIdBuffer.set(incomingGradient);
      } else {
        const copyLen = Math.min(expectedSize, incomingGradient.length);
        strokeData.gradientIdBuffer.fill(0);
        strokeData.gradientIdBuffer.set(incomingGradient.subarray(0, copyLen));
      }
    } else if (!expectsContent && hadExistingContent && strokeData.gradientIdBuffer) {
      strokeData.gradientIdBuffer.fill(0);
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
        this.setGradientSlot(layerId, palette.slot, palette.stops);
      }
    }
    if (animatorIndex?.gradientDefs?.length && animatorIndex.activeGradientId) {
      const activeDef = animatorIndex.gradientDefs.find((entry) => entry.id === animatorIndex.activeGradientId);
      if (activeDef) {
        this.setActiveGradientSlot(layerId, activeDef.currentSlot);
      }
    }

    strokeData.hasContent = hasLayerContent;
    if (hasLayerContent) {
      strokeData.hasExternalBase = false;
    }
    strokeData.strokeCounter = snapshot.strokeCounter || 0;
    strokeData.strokeLength = 0;
    strokeData.lastPoint = null;
    strokeData.stampCounter = 0;
    strokeData.lastSnapshot = {
      paintBuffer: hasLayerContent
        ? strokeData.paintBuffer.slice().buffer
        : new ArrayBuffer(0),
      gradientIdBuffer: hasLayerContent && strokeData.gradientIdBuffer
        ? strokeData.gradientIdBuffer.slice().buffer
        : snapshot.gradientIdBuffer?.slice(0),
      hasContent: hasLayerContent,
      strokeCounter: strokeData.strokeCounter
    };
    this.layerStrokes.set(layerId, strokeData);

    // Keep animator in sync with externally supplied paint buffer so renders reflect new data.
    try {
      const gradientIdArray = animatorIndex?.gradientIdData
        ? new Uint8Array(animatorIndex.gradientIdData)
        : strokeData.gradientIdBuffer ?? undefined;
      animator?.setIndexBufferFromArray(new Uint8Array(strokeData.paintBuffer), gradientIdArray);
      const dims = animator?.getDimensions?.();
      if (dims) {
        animator.markDirtyBounds({ minX: 0, minY: 0, width: dims.width, height: dims.height });
      }
    } catch {}

    // Mark layer dirty so next render updates
    this.dirtyLayers.add(layerId);

    // quiet
  }

  /**
   * Update gradient (async version for compatibility with tests)
   */
  async updateGradient(gradient: Array<{ position: number; color: string }>): Promise<void> {
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
    
    console.log('ColorCycleBrushCanvas2D disposed');
  }

  private static computeGradientSignature(stops: GradientStop[]): string {
    if (!stops || stops.length === 0) {
      return '[]';
    }

    return stops
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
  }
}
