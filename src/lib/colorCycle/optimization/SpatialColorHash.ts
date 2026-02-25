/**
 * SpatialColorHash - Fast nearest color lookup using spatial hashing
 * 
 * Implements a 3D spatial hash grid for O(1) average nearest color lookups
 * instead of O(n) linear search through palette colors.
 */

export interface ColorHashEntry {
  paletteIndex: number;
  r: number;
  g: number;
  b: number;
  distance: number;
}

export interface SpatialHashOptions {
  resolution: number;
  maxBucketSize: number;
  fallbackToLinear: boolean;
}

export interface HashStats {
  totalBuckets: number;
  filledBuckets: number;
  avgBucketSize: number;
  maxBucketSize: number;
  collisionRate: number;
  buildTime: number;
  lookupCount: number;
  avgLookupTime: number;
}

export class SpatialColorHash {
  private grid: Map<number, ColorHashEntry[]>;
  private palette: Uint32Array;
  private options: SpatialHashOptions;
  private stats: HashStats;
  
  constructor(options: Partial<SpatialHashOptions> = {}) {
    this.options = {
      resolution: 16, // 16x16x16 grid = 4096 buckets
      maxBucketSize: 8,
      fallbackToLinear: true,
      ...options
    };
    
    this.grid = new Map();
    this.palette = new Uint32Array(0);
    this.stats = {
      totalBuckets: 0,
      filledBuckets: 0,
      avgBucketSize: 0,
      maxBucketSize: 0,
      collisionRate: 0,
      buildTime: 0,
      lookupCount: 0,
      avgLookupTime: 0
    };
  }

  /**
   * Build spatial hash from palette
   */
  buildHash(palette: Uint32Array): void {
    const startTime = performance.now();
    
    this.palette = new Uint32Array(palette);
    this.grid.clear();
    
    const { resolution } = this.options;
    const scale = 255 / (resolution - 1);
    
    // Insert each palette color into appropriate bucket
    for (let i = 0; i < palette.length; i += 4) {
      const r = palette[i];
      const g = palette[i + 1];
      const b = palette[i + 2];
      
      // Calculate grid coordinates
      const gridR = Math.floor(r / scale);
      const gridG = Math.floor(g / scale);
      const gridB = Math.floor(b / scale);
      
      const bucketKey = this.getBucketKey(gridR, gridG, gridB);
      
      if (!this.grid.has(bucketKey)) {
        this.grid.set(bucketKey, []);
      }
      
      const bucket = this.grid.get(bucketKey)!;
      bucket.push({
        paletteIndex: i / 4,
        r, g, b,
        distance: 0 // Will be calculated during lookup
      });
    }
    
    // Calculate statistics
    this.updateStats();
    this.stats.buildTime = performance.now() - startTime;
  }

  /**
   * Find nearest color using spatial hash
   */
  findNearestColor(r: number, g: number, b: number): number {
    const startTime = performance.now();
    
    try {
      const result = this.findNearestColorInternal(r, g, b);
      
      // Update lookup statistics
      this.stats.lookupCount++;
      const lookupTime = performance.now() - startTime;
      this.stats.avgLookupTime = (
        (this.stats.avgLookupTime * (this.stats.lookupCount - 1) + lookupTime) / 
        this.stats.lookupCount
      );
      
      return result;
    } catch (error) {
      console.warn('[SpatialColorHash] Falling back to linear search due to error:', error);
      return this.fallbackLinearSearch(r, g, b);
    }
  }

  /**
   * Internal nearest color search with spatial optimization
   */
  private findNearestColorInternal(r: number, g: number, b: number): number {
    const { resolution } = this.options;
    const scale = 255 / (resolution - 1);
    
    // Calculate target grid coordinates
    const gridR = Math.floor(r / scale);
    const gridG = Math.floor(g / scale);
    const gridB = Math.floor(b / scale);
    
    let minDistance = Infinity;
    let nearestIndex = 0;
    
    // Search in expanding radius around target cell
    for (let radius = 0; radius < resolution; radius++) {
      let found = false;
      
      // Check all cells in current radius
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dg = -radius; dg <= radius; dg++) {
          for (let db = -radius; db <= radius; db++) {
            // Only check cells at current radius boundary
            if (Math.abs(dr) !== radius && 
                Math.abs(dg) !== radius && 
                Math.abs(db) !== radius && 
                radius > 0) {
              continue;
            }
            
            const checkR = gridR + dr;
            const checkG = gridG + dg;
            const checkB = gridB + db;
            
            // Skip out-of-bounds cells
            if (checkR < 0 || checkR >= resolution ||
                checkG < 0 || checkG >= resolution ||
                checkB < 0 || checkB >= resolution) {
              continue;
            }
            
            const bucketKey = this.getBucketKey(checkR, checkG, checkB);
            const bucket = this.grid.get(bucketKey);
            
            if (!bucket) continue;
            
            // Check all colors in bucket
            for (const entry of bucket) {
              const dr_color = r - entry.r;
              const dg_color = g - entry.g;
              const db_color = b - entry.b;
              
              const distance = dr_color * dr_color + dg_color * dg_color + db_color * db_color;
              
              if (distance < minDistance) {
                minDistance = distance;
                nearestIndex = entry.paletteIndex;
                found = true;
              }
            }
          }
        }
      }
      
