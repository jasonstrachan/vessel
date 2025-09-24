/**
 * ColorCycleAnimator - Integrates AnimationController with color cycling
 * Provides a complete animated drawing system with indexed colors
 */

import { IndexBuffer } from './IndexBuffer';
import { debugWarn } from '../utils/debug';
// Debug logs suppressed for color cycle GPU path
import { GradientPalette, GradientStop } from './GradientPalette';
import { AnimationController } from './AnimationController';
import { WebGLColorCycleRenderer } from './colorCycle/rendering/WebGLColorCycleRenderer';
import { canvasPool } from '../utils/canvasPool';

export interface ColorCycleAnimatorConfig {
  width: number;
  height: number;
  gradientStops?: GradientStop[];
  fps?: number;
  speed?: number;
  autoStart?: boolean;
  lazyInit?: boolean; // Support deferred heavy initialization
  forceCanvas2D?: boolean; // Force CPU rendering even if WebGL is available
}

export class ColorCycleAnimator {
  private indexBuffer: IndexBuffer;
  private gradientPalette: GradientPalette;
  private animationController: AnimationController;
  
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData | null;
  // GPU renderer (optional)
  private glRenderer: WebGLColorCycleRenderer | null = null;
  private glCanvas: HTMLCanvasElement | null = null;
  // One-time render path log guard
  private _renderPathLogged: boolean = false;
  // Palette upload guard for GPU renderer
  private _glPaletteReady: boolean = false;
  // One-time sample log guard
  private _renderSampledOnce: boolean = false;
  // Track when index buffer changed to avoid re-uploading every frame
  private _glIndexDirty: boolean = true;
  // Rendering mode flag
  private forceCanvas2D: boolean = false;
  
  // Stroke tracking for directional flow
  private strokeOrder: Uint16Array; // Store order each pixel was painted (0 = not painted)
  private currentStrokeIndex: number = 1;
  private maxStrokeIndex: number = 0;
  private flowDirection: 'forward' | 'backward' = 'backward'; // Flow direction toggle (default: backward)
  
  // Callbacks
  private onFrameCallbacks: Set<(imageData: ImageData) => void> = new Set();
  
  // Performance optimization: cache palette as 32-bit values
  private cachedPalette32: Uint32Array | null = null;
  
