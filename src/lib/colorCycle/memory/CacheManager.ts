/**
 * CacheManager - Intelligent caching for computed data in color cycle rendering
 * 
 * Manages LRU caches for gradient LUTs, quantized palettes, and other expensive
 * computed values with automatic eviction based on memory pressure.
 */

export interface CacheEntry<T> {
  key: string;
  value: T;
  size: number; // Size in bytes
  lastAccess: number;
  accessCount: number;
  computeTime: number; // Time spent computing this value
}

export interface CacheConfig {
  maxEntries: number;
  maxMemory: number; // Maximum memory usage in bytes
  ttl: number; // Time to live in milliseconds
  evictionPolicy: 'lru' | 'lfu' | 'adaptive'; // Least Recently Used, Least Frequently Used, or Adaptive
}

export interface CacheStats {
  entries: number;
  memoryUsage: number;
  hitRate: number;
  missRate: number;
  evictions: number;
  totalRequests: number;
  averageComputeTime: number;
}

/**
 * LRU Cache with memory management and adaptive eviction
 */
class AdaptiveCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private config: CacheConfig;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    totalRequests: 0,
    totalComputeTime: 0
  };
  
  constructor(config: CacheConfig) {
    this.config = config;
  }
  
  /**
   * Get value from cache
   */
  get(key: string): T | null {
    this.stats.totalRequests++;
    
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    // Check TTL
    if (Date.now() - entry.lastAccess > this.config.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    
    // Update access info
    entry.lastAccess = Date.now();
    entry.accessCount++;
    
    this.stats.hits++;
    return entry.value;
  }
  
  /**
   * Store value in cache
   */
  set(key: string, value: T, size: number, computeTime: number): void {
    // Check if we need to evict entries
    this.evictIfNeeded(size);
    
    const entry: CacheEntry<T> = {
      key,
      value,
      size,
      lastAccess: Date.now(),
      accessCount: 1,
      computeTime
    };
    
    this.cache.set(key, entry);
    this.stats.totalComputeTime += computeTime;
  }
  
  /**
   * Remove value from cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.stats.totalComputeTime -= entry.computeTime;
    }
    return this.cache.delete(key);
  }
  
  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.stats.totalComputeTime = 0;
  }
  
  /**
   * Evict entries if memory/count limits exceeded
   */
  private evictIfNeeded(newEntrySize: number): void {
    const currentMemory = this.getMemoryUsage();
    const maxMemory = this.config.maxMemory;
    const maxEntries = this.config.maxEntries;
    
    // Check if we need to evict
    const needsEviction = 
      this.cache.size >= maxEntries || 
      (currentMemory + newEntrySize) > maxMemory;
    
    if (!needsEviction) return;
    
    // Choose eviction strategy
    const candidates = Array.from(this.cache.values());
    
    if (this.config.evictionPolicy === 'lru') {
      this.evictLRU(candidates);
    } else if (this.config.evictionPolicy === 'lfu') {
      this.evictLFU(candidates);
    } else {
      this.evictAdaptive(candidates);
    }
  }
  
  /**
   * Evict least recently used entries
   */
  private evictLRU(candidates: CacheEntry<T>[]): void {
    candidates.sort((a, b) => a.lastAccess - b.lastAccess);
    this.evictEntries(candidates, 0.25); // Evict oldest 25%
  }
  
  /**
   * Evict least frequently used entries
   */
  private evictLFU(candidates: CacheEntry<T>[]): void {
    candidates.sort((a, b) => a.accessCount - b.accessCount);
    this.evictEntries(candidates, 0.25); // Evict least used 25%
  }
  
  /**
   * Adaptive eviction based on cost-benefit analysis
   */
  private evictAdaptive(candidates: CacheEntry<T>[]): void {
    // Score based on: access frequency, recency, size, and compute time
    candidates.forEach(entry => {
      const age = Date.now() - entry.lastAccess;
      const frequency = entry.accessCount;
      const benefit = entry.computeTime; // Higher compute time = more valuable
      const cost = entry.size; // Larger size = higher cost
      
      // Lower score = more likely to be evicted
      (entry as any).score = (frequency * benefit) / (age * cost + 1);
    });
    
    candidates.sort((a, b) => (a as any).score - (b as any).score);
    this.evictEntries(candidates, 0.3); // Evict lowest scoring 30%
  }
  
  /**
   * Evict specified percentage of entries
   */
  private evictEntries(candidates: CacheEntry<T>[], percentage: number): void {
    const evictCount = Math.max(1, Math.floor(candidates.length * percentage));
    
    for (let i = 0; i < evictCount; i++) {
      const entry = candidates[i];
      this.cache.delete(entry.key);
      this.stats.evictions++;
      this.stats.totalComputeTime -= entry.computeTime;
    }
  }
  
  /**
   * Get current memory usage
   */
  private getMemoryUsage(): number {
    let total = 0;
    for (const entry of Array.from(this.cache.values())) {
      total += entry.size;
    }
    return total;
  }
  
  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const memoryUsage = this.getMemoryUsage();
    const totalRequests = this.stats.totalRequests;
    
    return {
      entries: this.cache.size,
      memoryUsage,
      hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
      missRate: totalRequests > 0 ? this.stats.misses / totalRequests : 0,
      evictions: this.stats.evictions,
      totalRequests,
      averageComputeTime: this.cache.size > 0 ? this.stats.totalComputeTime / this.cache.size : 0
    };
  }
  
  /**
   * Get all cache keys (for debugging)
   */
  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }
  
  /**
   * Get entry details (for debugging)
   */
  getEntry(key: string): CacheEntry<T> | null {
    return this.cache.get(key) || null;
  }
}

