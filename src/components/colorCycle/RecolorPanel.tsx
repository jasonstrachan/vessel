/**
 * RecolorPanel - Main UI component for the Recolor & Animate feature
 * 
 * Clean, modular interface with comprehensive state management
 * and real-time performance monitoring.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer } from '../../types';
import { RecolorManager } from '../../lib/colorCycle/RecolorManager';
import { useKeyboardScope } from '../../hooks/useKeyboardScope';

// Custom hooks for state management
import { useRecolorState } from './hooks/useRecolorState';

// Modular sub-components
import { GradientEditor, type GradientEditorHandle } from '../ui/GradientEditor';
import { useAppStore } from '../../stores/useAppStore';
import { selectLayers } from '@/stores/selectors/layersSelectors';
import { selectCurrentTool } from '@/stores/selectors/toolsSelectors';
import { AnimationControls } from './controls/AnimationControls';
import Button from '../ui/Button';
import {
  DEFAULT_GRADIENT_STOPS,
} from '@/utils/gradientPresets';
// Extract colors feature removed from UI
import { ConfirmationDialog } from './dialogs/ConfirmationDialog';

type GradientStop = { position: number; color: string; opacity?: number };

const cloneStops = (stops?: GradientStop[] | null): GradientStop[] =>
  (stops ?? DEFAULT_GRADIENT_STOPS).map((stop) => ({ ...stop }));

export interface RecolorPanelProps {
  activeLayer: Layer | null;
  isVisible: boolean;
  onError?: (error: string) => void;
  onCommit?: (gradient: GradientStop[]) => void;
  onCancel?: () => void;
}

export const RecolorPanel: React.FC<RecolorPanelProps> = ({
  activeLayer,
  isVisible,
  onError,
  onCommit,
  onCancel
}) => {
  // Use custom state management hook
  const {
    state,
    actions,
    processLayer,
    updateLayerSpeed,
    updateLayerCycleColors,
    updateLayerFlowDirection,
    updateLayerMappingMode,
    updateLayerFlowMapping,
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
  const layers = useAppStore(selectLayers);
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);
  const currentTool = useAppStore(selectCurrentTool);
  // While the recolor panel is visible and in recolor mode, suspend global/canvas shortcuts
  useKeyboardScope('recolor', isVisible && state.mode === 'recolor');

  // debug log removed
  // Planned (pre-conversion) animation settings so users can configure before applying
  const [plannedSettings, setPlannedSettings] = useState({
    speed: 0.1 as number,
    fps: 30 as number,
    cycleColors: 16 as number,
    flowDirection: 'reverse' as 'forward' | 'reverse' | 'pingpong' | 'bounce',
    mappingMode: 'banded' as 'banded' | 'continuous',
    flowMapping: 'palette' as 'palette' | 'directional' | 'luminance'
  });
  const [plannedGradient, setPlannedGradient] = useState<GradientStop[]>(() => cloneStops(DEFAULT_GRADIENT_STOPS));

  const gradientEditorRef = useRef<GradientEditorHandle>(null);
  const originalGradientRef = useRef<GradientStop[] | null>(null);
  const latestPreviewRef = useRef<GradientStop[] | null>(null);
  const hasPendingChangesRef = useRef(false);
  const cancelTriggeredRef = useRef(false);
  const wasVisibleRef = useRef(false);
  const originalLayerIdRef = useRef<string | null>(null);
  const originalModeRef = useRef<string | null>(null);

  const activeLayerId = activeLayer?.id ?? null;
  const activeLayerMode = activeLayer?.colorCycleData?.mode ?? null;

  const applyBrushGradient = useCallback(
    (stops: GradientStop[]) => {
      setBrushSettings({
        colorCycleGradient: stops.map((stop) => ({ ...stop })),
      });
    },
    [setBrushSettings],
  );

  const layersById = useMemo(() => {
    const map = new Map<string, Layer>();
    layers.forEach((layer) => map.set(layer.id, layer));
    return map;
  }, [layers]);

  const commitGradientForLayer = useCallback(
    (layerId: string, stops: GradientStop[]) => {
      const targetLayer = layersById.get(layerId);
      if (!targetLayer || targetLayer.locked) {
        return;
      }

      if (targetLayer.colorCycleData?.mode === 'recolor') {
        updateGradient(targetLayer, cloneStops(stops));
      }

      applyBrushGradient(stops);
    },
    [layersById, updateGradient, applyBrushGradient],
  );

  useEffect(() => {
    if (!isVisible) {
      wasVisibleRef.current = false;
      return;
    }

    if (!activeLayerId) {
      hasPendingChangesRef.current = false;
      cancelTriggeredRef.current = false;
      originalGradientRef.current = null;
      latestPreviewRef.current = null;
      originalLayerIdRef.current = null;
      originalModeRef.current = null;
      return;
    }

    const shouldReset =
      !wasVisibleRef.current ||
      originalLayerIdRef.current !== activeLayerId ||
      originalModeRef.current !== activeLayerMode;

    if (shouldReset) {
      const layer = layersById.get(activeLayerId);
      const baseStops =
        (layer?.colorCycleData?.mode === 'recolor'
          ? layer.colorCycleData?.recolorSettings?.gradient
          : layer?.colorCycleData?.gradient) ?? DEFAULT_GRADIENT_STOPS;

      const cloned = cloneStops(baseStops);
      originalGradientRef.current = cloned;
      latestPreviewRef.current = cloned.map((stop) => ({ ...stop }));
      hasPendingChangesRef.current = false;
      cancelTriggeredRef.current = false;
      originalLayerIdRef.current = activeLayerId;
      originalModeRef.current = activeLayerMode;

      if (!isRecolorEnabled) {
        setPlannedGradient(cloned);
      }
    }

    wasVisibleRef.current = true;
  }, [isVisible, activeLayerId, activeLayerMode, isRecolorEnabled, layersById]);

  // Keep planned settings synced with active recolor layer when available
  useEffect(() => {
    if (!recolorSettings) return;

    setPlannedSettings({
      speed: recolorSettings.animation.speed ?? 0.1,
      fps: recolorSettings.animation.fps ?? 30,
      cycleColors: recolorSettings.cycleColors ?? 16,
      flowDirection: recolorSettings.animation.flowDirection ?? 'reverse',
      mappingMode: recolorSettings.mappingMode ?? 'banded',
      flowMapping: recolorSettings.flowMapping ?? 'palette'
    });
  }, [recolorSettings]);

  const recolorGradientTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recolorGradientPendingRef = useRef<{
    stops: GradientStop[];
    layerId: string;
  } | null>(null);

  const scheduleRecolorGradientUpdate = useCallback(
    (stops: GradientStop[], immediate = false) => {
      if (!activeLayerId) {
        return;
      }
      recolorGradientPendingRef.current = {
        stops: cloneStops(stops),
        layerId: activeLayerId
      };

      if (recolorGradientTimerRef.current) {
        clearTimeout(recolorGradientTimerRef.current);
        recolorGradientTimerRef.current = null;
      }

      const flush = () => {
        recolorGradientTimerRef.current = null;
        const pending = recolorGradientPendingRef.current;
        if (!pending) return;
        commitGradientForLayer(pending.layerId, pending.stops);
        recolorGradientPendingRef.current = null;
      };

      if (immediate) {
        flush();
        return;
      }

      recolorGradientTimerRef.current = setTimeout(flush, 80);
    },
    [activeLayerId, commitGradientForLayer]
  );

  useEffect(() => {
    return () => {
      if (recolorGradientTimerRef.current) {
        clearTimeout(recolorGradientTimerRef.current);
        recolorGradientTimerRef.current = null;
        const pending = recolorGradientPendingRef.current;
        if (pending) {
          commitGradientForLayer(pending.layerId, pending.stops);
          recolorGradientPendingRef.current = null;
        }
      }
    };
  }, [commitGradientForLayer]);

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
      commitGradientForLayer(pending.layerId, pending.stops);
      recolorGradientPendingRef.current = null;
    }
  }, [activeLayer?.id, commitGradientForLayer]);

  const revertToOriginal = useCallback(() => {
    if (!activeLayerId || !originalGradientRef.current) {
      return;
    }

    if (recolorGradientTimerRef.current) {
      clearTimeout(recolorGradientTimerRef.current);
      recolorGradientTimerRef.current = null;
    }
    recolorGradientPendingRef.current = null;

    const originalStops = cloneStops(originalGradientRef.current);
    gradientEditorRef.current?.cancelDraft(originalStops);
    if (!hasPendingChangesRef.current) return;
    commitGradientForLayer(activeLayerId, originalStops);

    if (!isRecolorEnabled) {
      setPlannedGradient(originalStops);
    }

    hasPendingChangesRef.current = false;
    latestPreviewRef.current = originalStops.map((stop) => ({ ...stop }));
    cancelTriggeredRef.current = true;
  }, [activeLayerId, commitGradientForLayer, isRecolorEnabled]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        revertToOriginal();
        onCancel?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isVisible, onCancel, revertToOriginal]);

  useEffect(() => {
    if (!wasVisibleRef.current) {
      return;
    }

    if (!isVisible) {
      wasVisibleRef.current = false;
      if (!cancelTriggeredRef.current && hasPendingChangesRef.current && latestPreviewRef.current) {
        onCommit?.(cloneStops(latestPreviewRef.current));
      }
      cancelTriggeredRef.current = false;
      hasPendingChangesRef.current = false;
    }
  }, [isVisible, onCommit]);

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
        <fieldset aria-label="Recolor controls" disabled={activeLayer.locked} inert={activeLayer.locked} className="m-0 min-w-0 space-y-4 border-0 p-0">
          {/* Gradient Editor - always visible; first selection applies conversion and plays */}
          <div className="mb-2">
          <GradientEditor
            ref={gradientEditorRef}
            sampleTarget="recolor"
            stops={isRecolorEnabled ? (recolorSettings?.gradient || []) : plannedGradient}
            onChange={async (stops) => {
              if (!activeLayer || activeLayer.locked) return;

              const clonedStops = cloneStops(stops);
              hasPendingChangesRef.current = true;
              cancelTriggeredRef.current = false;
              latestPreviewRef.current = clonedStops.map((stop) => ({ ...stop }));

              if (isRecolorEnabled) {
                scheduleRecolorGradientUpdate(clonedStops);
              } else {
                setPlannedGradient(clonedStops);
                await processLayer(activeLayer, {
                  quantizationMode: 'rgb332',
                  ditherMode: 'off',
                  cycleColors: plannedSettings.cycleColors,
                  gradientPreset: 'custom',
                  customGradient: clonedStops
                }, {
                  speed: plannedSettings.speed,
                  fps: plannedSettings.fps,
                  flowDirection: plannedSettings.flowDirection,
                  mappingMode: plannedSettings.mappingMode,
                  flowMapping: plannedSettings.flowMapping,
                });
              }
              if (currentTool !== 'recolor') {
                setBrushSettings({ colorCycleGradient: clonedStops });
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
            flowDirection={isRecolorEnabled ? (recolorSettings?.animation.flowDirection || 'reverse') : plannedSettings.flowDirection}
            mappingMode={isRecolorEnabled ? (recolorSettings?.mappingMode || 'banded') : plannedSettings.mappingMode}
            flowMapping={isRecolorEnabled ? (recolorSettings?.flowMapping || 'palette') : plannedSettings.flowMapping}
            onSpeedChange={(speed) => {
              if (!activeLayer || activeLayer.locked) return;
              if (isRecolorEnabled) {
                updateLayerSpeed(activeLayer.id, speed);
              } else {
                setPlannedSettings((prev) => ({ ...prev, speed }));
              }
            }}
            onFPSChange={(fps) => {
              if (!activeLayer || activeLayer.locked) return;
              if (isRecolorEnabled) {
                updateGlobalFPS(fps);
              } else {
                setPlannedSettings((prev) => ({ ...prev, fps }));
              }
            }}
            onCycleColorsChange={(cycleColors) => {
              if (!activeLayer || activeLayer.locked) return;
              if (isRecolorEnabled) {
                updateLayerCycleColors(activeLayer.id, cycleColors);
              } else {
                setPlannedSettings((prev) => ({ ...prev, cycleColors }));
              }
            }}
            onFlowDirectionChange={(direction) => {
              if (!activeLayer || activeLayer.locked) return;
              if (isRecolorEnabled) {
                updateLayerFlowDirection(activeLayer.id, direction);
              } else {
                setPlannedSettings((prev) => ({ ...prev, flowDirection: direction }));
              }
            }}
            onMappingModeChange={(mode) => {
              if (!activeLayer || activeLayer.locked) return;
              actions.clearError();
              if (isRecolorEnabled) {
                updateLayerMappingMode(activeLayer.id, mode);
              } else {
                setPlannedSettings((prev) => ({ ...prev, mappingMode: mode }));
              }
            }}
            onFlowMappingChange={(mode) => {
              if (!activeLayer || activeLayer.locked) return;
              actions.clearError();
              if (isRecolorEnabled) {
                updateLayerFlowMapping(activeLayer.id, mode);
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
                  if (!activeLayer || activeLayer.locked) return;
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
        </fieldset>
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
