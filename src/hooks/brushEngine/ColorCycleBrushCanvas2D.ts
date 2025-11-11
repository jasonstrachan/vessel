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

interface CustomStampInput {
  imageData: ImageData;
  width: number;
  height: number;
  cacheKey?: string;
  isResampler?: boolean;
}

type RgbColor = { r: number; g: number; b: number };

type LayerStrokeState = {
  paintBuffer: Uint8Array;
  hasContent: boolean;
  strokeCounter: number;
  strokeLength: number;
  lastPoint: { x: number; y: number } | null;
  gradientLayerIndices: number[];
  currentGradientIndex: number;
  stampCounter: number;
  hasExternalBase?: boolean;
  lastSnapshot?: StrokeDataSnapshot;
};
    
type AnimatorSerializedState = ReturnType<ColorCycleAnimator['serialize']>;

interface AnimatorIndexSnapshot {
  width: number;
  height: number;
  data: ArrayBuffer;
  gradientStops?: GradientStop[];
}

interface StrokeDataSnapshot {
  paintBuffer: ArrayBuffer;
  hasContent: boolean;
  strokeCounter: number;
}

interface SerializedLayerState {
  layerId: string;
  data: AnimatorSerializedState;
  strokeData?: StrokeDataSnapshot;
}

type LayerSnapshotEntry = {
  layerId: string;
  paintBuffer?: ArrayBuffer;
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
  [key: string]: unknown;
}

type StampShape = 'square' | 'triangle';

interface ColorCycleBrushCanvasSerialized {
  layers: SerializedLayerState[];
  cycleSpeed: number;
  fps: number;
  brushSize: number;
  stampShape?: StampShape;
  stampDitherEnabled?: boolean;
  stampDitherPixelSize?: number;
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
const STAMP_DITHER_BUCKETS = 16;
const STAMP_DITHER_TILE_SIZE = 16;
const MIN_STAMP_DITHER_COVERAGE = 0.35;
const MAX_STAMP_DITHER_COVERAGE = 1.0;

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
  
  // Track animation callbacks to prevent memory leaks
  private animatorCallbacks: Map<string, () => void> = new Map();
  
  // Stroke tracking
  private strokeCounter: number = 0;
  private strokeLength: number = 0;
  private lastPoint: { x: number; y: number } | null = null;
  private isDrawing: boolean = false;
  
  // Stamp tracking for gradient progression
  private stampCounter: number = 0;
  private totalGradientSteps: number = 256; // Total colors in gradient
  private flowMode: 'forward' | 'reverse' | 'pingpong' = 'forward';
  
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
  private stampDitherEnabled: boolean = false;
  private stampDitherPixelSize: number = 1;
  private stampDitherBaseTiles: Map<number, Uint8Array> = new Map();
  private stampDitherTiles: Map<string, Uint8Array> = new Map();
  private stampPaletteBuckets: Uint8Array = new Uint8Array(256);
  
  constructor(canvas: HTMLCanvasElement, options: {
    brushSize?: number;
    fps?: number;
    forceCanvas2D?: boolean;
  } = {}) {
    
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

    // Core settings
    this.brushSize = options.brushSize || 20;
    this.cycleSpeed = 0.1;
    this.fps = options.fps || 30;
    this.pressureEnabled = false;
    this.minPressure = 1;
    this.maxPressure = 200; // Default to 2x size at max pressure
    this.rebuildStampDitherBuckets();
  }

