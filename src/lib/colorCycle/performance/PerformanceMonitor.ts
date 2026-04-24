import { debugWarn } from '@/utils/debug';
import { MemoryPool } from '../memory/MemoryPool';
import { CacheManager } from '../memory/CacheManager';

/**
 * PerformanceMonitor - Comprehensive performance tracking for color cycle rendering
 *
 * Tracks frame times, memory usage, cache performance, and system health
 * with automatic optimization suggestions and performance reporting.
 */

export interface FrameMetrics {
  frameTime: number; // Total frame time in ms
  renderTime: number; // Rendering-only time in ms
  updateTime: number; // Logic update time in ms
  fps: number;
  timestamp: number;
  layerCount: number;
  pixelCount: number;
  dropped: boolean; // Was this frame dropped?
}

export interface MemoryMetrics {
  totalUsed: number;
  pooledMemory: number;
  cacheMemory: number;
  nativeMemory: number; // Estimated browser/GPU memory
  gcCount: number;
  timestamp: number;
}

export interface CacheMetrics {
  hitRate: number;
  missRate: number;
  evictions: number;
  memoryUsage: number;
  entries: number;
  timestamp: number;
}

export interface SystemMetrics {
  cpuUsage: number; // Estimated from timing data
  memoryPressure: 'low' | 'medium' | 'high';
  devicePixelRatio: number;
  hardwareConcurrency: number;
  userAgent: string;
  timestamp: number;
}

export interface PerformanceReport {
  summary: {
    averageFPS: number;
    frameTimeP95: number; // 95th percentile frame time
    memoryEfficiency: number; // 0-1 score
    cacheEfficiency: number; // 0-1 score
    overallScore: number; // 0-100 overall performance score
  };
  recommendations: string[];
  issues: Array<{
    severity: 'low' | 'medium' | 'high';
    category: 'performance' | 'memory' | 'cache' | 'system';
    message: string;
    suggestion: string;
  }>;
  metrics: {
    frames: FrameMetrics[];
    memory: MemoryMetrics[];
    cache: CacheMetrics[];
    system: SystemMetrics;
  };
}

export interface MonitorConfig {
  sampleInterval: number; // How often to collect metrics (ms)
  historySize: number; // Number of samples to keep
  enableDetailedMetrics: boolean;
  enableProfiling: boolean;
  reportingThreshold: number; // Report issues if performance drops below this (0-1)
}

/**
 * Ring buffer for efficient metric storage
 */
class RingBuffer<T> {
  private buffer: T[];
  private size: number;
  private head = 0;
  private count = 0;
  
  constructor(size: number) {
    this.size = size;
    this.buffer = new Array(size);
  }
  
  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.size;
    this.count = Math.min(this.count + 1, this.size);
  }
  
  getAll(): T[] {
    if (this.count === 0) return [];
    
    const result: T[] = [];
    let index = (this.head - this.count + this.size) % this.size;
    
    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[index]);
      index = (index + 1) % this.size;
    }
    
    return result;
  }
  
  getLast(n: number): T[] {
    const all = this.getAll();
    return all.slice(-n);
  }
  
  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

/**
 * Main performance monitoring system
 */
interface PerformanceMemoryInfo {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
}

type PerformanceWithMemory = Performance & { memory?: PerformanceMemoryInfo };

export class PerformanceMonitor {
  private static instance: PerformanceMonitor | null = null;
  
  private config: MonitorConfig;
  private isEnabled = true;
  private isCollecting = false;
  
  // Metric storage
  private frameMetrics: RingBuffer<FrameMetrics>;
  private memoryMetrics: RingBuffer<MemoryMetrics>;
  private cacheMetrics: RingBuffer<CacheMetrics>;
  private systemMetrics: SystemMetrics = {
    cpuUsage: 0,
    memoryPressure: 'low',
    devicePixelRatio: 1,
    hardwareConcurrency: 1,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    timestamp: Date.now(),
  };
  
  // Performance tracking
  private frameStartTime = 0;
  private renderStartTime = 0;
  private updateStartTime = 0;
  private lastReportTime = 0;
  private gcStartCount = 0;
  
  // System monitoring
  private observer: PerformanceObserver | null = null;
  private memoryInfo: PerformanceMemoryInfo | null = null;
  
