/**
 * RecolorPanel - Main UI component for the Recolor & Animate feature
 * 
 * Clean, modular interface with comprehensive state management,
 * keyboard shortcuts, and real-time performance monitoring.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer } from '../../types';
import { RecolorManager } from '../../lib/colorCycle/RecolorManager';
import { useKeyboardScope } from '../../hooks/useKeyboardScope';

// Custom hooks for state management
import { useRecolorState } from './hooks/useRecolorState';
import { useRecolorShortcuts } from './hooks/useRecolorShortcuts';

// Modular sub-components
import { GradientEditor } from '../ui/GradientEditor';
import { useAppStore } from '../../stores/useAppStore';
import { AnimationControls } from './controls/AnimationControls';
import Button from '../ui/Button';
import {
  DEFAULT_GRADIENT_ID,
  DEFAULT_GRADIENT_STOPS,
  GRADIENT_PRESETS
} from '@/utils/gradientPresets';
// Extract colors feature removed from UI
import { ConfirmationDialog } from './dialogs/ConfirmationDialog';
// Performance indicator removed from UI

export interface RecolorPanelProps {
  activeLayer: Layer | null;
  isVisible: boolean;
  onError?: (error: string) => void;
}

export const RecolorPanel: React.FC<RecolorPanelProps> = ({
  activeLayer,
  isVisible,
  onError
}) => {
  // Use custom state management hook
  const {
    state,
    actions,
    processLayer,
    toggleAnimation,
    updateLayerSpeed,
    updateLayerCycleColors,
    updateLayerFlowDirection,
    updateLayerMappingMode,
    updateGradient,
    updateGlobalFPS,
    successMessage
  } = useRecolorState(activeLayer, {
    initialMode: 'brush',
    onError
  });

  // Current layer's recolor settings
  const recolorSettings = activeLayer?.colorCycleData?.recolorSettings;
  const isRecolorEnabled = activeLayer?.colorCycleData?.mode === 'recolor' && recolorSettings;
  // While the recolor panel is visible and in recolor mode, suspend global/canvas shortcuts
  useKeyboardScope('recolor', isVisible && state.mode === 'recolor');
  
  // debug log removed
  // Planned (pre-conversion) animation settings so users can configure before applying
  const [plannedSettings, setPlannedSettings] = useState({
    speed: 0.1 as number,
    fps: 30 as number,
    cycleColors: 16 as number,
    flowDirection: 'forward' as 'forward' | 'reverse' | 'pingpong' | 'bounce',
    mappingMode: 'banded' as 'banded' | 'continuous',
    flowMapping: 'palette' as 'palette' | 'directional' | 'luminance'
  });
  const [plannedGradient, setPlannedGradient] = useState<Array<{ position: number; color: string }>>(
    DEFAULT_GRADIENT_STOPS.map(stop => ({ ...stop }))
  );

  // Keep planned settings synced with active recolor layer when available
  useEffect(() => {
    if (!recolorSettings) return;

    setPlannedSettings({
      speed: recolorSettings.animation.speed ?? 0.1,
      fps: recolorSettings.animation.fps ?? 30,
      cycleColors: recolorSettings.cycleColors ?? 16,
      flowDirection: recolorSettings.animation.flowDirection ?? 'forward',
      mappingMode: recolorSettings.mappingMode ?? 'banded',
      flowMapping: recolorSettings.flowMapping ?? 'palette'
    });
  }, [recolorSettings]);

  // Gradient presets for shortcuts (memoized to avoid dependency issues)
  const gradientPresets = useMemo(() => GRADIENT_PRESETS.map(preset => ({
    name: preset.id,
    gradient: preset.stops.map(stop => ({ position: stop.position, color: stop.color }))
  })), []);

  const recolorGradientTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recolorGradientPendingRef = useRef<{
    stops: Array<{ position: number; color: string }>;
    layerId: string;
  } | null>(null);

  const scheduleRecolorGradientUpdate = useCallback(
    (stops: Array<{ position: number; color: string }>, immediate = false) => {
      if (!activeLayer || !activeLayer.id) {
        return;
      }
      recolorGradientPendingRef.current = {
        stops: stops.map(stop => ({ ...stop })),
        layerId: activeLayer.id
      };

      if (recolorGradientTimerRef.current) {
        clearTimeout(recolorGradientTimerRef.current);
        recolorGradientTimerRef.current = null;
      }

      const flush = () => {
        recolorGradientTimerRef.current = null;
        const pending = recolorGradientPendingRef.current;
        if (!pending) return;
        const stateSnapshot = useAppStore.getState();
        const layer = stateSnapshot.layers.find(l => l.id === pending.layerId);
        if (!layer) return;

        const clonedStops = pending.stops.map(stop => ({ ...stop }));
        updateGradient(layer, clonedStops);

        if (stateSnapshot.tools.currentTool !== 'recolor') {
          stateSnapshot.setBrushSettings({ colorCycleGradient: clonedStops });
        }
        recolorGradientPendingRef.current = null;
      };

      if (immediate) {
        flush();
        return;
      }

      recolorGradientTimerRef.current = setTimeout(flush, 80);
    },
    [activeLayer, updateGradient]
  );

  useEffect(() => {
    return () => {
      if (recolorGradientTimerRef.current) {
        clearTimeout(recolorGradientTimerRef.current);
        recolorGradientTimerRef.current = null;
        const pending = recolorGradientPendingRef.current;
        if (pending) {
          const stateSnapshot = useAppStore.getState();
          const layer = stateSnapshot.layers.find(l => l.id === pending.layerId);
          if (layer) {
            const clonedStops = pending.stops.map(stop => ({ ...stop }));
            updateGradient(layer, clonedStops);
            if (stateSnapshot.tools.currentTool !== 'recolor') {
              stateSnapshot.setBrushSettings({ colorCycleGradient: clonedStops });
            }
          }
          recolorGradientPendingRef.current = null;
        }
      }
    };
  }, [updateGradient]);

  useEffect(() => {
    if (!activeLayer?.id) {
      return;
    }
    const pending = recolorGradientPendingRef.current;
    if (
      recolorGradientTimerRef.current &&
      pending &&
      pending.layerId !== activeLayer.id
    ) {
      clearTimeout(recolorGradientTimerRef.current);
      recolorGradientTimerRef.current = null;
      const stateSnapshot = useAppStore.getState();
      const layer = stateSnapshot.layers.find(l => l.id === pending.layerId);
      if (layer) {
        const clonedStops = pending.stops.map(stop => ({ ...stop }));
        updateGradient(layer, clonedStops);
        if (stateSnapshot.tools.currentTool !== 'recolor') {
          stateSnapshot.setBrushSettings({ colorCycleGradient: clonedStops });
        }
      }
      recolorGradientPendingRef.current = null;
    }
  }, [activeLayer?.id, updateGradient]);

  // Keyboard shortcuts
  const shortcutHandlers = useMemo(() => ({
    toggleAnimation,
    toggleMode: async () => {
      if (!activeLayer) return;
      
      if (state.mode === 'brush') {
        await processLayer(activeLayer, {
          quantizationMode: 'rgb332',
          ditherMode: 'off',
          cycleColors: 16,
          gradientPreset: DEFAULT_GRADIENT_ID
        });
      } else {
        // If already in recolor mode, just toggle animation instead of converting back
        toggleAnimation();
      }
    },
    // Extract colors removed from UI
    extractColors: () => {},
    speedUp: () => {
      if (activeLayer && recolorSettings) {
        const newSpeed = Math.min(2.0, recolorSettings.animation.speed + 0.1);
        updateLayerSpeed(activeLayer.id, newSpeed);
      }
    },
    slowDown: () => {
      if (activeLayer && recolorSettings) {
        const newSpeed = Math.max(0.02, recolorSettings.animation.speed - 0.1);
        updateLayerSpeed(activeLayer.id, newSpeed);
      }
    },
    nextPreset: () => {
      if (activeLayer && recolorSettings) {
        const currentGradient = recolorSettings.gradient;
        const currentIndex = gradientPresets.findIndex(p => 
          JSON.stringify(p.gradient) === JSON.stringify(currentGradient)
        );
        const nextIndex = (currentIndex + 1) % gradientPresets.length;
        updateGradient(activeLayer, gradientPresets[nextIndex].gradient);
      }
    },
    prevPreset: () => {
      if (activeLayer && recolorSettings) {
        const currentGradient = recolorSettings.gradient;
        const currentIndex = gradientPresets.findIndex(p => 
          JSON.stringify(p.gradient) === JSON.stringify(currentGradient)
        );
        const prevIndex = currentIndex <= 0 ? gradientPresets.length - 1 : currentIndex - 1;
        updateGradient(activeLayer, gradientPresets[prevIndex].gradient);
      }
    },
    resetSpeed: () => {
      if (activeLayer) {
        updateLayerSpeed(activeLayer.id, 0.1);
      }
    },
    toggleAdvanced: actions.toggleAdvancedControls
  }), [
    toggleAnimation,
    activeLayer,
    state.mode,
    processLayer,
    actions,
    recolorSettings,
    updateLayerSpeed,
    updateGradient,
    gradientPresets
  ]);

  // Setup keyboard shortcuts
  useRecolorShortcuts(shortcutHandlers, {
    enabled: isVisible,
    activeLayer,
    isRecolorMode: state.mode === 'recolor'
  });

  // Confirmation dialog state
  const [confirmationDialog, setConfirmationDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    action?: () => void;
  }>({ isOpen: false, title: '', message: '' });

  // Extract colors workflow removed from UI

  if (!isVisible) {
    return null;
  }

  return (
    <div className="recolor-panel w-full text-white p-2">
      {/* Header removed per request */}

      {/* Apply-on-select UX: removed explicit convert button */}

      {/* Layer is controlled by the main Layers panel; no selector here */}

      {/* Processing Indicator with Enhanced Feedback */}
      {state.isProcessing && (
        <div className="mb-3 p-3 bg-gray-700/30 border border-gray-600 rounded animate-pulse">
          <div className="flex items-center gap-2">
            <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            <div className="flex-1">
              <span className="text-sm text-blue-300">Converting to recolor mode...</span>
              <div className="text-xs text-blue-400 mt-1">This may take a few seconds</div>
            </div>
          </div>
        </div>
      )}

      {/* Recolor Mode Controls (allow pre-configuration before conversion) */}
      {activeLayer && (
        <div className="space-y-4">
          {/* Gradient Editor - always visible; first selection applies conversion and plays */}
          <div className="mb-2">
          <GradientEditor
            sampleTarget="recolor"
            stops={isRecolorEnabled ? (recolorSettings?.gradient || []) : plannedGradient}
            onChange={async (stops) => {
              if (!activeLayer) return;
              if (isRecolorEnabled) {
                scheduleRecolorGradientUpdate(stops);
              } else {
                setPlannedGradient(stops);
                const ok = await processLayer(activeLayer, {
                  quantizationMode: 'rgb332',
                  ditherMode: 'off',
                  cycleColors: plannedSettings.cycleColors,
                  gradientPreset: 'custom',
                  customGradient: stops
                });
                if (ok) {
                  updateLayerSpeed(activeLayer.id, plannedSettings.speed);
                  updateGlobalFPS(plannedSettings.fps);
                  updateLayerFlowDirection(activeLayer.id, plannedSettings.flowDirection);
                  updateLayerMappingMode(activeLayer.id, plannedSettings.mappingMode);
                  // Auto-play on first apply
                  toggleAnimation();
                }
              }
              const store = useAppStore.getState();
              if (store.tools.currentTool !== 'recolor') {
                store.setBrushSettings({ colorCycleGradient: stops });
              }
            }}
          />
          </div>

          {/* Extract Colors UI removed */}

          {/* Info text removed per request */}

          {/* Animation Controls */}
          <AnimationControls
            speed={isRecolorEnabled ? (recolorSettings?.animation.speed || 0.1) : plannedSettings.speed}
            fps={isRecolorEnabled ? (recolorSettings?.animation.fps || 30) : plannedSettings.fps}
            cycleColors={isRecolorEnabled ? (recolorSettings?.cycleColors || 16) : plannedSettings.cycleColors}
            flowDirection={isRecolorEnabled ? (recolorSettings?.animation.flowDirection || 'forward') : plannedSettings.flowDirection}
            mappingMode={isRecolorEnabled ? (recolorSettings?.mappingMode || 'banded') : plannedSettings.mappingMode}
            flowMapping={isRecolorEnabled ? (recolorSettings?.flowMapping || 'palette') : plannedSettings.flowMapping}
            onSpeedChange={(speed) => {
              if (!activeLayer) return;
              if (isRecolorEnabled) {
                updateLayerSpeed(activeLayer.id, speed);
              } else {
                setPlannedSettings((prev) => ({ ...prev, speed }));
              }
            }}
            onFPSChange={(fps) => {
              if (isRecolorEnabled) {
                updateGlobalFPS(fps);
              } else {
                setPlannedSettings((prev) => ({ ...prev, fps }));
              }
            }}
            onCycleColorsChange={(cycleColors) => {
              if (!activeLayer) return;
              if (isRecolorEnabled) {
                updateLayerCycleColors(activeLayer.id, cycleColors);
              } else {
                setPlannedSettings((prev) => ({ ...prev, cycleColors }));
              }
            }}
            onFlowDirectionChange={(direction) => {
              if (!activeLayer) return;
              if (isRecolorEnabled) {
                updateLayerFlowDirection(activeLayer.id, direction);
              } else {
                setPlannedSettings((prev) => ({ ...prev, flowDirection: direction }));
              }
            }}
            onMappingModeChange={(mode) => {
              if (!activeLayer) return;
              actions.clearError();
              if (isRecolorEnabled) {
                updateLayerMappingMode(activeLayer.id, mode);
              } else {
                setPlannedSettings((prev) => ({ ...prev, mappingMode: mode }));
              }
            }}
            onFlowMappingChange={(mode) => {
              if (!activeLayer) return;
              actions.clearError();
              if (isRecolorEnabled) {
                // Use manager directly via state action
                try {
                  const manager = RecolorManager.getInstance();
                  manager.setLayerFlowMapping(activeLayer.id, mode);
                } catch (e) {
                  console.warn('Failed to set flow mapping', e);
                }
              } else {
                setPlannedSettings((prev) => ({ ...prev, flowMapping: mode }));
              }
            }}
          />

          {/* Flow Tools */}
          {isRecolorEnabled && (
            <div className="mt-2 flex items-center gap-3">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (!activeLayer) return;
                  try {
                    const manager = RecolorManager.getInstance();
                    manager.clearPaletteDirectionalOrder(activeLayer.id);
                  } catch {}
                }}
                title="Revert to default palette flow order"
              >
                Reset Flow Order
              </Button>
            </div>
          )}

          {/* Advanced settings removed per request */}
        </div>
      )}

      {/* Brush mode helper text removed per request */}

      {/* Enhanced No Active Layer Message */}
      {!activeLayer && (
        <div className="p-4 bg-yellow-900/30 border border-yellow-500 rounded text-sm text-yellow-300">
          <div className="flex items-center gap-2 mb-2">
            <span>💡</span>
            <span className="font-medium">No Layer Selected</span>
          </div>
          <p>Create or select a layer to begin color cycling animation.</p>
          <p className="text-xs text-yellow-400 mt-1">
            Layers with image content work best for recolor mode.
          </p>
        </div>
      )}

      {/* Enhanced Error Display with Recovery Suggestions */}
      {state.error && (
        <div className="mt-4 p-3 bg-red-900/30 border border-red-500 rounded text-red-300 text-sm animate-slideIn">
          <div className="flex items-start gap-2">
            <span className="text-red-400 mt-0.5">⚠️</span>
            <div className="flex-1">
              <div className="font-medium">{state.error}</div>
              <div className="text-xs text-red-400 mt-1">
                Try selecting a different layer or check console for details
              </div>
            </div>
            <button
              onClick={actions.clearError}
              className="text-red-400 hover:text-red-300 p-1 -m-1"
              title="Dismiss error"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Success Message */}
      {successMessage && (
        <div className="mt-4 p-3 bg-green-900/30 border border-green-500 rounded text-green-300 text-sm animate-slideIn">
          <div className="flex items-center gap-2">
            <span className="text-green-400">✅</span>
            <span>{successMessage}</span>
          </div>
        </div>
      )}

      {/* Performance indicator removed per request */}

      {/* Extract Colors Dialog removed */}

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={confirmationDialog.isOpen}
        title={confirmationDialog.title}
        message={confirmationDialog.message}
        variant="warning"
        confirmText="Convert"
        onConfirm={() => confirmationDialog.action?.()}
        onCancel={() => setConfirmationDialog((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};
