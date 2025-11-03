import type { StateCreator } from 'zustand';
import type { CanvasSnapshot, Layer, LayerAlignmentSettings, Project } from '@/types';
import { cloneLayerAlignment, normalizeLayers } from '@/utils/layoutDefaults';
import { computeLayerPercentOffset } from '@/utils/layerMetrics';
import { __DEV__, logError, recordBreadcrumb } from '@/utils/debug';
import { syncCCRuntimes } from '@/stores/ccRuntime';
import {
  getColorCycleBrushManager,
  type ColorCycleBrushImplementation,
  type ColorCycleBrushManager,
} from '@/stores/colorCycleBrushManager';
import { compositeBitmapManager } from '@/lib/performance/CompositeBitmapManager';
import type {
  CommitLayerStructureHistoryOptions,
  LayerHistorySnapshotOptions,
} from '@/stores/helpers/layerStructureHistory';
import type { AppState, CaptureROI, VesselWindow } from '../useAppStore';

const normalizeCaptureROI = (
  roi: CaptureROI | undefined,
  maxWidth: number,
  maxHeight: number
): CaptureROI | undefined => {
  if (!roi) {
    return undefined;
  }
  if (
    !Number.isFinite(roi.x) ||
    !Number.isFinite(roi.y) ||
    !Number.isFinite(roi.width) ||
    !Number.isFinite(roi.height)
  ) {
    return undefined;
  }
  if (roi.width <= 0 || roi.height <= 0) {
    return undefined;
  }
  const x = Math.max(0, Math.floor(roi.x));
  const y = Math.max(0, Math.floor(roi.y));
  const width = Math.max(1, Math.min(maxWidth - x, Math.ceil(roi.width)));
  const height = Math.max(1, Math.min(maxHeight - y, Math.ceil(roi.height)));
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
};

const mergeImageDataRegion = (
  base: ImageData | null,
  region: ImageData,
  offsetX: number,
  offsetY: number,
  fullWidth: number,
  fullHeight: number
): ImageData => {
  const targetWidth = fullWidth;
  const targetHeight = fullHeight;
  const baseMatches =
    base && base.width === targetWidth && base.height === targetHeight;
  const mergedData = baseMatches
    ? new Uint8ClampedArray(base!.data)
    : new Uint8ClampedArray(targetWidth * targetHeight * 4);

  const src = region.data;
  const rowStride = region.width * 4;
  for (let row = 0; row < region.height; row++) {
    const srcStart = row * rowStride;
    const destStart = ((offsetY + row) * targetWidth + offsetX) * 4;
    mergedData.set(src.subarray(srcStart, srcStart + rowStride), destStart);
  }

  return new ImageData(mergedData, targetWidth, targetHeight);
};

export interface LayersSlice {
  layers: Layer[];
  layersNeedRecomposition: boolean;
  activeLayerId: string | null;
  selectedLayerIds: string[];
  referenceLayerId: string | null;
  currentLayer: number;
  setLayersNeedRecomposition: (needed: boolean) => void;
  setLayers: (layers: Layer[]) => void;
  addLayer: (layer: Omit<Layer, 'id' | 'order'>) => string;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  setSelectedLayerIds: (layerIds: string[]) => void;
  setActiveLayer: (id: string) => void;
  setReferenceLayer: (id: string | null) => void;
  reorderLayers: (sourceIndex: number, destinationIndex: number) => void;
  updateLayerAlignment: (layerId: string, alignment: LayerAlignmentSettings) => void;
  initColorCycleForLayer: (layerId: string, width: number, height: number) => void;
  cleanupColorCycleForLayer: (layerId: string) => void;
  getLayerColorCycleBrush: (layerId: string) => ColorCycleBrushImplementation | null;
  compositeLayersToCanvas: (targetCanvas: HTMLCanvasElement) => void;
  captureCanvasToActiveLayer: (
    sourceCanvas?: HTMLCanvasElement,
    roi?: CaptureROI
  ) => Promise<void>;
  captureCanvasToLayer: (
    sourceCanvas: HTMLCanvasElement,
    targetLayerId: string | null
  ) => Promise<void>;
}

export interface LayersSliceOptions {
  syncPercentOffsetsFromPixels: (layers: Layer[], project: Project | null) => Layer[];
  trackLayerChanges: (...args: unknown[]) => void;
  colorCycleBrushManager: ColorCycleBrushManager;
  captureLayerStructureSnapshot: (
    state: AppState,
    options: LayerHistorySnapshotOptions
  ) => CanvasSnapshot;
  commitLayerStructureHistory: (options: CommitLayerStructureHistoryOptions) => void;
  getVesselWindow: () => VesselWindow | undefined;
}

