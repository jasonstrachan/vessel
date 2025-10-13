/**
 * RecolorEngine - Core engine for converting layers to animated indexed color
 * Handles quantization, index buffers, palette management, and frame rendering
 * Based on the color cycling recolor feature specification
 */

import { ColorQuantizer, QuantizationOptions } from './ColorQuantizer';
import { WebGLColorCycleRenderer } from './rendering/WebGLColorCycleRenderer';
import { CPUColorCycleRenderer } from './rendering/CPUColorCycleRenderer';
import { GradientPalette } from '../GradientPalette';
import type { Layer } from '../../types';
import type { RecolorSettings } from './types';

export interface RecolorEngineConfig {
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  context?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

export class RecolorEngine {
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private config: RecolorEngineConfig;
  // GPU renderer for palette mapping
  private glRenderer: WebGLColorCycleRenderer | null = null;
  private lastPaletteHash: string | null = null;
  private gpuUnavailable = false;
  private cpuRenderer = new CPUColorCycleRenderer();
  
  constructor(config: RecolorEngineConfig = {}) {
    this.config = config;
    // Don't initialize canvas during construction to avoid SSR issues
    // Canvas will be initialized lazily when first needed
  }

  /**
   * Lazy initialization of canvas - only called when needed and in browser environment
   */
  private ensureCanvas(): {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  } {
    if (this.canvas && this.ctx) {
      return { canvas: this.canvas, ctx: this.ctx };
    }

    // Check if we're in a browser environment
    if (typeof window === 'undefined') {
      throw new Error('RecolorEngine requires browser environment (canvas not available during SSR)');
    }

    if (this.config.canvas && this.config.context) {
      this.canvas = this.config.canvas;
      this.ctx = this.config.context;
    } else {
      // Create offscreen canvas for processing
      if (typeof OffscreenCanvas !== 'undefined') {
        this.canvas = new OffscreenCanvas(1, 1);
      } else {
        // Fallback to regular canvas element
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1;
        this.canvas.height = 1;
      }
      
      const canvas = this.canvas;
      if (!canvas) {
        throw new Error('Failed to allocate canvas for RecolorEngine');
      }

      const context = canvas.getContext('2d', {
        willReadFrequently: true,
        alpha: true
      });

      if (!context) {
        throw new Error('Failed to create canvas context for RecolorEngine');
      }

      this.ctx = context as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    }

    if (!this.canvas || !this.ctx) {
      throw new Error('Failed to initialize RecolorEngine canvas/context');
    }

    this.ctx.imageSmoothingEnabled = false;
    return { canvas: this.canvas, ctx: this.ctx };
  }
  