  // Callbacks
  private issueCallbacks: Set<(issue: PerformanceReport['issues'][0]) => void> = new Set();
  private reportCallbacks: Set<(report: PerformanceReport) => void> = new Set();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  
  private constructor(config: Partial<MonitorConfig> = {}) {
    this.config = {
      sampleInterval: 1000, // 1 second
      historySize: 300, // 5 minutes of history
      enableDetailedMetrics: true,
      enableProfiling: false,
      reportingThreshold: 0.7,
      ...config
    };
    
    this.frameMetrics = new RingBuffer<FrameMetrics>(this.config.historySize * 2);
    this.memoryMetrics = new RingBuffer<MemoryMetrics>(this.config.historySize);
    this.cacheMetrics = new RingBuffer<CacheMetrics>(this.config.historySize);
    
    this.initializeSystemMetrics();
    this.setupPerformanceObserver();
    this.startPeriodicCollection();
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<MonitorConfig>): PerformanceMonitor {
    if (!this.instance) {
      this.instance = new PerformanceMonitor(config);
    }
    return this.instance;
  }
  
  /**
   * Start frame timing
   */
  startFrame(): void {
    if (!this.isEnabled) return;
    
    this.frameStartTime = performance.now();
    
    if (this.config.enableProfiling) {
      performance.mark('color-cycle-frame-start');
    }
  }
  
  /**
   * Start render timing
   */
  startRender(): void {
    if (!this.isEnabled) return;
    
    this.renderStartTime = performance.now();
    
    if (this.config.enableProfiling) {
      performance.mark('color-cycle-render-start');
    }
  }
  
  /**
   * End render timing
   */
  endRender(): void {
    if (!this.isEnabled || this.renderStartTime === 0) return;
    
    if (this.config.enableProfiling) {
      performance.mark('color-cycle-render-end');
      performance.measure('color-cycle-render', 'color-cycle-render-start', 'color-cycle-render-end');
    }
  }
  
  /**
   * Start update timing
   */
  startUpdate(): void {
    if (!this.isEnabled) return;
    
    this.updateStartTime = performance.now();
    
    if (this.config.enableProfiling) {
      performance.mark('color-cycle-update-start');
    }
  }
  
  /**
   * End update timing
   */
  endUpdate(): void {
    if (!this.isEnabled || this.updateStartTime === 0) return;
    
    if (this.config.enableProfiling) {
      performance.mark('color-cycle-update-end');
      performance.measure('color-cycle-update', 'color-cycle-update-start', 'color-cycle-update-end');
    }
  }
  
  /**
   * End frame timing and record metrics
   */
  endFrame(layerCount: number, pixelCount: number, dropped = false): void {
    if (!this.isEnabled || this.frameStartTime === 0) return;
    
    const now = performance.now();
    const frameTime = now - this.frameStartTime;
    const renderTime = this.renderStartTime > 0 ? now - this.renderStartTime : 0;
    const updateTime = this.updateStartTime > 0 ? now - this.updateStartTime : 0;
    const fps = 1000 / frameTime;
    
    const metrics: FrameMetrics = {
      frameTime,
      renderTime,
      updateTime,
      fps,
      timestamp: now,
      layerCount,
      pixelCount,
      dropped
    };
    
    this.frameMetrics.push(metrics);
    
    // Check for performance issues
    this.checkFramePerformance(metrics);
    
    if (this.config.enableProfiling) {
      performance.mark('color-cycle-frame-end');
      performance.measure('color-cycle-frame', 'color-cycle-frame-start', 'color-cycle-frame-end');
    }
    
    // Reset timers
    this.frameStartTime = 0;
    this.renderStartTime = 0;
    this.updateStartTime = 0;
  }
  
