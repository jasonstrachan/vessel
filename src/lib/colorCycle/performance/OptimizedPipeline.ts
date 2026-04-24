/**
 * OptimizedPipeline - High-performance rendering coordinator
 * 
 * Orchestrates the entire color cycle rendering pipeline with automatic
 * optimization, load balancing, and performance monitoring integration.
 */

import { logError } from '@/utils/debug';
import { HotPathRenderer } from '../rendering/HotPathRenderer';
import { FastGradientLUT } from '../rendering/FastGradientLUT';
import { MemoryPool } from '../memory/MemoryPool';
import { CacheManager } from '../memory/CacheManager';
import { PerformanceMonitor } from './PerformanceMonitor';
import type { Layer } from '../../../types';
import type { PerformanceReport as MonitorReport } from './PerformanceMonitor';
import type { MemoryStats } from '../memory/MemoryPool';

type RendererStats = ReturnType<HotPathRenderer['getStats']>;
type CacheMetricsSnapshot = ReturnType<CacheManager['getStats']>;

interface PipelinePerformanceSnapshot {
  pipeline: PipelineStats;
  renderer: RendererStats;
  memory: MemoryStats;
  cache: CacheMetricsSnapshot;
  performance: MonitorReport;
}

export interface PipelineConfig {
  enableAdaptiveQuality: boolean;
  enableBatching: boolean;
  enablePrecomputation: boolean;
  maxBatchSize: number;
  qualityThresholds: {
    targetFrameTime: number; // ms
    degradeThreshold: number; // ms
    recoverThreshold: number; // ms
  };
  memoryLimits: {
    softLimit: number; // bytes
    hardLimit: number; // bytes
  };
}

export interface RenderRequest {
  layer: Layer;
  animationOffset: number;
  priority: 'high' | 'normal' | 'low';
  requiresUpdate: boolean;
}

export interface PipelineStats {
  layersRendered: number;
  totalPixelsProcessed: number;
  averageFrameTime: number;
  cacheHitRate: number;
  memoryUsage: number;
  qualityLevel: 'full' | 'half' | 'quarter';
}

/**
 * Batch processing coordinator for multiple layers
 */
class BatchProcessor {
  private pendingHighPriority: RenderRequest[] = [];
  private pendingNormalLow: RenderRequest[] = [];
  private pendingHighHead = 0;
  private pendingNormalLowHead = 0;
  private isProcessing = false;
  private config: PipelineConfig;
  private readonly COMPACT_INTERVAL = 1024;
  
  constructor(config: PipelineConfig) {
    this.config = config;
  }
  
  /**
   * Add render request to batch
   */
  addRequest(request: RenderRequest): void {
    if (request.priority === 'high') {
      this.pendingHighPriority.push(request);
    } else {
      this.pendingNormalLow.push(request);
    }
    
    // Start processing if not already running
    if (!this.isProcessing && this.config.enableBatching) {
      this.scheduleProcessing();
    }
  }
  
  /**
   * Process requests immediately (for real-time rendering)
   */
  processImmediate(requests: RenderRequest[]): Promise<void> {
    return this.processBatch(requests);
  }
  
  /**
   * Schedule batch processing
   */
  private scheduleProcessing(): void {
    requestIdleCallback(() => {
      this.processPendingRequests();
    });
  }
  
  /**
   * Process all pending requests
   */
  private async processPendingRequests(): Promise<void> {
    if (this.isProcessing || this.pendingCount() === 0) {
      return;
    }
    
    this.isProcessing = true;
    
    try {
      const batch = this.takeBatch(this.config.maxBatchSize);
      await this.processBatch(batch);

      // Continue processing if more requests are pending
      if (this.pendingCount() > 0) {
        this.scheduleProcessing();
      }
      
    } finally {
      this.isProcessing = false;
    }
  }

  private pendingCount(): number {
    return (
      (this.pendingHighPriority.length - this.pendingHighHead) +
      (this.pendingNormalLow.length - this.pendingNormalLowHead)
    );
  }