  constructor(config: ColorCycleAnimatorConfig) {
    this.forceCanvas2D = Boolean(config.forceCanvas2D);

    // If lazy init, defer heavy initialization
    if (config.lazyInit) {
      // Create minimal buffers first
      this.indexBuffer = new IndexBuffer(config.width, config.height);
      this.gradientPalette = config.gradientStops 
        ? new GradientPalette(config.gradientStops)
        : GradientPalette.createRainbow();
      // Use canvas pool for better performance
      this.canvas = canvasPool.acquire(config.width, config.height);
      const ctx = this.canvas.getContext('2d', {
        willReadFrequently: false, // Changed to false for lazy init
        alpha: true
      });
      
      if (!ctx) {
        throw new Error('Failed to create canvas context');
      }
      
      this.ctx = ctx;
      this.ctx.imageSmoothingEnabled = false;
      
      // Defer image data creation until first use
      this.imageData = null; // Will be created on first paint
      
      // Try to prepare GPU renderer lazily
      if (!this.forceCanvas2D && typeof window !== 'undefined' && WebGLColorCycleRenderer.isSupported()) {
        try {
          this.glRenderer = new WebGLColorCycleRenderer({ width: config.width, height: config.height });
          this.glCanvas = this.glRenderer.getCanvas();
          // quiet
          this._glPaletteReady = false;
        } catch {}
      } else {
        // quiet
      }
      
      // Use smaller stroke order buffer initially
      this.strokeOrder = new Uint16Array(0); // Start empty
      
      // Initialize animation controller with lazy settings
      this.animationController = new AnimationController({
        fps: config.fps || 30,
        speed: config.speed || 0.1,
        autoStart: false, // Never auto-start in lazy mode
        onFrame: this.handleAnimationFrame.bind(this)
      });
      
      // Defer palette update
      requestAnimationFrame(() => this.updateIndexBufferPalette());
    } else {
      // Normal initialization path
      this.indexBuffer = new IndexBuffer(config.width, config.height);
      this.gradientPalette = config.gradientStops 
        ? new GradientPalette(config.gradientStops)
        : GradientPalette.createRainbow();
      
      // Use canvas pool for better performance
      this.canvas = canvasPool.acquire(config.width, config.height);
      
      const ctx = this.canvas.getContext('2d', {
        willReadFrequently: true,
        alpha: true
      });
      
      if (!ctx) {
        throw new Error('Failed to create canvas context');
      }
      
      this.ctx = ctx;
      this.ctx.imageSmoothingEnabled = false;
      this.imageData = ctx.createImageData(config.width, config.height);
      
      // Initialize GPU renderer if possible
      if (!this.forceCanvas2D && typeof window !== 'undefined' && WebGLColorCycleRenderer.isSupported()) {
        try {
          this.glRenderer = new WebGLColorCycleRenderer({ width: config.width, height: config.height });
          this.glCanvas = this.glRenderer.getCanvas();
          // quiet
          this._glPaletteReady = false;
        } catch {}
      } else {
        // quiet
      }
      
      // Initialize stroke order buffer
      this.strokeOrder = new Uint16Array(config.width * config.height);
      
      // Initialize animation controller
      this.animationController = new AnimationController({
        fps: config.fps || 30,
        speed: config.speed || 0.1,
        autoStart: config.autoStart || false,
        onFrame: this.handleAnimationFrame.bind(this)
      });
      
      // Update IndexBuffer palette
      this.updateIndexBufferPalette();
    }
  }
  
  /**
   * Handle animation frame
   */
  private handleAnimationFrame() {
    // Get current animation offset
    const offset = this.animationController.getOffset();
    
    // Render frame with offset
    this.renderFrame(offset);
    
    // Notify all callbacks
    if (!this.imageData) {
      this.imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    }
    const frameImageData = this.imageData;
    this.onFrameCallbacks.forEach(callback => {
      callback(frameImageData);
    });
  }
  
  /**
   * Update IndexBuffer palette from gradient
   */
  private updateIndexBufferPalette() {
    const paletteStrings = this.gradientPalette.getPaletteStrings();
    this.indexBuffer.setPalette(paletteStrings);
    // Invalidate cached palette when gradient changes
    this.cachedPalette32 = null;
    // If GPU renderer exists, upload palette once (as base palette)
    if (!this.forceCanvas2D && this.glRenderer) {
      try {
        const paletteRGBA = this.gradientPalette.getPaletteColors();
        this.glRenderer.setPaletteColors(paletteRGBA);
        this._glPaletteReady = true;
      } catch {}
    } else {
      this._glPaletteReady = false;
    }
  }

  /**
   * Whether GPU renderer is available
   */
  hasWebGL(): boolean {
    return !this.forceCanvas2D && !!this.glRenderer;
  }

  setForceCanvas2D(force: boolean) {
    if (this.forceCanvas2D === force) {
      return;
    }

    this.forceCanvas2D = force;

    if (force) {
      if (this.glRenderer) {
        try {
          this.glRenderer.dispose();
        } catch {}
      }
      this.glRenderer = null;
      this.glCanvas = null;
      this._glPaletteReady = false;
      this._glIndexDirty = true;
      this._renderSampledOnce = false;
    } else if (!this.glRenderer && typeof window !== 'undefined' && WebGLColorCycleRenderer.isSupported()) {
      try {
        this.glRenderer = new WebGLColorCycleRenderer({ width: this.canvas.width, height: this.canvas.height });
        this.glCanvas = this.glRenderer.getCanvas();
        this._glPaletteReady = false;
        this._glIndexDirty = true;
        this._renderSampledOnce = false;
      } catch {
        // Failed to initialize WebGL; fall back to Canvas2D
        this.forceCanvas2D = true;
        this.glRenderer = null;
        this.glCanvas = null;
        this._renderSampledOnce = false;
      }
    }

    // Force a redraw so consumers see the updated rendering mode
    try {
      this.forceRender();
    } catch {}
  }