      // If we found colors at this radius, we can stop
      // (closest color must be within current radius)
      if (found && radius > 0) {
        break;
      }
    }
    
    return nearestIndex;
  }

  /**
   * Fallback to linear search if hash fails
   */
  private fallbackLinearSearch(r: number, g: number, b: number): number {
    if (!this.options.fallbackToLinear) {
      throw new Error('Spatial hash failed and linear fallback disabled');
    }
    
    let minDistance = Infinity;
    let nearestIndex = 0;
    
    for (let i = 0; i < this.palette.length; i += 4) {
      const pr = this.palette[i];
      const pg = this.palette[i + 1];
      const pb = this.palette[i + 2];
      
      const dr = r - pr;
      const dg = g - pg;
      const db = b - pb;
      
      const distance = dr * dr + dg * dg + db * db;
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestIndex = i / 4;
      }
    }
    
    return nearestIndex;
  }

  /**
   * Calculate bucket key from grid coordinates
   */
  private getBucketKey(r: number, g: number, b: number): number {
    const { resolution } = this.options;
    return r * resolution * resolution + g * resolution + b;
  }

  /**
   * Update internal statistics
   */
  private updateStats(): void {
    const { resolution } = this.options;
    this.stats.totalBuckets = resolution * resolution * resolution;
    this.stats.filledBuckets = this.grid.size;
    
    let totalSize = 0;
    let maxSize = 0;
    let collisions = 0;
    
    for (const bucket of this.grid.values()) {
      const size = bucket.length;
      totalSize += size;
      maxSize = Math.max(maxSize, size);
      
      if (size > 1) {
        collisions += size - 1;
      }
    }
    
    this.stats.avgBucketSize = this.stats.filledBuckets > 0 ? totalSize / this.stats.filledBuckets : 0;
    this.stats.maxBucketSize = maxSize;
    this.stats.collisionRate = totalSize > 0 ? collisions / totalSize : 0;
  }

  /**
   * Get current statistics
   */
  getStats(): HashStats {
    return { ...this.stats };
  }

  /**
   * Optimize hash parameters based on palette characteristics
   */
  optimizeForPalette(palette: Uint32Array): SpatialHashOptions {
    const paletteSize = palette.length / 4;
    
    // Analyze color distribution
    const colorSpread = this.analyzeColorSpread(palette);
    
    // Calculate optimal resolution
    let resolution = 8; // Minimum
    
    if (paletteSize <= 16) {
      resolution = 8;
    } else if (paletteSize <= 64) {
      resolution = 12;
    } else if (paletteSize <= 256) {
      resolution = 16;
    } else {
      resolution = 24;
    }
    
    // Adjust based on color spread
    if (colorSpread.uniformity > 0.8) {
      resolution = Math.min(32, resolution * 2); // More uniform = higher resolution
    } else if (colorSpread.uniformity < 0.3) {
      resolution = Math.max(8, Math.floor(resolution * 0.75)); // Clustered = lower resolution
    }
    
    const maxBucketSize = Math.max(4, Math.ceil(paletteSize / (resolution * resolution * resolution) * 2));
    
    return {
      resolution,
      maxBucketSize,
      fallbackToLinear: true
    };
  }

  /**
   * Analyze color distribution characteristics
   */
  private analyzeColorSpread(palette: Uint32Array): { uniformity: number; avgDistance: number } {
    const colors = [];
    for (let i = 0; i < palette.length; i += 4) {
      colors.push({
        r: palette[i],
        g: palette[i + 1],
        b: palette[i + 2]
      });
    }
    
    if (colors.length < 2) {
      return { uniformity: 1, avgDistance: 0 };
    }
    
    // Calculate average distance between consecutive colors
    let totalDistance = 0;
    let minDistance = Infinity;
    let maxDistance = 0;
    
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const dr = colors[i].r - colors[j].r;
        const dg = colors[i].g - colors[j].g;
        const db = colors[i].b - colors[j].b;
        
        const distance = Math.sqrt(dr * dr + dg * dg + db * db);
        
        totalDistance += distance;
        minDistance = Math.min(minDistance, distance);
        maxDistance = Math.max(maxDistance, distance);
      }
    }
    
    const avgDistance = totalDistance / (colors.length * (colors.length - 1) / 2);
    const uniformity = minDistance / maxDistance; // Higher = more uniform distribution
    
    return { uniformity, avgDistance };
  }

  /**
   * Clear hash and reset statistics
   */
  clear(): void {
    this.grid.clear();
    this.palette = new Uint32Array(0);
    this.stats = {
      totalBuckets: 0,
      filledBuckets: 0,
      avgBucketSize: 0,
      maxBucketSize: 0,
      collisionRate: 0,
      buildTime: 0,
      lookupCount: 0,
      avgLookupTime: 0
    };
  }

  /**
   * Benchmark against linear search
   */
  benchmark(testColors: { r: number; g: number; b: number }[], iterations: number = 1000): {
    hashTime: number;
    linearTime: number;
    speedup: number;
    accuracy: number;
  } {
    if (testColors.length === 0) {
      throw new Error('Need test colors for benchmarking');
    }
    
    // Benchmark hash lookups
    const hashStartTime = performance.now();
    const hashResults: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const color = testColors[i % testColors.length];
      hashResults.push(this.findNearestColor(color.r, color.g, color.b));
    }
    
    const hashTime = performance.now() - hashStartTime;
    
    // Benchmark linear search
    const linearStartTime = performance.now();
    const linearResults: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const color = testColors[i % testColors.length];
      linearResults.push(this.fallbackLinearSearch(color.r, color.g, color.b));
    }
    
    const linearTime = performance.now() - linearStartTime;
    
    // Calculate accuracy (should be 100% for exact nearest neighbor)
    let matches = 0;
    for (let i = 0; i < hashResults.length; i++) {
      if (hashResults[i] === linearResults[i]) {
        matches++;
      }
    }
    const accuracy = matches / hashResults.length;
    
    return {
      hashTime,
      linearTime,
      speedup: linearTime / hashTime,
      accuracy
    };
  }
}
