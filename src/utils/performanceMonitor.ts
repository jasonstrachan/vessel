/**
 * Development utility to monitor custom brush performance optimizations.
 * Only active in development mode to avoid production overhead.
 */

import { memoryManager } from './memoryCleanup';

interface PerformanceMetrics {
  brushStampCount: number;
  cacheHits: number;
  cacheMisses: number;
  averageStampTime: number;
  memoryPressureEvents: number;
  lastCleanupTime: number;
}

export interface ShapeFillTelemetryEvent {
  jobId: string;
  priority: 'preview' | 'final';
  elapsedMs: number;
  fromCache: boolean;
  tiles: number;
  workgroups: number;
  generationMs?: number;
  timestamp: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    brushStampCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageStampTime: 0,
    memoryPressureEvents: 0,
    lastCleanupTime: Date.now()
  };

  private stampTimes: number[] = [];
  private readonly MAX_STAMP_TIMES = 100; // Keep last 100 measurements
  private monitoringEnabled = process.env.NODE_ENV === 'development';
  private shapeFillEvents: ShapeFillTelemetryEvent[] = [];
  private readonly MAX_SHAPE_FILL_EVENTS = 50;

  /**
   * Record a custom brush stamp operation
   */
  recordBrushStamp(executionTime: number): void {
    if (!this.monitoringEnabled) return;

    this.metrics.brushStampCount++;
    this.stampTimes.push(executionTime);

    // Keep only recent measurements
    if (this.stampTimes.length > this.MAX_STAMP_TIMES) {
      this.stampTimes.shift();
    }

    // Update average
    this.metrics.averageStampTime = 
      this.stampTimes.reduce((a, b) => a + b, 0) / this.stampTimes.length;
  }

  /**
   * Record cache hit
   */
  recordCacheHit(): void {
    if (!this.monitoringEnabled) return;
    this.metrics.cacheHits++;
  }

  /**
   * Record cache miss
   */
  recordCacheMiss(): void {
    if (!this.monitoringEnabled) return;
    this.metrics.cacheMisses++;
  }

  /**
   * Record memory pressure event
   */
  recordMemoryPressure(): void {
    if (!this.monitoringEnabled) return;
    this.metrics.memoryPressureEvents++;
  }

  recordShapeFillTelemetry(event: Omit<ShapeFillTelemetryEvent, 'timestamp'>): void {
    if (!this.monitoringEnabled) return;

    const payload: ShapeFillTelemetryEvent = {
      ...event,
      timestamp: Date.now(),
    };

    this.shapeFillEvents.push(payload);
    if (this.shapeFillEvents.length > this.MAX_SHAPE_FILL_EVENTS) {
      this.shapeFillEvents.shift();
    }
  }

  getShapeFillTelemetry(): ShapeFillTelemetryEvent[] {
    return [...this.shapeFillEvents];
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): PerformanceMetrics & {
    cacheHitRate: number;
    memoryStats: ReturnType<typeof memoryManager.getStats>;
  } {
    const totalCacheOperations = this.metrics.cacheHits + this.metrics.cacheMisses;
    const cacheHitRate = totalCacheOperations > 0 
      ? (this.metrics.cacheHits / totalCacheOperations) * 100 
      : 0;

    return {
      ...this.metrics,
      cacheHitRate,
      memoryStats: memoryManager.getStats()
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    if (!this.monitoringEnabled) return;

    this.metrics = {
      brushStampCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageStampTime: 0,
      memoryPressureEvents: 0,
      lastCleanupTime: Date.now()
    };
    this.stampTimes = [];
    this.shapeFillEvents = [];
  }

  /**
   * Log performance summary to console (development only)
   */
  logSummary(): void {
    if (!this.monitoringEnabled) return;

    this.getMetrics();
    
    // Performance metrics available for debugging if needed:
    // Stamps: metrics.brushStampCount | Avg Time: metrics.averageStampTime
    // Cache Hit Rate: metrics.cacheHitRate | Memory pressure events: metrics.memoryPressureEvents
    // Cache Entries: Brush(cacheStats.brushCache.entries) | Pressure(cacheStats.pressureOptimizer.entries) | Scaled(cacheStats.scaledBrushCache.entries)
  }

  /**
   * Measure execution time of a function
   */
  measureStampTime<T>(fn: () => T): T {
    if (!this.monitoringEnabled) {
      return fn();
    }

    const start = performance.now();
    const result = fn();
    const time = performance.now() - start;
    
    this.recordBrushStamp(time);
    return result;
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Global access for debugging in development
if (process.env.NODE_ENV === 'development') {
  (globalThis as typeof globalThis & { brushPerformance?: typeof performanceMonitor }).brushPerformance = performanceMonitor;
}
