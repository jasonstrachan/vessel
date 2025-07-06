import { ComponentType } from '@/types/brush';

export interface PerformanceMetrics {
  frameRate: number;
  averageFrameTime: number;
  totalFrames: number;
  droppedFrames: number;
  componentExecutionTimes: Map<ComponentType, number[]>;
  memoryUsage: number;
  cacheStats: {
    hitRate: number;
    missRate: number;
    memoryUsage: number;
  };
}

export interface PerformanceAlert {
  type: 'frame_drop' | 'memory_high' | 'component_slow' | 'cache_miss';
  message: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: number;
  data?: any;
}

/**
 * Real-time performance monitoring system for maintaining 60fps
 */
export class PerformanceMonitor {
  private frameTarget = 16.67; // 60fps target (16.67ms per frame)
  private frameHistory: number[] = [];
  private maxHistorySize = 120; // Track last 2 seconds at 60fps
  private componentTimes: Map<ComponentType, number[]> = new Map();
  private alerts: PerformanceAlert[] = [];
  private maxAlerts = 100;
  private isMonitoring = false;
  private performanceObserver: PerformanceObserver | null = null;
  private lastFrameTime = 0;
  private totalFrames = 0;
  private droppedFrames = 0;
  private alertCallbacks: ((alert: PerformanceAlert) => void)[] = [];

  constructor() {
    this.initializePerformanceObserver();
  }

