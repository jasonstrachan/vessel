/**
 * useRecolorState - Custom hook for managing recolor panel state
 * 
 * Clean state management with event handlers and side effects,
 * integrating with the RecolorManager and app store.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Layer } from '../../../types';
import { RecolorManager, RecolorOptions, RecolorPerformanceStats } from '../../../lib/colorCycle/RecolorManager';
import { useAppStore } from '@/stores/useAppStore';
import { selectLayers } from '@/stores/selectors/layersSelectors';

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

export interface UseRecolorStateReturn {
  state: RecolorState;
  actions: RecolorActions;
  
  // Layer processing
  processLayer: (layer: Layer, options?: RecolorOptions) => Promise<boolean>;
  convertToNormal: (layer: Layer) => Promise<boolean>;
  
  // Animation controls
  toggleAnimation: () => void;
  isAnimating: boolean;
  
  // Settings management
  updateLayerSpeed: (layerId: string, speed: number) => void;
  updateLayerCycleColors: (layerId: string, cycleColors: number) => void;
  updateLayerFlowDirection: (layerId: string, direction: 'forward' | 'reverse' | 'pingpong' | 'bounce') => void;
  updateLayerMappingMode: (layerId: string, mode: 'banded' | 'continuous') => void;
  updateGradient: (layer: Layer, gradient: Array<{ position: number; color: string }>) => void;
  updateGlobalFPS: (fps: number) => void;
  
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
  const desiredPlaying = useAppStore(state => state.colorCyclePlayback.desiredPlaying);
  const suspendDepth = useAppStore(state => state.colorCyclePlayback.suspendDepth);
  const playColorCycle = useAppStore(state => state.playColorCycle);
  const pauseColorCycle = useAppStore(state => state.pauseColorCycle);
  const layers = useAppStore(selectLayers);
  const updateLayer = useAppStore((state) => state.updateLayer);
  const effectivePlaying = desiredPlaying && suspendDepth === 0;
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
  const layersById = useMemo(() => {
    const map = new Map<string, Layer>();
    layers.forEach((layer) => map.set(layer.id, layer));
    return map;
  }, [layers]);

  const processLayer = useCallback(async (layer: Layer, options?: RecolorOptions): Promise<boolean> => {
    actions.setProcessing(true);
    actions.clearError();
    
    try {
      const success = await recolorManager.processLayer(layer, options);
      
      if (success) {
        actions.setMode('recolor');
        showSuccess('Layer converted to recolor mode');
      } else {
        actions.setError('Failed to process layer');
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
  const toggleAnimation = useCallback(() => {
    try {
      const now = performance.now?.() ?? Date.now();
      if (now - lastToggleAtRef.current < 250) {
        // Debounce rapid duplicate toggles from UI re-renders or double clicks
        return;
      }
      lastToggleAtRef.current = now;

      if (desiredPlaying) {
        pauseColorCycle('toolbar');
      } else {
        playColorCycle('toolbar');
      }
    } catch (error) {
      console.error('[useRecolorState] Animation toggle error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Animation control error';
      actions.setError(errorMessage);
    }
  }, [actions, desiredPlaying, pauseColorCycle, playColorCycle]);

  // Settings management
  const updateLayerSpeed = useCallback((layerId: string, speed: number) => {
    const clampedSpeed = Math.max(0.02, Math.min(2.0, Number.isFinite(speed) ? speed : 0.1));

    void (async () => {
      try {
        const layer = layersById.get(layerId);

        if (!layer || !isRecolorLayer(layer) || !layer.colorCycleData?.recolorSettings?.animation) {
          actions.setError('Select a recolor layer before adjusting speed.');
          return;
        }

        const nextRecolorSettings = {
          ...layer.colorCycleData.recolorSettings,
          animation: {
            ...layer.colorCycleData.recolorSettings.animation,
            speed: clampedSpeed
          }
        };

        try {
          updateLayer(layerId, {
            colorCycleData: {
              ...layer.colorCycleData,
              recolorSettings: nextRecolorSettings
            }
          });
        } catch (storeError) {
          console.warn('[useRecolorState] Failed to push speed into store state:', storeError);
        }

        let applied = recolorManager.setLayerSpeed(layerId, clampedSpeed);

        if (!applied) {
          const latestLayer = layersById.get(layerId);
          if (latestLayer) {
            await recolorManager.registerExistingLayer(latestLayer);
            applied = recolorManager.setLayerSpeed(layerId, clampedSpeed);
          }
        }

        if (!applied) {
          actions.setError('Animation is paused. Press Play once, then adjust speed again.');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update speed';
        actions.setError(errorMessage);
      }
    })();
  }, [recolorManager, actions, layersById, updateLayer]);

  const updateLayerCycleColors = useCallback((layerId: string, cycleColors: number) => {
    try {
      recolorManager.setLayerCycleColors(layerId, cycleColors);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update cycle colors';
      actions.setError(errorMessage);
    }
  }, [recolorManager, actions]);

  const updateLayerFlowDirection = useCallback((layerId: string, direction: 'forward' | 'reverse' | 'pingpong' | 'bounce') => {
    try {
      recolorManager.setLayerFlowDirection(layerId, direction);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update flow direction';
      actions.setError(errorMessage);
    }
  }, [recolorManager, actions]);

  const updateLayerMappingMode = useCallback((layerId: string, mode: 'banded' | 'continuous') => {
    try {
      recolorManager.setLayerMappingMode(layerId, mode);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update mapping mode';
      actions.setError(errorMessage);
    }
  }, [recolorManager, actions]);

  const updateGradient = useCallback((layer: Layer, gradient: Array<{ position: number; color: string }>) => {
    try {
      recolorManager.updateGradient(layer, gradient);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update gradient';
      actions.setError(errorMessage);
    }
  }, [recolorManager, actions]);

  const updateGlobalFPS = useCallback((fps: number) => {
    try {
      recolorManager.setFPS(fps);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update FPS';
      actions.setError(errorMessage);
    }
  }, [recolorManager, actions]);

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
          console.error('[useRecolorState] Failed to start recolor playback', error);
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
          console.warn('Failed to get performance stats:', error);
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
    updateGradient,
    updateGlobalFPS,
    performanceStats,
    successMessage,
    showSuccess
  };
}
