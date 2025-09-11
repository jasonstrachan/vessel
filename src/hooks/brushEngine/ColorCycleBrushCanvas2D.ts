/**
 * ColorCycleBrushCanvas2D - Canvas 2D implementation of color cycling
 * Replaces WebGL with efficient indexed color system using Canvas 2D
 * Maintains API compatibility with original ColorCycleBrush
 */

import { ColorCycleAnimator } from '../../lib/ColorCycleAnimator';
import { GradientStop } from '../../lib/GradientPalette';
import { applyPressureCurve } from '../../utils/pressureCurve';

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
      console.log(`[PERF] Creating animator for layer ${layerId}`);
      const startTime = performance.now();
      
      // PERFORMANCE FIX: Lazy initialization with smaller initial size
      const strokeData = this.layerStrokes.get(layerId);
      const useReducedSize = !strokeData?.hasContent;
      const initWidth = useReducedSize ? 256 : this.width;
      const initHeight = useReducedSize ? 256 : this.height;
      
      console.log(`[PERF] Canvas dimensions: ${initWidth}x${initHeight} (full: ${this.width}x${this.height})`);
      console.log(`[PERF] Estimated memory usage:`, {
        indexBuffer: (initWidth * initHeight) / 1024 / 1024 + ' MB',
        strokeOrder: (initWidth * initHeight * 2) / 1024 / 1024 + ' MB',
        imageData: (initWidth * initHeight * 4) / 1024 / 1024 + ' MB',
        total: ((initWidth * initHeight * 7) / 1024 / 1024) + ' MB'
      });
      
      // Measure ColorCycleAnimator creation
      console.time('ColorCycleAnimator constructor');
      const animator = new ColorCycleAnimator({
        width: initWidth,
        height: initHeight,
        fps: this.fps,
        speed: this.cycleSpeed,
        autoStart: false,
        lazyInit: true  // Add flag to defer heavy initialization
      });
      console.timeEnd('ColorCycleAnimator constructor');
      
      // Defer full initialization until first paint
      (animator as any)._deferredSize = { width: this.width, height: this.height };
      
      this.animators.set(layerId, animator);
      
      // Measure callback setup
      console.time('Callback setup');
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
      console.timeEnd('Callback setup');
      
      // Measure stroke data setup
      console.time('Stroke data setup');
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
      console.timeEnd('Stroke data setup');
      
      const totalTime = performance.now() - startTime;
      console.log(`[PERF] Total time for getAnimator: ${totalTime.toFixed(2)}ms`);
      
      if (totalTime > 1000) {
        console.error(`[PERF] CRITICAL: Animator creation took ${totalTime.toFixed(2)}ms!`);
      }
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
    
    // DEBUG: Log pressure and rotation values
    if (pressure !== 1.0 || rotation !== 0) {
      console.log(`[DEBUG] ColorCycleBrush paint: pressure=${pressure.toFixed(2)}, rotation=${rotation.toFixed(2)}, pressureEnabled=${this.pressureEnabled}`);
    }
    
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
      
      // Simple banding: cycle through a limited set of evenly-spaced colors
      // Each band gets an equal portion of the 255 color palette
      const colorsToUse = Math.min(254, bandsToUse); // Don't exceed palette size
      const colorStep = Math.max(1, Math.floor(254 / colorsToUse)); // Space between colors
      const bandIndex = strokeData.stampCounter % colorsToUse;
      
      // Calculate color index and ensure it's in valid range (0-254)
      const colorIndex = Math.min(254, (bandIndex * colorStep) % 255);
      
      // Calculate pressure-modulated brush size using smooth curve
      const pressureSize = this.pressureEnabled 
        ? Math.max(1, Math.round(this.brushSize * applyPressureCurve(
            pressure,
            this.minPressure,    // Already in percentage format (1-1000)
            this.maxPressure,    // Already in percentage format (1-1000)
            's-curve'            // Use smooth S-curve
          )))
        : this.brushSize;
      
      // Debug logging - more detailed
      if (this.pressureEnabled || pressure !== 1.0) {
        const multiplier = applyPressureCurve(pressure, this.minPressure, this.maxPressure, 's-curve');
        console.log(`[CC Paint Debug]`, {
          enabled: this.pressureEnabled,
          pressure: pressure.toFixed(3),
          minPressure: `${this.minPressure}%`,
          maxPressure: `${this.maxPressure}%`,
          curveMultiplier: multiplier.toFixed(3),
          baseSize: this.brushSize,
          calculatedSize: pressureSize,
          curveType: 's-curve'
        });
      }
      
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
    
    const totalTime = performance.now() - perfStart;
    if (totalTime > 10) {
      console.warn(`⚠️ [PERF] Paint took ${totalTime.toFixed(1)}ms at (${x},${y})`);
    }
  }
  
  /**
   * Set gradient (API compatible)
   */
  setGradient(stops: GradientStop[], layerId?: string) {
    const id = layerId || this.activeLayerId || 'default';
    const animator = this.getAnimator(id);
    
    // Update gradient
    animator.setGradient(stops);
    
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
      console.log('[ColorCycleBrush.clearPaintBuffer] Clearing paint buffer for layer:', id);
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

  /**
   * Start new stroke (API compatible)
   */
  startStroke(layerId?: string, clearBuffer: boolean = false) {
    const id = layerId || this.activeLayerId || 'default';
    console.log('[ColorCycleBrush.startStroke] Called for layer:', id, 'clearBuffer:', clearBuffer);
    console.log('[ColorCycleBrush.startStroke] Previous paint buffer exists?', !!this.layerStrokes.get(id)?.paintBuffer);

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
        console.log('[DEBUG] Animator canvas has existing pixels (sampled):', hasPixels);
        if (hasPixels && clearBuffer) {
          console.log('[DEBUG] Clearing animator due to clearBuffer=true');
          try { animator.clear(); } catch {}
        }
      }
    } catch {}
    animator.startStroke();
    
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      if (clearBuffer) {
        console.log('[ColorCycleBrush.startStroke] Clearing paint buffer for new shape');
        strokeData.paintBuffer.fill(0);
        strokeData.hasContent = false;
        strokeData.strokeCounter = 0;
        strokeData.stampCounter = 0; // Reset stamp counter for new shape
      } else {
        console.log('[ColorCycleBrush.startStroke] Updating stroke data - NOT clearing paint buffer');
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
    
    // Scanline fill with linear gradient
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
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
        
        for (let x = startX; x <= endX; x++) {
          // Project this pixel onto the direction vector
          const dx = x - centerX;
          const dy = y - centerY;
          const projection = dx * dirX + dy * dirY;
          
          // Normalize projection to 0-1 range
          const normalizedProjection = (projection - minProjection) / projectionRange;
          
          // Quantize into color bands
          const bandIndex = Math.min(numBands - 1, Math.floor(normalizedProjection * numBands));
          
          // Map to color index
          const colorStep = Math.floor(254 / numBands);
          const baseOffset = this.stampCounter % 254;
          const colorIndex = ((baseOffset + bandIndex * colorStep) % 254) + 1;
          
          // Paint pixel
          animator.paintSquare(x, y, 1, colorIndex);
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
    
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
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
        
        for (let x = startX; x <= endX; x++) {
          // Calculate distance to nearest edge for gradient
          let minDist = Infinity;
          
          // Distance to left and right boundaries of this span
          const distToLeft = x - startX;
          const distToRight = endX - x;
          minDist = Math.min(distToLeft, distToRight);
          
          // Also check distance to polygon edges for better gradient
          for (let j = 0; j < vertices.length; j++) {
            const v1 = vertices[j];
            const v2 = vertices[(j + 1) % vertices.length];
            
            const dx = v2.x - v1.x;
            const dy = v2.y - v1.y;
            const len2 = dx * dx + dy * dy;
            
            if (len2 > 0) {
              const t = Math.max(0, Math.min(1, 
                ((x - v1.x) * dx + (y - v1.y) * dy) / len2));
              const projX = v1.x + t * dx;
              const projY = v1.y + t * dy;
              const dist = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);
              minDist = Math.min(minDist, dist);
            }
          }
          
          // Color banding for shapes - quantize gradient into bands
          // Calculate shape size from bounds
          const shapeWidth = maxX - minX;
          const shapeHeight = maxY - minY;
          const shapeSize = Math.max(shapeWidth, shapeHeight);
          // Calculate smooth gradient position (0-1)
          const maxDist = Math.max(50, shapeSize / 2); // Expected max distance
          const normalizedDist = Math.min(1, minDist / maxDist);
          
          // Quantize into color bands
          const numBands = this.gradientBands || 12;
          const bandStep = 1.0 / numBands;
          const bandIndex = Math.min(numBands - 1, Math.floor(normalizedDist / bandStep));
          
          // Map to color index with continuation from previous shapes
          const colorStep = Math.floor(254 / numBands);
          const baseOffset = this.stampCounter % 254; // Continue from last shape
          const colorIndex = ((baseOffset + bandIndex * colorStep) % 254) + 1;
          
          // Paint with size 1 for precise pixel control
          animator.paintSquare(x, y, 1, colorIndex);
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
    
    const animator = this.animators.get(layerId);
    if (animator) {
      const strokeData = this.layerStrokes.get(layerId);
      // Only render if there's actual content to render
      if (strokeData?.hasContent) {
        const ctx = targetCanvas.getContext('2d');
        if (ctx) {
          // Force a render update before drawing
          animator.forceRender();
          animator.drawTo(ctx);
          try { const { debugLog } = require('../../utils/debug'); debugLog('cc-render', { event: 'renderDirectToCanvas', layerId: layerId?.substring(0, 20), stamps: strokeData.stampCounter, strokeCounter: strokeData.strokeCounter }); } catch {}
        } else {
          console.warn('Failed to get 2D context from target canvas');
        }
      } else {
        // IMPORTANT: Do NOT clear the canvas here.
        // When undo/redo restores pixel data directly to the layer canvas,
        // calling renderDirectToCanvas without stroke content should leave
        // the existing pixels intact.
        try { const { debugLog } = require('../../utils/debug'); debugLog('cc-render', { event: 'render-skip-no-content', layerId: layerId?.substring(0, 20) }); } catch {}
      }
    } else {
      console.warn(`No animator found for layer: ${layerId}`);
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

    const animator = this.animators.get(layerId);
    if (!animator) {
      console.warn(`[ColorCycleBrush.commitToLayer] No animator for layer: ${layerId}`);
      return;
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

    const ctx = targetCanvas.getContext('2d');
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
      try { const { debugLog } = require('../../utils/debug'); debugLog('cc-commit', { event: 'same-canvas-skip-draw', layerId: layerId?.substring(0, 20) }); } catch {}
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

      // Optional debug sampling to verify alpha > 0
      try {
        const sample = ctx.getImageData(0, 0, Math.min(10, targetCanvas.width), Math.min(10, targetCanvas.height)).data;
        let hasAlpha = false;
        for (let i = 3; i < sample.length; i += 4) { if (sample[i] > 0) { hasAlpha = true; break; } }
        try { const { debugLog } = require('../../utils/debug'); debugLog('cc-commit', { event: 'committed', layerId: layerId?.substring(0, 20), hasAlpha, srcHasContent, hadStrokeContent: !!strokeData?.hasContent }); } catch {}
      } catch {}
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
    if (!Number.isFinite(bands) || bands < 2 || bands > 50) {
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
    // Debug (opt-in)
    try { const { debugLog } = require('../../utils/debug'); debugLog('cc-settings', 'setPressureEnabled', enabled); } catch {}
    this.pressureEnabled = enabled;
  }
  
  /**
   * Set min pressure (size percentage)
   */
  setMinPressure(min: number) {
    this.minPressure = Math.max(1, Math.min(1000, min));
    try { const { debugLog } = require('../../utils/debug'); debugLog('cc-settings', 'setMinPressure', this.minPressure); } catch {}
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
    try { const { debugLog } = require('../../utils/debug'); debugLog('cc-settings', 'setMaxPressure', this.maxPressure); } catch {}
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
    console.log(`🏷️ [ColorCycle] Set layer ID: ${layerId.substring(0, 8)}...`);
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

    // DEBUG (opt-in): Log snapshot application summary
    try {
      let nonZero = 0;
      const sample = 512;
      for (let i = 0; i < Math.min(sample, strokeData.paintBuffer.length); i++) {
        if (strokeData.paintBuffer[i] !== 0) nonZero++;
      }
      try { const { debugLog } = require('../../utils/debug'); debugLog('cc-undo', { event: 'applyLayerSnapshot', layerId: layerId?.substring(0, 20), bufferBytes: buffer?.byteLength || 0, expectedSize, hasContent: strokeData.hasContent, nonZeroInFirst512: nonZero, strokeCounter: strokeData.strokeCounter }); } catch {}
    } catch {}
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