  /**
   * Initialize performance observer for automatic frame monitoring
   */
  private initializePerformanceObserver(): void {
    if (typeof window !== 'undefined' && 'PerformanceObserver' in window) {
      this.performanceObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (const entry of entries) {
          if (entry.entryType === 'measure') {
            this.recordFrameTime(entry.duration);
          }
        }
      });
    }
  }

  /**
   * Start performance monitoring
   */
  start(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.lastFrameTime = performance.now();
    
    if (this.performanceObserver) {
      this.performanceObserver.observe({ entryTypes: ['measure'] });
    }

    // Start frame monitoring loop
    this.monitorFrameLoop();
  }

  /**
   * Stop performance monitoring
   */
  stop(): void {
    this.isMonitoring = false;
    
    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
    }
  }

  /**
   * Monitor frame loop for dropped frames
   */
  private monitorFrameLoop(): void {
    if (!this.isMonitoring) return;

    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastFrameTime;
    
    // Check if we're in an animation frame
    if (deltaTime > this.frameTarget * 1.5) {
      this.recordFrameTime(deltaTime);
    }
    
    this.lastFrameTime = currentTime;
    requestAnimationFrame(() => this.monitorFrameLoop());
  }

  /**
   * Record frame execution time
   */
  recordFrameTime(frameTime: number): void {
    this.frameHistory.push(frameTime);
    this.totalFrames++;
    
    // Keep history size manageable
    if (this.frameHistory.length > this.maxHistorySize) {
      this.frameHistory.shift();
    }

    // Check for dropped frames
    if (frameTime > this.frameTarget * 2) {
      this.droppedFrames++;
      this.addAlert({
        type: 'frame_drop',
        message: `Frame dropped: ${frameTime.toFixed(2)}ms (target: ${this.frameTarget}ms)`,
        severity: frameTime > this.frameTarget * 3 ? 'high' : 'medium',
        timestamp: Date.now(),
        data: { frameTime, target: this.frameTarget }
      });
    }
  }

  /**
   * Record component execution time
   */
  recordComponentTime(componentType: ComponentType, executionTime: number): void {
    if (!this.componentTimes.has(componentType)) {
      this.componentTimes.set(componentType, []);
    }
    
    const times = this.componentTimes.get(componentType)!;
    times.push(executionTime);
    
    // Keep component history manageable
    if (times.length > 60) { // Last 60 executions
      times.shift();
    }

    // Check for slow components
    if (executionTime > 5) { // 5ms threshold
      this.addAlert({
        type: 'component_slow',
        message: `Slow component: ${componentType} took ${executionTime.toFixed(2)}ms`,
        severity: executionTime > 10 ? 'high' : 'medium',
        timestamp: Date.now(),
        data: { componentType, executionTime }
      });
    }
  }

  /**
   * Record memory usage
   */
  recordMemoryUsage(memoryUsage: number): void {
    const memoryMB = memoryUsage / (1024 * 1024);
    
    if (memoryMB > 100) { // 100MB threshold
      this.addAlert({
        type: 'memory_high',
        message: `High memory usage: ${memoryMB.toFixed(1)}MB`,
        severity: memoryMB > 200 ? 'high' : 'medium',
        timestamp: Date.now(),
        data: { memoryUsage: memoryMB }
      });
    }
  }

  /**
   * Record cache performance
   */
  recordCachePerformance(hitRate: number, missRate: number, memoryUsage: number): void {
    if (hitRate < 0.7) { // 70% hit rate threshold
      this.addAlert({
        type: 'cache_miss',
        message: `Low cache hit rate: ${(hitRate * 100).toFixed(1)}%`,
        severity: hitRate < 0.5 ? 'high' : 'medium',
        timestamp: Date.now(),
        data: { hitRate, missRate, memoryUsage }
      });
    }
  }

  /**
   * Add performance alert
   */
  private addAlert(alert: PerformanceAlert): void {
    this.alerts.push(alert);
    
    // Keep alerts manageable
    if (this.alerts.length > this.maxAlerts) {
      this.alerts.shift();
    }

    // Notify listeners
    this.alertCallbacks.forEach(callback => callback(alert));
  }

  /**
   * Subscribe to performance alerts
   */
  onAlert(callback: (alert: PerformanceAlert) => void): () => void {
    this.alertCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.alertCallbacks.indexOf(callback);
      if (index > -1) {
        this.alertCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): PerformanceMetrics {
    const recentFrames = this.frameHistory.slice(-30); // Last 30 frames
    const averageFrameTime = recentFrames.length > 0 
      ? recentFrames.reduce((sum, time) => sum + time, 0) / recentFrames.length 
      : 0;
    
    const frameRate = averageFrameTime > 0 ? 1000 / averageFrameTime : 0;
    
    return {
      frameRate,
      averageFrameTime,
      totalFrames: this.totalFrames,
      droppedFrames: this.droppedFrames,
      componentExecutionTimes: new Map(this.componentTimes),
      memoryUsage: this.getMemoryUsage(),
      cacheStats: this.getCacheStats()
    };
  }

  /**
   * Get memory usage (estimation)
   */
  private getMemoryUsage(): number {
    if (typeof window !== 'undefined' && 'performance' in window && 'memory' in window.performance) {
      return (window.performance as any).memory.usedJSHeapSize;
    }
    return 0;
  }

  /**
   * Get cache statistics
   */
  private getCacheStats(): { hitRate: number; missRate: number; memoryUsage: number } {
    // This would typically get stats from ComponentCache
    return {
      hitRate: 0.8, // Default placeholder
      missRate: 0.2,
      memoryUsage: 0
    };
  }

  /**
   * Get recent performance alerts
   */
  getRecentAlerts(maxAge: number = 30000): PerformanceAlert[] {
    const cutoff = Date.now() - maxAge;
    return this.alerts.filter(alert => alert.timestamp > cutoff);
  }

  /**
   * Clear performance history
   */
  clearHistory(): void {
    this.frameHistory = [];
    this.componentTimes.clear();
    this.alerts = [];
    this.totalFrames = 0;
    this.droppedFrames = 0;
  }

  /**
   * Get performance report
   */
  getReport(): string {
    const metrics = this.getMetrics();
    const recentAlerts = this.getRecentAlerts();
    
    return `
Performance Report:
- Frame Rate: ${metrics.frameRate.toFixed(1)} fps
- Average Frame Time: ${metrics.averageFrameTime.toFixed(2)}ms
- Dropped Frames: ${metrics.droppedFrames}/${metrics.totalFrames}
- Memory Usage: ${(metrics.memoryUsage / 1024 / 1024).toFixed(1)}MB
- Cache Hit Rate: ${(metrics.cacheStats.hitRate * 100).toFixed(1)}%
- Recent Alerts: ${recentAlerts.length}
    `.trim();
  }

  /**
   * Export performance data for analysis
   */
  exportData(): any {
    return {
      metrics: this.getMetrics(),
      alerts: this.getRecentAlerts(),
      frameHistory: [...this.frameHistory],
      componentTimes: Object.fromEntries(this.componentTimes),
      timestamp: Date.now()
    };
  }
}

// Global performance monitor instance
let globalMonitor: PerformanceMonitor | null = null;

/**
 * Get global performance monitor instance
 */
export function getPerformanceMonitor(): PerformanceMonitor {
  if (!globalMonitor) {
    globalMonitor = new PerformanceMonitor();
  }
  return globalMonitor;
}

/**
 * Reset global performance monitor (for testing)
 */
export function resetPerformanceMonitor(): void {
  if (globalMonitor) {
    globalMonitor.stop();
  }
  globalMonitor = null;
}

export default PerformanceMonitor;