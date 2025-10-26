/**
 * Optimized ColorCycleBrush with performance enhancements
 * Uses OffscreenCanvas, Web Workers, WASM, and ImageBitmap
 */

import { OffscreenRenderer } from '../../lib/performance/OffscreenRenderer';
import { GradientWorkerManager } from '../../lib/performance/GradientWorkerManager';
import { WASMAccelerator } from '../../lib/performance/WASMAccelerator';
import { ImageBitmapTransfer } from '../../lib/performance/ImageBitmapTransfer';
import { IndexBuffer } from '../../lib/IndexBuffer';
import { GradientPalette } from '../../lib/GradientPalette';
import { AnimationController } from '../../lib/AnimationController';

import { ensurePalette, PaletteHandle } from '@/lib/colorCycle/paletteService';

export interface OptimizedBrushOptions {
  useOffscreenCanvas?: boolean;
  useWebWorkers?: boolean;
  useWASM?: boolean;
  useImageBitmap?: boolean;
  brushSize?: number;
  cycleSpeed?: number;
  fps?: number;
}

export class ColorCycleBrushOptimized {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  
  // Core components
  private indexBuffer: IndexBuffer;
  private gradientPalette: GradientPalette;
  private paletteHandle: PaletteHandle | null = null;
  private animationController: AnimationController;
  
  // Performance components
  private offscreenRenderer: OffscreenRenderer | null = null;
  private workerManager: GradientWorkerManager | null = null;
  private wasmAccelerator: WASMAccelerator | null = null;
  private bitmapTransfer: ImageBitmapTransfer | null = null;
  
  // Configuration
  private options: OptimizedBrushOptions;
  private cycleOffset = 0;
  private currentColorIndex = 1;
  private brushSize = 10;
  
  // Performance flags
  private useOffscreen: boolean;
  private useWorkers: boolean;
  private useWASM: boolean;
  private useBitmap: boolean;

