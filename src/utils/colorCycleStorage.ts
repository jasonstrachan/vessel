/**
 * Optimized storage system for color cycle brush data
 * Implements delta compression, gradient sharing, and memory management
 */

import type { ColorCycleSnapshot } from '../types';

// Constants for memory management
const MAX_SNAPSHOT_MEMORY = 50 * 1024 * 1024; // 50MB max for snapshots
const MAX_SNAPSHOTS_PER_LAYER = 30; // Limit history depth per layer
const COMPRESSION_THRESHOLD = 1024; // Minimum size for compression (1KB)

/**
 * Gradient pool for deduplication
 */
class GradientPool {
  private gradients: Map<string, {
    id: string;
    stops: Array<{ position: number; color: string }>;
    refCount: number;
  }> = new Map();
  
  /**
   * Get or create a gradient ID for the given stops
   */
  getGradientId(stops: Array<{ position: number; color: string }>): string {
    const key = this.generateKey(stops);
    
    let gradient = this.gradients.get(key);
    if (!gradient) {
      gradient = {
        id: `gradient_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        stops: [...stops], // Deep copy
        refCount: 0
      };
      this.gradients.set(key, gradient);
    }
    
    gradient.refCount++;
    return gradient.id;
  }
  
  /**
   * Release a gradient reference
   */
  releaseGradient(gradientId: string): void {
    for (const [key, gradient] of this.gradients) {
      if (gradient.id === gradientId) {
        gradient.refCount--;
        if (gradient.refCount <= 0) {
          this.gradients.delete(key);
        }
        break;
      }
    }
  }
  
  /**
   * Get gradient stops by ID
   */
  getGradientStops(gradientId: string): Array<{ position: number; color: string }> | null {
    for (const gradient of this.gradients.values()) {
      if (gradient.id === gradientId) {
        return [...gradient.stops]; // Return a copy
      }
    }
    return null;
  }
  
  private generateKey(stops: Array<{ position: number; color: string }>): string {
    return stops.map(s => `${s.position}:${s.color}`).join('|');
  }
  
  /**
   * Get memory usage statistics
   */
  getStats() {
    return {
      uniqueGradients: this.gradients.size,
      totalReferences: Array.from(this.gradients.values()).reduce((sum, g) => sum + g.refCount, 0)
    };
  }
}

/**
 * Delta compression for paint buffers
 */
export class DeltaCompressor {
  /**
   * Create a delta between two paint buffers
   */
  static createDelta(base: Uint8Array, current: Uint8Array): ArrayBuffer {
    if (base.length !== current.length) {
      // If sizes differ, store full data
      return current.buffer.slice(current.byteOffset, current.byteOffset + current.byteLength) as ArrayBuffer;
    }
    
    // Find changed regions
    const changes: Array<{ offset: number; length: number; data: Uint8Array }> = [];
    let changeStart = -1;
    
    for (let i = 0; i < base.length; i++) {
      if (base[i] !== current[i]) {
        if (changeStart === -1) {
          changeStart = i;
        }
      } else if (changeStart !== -1) {
        // End of change region
        const length = i - changeStart;
        changes.push({
          offset: changeStart,
          length,
          data: current.slice(changeStart, i)
        });
        changeStart = -1;
      }
    }
    
    // Handle change at end of buffer
    if (changeStart !== -1) {
      const length = base.length - changeStart;
      changes.push({
        offset: changeStart,
        length,
        data: current.slice(changeStart)
      });
    }
    
    // If no changes, return empty buffer
    if (changes.length === 0) {
      return new ArrayBuffer(0);
    }
    
    // Calculate total size needed
    const headerSize = 4 + (changes.length * 8); // 4 bytes for count + 8 bytes per change (offset + length)
    const dataSize = changes.reduce((sum, change) => sum + change.length, 0);
    const totalSize = headerSize + dataSize;
    
    // If delta is larger than original, just store the original
    if (totalSize >= current.length) {
      const fullDataBuffer = new ArrayBuffer(current.length + 4);
      const view = new DataView(fullDataBuffer);
      view.setUint32(0, 0xFFFFFFFF, true); // Special marker for full data
      new Uint8Array(fullDataBuffer, 4).set(current);
      return fullDataBuffer;
    }
    
    // Build delta buffer
    const deltaBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(deltaBuffer);
    let offset = 0;
    
    // Write change count
    view.setUint32(offset, changes.length, true);
    offset += 4;
    
    // Write change headers
    for (const change of changes) {
      view.setUint32(offset, change.offset, true);
      offset += 4;
      view.setUint32(offset, change.length, true);
      offset += 4;
    }
    
    // Write change data
    for (const change of changes) {
      new Uint8Array(deltaBuffer, offset).set(change.data);
      offset += change.length;
    }
    
    return deltaBuffer;
  }
  
  /**
   * Apply a delta to a base buffer
   */
  static applyDelta(base: Uint8Array, delta: ArrayBuffer): Uint8Array {
    if (delta.byteLength === 0) {
      // No changes
      return new Uint8Array(base);
    }
    
    const view = new DataView(delta);
    const changeCount = view.getUint32(0, true);
    
    // Check for full data marker
    if (changeCount === 0xFFFFFFFF) {
      // Full data stored
      return new Uint8Array(delta, 4);
    }
    
    // Create output buffer as copy of base
    const output = new Uint8Array(base);
    let offset = 4;
    
    // Read and apply changes
    const changes = [];
    for (let i = 0; i < changeCount; i++) {
      const changeOffset = view.getUint32(offset, true);
      offset += 4;
      const changeLength = view.getUint32(offset, true);
      offset += 4;
      changes.push({ offset: changeOffset, length: changeLength });
    }
    
    // Apply change data
    for (const change of changes) {
      const changeData = new Uint8Array(delta, offset, change.length);
      output.set(changeData, change.offset);
      offset += change.length;
    }
    
    return output;
  }
  
  /**
   * Compress a series of snapshots using delta compression
   */
  static compressSnapshots(snapshots: ArrayBuffer[]): Array<{
    isBase: boolean;
    data: ArrayBuffer;
  }> {
    if (snapshots.length === 0) return [];
    
    const compressed = [];
    let baseIndex = 0;
    
    for (let i = 0; i < snapshots.length; i++) {
      if (i === 0 || i - baseIndex >= 5) { // Create new base every 5 snapshots
        compressed.push({
          isBase: true,
          data: snapshots[i]
        });
        baseIndex = i;
      } else {
        const base = new Uint8Array(snapshots[baseIndex]);
        const current = new Uint8Array(snapshots[i]);
        const delta = this.createDelta(base, current);
        
        compressed.push({
          isBase: false,
          data: delta
        });
      }
    }
    
    return compressed;
  }
}

/**
 * Memory-managed storage for color cycle snapshots
 */
export class OptimizedColorCycleStorage {
  private gradientPool = new GradientPool();
  private snapshots: Map<string, Array<{
    timestamp: number;
    gradientIds: string[];
    animationState: any;
    strokeDeltas: Map<string, ArrayBuffer>;
    baseSnapshot?: Map<string, Uint8Array>;
  }>> = new Map();
  
  private totalMemoryUsage = 0;
  
  /**
   * Add a snapshot with optimization
   */
  addSnapshot(layerId: string, snapshot: ColorCycleSnapshot): void {
    // Get or create layer snapshots array
    let layerSnapshots = this.snapshots.get(layerId);
    if (!layerSnapshots) {
      layerSnapshots = [];
      this.snapshots.set(layerId, layerSnapshots);
    }
    
    // Convert gradients to gradient pool IDs
    const gradientIds = snapshot.gradients.map(g => 
      this.gradientPool.getGradientId(g.gradientStops)
    );
    
    // Create stroke deltas if we have a previous snapshot
    const strokeDeltas = new Map<string, ArrayBuffer>();
    const baseSnapshot = new Map<string, Uint8Array>();
    
    if (layerSnapshots.length > 0) {
      const prevSnapshot = layerSnapshots[layerSnapshots.length - 1];
      
      for (const stroke of snapshot.layerStrokes) {
        const currentData = new Uint8Array(stroke.paintBuffer);
        
        // Find base data from previous snapshot or base
        let baseData: Uint8Array | null = null;
        if (prevSnapshot.baseSnapshot?.has(stroke.layerId)) {
          baseData = prevSnapshot.baseSnapshot.get(stroke.layerId)!;
        }
        
        if (baseData && currentData.length === baseData.length) {
          // Create delta
          const delta = DeltaCompressor.createDelta(baseData, currentData);
          strokeDeltas.set(stroke.layerId, delta);
        } else {
          // Store as new base
          strokeDeltas.set(stroke.layerId, currentData.buffer);
          baseSnapshot.set(stroke.layerId, currentData);
        }
      }
    } else {
      // First snapshot - store everything as base
      for (const stroke of snapshot.layerStrokes) {
        const data = new Uint8Array(stroke.paintBuffer);
        strokeDeltas.set(stroke.layerId, data.buffer);
        baseSnapshot.set(stroke.layerId, data);
      }
    }
    
    // Calculate memory usage
    let snapshotSize = 0;
    for (const delta of strokeDeltas.values()) {
      snapshotSize += delta.byteLength;
    }
    this.totalMemoryUsage += snapshotSize;
    
    // Add to snapshots
    layerSnapshots.push({
      timestamp: Date.now(),
      gradientIds,
      animationState: { ...snapshot.animationState },
      strokeDeltas,
      baseSnapshot: layerSnapshots.length % 5 === 0 ? baseSnapshot : undefined
    });
    
    // Enforce limits
    this.enforceMemoryLimits(layerId);
  }
  
  /**
   * Retrieve a snapshot
   */
  getSnapshot(layerId: string, index: number): ColorCycleSnapshot | null {
    const layerSnapshots = this.snapshots.get(layerId);
    if (!layerSnapshots || index < 0 || index >= layerSnapshots.length) {
      return null;
    }
    
    const snapshot = layerSnapshots[index];
    
    // Reconstruct gradients from pool
    const gradients = snapshot.gradientIds.map(id => {
      const stops = this.gradientPool.getGradientStops(id);
      return {
        layerIndex: 0,
        gradientStops: stops || [],
        hasContent: true
      };
    });
    
    // Reconstruct stroke data
    const layerStrokes = [];
    
    // Find the nearest base snapshot
    let baseIndex = Math.floor(index / 5) * 5;
    while (baseIndex >= 0 && !layerSnapshots[baseIndex].baseSnapshot) {
      baseIndex -= 5;
    }
    
    // Apply deltas from base to target
    const baseSnapshots = baseIndex >= 0 ? layerSnapshots[baseIndex].baseSnapshot : new Map();
    
    for (const [strokeId, delta] of snapshot.strokeDeltas) {
      let strokeData: Uint8Array;
      
      if (baseSnapshots?.has(strokeId)) {
        // Apply delta to base
        strokeData = DeltaCompressor.applyDelta(baseSnapshots.get(strokeId)!, delta);
      } else {
        // No base, delta is full data
        strokeData = new Uint8Array(delta);
      }
      
      layerStrokes.push({
        layerId: strokeId,
        paintBuffer: strokeData.buffer.slice(strokeData.byteOffset, strokeData.byteOffset + strokeData.byteLength) as ArrayBuffer,
        hasContent: strokeData.some(v => v > 0),
        strokeCounter: 0,
        strokeLength: 0,
        gradientLayerIndices: [],
        currentGradientIndex: 0
      });
    }
    
    return {
      layerId,
      strokeData: new ArrayBuffer(0),
      gradients,
      animationState: { ...snapshot.animationState },
      layerStrokes
    };
  }
  
  /**
   * Enforce memory limits
   */
  private enforceMemoryLimits(layerId: string): void {
    const layerSnapshots = this.snapshots.get(layerId);
    if (!layerSnapshots) return;
    
    // Limit number of snapshots
    while (layerSnapshots.length > MAX_SNAPSHOTS_PER_LAYER) {
      const removed = layerSnapshots.shift();
      if (removed) {
        // Update memory usage
        for (const delta of removed.strokeDeltas.values()) {
          this.totalMemoryUsage -= delta.byteLength;
        }
        
        // Release gradient references
        for (const gradientId of removed.gradientIds) {
          this.gradientPool.releaseGradient(gradientId);
        }
      }
    }
    
    // Limit total memory
    while (this.totalMemoryUsage > MAX_SNAPSHOT_MEMORY && layerSnapshots.length > 1) {
      const removed = layerSnapshots.shift();
      if (removed) {
        for (const delta of removed.strokeDeltas.values()) {
          this.totalMemoryUsage -= delta.byteLength;
        }
        
        for (const gradientId of removed.gradientIds) {
          this.gradientPool.releaseGradient(gradientId);
        }
      }
    }
  }
  
  /**
   * Clear all snapshots for a layer
   */
  clearLayer(layerId: string): void {
    const layerSnapshots = this.snapshots.get(layerId);
    if (layerSnapshots) {
      for (const snapshot of layerSnapshots) {
        for (const delta of snapshot.strokeDeltas.values()) {
          this.totalMemoryUsage -= delta.byteLength;
        }
        
        for (const gradientId of snapshot.gradientIds) {
          this.gradientPool.releaseGradient(gradientId);
        }
      }
      
      this.snapshots.delete(layerId);
    }
  }
  
  /**
   * Get storage statistics
   */
  getStats() {
    return {
      totalMemoryUsage: this.totalMemoryUsage,
      layerCount: this.snapshots.size,
      totalSnapshots: Array.from(this.snapshots.values()).reduce((sum, s) => sum + s.length, 0),
      gradientPoolStats: this.gradientPool.getStats()
    };
  }
}

// Global storage instance
export const colorCycleStorage = new OptimizedColorCycleStorage();