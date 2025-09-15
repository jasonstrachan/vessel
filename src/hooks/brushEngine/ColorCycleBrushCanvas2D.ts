/**
 * ColorCycleBrushCanvas2D - Canvas 2D implementation of color cycling
 * Replaces WebGL with efficient indexed color system using Canvas 2D
 * Maintains API compatibility with original ColorCycleBrush
 */

import { ColorCycleAnimator } from '../../lib/ColorCycleAnimator';
// Debug logs suppressed for color cycle brush
import { GradientStop } from '../../lib/GradientPalette';
import { applyPressureCurve } from '../../utils/pressureCurve';
import { simplifyToVertexLimit } from '@/utils/polygonSimplify';

export class ColorCycleBrushCanvas2D {
  private animators: Map<string, ColorCycleAnimator> = new Map();
  private activeLayerId: string | null = null;
  
  // Canvas references
  private webglCanvas: HTMLCanvasElement; // Keep name for compatibility
  private compositeCanvas: HTMLCanvasElement;
  private compositeCtx: CanvasRenderingContext2D;
  
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
  
  // Batched rendering
  private renderScheduled: boolean = false;
  private dirtyLayers: Set<string> = new Set();
  
  // Frame callback
  private onFrameRendered?: () => void;
  
  // Layer tracking for API compatibility
  private layerStrokes: Map<string, {
    paintBuffer: Uint8Array;
    hasContent: boolean;
    strokeCounter: number;
    strokeLength: number;
    lastPoint: { x: number; y: number } | null;
    gradientLayerIndices: number[];
    currentGradientIndex: number;
    stampCounter: number; // Track stamps per layer
  }> = new Map();
  
