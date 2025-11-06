import { FastGradientLUT } from '../rendering/FastGradientLUT';

type MemoryPoolGlobal = typeof globalThis & {
  __vesselMemoryPool?: MemoryPool;
};

/**
 * MemoryPool - Advanced memory management for color cycle rendering
 * 
 * Implements object pooling, buffer reuse, and memory pressure monitoring
 * to maintain consistent performance and avoid garbage collection spikes.
 */

export interface PoolConfig {
  maxSize: number; // Maximum objects to keep in pool
  initialSize: number; // Objects to pre-allocate
  growthFactor: number; // How much to grow when pool is empty (1.5 = 50% growth)
  maxTotalMemory: number; // Maximum total memory usage in bytes
}

export interface MemoryStats {
  totalAllocated: number;
  totalPooled: number;
  activeObjects: number;
  poolHitRate: number;
  gcCollections: number;
  memoryPressure: 'low' | 'medium' | 'high';
}

/**
 * Generic object pool for reusable objects
 */
class ObjectPool<T> {
  private pool: T[] = [];
  private factory: () => T;
  private reset: (obj: T) => void;
  private config: PoolConfig;
  
  // Statistics
  private totalRequests = 0;
  private poolHits = 0;
  private currentSize = 0;
  
  constructor(
    factory: () => T,
    reset: (obj: T) => void,
    config: PoolConfig
  ) {
    this.factory = factory;
    this.reset = reset;
    this.config = config;
    
    // Pre-allocate initial objects
    for (let i = 0; i < config.initialSize; i++) {
      this.pool.push(factory());
    }
    this.currentSize = config.initialSize;
  }
  
  /**
   * Acquire object from pool or create new one
   */
  acquire(): T {
    this.totalRequests++;
    
    if (this.pool.length > 0) {
      this.poolHits++;
      return this.pool.pop()!;
    }
    
    // Pool is empty, create new object
    this.currentSize++;
    return this.factory();
  }
  
  /**
   * Return object to pool
   */
  release(obj: T): void {
    if (this.pool.length < this.config.maxSize) {
      this.reset(obj);
      this.pool.push(obj);
    } else {
      // Pool is full, object will be garbage collected
      this.currentSize--;
    }
  }
  
  /**
   * Get pool statistics
   */
  getStats(): {
    size: number;
    hitRate: number;
    totalRequests: number;
  } {
    return {
      size: this.pool.length,
      hitRate: this.totalRequests > 0 ? this.poolHits / this.totalRequests : 0,
      totalRequests: this.totalRequests
    };
  }
  
  /**
   * Clear pool (for cleanup)
   */
  clear(): void {
    this.pool.length = 0;
    this.currentSize = 0;
  }
}

/**
 * Specialized buffer pool for typed arrays
 */
class BufferPool {
  private pools: Map<number, ObjectPool<Uint8Array>> = new Map();
  private config: PoolConfig;
  
  constructor(config: PoolConfig) {
    this.config = config;
  }
  
  /**
   * Acquire buffer of specific size
   */
  acquireUint8Array(size: number): Uint8Array {
    let pool = this.pools.get(size);
    
    if (!pool) {
      pool = new ObjectPool<Uint8Array>(
        () => new Uint8Array(size),
        (buffer) => buffer.fill(0), // Reset to zeros
        this.config
      );
      this.pools.set(size, pool);
    }
    
    return pool.acquire();
  }
  
  /**
   * Return buffer to pool
   */
  releaseUint8Array(buffer: Uint8Array): void {
    const pool = this.pools.get(buffer.length);
    if (pool) {
      pool.release(buffer);
    }
  }
  
  /**
   * Get buffer pool statistics
   */
  getStats(): Map<number, { size: number; hitRate: number; totalRequests: number }> {
    const stats = new Map();
    for (const [size, pool] of Array.from(this.pools.entries())) {
      stats.set(size, pool.getStats());
    }
    return stats;
  }
  
  /**
   * Clear all buffer pools
   */
  clear(): void {
    for (const pool of Array.from(this.pools.values())) {
      pool.clear();
    }
    this.pools.clear();
  }
}

/**
 * Main memory management system
 */
export class MemoryPool {
  private static instance: MemoryPool | null = null;
  
  private bufferPool: BufferPool;
  private imageDataPool: ObjectPool<ImageData>;
  private canvasPool: ObjectPool<OffscreenCanvas>;
  
