/**
 * RecolorManager - Main interface for the Recolor & Animate feature
 * Coordinates between RecolorEngine, RecolorAnimationController, and the UI
 * Provides a simplified API for the application to use
 */

import { RecolorEngine } from './RecolorEngine';
import { RecolorAnimationController } from './RecolorAnimationController';
import { GradientBuilder, GradientOptions } from './gradients/GradientBuilder';
import { OKLabConverter, ColorAnalysis } from './colorSpace/OKLabConverter';
import type { Layer } from '../../types';

export interface RecolorOptions {
  quantizationMode?: 'rgb332' | 'oklab-median-cut';
  ditherMode?: 'off' | 'bayer4' | 'bayer8';
  cycleColors?: number;
  gradientPreset?: 'rainbow' | 'fire' | 'ocean' | 'sunset' | 'custom';
  customGradient?: Array<{ position: number; color: string }>;
}

export interface ExtractColorsOptions {
  method: 'fast' | 'quality' | 'oklab';
  gradientStops: number; // 4-32 colors
  buildMode: 'dominant' | 'full-range' | 'perceptual';
  sortBy: 'hue' | 'luminance' | 'saturation' | 'perceptual';
  colorSpace?: 'rgb' | 'oklab';
  minColorDifference?: number;
  preserveOriginalColors?: boolean;
  gradientOptions?: Partial<GradientOptions>;
}

/**
 * Main manager class for the Recolor & Animate feature
 * Singleton pattern - use RecolorManager.getInstance()
 */
export class RecolorManager {
  private static instance: RecolorManager | null = null;
  
  private engine: RecolorEngine;
  private animationController: RecolorAnimationController;
  private gradientBuilder: GradientBuilder = new GradientBuilder();
  
  // UI callbacks
  private layerUpdateCallbacks: Set<(layer: Layer) => void> = new Set();
  private statsCallbacks: Set<(stats: any) => void> = new Set();
  
  private constructor() {
    this.engine = new RecolorEngine();
    this.animationController = new RecolorAnimationController();
    
    // Listen to animation updates
    this.animationController.onFrame((layers, stats) => {
      // Notify UI of layer updates
      layers.forEach(animatedLayer => {
        this.layerUpdateCallbacks.forEach(callback => {
          callback(animatedLayer.layer);
        });
      });
      
      // Notify UI of stats updates
      this.statsCallbacks.forEach(callback => {
        callback(stats);
      });
    });
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): RecolorManager {
    if (!this.instance) {
      this.instance = new RecolorManager();
    }
    return this.instance;
  }
  
  /**
   * Convert layer to recolor mode (alias for processLayer)
   */
  async convertToRecolorMode(layer: Layer, options: RecolorOptions = {}): Promise<void> {
    const success = await this.processLayer(layer, options);
    if (!success) {
      throw new Error(`Failed to convert layer ${layer.id} to recolor mode`);
    }
  }

  /**
   * Convert a layer to recolor mode
   * Main entry point for the "Recolor & Animate" feature
   */
  async processLayer(layer: Layer, options: RecolorOptions = {}): Promise<boolean> {
    try {
      console.log(`[RecolorManager] Processing layer ${layer.id} for recolor animation`);
      
      // Ensure we have up-to-date pixel data. If the ImageData is empty or stale,
      // try to grab it from the layer's framebuffer (OffscreenCanvas) first.
      const ensureImageData = (): boolean => {
        const looksEmpty = (img?: ImageData | null) => {
          if (!img) return true;
          const { data, width, height } = img;
          if (width === 0 || height === 0) return true;
          // Sample alpha across the image on a coarse grid to avoid top-left bias
          const samples = 400; // up to 400 alpha checks
          const stepX = Math.max(1, Math.floor(width / 20));
          const stepY = Math.max(1, Math.floor(height / 20));
          let checked = 0;
          for (let y = 0; y < height && checked < samples; y += stepY) {
            for (let x = 0; x < width && checked < samples; x += stepX) {
              const idx = (y * width + x) * 4 + 3; // alpha channel
              if (data[idx] !== 0) return false;
              checked++;
            }
          }
          return true;
        };

        if (!layer.imageData || looksEmpty(layer.imageData)) {
          try {
            const fb = layer.framebuffer as OffscreenCanvas | undefined;
            if (fb) {
              const ctx = fb.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
              if (ctx) {
                const captured = ctx.getImageData(0, 0, fb.width as number, fb.height as number);
                // Accept if captured has any alpha > 0 in small sample
                if (!looksEmpty(captured)) {
                  layer.imageData = captured;
                  return true;
                }
              }
            }
          } catch (e) {
            console.warn('[RecolorManager] Failed to capture imageData from framebuffer:', e);
          }
        }
        return !!layer.imageData && layer.imageData.data.length > 0;
      };

      if (!ensureImageData()) {
        throw new Error('Layer has no image data to process');
      }
      
      // Set layer to color-cycle mode with recolor submode
      layer.layerType = 'color-cycle';
      if (!layer.colorCycleData) {
        layer.colorCycleData = {};
      }
      layer.colorCycleData.mode = 'recolor';
      
      // Process layer through engine
      const success = this.engine.processLayer(layer, options);
      
      if (success) {
        // Register with animation controller and render an initial frame immediately
        this.animationController.registerLayer(layer);
        // Draw one frame so the user sees recoloring even before animation starts
        try {
          this.animationController.updateLayer(layer);
        } catch (e) {
          console.warn('[RecolorManager] Initial frame update failed:', e);
        }
        console.log(`[RecolorManager] Successfully processed layer ${layer.id}`);
        
        // Notify UI
        this.layerUpdateCallbacks.forEach(callback => callback(layer));
        
        return true;
      } else {
        throw new Error('Engine failed to process layer');
      }
      
    } catch (error) {
      console.error(`[RecolorManager] Failed to process layer ${layer.id}:`, error);
      return false;
    }
  }
  
