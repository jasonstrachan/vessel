import type { StateCreator } from 'zustand';

import { requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { clearSequentialLayerRendererLayer } from '@/lib/sequential/SequentialLayerRenderer';
import { syncPlaybackColorCycleLayers } from '@/stores/ccRuntime';
import {
  DEFAULT_CC_GRADIENT,
  cloneGradientStops,
  ensureColorCycleGradients,
  resolveLegacyGradientStops,
} from '@/stores/layers/layerColorCycleState';
import type {
  LayersSlice,
  UpdateLayerOptions,
} from '@/stores/layers/layersSliceTypes';
import type { AppState, VesselWindow } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';
import {
  auditColorCycleLayerTransition,
  summarizeColorCycleLayer,
} from '@/utils/colorCycle/ccMutationAudit';
import { logError } from '@/utils/debug';

type StoreSet = Parameters<StateCreator<AppState, [], [], AppState>>[0];
type StoreGet = Parameters<StateCreator<AppState, [], [], AppState>>[1];

type LayerUpdateActions = Pick<LayersSlice, 'updateLayer'>;

export interface LayerUpdateActionDeps {
  set: StoreSet;
  get: StoreGet;
  syncPercentOffsetsFromPixels: (layers: Layer[], project: Project | null) => Layer[];
  trackLayerChanges: (...args: unknown[]) => void;
  getVesselWindow: () => VesselWindow | undefined;
}

const omitUndefinedEntries = <T extends Record<string, unknown>>(value: T): Partial<T> => {
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  return Object.fromEntries(entries) as Partial<T>;
};

export const createLayerUpdateActions = ({
  set,
  get,
  syncPercentOffsetsFromPixels,
  trackLayerChanges,
  getVesselWindow,
}: LayerUpdateActionDeps): LayerUpdateActions => ({
  updateLayer: (id, updates, options?: UpdateLayerOptions) => {
    const stateBeforeUpdate = get();
    const originalLayerForAudit = stateBeforeUpdate.layers.find((layer) => layer.id === id) ?? null;
    const beforeAudit = summarizeColorCycleLayer(originalLayerForAudit);
    if ('layerType' in updates && updates.layerType !== 'sequential') {
      clearSequentialLayerRendererLayer(id);
    }
    const skipColorCycleSync = options?.skipColorCycleSync ?? false;
    const runtimeSync = { layer: null as Layer | null };
    set((state) => {
    const originalLayer = state.layers.find(l => l.id === id);

    // CRITICAL: Detect when a color-cycle layer is being changed to normal
    if (originalLayer?.layerType === 'color-cycle' &&
        updates.layerType === 'normal') {
      logError('Blocked color-cycle layer type downgrade in updateLayer', {
        layerId: id,
        updates,
      });
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
      logError('Blocked colorCycleData clear in updateLayer', {
        layerId: id,
      });
      // Only break into debugger when explicitly opted-in
      const debugWindow = getVesselWindow();
      if (debugWindow?.__TB_DEBUG?.breakOnLayerErrors) {
        debugger;
      }
    }


    // DEBUG: Log any layerType changes from color-cycle
    if (originalLayer && originalLayer.layerType === 'color-cycle' &&
        ('layerType' in updates && updates.layerType !== 'color-cycle')) {
      logError('Attempted to change color-cycle layer type', {
        layerId: id.substring(0, 20),
        attemptedLayerType: updates.layerType,
      });
    }

    let didUpdateMatchingLayer = false;
    let duplicateIdMatchCount = 0;
    const updatedLayers = state.layers.map(layer => {
      if (layer.id === id) {
        duplicateIdMatchCount += 1;
        if (didUpdateMatchingLayer) {
          return layer;
        }
        didUpdateMatchingLayer = true;
        // Start with a shallow copy
        const updatedLayer = { ...layer };

        // Special handling for colorCycleData updates
        if ('colorCycleData' in updates) {
          if (updates.colorCycleData) {
            // CRITICAL: Only allow colorCycleData updates on color-cycle layers
            if (layer.layerType !== 'color-cycle') {
              logError('Blocked colorCycleData update on normal layer', {
                layerId: layer.id?.substring(0, 20),
                layerType: layer.layerType
              });
              // Skip this update - don't add colorCycleData to normal layers
            } else {
              const sanitizedColorCyclePatch = omitUndefinedEntries(
                updates.colorCycleData as Record<string, unknown>
              ) as Layer['colorCycleData'];
              // Merging colorCycleData for color-cycle layer
              const mergedColorCycleData = {
                ...layer.colorCycleData,
                ...sanitizedColorCyclePatch
              };
              if (mergedColorCycleData.flowMode && mergedColorCycleData.flowMode !== 'forward') {
                mergedColorCycleData.flowMode = 'forward';
              }
              const legacyStops = resolveLegacyGradientStops(mergedColorCycleData);
              const fallbackStops = legacyStops
                ?? state.tools.brushSettings.colorCycleGradient
                ?? DEFAULT_CC_GRADIENT;
              const { gradientDefs, slotPalettes, activeGradientId, paintSlot, legacyRemap } = ensureColorCycleGradients(
                mergedColorCycleData,
                fallbackStops
              );
              const activeDef = gradientDefs.find((entry) => entry.id === activeGradientId)
                ?? gradientDefs[0];
              const shouldApplyLegacyStops = Boolean(legacyStops)
                && !sanitizedColorCyclePatch?.slotPalettes
                && !sanitizedColorCyclePatch?.gradientDefs;
              const updatedSlotPalettes = shouldApplyLegacyStops
                ? slotPalettes.map((entry) =>
                    entry.slot === activeDef.currentSlot
                      ? { ...entry, stops: (cloneGradientStops(legacyStops) ?? legacyStops) ?? entry.stops }
                      : entry
                  )
                : slotPalettes;
              const activeSlotPalette = updatedSlotPalettes.find((entry) => entry.slot === activeDef.currentSlot);
              updatedLayer.colorCycleData = {
                ...mergedColorCycleData,
                gradientDefs,
                slotPalettes: updatedSlotPalettes,
                activeGradientId,
                gradient: activeSlotPalette?.stops ?? legacyStops ?? mergedColorCycleData.gradient,
                paintSlot,
                legacyRemap,
              };
              // Layer is already color-cycle, keep it that way
              updatedLayer.layerType = 'color-cycle';
            }
          } else {
            // FORBIDDEN: CC layers cannot be converted to normal layers!
            logError('Blocked attempt to convert color-cycle layer to normal via colorCycleData clear', {
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
          logError('Blocked direct CC -> normal conversion', {
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

    if (duplicateIdMatchCount > 1) {
      logError('updateLayer detected duplicate layer IDs; only first match was updated', {
        layerId: id,
        duplicateIdMatchCount,
      });
    }

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

      const syncedLayer = syncedLayers.find(layer => layer.id === id);
      if (
        syncedLayer?.layerType === 'color-cycle' &&
        syncedLayer.colorCycleData &&
        !skipColorCycleSync
      ) {
        runtimeSync.layer = syncedLayer;
      }

      return {
        layers: syncedLayers,
        layersNeedRecomposition: needsRecomposition || state.layersNeedRecomposition
        // Remove the project update entirely - only update top-level layers
      };
    });
    if (runtimeSync.layer) {
      try {
        syncPlaybackColorCycleLayers([runtimeSync.layer], 'updateLayer');
        requestGradientApply(runtimeSync.layer.id, 'update-layer');
      } catch (error) {
        logError('[updateLayer] Failed to sync CC runtime', error);
      }
    }
    if ('visible' in updates) {
      get().markAllCompositeSegmentsDirty();
    } else {
      get().markCompositeSegmentsDirtyByLayerIds(
        [id],
        options?.dirtyRects
          ? { dirtyRectsByLayerId: new Map([[id, options.dirtyRects]]) }
          : undefined,
      );
    }
    const updatedLayerForAudit = get().layers.find((layer) => layer.id === id) ?? null;
    const afterAudit = summarizeColorCycleLayer(updatedLayerForAudit);
    auditColorCycleLayerTransition({
      event: 'layer-update-destructive',
      layerId: id,
      reason: 'updateLayer',
      before: beforeAudit,
      after: afterAudit,
      details: {
        updateKeys: Object.keys(updates),
        skipColorCycleSync: options?.skipColorCycleSync ?? false,
      },
    });
  },
});