/**
 * Specialized cache manager for color cycle data
 */
export class CacheManager {
  private static instance: CacheManager | null = null;
  
  // Specialized caches for different data types
  private gradientLUTCache: AdaptiveCache<Uint32Array>;
  private quantizedPaletteCache: AdaptiveCache<Uint32Array>;
  private indexBufferCache: AdaptiveCache<Uint8Array>;
  private precomputedAnimationCache: AdaptiveCache<Uint32Array[]>; // Precomputed animation frames
  
  private constructor() {
    // Configuration for different cache types
    const gradientConfig: CacheConfig = {
      maxEntries: 64,
      maxMemory: 32 * 1024 * 1024, // 32MB for gradient LUTs
      ttl: 5 * 60 * 1000, // 5 minutes
      evictionPolicy: 'adaptive'
    };
    
    const paletteConfig: CacheConfig = {
      maxEntries: 32,
      maxMemory: 8 * 1024 * 1024, // 8MB for palettes
      ttl: 10 * 60 * 1000, // 10 minutes
      evictionPolicy: 'lru'
    };
    
    const indexBufferConfig: CacheConfig = {
      maxEntries: 16,
      maxMemory: 64 * 1024 * 1024, // 64MB for index buffers
      ttl: 15 * 60 * 1000, // 15 minutes
      evictionPolicy: 'lfu'
    };
    
    const animationConfig: CacheConfig = {
      maxEntries: 8,
      maxMemory: 128 * 1024 * 1024, // 128MB for precomputed animations
      ttl: 2 * 60 * 1000, // 2 minutes (shorter for animations)
      evictionPolicy: 'adaptive'
    };
    
    this.gradientLUTCache = new AdaptiveCache<Uint32Array>(gradientConfig);
    this.quantizedPaletteCache = new AdaptiveCache<Uint32Array>(paletteConfig);
    this.indexBufferCache = new AdaptiveCache<Uint8Array>(indexBufferConfig);
    this.precomputedAnimationCache = new AdaptiveCache<Uint32Array[]>(animationConfig);
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): CacheManager {
    if (!this.instance) {
      this.instance = new CacheManager();
    }
    return this.instance;
  }
  
  /**
   * Get gradient LUT from cache or compute if needed
   */
  getGradientLUT(
    key: string,
    computeFunction: () => { lut: Uint32Array; computeTime: number }
  ): Uint32Array {
    let lut = this.gradientLUTCache.get(key);
    
    if (!lut) {
      const start = performance.now();
      const result = computeFunction();
      const computeTime = performance.now() - start;
      
      lut = result.lut;
      this.gradientLUTCache.set(key, lut, lut.byteLength, computeTime);
    }
    
    return lut;
  }
  