  /**
   * Record memory metrics
   */
  recordMemoryMetrics(): void {
    if (!this.isEnabled) return;
    
    const now = performance.now();
    let nativeMemory = 0;
    let gcCount = 0;
    
    // Get memory info if available
    const perfWithMemory = performance as PerformanceWithMemory;
    const memInfo = perfWithMemory.memory;
    if (memInfo) {
      nativeMemory = memInfo.usedJSHeapSize || 0;

      // Try to detect GC events
      if (this.memoryInfo && memInfo.usedJSHeapSize < this.memoryInfo.usedJSHeapSize) {
        gcCount = this.gcStartCount + 1;
      }

      this.memoryInfo = memInfo;
    }

    // Get pooled memory from MemoryPool
    const memoryPool = MemoryPool.getInstance();
    const poolStats = memoryPool.getStats();

    // Get cache memory from CacheManager
    const cacheManager = CacheManager.getInstance();
    const cacheStats = cacheManager.getStats();
    
    const metrics: MemoryMetrics = {
      totalUsed: nativeMemory + poolStats.totalAllocated + cacheStats.totalMemory,
      pooledMemory: poolStats.totalAllocated,
      cacheMemory: cacheStats.totalMemory,
      nativeMemory,
      gcCount,
      timestamp: now
    };
    
    this.memoryMetrics.push(metrics);
    this.checkMemoryPerformance(metrics);
  }
  
  /**
   * Record cache metrics
   */
  recordCacheMetrics(): void {
    if (!this.isEnabled) return;

    const cacheManager = CacheManager.getInstance();
    const stats = cacheManager.getStats();
    
    // Calculate weighted averages across all cache types
    const cacheTypes = [stats.gradientLUT, stats.quantizedPalette, stats.indexBuffer, stats.precomputedAnimation];
    const totalRequests = cacheTypes.reduce((sum, cache) => sum + cache.totalRequests, 0);
    
    let weightedHitRate = 0;
    let weightedMissRate = 0;
    let totalEvictions = 0;
    
    if (totalRequests > 0) {
      for (const cache of cacheTypes) {
        const weight = cache.totalRequests / totalRequests;
        weightedHitRate += cache.hitRate * weight;
        weightedMissRate += cache.missRate * weight;
        totalEvictions += cache.evictions;
      }
    }
    
    const metrics: CacheMetrics = {
      hitRate: weightedHitRate,
      missRate: weightedMissRate,
      evictions: totalEvictions,
      memoryUsage: stats.totalMemory,
      entries: stats.totalEntries,
      timestamp: performance.now()
    };
    
    this.cacheMetrics.push(metrics);
    this.checkCachePerformance(metrics);
  }
  
  /**
   * Initialize system metrics
   */
  private initializeSystemMetrics(): void {
    this.systemMetrics = {
      cpuUsage: 0, // Will be calculated from timing data
      memoryPressure: 'low',
      devicePixelRatio: window.devicePixelRatio || 1,
      hardwareConcurrency: navigator.hardwareConcurrency || 4,
      userAgent: navigator.userAgent,
      timestamp: performance.now()
    };
  }
  
