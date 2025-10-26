/**
 * ColorCycleRenderer - Combines IndexBuffer with GradientPalette for animated rendering
 * Provides a complete solution for color cycling animation
 */

import { IndexBuffer } from './IndexBuffer';
import { GradientPalette, GradientStop } from './GradientPalette';
import { ensurePalette } from '@/lib/colorCycle/paletteService';

export interface ColorCycleConfig {
  width: number;
  height: number;
  gradientStops?: GradientStop[];
  animationSpeed?: number; // Cycles per second
  fps?: number; // Target frames per second
}

export class ColorCycleRenderer {
  private indexBuffer: IndexBuffer;
  private gradientPalette: GradientPalette;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  
  // Animation state
  private animationSpeed: number = 1.0; // Cycles per second
  private fps: number = 30;
  private animationOffset: number = 0;
  private isAnimating: boolean = false;
  private animationId: number | null = null;
  private lastFrameTime: number = 0;
  
  // Color mapping
  private nextColorIndex: number = 1; // Start at 1 (0 is reserved for transparent)
  private colorToIndex: Map<string, number> = new Map();
  
  constructor(config: ColorCycleConfig) {
    // Initialize buffers
    this.indexBuffer = new IndexBuffer(config.width, config.height);
    this.gradientPalette = new GradientPalette(config.gradientStops);
    ensurePalette({ palette: this.gradientPalette });
    
    // Create rendering canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = config.width;
    this.canvas.height = config.height;
    
    const ctx = this.canvas.getContext('2d', { 
      willReadFrequently: true,
      alpha: true 
    });
    
    if (!ctx) {
      throw new Error('Failed to create 2D context');
    }
    
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false; // Pixel-perfect rendering
    
    // Apply config
    if (config.animationSpeed !== undefined) {
      this.animationSpeed = config.animationSpeed;
    }
    if (config.fps !== undefined) {
      this.fps = config.fps;
    }
    
    // Initialize palette in IndexBuffer
    this.updateIndexBufferPalette();
  }
  
  /**
   * Update the IndexBuffer's palette from the GradientPalette
   */
  private updateIndexBufferPalette() {
    const paletteStrings = this.gradientPalette.getPaletteStrings();
    this.indexBuffer.setPalette(paletteStrings);
    ensurePalette({ palette: this.gradientPalette });
  }
  
  /**
   * Map a color to a gradient position (0-255)
   */
  private getGradientIndex(color: string): number {
    // Check if we already have this color mapped
    if (this.colorToIndex.has(color)) {
      return this.colorToIndex.get(color)!;
    }
    
    // Assign next available index
    const index = this.nextColorIndex;
    this.colorToIndex.set(color, index);
    
    // Wrap around if we exceed 255 (very unlikely in practice)
    this.nextColorIndex = (this.nextColorIndex % 255) + 1;
    
    return index;
  }
  
  /**
   * Paint with a brush (maps to gradient automatically)
   */
  paint(x: number, y: number, brushSize: number, color?: string) {
    // If no color specified, use gradient position based on stroke progress
    const gradientIndex = color ? this.getGradientIndex(color) : this.nextColorIndex;
    
    // Convert gradient index to palette color
    const paletteColor = this.gradientPalette.getColorString(gradientIndex);
    
    // Paint to index buffer
    this.indexBuffer.paint(x, y, brushSize, paletteColor);
  }
  
  /**
   * Paint a line
   */
  paintLine(x0: number, y0: number, x1: number, y1: number, brushSize: number, color?: string) {
    const gradientIndex = color ? this.getGradientIndex(color) : this.nextColorIndex;
    const paletteColor = this.gradientPalette.getColorString(gradientIndex);
    
    this.indexBuffer.paintLine(x0, y0, x1, y1, brushSize, paletteColor);
  }
  
  /**
   * Fill an area
   */
  fill(x: number, y: number, color?: string) {
    const gradientIndex = color ? this.getGradientIndex(color) : this.nextColorIndex;
    const paletteColor = this.gradientPalette.getColorString(gradientIndex);
    
    this.indexBuffer.fill(x, y, paletteColor);
  }
  
  /**
   * Clear the buffer
   */
  clear() {
    this.indexBuffer.clear();
    this.nextColorIndex = 1;
    this.colorToIndex.clear();
  }
  
  /**
   * Update gradient
   */
  setGradient(stops: GradientStop[]) {
    this.gradientPalette.updateFromGradient(stops);
    this.updateIndexBufferPalette();
  }
  