  private ensureStrokeState(layerId: string): LayerStrokeState {
    let strokeData = this.layerStrokes.get(layerId);
    if (!strokeData) {
      strokeData = {
        paintBuffer: new Uint8Array(this.width * this.height),
        hasContent: false,
        strokeCounter: 0,
        strokeLength: 0,
        lastPoint: null,
        gradientLayerIndices: [],
        currentGradientIndex: 0,
        stampCounter: 0,
        hasExternalBase: false
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
      animator.setFlowMode(this.flowMode);
      
      // Defer full initialization until first paint
      this.deferredAnimatorSizes.set(animator, { width: this.width, height: this.height });

      this.animators.set(layerId, animator);
      
      // Measure callback setup
      // quiet
      if (this.isAnimating) {
        // Use requestIdleCallback to defer non-critical setup
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(() => {
            if (!this.animatorCallbacks.has(layerId)) {
              animator.start();
              const callback = () => {
                if (!this.isPaused) {
                  this.render(false);
                }
              };
              this.animatorCallbacks.set(layerId, callback);
              animator.onFrame(callback);
            }
          });
        } else {
          // Fallback for browsers without requestIdleCallback
          setTimeout(() => {
            if (!this.animatorCallbacks.has(layerId)) {
              animator.start();
              const callback = () => {
                if (!this.isPaused) {
                  this.render(false);
                }
              };
              this.animatorCallbacks.set(layerId, callback);
              animator.onFrame(callback);
            }
          }, 0);
        }
      }
      // quiet
      
      // Measure stroke data setup
      // quiet
      if (!this.layerStrokes.has(layerId)) {
        this.layerStrokes.set(layerId, {
          paintBuffer: new Uint8Array(0), // Start with empty buffer
          hasContent: false,
          strokeCounter: 0,
          strokeLength: 0,
          lastPoint: null,
          gradientLayerIndices: [],
          currentGradientIndex: 0,
          stampCounter: 0,
          hasExternalBase: false
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
    }
    
    return animator;
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
        hasContent: true,
        strokeCounter: 0,
        strokeLength: 0,
        lastPoint: null,
        gradientLayerIndices: [],
        currentGradientIndex: 0,
        stampCounter: 0,
        hasExternalBase: false
      };
      this.layerStrokes.set(id, strokeData);
    } else if (!strokeData.hasContent) {
      strokeData.hasContent = true;
      if (strokeData.paintBuffer.length !== this.width * this.height) {
        strokeData.paintBuffer = new Uint8Array(this.width * this.height);
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
    }

    return { id, animator, strokeData };
  }

  private logSetIndexSample(layerId: string, x: number, y: number) {
    if ((x & 31) === 0 && (y & 31) === 0) {
      ccLog('setIndex sample', { id: layerId, x, y });
    }
  }

  private computeColorBandIndex(strokeData: LayerStrokeState): number {
    const bandsToUse = Math.max(1, this.gradientBands || 12);
    const colorsToUse = Math.min(255, bandsToUse);
    const bandIndex = colorsToUse > 0 ? strokeData.stampCounter % colorsToUse : 0;

    if (colorsToUse <= 1) {
      return 1; // Degenerate case: always use the first non-transparent entry
    }

    const normalized = bandIndex / (colorsToUse - 1);
    const paletteIndex = 1 + Math.round(normalized * 254); // Offset keeps index 0 reserved for transparency
    return Math.max(1, Math.min(255, paletteIndex));
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
      const tile = useStampDither ? this.getStampDitherTile(this.stampPaletteBuckets[colorIndex] ?? 0) : undefined;
      const tileScale = Math.max(1, this.stampDitherPixelSize);
      const tileSize = useStampDither ? STAMP_DITHER_TILE_SIZE * tileScale : undefined;

      // Paint with specific color index and pressure-modulated size
      if (this.stampShape === 'triangle') {
        if (useStampDither && tile && tileSize) {
          animator.paintTriangle(x, y, pressureSize, colorIndex, tile, tileSize);
        } else {
          animator.paintTriangle(x, y, pressureSize, colorIndex);
        }
      } else if (useStampDither && tile && tileSize) {
        animator.paintSquare(
          x,
          y,
          pressureSize,
          colorIndex,
          tile,
          tileSize
        );
      } else {
        animator.paintSquare(x, y, pressureSize, colorIndex);
      }
      
      // Update tracking
      strokeData.strokeLength++;
      strokeData.lastPoint = { x, y };
      strokeData.stampCounter++;
    }

    // Mark layer as dirty for batched rendering
    this.dirtyLayers.add(id);
    
    // If we're supposed to be animating but no callback is wired for this layer yet
    // (e.g. after restoring a snapshot), force an immediate render so the stroke appears.
    const needsImmediateRender = this.isAnimating && !this.animatorCallbacks.has(id);
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
        animator.setIndex(targetX, targetY, colorIndex);
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

  /**
   * Set gradient (API compatible)
   */
  setGradient(stops: GradientStop[], layerId?: string) {
    const id = layerId || this.activeLayerId || 'default';
    const animator = this.getAnimator(id);

    const signature = ColorCycleBrushCanvas2D.computeGradientSignature(stops);
    const previousSignature = this.gradientSignatures.get(id);
    const gradientChanged = signature !== previousSignature;

    if (gradientChanged) {
      this.gradientSignatures.set(id, signature);
    }

    // Update gradient
    animator.setGradient(stops);

    // Cache stops for perceptual dithering paths
    try {
      this.currentGradientStops = Array.isArray(stops) && stops.length > 0 ? [...stops] : this.currentGradientStops;
      this.rebuildStampDitherBuckets();
    } catch {}
    
    if (gradientChanged) {
      // Reset stamp sequencing so the new gradient starts from the first band
      this.stampCounter = 0;

      const strokeData = this.layerStrokes.get(id);
      if (strokeData) {
        strokeData.stampCounter = 0;
        strokeData.currentGradientIndex = strokeData.gradientLayerIndices.length;
        strokeData.gradientLayerIndices.push(strokeData.currentGradientIndex);
      }
    }
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

  private rebuildStampDitherBuckets() {
    if (!this.stampPaletteBuckets || this.stampPaletteBuckets.length !== 256) {
      this.stampPaletteBuckets = new Uint8Array(256);
    }
    for (let index = 1; index < 256; index++) {
      const normalized = (index - 1) / 254;
      const { r, g, b } = this.colorAtPosition(normalized);
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const brightness = Math.max(0, Math.min(1, luminance / 255));
      const bucket = Math.min(
        STAMP_DITHER_BUCKETS - 1,
        Math.max(0, Math.floor(brightness * STAMP_DITHER_BUCKETS))
      );
      this.stampPaletteBuckets[index] = bucket;
    }
    this.stampPaletteBuckets[0] = 0;
    this.stampDitherBaseTiles.clear();
    this.stampDitherTiles.clear();
  }

  private coverageForBucket(bucket: number): number {
    if (STAMP_DITHER_BUCKETS <= 1) {
      return MAX_STAMP_DITHER_COVERAGE;
    }
    const ratio = Math.max(0, Math.min(1, bucket / (STAMP_DITHER_BUCKETS - 1)));
    return MIN_STAMP_DITHER_COVERAGE + (MAX_STAMP_DITHER_COVERAGE - MIN_STAMP_DITHER_COVERAGE) * (1 - ratio);
  }

  private buildBaseStampDitherTile(bucket: number): Uint8Array {
    const tileSize = STAMP_DITHER_TILE_SIZE;
    const coverage = this.coverageForBucket(bucket);
    const working = new Float32Array(tileSize * tileSize);
    working.fill(coverage);
    const result = new Uint8Array(tileSize * tileSize);
    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const idx = y * tileSize + x;
        const current = working[idx];
        const newValue = current >= 0.5 ? 1 : 0;
        result[idx] = newValue;
        const error = current - newValue;
        if (x + 1 < tileSize) {
          working[idx + 1] += error * 0.5;
        }
        if (y + 1 < tileSize) {
          if (x > 0) {
            working[idx + tileSize - 1] += error * 0.25;
          }
          working[idx + tileSize] += error * 0.25;
        }
      }
    }
    return result;
  }

  private scaleStampDitherTile(base: Uint8Array, scale: number): Uint8Array {
    if (scale <= 1) {
      return base;
    }
    const baseSize = STAMP_DITHER_TILE_SIZE;
    const scaledSize = baseSize * scale;
    const scaled = new Uint8Array(scaledSize * scaledSize);
    for (let y = 0; y < scaledSize; y++) {
      const baseY = Math.floor(y / scale);
      for (let x = 0; x < scaledSize; x++) {
        const baseX = Math.floor(x / scale);
        const baseIdx = baseY * baseSize + baseX;
        scaled[y * scaledSize + x] = base[baseIdx];
      }
    }
    return scaled;
  }

  private getBaseStampDitherTile(bucket: number): Uint8Array {
    let tile = this.stampDitherBaseTiles.get(bucket);
    if (!tile) {
      tile = this.buildBaseStampDitherTile(bucket);
      this.stampDitherBaseTiles.set(bucket, tile);
    }
    return tile;
  }

  private getStampDitherTile(bucket: number): Uint8Array {
    const normalizedBucket = Math.max(0, Math.min(STAMP_DITHER_BUCKETS - 1, bucket | 0));
    const scale = Math.max(1, Math.floor(this.stampDitherPixelSize));
    const cacheKey = `${normalizedBucket}|${scale}`;
    let tile = this.stampDitherTiles.get(cacheKey);
    if (!tile) {
      const baseTile = this.getBaseStampDitherTile(normalizedBucket);
      tile = scale === 1 ? baseTile : this.scaleStampDitherTile(baseTile, scale);
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
    // Quick diagnostic: peek a small region of the animator canvas for existing pixels
    try {
      const canvas = animator.getCanvas?.();
      const ctx = canvas
        ? (canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null)
        : null;
      if (ctx && canvas) {
        const sample = ctx.getImageData(0, 0, Math.min(10, canvas.width), Math.min(10, canvas.height));
        const hasPixels = (() => {
          const data = sample.data;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] > 0) return true;
          }
          return false;
        })();
        
        if (hasPixels && clearBuffer && !this._isHistoryRestore) {
          try { animator.clear(); } catch {}
        }
      }
    } catch {}
    animator.startStroke();
    
