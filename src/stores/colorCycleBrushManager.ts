/**
 * ColorCycleBrush Manager
 * Manages lifecycle and resources for ColorCycleBrush instances
 */

import type { ColorCycleBrushImplementation } from '../hooks/brushEngine/ColorCycleBrushMigration';

export interface ColorCycleBrushMetadata {
  layerId: string;
  created: number;
  lastUsed: number;
  width: number;
  height: number;
  gradientHash?: string;
  isActive: boolean;
}

export interface ColorCycleBrushManager {
  // Primary storage - Map ensures uniqueness per layer
  brushes: Map<string, ColorCycleBrushImplementation>;
  
  // Metadata tracking for lifecycle management
  brushMetadata: Map<string, ColorCycleBrushMetadata>;
  
  // Resource tracking for cleanup
  activeResources: Set<string>;
  
  // Methods
  createBrush: (layerId: string, width: number, height: number, gradient?: Uint8Array) => ColorCycleBrushImplementation;
  getBrush: (layerId: string) => ColorCycleBrushImplementation | undefined;
  updateBrush: (layerId: string, brush: ColorCycleBrushImplementation) => void;
  deleteBrush: (layerId: string) => void;
  setActiveState: (layerId: string, isActive: boolean) => void;
  cleanupInactive: (maxInactiveMs?: number) => void;
  cleanupAll: () => void;
  
  // Enhanced lifecycle methods
  initColorCycleForLayer: (layerId: string, width: number, height: number, gradient?: Uint8Array) => boolean;
  getLayerColorCycleBrush: (layerId: string) => ColorCycleBrushImplementation | null;
  validateColorCycleBrush: (layerId: string) => boolean;
  removeColorCycleBrush: (layerId: string) => void;
  cleanupOrphanedBrushes: (validLayerIds: Set<string>) => void;
  transferColorCycleBrush: (fromLayerId: string, toLayerId: string) => boolean;
}

