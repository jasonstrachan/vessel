/**
 * ColorCycleAnimator - Integrates AnimationController with color cycling
 * Provides a complete animated drawing system with indexed colors
 */

import { IndexBuffer } from './IndexBuffer';
import { GradientPalette, GradientStop } from './GradientPalette';
import { AnimationController } from './AnimationController';

export interface ColorCycleAnimatorConfig {
  width: number;
  height: number;
  gradientStops?: GradientStop[];
  fps?: number;
  speed?: number;
  autoStart?: boolean;
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
    // Initialize buffers
    this.indexBuffer = new IndexBuffer(config.width, config.height);
    this.gradientPalette = config.gradientStops 
      ? new GradientPalette(config.gradientStops)
      : GradientPalette.createRainbow();
    
    // Create canvas for rendering
    this.canvas = document.createElement('canvas');
    this.canvas.width = config.width;
    this.canvas.height = config.height;
    
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
    // Get index data
    const indexData = this.indexBuffer.serialize().data;
    const pixels = this.imageData.data;
    
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
    
    // Put image data to canvas
    this.ctx.putImageData(this.imageData, 0, 0);
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
    // Use provided color index or auto-increment
    const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
    const color = this.gradientPalette.getColorString(index);
    
    // Debug: Log color assignment for first few stamps
    if (colorIndex !== undefined && (colorIndex < 5 || colorIndex % 50 === 0)) {
      console.log(`  → Using gradient position ${index}: ${color}`);
    }
    
    // Paint to index buffer with the specific color index
    this.indexBuffer.paintSquare(x, y, brushSize, color);
    
    // No longer tracking stroke order since we're using direct color indices
    // Each stamp has its own color position in the gradient
    
    if (!this.animationController.isPlaying()) {
      this.renderFrame();
    }
  }
  
  /**
   * Paint line
   */
  paintLine(x0: number, y0: number, x1: number, y1: number, brushSize: number, colorIndex?: number) {
    const index = colorIndex !== undefined ? colorIndex : this.getNextColorIndex();
    const color = this.gradientPalette.getColorString(index);
    
    this.indexBuffer.paintLine(x0, y0, x1, y1, brushSize, color);
    
    if (!this.animationController.isPlaying()) {
      this.renderFrame();
    }
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
    this.indexBuffer.resize(width, height);
    this.canvas.width = width;
    this.canvas.height = height;
    this.imageData = this.ctx.createImageData(width, height);
    // Resize stroke order buffer
    this.strokeOrder = new Uint16Array(width * height);
    this.currentStrokeIndex = 1;
    this.maxStrokeIndex = 0;
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
}