  /**
   * Render current frame (with optional animation offset)
   */
  render(targetCtx?: CanvasRenderingContext2D): ImageData {
    // Get the index data
    const indexData = this.indexBuffer.serialize().data;
    
    // Create ImageData for output
    const imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    
    // Apply gradient palette with current animation offset
    this.gradientPalette.applyToIndexBuffer(indexData, imageData, this.animationOffset);
    
    // Put image data to internal canvas
    this.ctx.putImageData(imageData, 0, 0);
    
    // If target context provided, draw to it
    if (targetCtx) {
      targetCtx.drawImage(this.canvas, 0, 0);
    }
    
    return imageData;
  }
  
  /**
   * Start animation
   */
  startAnimation(onFrame?: (imageData: ImageData) => void) {
    if (this.isAnimating) return;
    
    this.isAnimating = true;
    this.lastFrameTime = performance.now();
    
    const animate = (currentTime: number) => {
      if (!this.isAnimating) return;
      
      // Calculate delta time
      const deltaTime = (currentTime - this.lastFrameTime) / 1000; // Convert to seconds
      this.lastFrameTime = currentTime;
      
      // Update animation offset
      this.animationOffset += deltaTime * this.animationSpeed;
      this.animationOffset = this.animationOffset % 1; // Keep in 0-1 range
      
      // Render frame
      const imageData = this.render();
      
      // Call callback if provided
      if (onFrame) {
        onFrame(imageData);
      }
      
      // Schedule next frame
      const frameInterval = 1000 / this.fps;
      this.animationId = window.setTimeout(() => {
        requestAnimationFrame(animate);
      }, frameInterval);
    };
    
    requestAnimationFrame(animate);
  }
  
  /**
   * Stop animation
   */
  stopAnimation() {
    this.isAnimating = false;
    
    if (this.animationId !== null) {
      clearTimeout(this.animationId);
      this.animationId = null;
    }
  }
  
  /**
   * Toggle animation
   */
  toggleAnimation(onFrame?: (imageData: ImageData) => void) {
    if (this.isAnimating) {
      this.stopAnimation();
    } else {
      this.startAnimation(onFrame);
    }
  }
  
  /**
   * Set animation speed
   */
  setAnimationSpeed(cyclesPerSecond: number) {
    this.animationSpeed = Math.max(0.1, Math.min(10, cyclesPerSecond));
  }
  
  /**
   * Set target FPS
   */
  setFPS(fps: number) {
    this.fps = Math.max(1, Math.min(60, fps));
  }
  
  /**
   * Get the canvas element
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
  
  /**
   * Get current dimensions
   */
  getDimensions(): { width: number; height: number } {
    return this.indexBuffer.getDimensions();
  }
  
  /**
   * Resize the renderer
   */
  resize(width: number, height: number) {
    this.indexBuffer.resize(width, height);
    this.canvas.width = width;
    this.canvas.height = height;
  }
  
  /**
   * Export current state
   */
  serialize(): {
    indexBuffer: ReturnType<IndexBuffer['serialize']>;
    gradient: ReturnType<GradientPalette['serialize']>;
    animationSpeed: number;
    fps: number;
    animationOffset: number;
  } {
    return {
      indexBuffer: this.indexBuffer.serialize(),
      gradient: this.gradientPalette.serialize(),
      animationSpeed: this.animationSpeed,
      fps: this.fps,
      animationOffset: this.animationOffset
    };
  }
  
  /**
   * Import state
   */
  static deserialize(data: ReturnType<ColorCycleRenderer['serialize']>): ColorCycleRenderer {
    const renderer = new ColorCycleRenderer({
      width: data.indexBuffer.width,
      height: data.indexBuffer.height,
      gradientStops: data.gradient.gradientStops,
      animationSpeed: data.animationSpeed,
      fps: data.fps
    });
    
    // Restore index buffer
    renderer.indexBuffer = IndexBuffer.deserialize(data.indexBuffer);
    
    // Restore animation offset
    renderer.animationOffset = data.animationOffset;
    
    return renderer;
  }
  
  /**
   * Create with preset gradient
   */
  static createWithPreset(
    width: number, 
    height: number, 
    preset: 'rainbow' | 'fire' | 'ocean' | 'sunset' | 'grayscale'
  ): ColorCycleRenderer {
    let gradient: GradientPalette;
    
    switch (preset) {
      case 'rainbow':
        gradient = GradientPalette.createRainbow();
        break;
      case 'fire':
        gradient = GradientPalette.createFire();
        break;
      case 'ocean':
        gradient = GradientPalette.createOcean();
        break;
      case 'sunset':
        gradient = GradientPalette.createSunset();
        break;
      case 'grayscale':
      default:
        gradient = GradientPalette.createGrayscale();
        break;
    }
    
    return new ColorCycleRenderer({
      width,
      height,
      gradientStops: gradient.getGradientStops()
    });
  }
}
