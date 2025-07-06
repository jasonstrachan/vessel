import { BrushComponent, ComponentType } from '@/types/brush';

export interface CacheEntry<T = any> {
  key: string;
  value: T;
  timestamp: number;
  hitCount: number;
  size: number; // Estimated memory size in bytes
}

export interface CacheStats {
  totalEntries: number;
  hitRate: number;
  missRate: number;
  memoryUsage: number;
  maxMemoryUsage: number;
  oldestEntry: number;
  newestEntry: number;
}

/**
 * High-performance caching system for brush components
 * Maintains 60fps by caching expensive operations
 */
export class ComponentCache {
  private cache: Map<string, CacheEntry> = new Map();
  private hitCount = 0;
  private missCount = 0;
  private maxMemoryUsage: number;
  private maxEntries: number;
  private ttl: number; // Time to live in milliseconds
  
  constructor(
    maxMemoryUsage = 50 * 1024 * 1024, // 50MB default
    maxEntries = 10000,
    ttl = 5 * 60 * 1000 // 5 minutes default
  ) {
    this.maxMemoryUsage = maxMemoryUsage;
    this.maxEntries = maxEntries;
    this.ttl = ttl;
  }

  /**
   * Generate cache key for component execution
   */
  private generateKey(
    componentType: ComponentType,
    parameters: any,
    input?: any
  ): string {
    const paramStr = JSON.stringify(parameters);
    const inputStr = input ? JSON.stringify(input) : '';
    return `${componentType}:${this.hash(paramStr + inputStr)}`;
  }

  /**
   * Simple hash function for cache keys
   */
  private hash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Estimate memory size of value
   */
  private estimateSize(value: any): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'string') return value.length * 2;
    if (typeof value === 'number') return 8;
    if (typeof value === 'boolean') return 4;
    if (value instanceof ImageData) return value.width * value.height * 4;
    if (value instanceof HTMLCanvasElement) return value.width * value.height * 4;
    if (Array.isArray(value)) {
      return value.reduce((sum, item) => sum + this.estimateSize(item), 0);
    }
    if (typeof value === 'object') {
      return Object.values(value).reduce((sum: number, item: any) => sum + this.estimateSize(item), 0);
    }
    return 100; // Default estimate
  }

  /**
   * Get value from cache
   */
  get<T>(
    componentType: ComponentType,
    parameters: any,
    input?: any
  ): T | undefined {
    const key = this.generateKey(componentType, parameters, input);
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.missCount++;
      return undefined;
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      this.missCount++;
      return undefined;
    }

    entry.hitCount++;
    this.hitCount++;
    return entry.value as T;
  }

  /**
   * Set value in cache
   */
  set<T>(
    componentType: ComponentType,
    parameters: any,
    value: T,
    input?: any
  ): void {
    const key = this.generateKey(componentType, parameters, input);
    const size = this.estimateSize(value);
    
    // Check memory limits
    if (this.getCurrentMemoryUsage() + size > this.maxMemoryUsage) {
      this.evictLeastUsed();
    }

    // Check entry limits
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    const entry: CacheEntry<T> = {
      key,
      value,
      timestamp: Date.now(),
      hitCount: 0,
      size
    };

    this.cache.set(key, entry);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  /**
   * Clear expired entries
   */
  clearExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Evict least recently used entries
   */
  private evictLeastUsed(): void {
    let minHitCount = Infinity;
    let keyToEvict = '';

    for (const [key, entry] of this.cache) {
      if (entry.hitCount < minHitCount) {
        minHitCount = entry.hitCount;
        keyToEvict = key;
      }
    }

    if (keyToEvict) {
      this.cache.delete(keyToEvict);
    }
  }

  /**
   * Evict oldest entries
   */
  private evictOldest(): void {
    let oldestTimestamp = Infinity;
    let keyToEvict = '';

    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        keyToEvict = key;
      }
    }

    if (keyToEvict) {
      this.cache.delete(keyToEvict);
    }
  }

  /**
   * Get current memory usage
   */
  private getCurrentMemoryUsage(): number {
    return Array.from(this.cache.values()).reduce((sum, entry) => sum + entry.size, 0);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const entries = Array.from(this.cache.values());
    const totalRequests = this.hitCount + this.missCount;
    
    return {
      totalEntries: this.cache.size,
      hitRate: totalRequests > 0 ? this.hitCount / totalRequests : 0,
      missRate: totalRequests > 0 ? this.missCount / totalRequests : 0,
      memoryUsage: this.getCurrentMemoryUsage(),
      maxMemoryUsage: this.maxMemoryUsage,
      oldestEntry: entries.length > 0 ? Math.min(...entries.map(e => e.timestamp)) : 0,
      newestEntry: entries.length > 0 ? Math.max(...entries.map(e => e.timestamp)) : 0
    };
  }

  /**
   * Get cache entries for debugging
   */
  getEntries(): CacheEntry[] {
    return Array.from(this.cache.values());
  }

  /**
   * Optimize cache performance
   */
  optimize(): void {
    // Remove expired entries
    this.clearExpired();
    
    // If still over memory limit, evict least used
    while (this.getCurrentMemoryUsage() > this.maxMemoryUsage * 0.8) {
      this.evictLeastUsed();
    }
  }
}

// Global cache instance
let globalCache: ComponentCache | null = null;

/**
 * Get global component cache instance
 */
export function getComponentCache(): ComponentCache {
  if (!globalCache) {
    globalCache = new ComponentCache();
  }
  return globalCache;
}

/**
 * Reset global cache (for testing)
 */
export function resetComponentCache(): void {
  globalCache = null;
}

export default ComponentCache;