  private compactQueueIfNeeded(queue: RenderRequest[], head: number): number {
    if (head <= this.COMPACT_INTERVAL || head <= queue.length / 2) {
      return head;
    }
    queue.splice(0, head);
    return 0;
  }

  private shiftHighPriority(): RenderRequest | null {
    if (this.pendingHighHead >= this.pendingHighPriority.length) {
      return null;
    }
    const request = this.pendingHighPriority[this.pendingHighHead];
    this.pendingHighHead += 1;
    this.pendingHighHead = this.compactQueueIfNeeded(this.pendingHighPriority, this.pendingHighHead);
    return request;
  }

  private shiftNormalLow(): RenderRequest | null {
    if (this.pendingNormalLowHead >= this.pendingNormalLow.length) {
      return null;
    }
    const request = this.pendingNormalLow[this.pendingNormalLowHead];
    this.pendingNormalLowHead += 1;
    this.pendingNormalLowHead = this.compactQueueIfNeeded(this.pendingNormalLow, this.pendingNormalLowHead);
    return request;
  }

  private shiftNext(): RenderRequest | null {
    return this.shiftHighPriority() ?? this.shiftNormalLow();
  }

  private takeBatch(maxSize: number): RenderRequest[] {
    const safeMaxSize = Math.max(1, Math.round(maxSize));
    const batch: RenderRequest[] = [];
    while (batch.length < safeMaxSize) {
      const next = this.shiftNext();
      if (!next) {
        break;
      }
      batch.push(next);
    }
    return batch;
  }
  
  /**
   * Process a batch of render requests
   */
  private async processBatch(requests: RenderRequest[]): Promise<void> {
    // Group requests by similar properties for efficiency
    const groups = this.groupRequests(requests);
    
    for (const group of groups) {
      await this.processGroup(group);
    }
  }
  
  /**
   * Group requests by compatible rendering parameters
   */
  private groupRequests(requests: RenderRequest[]): RenderRequest[][] {
    const groups: RenderRequest[][] = [];
    const processed = new Set<number>();
    
    for (let i = 0; i < requests.length; i++) {
      if (processed.has(i)) continue;
      
      const group: RenderRequest[] = [requests[i]];
      processed.add(i);
      
      // Find compatible requests
      for (let j = i + 1; j < requests.length; j++) {
        if (processed.has(j)) continue;
        
        if (this.areRequestsCompatible(requests[i], requests[j])) {
          group.push(requests[j]);
          processed.add(j);
        }
      }
      
      groups.push(group);
    }
    
    return groups;
  }
  
  /**
   * Check if two requests can be processed together
   */
  private areRequestsCompatible(a: RenderRequest, b: RenderRequest): boolean {
    // Requests are compatible if they have similar:
    // - Image dimensions
    // - Cycle colors count
    // - Quality requirements
    
    const aSettings = a.layer.colorCycleData?.recolorSettings;
    const bSettings = b.layer.colorCycleData?.recolorSettings;
    
    if (!aSettings || !bSettings) return false;
    
    return aSettings.cycleColors === bSettings.cycleColors &&
           aSettings.currentLOD === bSettings.currentLOD &&
           aSettings.ditherMode === bSettings.ditherMode;
  }
  
  /**
   * Process a compatible group of requests
   */
  private async processGroup(group: RenderRequest[]): Promise<void> {
    if (group.length === 0) {
      return;
    }
    // Implementation would coordinate actual rendering
    // This is a placeholder for the actual rendering logic
  }
}

/**
 * Adaptive quality manager
 */
class QualityManager {
  private config: PipelineConfig;
  private currentQuality: 'full' | 'half' | 'quarter' = 'full';
  private recentFrameTimes: number[] = new Array(10);
  private recentFrameTimesCount = 0;
  private recentFrameTimesHead = 0;
  private readonly FRAME_TIME_HISTORY = 10;
  
