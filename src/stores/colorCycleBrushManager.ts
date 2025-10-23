/**
 * ColorCycleBrush Manager
 * Manages lifecycle and resources for ColorCycleBrush instances
 */

import { featureFlags } from '@/config/featureFlags';
import { ColorCycleBrushCanvas2D } from '@/hooks/brushEngine/ColorCycleBrushCanvas2D';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import { defaultBrushSettings } from '@/presets/brushPresets';
import type { BrushSettings, Layer } from '@/types';
import type { AppState } from '@/stores/useAppStore';

type BrushWithOptionalControls = ColorCycleBrushImplementation & {
  usesWebGL?: boolean;
  cleanup?: () => void;
  destroy?: () => void;
  setIsolated?: (isolated: boolean) => void;
  setLayerId?: (layerId: string) => void;
  setSpeed?: (speed: number) => void;
  setUseCanvas2D?: (useCanvas2D: boolean) => void;
  isUsingWebGL?: () => boolean;
  setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
};

type StoreSlice = Pick<AppState, 'tools' | 'layers'>;

let storeStateGetter: (() => StoreSlice) | null = null;

export function setColorCycleStoreStateGetter(getter: () => StoreSlice): void {
  storeStateGetter = getter;
}

const getBrushSettings = (): BrushSettings => {
  return storeStateGetter?.().tools.brushSettings ?? defaultBrushSettings;
};

const getLayers = (): Layer[] => {
  return storeStateGetter?.().layers ?? [];
};

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
  setCanvasImplementation: (useCanvas2D: boolean) => void;
}