    const strokeData = this.layerStrokes.get(id);
    if (strokeData && !strokeData.hasContent) {
      strokeData.hasContent = true;
    }
    if (strokeData) {
      if (clearBuffer && !this._isHistoryRestore) {
        const preservedStampCounter = strokeData.stampCounter;
        strokeData.paintBuffer.fill(0);
        strokeData.hasContent = false;
        // Preserve stamp counter for continuous gradient flow between shapes
        strokeData.stampCounter = preservedStampCounter;
      }
      strokeData.strokeCounter = this.strokeCounter;
      strokeData.strokeLength = 0;
      strokeData.lastPoint = null;
      
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
    animator.endStroke();
    animator.forceRender(); // Force render on stroke end

    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.lastPoint = null;
      strokeData.strokeCounter = this.strokeCounter;
      strokeData.hasContent = true;

      let snapshotBuffer: ArrayBuffer = strokeData.paintBuffer.length > 0
        ? strokeData.paintBuffer.slice().buffer
        : new ArrayBuffer(0);

      try {
        const serializedAnimator = animator.serialize();
        const bufferData = serializedAnimator?.indexBuffer?.data;
        if (bufferData) {
          const liveBuffer = bufferData.slice();
          strokeData.paintBuffer = liveBuffer;
          snapshotBuffer = liveBuffer.byteLength > 0
            ? liveBuffer.buffer.slice(0)
            : new ArrayBuffer(0);
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[ColorCycleBrush.endStroke] Failed to snapshot paint buffer:', error);
        }
      }

      strokeData.lastSnapshot = {
        paintBuffer: snapshotBuffer,
        hasContent: true,
        strokeCounter: this.strokeCounter
      };

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
        hasContent: true,
        strokeCounter: 0,
        strokeLength: 0,
        lastPoint: null,
        gradientLayerIndices: [],
        currentGradientIndex: 0,
        stampCounter: 0
      });
    }
    
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.hasContent = true;
      if (strokeData.paintBuffer.length === 0) {
        strokeData.paintBuffer = new Uint8Array(this.width * this.height);
      }
    }
    
    const animator = this.getAnimator(id);
    // quiet
    
    // Ensure animator is at full resolution
    const deferredSize = this.deferredAnimatorSizes.get(animator);
    if (deferredSize) {
      const { width, height } = deferredSize;
      animator.resize(width, height);
      this.deferredAnimatorSizes.delete(animator);
      
      if (strokeData) {
        strokeData.paintBuffer = new Uint8Array(width * height);
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
          });
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
    const linearBuffer = directLinearHandle.data;
    const linearBufferWidth = directLinearHandle.width;
    const linearBufferHeight = directLinearHandle.height;
    const writeLinearIndex = (x: number, y: number, colorIndex: number) => {
      if (x < 0 || y < 0 || x >= linearBufferWidth || y >= linearBufferHeight) {
        return;
      }
      const clamped = Math.max(0, Math.min(255, colorIndex | 0));
      linearBuffer[y * linearBufferWidth + x] = clamped;
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
        const workerEligible = paletteEntries.length > 0 && shouldUseFillWorker(width, height);
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
        hasContent: true, // Mark as having content immediately
        strokeCounter: 0,
        strokeLength: 0,
        lastPoint: null,
        gradientLayerIndices: [],
        currentGradientIndex: 0,
        stampCounter: 0
      });
    }
    
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.hasContent = true;
      // Ensure full-size buffer
      if (strokeData.paintBuffer.length === 0) {
        strokeData.paintBuffer = new Uint8Array(this.width * this.height);
      }
    }
    
    const animator = this.getAnimator(id);

    // Ensure animator is at full resolution for fill operations
    const deferredSize = this.deferredAnimatorSizes.get(animator);
    if (deferredSize) {
      const { width, height } = deferredSize;
      animator.resize(width, height);
      this.deferredAnimatorSizes.delete(animator);

      if (strokeData) {
        strokeData.paintBuffer = new Uint8Array(width * height);
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
        });
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
    const concentricBuffer = directConcentricHandle.data;
    const concentricWidth = directConcentricHandle.width;
    const concentricHeight = directConcentricHandle.height;
    const writeConcentricIndex = (x: number, y: number, colorIndex: number) => {
      if (x < 0 || y < 0 || x >= concentricWidth || y >= concentricHeight) {
        return;
      }
      const clamped = Math.max(0, Math.min(255, colorIndex | 0));
      concentricBuffer[y * concentricWidth + x] = clamped;
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
          concentricBuffer[destRowOffset + destX] = value;
        }
      }
    };
    const finalizeFill = (path: 'cpu' | 'worker') => {
      this.stampCounter += numBands;
      if (strokeData) strokeData.stampCounter = this.stampCounter;
      this.dirtyLayers.add(id);
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

      const preferWorker = !this.perceptualDither && shouldUseFillWorker(bbox.width, bbox.height);
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
      // Do NOT clear the layer canvas here; draw over existing pixels so
      // previously committed strokes remain persistent between strokes.
      webglCtx.globalAlpha = 1.0;
      webglCtx.drawImage(this.compositeCanvas, 0, 0);
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
    if (strokeData?.hasExternalBase) {
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

      if (!strokeData?.hasExternalBase) {
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
  startAnimation() {
    if (this.isAnimating) {
      return;
    }
    
    // Flush any pending renders before starting animation
    if (this.renderScheduled) {
      this.renderScheduled = false;
      
      // Render all dirty layers
      if (this.dirtyLayers.size > 0) {
        this.dirtyLayers.forEach(layerId => {
          const animator = this.animators.get(layerId);
          if (animator) {
            animator.forceRender();
          }
        });
        this.dirtyLayers.clear();
        this.render(false);
      }
    }
    
    this.isAnimating = true;
    this.isPaused = false;
    
    // Start all animators and register callbacks only if not already registered
    this.animators.forEach((animator, layerId) => {
      animator.start();
      
      // Only add callback if we haven't already for this layer
      if (!this.animatorCallbacks.has(layerId)) {
        const callback = () => {
          if (!this.isPaused) {
            this.render(false);
          }
        };
        this.animatorCallbacks.set(layerId, callback);
        animator.onFrame(callback);
      }
    });
  }
  
  /**
   * Stop animation (API compatible)
   */
  stopAnimation() {
    this.isAnimating = false;
    
    // Flush any pending renders when stopping animation
    if (this.renderScheduled) {
      this.renderScheduled = false;
      
      // Render all dirty layers
      if (this.dirtyLayers.size > 0) {
        this.dirtyLayers.forEach(layerId => {
          const animator = this.animators.get(layerId);
          if (animator) {
            animator.forceRender();
          }
        });
        this.dirtyLayers.clear();
        this.render(false);
      }
    }
    
    // Stop all animators and clean up callbacks
    this.animators.forEach((animator, layerId) => {
      animator.stop();
      
      // Remove callback if it exists
      const callback = this.animatorCallbacks.get(layerId);
      if (callback) {
        animator.offFrame(callback);
        this.animatorCallbacks.delete(layerId);
      }
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
    this.isPaused = true;
    this.animators.forEach(animator => animator.pause());
  }
  
  /**
   * Resume animation (API compatible)
   */
  resume() {
    this.isPaused = false;
    this.animators.forEach(animator => animator.resume());
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
    if (!Number.isFinite(distance) || distance <= 0) {
      return Math.max(2, this.gradientBands || 12);
    }
    const spacingPx = this.normalizeBandSpacingValue(spacing);
    const raw = Math.max(2, distance / spacingPx);
    return Math.max(2, Math.min(254, Math.round(raw)));
  }

  /**
   * Set stamp shape for stroke rendering
   */
  setStampShape(shape: StampShape) {
    this.stampShape = shape === 'triangle' ? 'triangle' : 'square';
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
      this.rebuildStampDitherBuckets();
    }
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
          hasContent: false,
          strokeCounter: 0,
          strokeLength: 0,
          lastPoint: null,
          gradientLayerIndices: [],
          currentGradientIndex: 0,
          stampCounter: 0
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
    
    // Clean up all callbacks and animators
    this.animators.forEach((animator, layerId) => {
      const callback = this.animatorCallbacks.get(layerId);
      if (callback) {
        animator.offFrame(callback);
      }
      animator.stop();
      // Properly clean up animator resources and return canvas to pool
      animator.cleanup();
    });
    
    this.animatorCallbacks.clear();
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
    this.animators.forEach(animator => animator.toggleFlowDirection());
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
      if (state.stampShape === 'triangle' || state.stampShape === 'square') {
        this.setStampShape(state.stampShape);
      }
      
      if (layerSnapshots && !asHistory) {
        const clearForLayer = (layerId: string) => {
          clearedDuringRestore = true;
          const sd = this.layerStrokes.get(layerId);
          if (sd) {
            console.log('[ColorCycleBrush] Paint buffer cleared during restore for layer:', layerId?.substring(0, 20));
            sd.paintBuffer.fill(0);
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
              hasContent: !!buffer && (buffer as ArrayBuffer).byteLength > 0,
              strokeCounter: 0
            }, /*extra*/ undefined);
          });
        } else if (Array.isArray(layerSnapshots)) {
          layerSnapshots.forEach((snapshot) => {
            if (!snapshot || !snapshot.layerId) {
              return;
            }
            const { paintBuffer, hasContent, strokeCounter, animatorIndex } = snapshot;
            const buffer = paintBuffer ?? new ArrayBuffer(0);
            if (typeof strokeCounter === 'number') {
              highestStrokeCounter = Math.max(highestStrokeCounter, strokeCounter);
            }
            this.applyLayerSnapshot(snapshot.layerId, {
              paintBuffer: buffer,
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

    this.animators.forEach((animator, layerId) => {
      const strokeData = this.layerStrokes.get(layerId);
      const snapshot = strokeData?.lastSnapshot;

      const hasContent = snapshot?.hasContent ?? strokeData?.hasContent ?? false;

      let paintBuffer: ArrayBuffer = new ArrayBuffer(0);
      if (hasContent) {
        if (snapshot?.paintBuffer && snapshot.paintBuffer.byteLength > 0) {
          paintBuffer = snapshot.paintBuffer.slice(0);
        } else if (strokeData?.paintBuffer && strokeData.paintBuffer.length > 0) {
          paintBuffer = strokeData.paintBuffer.slice().buffer;
        }
      }
      const strokeCounter = strokeData?.strokeCounter ?? snapshot?.strokeCounter ?? this.strokeCounter;

      layers.push({
        layerId,
        data: animator.serialize(),
        strokeData: {
          paintBuffer,
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
      stampDitherPixelSize: this.stampDitherPixelSize
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

    data.layers?.forEach((layer) => {
      const strokeData = layer.strokeData;
      const sourceBuffer = strokeData?.paintBuffer;
      const clonedArray = sourceBuffer
        ? new Uint8Array(sourceBuffer).slice()
        : new Uint8Array(0);
      const clonedBuffer = clonedArray.buffer as ArrayBuffer;
      instance.applyLayerSnapshot(layer.layerId, {
        paintBuffer: clonedBuffer,
        hasContent: Boolean(strokeData?.hasContent) || clonedBuffer.byteLength > 0,
        strokeCounter: strokeData?.strokeCounter ?? 0
      });
    });

    return instance;
  }

  /**
   * Export a snapshot of a layer's stroke data
   */
  getLayerSnapshot(layerId: string): { paintBuffer: ArrayBuffer; hasContent: boolean; strokeCounter: number } | null {
    const strokeData = this.layerStrokes.get(layerId);
    if (!strokeData) return null;
    const snapshot = strokeData.lastSnapshot;
    const paintBuffer = snapshot?.paintBuffer && snapshot.paintBuffer.byteLength > 0
      ? snapshot.paintBuffer.slice(0)
      : strokeData.paintBuffer.length > 0
        ? strokeData.paintBuffer.slice().buffer
        : new ArrayBuffer(0);
    return {
      paintBuffer,
      hasContent: snapshot?.hasContent ?? !!strokeData.hasContent,
      strokeCounter: strokeData.strokeCounter ?? snapshot?.strokeCounter ?? 0
    };
  }

  /**
   * Apply a snapshot to a layer's stroke data
   */
  applyLayerSnapshot(layerId: string, snapshot: StrokeDataSnapshot, animatorIndex?: AnimatorIndexSnapshot) {
    // Ensure animator exists for this layer
    let animator = this.animators.get(layerId);
    if (!animator) {
      animator = this.getAnimator(layerId);
    }
    const buffer = snapshot.paintBuffer || new ArrayBuffer(0);
    const existing = this.layerStrokes.get(layerId);
    const expectedSize = this.width * this.height;
    const incoming = new Uint8Array(buffer);
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
      hasContent: false,
      strokeCounter: 0,
      strokeLength: 0,
      lastPoint: null,
      gradientLayerIndices: [],
      currentGradientIndex: 0,
      stampCounter: 0,
      hasExternalBase: false
    };
    if (strokeData.paintBuffer.length !== expectedSize) {
      strokeData.paintBuffer = new Uint8Array(expectedSize);
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
    let hasLayerContent = expectsContent;

    // If animator index buffer is provided, rebuild animator from it to preserve prior pixels
    if (animatorIndex && animatorIndex.data && animatorIndex.width && animatorIndex.height) {
      try {
        const dataArr = new Uint8Array(animatorIndex.data);
        const anyNonZero = dataArr.some(v => v !== 0);
        // Build a minimal serialized object for deserialization
        const serialized: AnimatorSerializedState = {
          indexBuffer: {
            width: animatorIndex.width,
            height: animatorIndex.height,
            data: dataArr,
            palette: [] as string[]
          },
          gradient: {
            gradientStops: animatorIndex.gradientStops ?? [],
            paletteSize: 256
          },
          animation: {
            offset: 0,
            stats: {
              targetFPS: this.fps,
              actualFPS: 0,
              frameCount: 0,
              totalTime: 0,
              averageFrameTime: 0,
              isAnimating: false
            }
          }
        };
        const rebuilt = ColorCycleAnimator.deserialize(serialized);
        // Replace existing animator for this layer
        this.animators.set(layerId, rebuilt);
        animator = rebuilt;
        // Ensure animation callbacks are re-bound when swapping animators during history restore.
        if (this.isAnimating) {
          try {
            if (typeof animator.start === 'function') {
              animator.start();
            }
          } catch {}
        }
        const existingCallback = this.animatorCallbacks.get(layerId);
        if (existingCallback) {
          try {
            if (typeof animator.onFrame === 'function') {
              animator.onFrame(existingCallback);
            }
          } catch {}
        } else if (this.isAnimating) {
          const callback = () => {
            if (!this.isPaused) {
              this.render(false);
            }
          };
          this.animatorCallbacks.set(layerId, callback);
          try {
            if (typeof animator.onFrame === 'function') {
              animator.onFrame(callback);
            }
          } catch {}
        }
        hasLayerContent = hasLayerContent || anyNonZero;
      } catch (error) {
        console.warn('[ColorCycleBrush.applyLayerSnapshot] Failed to rebuild animator from snapshot:', error);
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
      hasContent: hasLayerContent,
      strokeCounter: strokeData.strokeCounter
    };
    this.layerStrokes.set(layerId, strokeData);
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
    
    // Clear callbacks
    this.animatorCallbacks.clear();
    
    // Clear stroke data
    this.layerStrokes.clear();
    this.dirtyLayers.clear();
    this.gradientSignatures.clear();
    
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
