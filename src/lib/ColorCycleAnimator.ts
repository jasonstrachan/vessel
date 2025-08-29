/**
 * ColorCycleAnimator - Integrates AnimationController with color cycling
 * Provides a complete animated drawing system with indexed colors
 */

import { IndexBuffer } from './IndexBuffer';
import { GradientPalette, GradientStop } from './GradientPalette';
import { AnimationController } from './AnimationController';
import { canvasPool } from '../utils/canvasPool';

export interface ColorCycleAnimatorConfig {
  width: number;
  height: number;
  gradientStops?: GradientStop[];
  fps?: number;
  speed?: number;
  autoStart?: boolean;
  lazyInit?: boolean; // Support deferred heavy initialization
}

export class ColorCycleAnimator {
  private indexBuffer: IndexBuffer;
  private gradientPalette: GradientPalette;
  private animationController: AnimationController;
  
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData;
  
  // Stroke tracking for directional flow
  private strokeOrder: Uint16Array; // Store order each pixel was painted (0 = not painted)
  private currentStrokeIndex: number = 1;
  private maxStrokeIndex: number = 0;
  private flowDirection: 'forward' | 'backward' = 'forward'; // Flow direction toggle
  
  // Callbacks
  private onFrameCallbacks: Set<(imageData: ImageData) => void> = new Set();
  
