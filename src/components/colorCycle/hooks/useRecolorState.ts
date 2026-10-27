/**
 * useRecolorState - Custom hook for managing recolor panel state
 *
 * Clean state management with event handlers and side effects,
 * integrating with the RecolorManager and app store.
 */

import { debugWarn, logError } from '@/utils/debug';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Layer } from '../../../types';
import { RecolorManager, RecolorOptions, RecolorPerformanceStats } from '../../../lib/colorCycle/RecolorManager';
import {
  selectEffectiveColorCyclePlaying,
  useAppStore,
} from '@/stores/useAppStore';
import { selectLayers } from '@/stores/selectors/layersSelectors';
import { getAppStoreState } from '@/stores/appStoreAccess';
import {
  MAX_RECOLOR_COLOR_CYCLE_SPEED,
  MIN_RECOLOR_COLOR_CYCLE_SPEED,
} from '@/constants/colorCycle';
import { toggleToolbarColorCyclePlayback } from '@/utils/colorCyclePlayback';
import historyManager from '@/history/historyService';
import { createRecolorGradientDelta, createRecolorControlDelta, createRecolorFPSDelta, readRecolorControls, mergeRecolorControls, readRecolorFPSState, type RecolorControlValues } from '@/history/deltas/recolorDelta';
import { createLayerStructureDelta } from '@/history/deltas/layerStructureDelta';
import { captureLayerStructureSnapshot } from '@/stores/helpers/layerStructureHistory';

const isRecolorLayer = (layer: Layer) =>
  layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor';

export interface RecolorState {
  mode: 'brush' | 'recolor';
  isProcessing: boolean;
  showExtractDialog: boolean;
  showAdvancedControls: boolean;
  performanceMode: 'auto' | 'quality' | 'performance';
  error: string | null;
}

export interface RecolorActions {
  setMode: (mode: 'brush' | 'recolor') => void;
  setProcessing: (isProcessing: boolean) => void;
  showExtractDialog: () => void;
  hideExtractDialog: () => void;
  toggleAdvancedControls: () => void;
  setPerformanceMode: (mode: 'auto' | 'quality' | 'performance') => void;
  clearError: () => void;
  setError: (error: string) => void;
}

export interface UseRecolorStateOptions {
  initialMode?: 'brush' | 'recolor';
  onModeChange?: (mode: 'brush' | 'recolor') => void;
  onError?: (error: string) => void;
}

export interface RecolorInitialSettings {
  speed: number;
  fps: number;
  flowDirection: 'forward' | 'reverse' | 'pingpong' | 'bounce';
  mappingMode: 'banded' | 'continuous';
  flowMapping: 'palette' | 'directional' | 'luminance';
}

export interface UseRecolorStateReturn {
  state: RecolorState;
  actions: RecolorActions;

  // Layer processing
  processLayer: (layer: Layer, options?: RecolorOptions, initialSettings?: RecolorInitialSettings) => Promise<boolean>;
  convertToNormal: (layer: Layer) => Promise<boolean>;

  // Animation controls
  toggleAnimation: () => Promise<void>;
  isAnimating: boolean;

  // Settings management
  updateLayerSpeed: (layerId: string, speed: number) => Promise<void>;
  updateLayerCycleColors: (layerId: string, cycleColors: number) => Promise<void>;
  updateLayerFlowDirection: (layerId: string, direction: 'forward' | 'reverse' | 'pingpong' | 'bounce') => Promise<void>;
  updateLayerMappingMode: (layerId: string, mode: 'banded' | 'continuous') => Promise<void>;
  updateGradient: (layer: Layer, gradient: Array<{ position: number; color: string; opacity?: number }>) => void;
  updateGlobalFPS: (fps: number) => Promise<void>;
  updateLayerFlowMapping: (layerId: string, mode: 'palette' | 'directional' | 'luminance') => Promise<void>;

  // Performance monitoring
  performanceStats: RecolorPerformanceStats | null;