  /**
   * Process a layer to create indexed color data for animation
   * This is the main entry point for converting a layer to recolor mode
   */
  processLayer(layer: Layer, options: {
    quantizationMode?: 'rgb332' | 'oklab-median-cut';
    ditherMode?: 'off' | 'bayer4' | 'bayer8';
    cycleColors?: number; // 8-256, default 16
    quality?: 'fast' | 'balanced' | 'best';
    useSpatialHash?: boolean;
    gradientPreset?: 'rainbow' | 'fire' | 'ocean' | 'sunset' | 'custom';
    customGradient?: Array<{ position: number; color: string }>;
  } = {}): boolean {
    try {
      console.time('[RecolorEngine] processLayer');
      
      if (!layer.imageData || layer.imageData.data.length === 0) {
        console.warn('[RecolorEngine] No image data to process');
        return false;
      }
      
      // Debug: Check what the original image data looks like
      let nonTransparentPixels = 0;
      const samplePixels: number[] = [];
      for (let i = 0; i < Math.min(layer.imageData.data.length, 400); i += 4) {
        const alpha = layer.imageData.data[i + 3];
        if (alpha > 0) nonTransparentPixels++;
        if (i < 40) {
          samplePixels.push(layer.imageData.data[i], layer.imageData.data[i+1], layer.imageData.data[i+2], layer.imageData.data[i+3]);
        }
      }
      
      console.log(`[RecolorEngine] Original layer analysis: ${nonTransparentPixels} non-transparent pixels in first 100`);
      console.log(`[RecolorEngine] Sample original pixels (RGBA):`, samplePixels);
      
      // Set default options
      const {
        quantizationMode = 'rgb332',
        ditherMode = 'off',
        cycleColors = 16,
        quality = 'balanced',
        useSpatialHash = true,
        gradientPreset = 'rainbow',
        customGradient
      } = options;
      
      // Initialize recolor settings if not present
      const existingColorCycleData = layer.colorCycleData ?? {};
      const framebufferCanvas =
        existingColorCycleData.canvas ??
        (layer.framebuffer instanceof HTMLCanvasElement ? layer.framebuffer : undefined);

      layer.colorCycleData = {
        ...existingColorCycleData,
        mode: 'recolor',
        canvas: framebufferCanvas,
      };

      const colorCycleData = layer.colorCycleData;

      if (!colorCycleData) {
        throw new Error('Failed to initialize color cycle data for layer');
      }

      if (!colorCycleData.recolorSettings) {
        const defaultSpeed = 0.1;
        const defaultFPS = 30;
        const ticksPerFrame = (defaultSpeed / defaultFPS) * cycleColors; // keep in sync with controller logic
        colorCycleData.recolorSettings = {
          quantizationMode,
          ditherMode,
          animation: {
            speed: defaultSpeed,
            fps: defaultFPS,
            ticksPerFrame,
            isPlaying: false,
            currentTick: 0,
            flowDirection: 'forward'
          },
          cycleColors,
          gradient: [],
          mappingMode: 'banded',
          flowMapping: 'palette',
          currentLOD: 'full',
          originalImageData: new ImageData(
            new Uint8ClampedArray(layer.imageData.data),
            layer.imageData.width,
            layer.imageData.height
          )
        };
      }

      const settings = colorCycleData.recolorSettings!;
      
      // Step 1: Quantize to indexed color with enhanced options
      console.time('[RecolorEngine] quantization');
      
      const quantizationOptions: Partial<QuantizationOptions> = {
        method: quantizationMode,
        ditherMode,
        quality,
        maxColors: Math.min(256, cycleColors * 16), // Allow more palette colors for better gradients
        useSpatialHash
      };
      
      const quantized = ColorQuantizer.quantize(layer.imageData, quantizationOptions);
      console.timeEnd('[RecolorEngine] quantization');
      
      // Log quantization statistics
      if (quantized.stats) {
        console.log(`[RecolorEngine] Quantization completed:`, {
          method: quantized.stats.method,
          originalColors: Math.floor(quantized.stats.compressionRatio * quantized.actualColors),
          quantizedColors: quantized.actualColors,
          compressionRatio: quantized.stats.compressionRatio.toFixed(2),
          avgError: quantized.stats.avgError.toFixed(2),
          processingTime: quantized.stats.processingTime.toFixed(2) + 'ms'
        });
      }
      
      // Step 2: Store index buffer and palette
      settings.indexBuffer = quantized.indices;
      settings.palette = quantized.palette;
      settings.colorMap = quantized.colorMap;
      
      console.log(`[RecolorEngine] Quantization results:`, {
        indexBufferSize: quantized.indices ? quantized.indices.length : 'null',
        paletteSize: quantized.palette ? quantized.palette.length : 'null',
        imageSize: layer.imageData.width + 'x' + layer.imageData.height
      });
      
      // Step 4: Set up gradient for animation
      if (customGradient) {
        settings.gradient = customGradient;
        console.log(`[RecolorEngine] Using custom gradient with ${customGradient.length} stops`);
      } else {
        settings.gradient = this.createPresetGradient(gradientPreset);
        console.log(`[RecolorEngine] Created ${gradientPreset} gradient with ${settings.gradient.length} stops:`, settings.gradient);
      }
      
      // Step 5: Update canvas size to match layer
      this.resizeCanvas(layer.imageData.width, layer.imageData.height);
      
      console.timeEnd('[RecolorEngine] processLayer');
      console.log(`[RecolorEngine] Processed ${layer.imageData.width}x${layer.imageData.height} layer with ${quantized.actualColors} colors`);
      
      return true;
      
    } catch (error) {
      console.error('[RecolorEngine] Error processing layer:', error);
      return false;
    }
  }
  