  /**
   * Enhanced color extraction with OKLab analysis and intelligent gradient building
   */
  async extractColors(layer: Layer, options: ExtractColorsOptions): Promise<Array<{ position: number; color: string }> | null> {
    try {
      if (!layer.imageData) {
        throw new Error('No image data available for color extraction');
      }

      const startTime = performance.now();
      
      // Configure gradient builder based on options
      if (options.gradientOptions) {
        this.gradientBuilder.updateOptions(options.gradientOptions);
      }
      
      let extractedColors: Array<{ color: string; frequency?: number }> = [];
      
      if (options.method === 'oklab' || options.colorSpace === 'oklab') {
        // Use OKLab-based extraction for perceptual accuracy
        const analysis = OKLabConverter.analyzeImageColors(layer.imageData, 2000);
        
        if (options.buildMode === 'perceptual') {
          // Generate perceptually uniform palette
          const oklabPalette = OKLabConverter.generatePalette(
            analysis.dominantColors,
            options.gradientStops,
            {
              brightnessRange: [0.15, 0.85],
              chromaRange: [0.02, 0.25],
              preserveHue: options.preserveOriginalColors || false
            }
          );
          
          const rgbColors = OKLabConverter.batchOKLabToRGB(oklabPalette);
          extractedColors = rgbColors.map(rgb => ({
            color: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
            frequency: 1
          }));
          
        } else if (options.buildMode === 'dominant') {
          // Use dominant colors from analysis
          const rgbColors = OKLabConverter.batchOKLabToRGB(analysis.dominantColors);
          extractedColors = rgbColors.map(rgb => ({
            color: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
            frequency: 1
          }));
          
        } else {
          // Full range sampling
          extractedColors = await this.extractFullRangeColors(layer.imageData, options);
        }
        
      } else if (options.method === 'quality') {
        // Use advanced RGB-based extraction with clustering
        extractedColors = await this.extractQualityColors(layer.imageData, options);
        
      } else {
        // Fast extraction using simple sampling
        extractedColors = await this.extractFastColors(layer.imageData, options);
      }
      
      // Build gradient using GradientBuilder
      const gradientStops = this.gradientBuilder.buildGradient(extractedColors, options.gradientStops);
      
      const processingTime = performance.now() - startTime;
      console.log(`[RecolorManager] Color extraction completed in ${processingTime.toFixed(1)}ms`);
      console.log(`[RecolorManager] Generated ${gradientStops.length} gradient stops from ${extractedColors.length} extracted colors`);
      
      // Analyze gradient quality
      const analysis = this.gradientBuilder.analyzeGradient(gradientStops);
      console.log(`[RecolorManager] Gradient analysis:`, {
        quality: analysis.quality.toFixed(2),
        harmony: analysis.harmony,
        smoothness: analysis.smoothness.toFixed(2),
        contrast: analysis.contrast.toFixed(2)
      });
      
      // Convert to the expected format
      return gradientStops.map(stop => ({
        position: stop.position,
        color: stop.color
      }));
      
    } catch (error) {
      console.error('[RecolorManager] Color extraction failed:', error);
      return this.getFallbackGradient(options.gradientStops);
    }
  }
  