export function createColorCycleBrushManager(): ColorCycleBrushManager {
  const brushes = new Map<string, ColorCycleBrushImplementation>();
  const brushMetadata = new Map<string, ColorCycleBrushMetadata>();
  const activeResources = new Set<string>();
  
  return {
    brushes,
    brushMetadata,
    activeResources,
    
    createBrush(layerId: string, width: number, height: number, gradient?: Uint8Array) {
      // Clean up existing brush if any
      this.deleteBrush(layerId);
      
      // Import dynamically to avoid circular dependencies
      const { ColorCycleBrushCanvas2D } = require('../hooks/brushEngine/ColorCycleBrushCanvas2D');
      
      // Create canvas for the brush
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      
      const brush = new ColorCycleBrushCanvas2D(canvas, {
        brushSize: 20,
        fps: 30
      });
      
      // Set layer ID if method exists
      if ('setLayerId' in brush && typeof brush.setLayerId === 'function') {
        brush.setLayerId(layerId);
      }
      
      // Store brush and metadata
      brushes.set(layerId, brush);
      brushMetadata.set(layerId, {
        layerId,
        created: Date.now(),
        lastUsed: Date.now(),
        width,
        height,
        gradientHash: gradient ? hashGradient(gradient) : undefined,
        isActive: true
      });
      
      // Track resources
      activeResources.add(layerId);
      
      console.log(`✅ Created ColorCycleBrush for layer ${layerId.substring(0, 8)}...`);
      
      return brush;
    },
    
    getBrush(layerId: string): ColorCycleBrushImplementation | undefined {
      const brush = brushes.get(layerId);
      if (brush) {
        // Update last used timestamp
        const metadata = brushMetadata.get(layerId);
        if (metadata) {
          metadata.lastUsed = Date.now();
        }
      }
      return brush;
    },
    
    updateBrush(layerId: string, brush: ColorCycleBrushImplementation) {
      brushes.set(layerId, brush);
      const metadata = brushMetadata.get(layerId);
      if (metadata) {
        metadata.lastUsed = Date.now();
      }
    },
    
    deleteBrush(layerId: string) {
      const brush = brushes.get(layerId);
      if (brush) {
        // Cleanup brush resources
        if ('cleanup' in brush && typeof brush.cleanup === 'function') {
          brush.cleanup();
        }
        
        brushes.delete(layerId);
        brushMetadata.delete(layerId);
        activeResources.delete(layerId);
        
        console.log(`🗑️ Deleted ColorCycleBrush for layer ${layerId.substring(0, 8)}...`);
      }
    },
    
    setActiveState(layerId: string, isActive: boolean) {
      const metadata = brushMetadata.get(layerId);
      if (metadata) {
        metadata.isActive = isActive;
        if (isActive) {
          metadata.lastUsed = Date.now();
          activeResources.add(layerId);
        } else {
          activeResources.delete(layerId);
        }
      }
    },
    
    cleanupInactive(maxInactiveMs: number = 60000) {
      const now = Date.now();
      const toDelete: string[] = [];
      
      brushMetadata.forEach((metadata, layerId) => {
        if (!metadata.isActive && (now - metadata.lastUsed > maxInactiveMs)) {
          toDelete.push(layerId);
        }
      });
      
      toDelete.forEach(layerId => {
        this.deleteBrush(layerId);
      });
      
      if (toDelete.length > 0) {
        console.log(`🧹 Cleaned up ${toDelete.length} inactive ColorCycleBrush instances`);
      }
    },
    
    cleanupAll() {
      const count = brushes.size;
      brushes.forEach((brush, layerId) => {
        this.deleteBrush(layerId);
      });
      console.log(`🧹 Cleaned up all ${count} ColorCycleBrush instances`);
    },
    
    // Enhanced lifecycle methods
    initColorCycleForLayer(layerId: string, width: number, height: number, gradient?: Uint8Array): boolean {
      // Check if brush already exists
      if (brushes.has(layerId)) {
        // Validate existing brush
        if (this.validateColorCycleBrush(layerId)) {
          console.log(`✅ Reusing valid ColorCycleBrush for layer ${layerId.substring(0, 8)}...`);
          return true;
        }
        // Invalid brush - cleanup before creating new
        console.warn(`⚠️ Invalid ColorCycleBrush for layer ${layerId.substring(0, 8)}, recreating...`);
        this.removeColorCycleBrush(layerId);
      }
      
      try {
        // Create new isolated brush instance
        const brush = this.createBrush(layerId, width, height, gradient);
        
        // Mark as isolated if method exists
        if ('setIsolated' in brush && typeof brush.setIsolated === 'function') {
          brush.setIsolated(true);
        }
        
        // Track WebGL resources if applicable
        if ('usesWebGL' in brush && brush.usesWebGL) {
          activeResources.add(`webgl_${layerId}`);
        }
        activeResources.add(`canvas_${layerId}`);
        
        return true;
      } catch (error) {
        console.error(`❌ Failed to create CC brush for layer ${layerId}:`, error);
        return false;
      }
    },
    
    getLayerColorCycleBrush(layerId: string): ColorCycleBrushImplementation | null {
      const brush = brushes.get(layerId);
      
      if (!brush) {
        return null;
      }
      
      // Validate brush is still healthy
      if (!this.validateColorCycleBrush(layerId)) {
        console.warn(`⚠️ Brush for layer ${layerId.substring(0, 8)} failed validation, removing...`);
        this.removeColorCycleBrush(layerId);
        return null;
      }
      
      // Update last used timestamp
      const metadata = brushMetadata.get(layerId);
      if (metadata) {
        metadata.lastUsed = Date.now();
      }
      
      return brush;
    },
    
    validateColorCycleBrush(layerId: string): boolean {
      const brush = brushes.get(layerId);
      if (!brush) return false;
      
      try {
        // Check critical components
        
        // 1. Canvas exists and has valid dimensions
        if ('getCanvas' in brush && typeof brush.getCanvas === 'function') {
          const canvas = brush.getCanvas();
          if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
            console.warn(`❌ Invalid canvas for layer ${layerId.substring(0, 8)}`);
            return false;
          }
        }
        
        // 2. WebGL context (if used) is not lost
        if ('isContextLost' in brush && typeof brush.isContextLost === 'function') {
          if (brush.isContextLost()) {
            console.warn(`❌ WebGL context lost for layer ${layerId.substring(0, 8)}`);
            return false;
          }
        }
        
        // 3. Internal buffers are valid
        if ('hasValidBuffers' in brush && typeof brush.hasValidBuffers === 'function') {
          if (!brush.hasValidBuffers()) {
            console.warn(`❌ Invalid buffers for layer ${layerId.substring(0, 8)}`);
            return false;
          }
        }
        
        // 4. Layer ID matches (prevent cross-contamination)
        if ('getLayerId' in brush && typeof brush.getLayerId === 'function') {
          if (brush.getLayerId() !== layerId) {
            console.warn(`❌ Layer ID mismatch for layer ${layerId.substring(0, 8)}`);
            return false;
          }
        }
        
        return true;
      } catch (error) {
        console.error(`❌ Validation error for layer ${layerId}:`, error);
        return false;
      }
    },
    
    removeColorCycleBrush(layerId: string): void {
      const brush = brushes.get(layerId);
      
      if (brush) {
        // Call destroy method if available
        if ('destroy' in brush && typeof brush.destroy === 'function') {
          try {
            brush.destroy();
          } catch (error) {
            console.error(`Error destroying brush for layer ${layerId}:`, error);
          }
        }
        
        // Call cleanup method if available
        if ('cleanup' in brush && typeof brush.cleanup === 'function') {
          try {
            brush.cleanup();
          } catch (error) {
            console.error(`Error cleaning up brush for layer ${layerId}:`, error);
          }
        }
        
        // Clear from maps
        brushes.delete(layerId);
        brushMetadata.delete(layerId);
        
        // Clean up tracked resources
        activeResources.delete(layerId);
        activeResources.delete(`canvas_${layerId}`);
        activeResources.delete(`webgl_${layerId}`);
        
        console.log(`🗑️ Removed ColorCycleBrush for layer ${layerId.substring(0, 8)}...`);
      }
    },
    
    cleanupOrphanedBrushes(validLayerIds: Set<string>): void {
      // Find orphaned brushes
      const orphaned = Array.from(brushes.keys())
        .filter(id => !validLayerIds.has(id));
      
      if (orphaned.length === 0) return;
      
      // Clean them up
      orphaned.forEach(layerId => {
        console.log(`🧹 Cleaning up orphaned CC brush for deleted layer: ${layerId.substring(0, 8)}...`);
        this.removeColorCycleBrush(layerId);
      });
      
      console.log(`✅ Cleaned up ${orphaned.length} orphaned ColorCycleBrush instances`);
    },
    
    transferColorCycleBrush(fromLayerId: string, toLayerId: string): boolean {
      const sourceBrush = brushes.get(fromLayerId);
      const sourceMetadata = brushMetadata.get(fromLayerId);
      
      if (!sourceBrush || !sourceMetadata) {
        console.warn(`⚠️ No brush to transfer from layer ${fromLayerId.substring(0, 8)}`);
        return false;
      }
      
      // Validate source brush before transfer
      if (!this.validateColorCycleBrush(fromLayerId)) {
        console.warn(`⚠️ Source brush invalid, cannot transfer from ${fromLayerId.substring(0, 8)}`);
        return false;
      }
      
      // Clean up target if exists
      if (brushes.has(toLayerId)) {
        this.removeColorCycleBrush(toLayerId);
      }
      
      // Update layer ID in brush if possible
      if ('setLayerId' in sourceBrush && typeof sourceBrush.setLayerId === 'function') {
        sourceBrush.setLayerId(toLayerId);
      }
      
      // Transfer to new layer
      brushes.set(toLayerId, sourceBrush);
      brushMetadata.set(toLayerId, {
        ...sourceMetadata,
        layerId: toLayerId,
        lastUsed: Date.now()
      });
      
      // Update resource tracking
      if (activeResources.has(fromLayerId)) {
        activeResources.delete(fromLayerId);
        activeResources.add(toLayerId);
      }
      if (activeResources.has(`canvas_${fromLayerId}`)) {
        activeResources.delete(`canvas_${fromLayerId}`);
        activeResources.add(`canvas_${toLayerId}`);
      }
      if (activeResources.has(`webgl_${fromLayerId}`)) {
        activeResources.delete(`webgl_${fromLayerId}`);
        activeResources.add(`webgl_${toLayerId}`);
      }
      
      // Remove from source
      brushes.delete(fromLayerId);
      brushMetadata.delete(fromLayerId);
      
      console.log(`✅ Transferred ColorCycleBrush from ${fromLayerId.substring(0, 8)}... to ${toLayerId.substring(0, 8)}...`);
      return true;
    }
  };
}