  /**
   * Render a single frame of animation
   * This is called repeatedly during animation to update the visual
   */
  renderFrame(layer: Layer, tick?: number): ImageData | null {
    if (!layer.colorCycleData?.recolorSettings?.indexBuffer || 
        !layer.colorCycleData.recolorSettings.palette) {
      console.warn('[RecolorEngine] renderFrame: missing indexBuffer or palette');
      return null;
    }

    const colorCycleData = layer.colorCycleData!;
    const settings = colorCycleData.recolorSettings!;
    const currentTick = tick ?? settings.animation.currentTick;
    const sourceImage = layer.imageData;
    if (!sourceImage) {
      console.warn('[RecolorEngine] renderFrame: missing layer image data');
      return null;
    }
    
    try {
      const { width, height } = sourceImage;

      const canUseGPU =
        !this.gpuUnavailable &&
        typeof window !== 'undefined' &&
        WebGLColorCycleRenderer.isSupported();

      if (canUseGPU) {
        try {
          if (!this.glRenderer) {
            this.glRenderer = new WebGLColorCycleRenderer({ width, height });
          } else {
            this.glRenderer.resize(width, height);
          }

          const gradientKey = JSON.stringify(settings.gradient || []);
          if (this.lastPaletteHash !== gradientKey) {
            const gp = new GradientPalette(
              settings.gradient || [
                { position: 0, color: '#000000' },
                { position: 1, color: '#ffffff' },
              ]
            );
            const paletteRGBA = gp.getPaletteColors();
            this.glRenderer.setPaletteColors(paletteRGBA);
            this.lastPaletteHash = gradientKey;
          }

          const bands = Math.max(1, settings.cycleColors || 16);
          const dir = settings.animation.flowDirection === 'reverse' ? -1 : 1;
          let offset = (currentTick / bands) * dir;
          offset = ((offset % 1) + 1) % 1;

          this.glRenderer.setIndexData(settings.indexBuffer!);
          this.glRenderer.render(offset);

          colorCycleData.mode = 'recolor';
          colorCycleData.canvas = this.glRenderer.getCanvas();
          return null;
        } catch (error) {
          console.error('[RecolorEngine] GPU render failed, falling back to CPU:', error);
          this.gpuUnavailable = true;
          if (this.glRenderer) {
            this.glRenderer.dispose();
            this.glRenderer = null;
          }
          colorCycleData.canvas = undefined;
        }
      }

      return this.cpuRenderer.render(layer, settings, currentTick);
    } catch (error) {
      console.error('[RecolorEngine] Error rendering frame:', error);
      return null;
    }
  }

  /**
   * Create preset gradients
   */
  private createPresetGradient(preset: string): Array<{ position: number; color: string }> {
    switch (preset) {
      case 'rainbow':
        return [
          { position: 0, color: '#ff0000' },
          { position: 0.17, color: '#ff8000' },
          { position: 0.33, color: '#ffff00' },
          { position: 0.5, color: '#00ff00' },
          { position: 0.67, color: '#0080ff' },
          { position: 0.83, color: '#8000ff' },
          { position: 1, color: '#ff0000' }
        ];
      
      case 'fire':
        return [
          { position: 0, color: '#000000' },
          { position: 0.3, color: '#800000' },
          { position: 0.6, color: '#ff4000' },
          { position: 0.8, color: '#ffff00' },
          { position: 1, color: '#ffffff' }
        ];
      
      case 'ocean':
        return [
          { position: 0, color: '#000040' },
          { position: 0.5, color: '#0080ff' },
          { position: 1, color: '#80ffff' }
        ];
      
      case 'sunset':
        return [
          { position: 0, color: '#4000ff' },
          { position: 0.3, color: '#ff0080' },
          { position: 0.6, color: '#ff8000' },
          { position: 1, color: '#ffff80' }
        ];
      
      default:
        return [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' }
        ];
    }
  }
  
  /**
   * Resize internal canvas
   */
  private resizeCanvas(width: number, height: number): void {
    const { canvas } = this.ensureCanvas();
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }
  
  /**
   * Update gradient for a processed layer
   */
  updateGradient(layer: Layer, gradient: Array<{ position: number; color: string }>): boolean {
    if (!layer.colorCycleData?.recolorSettings) {
      return false;
    }
    
    layer.colorCycleData.recolorSettings.gradient = gradient;
    return true;
  }

  /**
   * Update mapping mode for a processed layer
   */
  updateMappingMode(layer: Layer, mode: 'banded' | 'continuous'): boolean {
    if (!layer.colorCycleData?.recolorSettings) return false;
    layer.colorCycleData.recolorSettings.mappingMode = mode;
    return true;
  }
  
  /**
   * Clear all cached data for a layer
   */
  clearBuffers(layer: Layer): void {
    if (layer.colorCycleData?.recolorSettings) {
      layer.colorCycleData.recolorSettings.indexBuffer = undefined;
      layer.colorCycleData.recolorSettings.palette = undefined;
    }
    this.cpuRenderer.releaseLayer(layer.id);
  }
  
  /**
   * Get processing stats for debugging
   */
  getStats(): {
    pooledBuffers: number;
    memoryUsage: number;
  } {
    return this.cpuRenderer.getStats();
  }
}