  constructor(config: PipelineConfig) {
    this.config = config;
  }
  
  /**
   * Update quality based on performance
   */
  updateQuality(frameTime: number): 'full' | 'half' | 'quarter' {
    const insertIndex = (this.recentFrameTimesHead + this.recentFrameTimesCount) % this.FRAME_TIME_HISTORY;
    this.recentFrameTimes[insertIndex] = frameTime;
    if (this.recentFrameTimesCount < this.FRAME_TIME_HISTORY) {
      this.recentFrameTimesCount += 1;
    } else {
      this.recentFrameTimesHead = (this.recentFrameTimesHead + 1) % this.FRAME_TIME_HISTORY;
    }

    let total = 0;
    for (let i = 0; i < this.recentFrameTimesCount; i += 1) {
      const index = (this.recentFrameTimesHead + i) % this.FRAME_TIME_HISTORY;
      total += this.recentFrameTimes[index];
    }
    const avgFrameTime = total / Math.max(1, this.recentFrameTimesCount);
    
    // Degrade quality if performance is poor
    if (avgFrameTime > this.config.qualityThresholds.degradeThreshold) {
      if (this.currentQuality === 'full') {
        this.currentQuality = 'half';
      } else if (this.currentQuality === 'half') {
        this.currentQuality = 'quarter';
      }
    }
    // Improve quality if performance is good
    else if (avgFrameTime < this.config.qualityThresholds.recoverThreshold) {
      if (this.currentQuality === 'quarter') {
        this.currentQuality = 'half';
      } else if (this.currentQuality === 'half') {
        this.currentQuality = 'full';
      }
    }
    
    return this.currentQuality;
  }
  
  /**
   * Get current quality level
   */
  getCurrentQuality(): 'full' | 'half' | 'quarter' {
    return this.currentQuality;
  }
  
  /**
   * Force quality level (for manual override)
   */
  setQuality(quality: 'full' | 'half' | 'quarter'): void {
    this.currentQuality = quality;
  }
}

/**
 * Main optimized rendering pipeline
 */
export class OptimizedPipeline {
  private static instance: OptimizedPipeline | null = null;
  
  private config: PipelineConfig;
  private hotPathRenderer: HotPathRenderer;
  private gradientLUT: FastGradientLUT;
  private memoryPool: MemoryPool;
  private cacheManager: CacheManager;
  private performanceMonitor: PerformanceMonitor;
  
  private batchProcessor: BatchProcessor;
  private qualityManager: QualityManager;
  
  // Statistics
  private stats: PipelineStats = {
    layersRendered: 0,
    totalPixelsProcessed: 0,
    averageFrameTime: 0,
    cacheHitRate: 0,
    memoryUsage: 0,
    qualityLevel: 'full'
  };
  
  private constructor(config: Partial<PipelineConfig> = {}) {
    this.config = {
      enableAdaptiveQuality: true,
      enableBatching: true,
      enablePrecomputation: true,
      maxBatchSize: 8,
      qualityThresholds: {
        targetFrameTime: 16.67, // 60 FPS
        degradeThreshold: 25, // 40 FPS
        recoverThreshold: 12 // 83 FPS
      },
      memoryLimits: {
        softLimit: 256 * 1024 * 1024, // 256MB
        hardLimit: 512 * 1024 * 1024  // 512MB
      },
      ...config
    };
    
    this.hotPathRenderer = new HotPathRenderer();
    this.gradientLUT = new FastGradientLUT();
    this.memoryPool = MemoryPool.getInstance();
    this.cacheManager = CacheManager.getInstance();
    this.performanceMonitor = PerformanceMonitor.getInstance({
      enableDetailedMetrics: true,
      enableProfiling: true
    });
    
    this.batchProcessor = new BatchProcessor(this.config);
    this.qualityManager = new QualityManager(this.config);
    
    this.setupPerformanceIntegration();
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<PipelineConfig>): OptimizedPipeline {
    if (!this.instance) {
      this.instance = new OptimizedPipeline(config);
    }
    return this.instance;
  }
  