export const createLayersSlice = (
  options: LayersSliceOptions,
): StateCreator<AppState, [], [], LayersSlice> =>
  (set, get) => {
    const {
      syncPercentOffsetsFromPixels,
      trackLayerChanges,
      colorCycleBrushManager,
      captureLayerStructureSnapshot,
      commitLayerStructureHistory,
      getVesselWindow,
    } = options;

    return {
      layers: [],
      layersNeedRecomposition: false,
      setLayersNeedRecomposition: (needed) => {
        set({ layersNeedRecomposition: needed });
      },
      setLayers: (incomingLayers) => {
        set((state) => {
          const normalized = normalizeLayers(
            incomingLayers.map((layer, index) => ({
              ...layer,
              order: index,
              alignment: cloneLayerAlignment(layer.alignment),
            })),
          );

          trackLayerChanges('setLayers', normalized);
          const syncedLayers = syncPercentOffsetsFromPixels(normalized, state.project ?? null);

          return {
            layers: syncedLayers,
          };
        });
      },
  // Layer Management - Start empty for SSR compatibility
  activeLayerId: null,
  selectedLayerIds: [],
  referenceLayerId: null,
  currentLayer: 0,
  addLayer: (layer) => {
    if (__DEV__) {
      // quiet
    }
    recordBreadcrumb('layers', { event: 'store-addLayer-enter', incomingType: layer?.layerType });
    const stateBeforeAdd = get();
    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeAdd, {
      actionType: 'layer-add',
      description: 'Add layer',
    });

    const newLayerId = `layer-${Date.now()}-${Math.random()}`;
    // quiet

    set((state) => {
      // quiet
      // CRITICAL CHECK: Verify existing layers are not mutated
      const existingLayersSnapshot = state.layers.map(l => ({
        id: l.id,
        type: l.layerType,
        hasCC: !!l.colorCycleData
      }));
      
      const newLayer = {
        ...layer,
        id: newLayerId,
        // Temporary order; will be normalized after insertion
        order: 0,
        alignment: cloneLayerAlignment(layer.alignment),
        transparencyLocked: layer.transparencyLocked === true,
        // CRITICAL: Preserve layerType EXACTLY - DO NOT convert CC layers to normal!
        layerType: layer.layerType || (
          (logError('CRITICAL: Layer missing layerType!', {
            layerId: newLayerId?.substring(0, 20),
            hasColorCycleData: !!layer.colorCycleData,
            fallbackToNormal: true
          }),
          'normal')
        )
      };
      
      // Insert the new layer directly ABOVE the currently active layer
      // Fallback: if no active layer, append to top of stack
      const activeIdx = state.activeLayerId
        ? state.layers.findIndex(l => l.id === state.activeLayerId)
        : -1;
      const insertedIndex = activeIdx >= 0 ? activeIdx + 1 : state.layers.length;
      const newLayers = [...state.layers];
      newLayers.splice(insertedIndex, 0, newLayer);

      // Normalize order values to match visual/composite order (ascending = bottom -> top)
      const updatedLayers = newLayers.map((l, idx) => ({ ...l, order: idx }));
      recordBreadcrumb('layers', { event: 'store-addLayer-updated', total: updatedLayers.length, insertedIndex });
      // quiet
      
      // Initialize ColorCycleBrush for color-cycle layers
      if (newLayer.layerType === 'color-cycle' && state.project) {
        const width = state.project.width || 1024;
        const height = state.project.height || 1024;
        // quiet

        // Use enhanced manager method for initialization
        // Note: gradient is in { position, color }[] format, but initColorCycleForLayer expects Uint8Array
        // Pass undefined to use default gradient
        const success = colorCycleBrushManager.initColorCycleForLayer(
          newLayerId, 
          width, 
          height, 
          undefined
        );
        
        if (!success) {
          console.error('Failed to initialize ColorCycleBrush for new layer:', newLayerId);
        } else {
          // Pre-create the animator to avoid lag on first paint
          const brush = colorCycleBrushManager.getBrush(newLayerId);
          if (brush && 'setSpeed' in brush && typeof brush.setSpeed === 'function') {
            // Call setSpeed to trigger animator creation internally
            // This ensures the animator is ready before first paint
            brush.setSpeed(1.0);
            // quiet
          }
        }
      }
      
      // VERIFY: Check if any existing layer lost its type
      // IMPORTANT: Compare by stable id, not by array index, because we inserted a new
      // layer and normalized order which shifts indices. Index-based comparison would
      // falsely report a mutation at and after the insertion point.
      existingLayersSnapshot.forEach((original) => {
        const updated = updatedLayers.find(l => l.id === original.id);
        if (!updated) {
          // Should never happen; log once for diagnostics without throwing
          console.error('🔴🔴🔴 LAYER MISSING AFTER ADD_LAYER (by id lookup):', {
            layerId: original.id.substring(0, 20),
            originalType: original.type
          });
          return;
        }
        if (original.type !== updated.layerType) {
          console.error('🔴🔴🔴 LAYER TYPE MUTATION IN ADD_LAYER:', {
            layerId: original.id.substring(0, 20),
            originalType: original.type,
            newType: updated.layerType,
            wasCC: original.hasCC,
            isCC: !!updated.colorCycleData
          });
        }
      });
      
      /* console.log('🔵 ADD LAYER RESULT:', {
        totalLayers: updatedLayers.length,
        layers: updatedLayers.map(l => ({
          id: l.id.substring(0, 20),
          type: l.layerType,
          hasCC: !!l.colorCycleData,
          hasGradient: !!l.colorCycleData?.gradient
        }))
      }); */
      
      const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

      return {
        layers: syncedLayers
      };
    });

    // Ensure the newly created layer becomes the active selection.
    try {
      const storeState = get();
      if (storeState.setActiveLayer) {
        if (storeState.activeLayerId !== newLayerId) {
          storeState.setActiveLayer(newLayerId);
        } else if (!storeState.selectedLayerIds.includes(newLayerId) && storeState.setSelectedLayerIds) {
          storeState.setSelectedLayerIds([newLayerId]);
        }
      }
    } catch (error) {
      logError('addLayer: failed to auto-select new layer', error);
      set(() => ({
        activeLayerId: newLayerId,
        selectedLayerIds: [newLayerId]
      }));
    }

    const stateAfterAdd = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterAdd, {
      actionType: 'layer-add',
      description: 'Add layer',
      activeLayerId: newLayerId,
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Add layer',
      metadata: { layerId: newLayerId, operation: 'add' },
    });

    return newLayerId;
  },
  removeLayer: (id) => {
    const stateBeforeRemove = get();
    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeRemove, {
      actionType: 'layer-remove',
      description: 'Remove layer',
    });

    set((state) => {
      // Use enhanced manager method for cleanup
      colorCycleBrushManager.removeColorCycleBrush(id);
      
      const updatedLayers = state.layers.filter(l => l.id !== id);
      const newActiveLayerId = state.activeLayerId === id ? 
        updatedLayers.find(l => l.id !== id)?.id || null : 
        state.activeLayerId;

      const filteredSelection = state.selectedLayerIds.filter(selectedId => {
        if (selectedId === id) {
          return false;
        }
        return updatedLayers.some(layer => layer.id === selectedId);
      });
      const nextSelection = filteredSelection.length > 0
        ? filteredSelection
        : (newActiveLayerId ? [newActiveLayerId] : []);
      
      trackLayerChanges('removeLayer RETURN', updatedLayers);
      const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
      return {
        layers: syncedLayers,
        activeLayerId: newActiveLayerId,
        selectedLayerIds: nextSelection,
        referenceLayerId: state.referenceLayerId === id ? null : state.referenceLayerId
      // Remove the project update entirely - only update top-level layers
    };
    });

    const stateAfterRemove = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterRemove, {
      actionType: 'layer-remove',
      description: 'Remove layer',
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Remove layer',
      metadata: { layerId: id, operation: 'remove' },
    });
  },
  updateLayer: (id, updates) => set((state) => {
    const originalLayer = state.layers.find(l => l.id === id);
    
    // CRITICAL: Detect when a color-cycle layer is being changed to normal
    if (originalLayer?.layerType === 'color-cycle' && 
        updates.layerType === 'normal') {
      console.error('🔴🔴🔴 LAYER TYPE CORRUPTION DETECTED');
      console.error('Stack trace:', new Error().stack);
      console.error('Layer being corrupted:', id);
      console.error('Update that caused it:', updates);
      // Only break into debugger when explicitly opted-in
      const debugWindow = getVesselWindow();
      if (debugWindow?.__TB_DEBUG?.breakOnLayerErrors) {
        debugger;
      }
    }
    
    // Also detect when colorCycleData is being cleared
    if (originalLayer?.colorCycleData && 
        'colorCycleData' in updates && 
        !updates.colorCycleData) {
      console.error('🔴🔴🔴 COLOR CYCLE DATA BEING CLEARED');
      console.error('Stack trace:', new Error().stack);
      console.error('Layer:', id);
      // Only break into debugger when explicitly opted-in
      const debugWindow = getVesselWindow();
      if (debugWindow?.__TB_DEBUG?.breakOnLayerErrors) {
        debugger;
      }
    }
    
    
    // DEBUG: Log any layerType changes from color-cycle
    if (originalLayer && originalLayer.layerType === 'color-cycle' && 
        ('layerType' in updates && updates.layerType !== 'color-cycle')) {
      console.error('🔴 CRITICAL WARNING: Changing color-cycle layer to:', updates.layerType, 'for layer:', id.substring(0, 20));
      console.trace('Stack trace for layer type change');
    }
    
    const updatedLayers = state.layers.map(layer => {
      if (layer.id === id) {
        // Start with a shallow copy
        const updatedLayer = { ...layer };
        
        // Special handling for colorCycleData updates
        if ('colorCycleData' in updates) {
          if (updates.colorCycleData) {
            // CRITICAL: Only allow colorCycleData updates on color-cycle layers
            if (layer.layerType !== 'color-cycle') {
              console.error('🚨 BLOCKED: Attempted to add colorCycleData to normal layer!', {
                layerId: layer.id?.substring(0, 20),
                layerType: layer.layerType
              });
              // Skip this update - don't add colorCycleData to normal layers
            } else {
              // Merging colorCycleData for color-cycle layer
              updatedLayer.colorCycleData = {
                ...layer.colorCycleData,
                ...updates.colorCycleData
              };
              // Layer is already color-cycle, keep it that way
              updatedLayer.layerType = 'color-cycle';
            }
          } else {
            // FORBIDDEN: CC layers cannot be converted to normal layers!
            console.error('🚨🚨🚨 BLOCKED: Attempted to convert CC layer to normal!', {
              layerId: layer.id?.substring(0, 20),
              originalType: layer.layerType,
              attemptedConversion: 'CC -> Normal - BLOCKED!'
            });
            // DO NOT delete colorCycleData or change layerType - preserve CC layer!
            // Keep the layer as-is to prevent conversion
          }
        }
        
        // Apply all other updates except colorCycleData
        const otherUpdates = { ...updates };
        delete (otherUpdates as Partial<typeof layer>).colorCycleData;
        Object.assign(updatedLayer, otherUpdates);
        
        // Protect against accidentally clearing layerType or colorCycleData
        // If the layer was color-cycle and we're not explicitly changing it
        if (layer.layerType === 'color-cycle' && 
            !('layerType' in updates) && 
            !('colorCycleData' in updates)) {
          // Ensure we preserve the color-cycle nature
          updatedLayer.layerType = 'color-cycle';
          updatedLayer.colorCycleData = layer.colorCycleData;
        }
        
        // FORBIDDEN: Never allow conversion from CC to normal!
        if (updates.layerType === 'normal' && layer.layerType === 'color-cycle') {
          console.error('🚨🚨🚨 BLOCKED: Direct conversion CC -> Normal!', {
            layerId: layer.id?.substring(0, 20),
            originalType: layer.layerType,
            attemptedType: updates.layerType,
            hasColorCycleData: !!layer.colorCycleData
          });
          // REVERT the layerType change - keep it as color-cycle
          updatedLayer.layerType = 'color-cycle';
          // DO NOT delete colorCycleData!
        } else if (updates.layerType === 'normal' && layer.layerType === 'normal') {
          // Safe: normal -> normal, can clear colorCycleData if any exists
          delete updatedLayer.colorCycleData;
        }
        
        return updatedLayer;
      }
      return layer;
    });

    // Check if visual properties changed that require recomposition
    const needsRecomposition = 'visible' in updates || 'opacity' in updates || 'blendMode' in updates || 
                               'colorCycleData' in updates || 'layerType' in updates;
    if (needsRecomposition) {
      // Visual property changed - triggering recomposition
    }
    
    // FINAL VERIFICATION: Check for unexpected CC -> Normal conversions
    const updatedLayer = updatedLayers.find(l => l.id === id);
    if (originalLayer?.layerType === 'color-cycle' && updatedLayer?.layerType === 'normal') {
      logError('LAYER CONVERSION DETECTED DESPITE PROTECTIONS!', {
        layerId: id.substring(0, 20),
        originalType: originalLayer.layerType,
        finalType: updatedLayer.layerType,
        hadColorCycleData: !!originalLayer.colorCycleData,
        hasColorCycleData: !!updatedLayer.colorCycleData,
        stackTrace: new Error().stack
      });
    }

    trackLayerChanges('updateLayer RETURN', updatedLayers);
    const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

    try {
      const syncedLayer = syncedLayers.find(layer => layer.id === id);
      if (syncedLayer?.layerType === 'color-cycle' && syncedLayer.colorCycleData) {
        syncCCRuntimes([syncedLayer], 'updateLayer');
      }
    } catch (error) {
      logError('[updateLayer] Failed to sync CC runtime', error);
    }

    return {
      layers: syncedLayers,
      layersNeedRecomposition: needsRecomposition || state.layersNeedRecomposition
      // Remove the project update entirely - only update top-level layers
    };
  }),
  setSelectedLayerIds: (layerIds) => set((state) => {
    const validIds = layerIds.filter((layerId, index, list) => {
      return list.indexOf(layerId) === index && state.layers.some(layer => layer.id === layerId);
    });

    return {
      selectedLayerIds: validIds
    };
  }),
  setActiveLayer: (id) => set((state) => {
    const layer = state.layers.find(l => l.id === id);
    if (!layer) {
      logError('setActiveLayer: Invalid layer ID', id);
      return state;
    }
    // quiet
    
    /* console.log('🟢 SET ACTIVE LAYER DEBUG:', {
      newActiveId: id?.substring(0, 20),
      oldActiveId: state.activeLayerId?.substring(0, 20),
      targetLayerType: layer?.layerType,
      targetHasCC: !!layer?.colorCycleData,
      allLayersBefore: state.layers.map(l => ({
        id: l.id.substring(0, 20),
        type: l.layerType,
        hasCC: !!l.colorCycleData,
        hasGradient: !!l.colorCycleData?.gradient
      }))
    }); */
    
    // When switching away from a color-cycle layer, mark it as inactive
    const currentActiveLayer = state.layers.find(l => l.id === state.activeLayerId);
    if (currentActiveLayer?.layerType === 'color-cycle' && currentActiveLayer.id !== id) {
      /* console.log('🟠 SWITCHING AWAY FROM CC LAYER:', {
        fromLayerId: currentActiveLayer.id.substring(0, 20),
        toLayerId: id?.substring(0, 20)
      }); */
      
      try {
        // Mark the old layer's brush as inactive
        if (colorCycleBrushManager) {
          if (state.activeLayerId) {
            try { colorCycleBrushManager.setActiveState(state.activeLayerId, false); } catch (e) { logError('CC cleanup error (non-fatal): setActiveState', e); }
            // End any active strokes
            try {
              const oldBrush = colorCycleBrushManager.getLayerColorCycleBrush(state.activeLayerId);
              oldBrush?.endStroke(state.activeLayerId);
            } catch (e) { logError('CC cleanup error (non-fatal): endStroke', e); }
          }
        }
      } catch {
        // quiet
      }
      // quiet
    }
    
    // If switching to a color-cycle layer in BRUSH context, validate/reinit brush resources.
    // Skip entirely when the Recolor tool is active so we don't override recolor mode.
    if (layer?.layerType === 'color-cycle' && state.tools.currentTool !== 'recolor') {
      /* console.log('🟣 SWITCHING TO CC LAYER:', {
        layerId: id.substring(0, 20),
        hasGradient: !!layer.colorCycleData?.gradient,
        gradientLength: layer.colorCycleData?.gradient?.length
      }); */
      
      // Validate and reinitialize if needed
      if (!colorCycleBrushManager.validateColorCycleBrush(id)) {
        
        const width = state.project?.width || 1024;
        const height = state.project?.height || 1024;
        // Note: gradient is in { position, color }[] format, but initColorCycleForLayer expects Uint8Array
        try {
          colorCycleBrushManager.initColorCycleForLayer(
          id, 
          width, 
          height, 
          undefined
        );
        } catch (e) {
          console.error('Error re-initializing CC brush on setActiveLayer:', e);
        }
        // quiet
      }
      
      // Mark as active
      try { colorCycleBrushManager.setActiveState(id, true); } catch (e) { console.error('CC setActiveState error:', e); }
      
      // Ensure brush tracks the active layer before runtime sync
      try {
        const colorCycleBrush = colorCycleBrushManager.getLayerColorCycleBrush(id);
        if (colorCycleBrush && 'setActiveLayer' in colorCycleBrush && typeof colorCycleBrush.setActiveLayer === 'function') {
          colorCycleBrush.setActiveLayer(id);
        }
      } catch {
        // quiet
      }
      
      // Remember the user's current brush context so we can restore it when leaving CC layers
      let savedRegularTool = state.tools.lastRegularTool;
      let savedBrushShape = state.tools.lastRegularBrushShape;
      if (state.tools.currentTool === 'brush' || state.tools.currentTool === 'eraser') {
        savedRegularTool = state.tools.currentTool;
        savedBrushShape = state.tools.brushSettings.brushShape;
      }

      const layerGradientStops = layer.colorCycleData?.gradient
        ?? layer.colorCycleData?.recolorSettings?.gradient;
      const gradientForBrushSettings = layerGradientStops
        ? layerGradientStops.map(stop => ({ ...stop }))
        : undefined;

      const nextBrushSettings = {
        ...state.tools.brushSettings,
        customBrushColorCycle: true,
        ...(gradientForBrushSettings ? { colorCycleGradient: gradientForBrushSettings } : {})
      };
      if (typeof layer.colorCycleData?.brushSpeed === 'number') {
        nextBrushSettings.colorCycleSpeed = layer.colorCycleData.brushSpeed;
      }
      const resolvedFlowMode = layer.colorCycleData?.flowMode ?? state.tools.brushSettings.colorCycleFlowMode ?? 'forward';
      nextBrushSettings.colorCycleFlowMode = resolvedFlowMode;

      const result = {
        activeLayerId: id,
        selectedLayerIds: [id],
        tools: {
          ...state.tools,
          lastRegularTool: savedRegularTool,
          lastRegularBrushShape: savedBrushShape,
          lastColorCycleShapeMode: state.tools.shapeMode,
          brushSettings: nextBrushSettings
        }
      };

      try {
        syncCCRuntimes([layer], 'setActiveLayer');
      } catch (error) {
        logError('[setActiveLayer] Failed to sync CC runtime', error);
      }
      
      /* console.log('🟢 SET ACTIVE LAYER RESULT (CC):', {
        activeLayerId: result.activeLayerId.substring(0, 20),
        gradientSet: !!result.tools.brushSettings.colorCycleGradient,
        allLayersAfter: state.layers.map(l => ({
          id: l.id.substring(0, 20),
          type: l.layerType,
          hasCC: !!l.colorCycleData
        }))
      }); */
      
      return result;
    }
    
    // When switching to a regular layer from color cycle, restore last regular tool
    const baseBrushSettings = {
      ...state.tools.brushSettings,
      customBrushColorCycle: false
    };

    let nextTools = {
      ...state.tools,
      brushSettings: baseBrushSettings
    };
    const wasOnColorCycle = currentActiveLayer?.layerType === 'color-cycle';
    // Only restore last regular tool if we're NOT explicitly in recolor tool
    if (wasOnColorCycle && layer && layer.layerType === 'normal' && state.tools.currentTool !== 'recolor') {
      // Restore the last regular tool and brush shape
      const lastTool = state.tools.lastRegularTool ?? 'brush';
      const lastShape = state.tools.lastRegularBrushShape ?? state.tools.brushSettings.brushShape;

      nextTools = {
        ...nextTools,
        currentTool: lastTool,
        brushSettings: {
          ...baseBrushSettings,
          brushShape: lastShape
        }
      };
    }

    const result = {
      activeLayerId: id,
      selectedLayerIds: [id],
      tools: nextTools
      // DO NOT return layers unless we're actually changing them
    };
    
    /* console.log('🟢 SET ACTIVE LAYER RESULT (NORMAL):', {
      activeLayerId: id?.substring(0, 20),
      allLayersAfter: state.layers.map(l => ({
        id: l.id.substring(0, 20),
        type: l.layerType,
        hasCC: !!l.colorCycleData
      })),
      returnedLayers: 'layers' in result
    }); */
    
    // Debug checks removed - the race condition has been fixed
    
    return result;
  }),
  setReferenceLayer: (id) => set((state) => {
    if (id && !state.layers.some(layer => layer.id === id)) {
      return { referenceLayerId: null };
    }

    return { referenceLayerId: id ?? null };
  }),
  updateLayerAlignment: (layerId, alignment) => set((state) => {
    const targetLayer = state.layers.find(layer => layer.id === layerId);

    if (!targetLayer) {
      return { layers: state.layers };
    }

    let nextAlignment = cloneLayerAlignment(alignment);

    const previousAlignment = targetLayer.alignment;
    const becameAuto = nextAlignment.positioning === 'auto' && previousAlignment.positioning !== 'auto';
    const previousPercent = previousAlignment.offsetPercent ?? { x: 0, y: 0 };
    const nextPercent = nextAlignment.offsetPercent ?? { x: 0, y: 0 };
    const offsetPercentChanged = previousPercent.x !== nextPercent.x || previousPercent.y !== nextPercent.y;

    if (state.project) {
      if (becameAuto && !offsetPercentChanged) {
        try {
          const percentOffset = computeLayerPercentOffset(targetLayer, state.project);
          nextAlignment = {
            ...nextAlignment,
            offsetPercent: percentOffset
          };
        } catch (error) {
          console.warn('[useAppStore] Failed to compute percent offset during alignment update', error);
        }
      }

      if (nextAlignment.positioning === 'auto') {
        const percent = nextAlignment.offsetPercent ?? { x: 0, y: 0 };
        const width = Math.max(1, state.project.width);
        const height = Math.max(1, state.project.height);
        nextAlignment = {
          ...nextAlignment,
          offsetPercent: percent,
          offsetPx: {
            x: Math.round((percent.x / 100) * width),
            y: Math.round((percent.y / 100) * height)
          }
        };
      } else {
        nextAlignment = {
          ...nextAlignment,
          offsetPercent: undefined
        };
      }
    } else if (nextAlignment.positioning !== 'auto') {
      nextAlignment = {
        ...nextAlignment,
        offsetPercent: undefined
      };
    }

    const updatedLayers = state.layers.map(layer => (
      layer.id === layerId
        ? { ...layer, alignment: nextAlignment }
        : layer
    ));

    const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

    return {
      layers: syncedLayers,
      layersNeedRecomposition: true
    };
  }),
  reorderLayers: (sourceIndex, destinationIndex) => {
    const stateBeforeReorder = get();
    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeReorder, {
      actionType: 'layer-reorder',
      description: 'Reorder layers',
    });

    set((state) => {
      const newLayers = [...state.layers];
      const [removed] = newLayers.splice(sourceIndex, 1);
      newLayers.splice(destinationIndex, 0, removed);
      
      // Update order values
      const updatedLayers = newLayers.map((layer, index) => ({
        ...layer,
        order: index
      }));
      
      // Layer order changed - triggering recomposition
      
      const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

      return {
        layers: syncedLayers,
        layersNeedRecomposition: true
        // Remove the project update entirely - only update top-level layers
      };
    });

    const stateAfterReorder = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterReorder, {
      actionType: 'layer-reorder',
      description: 'Reorder layers',
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Reorder layers',
      metadata: { operation: 'reorder' },
    });
  },

  // Color Cycle Layer Management
  initColorCycleForLayer: (layerId, width, height) => set((state) => {
    try {
      const layer = state.layers.find(l => l.id === layerId);
      if (!layer) {
        console.error('[Store] Layer not found:', layerId);
        return {};
      }
      
      // CRITICAL: Only allow initialization for color-cycle layers
      if (layer.layerType !== 'color-cycle') {
        console.error('🚨 BLOCKED: Attempted to init color cycle for non-CC layer!', {
          layerId: layerId.substring(0, 20),
          layerType: layer.layerType
        });
        return {}; // Prevent color cycle initialization on regular layers
      }
      
      // GUARD: Don't re-initialize if already initialized
      const existingBrush = colorCycleBrushManager.getBrush(layerId);
      if (existingBrush) {
        // quiet
        // Ensure the layer has a valid canvas and CC metadata even if we skip recreation.
        const updatedLayers = state.layers.map(l => {
          if (l.id !== layerId) return l;
          const existingCanvas = l.colorCycleData?.canvas;
          const brushWithControls = existingBrush as typeof existingBrush & {
            setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
          };
          const layerCanvas =
            typeof HTMLCanvasElement !== 'undefined' && existingCanvas instanceof HTMLCanvasElement
              ? existingCanvas
              : undefined;
          if (layerCanvas && brushWithControls.setTargetCanvas) {
            brushWithControls.setTargetCanvas(layerCanvas);
          }
          const canvas = existingBrush.getCanvas ? existingBrush.getCanvas() : layerCanvas ?? existingCanvas;
          return {
            ...l,
            layerType: 'color-cycle' as const,
            colorCycleData: {
              ...(l.colorCycleData || {}),
              // Preserve existing gradient if any
              gradient: l.colorCycleData?.gradient || state.tools.brushSettings.colorCycleGradient || l.colorCycleData?.gradient,
              colorCycleBrush: existingBrush,
              // Keep current animation state if present; default to true for responsiveness
              isAnimating: l.colorCycleData?.isAnimating ?? true,
              // Ensure per-layer brush speed exists
              brushSpeed: l.colorCycleData?.brushSpeed ?? (state.tools.brushSettings.colorCycleSpeed || 0.1),
              flowMode: l.colorCycleData?.flowMode ?? (state.tools.brushSettings.colorCycleFlowMode ?? 'forward'),
              canvas
            }
          };
        });
        trackLayerChanges('initColorCycleForLayer (hydrate existing)', updatedLayers);
        const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
        return { layers: syncedLayers };
      }
      
      // Validate dimensions
      const safeWidth = Math.max(width || 1024, 1);
      const safeHeight = Math.max(height || 1024, 1);
      
      // Create a canvas element for this layer's color cycle
      // Use the current brush gradient if available
      const currentBrushGradient = state.tools.brushSettings.colorCycleGradient;
      const gradient = currentBrushGradient || layer?.colorCycleData?.gradient || [
        { position: 0.0, color: '#ff0000' },
        { position: 0.17, color: '#ff7f00' },
        { position: 0.33, color: '#ffff00' },
        { position: 0.5, color: '#00ff00' },
        { position: 0.67, color: '#0000ff' },
        { position: 0.83, color: '#4b0082' },
        { position: 1.0, color: '#9400d3' }
      ];
      
      // Convert gradient to Uint8Array for brush creation
      const gradientArray = new Uint8Array(256 * 3);
      // Simple gradient interpolation (can be improved)
      for (let i = 0; i < 256; i++) {
        const t = i / 255;
        // Find gradient stops
        const color = { r: 255, g: 0, b: 0 }; // Default red
        for (let j = 0; j < gradient.length - 1; j++) {
          if (t >= gradient[j].position && t <= gradient[j + 1].position) {
            // Interpolate between colors
            const t0 = gradient[j].position;
            const t1 = gradient[j + 1].position;
            const localT = (t - t0) / (t1 - t0);
            
            const c0 = parseInt(gradient[j].color.substring(1), 16);
            const c1 = parseInt(gradient[j + 1].color.substring(1), 16);
            
            const r0 = (c0 >> 16) & 0xff;
            const g0 = (c0 >> 8) & 0xff;
            const b0 = c0 & 0xff;
            
            const r1 = (c1 >> 16) & 0xff;
            const g1 = (c1 >> 8) & 0xff;
            const b1 = c1 & 0xff;
            
            color.r = Math.round(r0 + (r1 - r0) * localT);
            color.g = Math.round(g0 + (g1 - g0) * localT);
            color.b = Math.round(b0 + (b1 - b0) * localT);
            break;
          }
        }
        gradientArray[i * 3] = color.r;
        gradientArray[i * 3 + 1] = color.g;
        gradientArray[i * 3 + 2] = color.b;
      }
      
      // Create brush through manager
      const colorCycleBrush = colorCycleBrushManager.createBrush(layerId, safeWidth, safeHeight, gradientArray);
      
      if (!colorCycleBrush) {
        console.error('[Store] Failed to create color cycle brush');
        return {};
      }

      let layerCanvas: HTMLCanvasElement | undefined;
      if (typeof document !== 'undefined') {
        const offscreen = document.createElement('canvas');
        offscreen.width = safeWidth;
        offscreen.height = safeHeight;
        layerCanvas = offscreen;
      } else if (colorCycleBrush.getCanvas) {
        layerCanvas = colorCycleBrush.getCanvas();
      }

      const brushWithControls = colorCycleBrush as typeof colorCycleBrush & {
        setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
        renderDirectToCanvas?: (targetCanvas: HTMLCanvasElement, layerId: string) => void;
      };
      if (layerCanvas && brushWithControls.setTargetCanvas) {
        brushWithControls.setTargetCanvas(layerCanvas);
      }
      if (layerCanvas && brushWithControls.renderDirectToCanvas) {
        try {
          brushWithControls.renderDirectToCanvas(layerCanvas, layerId);
        } catch {
          // best effort; canvas will be populated on next stroke
        }
      }

    const updatedLayers = state.layers.map(l => {
      if (l.id !== layerId) {
        return l;
      }

      let eraseMask = l.colorCycleData?.eraseMask;
      let eraseMaskVersion = l.colorCycleData?.eraseMaskVersion ?? 0;

      if (typeof document !== 'undefined') {
        if (eraseMask) {
          if (eraseMask.width !== safeWidth || eraseMask.height !== safeHeight) {
            const resized = document.createElement('canvas');
            resized.width = safeWidth;
            resized.height = safeHeight;
            const ctx = resized.getContext('2d');
            if (ctx) {
              ctx.drawImage(
                eraseMask,
                0,
                0,
                eraseMask.width,
                eraseMask.height,
                0,
                0,
                safeWidth,
                safeHeight
              );
            }
            eraseMask = resized;
            eraseMaskVersion =
              typeof l.colorCycleData?.eraseMaskVersion === 'number'
                ? l.colorCycleData.eraseMaskVersion + 1
                : 1;
          }
        } else {
          const maskCanvas = document.createElement('canvas');
          maskCanvas.width = safeWidth;
          maskCanvas.height = safeHeight;
          eraseMask = maskCanvas;
          eraseMaskVersion = 0;
        }
      }

      return {
        ...l,
        layerType: 'color-cycle' as const,
        colorCycleData: {
          gradient: gradient || [],
          colorCycleBrush,
          isAnimating: true,
          // Initialize per-layer brush speed from current brush settings
          brushSpeed: state.tools.brushSettings.colorCycleSpeed || 0.1,
          flowMode: state.tools.brushSettings.colorCycleFlowMode ?? 'forward',
          canvas: layerCanvas ?? (colorCycleBrush.getCanvas ? colorCycleBrush.getCanvas() : undefined),
          eraseMask,
          eraseMaskVersion
        }
      };
    });
    
    trackLayerChanges('initColorCycleForLayer RETURN', updatedLayers);
    const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
    return {
      layers: syncedLayers
      // Remove the project update entirely - only update top-level layers
    };
    } catch (error) {
      console.error('[Store] Error initializing color cycle:', error);
      return {}; // Return empty partial state on error
    }
  }),

  cleanupColorCycleForLayer: (layerId) => set((state) => {
    const layer = state.layers.find(l => l.id === layerId);
    // CRITICAL: Only cleanup color-cycle layers, never touch normal layers
    if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) return state;
    
    // Cleanup through manager
    colorCycleBrushManager.deleteBrush(layerId);
    
    // CRITICAL FIX: Don't change the layer type when cleaning up!
    // We're just disposing Canvas2D resources, not converting the layer
    const updatedLayers = state.layers.map(l => 
      l.id === layerId 
        ? {
            ...l,
            // Keep the layer type as is - don't change it!
            colorCycleData: {
              ...l.colorCycleData,
              colorCycleBrush: undefined // Just clear the brush instance
            }
          }
        : l
    );
    
    const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
    return {
      layers: syncedLayers
    };
  }),

  compositeLayersToCanvas: (targetCanvas) => {
    const state = get();

    const createLayerTransferCanvas = (width: number, height: number) => {
      if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height);
      }
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = width;
      layerCanvas.height = height;
      return layerCanvas;
    };

    try {
      if (!state.project || !state.layers.length) {
        get().setCurrentCompositeBitmap(null);
        return;
      }

      const expectedWidth = state.project.width;
      const expectedHeight = state.project.height;

      if (targetCanvas.width !== expectedWidth || targetCanvas.height !== expectedHeight) {
        targetCanvas.width = expectedWidth;
        targetCanvas.height = expectedHeight;
      }

      const baseCtx = targetCanvas.getContext(
        '2d',
        { willReadFrequently: true } as CanvasRenderingContext2DSettings
      ) as CanvasRenderingContext2D | null;
      if (!baseCtx) {
        get().setCurrentCompositeBitmap(null);
        return;
      }

      const currentState = get();
      const isPixelBrush =
        currentState.tools.brushSettings.brushShape === 'pixel_round' ||
        (currentState.tools.brushSettings.brushShape === 'square' &&
          !currentState.tools.brushSettings.antialiasing);
      baseCtx.imageSmoothingEnabled = !isPixelBrush;

      const manager = colorCycleBrushManager ?? getColorCycleBrushManager();

      const drawLayers = (
        ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
      ) => {
        ctx.clearRect(0, 0, expectedWidth, expectedHeight);

        if (state.project?.backgroundColor && state.project.backgroundColor !== 'transparent') {
          ctx.fillStyle = state.project.backgroundColor;
          ctx.fillRect(0, 0, expectedWidth, expectedHeight);
        }

        const sortedLayers = [...state.layers].sort((a, b) => a.order - b.order);

        for (const layer of sortedLayers) {
          try {
            if (!layer.visible) continue;

            if (
              layer.layerType === 'color-cycle' &&
              layer.colorCycleData?.canvas &&
              layer.colorCycleData?.mode !== 'recolor'
            ) {
              const brush = manager?.getBrush(layer.id);
              const wantPlaying = Boolean(layer.colorCycleData.isAnimating);

              if (brush) {
                try {
                  const playing = typeof brush.isPlaying === 'function' ? brush.isPlaying() : false;

                  if (wantPlaying && !playing) {
                    brush.startAnimation?.();
                  } else if (!wantPlaying && playing) {
                    brush.stopAnimation?.();
                  }

                  if (wantPlaying) {
                    brush.updateAnimation?.();
                  }
                  brush.renderDirectToCanvas?.(layer.colorCycleData.canvas, layer.id);
                } catch (error) {
                  logError('[compose] CC advance/render failed', error);
                }
              }

              ctx.globalCompositeOperation = layer.blendMode;
              ctx.globalAlpha = layer.opacity;
              ctx.drawImage(layer.colorCycleData.canvas, 0, 0);
              continue;
            }

            if (
              layer.layerType === 'color-cycle' &&
              layer.colorCycleData?.mode === 'recolor' &&
              layer.colorCycleData.canvas
            ) {
              ctx.globalCompositeOperation = layer.blendMode;
              ctx.globalAlpha = layer.opacity;
              ctx.drawImage(layer.colorCycleData.canvas, 0, 0);
              continue;
            }

            if (!layer.imageData) {
              continue;
            }

            const layerImageData = layer.imageData;
            const layerCanvas = createLayerTransferCanvas(layerImageData.width, layerImageData.height);
            const layerCtx = layerCanvas.getContext(
              '2d',
              { willReadFrequently: true } as CanvasRenderingContext2DSettings
            ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
            if (!layerCtx) {
              continue;
            }
            layerCtx.putImageData(layerImageData, 0, 0);
            ctx.globalCompositeOperation = layer.blendMode;
            ctx.globalAlpha = layer.opacity;
            ctx.drawImage(layerCanvas as CanvasImageSource, 0, 0);
          } catch (layerError) {
            logError('[compose] Layer compose error', layerError);
          }
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;
      };

      const renderWithFallback = () => {
        drawLayers(baseCtx);
        get().setCurrentCompositeBitmap(null);
      };

      if (compositeBitmapManager.isSupported()) {
        void compositeBitmapManager
          .render(expectedWidth, expectedHeight, drawLayers, targetCanvas)
          .then((bitmap) => {
            const setBitmap = get().setCurrentCompositeBitmap;
            setBitmap(bitmap ?? null);
          })
          .catch((error) => {
            logError('[compose] compositeBitmapManager.render failed', error);
            renderWithFallback();
          });
        return;
      }

      renderWithFallback();
    } catch (error) {
      logError('[compose] Failed to composite layers', error);
      get().setCurrentCompositeBitmap(null);
    }
  },

  captureCanvasToActiveLayer: async (sourceCanvas, roi) => {
    const state = get();

    if (state.history.isCapturing) {
      return;
    }
    if (!state.project || state.layers.length === 0) {
      return;
    }
    if (!sourceCanvas) {
      return;
    }

    const ctx = sourceCanvas.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings
    ) as CanvasRenderingContext2D | null;
    if (!ctx) {
      return;
    }

    try {
      const projectWidth = state.project.width;
      const projectHeight = state.project.height;
      const captureWidth = Math.min(projectWidth, sourceCanvas.width);
      const captureHeight = Math.min(projectHeight, sourceCanvas.height);

      const normalizedRoi = normalizeCaptureROI(roi, captureWidth, captureHeight);
      const captureX = normalizedRoi ? normalizedRoi.x : 0;
      const captureY = normalizedRoi ? normalizedRoi.y : 0;
      const regionWidth = normalizedRoi ? normalizedRoi.width : captureWidth;
      const regionHeight = normalizedRoi ? normalizedRoi.height : captureHeight;

      const capturedImageData = ctx.getImageData(captureX, captureY, regionWidth, regionHeight);

      const activeLayerId = state.activeLayerId || state.layers[0]?.id;
      if (!activeLayerId) {
        return;
      }

      set((currentState) => {
        const updatedLayers = currentState.layers.map((layer) => {
          if (layer.id !== activeLayerId) {
            return layer;
          }

          const fb = layer.framebuffer;
          if (fb.width !== captureWidth || fb.height !== captureHeight) {
            fb.width = captureWidth;
            fb.height = captureHeight;
          }

          const framebufferCtx = fb.getContext(
            '2d',
            { willReadFrequently: true } as CanvasRenderingContext2DSettings
          ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          if (framebufferCtx) {
            if (normalizedRoi) {
              framebufferCtx.putImageData(capturedImageData, captureX, captureY);
            } else {
              framebufferCtx.clearRect(0, 0, fb.width, fb.height);
              framebufferCtx.putImageData(capturedImageData, 0, 0);
            }
          }

          const baseImageData =
            layer.imageData &&
            layer.imageData.width === captureWidth &&
            layer.imageData.height === captureHeight
              ? layer.imageData
              : null;

          const mergedImageData = normalizedRoi
            ? mergeImageDataRegion(
                baseImageData,
                capturedImageData,
                captureX,
                captureY,
                captureWidth,
                captureHeight
              )
            : capturedImageData;

          let nextAlignment = layer.alignment;
          const project = currentState.project;
          if (project && nextAlignment && nextAlignment.positioning === 'auto') {
            try {
              const layerForMetrics: Layer = {
                ...layer,
                imageData: mergedImageData,
                alignment: {
                  ...nextAlignment,
                  offsetPercent: undefined,
                  offsetPx: undefined,
                },
              };
              const percentOffset = computeLayerPercentOffset(layerForMetrics, project);
              const safeWidth = Math.max(1, project.width);
              const safeHeight = Math.max(1, project.height);
              nextAlignment = {
                ...nextAlignment,
                offsetPercent: percentOffset,
                offsetPx: {
                  x: Math.round((percentOffset.x / 100) * safeWidth),
                  y: Math.round((percentOffset.y / 100) * safeHeight),
                },
              };
            } catch (error) {
              console.warn('[captureCanvasToActiveLayer] Failed to sync percent alignment', error);
            }
          }

          const updatedLayer: Layer = {
            ...layer,
            imageData: mergedImageData,
            alignment: nextAlignment,
            version: (layer.version || 0) + 1,
          };

          if (updatedLayer.layerType !== layer.layerType) {
            console.error('🚨 LAYER TYPE CORRUPTION IN CAPTURE!', {
              layerId: layer.id?.substring(0, 20),
              originalType: layer.layerType,
              corruptedType: updatedLayer.layerType,
            });
            updatedLayer.layerType = layer.layerType;
          }

          return updatedLayer;
        });

        const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, currentState.project ?? null);
        return {
          layers: syncedLayers,
        };
      });

      get().setLayersNeedRecomposition(true);

      const nextState = get();
      const activeLayer = nextState.layers.find((layer) => layer.id === activeLayerId);
      if (activeLayer && activeLayer.layerType === 'color-cycle') {
        try {
          nextState.updateLayer(activeLayerId, {
            colorCycleData: {
              ...(activeLayer.colorCycleData ?? {}),
            },
          });
        } catch (error) {
          console.warn('[captureCanvasToActiveLayer] Failed to flag CC framebuffer update', error);
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        console.warn('[captureCanvasToActiveLayer] Canvas capture blocked by CORS/security policy');
        return;
      }
      logError('[captureCanvasToActiveLayer] Failed', error);
      throw error;
    }
  },

  captureCanvasToLayer: async (sourceCanvas, targetLayerId) => {
    const state = get();
    if (state.history.isCapturing) {
      return;
    }
    if (!state.project || state.layers.length === 0) {
      return;
    }
    if (!targetLayerId) {
      return;
    }

    const ctx = sourceCanvas.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings
    ) as CanvasRenderingContext2D | null;
    if (!ctx) {
      return;
    }

    try {
      const captureWidth = Math.min(state.project.width, sourceCanvas.width);
      const captureHeight = Math.min(state.project.height, sourceCanvas.height);
      const imageData = ctx.getImageData(0, 0, captureWidth, captureHeight);

      const targetLayer = state.layers.find((layer) => layer.id === targetLayerId);
      if (!targetLayer) {
        return;
      }

      set((currentState) => {
        const updatedLayers = currentState.layers.map((layer) => {
          if (layer.id !== targetLayerId) {
            return layer;
          }

          const fb = layer.framebuffer;
          if (fb.width !== imageData.width || fb.height !== imageData.height) {
            fb.width = imageData.width;
            fb.height = imageData.height;
          }

          const ctx2 = fb.getContext(
            '2d',
            { willReadFrequently: true } as CanvasRenderingContext2DSettings
          ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          if (ctx2) {
            ctx2.clearRect(0, 0, fb.width, fb.height);
            ctx2.putImageData(imageData, 0, 0);
          }

          return {
            ...layer,
            imageData,
          };
        });

        const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, currentState.project ?? null);
        return {
          layers: syncedLayers,
        };
      });

      get().setLayersNeedRecomposition(true);
    } catch (error) {
      console.error('Capture to specific layer failed with error:', error);
    }
  },

  getLayerColorCycleBrush: (layerId) => {
    // CRITICAL: Verify layer is actually a color-cycle layer
    const state = get();
    const layer = state.layers.find(l => l.id === layerId);
    if (layer && layer.layerType !== 'color-cycle') {
      // Silently return null for non-CC layers - this is expected behavior
      return null; // Never return a CC brush for regular layers
    }
    
    // Get from manager
    return colorCycleBrushManager.getBrush(layerId) ?? null;
  },

    };
  };