  /**
   * Get quantized palette from cache
   */
  getQuantizedPalette(
    key: string,
    computeFunction: () => Uint32Array
  ): Uint32Array {
    let palette = this.quantizedPaletteCache.get(key);
    
    if (!palette) {
      const start = performance.now();
      palette = computeFunction();
      const computeTime = performance.now() - start;
      
      this.quantizedPaletteCache.set(key, palette, palette.byteLength, computeTime);
    }
    
    return palette;
  }
  
  /**
   * Get index buffer from cache
   */
  getIndexBuffer(
    key: string,
    computeFunction: () => Uint8Array
  ): Uint8Array {
    let buffer = this.indexBufferCache.get(key);
    
    if (!buffer) {
      const start = performance.now();
      buffer = computeFunction();
      const computeTime = performance.now() - start;
      
      this.indexBufferCache.set(key, buffer, buffer.byteLength, computeTime);
    }
    
    return buffer;
  }
  
  /**
   * Get precomputed animation frames
   */
  getPrecomputedAnimation(
    key: string,
    computeFunction: () => Uint32Array[]
  ): Uint32Array[] {
    let frames = this.precomputedAnimationCache.get(key);
    
    if (!frames) {
      const start = performance.now();
      frames = computeFunction();
      const computeTime = performance.now() - start;
      
      const totalSize = frames.reduce((sum, frame) => sum + frame.byteLength, 0);
      this.precomputedAnimationCache.set(key, frames, totalSize, computeTime);
    }
    
    return frames;
  }
  
  /**
   * Invalidate cache entries by pattern
   */
  invalidatePattern(pattern: RegExp): void {
    this.invalidateCachePattern(this.gradientLUTCache, pattern);
    this.invalidateCachePattern(this.quantizedPaletteCache, pattern);
    this.invalidateCachePattern(this.indexBufferCache, pattern);
    this.invalidateCachePattern(this.precomputedAnimationCache, pattern);
  }
  
  private invalidateCachePattern<T>(cache: AdaptiveCache<T>, pattern: RegExp): void {
    const keysToDelete = cache.getKeys().filter(key => pattern.test(key));
    keysToDelete.forEach(key => cache.delete(key));
  }
  
  /**
   * Get comprehensive cache statistics
   */
  getStats(): {
    gradientLUT: CacheStats;
    quantizedPalette: CacheStats;
    indexBuffer: CacheStats;
    precomputedAnimation: CacheStats;
    totalMemory: number;
    totalEntries: number;
  } {
    const gradientStats = this.gradientLUTCache.getStats();
    const paletteStats = this.quantizedPaletteCache.getStats();
    const indexStats = this.indexBufferCache.getStats();
    const animationStats = this.precomputedAnimationCache.getStats();
    
    return {
      gradientLUT: gradientStats,
      quantizedPalette: paletteStats,
      indexBuffer: indexStats,
      precomputedAnimation: animationStats,
      totalMemory: gradientStats.memoryUsage + paletteStats.memoryUsage + 
                   indexStats.memoryUsage + animationStats.memoryUsage,
      totalEntries: gradientStats.entries + paletteStats.entries + 
                   indexStats.entries + animationStats.entries
    };
  }
  
  /**
   * Clear all caches
   */
  clearAll(): void {
    this.gradientLUTCache.clear();
    this.quantizedPaletteCache.clear();
    this.indexBufferCache.clear();
    this.precomputedAnimationCache.clear();
  }
  
  /**
   * Cleanup based on memory pressure
   */
  cleanup(aggressiveness: 'light' | 'moderate' | 'aggressive'): void {
    if (aggressiveness === 'aggressive') {
      this.clearAll();
    } else if (aggressiveness === 'moderate') {
      // Clear less frequently used caches
      this.precomputedAnimationCache.clear();
      this.gradientLUTCache.clear();
    } else {
      // Just clear the most memory-intensive cache
      this.precomputedAnimationCache.clear();
    }
  }
  
  /**
   * Cleanup resources
   */
  destroy(): void {
    this.clearAll();
    CacheManager.instance = null;
  }
}