  /**
   * Render a single layer (high-performance path)
   */
  async renderLayer(layer: Layer, animationOffset: number): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
    const perfMonitor = this.performanceMonitor;
    
    perfMonitor.startFrame();
    perfMonitor.startRender();
    
    try {
      const recolorSettings = layer.colorCycleData?.recolorSettings;
      if (!recolorSettings?.indexBuffer || !recolorSettings.palette) {
        return null;
      }
      
      // Get or create rendering context
      const context = this.hotPathRenderer.acquireContext(
        layer.id,
        layer.imageData!.width,
        layer.imageData!.height
      );
      
      // Build gradient LUT (cached)
      const lutKey = this.buildGradientLUTKey(layer, animationOffset);
      const gradientLUT = this.cacheManager.getGradientLUT(lutKey, () => {
        const start = performance.now();
        const lut = this.gradientLUT.buildAnimatedLUT(
          recolorSettings.gradient.map(stop => ({
            position: stop.position,
            color: FastGradientLUT.parseColor(stop.color)
          })),
          animationOffset,
          {
            size: 256,
            cycleColors: recolorSettings.cycleColors,
            interpolationMode: 'linear'
          }
        );
        const computeTime = performance.now() - start;
        return { lut, computeTime };
      });
      
      // Fast remap using optimized renderer
      this.hotPathRenderer.fastRemapAnimated(
        recolorSettings.indexBuffer,
        gradientLUT,
        animationOffset,
        recolorSettings.cycleColors,
        context,
        recolorSettings.animation.flowDirection === 'reverse' ? 'reverse' : 'forward'
      );
      
      // Commit to canvas
      this.hotPathRenderer.commitToCanvas(context);
      
      // Update statistics
      this.stats.layersRendered++;
      this.stats.totalPixelsProcessed += layer.imageData!.width * layer.imageData!.height;
      
      perfMonitor.endRender();
      
      const canvas = this.hotPathRenderer.getCanvas(layer.id);
      
      perfMonitor.endFrame(1, layer.imageData!.width * layer.imageData!.height);
      
      return canvas;
      
    } catch (error) {
      logError('[OptimizedPipeline] Error rendering layer:', error);
      perfMonitor.endFrame(1, 0, true); // Mark as dropped frame
      return null;
    }
  }
  
  /**
   * Render multiple layers (batch processing)
   */
  async renderLayers(layers: Layer[], animationOffsets: number[]): Promise<(HTMLCanvasElement | OffscreenCanvas | null)[]> {
    const perfMonitor = this.performanceMonitor;
    
    perfMonitor.startFrame();
    
    try {
      const requests: RenderRequest[] = layers.map((layer, index) => ({
        layer,
        animationOffset: animationOffsets[index] || 0,
        priority: 'normal',
        requiresUpdate: true
      }));
      
      const results: (HTMLCanvasElement | OffscreenCanvas | null)[] = [];
      
      // Process in batches if enabled
      if (this.config.enableBatching && requests.length > 1) {
        await this.batchProcessor.processImmediate(requests);
        
        // Collect results (this would be implemented by the batch processor)
        for (const request of requests) {
          const canvas = await this.renderLayer(request.layer, request.animationOffset);
          results.push(canvas);
        }
      } else {
        // Process individually
        for (const request of requests) {
          const canvas = await this.renderLayer(request.layer, request.animationOffset);
          results.push(canvas);
        }
      }
      
      // Update quality based on performance
      const frameTime = performance.now() - perfMonitor['frameStartTime'];
      this.stats.qualityLevel = this.qualityManager.updateQuality(frameTime);
      
      perfMonitor.endFrame(
        layers.length,
        layers.reduce((sum, layer) => sum + (layer.imageData?.width || 0) * (layer.imageData?.height || 0), 0)
      );
      
      return results;
      
    } catch (error) {
      logError('[OptimizedPipeline] Error rendering layers:', error);
      perfMonitor.endFrame(layers.length, 0, true);
      return layers.map(() => null);
    }
  }
  
  /**
   * Precompute animation frames for smooth playback
   */
  async precomputeAnimation(layer: Layer, frameCount: number = 60): Promise<void> {
    if (!this.config.enablePrecomputation) return;
    
    const recolorSettings = layer.colorCycleData?.recolorSettings;
    if (!recolorSettings) return;
    
    const key = `precomputed_${layer.id}_${frameCount}`;
    
    this.cacheManager.getPrecomputedAnimation(key, () => {
      const frames: Uint32Array[] = [];
      
      for (let frame = 0; frame < frameCount; frame++) {
        const offset = frame / frameCount;
        
        const lut = this.gradientLUT.buildAnimatedLUT(
          recolorSettings.gradient.map(stop => ({
            position: stop.position,
            color: FastGradientLUT.parseColor(stop.color)
          })),
          offset,
          {
            size: 256,
            cycleColors: recolorSettings.cycleColors,
            interpolationMode: 'linear'
          }
        );
        
        frames.push(lut);
      }
      
      return frames;
    });
  }
  
  /**
   * Setup performance monitoring integration
   */
  private setupPerformanceIntegration(): void {
    this.performanceMonitor.onIssue((issue) => {
      if (issue.category === 'memory' && issue.severity === 'high') {
        // Trigger aggressive cleanup
        this.memoryPool.cleanup();
        this.cacheManager.cleanup('aggressive');
      } else if (issue.category === 'performance' && issue.severity === 'medium') {
        // Reduce quality
        this.qualityManager.setQuality('half');
      }
    });
    
    this.performanceMonitor.onReport((report) => {
      this.updateStatsFromReport(report);
    });
  }
  
  /**
   * Update pipeline statistics from performance report
   */
  private updateStatsFromReport(report: MonitorReport): void {
    const recentFrames = report.metrics.frames.slice(-30);
    if (recentFrames.length > 0) {
      const totalFrameTime = recentFrames.reduce((sum, frame) => sum + frame.frameTime, 0);
      this.stats.averageFrameTime = totalFrameTime / recentFrames.length;
    } else {
      this.stats.averageFrameTime = 0;
    }

    this.stats.cacheHitRate = report.summary.cacheEfficiency;
    const { memory } = report.metrics;
    this.stats.memoryUsage = memory.length > 0 ? memory[memory.length - 1].totalUsed : 0;
  }
  
  /**
   * Build cache key for gradient LUT
   */
  private buildGradientLUTKey(layer: Layer, offset: number): string {
    const settings = layer.colorCycleData?.recolorSettings;
    if (!settings) return '';
    
    const gradientHash = settings.gradient
      .map(stop => `${stop.position}-${stop.color}`)
      .join('|');
    
    return `lut_${layer.id}_${gradientHash}_${offset.toFixed(4)}_${settings.cycleColors}`;
  }
  
  /**
   * Get pipeline statistics
   */
  getStats(): PipelineStats {
    return { ...this.stats };
  }
  
  /**
   * Get comprehensive performance metrics
   */
  getPerformanceMetrics(): PipelinePerformanceSnapshot {
    return {
      pipeline: this.getStats(),
      renderer: this.hotPathRenderer.getStats(),
      memory: this.memoryPool.getStats(),
      cache: this.cacheManager.getStats(),
      performance: this.performanceMonitor.generatePerformanceReport()
    };
  }
  
  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.hotPathRenderer.releaseAllContexts();
    this.memoryPool.cleanup();
    this.cacheManager.clearAll();
  }
  
  /**
   * Destroy pipeline
   */
  destroy(): void {
    this.cleanup();
    this.performanceMonitor.destroy();
    OptimizedPipeline.instance = null;
  }
}