  /**
   * GPU concentric fill: renders polygon bands on the GPU into an offscreen buffer,
   * reads back indices for the bbox, and writes into our index buffer.
   * Falls back to no-op if GPU is not available.
   */
  gpuFillShapeConcentric(
    vertices: Array<{ x: number; y: number }>,
    bands: number,
    baseOffset: number,
    colorStep: number,
    maxDist: number,
    bbox: { minX: number; minY: number; width: number; height: number }
  ): boolean {
    if (this.forceCanvas2D || !this.glRenderer || vertices.length < 3) {
      return false;
    }
    try {
      // quiet
      const flat = new Float32Array(vertices.length * 2);
      for (let i = 0; i < vertices.length; i++) {
        flat[i * 2] = vertices[i].x;
        flat[i * 2 + 1] = vertices[i].y;
      }

      const result = this.glRenderer.fillPolygonConcentric({
        vertices: flat,
        bands,
        baseOffset,
        colorStep,
        maxDist,
        bbox,
        canvasHeight: this.canvas.height,
      });

      if (!result) return false;

      const data = this.indexBuffer.getDirectData();
      const width = this.canvas.width;
      const { minX, minY, width: bw, height: bh } = bbox;

      // Blit rows into the index buffer
      // WebGL readPixels returns rows bottom-to-top; flip vertically to top-left origin
      for (let y = 0; y < bh; y++) {
        const srcStart = y * bw;
        const destY = minY + (bh - 1 - y);
        const destStart = destY * width + minX;
        data.set(result.subarray(srcStart, srcStart + bw), destStart);
      }

      // Mark index as dirty for GPU texture upload and force a render
      this._glIndexDirty = true;
      // Force a render to show the update
      this.forceRender();
      // Determine if any indices are non-zero to confirm visible output
      let hasContent = false;
      for (let i = 0; i < result.length; i++) { if (result[i] !== 0) { hasContent = true; break; } }
      return hasContent;
    } catch {
      // quiet
      return false;
    }
  }

  /** Return runtime GPU vertex limit for fill shader (if available) */
  getGLFillMaxVerts(): number | null {
    if (this.forceCanvas2D) {
      return null;
    }
    try { return this.glRenderer?.getFillMaxVerts?.() ?? null; } catch { return null; }
  }
  
