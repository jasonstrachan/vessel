import type { StateCreator } from 'zustand';

import { getColorCycleLegacyLayerBuffer } from '@/lib/colorCycle/document';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import {
  getColorCycleHydrationState,
  updateLayerColorCycleHydrationState,
} from '@/stores/layerHydration';
import {
  DEFAULT_CC_GRADIENT,
  cloneGradientStops,
  collectUsedSlots,
  ensureColorCycleGradients,
  ensureGradientDefIdBuffer,
  ensureGradientIdBuffer,
  gradientStopsToUint8Array,
  hashStopsForDef,
  migrateGradientIdBuffer,
} from '@/stores/layers/layerColorCycleState';
import {
  hasWarmableColorCycleRuntimeSource,
  isDocumentColdColorCycleLayer,
} from '@/stores/layers/layerColorCycleRuntimePolicy';
import { commitColorCycleGradientBuffersToDocument } from '@/stores/layers/layerColorCycleSnapshotState';
import type {
  EnsureColorCycleLayerRuntimeTarget,
  LayersSlice,
} from '@/stores/layers/layersSliceTypes';
import type { AppState } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';
import { logError } from '@/utils/debug';

type StoreSet = Parameters<StateCreator<AppState, [], [], AppState>>[0];
type StoreGet = Parameters<StateCreator<AppState, [], [], AppState>>[1];

type LayerColorCycleLifecycleActions = Pick<
  LayersSlice,
  'initColorCycleForLayer' | 'cleanupColorCycleForLayer' | 'ensureColorCycleLayerRuntime'
>;

export interface LayerColorCycleLifecycleActionDeps {
  set: StoreSet;
  get: StoreGet;
  colorCycleBrushManager: ColorCycleBrushManager;
  syncPercentOffsetsFromPixels: (layers: Layer[], project: Project | null) => Layer[];
  trackLayerChanges: (...args: unknown[]) => void;
  scheduleDeferredColorCycleRestore: (
    layerId: string,
    target: EnsureColorCycleLayerRuntimeTarget,
  ) => Promise<void>;
}