  // Success feedback
  successMessage: string | null;
  showSuccess: (message: string) => void;
}

export function useRecolorState(
  activeLayer: Layer | null,
  options: UseRecolorStateOptions = {}
): UseRecolorStateReturn {
  const {
    initialMode = 'brush',
    onModeChange,
    onError
  } = options;

  // Get recolor manager instance
  const recolorManager = useMemo(() => RecolorManager.getInstance(), []);
  const layers = useAppStore(selectLayers);
  const effectivePlaying = useAppStore(selectEffectiveColorCyclePlaying);
  const isAnimating = effectivePlaying;

  // Internal state
  const [state, setState] = useState<RecolorState>({
    mode: activeLayer?.colorCycleData?.mode || initialMode,
    isProcessing: false,
    showExtractDialog: false,
    showAdvancedControls: false,
    performanceMode: 'auto',
    error: null
  });

  // Performance stats (updated periodically)
  const [performanceStats, setPerformanceStats] = useState<RecolorPerformanceStats | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [, setRenderTick] = useState(0);

  const forceRender = useCallback(() => {
    setRenderTick((tick) => tick + 1);
  }, []);

  const showSuccess = useCallback((message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  }, []);

  // Actions
  const actions = useMemo<RecolorActions>(() => ({
    setMode: (mode: 'brush' | 'recolor') => {
      setState(prev => ({ ...prev, mode }));
      onModeChange?.(mode);
    },

    setProcessing: (isProcessing: boolean) => {
      setState(prev => ({ ...prev, isProcessing }));
    },

    showExtractDialog: () => {
      setState(prev => ({ ...prev, showExtractDialog: true }));
    },

    hideExtractDialog: () => {
      setState(prev => ({ ...prev, showExtractDialog: false }));
    },

    toggleAdvancedControls: () => {
      setState(prev => ({ ...prev, showAdvancedControls: !prev.showAdvancedControls }));
    },

    setPerformanceMode: (performanceMode: 'auto' | 'quality' | 'performance') => {
      setState(prev => ({ ...prev, performanceMode }));
    },

    clearError: () => {
      setState(prev => ({ ...prev, error: null }));
    },

    setError: (error: string) => {
      setState(prev => ({ ...prev, error }));
      onError?.(error);
    }
  }), [onModeChange, onError]);

  // Layer processing
  const convertToNormal = useCallback(async (layer: Layer): Promise<boolean> => {
    actions.setProcessing(true);
    actions.clearError();

    try {
      const success = recolorManager.convertToNormal(layer);

      if (success) {
        actions.setMode('brush');
        showSuccess('Layer converted to brush mode');
      } else {
        actions.setError('Failed to convert layer to normal mode');
      }

      return success;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      actions.setError(errorMessage);
      return false;
    } finally {
      actions.setProcessing(false);
    }
  }, [recolorManager, actions, showSuccess]);

  // Animation controls
  const lastToggleAtRef = useRef<number>(0);
  const toggleAnimation = useCallback(async () => {
    try {
      const now = performance.now?.() ?? Date.now();
      if (now - lastToggleAtRef.current < 250) {
        // Debounce rapid duplicate toggles from UI re-renders or double clicks
        return;
      }
      lastToggleAtRef.current = now;

      await toggleToolbarColorCyclePlayback();
    } catch (error) {
      logError('[useRecolorState] Animation toggle error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Animation control error';
      actions.setError(errorMessage);
    }
  }, [actions]);

  // Settings management
  const applyControl = useCallback(async (layerId: string, values: Partial<RecolorControlValues>, record = true) => {
    const state = getAppStoreState();
    const target = state.layers.find((layer) => layer.id === layerId);
    const settings = target?.colorCycleData?.recolorSettings;
    if (!target || target.locked || !isRecolorLayer(target) || !settings) return;
    const patch = { ...values };
    if ('speed' in patch || 'cycleColors' in patch) {
      patch.ticksPerFrame = (patch.speed ?? settings.animation.speed) * (patch.cycleColors ?? settings.cycleColors) / recolorManager.getConfiguredFPS();
    }
    const previous = readRecolorControls(settings);
    const before = Object.fromEntries(Object.keys(patch).map((key) => [key, previous[key as keyof RecolorControlValues]])) as Partial<RecolorControlValues>;
    const delta = createRecolorControlDelta({ layerId, before, after: patch });
    if (!delta) return;
    const next = { ...target, colorCycleData: { ...target.colorCycleData!, recolorSettings: mergeRecolorControls(settings, patch) } };
    useAppStore.setState({ layers: state.layers.map((layer) => layer === target ? next : layer), layersNeedRecomposition: true });
    try {
      if (!await recolorManager.restoreLayer(next)) throw new Error('Failed to initialize recolor animation');
      const current = getAppStoreState();
      if (current.project?.id !== state.project?.id || current.layers.find((layer) => layer.id === layerId) !== next) return;
      if (record) {
        const txn = historyManager.begin('settings-change', { layerId, tool: 'recolor' });
        txn.push(delta); txn.commit('Recolor control');
      }
    } catch (error) {
      const current = getAppStoreState();
      if (current.project?.id === state.project?.id && current.layers.find((layer) => layer.id === layerId) === next) {
        useAppStore.setState({ layers: current.layers.map((layer) => layer === next ? target : layer), layersNeedRecomposition: state.layersNeedRecomposition });
        await recolorManager.restoreLayer(target);
      }
      actions.setError(error instanceof Error ? error.message : 'Failed to update recolor control');
    }
  }, [actions, recolorManager]);

  const updateLayerSpeed = useCallback(async (layerId: string, speed: number) => {
    await applyControl(layerId, { speed: Math.max(MIN_RECOLOR_COLOR_CYCLE_SPEED, Math.min(MAX_RECOLOR_COLOR_CYCLE_SPEED, Number.isFinite(speed) ? speed : 0.1)) });
  }, [applyControl]);
  const updateLayerCycleColors = useCallback(async (layerId: string, cycleColors: number) => {
    await applyControl(layerId, { cycleColors });
  }, [applyControl]);
  const updateLayerFlowDirection = useCallback(async (layerId: string, flowDirection: RecolorControlValues['flowDirection']) => {
    await applyControl(layerId, { flowDirection });
  }, [applyControl]);
  const updateLayerMappingMode = useCallback(async (layerId: string, mappingMode: RecolorControlValues['mappingMode']) => {
    await applyControl(layerId, { mappingMode });
  }, [applyControl]);
  const updateLayerFlowMapping = useCallback(async (layerId: string, flowMapping: RecolorControlValues['flowMapping']) => {
    await applyControl(layerId, { flowMapping });
  }, [applyControl]);

  const updateGradient = useCallback((layer: Layer, gradient: Array<{ position: number; color: string; opacity?: number }>) => {
    try {
      const state = getAppStoreState();
      const target = state.layers.find((entry) => entry.id === layer.id);
      const settings = target?.colorCycleData?.recolorSettings;
      if (!target || target.locked || !isRecolorLayer(target) || !settings) return;
      const before = settings.gradient.map((stop) => ({ ...stop }));
      if (!recolorManager.updateGradient(target, gradient)) return;
      const current = getAppStoreState();
      if (current.project?.id !== state.project?.id) return;
      const after = current.layers.find((entry) => entry.id === target.id)?.colorCycleData?.recolorSettings?.gradient;
      if (!after) return;
      const delta = createRecolorGradientDelta({ layerId: target.id, before, after });
      if (delta) {
        const txn = historyManager.begin('settings-change', { layerId: target.id, tool: 'recolor' });
        txn.push(delta);
        txn.commit('Recolor gradient');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update gradient';
      actions.setError(errorMessage);
    }
  }, [recolorManager, actions]);

  const applyGlobalFPS = useCallback(async (fps: number, record = true) => {
    const state = getAppStoreState(), before = readRecolorFPSState(recolorManager.getConfiguredFPS());
    const targetFPS = Math.max(15, Math.min(60, fps));
    const nextLayers = state.layers.map((layer) => {
      const settings = layer.colorCycleData?.mode === 'recolor' ? layer.colorCycleData.recolorSettings : undefined;
      return settings ? { ...layer, colorCycleData: { ...layer.colorCycleData!, recolorSettings: mergeRecolorControls(settings, { fps: targetFPS, ticksPerFrame: settings.animation.speed * settings.cycleColors / targetFPS }) } } : layer;
    });
    const after = { fps: targetFPS, layers: nextLayers.flatMap((layer) => {
      const settings = layer.colorCycleData?.mode === 'recolor' ? layer.colorCycleData.recolorSettings : undefined;
      return settings ? [{ id: layer.id, fps: settings.animation.fps, ticksPerFrame: settings.animation.ticksPerFrame }] : [];
    }) };
    const delta = createRecolorFPSDelta({ before, after });
    if (!delta) return;
    useAppStore.setState({ layers: nextLayers, layersNeedRecomposition: true });
    try {
      for (const layer of nextLayers) if (layer.colorCycleData?.mode === 'recolor' && !await recolorManager.restoreLayer(layer)) throw new Error('Failed to initialize recolor animation');
      if (getAppStoreState().project?.id !== state.project?.id) return;
      recolorManager.setFPS(targetFPS);
      if (record) { const txn = historyManager.begin('settings-change', { tool: 'recolor' }); txn.push(delta); txn.commit('Recolor FPS'); }
    } catch (error) {
      if (getAppStoreState().project?.id === state.project?.id) {
        if (recolorManager.getConfiguredFPS() !== before.fps) recolorManager.setFPS(before.fps);
        useAppStore.setState({ layers: state.layers, layersNeedRecomposition: state.layersNeedRecomposition });
        for (const layer of state.layers) if (layer.colorCycleData?.mode === 'recolor') await recolorManager.restoreLayer(layer);
      }
      actions.setError(error instanceof Error ? error.message : 'Failed to update FPS');
    }
  }, [actions, recolorManager]);
  const updateGlobalFPS = useCallback(async (fps: number) => { await applyGlobalFPS(fps); }, [applyGlobalFPS]);

  const processLayer = useCallback(async (
    layer: Layer,
    options?: RecolorOptions,
    initialSettings?: RecolorInitialSettings,
  ): Promise<boolean> => {
    actions.setProcessing(true);
    actions.clearError();
    try {
      const state = getAppStoreState();
      const target = state.layers.find((entry) => entry.id === layer.id);
      if (!target || target.locked) return false;
      const beforeFPS = readRecolorFPSState(recolorManager.getConfiguredFPS());
      const before = captureLayerStructureSnapshot(state, { actionType: 'layer', description: 'Recolor conversion' });
      const success = await recolorManager.processLayer(target, options);
      if (!success) {
        actions.setError('Failed to process layer');
        return false;
      }
      const isCurrentTarget = () => {
        const current = getAppStoreState();
        return current.project?.id === state.project?.id && current.layers.some((entry) => entry.id === target.id);
      };
      if (!isCurrentTarget()) return false;
      if (initialSettings) {
        await applyControl(target.id, { speed: initialSettings.speed, flowDirection: initialSettings.flowDirection, mappingMode: initialSettings.mappingMode, flowMapping: initialSettings.flowMapping }, false);
        if (!isCurrentTarget()) return false;
        await applyGlobalFPS(initialSettings.fps, false);
        if (!isCurrentTarget()) return false;
        await toggleAnimation();
      }
      if (!isCurrentTarget()) return false;
      const after = captureLayerStructureSnapshot(getAppStoreState(), {
        actionType: 'layer', description: 'Recolor conversion', previousSnapshot: before,
      });
      const txn = historyManager.begin('layer-structure', { layerId: target.id, tool: 'recolor' });
      txn.push(createLayerStructureDelta({ before, after, runtimeLayerIds: [target.id] }));
      const fpsDelta = createRecolorFPSDelta({ before: beforeFPS, after: readRecolorFPSState(recolorManager.getConfiguredFPS()) });
      if (fpsDelta) txn.push(fpsDelta);
      txn.commit('Recolor conversion');
      actions.setMode('recolor');
      showSuccess('Layer converted to recolor mode');
      return true;
    } catch (error) {
      actions.setError(error instanceof Error ? error.message : 'Unknown error occurred');
      return false;
    } finally {
      actions.setProcessing(false);
    }
  }, [actions, applyControl, applyGlobalFPS, recolorManager, showSuccess, toggleAnimation]);

  useEffect(() => {
    let cancelled = false;

    const syncPlayback = async () => {
      const recolorLayers = layers.filter(isRecolorLayer);

      if (effectivePlaying) {
        try {
          await Promise.all(recolorLayers.map(layer => recolorManager.registerExistingLayer(layer)));
          if (!cancelled) {
            recolorManager.playAll();
            const maybeRenderOnce = (recolorManager as { renderOnce?: () => void }).renderOnce;
            if (typeof maybeRenderOnce === 'function') {
              maybeRenderOnce.call(recolorManager);
            }
          }
        } catch (error) {
          logError('[useRecolorState] Failed to start recolor playback', error);
          if (!cancelled) {
            actions.setError('Failed to start recolor animation');
          }
        }
      } else {
        recolorManager.pause();
        if (!cancelled) {
          setPerformanceStats(null);
        }
      }
    };

    void syncPlayback();

    return () => {
      cancelled = true;
    };
  }, [actions, effectivePlaying, recolorManager, layers]);

  // Update performance stats periodically during animation
  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;

    if (isAnimating) {
      interval = setInterval(() => {
        try {
          const stats = recolorManager.getStats();
          setPerformanceStats(stats);
        } catch (error) {
          debugWarn('raw-console', 'Failed to get performance stats:', error);
        }
      }, 1000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isAnimating, recolorManager]);

  // Setup RecolorManager callbacks for real-time updates
  useEffect(() => {
    const handleLayerUpdate = () => {
      // Force a rerender so controlled inputs (e.g., sliders) pick up mutated layer state
      forceRender();
    };

    const handleStatsUpdate = (stats: RecolorPerformanceStats) => {
      setPerformanceStats(stats);
    };

    // Register callbacks
    recolorManager.onLayerUpdate(handleLayerUpdate);
    recolorManager.onStatsUpdate(handleStatsUpdate);

    // Cleanup
    return () => {
      recolorManager.offLayerUpdate(handleLayerUpdate);
      recolorManager.offStatsUpdate(handleStatsUpdate);
    };
  }, [recolorManager, forceRender]);

  // Auto-clear errors after a timeout with fade out
  useEffect(() => {
    if (state.error) {
      const timeout = setTimeout(() => {
        actions.clearError();
      }, 8000); // Clear error after 8 seconds (more time to read)

      return () => clearTimeout(timeout);
    }
  }, [state.error, actions]);

  // Sync mode with active layer
  useEffect(() => {
    if (activeLayer?.colorCycleData?.mode && activeLayer.colorCycleData.mode !== state.mode) {
      setState(prev => ({ ...prev, mode: activeLayer.colorCycleData!.mode! }));
    }
  }, [activeLayer, state.mode]);

  return {
    state,
    actions,
    processLayer,
    convertToNormal,
    toggleAnimation,
    isAnimating,
    updateLayerSpeed,
    updateLayerCycleColors,
    updateLayerFlowDirection,
    updateLayerMappingMode,
    updateLayerFlowMapping,
    updateGradient,
    updateGlobalFPS,
    performanceStats,
    successMessage,
    showSuccess
  };
}