  /**
   * Render a single frame with directional flow
   */
  private renderFrame(offset: number = 0) {
    try {
      // GPU path if available
      if (!this.forceCanvas2D && this.glRenderer && this.glCanvas) {
        // Ensure palette is available on GPU (lazy init can defer initial upload)
        if (!this._glPaletteReady) {
          try {
            const paletteRGBA = this.gradientPalette.getPaletteColors();
            this.glRenderer.setPaletteColors(paletteRGBA);
            this._glPaletteReady = true;
            // quiet
          } catch {}
        }
        if (!this._renderPathLogged) { this._renderPathLogged = true; }
        // Upload index data and render with offset
        const indexData = this.indexBuffer.getDirectData();
        if (!indexData) return;

        // Compute forward/backward offset in [0,1)
        const dir = this.flowDirection === 'backward' ? -1 : 1;
        let o = offset * dir;
        o = ((o % 1) + 1) % 1;

        // Upload index texture only when data changed
        if (this._glIndexDirty) {
          this.glRenderer.setIndexData(indexData);
          this._glIndexDirty = false;
        }
        this.glRenderer.render(o);

        // Optional one-time sample to verify visible output by drawing into the 2D canvas
        if (!this._renderSampledOnce) {
          try {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.drawImage(this.glCanvas, 0, 0);
            const w = Math.min(4, this.canvas.width);
            const h = Math.min(4, this.canvas.height);
            this.ctx.getImageData(0, 0, w, h);
            // quiet
          } catch {}
          this._renderSampledOnce = true;
        }

        // Keep an ImageData placeholder allocated to satisfy callbacks consumers
        if (!this.imageData) {
          this.imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
        }
        return;
      }

      // Fallback CPU path (unchanged behavior)
      if (!this._renderPathLogged) { this._renderPathLogged = true; }
      // Ensure imageData is created (for lazy init)
      if (!this.imageData) {
        this.imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
      }
      const indexData = this.indexBuffer.getDirectData();
      if (!indexData) return;

      const pixels = this.imageData.data;
      const pixels32 = new Uint32Array(pixels.buffer);

      if (!this.cachedPalette32) {
        this.cachedPalette32 = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          const color = this.gradientPalette.getColor(i);
          this.cachedPalette32[i] = (color.a << 24) | (color.b << 16) | (color.g << 8) | color.r;
        }
      }
      const palette32 = this.cachedPalette32;

      const animOffset = Math.floor(Math.abs(offset) * 256);
      const backward = this.flowDirection === 'backward';
      const mapPaletteIndex = (idx: number): number => {
        if (idx <= 0) return -1;
        if (idx >= 255) return 255;
        return idx - 1;
      };

      if (animOffset > 0) {
        if (backward) {
          for (let i = 0; i < indexData.length; i++) {
            const colorIndex = indexData[i];
            if (colorIndex === 0) {
              pixels32[i] = 0;
              continue;
            }
            const paletteIndex = mapPaletteIndex(colorIndex);
            const shifted = (paletteIndex - animOffset + 256 * 100) % 256;
            pixels32[i] = palette32[shifted];
          }
        } else {
          for (let i = 0; i < indexData.length; i++) {
            const colorIndex = indexData[i];
            if (colorIndex === 0) {
              pixels32[i] = 0;
              continue;
            }
            const paletteIndex = mapPaletteIndex(colorIndex);
            const shifted = (paletteIndex + animOffset) % 256;
            pixels32[i] = palette32[shifted];
          }
        }
      } else {
        for (let i = 0; i < indexData.length; i++) {
          const colorIndex = indexData[i];
          if (colorIndex === 0) {
            pixels32[i] = 0;
            continue;
          }
          const paletteIndex = mapPaletteIndex(colorIndex);
          pixels32[i] = palette32[paletteIndex];
        }
      }

      this.ctx.putImageData(this.imageData, 0, 0);

    } catch (error) {
      debugWarn('cc-render', '[ColorCycleAnimator] Error in renderFrame:', error);
      debugWarn('cc-render', '[ColorCycleAnimator] Stack:', (error as Error).stack);
    }
  }
  
  /**
   * Paint with brush
   */
  paint(x: number, y: number, brushSize: number, colorIndex?: number) {
    // Use provided index or auto-increment
    const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
    
    // Get color from palette
    const color = this.gradientPalette.getColorString(index);
    
    // Paint to index buffer
    this.indexBuffer.paint(x, y, brushSize, color);
    
    // If not animating, render immediately
    if (!this.animationController.isPlaying()) {
      this.renderFrame();
    }
  }

  /**
   * Fast path: set raw color index at pixel (no palette lookup, no render)
   * Preserves isDirty flag on the underlying buffer so a later render draws it.
   */
  setIndex(x: number, y: number, colorIndex: number) {
    try {
      this.indexBuffer.setPixel(x, y, colorIndex);
      this._glIndexDirty = true;
    } catch {
      // Fail silently for out-of-bounds or transient states
    }
  }
  
  /**
   * Paint square brush with stamp-based color progression
   */
  paintSquare(x: number, y: number, brushSize: number, colorIndex?: number) {
    try {
      // Use provided color index or auto-increment
      const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
      
      const color = this.gradientPalette.getColorString(index);
      
      // Paint to index buffer with the specific color index - NO RENDERING
      this.indexBuffer.paintSquare(x, y, brushSize, color);
      this._glIndexDirty = true;
      
      // REMOVED per-stamp rendering - caller handles batched rendering
      
    } catch (error) {
      console.error('[ColorCycleAnimator] Error in paintSquare:', error);
    }
  }
  
  /**
   * Paint line
   */
  paintLine(x0: number, y0: number, x1: number, y1: number, brushSize: number, colorIndex?: number) {
    const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
    const color = this.gradientPalette.getColorString(index);
    
    this.indexBuffer.paintLine(x0, y0, x1, y1, brushSize, color);
    this._glIndexDirty = true;
    
    // REMOVED per-stamp rendering - caller handles batched rendering
  }
  
  /**
   * Fill area
   */
  fill(x: number, y: number, colorIndex?: number) {
    const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
    const color = this.gradientPalette.getColorString(index);
    
    this.indexBuffer.fill(x, y, color);
    this._glIndexDirty = true;
    
    if (!this.animationController.isPlaying()) {
      this.renderFrame();
    }
  }
  
  /**
   * Get next color index for gradient progression
   */
  private nextIndex: number = 1;
  private getNextColorIndex(): number {
    const index = this.nextIndex;
    this.nextIndex = (this.nextIndex % 255) + 1;
    return index;
  }
  
  /**
   * Start new stroke
   */
  startStroke() {
    // Don't reset stroke index, let it accumulate for proper flow
  }
  
  /**
   * End stroke
   */
  endStroke() {
    // Stroke index continues to accumulate
  }
  
  /**
   * Force render the current frame (used for immediate updates)
   */
  forceRender() {
    this.renderFrame(this.animationController.getOffset());
  }
  
  /**
   * Clear canvas
   */
  clear() {
    this.indexBuffer.clear();
    this._glIndexDirty = true;
    this.nextIndex = 1;
    this.currentStrokeIndex = 1;
    this.maxStrokeIndex = 0;
    // Clear stroke order buffer
    this.strokeOrder.fill(0);
    this.renderFrame();
  }
  
  /**
   * Clear rectangle
   */
  clearRect(x: number, y: number, width: number, height: number) {
    this.indexBuffer.clearRect(x, y, width, height);
    this._glIndexDirty = true;
    
    if (!this.animationController.isPlaying()) {
      this.renderFrame();
    }
  }
  
  /**
   * Update gradient
   */
  setGradient(stops: GradientStop[]) {
    this.gradientPalette.updateFromGradient(stops);
    this.updateIndexBufferPalette();
    this.renderFrame(this.animationController.getOffset());
  }
  
  /**
   * Use preset gradient
   */
  setPresetGradient(preset: 'rainbow' | 'fire' | 'ocean' | 'sunset' | 'grayscale') {
    let palette: GradientPalette;
    
    switch (preset) {
      case 'rainbow':
        palette = GradientPalette.createRainbow();
        break;
      case 'fire':
        palette = GradientPalette.createFire();
        break;
      case 'ocean':
        palette = GradientPalette.createOcean();
        break;
      case 'sunset':
        palette = GradientPalette.createSunset();
        break;
      case 'grayscale':
      default:
        palette = GradientPalette.createGrayscale();
        break;
    }
    
    this.gradientPalette = palette;
    this.updateIndexBufferPalette();
    this.renderFrame(this.animationController.getOffset());
  }
  
  /**
   * Animation controls
   */
  start() {
    this.animationController.start();
  }
  
  stop() {
    this.animationController.stop();
  }
  
  pause() {
    this.animationController.pause();
  }
  
  resume() {
    this.animationController.resume();
  }
  
  toggle() {
    this.animationController.toggle();
  }
  
  reset() {
    this.animationController.reset();
    this.renderFrame();
  }
  
  /**
   * Manually update animation frame
   * Used when animation is driven externally
   */
  updateFrame() {
    // Calculate delta time based on target FPS when driven externally
    // Use controller stats to avoid hardcoding 30fps
    const stats = this.animationController.getStats();
    const fps = Math.max(1, stats.targetFPS || 30);
    const deltaTime = 1 / fps;
    
    // Update animation offset manually
    const currentOffset = this.animationController.getOffset();
    const speed = this.animationController.getSpeed();
    const newOffset = (currentOffset + deltaTime * speed) % 1;
    this.animationController.setOffset(newOffset);
    
    // Trigger frame render
    this.handleAnimationFrame();
  }

  /**
   * Set absolute animation phase [0,1) and render immediately
   * Useful for deterministic exports (perfect loops)
   */
  setPhase(phase: number) {
    const p = ((phase % 1) + 1) % 1;
    this.animationController.setOffset(p);
    this.renderFrame(p);
  }
  
  /**
   * Set animation speed
   */
  setSpeed(speed: number) {
    this.animationController.setSpeed(speed);
  }
  
  /**
   * Set FPS
   */
  setFPS(fps: number) {
    this.animationController.setFPS(fps);
  }
  
  /**
   * Get animation stats
   */
  getStats() {
    return this.animationController.getStats();
  }
  
  /**
   * Is animating?
   */
  isAnimating(): boolean {
    return this.animationController.isPlaying();
  }
  
  /**
   * Add frame callback
   */
  onFrame(callback: (imageData: ImageData) => void) {
    this.onFrameCallbacks.add(callback);
  }
  
  /**
   * Remove frame callback
   */
  offFrame(callback: (imageData: ImageData) => void) {
    this.onFrameCallbacks.delete(callback);
  }
  
  /**
   * Get canvas
   */
  getCanvas(): HTMLCanvasElement {
    return this.glCanvas || this.canvas;
  }
  
  /**
   * Get current image data
   */
  getImageData(): ImageData {
    if (!this.imageData) {
      this.imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    }
    return this.imageData;
  }
  
  /**
   * Draw to another context
   */
  drawTo(ctx: CanvasRenderingContext2D, x: number = 0, y: number = 0) {
    const src = this.glCanvas || this.canvas;
    ctx.drawImage(src, x, y);
  }
  
  /**
   * Resize
   */
  resize(width: number, height: number) {
    // Skip if dimensions haven't changed
    if (this.canvas.width === width && this.canvas.height === height) {
      return;
    }
    
    // Preserve existing data if possible
    const oldWidth = this.canvas.width;
    const oldHeight = this.canvas.height;
    const needsDataPreservation = oldWidth > 0 && oldHeight > 0 && this.imageData;
    
    // Save current image data if needed
    let savedImageData: ImageData | null = null;
    if (needsDataPreservation && this.imageData) {
      savedImageData = this.ctx.getImageData(0, 0, Math.min(oldWidth, width), Math.min(oldHeight, height));
    }
    
    // Resize index buffer
    this.indexBuffer.resize(width, height);
    this._glIndexDirty = true;
    
    // Get a new canvas from pool with proper dimensions
    const oldCanvas = this.canvas;
    this.canvas = canvasPool.acquire(width, height);
    
    // Get new context
    const ctx = this.canvas.getContext('2d', {
      willReadFrequently: !!(this.imageData), // Only if we were already using image data
      alpha: true
    });
    
    if (!ctx) {
      throw new Error('Failed to get context after resize');
    }
    
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    
    // Create new image data
    this.imageData = this.ctx.createImageData(width, height);

    // Resize GPU renderer
    if (!this.forceCanvas2D && this.glRenderer) {
      try {
        this.glRenderer.resize(width, height);
        this.glCanvas = this.glRenderer.getCanvas();
      } catch {}
    }
    
    // Resize stroke order buffer only if dimensions actually changed
    if (width * height !== this.strokeOrder.length) {
      this.strokeOrder = new Uint16Array(width * height);
      // Don't reset indices if we're just resizing
      if (!needsDataPreservation) {
        this.currentStrokeIndex = 1;
        this.maxStrokeIndex = 0;
      }
    }
    
    // Restore saved data if available
    if (savedImageData) {
      this.ctx.putImageData(savedImageData, 0, 0);
    }
    
    // Return old canvas to pool
    canvasPool.release(oldCanvas);
    
    this.renderFrame();
  }
  
  /**
   * Set flow direction
   */
  setFlowDirection(direction: 'forward' | 'backward') {
    this.flowDirection = direction;
    // Always re-render to show the change immediately
    this.forceRender();
  }
  
  /**
   * Get flow direction
   */
  getFlowDirection(): 'forward' | 'backward' {
    return this.flowDirection;
  }
  
  /**
   * Toggle flow direction
   */
  toggleFlowDirection() {
    this.flowDirection = this.flowDirection === 'forward' ? 'backward' : 'forward';
    if (!this.animationController.isPlaying()) {
      this.forceRender();
    }
  }
  
  /**
   * Get dimensions
   */
  getDimensions(): { width: number; height: number } {
    return this.indexBuffer.getDimensions();
  }
  
  /**
   * Serialize state
   */
  serialize() {
    return {
      indexBuffer: this.indexBuffer.serialize(),
      gradient: this.gradientPalette.serialize(),
      animation: {
        offset: this.animationController.getOffset(),
        stats: this.animationController.getStats()
      }
    };
  }
  
  /**
   * Deserialize state
   */
  static deserialize(data: ReturnType<ColorCycleAnimator['serialize']>): ColorCycleAnimator {
    const animator = new ColorCycleAnimator({
      width: data.indexBuffer.width,
      height: data.indexBuffer.height,
      gradientStops: data.gradient.gradientStops
    });
    
    // Restore index buffer
    animator.indexBuffer = IndexBuffer.deserialize(data.indexBuffer);
    
    // Restore animation offset
    animator.animationController.setOffset(data.animation.offset);
    
    // Render current state
    animator.renderFrame();
    
    return animator;
  }
  
  /**
   * Create animated gradient fill effect
   */
  createGradientFill(
    x: number, 
    y: number, 
    width: number, 
    height: number,
    startIndex: number = 0,
    endIndex: number = 255
  ) {
    const indexRange = endIndex - startIndex;
    
    for (let py = 0; py < height; py++) {
      const progress = py / height;
      const colorIndex = Math.floor(startIndex + progress * indexRange);
      
      for (let px = 0; px < width; px++) {
        this.indexBuffer.setPixel(x + px, y + py, colorIndex);
      }
    }
    
    if (!this.animationController.isPlaying()) {
      this.renderFrame();
    }
  }
  
  /**
   * Create radial gradient effect
   */
  createRadialGradient(
    centerX: number,
    centerY: number,
    radius: number,
    startIndex: number = 0,
    endIndex: number = 255
  ) {
    const indexRange = endIndex - startIndex;
    
    for (let y = Math.floor(centerY - radius); y <= Math.ceil(centerY + radius); y++) {
      for (let x = Math.floor(centerX - radius); x <= Math.ceil(centerX + radius); x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= radius) {
          const progress = distance / radius;
          const colorIndex = Math.floor(startIndex + progress * indexRange);
          this.indexBuffer.setPixel(x, y, colorIndex);
        }
      }
    }
    
    if (!this.animationController.isPlaying()) {
      this.renderFrame();
    }
  }
  
  /**
   * Clean up resources and return canvas to pool
   */
  cleanup() {
    // Stop animation
    this.animationController.stop();
    
    // Clear callbacks
    this.onFrameCallbacks.clear();
    
    // Return canvas to pool
    if (this.canvas) {
      canvasPool.release(this.canvas);
    }
  }
  
  /**
   * Alias for cleanup to maintain API compatibility
   */
  destroy() {
    this.cleanup();
  }
}