  /**
   * Extract colors using full range sampling in OKLab space
   */
  private async extractFullRangeColors(
    imageData: ImageData, 
    options: ExtractColorsOptions
  ): Promise<Array<{ color: string; frequency: number }>> {
    const { data, width, height } = imageData;
    const colorCounts = new Map<string, number>();
    
    // Sample pixels uniformly across the image
    const stepX = Math.max(1, Math.floor(width / Math.sqrt(options.gradientStops * 8)));
    const stepY = Math.max(1, Math.floor(height / Math.sqrt(options.gradientStops * 8)));
    
    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        
        if (a >= 128) {
          const colorKey = `rgb(${r}, ${g}, ${b})`;
          colorCounts.set(colorKey, (colorCounts.get(colorKey) || 0) + 1);
        }
      }
    }
    
    // Convert to array and sort by frequency
    const colorArray = Array.from(colorCounts.entries()).map(([color, frequency]) => ({
      color,
      frequency
    }));
    
    colorArray.sort((a, b) => b.frequency - a.frequency);
    
    return colorArray.slice(0, options.gradientStops * 2); // Get more than needed for filtering
  }
  
  /**
   * Quality color extraction using clustering
   */
  private async extractQualityColors(
    imageData: ImageData,
    options: ExtractColorsOptions
  ): Promise<Array<{ color: string; frequency: number }>> {
    // Simplified implementation - could be enhanced with k-means clustering
    return this.extractFastColors(imageData, options);
  }
  
  /**
   * Fast color extraction using simple sampling
   */
  private async extractFastColors(
    imageData: ImageData,
    options: ExtractColorsOptions
  ): Promise<Array<{ color: string; frequency: number }>> {
    const { data } = imageData;
    const colorCounts = new Map<string, number>();
    
    // Sample every 10th pixel for speed
    for (let i = 0; i < data.length; i += 40) { // Skip 10 pixels (4 bytes each)
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      
      if (a >= 128) {
        const colorKey = `rgb(${r}, ${g}, ${b})`;
        colorCounts.set(colorKey, (colorCounts.get(colorKey) || 0) + 1);
      }
    }
    
    // Convert to array and sort by frequency
    const colorArray = Array.from(colorCounts.entries()).map(([color, frequency]) => ({
      color,
      frequency
    }));
    
    colorArray.sort((a, b) => b.frequency - a.frequency);
    
    return colorArray.slice(0, options.gradientStops);
  }
  
  /**
   * Get fallback gradient when extraction fails
   */
  private getFallbackGradient(stops: number): Array<{ position: number; color: string }> {
    const rainbowColors = ['#ff0000', '#ff8000', '#ffff00', '#00ff00', '#0080ff', '#8000ff', '#ff0000'];
    
    const gradient: Array<{ position: number; color: string }> = [];
    
    for (let i = 0; i < stops; i++) {
      const position = i / (stops - 1);
      const colorIndex = position * (rainbowColors.length - 1);
      const lowerIndex = Math.floor(colorIndex);
      const upperIndex = Math.min(rainbowColors.length - 1, Math.ceil(colorIndex));
      
      const color = lowerIndex === upperIndex 
        ? rainbowColors[lowerIndex]
        : rainbowColors[lowerIndex]; // Could interpolate here
      
      gradient.push({ position, color });
    }
    
    return gradient;
  }
  
  /**
   * Analyze colors in a layer using OKLab
   */
  analyzeLayerColors(layer: Layer): ColorAnalysis | null {
    if (!layer.imageData) return null;
    
    try {
      return OKLabConverter.analyzeImageColors(layer.imageData);
    } catch (error) {
      console.error('[RecolorManager] Color analysis failed:', error);
      return null;
    }
  }
  
  /**
   * Update animation for a specific layer
   */
  updateAnimation(layer: Layer): void {
    if (layer.layerType === 'color-cycle' && 
        layer.colorCycleData?.mode === 'recolor' &&
        layer.colorCycleData?.recolorSettings?.animation.isPlaying) {
      this.animationController.updateLayer(layer);
    }
  }

  /**
   * Update gradient for a recolor layer
   */
  updateGradient(layer: Layer, gradient: Array<{ position: number; color: string }>): boolean {
    if (layer.layerType !== 'color-cycle' || 
        layer.colorCycleData?.mode !== 'recolor') {
      return false;
    }
    
    return this.engine.updateGradient(layer, gradient);
  }
  
  /**
   * Animation controls
   */
  playAll(): void {
    this.animationController.playAll();
  }
  
  playSingle(layerId: string): void {
    this.animationController.playSingle(layerId);
  }
  
  stop(): void {
    this.animationController.stop();
  }
  
  pause(): void {
    this.animationController.pause();
  }
  
  resume(): void {
    this.animationController.resume();
  }
  
  toggle(): void {
    this.animationController.toggle();
  }
  
  /**
   * Settings controls
   */
  setFPS(fps: number): void {
    this.animationController.setFPS(fps);
  }
  
  setLayerSpeed(layerId: string, speed: number): boolean {
    return this.animationController.setLayerSpeed(layerId, speed);
  }
  
  setLayerCycleColors(layerId: string, cycleColors: number): boolean {
    const layers = this.animationController.getLayers();
    const animatedLayer = layers.find(l => l.layer.id === layerId);
    
    if (animatedLayer?.layer.colorCycleData?.recolorSettings) {
      animatedLayer.layer.colorCycleData.recolorSettings.cycleColors = cycleColors;
      return true;
    }
    
    return false;
  }
  
  setLayerFlowDirection(layerId: string, direction: 'forward' | 'reverse' | 'pingpong' | 'bounce'): boolean {
    const layers = this.animationController.getLayers();
    const animatedLayer = layers.find(l => l.layer.id === layerId);
    
    if (animatedLayer?.layer.colorCycleData?.recolorSettings) {
      animatedLayer.layer.colorCycleData.recolorSettings.animation.flowDirection = direction;
      return true;
    }
    
    return false;
  }
  
  /**
   * Layer management
   */
  enableLayer(layerId: string, enabled: boolean = true): boolean {
    return this.animationController.setLayerEnabled(layerId, enabled);
  }
  
  removeLayer(layerId: string): boolean {
    return this.animationController.unregisterLayer(layerId);
  }
  
  /**
   * Get list of recolor layers
   */
  getRecolorLayers(): Layer[] {
    return this.animationController.getLayers().map(al => al.layer);
  }
  
  /**
   * Check if animation is playing
   */
  isAnimating(): boolean {
    return this.animationController.isAnimating();
  }
  
  /**
   * Get performance statistics
   */
  getStats(): any {
    return this.animationController.getStats();
  }
  
  /**
   * Convert layer back to normal mode
   */
  convertToNormal(layer: Layer): boolean {
    try {
      // Remove from animation controller
      this.animationController.unregisterLayer(layer.id);
      
      // Clear recolor data but preserve original image
      if (layer.colorCycleData?.recolorSettings?.originalImageData) {
        layer.imageData = layer.colorCycleData.recolorSettings.originalImageData;
      }
      
      // Reset layer type
      layer.layerType = 'normal';
      layer.colorCycleData = undefined;
      
      console.log(`[RecolorManager] Converted layer ${layer.id} back to normal`);
      
      // Notify UI
      this.layerUpdateCallbacks.forEach(callback => callback(layer));
      
      return true;
      
    } catch (error) {
      console.error(`[RecolorManager] Failed to convert layer ${layer.id} to normal:`, error);
      return false;
    }
  }
  
  /**
   * UI callback registration
   */
  onLayerUpdate(callback: (layer: Layer) => void): void {
    this.layerUpdateCallbacks.add(callback);
  }
  
  offLayerUpdate(callback: (layer: Layer) => void): void {
    this.layerUpdateCallbacks.delete(callback);
  }
  
  onStatsUpdate(callback: (stats: any) => void): void {
    this.statsCallbacks.add(callback);
  }
  
  offStatsUpdate(callback: (stats: any) => void): void {
    this.statsCallbacks.delete(callback);
  }
  
  /**
   * Cleanup resources for a specific layer
   */
  cleanup(layer: Layer): void {
    if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor') {
      this.animationController.unregisterLayer(layer.id);
      console.log(`[RecolorManager] Cleaned up resources for layer ${layer.id}`);
    }
  }

  /**
   * Cleanup all resources
   */
  cleanupAll(): void {
    this.animationController.cleanup();
    this.layerUpdateCallbacks.clear();
    this.statsCallbacks.clear();
    
    // Reset singleton
    RecolorManager.instance = null;
    
    console.log('[RecolorManager] Cleaned up all resources');
  }
  
  /**
   * Get version info for debugging
   */
  getVersion(): string {
    return '1.0.0-phase1';
  }
  
  /**
   * Check if a layer can be processed for recoloring
   */
  canProcessLayer(layer: Layer): { canProcess: boolean; reason?: string } {
    if (!layer.imageData || layer.imageData.data.length === 0) {
      return { canProcess: false, reason: 'Layer has no image data' };
    }
    
    if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'brush') {
      return { canProcess: false, reason: 'Layer is already in brush color-cycle mode' };
    }
    
    // Check image size limits (for performance)
    const pixelCount = layer.imageData.width * layer.imageData.height;
    if (pixelCount > 4096 * 4096) {
      return { canProcess: false, reason: 'Image too large (max 4096x4096)' };
    }
    
    return { canProcess: true };
  }
}