export const createLayerColorCycleLifecycleActions = ({
  set,
  get,
  colorCycleBrushManager,
  syncPercentOffsetsFromPixels,
  trackLayerChanges,
  scheduleDeferredColorCycleRestore,
}: LayerColorCycleLifecycleActionDeps): LayerColorCycleLifecycleActions => ({
  initColorCycleForLayer: (layerId, width, height) => {
    set((state) => {
    try {
      const layer = state.layers.find(l => l.id === layerId);
      if (!layer) {
        logError('[Store] Layer not found', { layerId });
        return {};
      }

      // CRITICAL: Only allow initialization for color-cycle layers
      if (layer.layerType !== 'color-cycle') {
        logError('Blocked initColorCycleForLayer for non-color-cycle layer', {
          layerId: layerId.substring(0, 20),
          layerType: layer.layerType
        });
        return {}; // Prevent color cycle initialization on regular layers
      }

      const safeWidth = Math.max(
        width || layer.colorCycleData?.canvasWidth || state.project?.width || 1024,
        1
      );
      const safeHeight = Math.max(
        height || layer.colorCycleData?.canvasHeight || state.project?.height || 1024,
        1
      );
      const fallbackStops = state.tools.brushSettings.colorCycleGradient ?? DEFAULT_CC_GRADIENT;
      const { gradientDefs, slotPalettes, activeGradientId, paintSlot, legacyRemap } = ensureColorCycleGradients(
        layer.colorCycleData,
        fallbackStops
      );
      const activeDef = gradientDefs.find((entry) => entry.id === activeGradientId) ?? gradientDefs[0];
      const activeSlotPalette = slotPalettes.find((entry) => entry.slot === activeDef.currentSlot);
      const activeStops = activeSlotPalette?.stops ?? fallbackStops;
      const existingDocumentSnapshot = colorCycleBrushManager.getDocument?.(layerId)?.read().snapshot;
      const gradientIdBuffer = ensureGradientIdBuffer({
        existingBuffer: existingDocumentSnapshot?.gradientIdBuffer ??
          getColorCycleLegacyLayerBuffer(layer.colorCycleData, 'gradientIdBuffer'),
        width: safeWidth,
        height: safeHeight,
        previousWidth: layer.colorCycleData?.canvasWidth ?? layer.colorCycleData?.canvas?.width,
        previousHeight: layer.colorCycleData?.canvasHeight ?? layer.colorCycleData?.canvas?.height,
        fillSlot: paintSlot,
      });
      const usedSlots = collectUsedSlots(gradientDefs, slotPalettes);
      const migrated = migrateGradientIdBuffer({
        buffer: gradientIdBuffer,
        legacyRemap,
        usedSlots,
      });
      const migratedGradientIdBuffer = migrated.buffer;
      const migratedLegacyRemap = migrated.legacyRemap ?? legacyRemap;
      const defKind: 'linear' | 'concentric' =
        state.tools.brushSettings.colorCycleFillMode === 'concentric' ||
        state.tools.brushSettings.colorCycleFillMode === 'circular'
          ? 'concentric'
          : 'linear';
      const existingDefStore = layer.colorCycleData?.gradientDefStore ?? [];
      const existingNextDefId = layer.colorCycleData?.nextGradientDefId;
      const seededDefId = typeof existingNextDefId === 'number'
        ? existingNextDefId
        : (existingDefStore.reduce((max, entry) => Math.max(max, entry.id), 0) + 1) || 1;
      const gradientDefStore = existingDefStore.length > 0
        ? existingDefStore
        : [{
            id: seededDefId,
            kind: defKind,
            stops: cloneGradientStops(activeStops) ?? activeStops,
            hash: hashStopsForDef(defKind, activeStops),
            source: 'manual' as const,
            createdAtMs: Date.now(),
            slot: activeDef.currentSlot,
            speedCps: state.tools.brushSettings.colorCycleSpeed,
          }];
      const nextGradientDefId = existingDefStore.length > 0
        ? (existingNextDefId ?? seededDefId + 1)
        : seededDefId + 1;
      const gradientDefIdBuffer = ensureGradientDefIdBuffer({
        existingBuffer: existingDocumentSnapshot?.gradientDefIdBuffer ??
          getColorCycleLegacyLayerBuffer(layer.colorCycleData, 'gradientDefIdBuffer'),
        width: safeWidth,
        height: safeHeight,
        previousWidth: layer.colorCycleData?.canvasWidth ?? layer.colorCycleData?.canvas?.width,
        previousHeight: layer.colorCycleData?.canvasHeight ?? layer.colorCycleData?.canvas?.height,
      });

      // GUARD: Don't re-initialize if already initialized
      const existingBrush = colorCycleBrushManager.getSurfaceBrush(layerId);
      if (existingBrush) {
        // quiet
        commitColorCycleGradientBuffersToDocument(
          colorCycleBrushManager,
          layer,
          layerId,
          safeWidth,
          safeHeight,
          migratedGradientIdBuffer,
          gradientDefIdBuffer,
        );
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
          const brushCanvas = existingBrush.getCanvas?.();
          const canvas =
            typeof HTMLCanvasElement !== 'undefined' && brushCanvas instanceof HTMLCanvasElement
              ? brushCanvas
              : layerCanvas;
          const { repairStatus: _discardRepairStatus, ...existingColorCycleData } = l.colorCycleData || {};
          void _discardRepairStatus;
          return {
            ...l,
            layerType: 'color-cycle' as const,
              colorCycleData: {
                ...existingColorCycleData,
                documentId: l.id,
                gradient: activeStops,
                gradientDefs,
                slotPalettes,
                activeGradientId,
                paintSlot,
                gradientDefStore,
                nextGradientDefId,
              // Keep current animation state if present; default to true for responsiveness
              isAnimating: l.colorCycleData?.isAnimating ?? true,
              flowMode: l.colorCycleData?.flowMode ?? (state.tools.brushSettings.colorCycleFlowMode ?? 'forward'),
              legacyRemap: migratedLegacyRemap,
              canvas,
              canvasWidth: safeWidth,
              canvasHeight: safeHeight,
            }
          };
        });
        trackLayerChanges('initColorCycleForLayer (hydrate existing)', updatedLayers);
        const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
        return { layers: syncedLayers };
      }

      // Create a canvas element for this layer's color cycle
      // Use the current brush gradient if available
      const gradientArray = gradientStopsToUint8Array(activeStops);

      // Create brush through manager
      const colorCycleBrush = colorCycleBrushManager.createBrush(layerId, safeWidth, safeHeight, gradientArray);

      if (!colorCycleBrush) {
        logError('[Store] Failed to create color cycle brush', { layerId });
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

      commitColorCycleGradientBuffersToDocument(
        colorCycleBrushManager,
        layer,
        layerId,
        safeWidth,
        safeHeight,
        migratedGradientIdBuffer,
        gradientDefIdBuffer,
      );

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

      const { repairStatus: _discardRepairStatus, ...existingColorCycleData } = l.colorCycleData || {};
      void _discardRepairStatus;

      return {
        ...l,
        layerType: 'color-cycle' as const,
        colorCycleData: {
          ...existingColorCycleData,
          documentId: l.id,
          gradient: activeStops || [],
          gradientDefs,
          slotPalettes,
          activeGradientId,
          paintSlot,
          legacyRemap: migratedLegacyRemap,
          gradientDefStore,
          nextGradientDefId,
          colorCycleBrush,
          isAnimating: true,
          flowMode: state.tools.brushSettings.colorCycleFlowMode ?? 'forward',
          canvas: layerCanvas ?? (colorCycleBrush.getCanvas ? colorCycleBrush.getCanvas() : undefined),
          eraseMask,
          eraseMaskVersion,
          canvasWidth: safeWidth,
          canvasHeight: safeHeight,
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
      logError('[Store] Error initializing color cycle', error);
      return {}; // Return empty partial state on error
    }
    });
    get().markAllCompositeSegmentsDirty();
  },

  cleanupColorCycleForLayer: (layerId) => {
    set((state) => {
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
  });
    get().markAllCompositeSegmentsDirty();
  },

  ensureColorCycleLayerRuntime: async (layerId, options) => {
    const target = options?.target ?? 'warm';
    const state = get();
    const layer = state.layers.find((candidate) => candidate.id === layerId);
    if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      return false;
    }

    const hasRuntimeBrush = colorCycleBrushManager.hasBrush(layerId);
    const hasCanonicalRuntimeSource = hasWarmableColorCycleRuntimeSource(
      colorCycleBrushManager,
      layer,
    );

    if (isDocumentColdColorCycleLayer(colorCycleBrushManager, layer)) {
      if (
        !layer.colorCycleData.deferredRuntimeRestore &&
        !hasCanonicalRuntimeSource
      ) {
        return false;
      }
      await scheduleDeferredColorCycleRestore(layerId, target);
    } else if (!hasRuntimeBrush && hasCanonicalRuntimeSource) {
      await scheduleDeferredColorCycleRestore(layerId, target);
    } else if (target === 'active' && getColorCycleHydrationState(layer.colorCycleData) !== 'active') {
      set((current) => ({
        layers: current.layers.map((candidate) => (
          candidate.id === layerId && candidate.layerType === 'color-cycle'
            ? updateLayerColorCycleHydrationState(candidate, 'active')
            : candidate
        )),
      }));
      try {
        colorCycleBrushManager.setActiveState(layerId, true);
      } catch {
        // quiet
      }
    }

    const latestLayer = get().layers.find((candidate) => candidate.id === layerId);
    if (!latestLayer || latestLayer.layerType !== 'color-cycle' || !latestLayer.colorCycleData) {
      return false;
    }
    if (!colorCycleBrushManager.hasBrush(layerId) && !colorCycleBrushManager.getSurfaceBrush(layerId)) {
      return false;
    }
    const hydration = getColorCycleHydrationState(latestLayer.colorCycleData);
    return hydration === target || (target === 'warm' && hydration === 'active');
  },
});
