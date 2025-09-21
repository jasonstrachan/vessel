/**
 * Integration layer for color cycle system with TinyBrush application
 * Handles app store integration, UI coordination, and feature compatibility
 */

import { useAppStore } from '../../../stores/useAppStore';
import { RecolorManager, RecolorOptions } from '../RecolorManager';
import { BrowserCompat } from '../compatibility/BrowserCompat';
import { PerformanceProfiler } from '../monitoring/PerformanceProfiler';
import { Layer } from '../../../types';
// Debug logs suppressed for integration layer

export interface ColorCycleIntegrationConfig {
  autoEnablePerformanceMode: boolean;
  enableBrowserOptimizations: boolean;
  enablePerformanceMonitoring: boolean;
  maxConcurrentRecolorLayers: number;
  fallbackToCanvas2D: boolean;
}

export class AppIntegration {
  private static instance: AppIntegration;
  private recolorManager: RecolorManager;
  private browserCompat: BrowserCompat;
  private profiler: PerformanceProfiler;
  private config: ColorCycleIntegrationConfig;
  private initialized = false;

  private constructor() {
    this.recolorManager = RecolorManager.getInstance();
    this.browserCompat = BrowserCompat.getInstance();
    this.profiler = PerformanceProfiler.getInstance();
    this.config = this.generateDefaultConfig();
  }

  static getInstance(): AppIntegration {
    if (!AppIntegration.instance) {
      AppIntegration.instance = new AppIntegration();
    }
    return AppIntegration.instance;
  }

  /**
   * Initialize integration with app store
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // quiet

    try {
      // Test browser compatibility
      const compatibility = this.browserCompat.getConfig();
      if (!this.browserCompat.isFeatureSupported('canvas2d')) {
        throw new Error('Canvas2D not supported - Color cycling unavailable');
      }

      // Apply browser-specific optimizations
      if (compatibility.enableSafariWorkarounds || compatibility.enableFirefoxWorkarounds) {
        // quiet
      }

      // Setup performance monitoring if enabled
      if (this.config.enablePerformanceMonitoring) {
        this.setupPerformanceMonitoring();
      }

      // Hook into app store for automatic layer cleanup
      this.setupAppStoreHooks();

      // Setup automatic performance adjustments
      if (this.config.autoEnablePerformanceMode) {
        this.setupPerformanceMonitoring();
      }

      this.initialized = true;
      // quiet

    } catch (error) {
      console.error('❌ Failed to initialize Color Cycle Integration:', error);
      throw error;
    }
  }

  /**
   * Check if layer can be converted to recolor mode
   */
  canConvertLayer(layer: Layer): { canConvert: boolean; reason?: string } {
    if (!layer) {
      return { canConvert: false, reason: 'No layer provided' };
    }

    const canvas = layer.colorCycleData?.canvas;
    if (!canvas) {
      return { canConvert: false, reason: 'Layer has no canvas' };
    }

    if (canvas.width === 0 || canvas.height === 0) {
      return { canConvert: false, reason: 'Layer canvas has zero dimensions' };
    }

    // Check if canvas is too large for current browser
    const optimalSize = this.browserCompat.getOptimalCanvasSize({
      width: canvas.width,
      height: canvas.height
    });

    if (optimalSize.width !== canvas.width || optimalSize.height !== canvas.height) {
      return { 
        canConvert: false, 
        reason: `Canvas too large (${canvas.width}x${canvas.height}). Max supported: ${optimalSize.width}x${optimalSize.height}` 
      };
    }

    // Check memory constraints
    const memoryRequired = canvas.width * canvas.height * 4; // RGBA
    const memoryLimit = this.browserCompat.getMemoryLimit() * 1024 * 1024; // Convert MB to bytes
    
    if (memoryRequired > memoryLimit) {
      return { 
        canConvert: false, 
        reason: `Layer requires ${(memoryRequired / 1024 / 1024).toFixed(1)}MB, limit is ${(memoryLimit / 1024 / 1024).toFixed(1)}MB` 
      };
    }

    // Check concurrent layer limit
    const appState = useAppStore.getState();
    const recolorLayers = appState.layers.filter(l => 
      l.colorCycleData?.mode === 'recolor' && l.colorCycleData?.recolorSettings
    );

    if (recolorLayers.length >= this.config.maxConcurrentRecolorLayers) {
      return { 
        canConvert: false, 
        reason: `Maximum ${this.config.maxConcurrentRecolorLayers} recolor layers supported simultaneously` 
      };
    }

    return { canConvert: true };
  }