  /**
   * Setup performance observer for detailed metrics
   */
  private setupPerformanceObserver(): void {
    if (!this.config.enableDetailedMetrics || !('PerformanceObserver' in window)) {
      return;
    }
    
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name.startsWith('color-cycle-')) {
            // Process color cycle specific metrics
            this.processPerformanceEntry(entry);
          }
        }
      });
      
      this.observer.observe({ entryTypes: ['measure', 'navigation', 'resource'] });
    } catch (error) {
      debugWarn('raw-console', '[PerformanceMonitor] Failed to setup PerformanceObserver:', error);
    }
  }
  
  /**
   * Process performance observer entries
   */
  private processPerformanceEntry(entry: PerformanceEntry): void {
    // This could be extended to collect more detailed metrics
    // from the browser's performance API
    void entry;
  }
  
  /**
   * Start periodic metric collection
   */
  private startPeriodicCollection(): void {
    if (this.intervalId || typeof setInterval === 'undefined') {
      return;
    }

    this.intervalId = setInterval(() => {
      if (this.isCollecting) return;

      this.isCollecting = true;
      
      try {
        this.recordMemoryMetrics();
        this.recordCacheMetrics();
        this.updateSystemMetrics();
        
        // Generate report if enough time has passed
        const now = Date.now();
        if (now - this.lastReportTime > 30000) { // 30 seconds
          this.generatePerformanceReport();
          this.lastReportTime = now;
        }
        
      } finally {
        this.isCollecting = false;
      }
    }, this.config.sampleInterval);
  }

  private stopPeriodicCollection(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  
  /**
   * Update system metrics based on collected data
   */
  private updateSystemMetrics(): void {
    const recentFrames = this.frameMetrics.getLast(30); // Last 30 frames
    
    if (recentFrames.length > 0) {
      const avgFrameTime = recentFrames.reduce((sum, frame) => sum + frame.frameTime, 0) / recentFrames.length;
      
      // Estimate CPU usage from frame times
      // Higher frame times suggest higher CPU usage
      const targetFrameTime = 16.67; // 60 FPS target
      this.systemMetrics.cpuUsage = Math.min(100, (avgFrameTime / targetFrameTime) * 100);
    }
    
    // Update memory pressure based on recent memory metrics
    const recentMemory = this.memoryMetrics.getLast(5);
    if (recentMemory.length > 0) {
      const avgMemory = recentMemory.reduce((sum, mem) => sum + mem.totalUsed, 0) / recentMemory.length;
      
      if (avgMemory > 300 * 1024 * 1024) { // 300MB
        this.systemMetrics.memoryPressure = 'high';
      } else if (avgMemory > 150 * 1024 * 1024) { // 150MB
        this.systemMetrics.memoryPressure = 'medium';
      } else {
        this.systemMetrics.memoryPressure = 'low';
      }
    }
  }
  
  /**
   * Check frame performance for issues
   */
  private checkFramePerformance(metrics: FrameMetrics): void {
    if (metrics.frameTime > 33.33) { // Below 30 FPS
      this.reportIssue({
        severity: metrics.frameTime > 50 ? 'high' : 'medium',
        category: 'performance',
        message: `Frame time is high: ${metrics.frameTime.toFixed(1)}ms (${metrics.fps.toFixed(1)} FPS)`,
        suggestion: 'Consider reducing layer count, image resolution, or cycle colors'
      });
    }
    
    if (metrics.dropped) {
      this.reportIssue({
        severity: 'medium',
        category: 'performance',
        message: 'Frame was dropped due to performance issues',
        suggestion: 'Enable adaptive quality or reduce rendering load'
      });
    }
  }
  
  /**
   * Check memory performance for issues
   */
  private checkMemoryPerformance(metrics: MemoryMetrics): void {
    if (metrics.totalUsed > 500 * 1024 * 1024) { // 500MB
      this.reportIssue({
        severity: 'high',
        category: 'memory',
        message: `High memory usage: ${(metrics.totalUsed / 1024 / 1024).toFixed(1)}MB`,
        suggestion: 'Clear unused caches or reduce image sizes'
      });
    }
    
    if (metrics.gcCount > this.gcStartCount + 5) { // Frequent GC
      this.reportIssue({
        severity: 'medium',
        category: 'memory',
        message: 'Frequent garbage collection detected',
        suggestion: 'Review object allocation patterns and use memory pooling'
      });
      this.gcStartCount = metrics.gcCount;
    }
  }
  
  /**
   * Check cache performance for issues
   */
  private checkCachePerformance(metrics: CacheMetrics): void {
    if (metrics.hitRate < 0.8) { // Less than 80% hit rate
      this.reportIssue({
        severity: 'low',
        category: 'cache',
        message: `Low cache hit rate: ${(metrics.hitRate * 100).toFixed(1)}%`,
        suggestion: 'Review cache sizes and eviction policies'
      });
    }
    
    if (metrics.evictions > 100) { // Many evictions
      this.reportIssue({
        severity: 'medium',
        category: 'cache',
        message: `High cache eviction count: ${metrics.evictions}`,
        suggestion: 'Increase cache memory limits or optimize cache usage patterns'
      });
    }
  }
  
  /**
   * Report performance issue
   */
  private reportIssue(issue: PerformanceReport['issues'][0]): void {
    this.issueCallbacks.forEach(callback => callback(issue));
  }
  
  /**
   * Generate comprehensive performance report
   */
  generatePerformanceReport(): PerformanceReport {
    const frames = this.frameMetrics.getAll();
    const memory = this.memoryMetrics.getAll();
    const cache = this.cacheMetrics.getAll();
    
    // Calculate summary metrics
    const recentFrames = frames.slice(-60); // Last 60 frames
    const averageFPS = recentFrames.length > 0 
      ? recentFrames.reduce((sum, f) => sum + f.fps, 0) / recentFrames.length 
      : 0;
    
    const frameTimes = recentFrames.map(f => f.frameTime).sort((a, b) => a - b);
    const frameTimeP95 = frameTimes.length > 0 
      ? frameTimes[Math.floor(frameTimes.length * 0.95)] 
      : 0;
    
    const recentCache = cache.slice(-10);
    const avgHitRate = recentCache.length > 0
      ? recentCache.reduce((sum, c) => sum + c.hitRate, 0) / recentCache.length
      : 0;
    
    const recentMemory = memory.slice(-10);
    const avgMemoryEfficiency = recentMemory.length > 0 
      ? Math.max(0, 1 - (recentMemory.reduce((sum, m) => sum + m.totalUsed, 0) / recentMemory.length) / (512 * 1024 * 1024))
      : 1;
    
    const overallScore = Math.round(
      (Math.min(averageFPS / 60, 1) * 40) +
      (avgHitRate * 30) +
      (avgMemoryEfficiency * 30)
    );
    
    const report: PerformanceReport = {
      summary: {
        averageFPS,
        frameTimeP95,
        memoryEfficiency: avgMemoryEfficiency,
        cacheEfficiency: avgHitRate,
        overallScore
      },
      recommendations: this.generateRecommendations(frames, memory, cache),
      issues: [], // Issues are reported in real-time
      metrics: {
        frames,
        memory,
        cache,
        system: this.systemMetrics
      }
    };
    
    this.reportCallbacks.forEach(callback => callback(report));
    return report;
  }
  
  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(
    frames: FrameMetrics[],
    memory: MemoryMetrics[],
    cache: CacheMetrics[]
  ): string[] {
    const recommendations: string[] = [];
    
    const recentFrames = frames.slice(-30);
    if (recentFrames.length > 0) {
      const avgFPS = recentFrames.reduce((sum, f) => sum + f.fps, 0) / recentFrames.length;
      
      if (avgFPS < 30) {
        recommendations.push('Enable adaptive quality to maintain smooth animation');
        recommendations.push('Consider reducing the number of animated layers');
        recommendations.push('Use lower resolution images when possible');
      }
      
      if (avgFPS < 60 && avgFPS >= 30) {
        recommendations.push('Optimize gradient calculations with simpler color schemes');
        recommendations.push('Enable frame rate limiting to 30 FPS for better consistency');
      }
    }
    
    const recentMemory = memory.slice(-5);
    if (recentMemory.length > 0) {
      const avgMemory = recentMemory.reduce((sum, m) => sum + m.totalUsed, 0) / recentMemory.length;
      
      if (avgMemory > 200 * 1024 * 1024) {
        recommendations.push('Enable aggressive memory cleanup to reduce usage');
        recommendations.push('Consider using smaller index buffer cache sizes');
      }
    }
    
    const recentCache = cache.slice(-5);
    if (recentCache.length > 0) {
      const avgHitRate = recentCache.reduce((sum, c) => sum + c.hitRate, 0) / recentCache.length;
      
      if (avgHitRate < 0.7) {
        recommendations.push('Increase cache sizes for better performance');
        recommendations.push('Review animation patterns to improve cache locality');
      }
    }
    
    return recommendations;
  }
  
  /**
   * Event listeners
   */
  onIssue(callback: (issue: PerformanceReport['issues'][0]) => void): void {
    this.issueCallbacks.add(callback);
  }
  
  onReport(callback: (report: PerformanceReport) => void): void {
    this.reportCallbacks.add(callback);
  }
  
  /**
   * Control methods
   */
  enable(): void {
    this.isEnabled = true;
    this.startPeriodicCollection();
  }

  disable(): void {
    this.isEnabled = false;
    this.stopPeriodicCollection();
  }
  
  reset(): void {
    this.frameMetrics.clear();
    this.memoryMetrics.clear();
    this.cacheMetrics.clear();
  }
  
  /**
   * Cleanup
   */
  destroy(): void {
    this.stopPeriodicCollection();
    this.reset();
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.issueCallbacks.clear();
    this.reportCallbacks.clear();

    PerformanceMonitor.instance = null;
  }
}