  constructor(canvas: HTMLCanvasElement, options: {
    brushSize?: number;
    fps?: number;
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
    
    // Core settings
    this.brushSize = options.brushSize || 20;
    this.cycleSpeed = 0.1;
    this.fps = options.fps || 30;
    this.pressureEnabled = false;
    this.minPressure = 1;
    this.maxPressure = 200; // Default to 2x size at max pressure
  }
  
  /**
   * Get or create animator for a layer
   */
  private getAnimator(layerId: string): ColorCycleAnimator {
    // Add validation
    if (!layerId) {
      throw new Error('Layer ID is required');
    }
    
    if (!this.animators.has(layerId)) {
      // quiet
      const startTime = performance.now();
      
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
        lazyInit: true  // Add flag to defer heavy initialization
      });
      // quiet
      
      // Defer full initialization until first paint
      (animator as any)._deferredSize = { width: this.width, height: this.height };
      
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
          stampCounter: 0
        });
      }
      // quiet
      
      const totalTime = performance.now() - startTime;
      // quiet
    }
    
    const animator = this.animators.get(layerId);
    if (!animator) {
      throw new Error(`Failed to get or create animator for layer: ${layerId}`);
    }
    
    // Resize on first actual use if needed
    const strokeData = this.layerStrokes.get(layerId);
    if ((animator as any)._deferredSize && strokeData?.hasContent) {
      const { width, height } = (animator as any)._deferredSize;
      animator.resize(width, height);
      delete (animator as any)._deferredSize;
      
      // Also resize paint buffer
      strokeData.paintBuffer = new Uint8Array(width * height);
    }
    
    return animator;
  }
  
  /**
   * Paint at position (API compatible)
   */
  paint(x: number, y: number, layerId?: string, pressure: number = 1.0, rotation: number = 0) {
    const perfStart = performance.now();
    
    // Debug logging removed for paint hot path
    
    // Validate coordinates
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      console.warn(`Invalid paint coordinates: x=${x}, y=${y}`);
      return;
    }
    
    const id = layerId || this.activeLayerId || 'default';

    // Ensure animator exists first so layerStrokes is initialized for this layer
    const animator = this.getAnimator(id);

    // Get or create stroke data record
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
        stampCounter: 0
      };
      this.layerStrokes.set(id, strokeData);
    } else if (!strokeData.hasContent) {
      strokeData.hasContent = true;
      if (strokeData.paintBuffer.length !== this.width * this.height) {
        strokeData.paintBuffer = new Uint8Array(this.width * this.height);
      }
    }

    // If animator was created at reduced size, finalize resize now that we have content
    if ((animator as any)._deferredSize) {
      const { width, height } = (animator as any)._deferredSize;
      animator.resize(width, height);
      delete (animator as any)._deferredSize;
      if (strokeData.paintBuffer.length !== width * height) {
        strokeData.paintBuffer = new Uint8Array(width * height);
      }
    }

    if (strokeData) {
      // Calculate color index based on stamp position in gradient
      // Use gradientBands to control how many distinct colors appear in the stroke
      // This creates banded color zones instead of smooth gradients
      const bandsToUse = Math.max(2, this.gradientBands || 12); // Default to 12 bands if not set

      // Repeat gradient: wrap band index instead of clamping so colors cycle continuously
      const colorsToUse = Math.max(2, Math.min(254, bandsToUse)); // Keep within palette capacity
      const colorStep = Math.max(1, Math.floor(254 / colorsToUse)); // Space between colors
      const bandIndex = strokeData.stampCounter % colorsToUse;

      // Calculate color index and ensure it's in valid range (0-254)
      const colorIndex = Math.max(0, Math.min(254, bandIndex * colorStep));
      
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
      
      // Paint with specific color index and pressure-modulated size
      // TODO: Add rotation support to paintSquare method in future update
      animator.paintSquare(x, y, pressureSize, colorIndex);
      
      // Update tracking
      strokeData.strokeLength++;
      strokeData.lastPoint = { x, y };
      strokeData.stampCounter++;
    }

    // Mark layer as dirty for batched rendering
    this.dirtyLayers.add(id);
    
    // Schedule batched render if not animating
    if (!this.isAnimating && !this.renderScheduled) {
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
  
  /**
   * Set gradient (API compatible)
   */
  setGradient(stops: GradientStop[], layerId?: string) {
    const id = layerId || this.activeLayerId || 'default';
    const animator = this.getAnimator(id);

    // Update gradient
    animator.setGradient(stops);

    // Cache stops for perceptual dithering paths
    try {
      this.currentGradientStops = Array.isArray(stops) && stops.length > 0 ? [...stops] : this.currentGradientStops;
    } catch {}
    
    // Store in layer data
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.currentGradientIndex = strokeData.gradientLayerIndices.length;
      strokeData.gradientLayerIndices.push(strokeData.currentGradientIndex);
    }
  }
  
  
  /**
   * Clear paint buffer for a layer (used for shape mode)
   */
  clearPaintBuffer(layerId?: string) {
    const id = layerId || this.activeLayerId || 'default';
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      // Clear the paint buffer to start fresh
      strokeData.paintBuffer.fill(0);
      // IMPORTANT: Do NOT mark hasContent=false or clear the animator here.
      // We want previously committed strokes to continue animating.
      // Only reset per-stroke counters.
      strokeData.strokeCounter = 0;
      // Reset stamp counter only to delimit visual progression for the next stroke,
      // keeping existing animator/index data intact for animation.
      strokeData.stampCounter = 0;
      // Ensure our composite canvas is clean for the next draw
      this.compositeCtx.clearRect(0, 0, this.width, this.height);
    }
  }

  // --- Perceptual dithering helpers ---
  private parseCssColor(color: string | { r: number; g: number; b: number }): { r: number; g: number; b: number } {
    if (typeof color === 'object' && color && typeof (color as any).r === 'number') {
      const c = color as any; return { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) };
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any);
    if (!ctx) return { r: 0, g: 0, b: 0 };
    ctx.fillStyle = color as string; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
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
      const idx = ((Math.round(pos * 254)) % 254) + 1; // 1..255 (0 reserved)
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
      const ctx = canvas?.getContext('2d');
      if (ctx && canvas) {
        const sample = ctx.getImageData(0, 0, Math.min(10, canvas.width), Math.min(10, canvas.height));
        const hasPixels = (() => {
          const data = sample.data;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] > 0) return true;
          }
          return false;
        })();
        
        if (hasPixels && clearBuffer) {
          try { animator.clear(); } catch {}
        }
      }
    } catch {}
    animator.startStroke();
    
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      if (clearBuffer) {
        strokeData.paintBuffer.fill(0);
        strokeData.hasContent = false;
        strokeData.strokeCounter = 0;
        strokeData.stampCounter = 0; // Reset stamp counter for new shape
      } else {
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
    const id = layerId || this.activeLayerId || 'default';
    this.isDrawing = false;
    
    const animator = this.getAnimator(id);
    animator.endStroke();
    animator.forceRender(); // Force render on stroke end
    
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.lastPoint = null;
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
      } catch (e) {
        console.warn('[ColorCycleBrush.finalizeCurrentStroke] Failed to end stroke:', e);
      }
    }
  }
  
  /**
   * Fill shape with linear gradient in specified direction
   */
  fillShapeLinear(vertices: Array<{ x: number; y: number }>, direction: { x: number; y: number }, layerId?: string) {
    // Validate input
    if (!vertices || !Array.isArray(vertices)) {
      console.warn('Invalid vertices provided to fillShapeLinear');
      return;
    }
    
    if (vertices.length < 3) {
      console.warn('fillShapeLinear requires at least 3 vertices');
      return;
    }
    
    const id = layerId || this.activeLayerId || 'default';
    
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
    if ((animator as any)._deferredSize) {
      const { width, height } = (animator as any)._deferredSize;
      animator.resize(width, height);
      delete (animator as any)._deferredSize;
      
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
    const numBands = Math.max(2, this.gradientBands || 12);

    // If using perceptual dithering, render gradient into an ImageData, dither in color space,
    // then map back to gradient indices and write to the index buffer.
    if (this.ditherEnabled && this.perceptualDither) {
      try {
        const width = Math.max(1, Math.ceil(maxX) - Math.floor(minX) + 1);
        const height = Math.max(1, Math.ceil(maxY) - Math.floor(minY) + 1);
        const img = new ImageData(width, height);
        const data = img.data;
        const x0 = Math.floor(minX);
        const y0 = Math.floor(minY);

        // Precompute per-row spans
        const spans: Array<Array<[number, number]>> = [];
        for (let y = y0; y <= Math.ceil(maxY); y++) {
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

        // Fill gradient colors into buffer
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

        for (let yy = 0; yy < height; yy++) {
          const y = y0 + yy;
          const rowSpans = spans[yy] || [];
          for (const [sx, ex] of rowSpans) {
            for (let x = sx; x <= ex; x++) {
              const xx = x - x0; if (xx < 0 || xx >= width) continue;
              const dx = x - centerX; const dy = y - centerY;
              const proj = dx * dirX + dy * dirY;
              const r = Math.max(0, Math.min(1, (proj - minProj) / projRange));
              const { r: R, g: G, b: B } = this.colorAtPosition(r);
              const idx = (yy * width + xx) * 4;
              data[idx] = R; data[idx + 1] = G; data[idx + 2] = B; data[idx + 3] = 255;
            }
          }
        }

        // Build palette of N colors from gradient
        const quantLevels = Math.max(2, this.gradientBands || 12);
        const { css: paletteCss, mapRgbToIndex } = this.buildQuantizedGradientPalette(quantLevels);

        // Run color-space dithering at requested pixel size
        const { applyDitheringWithFillResolution } = require('./dithering');
        const dithered: ImageData = applyDitheringWithFillResolution(img, quantLevels, Math.max(1, this.ditherPixelSize), 'sierra-lite', undefined, paletteCss);

        // Map dithered pixels back to gradient indices and write to index buffer
        const out = dithered.data;
        for (let yy = 0; yy < height; yy++) {
          const y = y0 + yy;
          const rowSpans = spans[yy] || [];
          for (const [sx, ex] of rowSpans) {
            for (let x = sx; x <= ex; x++) {
              const xx = x - x0; if (xx < 0 || xx >= width) continue;
              const p = (yy * width + xx) * 4;
              const key = `${out[p]},${out[p + 1]},${out[p + 2]}`;
              const gi = mapRgbToIndex.get(key);
              if (gi !== undefined) {
                animator.setIndex(x, y, gi);
              }
            }
          }
        }

        this.stampCounter += quantLevels;
        if (strokeData) strokeData.stampCounter = this.stampCounter;
        this.dirtyLayers.add(id);
        animator.forceRender();
        this.render(false);
        return;
      } catch (e) {
        // Fallback to existing path on any failure
      }
    }

    // Scanline fill with linear gradient + optional Sierra Lite dithering
    // Hoist invariants out of inner loops
    const bands = Math.max(2, this.gradientBands || 12);
    const colorStep = Math.floor(254 / bands);
    const baseOffset = this.stampCounter % 254; // Continue from last shape

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
        const startX = Math.floor(intersections[i]);
        const endX = Math.ceil(intersections[i + 1]);

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

              // Projection at block center
              const dx = xCenter - centerX;
              const dy = yCenterBlock - centerY;
              const projection = dx * dirX + dy * dirY;
              let r = Math.max(0, Math.min(1, (projection - minProjection) / projectionRange));
              if (this.ditherEnabled) {
                const jitterScale = 0.35;
                const quantLevels = Math.max(2, bands);
                const j = (noiseAt(xCenter, yCenterBlock) - 0.5) * (jitterScale / quantLevels);
                r = Math.max(0, Math.min(1, r + j));
              }

              const quantLevels = Math.max(2, bands);
              const qStep = 1.0 / (quantLevels - 1);
              const kLower = Math.max(0, Math.min(quantLevels - 1, Math.floor(r / qStep)));
              const lowerPos = Math.min(1, kLower * qStep);
              const upperPos = Math.min(1, (kLower + 1) * qStep);
              const frac = qStep > 0 ? Math.max(0, Math.min(1, (r - lowerPos) / qStep)) : 0;
              const adj = frac + (cErrCurr[cx] || 0);
              const thr = 0.5 + (noiseAt(xCenter, yCenterBlock) - 0.5) * thresholdJitter;
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

              const idxFromPos = (pos: number) => Math.max(1, Math.min(255, Math.round(pos * 254) + 1));
              cached = chooseUpper ? idxFromPos(upperPos) : idxFromPos(lowerPos);
              cellOutIdx[cy][cx] = cached;
            }

            // Fill the block clipped to the current span for this row
            const xBlock = ixBase + cx * cellSize;
            const xTo = Math.min(endX, xBlock + cellSize - 1);
            const fillStart = Math.max(startX, xBlock);
            if (fillStart <= xTo) {
              for (let xx = fillStart; xx <= xTo; xx++) {
                (animator as any).setIndex(xx, y, cached);
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
          const idxFromPos = (pos: number) => Math.max(1, Math.min(255, Math.round(pos * 254) + 1));
          const quantLevels = Math.max(2, bands);
          const qStep = 1.0 / (quantLevels - 1);

          if (!serpentine) {
            for (let x = startX; x <= endX; x++) {
              const dx = x - centerX;
              const dy = y - centerY;
              const projection = dx * dirX + dy * dirY;
              let r = Math.max(0, Math.min(1, (projection - minProjection) / projectionRange));
              if (this.ditherEnabled) {
                const jitterScale = 0.35;
                const quantLevels = Math.max(2, bands);
                const j = (noiseAt(x, y) - 0.5) * (jitterScale / quantLevels);
                r = Math.max(0, Math.min(1, r + j));
              }
              const kLower = Math.max(0, Math.min(quantLevels - 1, Math.floor(r / qStep)));
              const lowerPos = Math.min(1, kLower * qStep);
              const upperPos = Math.min(1, (kLower + 1) * qStep);
              const frac = qStep > 0 ? Math.max(0, Math.min(1, (r - lowerPos) / qStep)) : 0;
              const ix = x - ixBase;
              const adj = frac + (errCurr[ix] || 0);
              const thr = 0.5 + (noiseAt(x, y) - 0.5) * thresholdJitter;
              const chooseUpper = (kLower < quantLevels - 1) && (adj >= thr);
              const q = chooseUpper ? 1 : 0;
              const err = (frac - q) * this.ditherStrength;
              if (ix + 1 < bboxW) errCurr[ix + 1] += err * 0.5;
              if (ix - 1 >= 0) errNext[ix - 1] += err * 0.25;
              errNext[ix] += err * 0.25;
              const outIdx = chooseUpper ? idxFromPos(upperPos) : idxFromPos(lowerPos);
              (animator as any).setIndex(x, y, outIdx);
            }
          } else {
            for (let x = endX; x >= startX; x--) {
              const dx = x - centerX;
              const dy = y - centerY;
              const projection = dx * dirX + dy * dirY;
              let r = Math.max(0, Math.min(1, (projection - minProjection) / projectionRange));
              if (this.ditherEnabled) {
                const jitterScale = 0.35;
                const quantLevels = Math.max(2, bands);
                const j = (noiseAt(x, y) - 0.5) * (jitterScale / quantLevels);
                r = Math.max(0, Math.min(1, r + j));
              }
              const kLower = Math.max(0, Math.min(quantLevels - 1, Math.floor(r / qStep)));
              const lowerPos = Math.min(1, kLower * qStep);
              const upperPos = Math.min(1, (kLower + 1) * qStep);
              const frac = qStep > 0 ? Math.max(0, Math.min(1, (r - lowerPos) / qStep)) : 0;
              const ix = x - ixBase;
              const adj = frac + (errCurr[ix] || 0);
              const thr = 0.5 + (noiseAt(x, y) - 0.5) * thresholdJitter;
              const chooseUpper = (kLower < quantLevels - 1) && (adj >= thr);
              const q = chooseUpper ? 1 : 0;
              const err = (frac - q) * this.ditherStrength;
              if (ix - 1 >= 0) errCurr[ix - 1] += err * 0.5;
              if (ix + 1 < bboxW) errNext[ix + 1] += err * 0.25;
              errNext[ix] += err * 0.25;
              const outIdx = chooseUpper ? idxFromPos(upperPos) : idxFromPos(lowerPos);
              (animator as any).setIndex(x, y, outIdx);
            }
          }
        } else {
          // No dithering: continuous mapping end-to-end
          // Sample gradient position r in [0,1] and map directly to palette index 1..255
          const idxFromPos = (pos: number) => Math.max(1, Math.min(255, Math.round(pos * 254) + 1));
          for (let x = startX; x <= endX; x++) {
            const dx = x - centerX;
            const dy = y - centerY;
            const projection = dx * dirX + dy * dirY;
            const r = Math.max(0, Math.min(1, (projection - minProjection) / projectionRange));
            const outIdx = idxFromPos(r);
            animator.setIndex(x, y, outIdx);
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
  }
  
  /**
   * Fill shape with smooth gradient bands from edge to center (concentric)
   */
  fillShape(vertices: Array<{ x: number; y: number }>, layerId?: string, spacing?: number) {
    // Validate input
    if (!vertices || !Array.isArray(vertices)) {
      console.warn('Invalid vertices provided to fillShape');
      return;
    }
    
    if (vertices.length < 3) {
      console.warn('fillShape requires at least 3 vertices');
      return;
    }
    
    const id = layerId || this.activeLayerId || 'default';
    
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
    if ((animator as any)._deferredSize) {
      const { width, height } = (animator as any)._deferredSize;
      animator.resize(width, height);
      delete (animator as any)._deferredSize;
      
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
    const numBands = Math.max(2, this.gradientBands);
    const pixelSpacing = spacing || this.bandSpacing;

    // Adaptive performance: for very large shapes, skip costly per-edge distance checks
    // and approximate distance using only span boundaries (left/right). This reduces
    // complexity from O(pixels * edges) to roughly O(pixels).
    const bboxWidth = Math.max(0, Math.ceil(maxX) - Math.floor(minX) + 1);
    const bboxHeight = Math.max(0, Math.ceil(maxY) - Math.floor(minY) + 1);
    const bboxArea = bboxWidth * bboxHeight;
    // Preserve visual quality by default; fast approx disabled unless explicitly enabled
    const FAST_AREA_THRESHOLD = Number.POSITIVE_INFINITY;
    const useFastScanline = false && ((bboxArea >= FAST_AREA_THRESHOLD) || (vertices.length > 32));
    // Precompute edge vectors to avoid repeated math inside inner loop (no visual change)
    const edges = new Array(vertices.length);
    for (let j = 0; j < vertices.length; j++) {
      const v1 = vertices[j];
      const v2 = vertices[(j + 1) % vertices.length];
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const len2 = dx * dx + dy * dy;
      edges[j] = { v1x: v1.x, v1y: v1.y, dx, dy, len2 };
    }
    // Hoist invariants
    const shapeWidth = maxX - minX;
    const shapeHeight = maxY - minY;
    const shapeSize = Math.max(shapeWidth, shapeHeight);
    const maxDist = Math.max(50, shapeSize / 2);
    const maxDistSq = maxDist * maxDist;
    const invMaxDistSq = 1 / maxDistSq;
    const bands = this.gradientBands || 12;
    const bandStep = 1.0 / bands;
    const colorStep = Math.floor(254 / bands);
    const baseOffset = this.stampCounter % 254; // Continue from last shape
    // Precompute squared thresholds to avoid per-pixel sqrt
    const thresholdsSq = new Float32Array(bands);
    for (let b = 0; b < bands; b++) {
      const t = b * bandStep; // normalized distance in [0,1)
      thresholdsSq[b] = (t * t) * maxDistSq;
    }

    // Perceptual dithering path for concentric fill
    if (this.ditherEnabled && this.perceptualDither) {
      try {
        const id2 = layerId || this.activeLayerId || 'default';
        const animator2 = this.getAnimator(id2);
        const bbox2 = { minX: Math.floor(minX), minY: Math.floor(minY), width: Math.max(1, Math.ceil(maxX) - Math.floor(minX) + 1), height: Math.max(1, Math.ceil(maxY) - Math.floor(minY) + 1) };
        const width2 = bbox2.width; const height2 = bbox2.height;
        const img2 = new ImageData(width2, height2);
        const data2 = img2.data; const x02 = bbox2.minX; const y02 = bbox2.minY;

        // Precompute edges once
        const edges2 = new Array(vertices.length);
        for (let j = 0; j < vertices.length; j++) {
          const v1 = vertices[j]; const v2 = vertices[(j + 1) % vertices.length];
          const dx = v2.x - v1.x; const dy = v2.y - v1.y; const len2 = dx * dx + dy * dy;
          edges2[j] = { v1x: v1.x, v1y: v1.y, dx, dy, len2 };
        }

        // Build row spans (scanline polygon fill)
        const spans2: Array<Array<[number, number]>> = [];
        for (let y = y02; y <= Math.ceil(maxY); y++) {
          const ints: number[] = [];
          for (let i = 0; i < vertices.length; i++) {
            const v1 = vertices[i]; const v2 = vertices[(i + 1) % vertices.length];
            if (Math.abs(v2.y - v1.y) < 1e-4) continue;
            if ((v1.y <= y && v2.y > y) || (v2.y <= y && v1.y > y)) {
              const t = (y - v1.y) / (v2.y - v1.y);
              const x = v1.x + t * (v2.x - v1.x);
              ints.push(x);
            }
          }
          ints.sort((a, b) => a - b);
          const row: [number, number][] = [];
          for (let i = 0; i < ints.length - 1; i += 2) row.push([Math.floor(ints[i]), Math.ceil(ints[i + 1])]);
          spans2.push(row);
        }

        // Precompute distance parameters (edge to center bands)
        const shapeWidth2 = maxX - minX;
        const shapeHeight2 = maxY - minY;
        const shapeSize2 = Math.max(shapeWidth2, shapeHeight2);
        const maxDist2 = Math.max(50, shapeSize2 / 2);

        // Fill gradient colors into buffer using concentric distance
        for (let yy = 0; yy < height2; yy++) {
          const y = y02 + yy; const rowSpans = spans2[yy] || [];
          for (const [sx, ex] of rowSpans) {
            for (let x = sx; x <= ex; x++) {
              const xx = x - x02; if (xx < 0 || xx >= width2) continue;
              let minDistSq = Infinity;
              const left = x - sx; const right = ex - x; const dLR = Math.min(left * left, right * right);
              minDistSq = Math.min(minDistSq, dLR);
              for (let j = 0; j < edges2.length; j++) {
                const e = edges2[j]; if (e.len2 <= 0) continue;
                const tNum = (x - e.v1x) * e.dx + (y - e.v1y) * e.dy; const t = Math.max(0, Math.min(1, tNum / e.len2));
                const px = e.v1x + t * e.dx; const py = e.v1y + t * e.dy;
                const dx = x - px; const dy = y - py; const d2 = dx * dx + dy * dy;
                if (d2 < minDistSq) { minDistSq = d2; if (minDistSq <= 1) break; }
              }
              const r = Math.min(1, Math.sqrt(minDistSq) / maxDist2);
              const { r: R, g: G, b: B } = this.colorAtPosition(r);
              const p = (yy * width2 + xx) * 4; data2[p] = R; data2[p + 1] = G; data2[p + 2] = B; data2[p + 3] = 255;
            }
          }
        }

        const quantLevels2 = Math.max(2, this.gradientBands || 12);
        const { css: paletteCss2, mapRgbToIndex: mapRgbToIndex2 } = this.buildQuantizedGradientPalette(quantLevels2);
        const { applyDitheringWithFillResolution: applyDitherFR } = require('./dithering');
        const dithered2: ImageData = applyDitherFR(img2, quantLevels2, Math.max(1, this.ditherPixelSize), 'sierra-lite', undefined, paletteCss2);
        const out2 = dithered2.data;
        for (let yy = 0; yy < height2; yy++) {
          const y = y02 + yy; const rowSpans = spans2[yy] || [];
          for (const [sx, ex] of rowSpans) {
            for (let x = sx; x <= ex; x++) {
              const xx = x - x02; if (xx < 0 || xx >= width2) continue;
              const p = (yy * width2 + xx) * 4; const key = `${out2[p]},${out2[p + 1]},${out2[p + 2]}`;
              const gi = mapRgbToIndex2.get(key); if (gi !== undefined) (animator2 as any).setIndex(x, y, gi);
            }
          }
        }

        this.stampCounter += quantLevels2; if (strokeData) strokeData.stampCounter = this.stampCounter;
        this.dirtyLayers.add(id2); animator2.forceRender(); this.render(false); return;
      } catch (e) { /* fall back to index-space path */ }
    }

    // Attempt GPU path (simple rule: use when available and within uniform limits)
    try {
      const anyAnimator: any = animator as any;
      const hasMethod = (anyAnimator && typeof anyAnimator.gpuFillShapeConcentric === 'function');
      const hasGL = (anyAnimator && typeof anyAnimator.hasWebGL === 'function') ? anyAnimator.hasWebGL() : false;
      const tryGPU = hasMethod && hasGL && !this.ditherEnabled; // skip GPU when dithering is enabled
      const bbox = {
        minX: Math.floor(minX),
        minY: Math.floor(minY),
        width: Math.max(1, Math.ceil(maxX) - Math.floor(minX) + 1),
        height: Math.max(1, Math.ceil(maxY) - Math.floor(minY) + 1)
      };
      const bandsForGPU = bands;
      const baseOffset = this.stampCounter % 254;
      // Guard GPU path for complex polygons: fallback to CPU when vertex count exceeds shader uniform limit
      // Determine runtime GPU vertex limit from animator if available
      const runtimeMax = (anyAnimator && typeof anyAnimator.getGLFillMaxVerts === 'function') ? (anyAnimator.getGLFillMaxVerts() || 256) : 256;
      const GPU_MAX_VERTS = Math.max(8, Math.min(256, runtimeMax));
      // If over the limit, try to simplify polygon to meet the limit
      let gpuVertices = vertices;
      if (tryGPU && vertices.length > GPU_MAX_VERTS) {
        const simplified = simplifyToVertexLimit(vertices, GPU_MAX_VERTS, { initialTolerance: 0.5, maxTolerance: 12, stepFactor: 1.8 });
        // quiet
        gpuVertices = simplified;
      }
      const withinVertLimit = gpuVertices.length <= GPU_MAX_VERTS;
      // Clean rule: if GPU is available and within uniform limit, always use GPU (any size)
      if (tryGPU && withinVertLimit) {
        // quiet
        // GPU concentric fill
        const ok = anyAnimator.gpuFillShapeConcentric(gpuVertices, bandsForGPU, baseOffset, colorStep, maxDist, bbox);
        if (ok) {
          // Continue stamp progression and render
          this.stampCounter += Math.max(2, this.gradientBands);
          if (strokeData) strokeData.stampCounter = this.stampCounter;
          this.dirtyLayers.add(id);
          anyAnimator.forceRender?.();
          this.render(false);
          return;
        } else {
          // quiet
        }
      }
      // GPU not used - quiet
    } catch {}

    // CPU fallback path
    const bboxInfo = { minX: Math.floor(minX), minY: Math.floor(minY), width: Math.max(1, Math.ceil(maxX) - Math.floor(minX) + 1), height: Math.max(1, Math.ceil(maxY) - Math.floor(minY) + 1) };
    // Prepare error diffusion accumulators for Sierra Lite dithering across the bbox width
    const bboxW = bboxInfo.width;
    let errCurr = new Float32Array(bboxW);
    let errNext = new Float32Array(bboxW);
    const ixBase = bboxInfo.minX;
    // Lightweight, deterministic pixel noise for threshold jitter (reduces visible patterns)
    const noiseAt = (x: number, y: number): number => {
      // 2D hash -> [0,1)
      let n = (x | 0) * 374761393 + (y | 0) * 668265263; // large primes
      n = (n ^ (n >>> 13)) * 1274126177;
      n = (n ^ (n >>> 16)) >>> 0;
      return (n & 0xffff) / 65536; // 16-bit fraction
    };
    const thresholdJitter = 0.2; // +/-10% around 0.5
    // Dither pixel size: when >1 and dithering enabled, we optionally switch to
    // block-based dithering so the pattern is visually "zoomed" into larger cells.
    // This matches the desired UX of a pixel-resolution slider.
    const cellSize = Math.max(1, this.ditherEnabled ? this.ditherPixelSize : 1);
    if (this.ditherEnabled && cellSize > 1) {
      const y0 = Math.floor(minY);
      const yMax = Math.ceil(maxY);
      const cellsAcross = Math.max(1, Math.ceil(bboxW / cellSize));
      let cErrCurr = new Float32Array(cellsAcross);
      let cErrNext = new Float32Array(cellsAcross);
      const idxFromPos = (pos: number) => ((baseOffset + Math.round(pos * 254)) % 254) + 1;

      for (let yb = y0, rowIdx = 0; yb <= yMax; yb += cellSize, rowIdx++) {
        const tmp = cErrCurr; cErrCurr = cErrNext; cErrNext = tmp; cErrNext.fill(0);
        const serpentine = (rowIdx & 1) === 1;
        const yCenter = Math.min(yMax, yb + Math.floor(cellSize / 2));
        const intersections: number[] = [];
        for (let i = 0; i < vertices.length; i++) {
          const v1 = vertices[i];
          const v2 = vertices[(i + 1) % vertices.length];
          if (Math.abs(v2.y - v1.y) < 0.0001) continue;
          if ((v1.y <= yCenter && v2.y > yCenter) || (v2.y <= yCenter && v1.y > yCenter)) {
            const t = (yCenter - v1.y) / (v2.y - v1.y);
            const x = v1.x + t * (v2.x - v1.x);
            intersections.push(x);
          }
        }
        intersections.sort((a, b) => a - b);

        for (let i = 0; i < intersections.length - 1; i += 2) {
          const startX = Math.floor(intersections[i]);
          const endX = Math.ceil(intersections[i + 1]);
          const xStartCell = Math.floor((startX - ixBase) / cellSize);
          const xEndCell = Math.floor((endX - ixBase) / cellSize);

          // Precompute per-row horizontal spans for crisp edge clipping within this block
          const rowClips: Array<{ start: number; end: number } | null> = [];
          const yTo = Math.min(yMax, yb + cellSize - 1);
          for (let yy = yb; yy <= yTo; yy++) {
            const intsRow: number[] = [];
            for (let k = 0; k < vertices.length; k++) {
              const a = vertices[k];
              const b = vertices[(k + 1) % vertices.length];
              if (Math.abs(b.y - a.y) < 0.0001) continue;
              if ((a.y <= yy && b.y > yy) || (b.y <= yy && a.y > yy)) {
                const t = (yy - a.y) / (b.y - a.y);
                const x = a.x + t * (b.x - a.x);
                intsRow.push(x);
              }
            }
            intsRow.sort((a, b) => a - b);
            if (intsRow.length >= i + 2) {
              rowClips.push({ start: Math.floor(intsRow[i]), end: Math.ceil(intsRow[i + 1]) });
            } else {
              // Fallback to center-row span
              rowClips.push({ start: startX, end: endX });
            }
          }

          const processCell = (cx: number) => {
            const xBlock = ixBase + cx * cellSize;
            const xCenter = Math.min(endX, xBlock + Math.floor(cellSize / 2));
            // Distance at cell center
            let minDistSq = Infinity;
            const distLeft = xCenter - startX;
            const distRight = endX - xCenter;
            minDistSq = Math.min(distLeft * distLeft, distRight * distRight);
            for (let j = 0; j < edges.length; j++) {
              const e = edges[j];
              if (e.len2 > 0) {
                const tNum = (xCenter - e.v1x) * e.dx + (yCenter - e.v1y) * e.dy;
                const t = Math.max(0, Math.min(1, tNum / e.len2));
                const projX = e.v1x + t * e.dx;
                const projY = e.v1y + t * e.dy;
                const dxp = xCenter - projX;
                const dyp = yCenter - projY;
                const d2 = dxp * dxp + dyp * dyp;
                if (d2 < minDistSq) { minDistSq = d2; if (minDistSq <= 1) break; }
              }
            }
            let r = Math.min(1, Math.sqrt(minDistSq) / maxDist);
            // Small position jitter proportional to quantization step to reduce residual banding
            if (this.ditherEnabled) {
              const jitterScale = 0.35; // 0..1 of a step
              const quantLevels = Math.max(2, bands);
              const j = (noiseAt(xCenter, yCenter) - 0.5) * (jitterScale / quantLevels);
              r = Math.max(0, Math.min(1, r + j));
            }
            // Quantize to the user-selected number of bands; dithering
            // toggles between adjacent band levels (Sierra Lite).
            const quantLevels = Math.max(2, bands);
            const qStep = quantLevels > 1 ? 1.0 / (quantLevels - 1) : 1.0;
            const kLower = Math.max(0, Math.min(quantLevels - 1, Math.floor(r / qStep)));
            const lowerPos = Math.min(1, kLower * qStep);
            const upperPos = Math.min(1, (kLower + 1) * qStep);
            const frac = qStep > 0 ? Math.max(0, Math.min(1, (r - lowerPos) / qStep)) : 0;
            const adj = frac + (cErrCurr[cx] || 0);
            const thr = 0.5 + (noiseAt(xCenter, yCenter) - 0.5) * thresholdJitter;
            const chooseUpper = (kLower < quantLevels - 1) && (adj >= thr);
            const q = chooseUpper ? 1 : 0;
            const err = (frac - q) * this.ditherStrength;
            if (!serpentine) {
              if (cx + 1 < cellsAcross) cErrCurr[cx + 1] += err * 0.5;
              if (cx - 1 >= 0) cErrNext[cx - 1] += err * 0.25;
            } else {
              if (cx - 1 >= 0) cErrCurr[cx - 1] += err * 0.5;
              if (cx + 1 < cellsAcross) cErrNext[cx + 1] += err * 0.25;
            }
            cErrNext[cx] += err * 0.25;
            const outIdx = chooseUpper ? idxFromPos(upperPos) : idxFromPos(lowerPos);
            const xTo = Math.min(endX, xBlock + cellSize - 1);
            for (let yy = yb; yy <= yTo; yy++) {
              const clip = rowClips[yy - yb];
              if (!clip) continue;
              const fillStart = Math.max(clip.start, xBlock);
              const fillEnd = Math.min(clip.end, xTo);
              if (fillStart <= fillEnd) {
                for (let xx = fillStart; xx <= fillEnd; xx++) {
                  (animator as any).setIndex(xx, yy, outIdx);
                }
              }
            }
          };

          if (!serpentine) {
            for (let cx = xStartCell; cx <= xEndCell; cx++) processCell(cx);
          } else {
            for (let cx = xEndCell; cx >= xStartCell; cx--) processCell(cx);
          }
        }
      }

      this.stampCounter += numBands;
      if (strokeData) strokeData.stampCounter = this.stampCounter;
      this.dirtyLayers.add(id);
      animator.forceRender();
      this.render(false);
      return;
    }
    // quiet

    const yBase = Math.floor(minY);
    for (let y = yBase; y <= Math.ceil(maxY); y++) {
      // Swap current/next error rows and clear next
      const swap = errCurr; errCurr = errNext; errNext = swap; errNext.fill(0);
      const intersections: number[] = [];
      
      // Find all edge intersections with this scanline
      for (let i = 0; i < vertices.length; i++) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % vertices.length];
        
        // Skip horizontal edges
        if (Math.abs(v2.y - v1.y) < 0.0001) continue;
        
        // Check if edge crosses this scanline
        if ((v1.y <= y && v2.y > y) || (v2.y <= y && v1.y > y)) {
          const t = (y - v1.y) / (v2.y - v1.y);
          const x = v1.x + t * (v2.x - v1.x);
          intersections.push(x);
        }
      }
      
      // Sort intersections left to right
      intersections.sort((a, b) => a - b);
      
      // Fill between EVERY pair of intersections
      for (let i = 0; i < intersections.length - 1; i += 2) {
        const startX = Math.floor(intersections[i]);
        const endX = Math.ceil(intersections[i + 1]);
        const rowIndex = y - Math.floor(minY);
        const serpentine = (rowIndex & 1) === 1; // alternate direction per row

        if (useFastScanline) {
          // Fast approximation: distance from span edges only (no per-edge projections)
          const half = Math.max(1, (endX - startX) / 2);
          for (let x = startX; x <= endX; x++) {
            const d = Math.min(x - startX, endX - x);
            const normalized = Math.min(1, d / half);
            const bandIndex = Math.min(bands - 1, Math.floor(normalized / bandStep));
            const colorIndex = ((baseOffset + bandIndex * colorStep) % 254) + 1;
            (animator as any).setIndex(x, y, colorIndex);
          }
        } else {
          if (!serpentine) {
            for (let x = startX; x <= endX; x++) {
              // Calculate squared distance to nearest edge for gradient (sqrt once per pixel)
              // Sample at tile center to keep dither "pixel" size while preserving mask
              const tileXCenter = ixBase + Math.floor((x - ixBase) / cellSize) * cellSize + Math.floor(cellSize / 2);
              const tileYCenter = yBase + Math.floor((y - yBase) / cellSize) * cellSize + Math.floor(cellSize / 2);
              let minDistSq = Infinity;
              // Distance to left and right boundaries of this span (squared), sample at tile center
              const distLeft = tileXCenter - startX;
              const distRight = endX - tileXCenter;
              const distLeftSq = distLeft * distLeft;
              const distRightSq = distRight * distRight;
              minDistSq = distLeftSq < distRightSq ? distLeftSq : distRightSq;

              // Precise distance to polygon edges (squared)
              for (let j = 0; j < edges.length; j++) {
                const e = edges[j];
                if (e.len2 > 0) {
                  const tNum = (tileXCenter - e.v1x) * e.dx + (tileYCenter - e.v1y) * e.dy;
                  const t = Math.max(0, Math.min(1, tNum / e.len2));
                  const projX = e.v1x + t * e.dx;
                  const projY = e.v1y + t * e.dy;
                  const dxp = tileXCenter - projX;
                  const dyp = tileYCenter - projY;
                  const distSq = dxp * dxp + dyp * dyp;
                  if (distSq < minDistSq) {
                    minDistSq = distSq;
                    if (minDistSq <= 1) break; // early out if essentially on edge
                  }
                }
              }

          // Continuous normalized distance [0,1]
          let r = Math.min(1, Math.sqrt(minDistSq) / maxDist);
          if (this.ditherEnabled) {
            const jitterScale = 0.35;
            const quantLevels = Math.max(2, bands);
            const j = (noiseAt(tileXCenter, tileYCenter) - 0.5) * (jitterScale / quantLevels);
            r = Math.max(0, Math.min(1, r + j));
          }
          // Quantize to the user-selected number of bands; dithering
          // toggles between adjacent band levels (Sierra Lite).
          const quantLevels = Math.max(2, bands);
          const qStep = quantLevels > 1 ? 1.0 / (quantLevels - 1) : 1.0;
          const kLower = Math.max(0, Math.min(quantLevels - 1, Math.floor(r / qStep)));
          const lowerPos = Math.min(1, kLower * qStep);
          const upperPos = Math.min(1, (kLower + 1) * qStep);
          const frac = qStep > 0 ? Math.max(0, Math.min(1, (r - lowerPos) / qStep)) : 0;
          const idxFromPos = (pos: number) => Math.max(1, Math.min(255, Math.round(pos * 254) + 1));

          if (this.ditherEnabled) {
              // Sierra Lite between adjacent quantization levels
              const ix = x - ixBase;
              const adj = frac + (errCurr[ix] || 0);
              const thr = 0.5 + (noiseAt(tileXCenter, tileYCenter) - 0.5) * thresholdJitter; // jittered threshold per tile
              const chooseUpper = (kLower < quantLevels - 1) && (adj >= thr);
              const q = chooseUpper ? 1 : 0;
              const err = (frac - q) * this.ditherStrength;

              // Distribute error L->R: right(2/4), bottom-left(1/4), bottom(1/4)
              if (ix + 1 < bboxW) errCurr[ix + 1] += err * 0.5;
              if (ix - 1 >= 0) errNext[ix - 1] += err * 0.25;
              errNext[ix] += err * 0.25;

              const lowerIdx = idxFromPos(lowerPos);
              const upperIdx = idxFromPos(upperPos);
              (animator as any).setIndex(x, y, chooseUpper ? upperIdx : lowerIdx);
          } else {
              // No dithering: choose the quantized lower position
              const colorIndex = idxFromPos(lowerPos);
              (animator as any).setIndex(x, y, colorIndex);
          }
            }
          } else {
            // Serpentine: process right-to-left on odd rows
            for (let x = endX; x >= startX; x--) {
              // Calculate squared distance to nearest edge for gradient (sqrt once per pixel)
              const tileXCenter = ixBase + Math.floor((x - ixBase) / cellSize) * cellSize + Math.floor(cellSize / 2);
              const tileYCenter = yBase + Math.floor((y - yBase) / cellSize) * cellSize + Math.floor(cellSize / 2);
              let minDistSq = Infinity;
              const distLeft = tileXCenter - startX;
              const distRight = endX - tileXCenter;
              const distLeftSq = distLeft * distLeft;
              const distRightSq = distRight * distRight;
              minDistSq = distLeftSq < distRightSq ? distLeftSq : distRightSq;

              for (let j = 0; j < edges.length; j++) {
                const e = edges[j];
                if (e.len2 > 0) {
                  const tNum = (tileXCenter - e.v1x) * e.dx + (tileYCenter - e.v1y) * e.dy;
                  const t = Math.max(0, Math.min(1, tNum / e.len2));
                  const projX = e.v1x + t * e.dx;
                  const projY = e.v1y + t * e.dy;
                  const dxp = tileXCenter - projX;
                  const dyp = tileYCenter - projY;
                  const distSq = dxp * dxp + dyp * dyp;
                  if (distSq < minDistSq) {
                    minDistSq = distSq;
                    if (minDistSq <= 1) break;
                  }
                }
              }

          // Continuous normalized distance [0,1]
          let r = Math.min(1, Math.sqrt(minDistSq) / maxDist);
          if (this.ditherEnabled) {
            const jitterScale = 0.35;
            const quantLevels = Math.max(2, bands);
            const j = (noiseAt(tileXCenter, tileYCenter) - 0.5) * (jitterScale / quantLevels);
            r = Math.max(0, Math.min(1, r + j));
          }
          // Quantize to the user-selected number of bands; dithering
          // toggles between adjacent band levels (Sierra Lite).
          const quantLevels = Math.max(2, bands);
          const qStep = quantLevels > 1 ? 1.0 / (quantLevels - 1) : 1.0;
          const kLower = Math.max(0, Math.min(quantLevels - 1, Math.floor(r / qStep)));
          const lowerPos = Math.min(1, kLower * qStep);
          const upperPos = Math.min(1, (kLower + 1) * qStep);
          const frac = qStep > 0 ? Math.max(0, Math.min(1, (r - lowerPos) / qStep)) : 0;
          const idxFromPos = (pos: number) => Math.max(1, Math.min(255, Math.round(pos * 254) + 1));

              if (this.ditherEnabled) {
                const ix = x - ixBase;
                const adj = frac + (errCurr[ix] || 0);
                const thr = 0.5 + (noiseAt(tileXCenter, tileYCenter) - 0.5) * thresholdJitter;
                const chooseUpper = (kLower < quantLevels - 1) && (adj >= thr);
                const q = chooseUpper ? 1 : 0;
                const err = (frac - q) * this.ditherStrength;

                // Distribute error R->L: left(2/4), bottom-right(1/4), bottom(1/4)
                if (ix - 1 >= 0) errCurr[ix - 1] += err * 0.5;
                if (ix + 1 < bboxW) errNext[ix + 1] += err * 0.25;
                errNext[ix] += err * 0.25;

                const lowerIdx = idxFromPos(lowerPos);
                const upperIdx = idxFromPos(upperPos);
                (animator as any).setIndex(x, y, chooseUpper ? upperIdx : lowerIdx);
              } else {
                const colorIndex = idxFromPos(lowerPos);
                (animator as any).setIndex(x, y, colorIndex);
              }
            }
          }
        }
      }
    }
    
    // Increment stamp counter for next shape to continue gradient sequence
    this.stampCounter += numBands;
    if (strokeData) {
      strokeData.stampCounter = this.stampCounter;
    }
    
    // Mark layer as dirty for rendering
    this.dirtyLayers.add(id);
    
    // Force immediate render to show the filled shape
    animator.forceRender();
    this.render(false);
  }
  
  /**
   * Clear (API compatible)
   */
  clear() {
    this.animators.forEach(animator => animator.clear());
    this.layerStrokes.clear();
    this.render(false);
  }
  
  /**
   * Render current frame (API compatible)
   */
  render(forceFullOpacity: boolean = false) {
    // Determine if any layer actually has stroke content to render.
    // If not, do NOT clear/draw onto the layer canvas — this preserves
    // already committed pixels on the color-cycle layer after mouseup.
    let anyContent = false;
    this.animators.forEach((_, layerId) => {
      const strokeData = this.layerStrokes.get(layerId);
      if (strokeData?.hasContent) anyContent = true;
    });

    if (!anyContent) {
      // Nothing to render right now; preserve existing layer pixels.
      if (this.onFrameRendered) {
        this.onFrameRendered();
      }
      return;
    }

    // Clear composite canvas
    this.compositeCtx.clearRect(0, 0, this.width, this.height);

    // Composite all layers with content
    let renderedLayers = 0;
    this.animators.forEach((animator, layerId) => {
      const strokeData = this.layerStrokes.get(layerId);
      if (strokeData?.hasContent) {
        animator.drawTo(this.compositeCtx);
        renderedLayers++;
      }
    });

    // Draw to webgl canvas (actually just a regular canvas)
    const webglCtx = this.webglCanvas.getContext('2d');
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
    if (animator) {
      const strokeData = this.layerStrokes.get(layerId);
      // Only render if there's actual content to render
      if (strokeData?.hasContent) {
        const ctx = targetCanvas.getContext('2d');
        if (ctx) {
          // Force a render update before drawing
          animator.forceRender();
          animator.drawTo(ctx);
        } else {
          console.warn('Failed to get 2D context from target canvas');
        }
      } else {
        // IMPORTANT: Do NOT clear the canvas here.
        // When undo/redo restores pixel data directly to the layer canvas,
        // calling renderDirectToCanvas without stroke content should leave
        // the existing pixels intact.
      }
    }
  }

  /**
   * Finalize any pending stroke and force a render so callers can commit
   * the latest frame to a canvas.
   */
  commitCurrentStroke(layerId?: string) {
    try {
      this.finalizeCurrentStroke(layerId);
      const id = layerId || this.activeLayerId || 'default';
      const animator = this.animators.get(id);
      if (animator) {
        animator.forceRender();
      }
    } catch (e) {
      console.warn('[ColorCycleBrush.commitCurrentStroke] Failed to finalize stroke:', e);
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

    const strokeData = this.layerStrokes.get(layerId);
    // Always attempt commit; sampling small regions can yield false negatives
    // when strokes are far from origin. Drawing is idempotent for empty frames.
    let srcHasContent = false;
    try {
      const aCanvas = animator.getCanvas?.();
      const aCtx = aCanvas?.getContext?.('2d', { willReadFrequently: true } as any);
      if (aCanvas && aCtx) {
        const w = Math.min(10, aCanvas.width);
        const h = Math.min(10, aCanvas.height);
        const img = aCtx.getImageData(0, 0, w, h).data;
        for (let i = 3; i < img.length; i += 4) { if (img[i] > 0) { srcHasContent = true; break; } }
      }
    } catch {}

    const ctx = targetCanvas.getContext('2d', { willReadFrequently: true } as any);
    if (!ctx) {
      console.warn('[ColorCycleBrush.commitToLayer] Failed to acquire 2D context');
      return;
    }

    // Ensure animator has the latest frame
    try { animator.forceRender(); } catch {}

    const srcCanvas = animator.getCanvas();

    // If the target is the same canvas as the animator's internal canvas,
    // do not draw onto itself. forceRender() already updated pixels.
    if (srcCanvas === targetCanvas) {
      // Skip drawing to same canvas; already up to date
      return;
    }

    // Save state and composite using source-over at full opacity
    const prevComposite = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    const prevSmoothing = (ctx as any).imageSmoothingEnabled;
    // Save full context state (transform, clip, etc.)
    try { ctx.save(); } catch {}
    try {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      // Ensure no stray transforms affect placement
      try { (ctx as any).setTransform?.(1, 0, 0, 1, 0, 0); } catch {}
      if (typeof prevSmoothing === 'boolean') {
        (ctx as any).imageSmoothingEnabled = false;
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
      if (typeof prevSmoothing === 'boolean') {
        (ctx as any).imageSmoothingEnabled = prevSmoothing;
      }
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
      if ((animator as any).setPhase) {
        (animator as any).setPhase(p);
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
    if (!Number.isFinite(spacing) || spacing < 1 || spacing > 100) {
      console.warn(`Invalid band spacing: ${spacing}, using default`);
      return;
    }
    this.bandSpacing = Math.floor(spacing);
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
  setFlowDirection(direction: 'forward' | 'backward') {
    this.animators.forEach(animator => animator.setFlowDirection(direction));
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
  restoreFullState(state: any) {
    try {
      console.log('[ColorCycleBrush] restoreFullState called', {
        hasSnapshots: !!(state && (state as any).layerSnapshots),
        snapshotCount: Array.isArray((state as any)?.layerSnapshots)
          ? (state as any).layerSnapshots.length
          : ((state as any)?.layerSnapshots instanceof Map
              ? (state as any).layerSnapshots.size
              : 0),
        caller: new Error().stack?.split('\n')[2]?.trim()
      });
    } catch {}
    
    // The canvas pixels are restored separately from history; treat them as source of truth.
    // IMPORTANT: Clear internal paint buffers AND animator canvases for affected layers
    // so stale pixels don't reappear on the next stroke/composite.

    // Update basic settings only
    if (state.cycleSpeed !== undefined) this.cycleSpeed = state.cycleSpeed;
    if (state.fps !== undefined) this.fps = state.fps;
    if (state.brushSize !== undefined) this.brushSize = state.brushSize;
    
    // First, proactively clear the affected layers' internal state (strokeData + animator canvas)
    if (state && state.layerSnapshots) {
      const clearForLayer = (layerId: string) => {
        const sd = this.layerStrokes.get(layerId);
        if (sd) {
          console.log('[ColorCycleBrush] Paint buffer cleared during restore for layer:', layerId?.substring(0, 20));
          sd.paintBuffer.fill(0);
          sd.hasContent = false;
          sd.strokeCounter = 0;
          sd.strokeLength = 0;
          sd.lastPoint = null;
          sd.stampCounter = 0;
        }
        const animator = this.animators.get(layerId);
        if (animator) {
          // Clear the animator canvas so no stale pixels remain
          try { animator.clear(); } catch {}
        }
      };

      if (state.layerSnapshots instanceof Map) {
        state.layerSnapshots.forEach((_buffer: ArrayBuffer, layerId: string) => clearForLayer(layerId));
      } else if (Array.isArray(state.layerSnapshots)) {
        for (const ls of state.layerSnapshots) {
          if (ls?.layerId) clearForLayer(ls.layerId);
        }
      }
      // Clear composite so future draws don't include stale pixels
      this.compositeCtx.clearRect(0, 0, this.width, this.height);
    }

    // Apply or clear stroke data for layers listed in the snapshot
    if (state && state.layerSnapshots) {
      // Accept Map(layerId -> ArrayBuffer) or Array<{layerId, paintBuffer}>
      if (state.layerSnapshots instanceof Map) {
        state.layerSnapshots.forEach((buffer: ArrayBuffer, layerId: string) => {
          this.applyLayerSnapshot(layerId, {
            paintBuffer: buffer,
            hasContent: !!buffer && (buffer as ArrayBuffer).byteLength > 0,
            strokeCounter: 0
          }, /*extra*/ undefined);
        });
      } else if (Array.isArray(state.layerSnapshots)) {
        state.layerSnapshots.forEach((ls: any) => {
          this.applyLayerSnapshot(ls.layerId, {
            paintBuffer: ls.paintBuffer,
            hasContent: !!ls.hasContent || (!!ls.paintBuffer && ls.paintBuffer.byteLength > 0),
            strokeCounter: ls.strokeCounter || 0
          }, ls?.animatorIndex);
        });
      }
    }
    
    try { console.log('[ColorCycleBrush] Settings updated and stroke data cleared for restored layers'); } catch {}
  }

  /**
   * Debug helper: verify that the animator canvas for a layer is cleared (alpha == 0)
   */
  verifyPaintBufferCleared(layerId?: string): boolean {
    const id = layerId || this.activeLayerId || 'default';
    const animator = this.animators.get(id);
    if (!animator || !animator.getCanvas) {
      console.log('[Debug] No animator/canvas exists for layer:', id);
      return true;
    }
    try {
      const canvas = animator.getCanvas();
      const ctx = canvas.getContext('2d');
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
    } catch (e) {
      console.warn('[Debug] Failed to verify animator canvas content:', e);
      return false;
    }
  }
  
  /**
   * Serialize state (API compatible simplified)
   */
  serialize() {
    const layers: any[] = [];
    
    this.animators.forEach((animator, layerId) => {
      const strokeData = this.layerStrokes.get(layerId);
      if (strokeData?.hasContent) {
        layers.push({
          layerId,
          data: animator.serialize(),
          strokeData: {
            hasContent: strokeData.hasContent,
            strokeCounter: strokeData.strokeCounter,
            paintBuffer: strokeData.paintBuffer?.buffer ? strokeData.paintBuffer.buffer.slice(0) : new ArrayBuffer(0)
          }
        });
      }
    });
    
    return {
      layers,
      cycleSpeed: this.cycleSpeed,
      fps: this.fps,
      brushSize: this.brushSize
    };
  }
  
  /**
   * Deserialize state (API compatible simplified)
   */
  static deserialize(data: any, canvas: HTMLCanvasElement): ColorCycleBrushCanvas2D {
    const instance = new ColorCycleBrushCanvas2D(canvas, {
      brushSize: data.brushSize,
      fps: data.fps
    });
    
    instance.setSpeed(data.cycleSpeed);
    
    // Restore layers
    if (data.layers) {
      data.layers.forEach((layer: any) => {
        const buf: ArrayBuffer = layer?.strokeData?.paintBuffer || new ArrayBuffer(0);
        instance.applyLayerSnapshot(layer.layerId, {
          paintBuffer: buf,
          hasContent: layer?.strokeData?.hasContent || (buf.byteLength > 0),
          strokeCounter: layer?.strokeData?.strokeCounter || 0
        });
      });
    }
    
    return instance;
  }

  /**
   * Export a snapshot of a layer's stroke data
   */
  getLayerSnapshot(layerId: string): { paintBuffer: ArrayBuffer; hasContent: boolean; strokeCounter: number } | null {
    const strokeData = this.layerStrokes.get(layerId);
    if (!strokeData) return null;
    return {
      paintBuffer: strokeData.paintBuffer?.buffer ? strokeData.paintBuffer.buffer.slice(0) : new ArrayBuffer(0),
      hasContent: !!strokeData.hasContent,
      strokeCounter: strokeData.strokeCounter || 0
    };
  }

  /**
   * Apply a snapshot to a layer's stroke data
   */
  applyLayerSnapshot(layerId: string, snapshot: { paintBuffer: ArrayBuffer; hasContent: boolean; strokeCounter: number }, animatorIndex?: { width: number; height: number; data: ArrayBuffer; gradientStops?: { position: number; color: string }[] }) {
    // Ensure animator exists for this layer
    let animator = this.animators.get(layerId);
    if (!animator) {
      animator = this.getAnimator(layerId);
    }
    const buffer = snapshot.paintBuffer || new ArrayBuffer(0);
    const existing = this.layerStrokes.get(layerId);
    const expectedSize = this.width * this.height;
    const incoming = new Uint8Array(buffer);
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
      stampCounter: 0
    };
    // Copy buffer (best-effort): if sizes differ, copy the overlapping region
    if (incoming.length > 0) {
      if (incoming.length === expectedSize) {
        strokeData.paintBuffer.set(incoming);
      } else {
        const copyLen = Math.min(expectedSize, incoming.length);
        strokeData.paintBuffer.fill(0);
        strokeData.paintBuffer.set(incoming.subarray(0, copyLen));
      }
    } else {
      // No incoming data — keep existing contents rather than wiping
      // to avoid undo clearing the entire layer unexpectedly.
      // If this is the very first restore for this layer, ensure buffer exists
      if (strokeData.paintBuffer.length !== expectedSize) {
        strokeData.paintBuffer = new Uint8Array(expectedSize);
      }
    }
    let hasLayerContent = (incoming.length > 0 ? incoming.some(v => v !== 0) : strokeData.paintBuffer.some(v => v !== 0)) && !!snapshot.hasContent;

    // If animator index buffer is provided, rebuild animator from it to preserve prior pixels
    if (animatorIndex && animatorIndex.data && animatorIndex.width && animatorIndex.height) {
      try {
        const { ColorCycleAnimator } = require('../../lib/ColorCycleAnimator');
        const dataArr = new Uint8Array(animatorIndex.data);
        const anyNonZero = dataArr.some(v => v !== 0);
        // Build a minimal serialized object for deserialization
        const serialized = {
          indexBuffer: {
            width: animatorIndex.width,
            height: animatorIndex.height,
            data: dataArr,
            palette: [] as string[]
          },
          gradient: { gradientStops: animatorIndex.gradientStops || [] } as any,
          animation: { offset: 0, stats: {} as any }
        };
        const rebuilt = ColorCycleAnimator.deserialize(serialized);
        // Replace existing animator for this layer
        this.animators.set(layerId, rebuilt);
        animator = rebuilt;
        hasLayerContent = hasLayerContent || anyNonZero;
      } catch (e) {
        console.warn('[ColorCycleBrush.applyLayerSnapshot] Failed to rebuild animator from snapshot:', e);
      }
    }

    strokeData.hasContent = hasLayerContent;
    strokeData.strokeCounter = snapshot.strokeCounter || 0;
    strokeData.strokeLength = 0;
    strokeData.lastPoint = null;
    strokeData.stampCounter = 0;
    this.layerStrokes.set(layerId, strokeData);
    // Mark layer dirty so next render updates
    this.dirtyLayers.add(layerId);

    // quiet
  }

  /**
   * Update gradient (async version for compatibility with tests)
   */
  async updateGradient(gradient: Array<{ position: number; color: string }>): Promise<void> {
    this.setGradient(gradient);
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
        animator.dispose();
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
    
    console.log('ColorCycleBrushCanvas2D disposed');
  }
}