  constructor(config: ColorCycleAnimatorConfig) {
    // If lazy init, defer heavy initialization
    if (config.lazyInit) {
      console.time('[ColorCycleAnimator] IndexBuffer creation (lazy)');
      // Create minimal buffers first
      this.indexBuffer = new IndexBuffer(config.width, config.height);
      console.timeEnd('[ColorCycleAnimator] IndexBuffer creation (lazy)');
      
      console.time('[ColorCycleAnimator] GradientPalette creation');
      this.gradientPalette = config.gradientStops 
        ? new GradientPalette(config.gradientStops)
        : GradientPalette.createRainbow();
      console.timeEnd('[ColorCycleAnimator] GradientPalette creation');
      
      console.time('[ColorCycleAnimator] Canvas creation (pooled)');
      // Use canvas pool for better performance
      this.canvas = canvasPool.acquire(config.width, config.height);
      console.timeEnd('[ColorCycleAnimator] Canvas creation (pooled)');
      
      console.time('[ColorCycleAnimator] Context creation');
      const ctx = this.canvas.getContext('2d', {
        willReadFrequently: false, // Changed to false for lazy init
        alpha: true
      });
      console.timeEnd('[ColorCycleAnimator] Context creation');
      
      if (!ctx) {
        throw new Error('Failed to create canvas context');
      }
      
      this.ctx = ctx;
      this.ctx.imageSmoothingEnabled = false;
      
      // Defer image data creation until first use
      this.imageData = null as any; // Will be created on first paint
      
      // Use smaller stroke order buffer initially
      this.strokeOrder = new Uint16Array(0); // Start empty
      
      console.time('[ColorCycleAnimator] AnimationController creation');
      // Initialize animation controller with lazy settings
      this.animationController = new AnimationController({
        fps: config.fps || 30,
        speed: config.speed || 1.0,
        autoStart: false, // Never auto-start in lazy mode
        onFrame: this.handleAnimationFrame.bind(this)
      });
      console.timeEnd('[ColorCycleAnimator] AnimationController creation');
      
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
      
      // Initialize stroke order buffer
      this.strokeOrder = new Uint16Array(config.width * config.height);
      
      // Initialize animation controller
      this.animationController = new AnimationController({
        fps: config.fps || 30,
        speed: config.speed || 1.0,
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
  private handleAnimationFrame(deltaTime: number, totalTime: number) {
    // Get current animation offset
    const offset = this.animationController.getOffset();
    
    // Render frame with offset
    this.renderFrame(offset);
    
    // Notify all callbacks
    this.onFrameCallbacks.forEach(callback => {
      callback(this.imageData);
    });
  }
  
  /**
   * Update IndexBuffer palette from gradient
   */
  private updateIndexBufferPalette() {
    const paletteStrings = this.gradientPalette.getPaletteStrings();
    this.indexBuffer.setPalette(paletteStrings);
  }
  
  /**
   * Render a single frame with directional flow
   */
  private renderFrame(offset: number = 0) {
    const perfStart = performance.now();
    
    try {
      // Ensure imageData is created (for lazy init)
      if (!this.imageData) {
        const imgStart = performance.now();
        this.imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
        console.log(`[PERF] createImageData took ${(performance.now() - imgStart).toFixed(1)}ms for ${this.canvas.width}x${this.canvas.height}`);
      }
      
      // Get index data directly (no copy)
      const indexData = this.indexBuffer.getDirectData();
      
      if (!indexData) {
        console.error('[ColorCycleAnimator] IndexBuffer data is invalid');
        return;
      }
      const pixels = this.imageData.data;
      
      if (!pixels) {
        console.error('[ColorCycleAnimator] ImageData pixels is null');
        return;
      }
      
      const loopStart = performance.now();
      
      // Apply palette with directional flow based on stroke order
      for (let i = 0; i < indexData.length; i++) {
        const colorIndex = indexData[i];
        
        // Skip transparent pixels
        if (colorIndex === 0) {
          const pixelIndex = i * 4;
          pixels[pixelIndex] = 0;
          pixels[pixelIndex + 1] = 0;
          pixels[pixelIndex + 2] = 0;
          pixels[pixelIndex + 3] = 0;
          continue;
        }
        
        // NEW: Use color index directly for stamp-based gradient progression
        // The color index already represents the position in the gradient
        // No need for animation offset or flow offset - each stamp has its assigned color
        const paletteIndex = (colorIndex - 1) % 256;
        
        // Optional: Add animation cycling effect on top of base colors
        // This will cycle the entire gradient while preserving relative positions
        if (offset > 0) {
          const animatedIndex = Math.floor((paletteIndex + offset * 256) % 256);
          const color = this.gradientPalette.getColor(animatedIndex);
          const pixelIdx = i * 4;
          
          pixels[pixelIdx] = color.r;
          pixels[pixelIdx + 1] = color.g;
          pixels[pixelIdx + 2] = color.b;
          pixels[pixelIdx + 3] = color.a;
        } else {
          // No animation - use static colors
          const color = this.gradientPalette.getColor(paletteIndex);
          const pixelIdx = i * 4;
          
          pixels[pixelIdx] = color.r;
          pixels[pixelIdx + 1] = color.g;
          pixels[pixelIdx + 2] = color.b;
          pixels[pixelIdx + 3] = color.a;
        }
      }
    
    const loopTime = performance.now() - loopStart;
    
    // Put image data to canvas
    const putStart = performance.now();
    this.ctx.putImageData(this.imageData, 0, 0);
    const putTime = performance.now() - putStart;
    
    const totalTime = performance.now() - perfStart;
    
    } catch (error) {
      console.error('[ColorCycleAnimator] Error in renderFrame:', error);
      console.error('[ColorCycleAnimator] Stack:', (error as Error).stack);
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
   * Paint square brush with stamp-based color progression
   */
  paintSquare(x: number, y: number, brushSize: number, colorIndex?: number) {
    try {
      // Use provided color index or auto-increment
      const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
      
      const color = this.gradientPalette.getColorString(index);
      
      // Paint to index buffer with the specific color index - NO RENDERING
      this.indexBuffer.paintSquare(x, y, brushSize, color);
      
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
    
    // REMOVED per-stamp rendering - caller handles batched rendering
  }
  
  /**
   * Fill area
   */
  fill(x: number, y: number, colorIndex?: number) {
    const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
    const color = this.gradientPalette.getColorString(index);
    
    this.indexBuffer.fill(x, y, color);
    
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
  startStroke(x?: number, y?: number) {
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
    // Calculate delta time (assume 30fps if called externally)
    const deltaTime = 1/30;
    
    // Update animation offset manually
    const currentOffset = this.animationController.getOffset();
    const speed = this.animationController.getSpeed();
    const newOffset = (currentOffset + deltaTime * speed) % 1;
    this.animationController.setOffset(newOffset);
    
    // Trigger frame render
    this.handleAnimationFrame(deltaTime, 0);
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
    return this.canvas;
  }
  
  /**
   * Get current image data
   */
  getImageData(): ImageData {
    return this.imageData;
  }
  
  /**
   * Draw to another context
   */
  drawTo(ctx: CanvasRenderingContext2D, x: number = 0, y: number = 0) {
    ctx.drawImage(this.canvas, x, y);
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
    console.log('🎨 [ColorCycleAnimator] Setting flow direction to:', direction);
    this.flowDirection = direction;
    // Always re-render to show the change immediately
    this.renderFrame(this.animationController.getOffset());
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
      this.renderFrame();
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
        const color = this.gradientPalette.getColorString(colorIndex);
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