// Helper to create a hash of gradient for comparison
function hashGradient(gradient: Uint8Array): string {
  // Simple hash for gradient comparison
  let hash = 0;
  for (let i = 0; i < gradient.length; i += 16) {
    hash = ((hash << 5) - hash) + gradient[i];
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

// Global instance for the application
let globalManager: ColorCycleBrushManager | null = null;

// Store reference to the layer getter function
let getValidLayerIds: (() => Set<string>) | null = null;

export function setLayerIdGetter(getter: () => Set<string>): void {
  getValidLayerIds = getter;
}

export function getColorCycleBrushManager(): ColorCycleBrushManager {
  if (!globalManager) {
    globalManager = createColorCycleBrushManager();
    
    // Setup periodic cleanup
    if (typeof window !== 'undefined') {
      // Cleanup inactive brushes
      setInterval(() => {
        globalManager?.cleanupInactive(60000); // Clean up brushes inactive for 1 minute
      }, 30000); // Run every 30 seconds
      
      // Cleanup orphaned brushes
      setInterval(() => {
        if (globalManager && getValidLayerIds) {
          const validIds = getValidLayerIds();
          globalManager.cleanupOrphanedBrushes(validIds);
        }
      }, 60000); // Run every minute
    }
  }
  return globalManager;
}

// Export types
export type { ColorCycleBrushImplementation };