  // Memory monitoring
  private totalAllocatedMemory = 0;
  private gcObserver: PerformanceObserver | null = null;
  private gcCount = 0;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastCleanup = Date.now();
  
  // Configuration
  private readonly CLEANUP_INTERVAL = 30000; // 30 seconds
  private readonly MEMORY_PRESSURE_THRESHOLD = 150 * 1024 * 1024; // 150MB
  private readonly HIGH_PRESSURE_THRESHOLD = 300 * 1024 * 1024; // 300MB
  
  private constructor() {
    const defaultConfig: PoolConfig = {
      maxSize: 32,
      initialSize: 4,
      growthFactor: 1.5,
      maxTotalMemory: 256 * 1024 * 1024 // 256MB
    };
    
    this.bufferPool = new BufferPool(defaultConfig);
    
    // ImageData pool (for common sizes)
    this.imageDataPool = new ObjectPool<ImageData>(
      () => new ImageData(1, 1), // Will be resized as needed
      (imageData) => {
        // Clear pixel data
        imageData.data.fill(0);
      },
      { ...defaultConfig, maxSize: 16 }
    );
    
    // OffscreenCanvas pool
    this.canvasPool = new ObjectPool<OffscreenCanvas>(
      () => new OffscreenCanvas(1, 1),
      (canvas) => {
        // Clear canvas
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, 1, 1);
      },
      { ...defaultConfig, maxSize: 8 }
    );
    
