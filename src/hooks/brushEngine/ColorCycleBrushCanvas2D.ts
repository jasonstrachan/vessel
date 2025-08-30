/**
 * ColorCycleBrushCanvas2D - Canvas 2D implementation of color cycling
 * Replaces WebGL with efficient indexed color system using Canvas 2D
 * Maintains API compatibility with original ColorCycleBrush
 */

import { ColorCycleAnimator } from '../../lib/ColorCycleAnimator';
import { GradientStop } from '../../lib/GradientPalette';

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
  private resetStampOnNewStroke: boolean = false; // Set to true to reset colors per stroke
  
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
    this.cycleSpeed = 0.4;
    this.fps = options.fps || 30;
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
  paint(x: number, y: number, layerId?: string) {
    const perfStart = performance.now();
    
    // Validate coordinates
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      console.warn(`Invalid paint coordinates: x=${x}, y=${y}`);
      return;
    }
    
    const id = layerId || this.activeLayerId || 'default';
    
    // Track stroke data and mark as having content BEFORE getting animator
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      // Mark as having content before getting animator so resize happens if needed
      if (!strokeData.hasContent) {
        strokeData.hasContent = true;
        // Allocate full-size paint buffer on first paint
        if (strokeData.paintBuffer.length === 0) {
          strokeData.paintBuffer = new Uint8Array(this.width * this.height);
        }
      }
    }
    
    const animator = this.getAnimator(id);
    
    if (strokeData) {
      // Calculate color index based on stamp position in gradient
      // Each stamp gets the next color in the gradient sequence
      // Map stamp counter to gradient bands for quantized color steps
      const bandIndex = strokeData.stampCounter % this.gradientBands;
      // Ensure colorIndex cycles through 1-255, never 0 (which might be transparent/white)
      const colorIndex = Math.floor((bandIndex / this.gradientBands) * 254) + 1;
      
      // Paint with specific color index (0-255 representing gradient positions)
      animator.paintSquare(x, y, this.brushSize, colorIndex);
      
      // Update tracking
      strokeData.strokeLength++;
      strokeData.lastPoint = { x, y };
      strokeData.stampCounter++;
    } else {
      // Fallback if no stroke data
      animator.paintSquare(x, y, this.brushSize);
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
   * Set whether to reset stamp counter on new strokes
   */
  setResetStampOnNewStroke(reset: boolean) {
    this.resetStampOnNewStroke = reset;
  }
  
  /**
   * Start new stroke (API compatible)
   */
  startStroke(layerId?: string) {
    const id = layerId || this.activeLayerId || 'default';
    this.activeLayerId = id;
    this.isDrawing = true;
    this.strokeCounter++;
    this.strokeLength = 0;
    this.lastPoint = null;
    
    
    const animator = this.getAnimator(id);
    animator.startStroke();
    
    const strokeData = this.layerStrokes.get(id);
    if (strokeData) {
      strokeData.strokeCounter = this.strokeCounter;
      strokeData.strokeLength = 0;
      strokeData.lastPoint = null;
      
      // Only reset stamp counter if configured to do so
      // For continuous color progression across strokes, keep it accumulating
      if (this.resetStampOnNewStroke) {
        strokeData.stampCounter = 0;
      } else {
      }
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
   * Fill shape with smooth gradient bands from edge to center
   */
  fillShape(vertices: Array<{ x: number; y: number }>, layerId?: string) {
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
    // Get number of bands from settings or use default
    const numBands = this.gradientBands;
    
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
          
          // Create gradient based on distance
          const maxDist = Math.max(maxX - minX, maxY - minY) / 2;
          const normalizedDist = Math.min(1, minDist / maxDist);
          
          const bandIndex = Math.floor(normalizedDist * numBands);
          const colorIndex = Math.floor((bandIndex / Math.max(1, numBands - 1)) * 255);
          
          // Paint with size 1 for precise pixel control
          animator.paintSquare(x, y, 1, colorIndex);
        }
      }
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
    // Clear composite canvas
    this.compositeCtx.clearRect(0, 0, this.width, this.height);
    
    // Composite all layers
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
      webglCtx.clearRect(0, 0, this.width, this.height);
      webglCtx.globalAlpha = forceFullOpacity ? 1.0 : 0.8;
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
        } else {
          console.warn('Failed to get 2D context from target canvas');
        }
      } else {
        // Clear the canvas if there's no content
        const ctx = targetCanvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        }
      }
    } else {
      console.warn(`No animator found for layer: ${layerId}`);
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
    if (this.isAnimating) {
      this.pause();
    } else {
      this.startAnimation();
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
   * Set gradient bands (number of color steps)
   */
  setGradientBands(bands: number) {
    if (!Number.isFinite(bands) || bands < 2 || bands > 50) {
      console.warn(`Invalid gradient bands: ${bands}, using default`);
      return;
    }
    this.gradientBands = Math.floor(bands);
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
    playing ? this.startAnimation() : this.stopAnimation();
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
    // Check if we have valid layer data for the active layer
    if (this.activeLayerId) {
      const layerData = this.layerStrokes.get(this.activeLayerId);
      return layerData !== undefined && layerData.paintBuffer !== undefined;
    }
    return true; // No active layer is also valid
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
    // Clear current state
    this.animators.clear();
    this.layerStrokes.clear();
    
    // Restore settings
    this.cycleSpeed = state.cycleSpeed || 0.4;
    this.fps = state.fps || 30;
    this.brushSize = state.brushSize || 20;
    
    // Restore layers
    if (state.layers) {
      state.layers.forEach((layer: any) => {
        this.layerStrokes.set(layer.layerId, {
          paintBuffer: new Uint8Array(this.width * this.height),
          hasContent: layer.strokeData.hasContent,
          strokeCounter: layer.strokeData.strokeCounter,
          strokeLength: 0,
          lastPoint: null,
          gradientLayerIndices: [],
          currentGradientIndex: 0,
          stampCounter: 0
        });
      });
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
            strokeCounter: strokeData.strokeCounter
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
        // Would need to implement ColorCycleAnimator deserialization
        // For now, just track that the layer exists
        instance.layerStrokes.set(layer.layerId, {
          paintBuffer: new Uint8Array(instance.width * instance.height),
          hasContent: layer.strokeData.hasContent,
          strokeCounter: layer.strokeData.strokeCounter,
          strokeLength: 0,
          lastPoint: null,
          gradientLayerIndices: [],
          currentGradientIndex: 0,
          stampCounter: 0
        });
      });
    }
    
    return instance;
  }
}