  /**
   * Get recommended settings for current browser/system
   */
  getRecommendedSettings() {
    return this.browserCompat.getRecommendedSettings();
  }

  /**
   * Convert layer with automatic optimization
   */
  async convertLayerOptimized(layer: Layer, options: Partial<RecolorOptions> = {}): Promise<void> {
    const compatibility = this.canConvertLayer(layer);
    if (!compatibility.canConvert) {
      throw new Error(`Cannot convert layer: ${compatibility.reason}`);
    }

    // Get recommended settings and merge with user options
    const recommended = this.getRecommendedSettings();
    const optimizedOptions: RecolorOptions = {
      ...options,
      quantizationMode: options.quantizationMode ?? recommended.preferredQuantization,
      ditherMode: options.ditherMode ?? (recommended.enableDithering ? 'bayer4' : 'off'),
      cycleColors: Math.min(options.cycleColors ?? 16, 32) // Cap for performance
    };

    // Profile the conversion
    const profileId = `layer_conversion_${layer.id}`;
    const canvas = layer.colorCycleData?.canvas;
    this.profiler.start(profileId, {
      layerId: layer.id,
      canvasSize: canvas ? `${canvas.width}x${canvas.height}` : 'unknown',
      options: optimizedOptions
    });

    try {
      await this.recolorManager.convertToRecolorMode(layer, optimizedOptions);
      
      this.profiler.end(profileId, { success: true });

      // Update app store to reflect the change
      this.updateAppStore(layer);

      // quiet
    } catch (error) {
      this.profiler.end(profileId, { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      
      console.error(`❌ Failed to convert layer ${layer.id}:`, error);
      throw error;
    }
  }

  /**
   * Update animation for all recolor layers
   */
  updateAllAnimations(): void {
    const appState = useAppStore.getState();
    const recolorLayers = appState.layers.filter(l => 
      l.colorCycleData?.mode === 'recolor' && 
      l.colorCycleData?.recolorSettings &&
      l.visible
    );

    const profileId = 'animation_frame_all';
    this.profiler.start(profileId, { layerCount: recolorLayers.length });

    try {
      for (const layer of recolorLayers) {
        this.recolorManager.updateAnimation(layer);
      }
      
      this.profiler.end(profileId, { success: true });
    } catch (error) {
      this.profiler.end(profileId, { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      console.error('Animation update failed:', error);
    }
  }

  /**
   * Cleanup resources for deleted layers
   */
  cleanupLayer(layerId: string): void {
    try {
      const appState = useAppStore.getState();
      const layer = appState.layers.find(l => l.id === layerId);
      
      if (layer && layer.colorCycleData?.mode === 'recolor') {
        this.recolorManager.cleanup(layer);
      }
    } catch (error) {
      console.error(`Failed to cleanup layer ${layerId}:`, error);
    }
  }

  /**
   * Get integration status and health
   */
  getStatus(): {
    initialized: boolean;
    activeRecolorLayers: number;
    memoryUsage: number;
    memoryLimit: number;
    recentPerformance: number;
    issues: string[];
    recommendations: string[];
  } {
    const appState = useAppStore.getState();
    const recolorLayers = appState.layers.filter(l => 
      l.colorCycleData?.mode === 'recolor' && l.colorCycleData?.recolorSettings
    );

    const stats = this.profiler.getCurrentStats();
    const memoryUsage = this.browserCompat.getMemoryUsage();
    const memoryLimit = this.browserCompat.getMemoryLimit() * 1024 * 1024;

    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check for issues
    if (stats.recentAverageDuration > 50) {
      issues.push('Recent operations are slow (>50ms average)');
      recommendations.push('Consider enabling performance mode');
    }

    if (memoryUsage > memoryLimit * 0.8) {
      issues.push('High memory usage detected');
      recommendations.push('Reduce number of recolor layers or canvas sizes');
    }

    if (recolorLayers.length > this.config.maxConcurrentRecolorLayers) {
      issues.push(`Too many recolor layers (${recolorLayers.length}/${this.config.maxConcurrentRecolorLayers})`);
      recommendations.push('Convert some layers back to normal mode');
    }

    return {
      initialized: this.initialized,
      activeRecolorLayers: recolorLayers.length,
      memoryUsage,
      memoryLimit,
      recentPerformance: stats.recentAverageDuration,
      issues,
      recommendations
    };
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport(): string {
    const report = this.profiler.generateReport('color_cycle');
    return PerformanceProfiler.formatReport(report);
  }

  /**
   * Setup app store hooks for automatic cleanup
   */
  private setupAppStoreHooks(): void {
    // We'll need to hook into layer deletion somehow
    // This would typically be done through the app store's layer management
    // quiet
  }

  /**
   * Update app store after layer conversion
   */
  private updateAppStore(layer: Layer): void {
    // Trigger a state update to reflect the layer changes
    const appState = useAppStore.getState();
    const updatedLayers = appState.layers.map(l =>
      l.id === layer.id ? layer : l
    );

    if (appState.setLayers) {
      appState.setLayers(updatedLayers);
    }
  }

  /**
   * Setup performance monitoring
   */
  private setupPerformanceMonitoring(): void {
    // Monitor frame rates and adjust quality automatically
    let frameCount = 0;
    let lastFrameTime = performance.now();

    const monitorFrame = () => {
      const currentTime = performance.now();
      const deltaTime = currentTime - lastFrameTime;
      
      frameCount++;
      
      if (frameCount % 60 === 0) { // Check every 60 frames
        const avgFrameTime = deltaTime / 60;
        
        if (avgFrameTime > 33) { // > 30 FPS
          console.warn('🐌 Low FPS detected, consider performance optimizations');
          this.adjustPerformanceSettings(false); // Reduce quality
        } else if (avgFrameTime < 16) { // < 60 FPS with headroom
          this.adjustPerformanceSettings(true); // Increase quality
        }
        
        frameCount = 0;
      }
      
      lastFrameTime = currentTime;
      requestAnimationFrame(monitorFrame);
    };

    requestAnimationFrame(monitorFrame);
  }

  /**
   * Adjust performance settings based on monitoring
   */
  private adjustPerformanceSettings(increaseQuality: boolean): void {
    const appState = useAppStore.getState();
    const recolorLayers = appState.layers.filter(l => 
      l.colorCycleData?.mode === 'recolor' && l.colorCycleData?.recolorSettings
    );

    for (const layer of recolorLayers) {
      if (!layer.colorCycleData?.recolorSettings) continue;

      const settings = layer.colorCycleData.recolorSettings;
      
      if (!increaseQuality && settings.animation.fps > 15) {
        // Reduce FPS to improve performance
        settings.animation.fps = Math.max(15, settings.animation.fps - 5);
      } else if (increaseQuality && settings.animation.fps < 30) {
        // Increase FPS when performance allows
        settings.animation.fps = Math.min(30, settings.animation.fps + 5);
      }
    }
  }

  /**
   * Generate default configuration
   */
  private generateDefaultConfig(): ColorCycleIntegrationConfig {
    const browserSupport = this.browserCompat.getRecommendedSettings();
    
    return {
      autoEnablePerformanceMode: !this.browserCompat.isFeatureSupported('memory-api'),
      enableBrowserOptimizations: true,
      enablePerformanceMonitoring: this.browserCompat.isFeatureSupported('high-res-timer'),
      maxConcurrentRecolorLayers: browserSupport.maxConcurrentLayers,
      fallbackToCanvas2D: !this.browserCompat.isFeatureSupported('webgl')
    };
  }
}