export function createColorCycleBrushManager(): ColorCycleBrushManager {
  const brushes = new Map<string, ColorCycleBrushImplementation>();
  const brushMetadata = new Map<string, ColorCycleBrushMetadata>();
  const activeResources = new Set<string>();
  
  const updateBrushWebGLState = (
    layerId: string,
    brush: BrushWithOptionalControls,
    useCanvas2DOverride?: boolean
  ) => {
    const wantsCanvas2D = useCanvas2DOverride ?? featureFlags.useCanvas2DColorCycle;
    const usingWebGL = !wantsCanvas2D && (brush.isUsingWebGL?.() ?? brush.usesWebGL ?? false);
    brush.usesWebGL = usingWebGL;

    if (usingWebGL) {
      activeResources.add(`webgl_${layerId}`);
    } else {
      activeResources.delete(`webgl_${layerId}`);
    }
  };
  
  return {
    brushes,
    brushMetadata,
    activeResources,
    
    createBrush(layerId: string, width: number, height: number, gradient?: Uint8Array) {
      // Clean up existing brush if any
      this.deleteBrush(layerId);

      // Create canvas for the brush
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const currentSettings = getBrushSettings();
      const brush = new ColorCycleBrushCanvas2D(canvas, {
        brushSize: currentSettings.size ?? defaultBrushSettings.size,
        fps: currentSettings.colorCycleFPS ?? 30,
        forceCanvas2D: featureFlags.useCanvas2DColorCycle
      });

      // Apply all current settings to the new brush instance
      if (typeof currentSettings.gradientBands === 'number') {
        brush.setGradientBands(currentSettings.gradientBands);
      }
      if (typeof currentSettings.spacing === 'number') {
        brush.setBandSpacing(currentSettings.spacing);
      }
      if (typeof currentSettings.pressureEnabled === 'boolean') {
        brush.setPressureEnabled(currentSettings.pressureEnabled);
      }
      if (typeof currentSettings.minPressure === 'number') {
        brush.setMinPressure(currentSettings.minPressure);
      }
      if (typeof currentSettings.maxPressure === 'number') {
        brush.setMaxPressure(currentSettings.maxPressure);
      }
      if (typeof currentSettings.ditherEnabled === 'boolean') {
        brush.setDitherEnabled(currentSettings.ditherEnabled);
      }
      if (typeof currentSettings.fillResolution === 'number') {
        brush.setDitherPixelSize(Math.max(1, Math.floor(currentSettings.fillResolution)));
      }

      const brushWithOptionalControls: BrushWithOptionalControls = brush;
      brushWithOptionalControls.setLayerId?.(layerId);
      brushWithOptionalControls.setTargetCanvas?.(canvas);

      // Apply per-layer speed if available
      const layer = getLayers().find(candidate => candidate.id === layerId);
      const perLayerSpeed = layer?.colorCycleData?.brushSpeed;
      if (typeof perLayerSpeed === 'number') {
        brushWithOptionalControls.setSpeed?.(perLayerSpeed);
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
      updateBrushWebGLState(layerId, brushWithOptionalControls);

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
      const brush = brushes.get(layerId) as BrushWithOptionalControls | undefined;
      if (brush) {
        // Cleanup brush resources
        brush.cleanup?.();

        brushes.delete(layerId);
        brushMetadata.delete(layerId);
        activeResources.delete(layerId);
        activeResources.delete(`canvas_${layerId}`);
        activeResources.delete(`webgl_${layerId}`);

        
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
      const layers = getLayers();

      brushMetadata.forEach((metadata, layerId) => {
        if (metadata.isActive) {
          return;
        }

        if (now - metadata.lastUsed <= maxInactiveMs) {
          return;
        }

        let shouldPreserve = false;
        // Keep brushes alive for layers that still own Color Cycle canvases so
        // previously painted animations remain playable when users hit "Play" later.
        const layer = layers.find(candidate => candidate.id === layerId);
        if (layer && layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor') {
          const hasCanvas = Boolean(layer.colorCycleData?.canvas);
          const isAnimating = Boolean(layer.colorCycleData?.isAnimating);
          if (hasCanvas || isAnimating) {
            shouldPreserve = true;
          }
        }

        if (shouldPreserve) {
          metadata.lastUsed = now;
          return;
        }

        toDelete.push(layerId);
      });

      toDelete.forEach(layerId => {
        this.deleteBrush(layerId);
      });

      
    },
    
    cleanupAll() {
      brushes.forEach((_, layerId) => {
        this.deleteBrush(layerId);
      });
    },

    setCanvasImplementation(useCanvas2D: boolean) {
      brushes.forEach((brush, layerId) => {
        const brushControls = brush as BrushWithOptionalControls;
        brushControls.setUseCanvas2D?.(useCanvas2D);
        updateBrushWebGLState(layerId, brushControls, useCanvas2D);
      });
    },

    // Enhanced lifecycle methods
    initColorCycleForLayer(layerId: string, width: number, height: number, gradient?: Uint8Array): boolean {
      // Check if brush already exists
      if (brushes.has(layerId)) {
        // Validate existing brush
        if (this.validateColorCycleBrush(layerId)) {
          // Apply current settings to existing brush to ensure it's up to date
          const currentSettings = getBrushSettings();
          const existingBrush = brushes.get(layerId);

          if (existingBrush) {
            if (typeof currentSettings.gradientBands === 'number') {
              existingBrush.setGradientBands(currentSettings.gradientBands);
            }
            if (typeof currentSettings.spacing === 'number') {
              existingBrush.setBandSpacing(currentSettings.spacing);
            }
            if (typeof currentSettings.pressureEnabled === 'boolean') {
              existingBrush.setPressureEnabled(currentSettings.pressureEnabled);
            }
            if (typeof currentSettings.minPressure === 'number') {
              existingBrush.setMinPressure(currentSettings.minPressure);
            }
            if (typeof currentSettings.maxPressure === 'number') {
              existingBrush.setMaxPressure(currentSettings.maxPressure);
            }
            if (typeof currentSettings.ditherEnabled === 'boolean') {
              existingBrush.setDitherEnabled(currentSettings.ditherEnabled);
            }
            if (typeof currentSettings.fillResolution === 'number') {
              existingBrush.setDitherPixelSize(Math.max(1, Math.floor(currentSettings.fillResolution)));
            }

            updateBrushWebGLState(layerId, existingBrush as BrushWithOptionalControls);
            activeResources.add(`canvas_${layerId}`);
          }

          return true;
        }
        // Invalid brush - cleanup before creating new
        
        this.removeColorCycleBrush(layerId);
      }
      
      try {
        // Create new isolated brush instance
        const brush = this.createBrush(layerId, width, height, gradient) as BrushWithOptionalControls;

        // Mark as isolated if method exists
        brush.setIsolated?.(true);

        updateBrushWebGLState(layerId, brush);
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
            
            return false;
          }
        }
        
        // 2. WebGL context (if used) is not lost
        if ('isContextLost' in brush && typeof brush.isContextLost === 'function') {
          if (brush.isContextLost()) {
            
            return false;
          }
        }
        
        // 3. Internal buffers are valid
        if ('hasValidBuffers' in brush && typeof brush.hasValidBuffers === 'function') {
          if (!brush.hasValidBuffers()) {
            
            return false;
          }
        }
        
        // 4. Layer ID matches (prevent cross-contamination)
        if ('getLayerId' in brush && typeof brush.getLayerId === 'function') {
          if (brush.getLayerId() !== layerId) {
            
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
      const brush = brushes.get(layerId) as BrushWithOptionalControls | undefined;

      if (brush) {
        // Call destroy method if available
        if (typeof brush.destroy === 'function') {
          try {
            brush.destroy();
          } catch (error) {
            console.error(`Error destroying brush for layer ${layerId}:`, error);
          }
        }

        // Call cleanup method if available
        if (typeof brush.cleanup === 'function') {
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

        
      }
    },
    
    cleanupOrphanedBrushes(validLayerIds: Set<string>): void {
      // Find orphaned brushes
      const orphaned = Array.from(brushes.keys())
        .filter(id => !validLayerIds.has(id));
      
      if (orphaned.length === 0) return;
      
      // Clean them up
      orphaned.forEach(layerId => {
        
        this.removeColorCycleBrush(layerId);
      });
      
      
    },
    
    transferColorCycleBrush(fromLayerId: string, toLayerId: string): boolean {
      const sourceBrush = brushes.get(fromLayerId) as BrushWithOptionalControls | undefined;
      const sourceMetadata = brushMetadata.get(fromLayerId);
      
      if (!sourceBrush || !sourceMetadata) {
        
        return false;
      }
      
      // Validate source brush before transfer
      if (!this.validateColorCycleBrush(fromLayerId)) {
        
        return false;
      }
      
      // Clean up target if exists
      if (brushes.has(toLayerId)) {
        this.removeColorCycleBrush(toLayerId);
      }
      
      // Update layer ID in brush if possible
      sourceBrush.setLayerId?.(toLayerId);
      
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

if (typeof window !== 'undefined') {
  window.addEventListener('vessel:featureFlagChange', (event) => {
    const detail = (event as CustomEvent<{ key?: string; value?: boolean }>).detail;
    if (detail?.key === 'useCanvas2DColorCycle' && typeof detail.value === 'boolean') {
      globalManager?.setCanvasImplementation(detail.value);
    }
  });
}

// Export types
export type { ColorCycleBrushImplementation };
