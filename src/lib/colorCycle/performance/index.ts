/**
 * Color Cycle Performance Management - Phase 2
 * 
 * Comprehensive performance monitoring, metrics collection, and
 * optimized rendering pipeline coordination for maximum efficiency.
 */

export { PerformanceMonitor } from './PerformanceMonitor';
export type { 
  FrameMetrics, 
  MemoryMetrics, 
  CacheMetrics, 
  SystemMetrics,
  PerformanceReport,
  MonitorConfig 
} from './PerformanceMonitor';

export { OptimizedPipeline } from './OptimizedPipeline';
export type { 
  PipelineConfig, 
  RenderRequest, 
  PipelineStats 
} from './OptimizedPipeline';