    this.setupGCMonitoring();
    this.startPeriodicCleanup();
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): MemoryPool {
    const scope = globalThis as MemoryPoolGlobal;
    if (scope.__vesselMemoryPool) {
      this.instance = scope.__vesselMemoryPool;
      return this.instance;
    }
    if (!this.instance) {
      this.instance = new MemoryPool();
      scope.__vesselMemoryPool = this.instance;
    }
    return this.instance;
  }
  
  /**
   * Acquire buffer from pool
   */
  acquireBuffer(size: number): Uint8Array {
    const buffer = this.bufferPool.acquireUint8Array(size);
    this.totalAllocatedMemory += buffer.byteLength;
    return buffer;
  }
  
  /**
   * Return buffer to pool
   */
  releaseBuffer(buffer: Uint8Array): void {
    this.bufferPool.releaseUint8Array(buffer);
    this.totalAllocatedMemory -= buffer.byteLength;
  }
  
  /**
   * Acquire ImageData from pool
   */
  acquireImageData(width: number, height: number): ImageData {
    const imageData = this.imageDataPool.acquire();
    
    // Resize if needed (ImageData cannot be resized, so create new one)
    if (imageData.width !== width || imageData.height !== height) {
      const newImageData = new ImageData(width, height);
      this.imageDataPool.release(imageData); // Return old one
      this.totalAllocatedMemory += width * height * 4; // RGBA bytes
      return newImageData;
    }
    
    this.totalAllocatedMemory += width * height * 4;
    return imageData;
  }
  
  /**
   * Return ImageData to pool
   */
  releaseImageData(imageData: ImageData): void {
    this.imageDataPool.release(imageData);
    this.totalAllocatedMemory -= imageData.width * imageData.height * 4;
  }
  
  /**
   * Acquire canvas from pool
   */
  acquireCanvas(width: number, height: number): OffscreenCanvas {
    const canvas = this.canvasPool.acquire();
    canvas.width = width;
    canvas.height = height;
    
    this.totalAllocatedMemory += width * height * 4; // Estimated canvas memory
    return canvas;
  }
  
  /**
   * Return canvas to pool
   */
  releaseCanvas(canvas: OffscreenCanvas): void {
    const memory = canvas.width * canvas.height * 4;
    this.canvasPool.release(canvas);
    this.totalAllocatedMemory -= memory;
  }
  
  /**
   * Force garbage collection (if available)
   */
  forceGC(): void {
    // Try different GC methods
    const maybeWindow = window as unknown as { gc?: () => void };
    if (typeof maybeWindow.gc === 'function') {
      maybeWindow.gc();
      return;
    }

    const maybeGlobal = globalThis as { gc?: () => void };
    if (typeof maybeGlobal.gc === 'function') {
      maybeGlobal.gc();
    }
  }
  
  /**
   * Cleanup unused objects when memory pressure is high
   */
  cleanup(): void {
    const now = Date.now();
    const timeSinceCleanup = now - this.lastCleanup;
    
    // Only cleanup if enough time has passed
    if (timeSinceCleanup < this.CLEANUP_INTERVAL) {
      return;
    }
    
    const memoryPressure = this.getMemoryPressure();
    
    if (memoryPressure === 'high') {
      console.log('[MemoryPool] High memory pressure detected, performing aggressive cleanup');
      
      // Clear all pools
      this.bufferPool.clear();
      this.imageDataPool.clear();
      this.canvasPool.clear();
      
      // Clear gradient LUT cache
      FastGradientLUT.clearCache();
      
      // Force garbage collection
      this.forceGC();
      
      this.totalAllocatedMemory = 0;
      
    } else if (memoryPressure === 'medium') {
      console.log('[MemoryPool] Medium memory pressure detected, performing partial cleanup');
      
      // Partial cleanup - reduce pool sizes
      // This would require additional pool methods to reduce size
    }
    
    this.lastCleanup = now;
  }
  
  /**
   * Setup garbage collection monitoring
   */
  private setupGCMonitoring(): void {
    if ('PerformanceObserver' in window) {
      try {
        this.gcObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'measure' && entry.name === 'gc') {
              this.gcCount++;
            }
          }
        });
        
        this.gcObserver.observe({ entryTypes: ['measure'] });
      } catch (error) {
        // GC monitoring not supported
        console.warn('[MemoryPool] GC monitoring not supported', error);
      }
    }
  }
  
  /**
   * Start periodic cleanup
   */
  private startPeriodicCleanup(): void {
    if (this.cleanupIntervalId || typeof setInterval === 'undefined') {
      return;
    }
    this.cleanupIntervalId = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL);
  }

  private stopPeriodicCleanup(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  dispose(): void {
    this.stopPeriodicCleanup();
  }
  
  /**
   * Get current memory pressure level
   */
  getMemoryPressure(): 'low' | 'medium' | 'high' {
    if (this.totalAllocatedMemory > this.HIGH_PRESSURE_THRESHOLD) {
      return 'high';
    } else if (this.totalAllocatedMemory > this.MEMORY_PRESSURE_THRESHOLD) {
      return 'medium';
    } else {
      return 'low';
    }
  }
  
  /**
   * Get comprehensive memory statistics
   */
  getStats(): MemoryStats {
    const bufferStats = this.bufferPool.getStats();
    const imageDataStats = this.imageDataPool.getStats();
    const canvasStats = this.canvasPool.getStats();
    
    // Calculate total pool hit rate
    const totalRequests = imageDataStats.totalRequests + canvasStats.totalRequests +
      Array.from(bufferStats.values()).reduce((sum, stats) => sum + stats.totalRequests, 0);
    
    const totalHits = imageDataStats.hitRate * imageDataStats.totalRequests +
      canvasStats.hitRate * canvasStats.totalRequests +
      Array.from(bufferStats.values()).reduce((sum, stats) => sum + (stats.hitRate * stats.totalRequests), 0);
    
    const overallHitRate = totalRequests > 0 ? totalHits / totalRequests : 0;
    
    return {
      totalAllocated: this.totalAllocatedMemory,
      totalPooled: bufferStats.size + imageDataStats.size + canvasStats.size,
      activeObjects: this.totalAllocatedMemory / (1024 * 4), // Rough estimate
      poolHitRate: overallHitRate,
      gcCollections: this.gcCount,
      memoryPressure: this.getMemoryPressure()
    };
  }
  
  /**
   * Get detailed breakdown by pool type
   */
  getDetailedStats(): {
    buffers: Map<number, { size: number; hitRate: number; totalRequests: number }>;
    imageData: { size: number; hitRate: number; totalRequests: number };
    canvas: { size: number; hitRate: number; totalRequests: number };
    total: MemoryStats;
  } {
    return {
      buffers: this.bufferPool.getStats(),
      imageData: this.imageDataPool.getStats(),
      canvas: this.canvasPool.getStats(),
      total: this.getStats()
    };
  }
  
  /**
   * Cleanup all resources
   */
  destroy(): void {
    this.bufferPool.clear();
    this.imageDataPool.clear();
    this.canvasPool.clear();
    
    if (this.gcObserver) {
      this.gcObserver.disconnect();
      this.gcObserver = null;
    }
    
    MemoryPool.instance = null;
  }
}
