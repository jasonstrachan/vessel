/**
 * RecolorEngine - Core engine for converting layers to animated indexed color
 * Handles quantization, index buffers, palette management, and frame rendering
 * Based on the color cycling recolor feature specification
 */

import { ColorQuantizer, QuantizedResult, QuantizationOptions } from './ColorQuantizer';
import { WebGLColorCycleRenderer } from './rendering/WebGLColorCycleRenderer';
import { GradientPalette } from '../GradientPalette';
import type { Layer } from '../../types';

export interface RecolorEngineConfig {
  canvas?: HTMLCanvasElement;
  context?: CanvasRenderingContext2D;
}

export class RecolorEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private config: RecolorEngineConfig;
  // GPU renderer for palette mapping
  private glRenderer: WebGLColorCycleRenderer | null = null;
  private lastPaletteHash: string | null = null;
  
  // Buffer pooling for memory efficiency
  private static bufferPool: Map<string, Uint8Array[]> = new Map();
  private static readonly MAX_POOLED_BUFFERS = 5;
  
  constructor(config: RecolorEngineConfig = {}) {
    this.config = config;
    // Don't initialize canvas during construction to avoid SSR issues
    // Canvas will be initialized lazily when first needed
  }

  /**
   * Lazy initialization of canvas - only called when needed and in browser environment
   */
  private ensureCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
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
        this.canvas = new OffscreenCanvas(1, 1) as any;
      } else {
        // Fallback to regular canvas element
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1;
        this.canvas.height = 1;
      }
      
      this.ctx = this.canvas.getContext('2d', {
        willReadFrequently: true,
        alpha: true
      }) as CanvasRenderingContext2D;
      
      if (!this.ctx) {
        throw new Error('Failed to create canvas context for RecolorEngine');
      }
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
      if (!layer.colorCycleData) {
        layer.colorCycleData = { mode: 'recolor' };
      }
      
      if (!layer.colorCycleData.recolorSettings) {
        const defaultSpeed = 0.1;
        const defaultFPS = 30;
        const ticksPerFrame = (defaultSpeed / defaultFPS) * cycleColors; // keep in sync with controller logic
        layer.colorCycleData.recolorSettings = {
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
      
      const settings = layer.colorCycleData.recolorSettings!;
      
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

    const settings = layer.colorCycleData.recolorSettings;
    const currentTick = tick ?? settings.animation.currentTick;
    
    try {
      const width = layer.imageData!.width;
      const height = layer.imageData!.height;

      // GPU fast-path: palette-index based flow with cyclic offset
      if (typeof window !== 'undefined' && WebGLColorCycleRenderer.isSupported()) {
        // Lazy init renderer
        if (!this.glRenderer) {
          this.glRenderer = new WebGLColorCycleRenderer({ width, height });
        } else {
          this.glRenderer.resize(width, height);
        }

        // Upload base palette (once per gradient change)
        const gradientKey = JSON.stringify(settings.gradient || []);
        if (this.lastPaletteHash !== gradientKey) {
          try {
            const gp = new GradientPalette(settings.gradient || [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' }
            ]);
            const paletteRGBA = gp.getPaletteColors();
            this.glRenderer.setPaletteColors(paletteRGBA);
            this.lastPaletteHash = gradientKey;
          } catch (e) {
            // If palette upload fails, fallback to CPU path below
          }
        }

        // Compute cyclic offset in [0,1)
        const bands = Math.max(1, settings.cycleColors || 16);
        const dir = settings.animation.flowDirection === 'reverse' ? -1 : 1;
        let o = (currentTick / bands) * dir;
        o = ((o % 1) + 1) % 1;

        // Upload index buffer and render
        this.glRenderer.setIndexData(settings.indexBuffer!);
        this.glRenderer.render(o);

        // Expose GPU canvas to layer for composition
        if (!layer.colorCycleData) layer.colorCycleData = { mode: 'recolor' } as any;
        layer.colorCycleData.mode = 'recolor';
        (layer.colorCycleData as any).canvas = this.glRenderer.getCanvas();

        // Return null to indicate GPU path updated canvas (no ImageData copy)
        return null;
      }

      // Flow mapping branch (CPU fallback): palette-index based vs. per-pixel phase based
      const flowMapping = settings.flowMapping || 'palette';
      let imageData: ImageData | null = null;

      if (flowMapping === 'palette') {
        // Existing path: build LUT over indices and map indexBuffer -> pixels
        const gradientLUT = this.buildGradientLUT(settings, currentTick);
        if (!settings.indexBuffer) return null;
        imageData = this.mapIndicesToColors(
          settings.indexBuffer,
          gradientLUT,
          width,
          height
        );
      } else {
        // Phase-based path: ensure phaseMap present, then index into LUT by phase
        this.ensurePhaseMap(layer);
        const phaseMap = settings.phaseMap;
        if (!phaseMap) return null;

        const gradientLUT = this.buildGradientLUT(settings, currentTick);
        // Render using phase indices
        const out = new ImageData(width, height);
        const pixels32 = new Uint32Array(out.data.buffer);
        for (let i = 0; i < phaseMap.length; i++) {
          pixels32[i] = gradientLUT[phaseMap[i]];
        }
        imageData = out;
      }

      // Preserve original alpha channel if available to avoid making index 0 fully transparent
      try {
        const original = settings.originalImageData as ImageData | undefined;
        if (original && original.data && original.data.length === imageData.data.length) {
          const data = imageData.data;
          const orig = original.data;
          // Copy alpha from original image
          for (let i = 3; i < data.length; i += 4) {
            data[i] = orig[i];
          }
        }
      } catch {}
      
      // Reduced spam - only log important events
      return imageData;
      
    } catch (error) {
      console.error('[RecolorEngine] Error rendering frame:', error);
      return null;
    }
  }

  /**
   * Ensure phase map is available for non-palette flow mappings
   */
  private ensurePhaseMap(layer: Layer): void {
    const settings = layer.colorCycleData!.recolorSettings!;
    const flowMapping = settings.flowMapping || 'palette';
    if (flowMapping === 'palette') return;

    const width = layer.imageData!.width;
    const height = layer.imageData!.height;

    // Rebuild if missing or size mismatch
    if (!settings.phaseMap || settings.phaseMap.length !== width * height) {
      if (flowMapping === 'directional') {
        const angleDeg = Number.isFinite(settings.directionAngle) ? (settings.directionAngle as number) : 0;
        const bandWidthPx = Number.isFinite(settings.bandWidthPx) && (settings.bandWidthPx as number) > 0 ? (settings.bandWidthPx as number) : 64;
        settings.phaseMap = this.buildDirectionalPhaseMap(width, height, angleDeg, bandWidthPx);
      } else if (flowMapping === 'luminance') {
        const src = settings.originalImageData || layer.imageData!;
        settings.phaseMap = this.buildLuminancePhaseMap(src);
      }
    }
  }

  private buildDirectionalPhaseMap(width: number, height: number, angleDeg: number, wavelengthPx: number): Uint8Array {
    const map = new Uint8Array(width * height);
    const theta = (angleDeg % 360) * Math.PI / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const invWave = 1 / Math.max(1e-6, wavelengthPx);
    let idx = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++, idx++) {
        const proj = x * cos + y * sin; // pixels along direction
        let phase = proj * invWave; // cycles
        phase = phase - Math.floor(phase); // 0..1
        map[idx] = Math.max(0, Math.min(255, Math.floor(phase * 256))) as number;
      }
    }
    return map;
  }

  private buildLuminancePhaseMap(img: ImageData): Uint8Array {
    const map = new Uint8Array(img.width * img.height);
    const data = img.data;
    let idx = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Rec. 709 luma approximation
      const luma = Math.max(0, Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)));
      map[idx++] = luma;
    }
    return map;
  }
  
  /**
   * Build gradient lookup table (LUT) for current animation frame
   * Maps each of the 256 palette indices to final RGBA colors
   */
  private buildGradientLUT(settings: any, tick: number): Uint32Array {
    const lut = new Uint32Array(256);
    const gradient: Array<{ position: number; color: string }> = settings?.gradient || [];
    const bands: number = Math.max(1, Math.floor(settings?.cycleColors || 16));
    const mappingMode: 'banded' | 'continuous' = settings?.mappingMode || 'banded';

    // Direction handling
    const flow: 'forward' | 'reverse' | 'pingpong' | 'bounce' = settings?.animation?.flowDirection || 'forward';
    const dirSign = flow === 'reverse' ? -1 : 1;
    const normalizedShift = dirSign * (tick / Math.max(1, bands)); // linear shift in cycles

    // Helper to reflect a value into [0,1] without wrap jumps (triangle wave)
    const reflect01 = (x: number): number => {
      const two = 2;
      let t = x % two;
      if (t < 0) t += two; // proper modulo for negatives
      return t <= 1 ? t : (two - t);
    };

    const indexPhaseMap: Uint8Array | undefined = settings?.indexPhaseMap;
    for (let i = 0; i < 256; i++) {

      // Map palette index into gradient position
      let pos: number;
      if (mappingMode === 'continuous') {
        // Sample continuously across full gradient range
        const base = indexPhaseMap ? (indexPhaseMap[i] / 255) : (i / 255);
        if (flow === 'pingpong' || flow === 'bounce') {
          pos = reflect01(base + normalizedShift);
        } else {
          const s = base + (normalizedShift % 1);
          pos = ((s % 1) + 1) % 1; // wrap forward/reverse smoothly
        }
      } else {
        // Banded: compress into cycleColors distinct bands that march over time
        let bandPos: number;
        if (indexPhaseMap) {
          const bandIndex = Math.max(0, Math.min(bands - 1, Math.floor((indexPhaseMap[i] / 255) * bands)));
          bandPos = bandIndex / bands;
        } else {
          bandPos = (i % bands) / bands; // 0..1
        }
        if (flow === 'pingpong' || flow === 'bounce') {
          pos = reflect01(bandPos + normalizedShift);
        } else {
          const s = bandPos + (normalizedShift % 1);
          pos = ((s % 1) + 1) % 1;
        }
      }

      // Keep pos strictly within [0, 1) to avoid stop boundary artifacts
      if (pos >= 1) pos = 0.999999;
      if (pos < 0) pos = 0;

      // Sample from provided gradient; fallback to white if empty
      const c = gradient.length > 0
        ? this.sampleGradient(gradient, pos)
        : { r: 255, g: 255, b: 255, a: 255 };

      lut[i] = (c.a << 24) | (c.b << 16) | (c.g << 8) | c.r;
    }
    return lut;
  }
  
  /**
   * Sample gradient at given position (0-1)
   */
  private sampleGradient(gradient: Array<{ position: number; color: string }>, position: number): {r: number, g: number, b: number, a: number} {
    if (gradient.length === 0) {
      console.warn('[RecolorEngine] sampleGradient: gradient is empty, returning white');
      return { r: 255, g: 255, b: 255, a: 255 };
    }
    
    if (gradient.length === 1) {
      return this.parseColor(gradient[0].color);
    }
    
    // Find adjacent stops
    let leftStop = gradient[0];
    let rightStop = gradient[gradient.length - 1];
    
    for (let i = 0; i < gradient.length - 1; i++) {
      if (position >= gradient[i].position && position <= gradient[i + 1].position) {
        leftStop = gradient[i];
        rightStop = gradient[i + 1];
        break;
      }
    }
    
    // Interpolate between stops
    const range = rightStop.position - leftStop.position;
    const localProgress = range > 0 ? (position - leftStop.position) / range : 0;
    
    const leftColor = this.parseColor(leftStop.color);
    const rightColor = this.parseColor(rightStop.color);
    
    return {
      r: Math.round(leftColor.r + (rightColor.r - leftColor.r) * localProgress),
      g: Math.round(leftColor.g + (rightColor.g - leftColor.g) * localProgress),
      b: Math.round(leftColor.b + (rightColor.b - leftColor.b) * localProgress),
      a: Math.round(leftColor.a + (rightColor.a - leftColor.a) * localProgress)
    };
  }
  
  /**
   * Parse CSS color string to RGBA
   */
  private parseColor(color: string): {r: number, g: number, b: number, a: number} {
    // Simple hex color parsing (extend as needed)
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b, a: 255 };
    }
    
    // Default fallback
    return { r: 255, g: 255, b: 255, a: 255 };
  }
  
  /**
   * Map index buffer to final colors using LUT
   * Core performance-critical rendering function
   */
  private mapIndicesToColors(
    indices: Uint8Array, 
    lut: Uint32Array, 
    width: number, 
    height: number
  ): ImageData {
    // Debug logs removed for performance
    
    const imageData = new ImageData(width, height);
    const pixels32 = new Uint32Array(imageData.data.buffer);
    
    // Fast 32-bit copy operation
    for (let i = 0; i < indices.length; i++) {
      pixels32[i] = lut[indices[i]];
    }
    
    return imageData;
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
   * Get or create buffer from pool for memory efficiency
   */
  private static getPooledBuffer(key: string, size: number): Uint8Array {
    const pool = this.bufferPool.get(key) || [];
    
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].length === size) {
        return pool.splice(i, 1)[0]; // Remove from pool and return
      }
    }
    
    // Create new buffer if none available
    return new Uint8Array(size);
  }
  
  /**
   * Return buffer to pool for reuse
   */
  private static returnPooledBuffer(key: string, buffer: Uint8Array): void {
    const pool = this.bufferPool.get(key) || [];
    
    if (pool.length < this.MAX_POOLED_BUFFERS) {
      // Clear buffer data for security
      buffer.fill(0);
      pool.push(buffer);
      this.bufferPool.set(key, pool);
    }
  }
  
  /**
   * Resize internal canvas
   */
  private resizeCanvas(width: number, height: number): void {
    const { canvas } = this.ensureCanvas();
    if (canvas.width !== width || canvas.height !== height) {
      (canvas as any).width = width;
      (canvas as any).height = height;
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
  }
  
  /**
   * Get processing stats for debugging
   */
  getStats(): {
    pooledBuffers: number;
    memoryUsage: number;
  } {
    let totalBuffers = 0;
    let totalMemory = 0;
    
    for (const pool of Array.from(RecolorEngine.bufferPool.values())) {
      totalBuffers += pool.length;
      for (const buffer of pool) {
        totalMemory += buffer.byteLength;
      }
    }
    
    return {
      pooledBuffers: totalBuffers,
      memoryUsage: totalMemory
    };
  }
}