  constructor(canvas: HTMLCanvasElement, options: OptimizedBrushOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', {
      alpha: true,
      desynchronized: true,
      willReadFrequently: false
    });
    
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }
    
    this.ctx = ctx;
    this.width = canvas.width;
    this.height = canvas.height;
    this.options = options;
    
    // Initialize core components
    this.indexBuffer = new IndexBuffer(this.width, this.height);
    this.gradientPalette = GradientPalette.createRainbow();
    this.paletteHandle = ensurePalette({ palette: this.gradientPalette });
    
    // Initialize animation controller
    this.animationController = new AnimationController();
    this.animationController.setFPS(options.fps || 30);
    this.animationController.setOnFrame(this.animate.bind(this));
    
    // Set brush properties
    this.brushSize = options.brushSize || 10;
    
    // Initialize performance features based on options and availability
    this.useOffscreen = options.useOffscreenCanvas !== false && OffscreenRenderer.isSupported();
    this.useWorkers = options.useWebWorkers !== false && GradientWorkerManager.isSupported();
    this.useWASM = options.useWASM !== false && WASMAccelerator.isSupported();
    this.useBitmap = options.useImageBitmap !== false && ImageBitmapTransfer.isSupported();
    
    this.initializePerformanceFeatures();
  }

  private async initializePerformanceFeatures() {
    // Initialize OffscreenCanvas
    if (this.useOffscreen) {
      try {
        this.offscreenRenderer = new OffscreenRenderer(this.width, this.height);
      } catch (error) {
        console.warn('Failed to initialize OffscreenCanvas:', error);
        this.useOffscreen = false;
      }
    }
    
    // Initialize Web Workers
    if (this.useWorkers) {
      try {
        this.workerManager = new GradientWorkerManager();
      } catch (error) {
        console.warn('Failed to initialize Web Workers:', error);
        this.useWorkers = false;
      }
    }
    
    // Initialize WASM
    if (this.useWASM) {
      try {
        this.wasmAccelerator = new WASMAccelerator();
        const success = await this.wasmAccelerator.initialize();
        if (!success) {
          this.useWASM = false;
          this.wasmAccelerator = null;
        }
      } catch (error) {
        console.warn('Failed to initialize WASM:', error);
        this.useWASM = false;
      }
    }
    
    // Initialize ImageBitmap transfer
    if (this.useBitmap) {
      try {
        this.bitmapTransfer = new ImageBitmapTransfer();
      } catch (error) {
        console.warn('Failed to initialize ImageBitmap:', error);
        this.useBitmap = false;
      }
    }
  }

  /**
   * Paint at coordinates with current color
   */
  paint(x: number, y: number) {
    // Use WASM for painting if available
    if (this.useWASM && this.wasmAccelerator) {
      // Access the buffer data directly for WASM operations
      const buffer = new Uint8Array(this.width * this.height);
      // Copy current index buffer state
      for (let py = 0; py < this.height; py++) {
        for (let px = 0; px < this.width; px++) {
          const idx = py * this.width + px;
          buffer[idx] = this.indexBuffer.getPixel(px, py);
        }
      }
      const success = this.wasmAccelerator.paintCircle(
        buffer,
        this.width,
        this.height,
        x,
        y,
        this.brushSize,
        this.currentColorIndex
      );
      
      if (success) {
        // Update index buffer with modified data
        for (let py = 0; py < this.height; py++) {
          for (let px = 0; px < this.width; px++) {
            const idx = py * this.width + px;
            const colorIndex = buffer[idx];
            if (colorIndex !== 0) {
              this.indexBuffer.setPixel(px, py, colorIndex);
            }
          }
        }
        return;
      }
    }

    // Fallback to regular painting
    const brushX = Math.floor(x);
    const brushY = Math.floor(y);
    const color = this.gradientPalette.getColorString(this.currentColorIndex);
    this.indexBuffer.paint(brushX, brushY, this.brushSize, color);
  }

  /**
   * Animate color cycling
   */
  private async animate() {
    this.cycleOffset += (this.options.cycleSpeed || 0.01);
    if (this.cycleOffset > 1) this.cycleOffset -= 1;
    
    await this.render();
  }

  /**
   * Render the current state
   */
  async render() {
    // Get index data as Uint8Array
    const indexData = new Uint8Array(this.width * this.height);
    for (let py = 0; py < this.height; py++) {
      for (let px = 0; px < this.width; px++) {
        const idx = py * this.width + px;
        indexData[idx] = this.indexBuffer.getPixel(px, py);
      }
    }
    let imageData: ImageData;
    
    // Use WASM for palette application if available
    if (this.useWASM && this.wasmAccelerator) {
        const paletteHandle = this.getPaletteHandle();
        const pixels = this.wasmAccelerator.applyPaletteToBuffer(
          indexData,
          paletteHandle.rgba,
          this.cycleOffset
        );
      
      if (pixels) {
        imageData = new ImageData(pixels, this.width, this.height);
      } else {
        // Fallback to regular rendering
        imageData = this.renderFallback(indexData);
      }
    }
    // Use Web Worker for palette application if available
    else if (this.useWorkers && this.workerManager) {
      try {
        const pixels = await this.workerManager.applyToBuffer(indexData, this.cycleOffset);
        imageData = new ImageData(pixels, this.width, this.height);
      } catch (error) {
        console.warn('ColorCycleBrushOptimized worker rendering failed, falling back to local rendering', error);
        // Fallback to regular rendering
        imageData = this.renderFallback(indexData);
      }
    }
    // Regular rendering
    else {
      imageData = this.renderFallback(indexData);
    }
    
    // Use OffscreenCanvas for rendering if available
    if (this.useOffscreen && this.offscreenRenderer) {
      const result = await this.offscreenRenderer.renderImageData(imageData);
      
      // Use ImageBitmap transfer if available
      if (this.useBitmap && this.bitmapTransfer) {
        this.bitmapTransfer.transferToCanvas(result, this.canvas);
      } else {
        // Regular transfer
        if (result instanceof ImageBitmap) {
          this.ctx.drawImage(result, 0, 0);
          result.close();
        } else {
          this.ctx.drawImage(result, 0, 0);
        }
      }
    }
    // Use ImageBitmap for direct rendering if available
    else if (this.useBitmap && this.bitmapTransfer) {
      const bitmap = await this.bitmapTransfer.fromImageData(imageData);
      this.bitmapTransfer.transferToCanvas(bitmap, this.canvas);
    }
    // Regular rendering
    else {
      this.ctx.putImageData(imageData, 0, 0);
    }
  }

  /**
   * Fallback rendering without optimizations
   */
  private renderFallback(indexData: Uint8Array): ImageData {
    const imageData = new ImageData(this.width, this.height);
    this.gradientPalette.applyToIndexBuffer(indexData, imageData, this.cycleOffset);
    return imageData;
  }

  /**
   * Start animation
   */
  startCycling() {
    this.animationController.start();
  }

  /**
   * Stop animation
   */
  stopCycling() {
    this.animationController.stop();
  }

  /**
   * Update gradient
   */
  async updateGradient(stops: Array<{ position: number; color: string }>) {
    // Use Worker for gradient update if available
    if (this.useWorkers && this.workerManager) {
      try {
        await this.workerManager.updateGradient(stops);
        this.gradientPalette = new GradientPalette();
        // Update the internal palette data
        this.gradientPalette.updateFromGradient(stops);
        this.paletteHandle = ensurePalette({ palette: this.gradientPalette });
      } catch (error) {
        console.warn('ColorCycleBrushOptimized worker gradient update failed, falling back to local update', error);
        // Fallback to regular update
        this.gradientPalette.updateFromGradient(stops);
        this.paletteHandle = ensurePalette({ palette: this.gradientPalette });
      }
    } else {
      this.gradientPalette.updateFromGradient(stops);
      this.paletteHandle = ensurePalette({ palette: this.gradientPalette });
    }
  }

  private getPaletteHandle(): PaletteHandle {
    if (!this.paletteHandle) {
      this.paletteHandle = ensurePalette({ palette: this.gradientPalette });
    }
    return this.paletteHandle;
  }

  /**
   * Set brush size
   */
  setBrushSize(size: number) {
    this.brushSize = Math.max(1, Math.min(100, size));
  }

  /**
   * Set current color index
   */
  setColorIndex(index: number) {
    this.currentColorIndex = Math.max(1, Math.min(255, index));
  }

  /**
   * Clear canvas
   */
  clear() {
    this.indexBuffer.clear();
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    if (this.useOffscreen && this.offscreenRenderer) {
      this.offscreenRenderer.clear();
    }
  }

  /**
   * Resize canvas
   */
  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    
    this.indexBuffer = new IndexBuffer(width, height);
    
    if (this.offscreenRenderer) {
      this.offscreenRenderer.resize(width, height);
    }
  }

  /**
   * Get performance stats
   */
  getPerformanceStats() {
    return {
      offscreenCanvas: this.useOffscreen,
      webWorkers: this.useWorkers,
      wasm: this.useWASM,
      imageBitmap: this.useBitmap,
      fps: 30 // Current FPS setting
    };
  }

  /**
   * Dispose of resources
   */
  dispose() {
    this.animationController.stop();
    
    if (this.offscreenRenderer) {
      this.offscreenRenderer.clear();
    }
    
    if (this.workerManager) {
      this.workerManager.dispose();
    }
    
    if (this.wasmAccelerator) {
      this.wasmAccelerator.dispose();
    }
    
    if (this.bitmapTransfer) {
      this.bitmapTransfer.dispose();
    }
  }
}
