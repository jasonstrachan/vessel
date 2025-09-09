/**
 * RecolorPanel - Main UI component for the Recolor & Animate feature
 * 
 * Clean, modular interface with comprehensive state management,
 * keyboard shortcuts, and real-time performance monitoring.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Layer } from '../../types';
import { RecolorManager } from '../../lib/colorCycle/RecolorManager';

// Custom hooks for state management
import { useRecolorState } from './hooks/useRecolorState';
import { useRecolorShortcuts } from './hooks/useRecolorShortcuts';

// Modular sub-components
import { ModeToggle } from './controls/ModeToggle';
import { LayerSelector } from './controls/LayerSelector';
import { GradientEditor } from '../ui/GradientEditor';
import { useAppStore } from '../../stores/useAppStore';
import { AnimationControls } from './controls/AnimationControls';
import { QualityControls } from './controls/QualityControls';
import { ExtractColorsDialog } from './dialogs/ExtractColorsDialog';
import { ConfirmationDialog } from './dialogs/ConfirmationDialog';
import { PerformanceIndicator } from './indicators/PerformanceIndicator';

export interface RecolorPanelProps {
  layers: Layer[];
  activeLayer: Layer | null;
  isVisible: boolean;
  onLayerChange: (layer: Layer) => void;
  onClose?: () => void;
  onError?: (error: string) => void;
}

export const RecolorPanel: React.FC<RecolorPanelProps> = ({
  layers,
  activeLayer,
  isVisible,
  onLayerChange,
  onClose,
  onError
}) => {
  // Use custom state management hook
  const {
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
    recolorableLayers,
    successMessage
  } = useRecolorState(layers, activeLayer, {
    initialMode: 'brush',
    onError
  });

  // Current layer's recolor settings
  const recolorSettings = activeLayer?.colorCycleData?.recolorSettings;
  const isRecolorEnabled = activeLayer?.colorCycleData?.mode === 'recolor' && recolorSettings;
  
  // debug log removed

  // Gradient presets for shortcuts (memoized to avoid dependency issues)
  const gradientPresets = useMemo(() => [
    { name: 'rainbow', gradient: [
      { position: 0, color: '#ff0000' },
      { position: 0.17, color: '#ff8000' },
      { position: 0.33, color: '#ffff00' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.67, color: '#0080ff' },
      { position: 0.83, color: '#8000ff' },
      { position: 1, color: '#ff0000' }
    ]},
    { name: 'fire', gradient: [
      { position: 0, color: '#000000' },
      { position: 0.3, color: '#800000' },
      { position: 0.6, color: '#ff4000' },
      { position: 0.8, color: '#ffff00' },
      { position: 1, color: '#ffffff' }
    ]},
    { name: 'ocean', gradient: [
      { position: 0, color: '#000040' },
      { position: 0.5, color: '#0080ff' },
      { position: 1, color: '#80ffff' }
    ]},
    { name: 'sunset', gradient: [
      { position: 0, color: '#4000ff' },
      { position: 0.3, color: '#ff0080' },
      { position: 0.6, color: '#ff8000' },
      { position: 1, color: '#ffff80' }
    ]}
  ], []);

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
          gradientPreset: 'rainbow'
        });
      } else {
        // If already in recolor mode, just toggle animation instead of converting back
        toggleAnimation();
      }
      onLayerChange(activeLayer);
    },
    extractColors: actions.showExtractDialog,
    speedUp: () => {
      if (activeLayer && recolorSettings) {
        const newSpeed = Math.min(2.0, recolorSettings.animation.speed + 0.1);
        updateLayerSpeed(activeLayer.id, newSpeed);
      }
    },
    slowDown: () => {
      if (activeLayer && recolorSettings) {
        const newSpeed = Math.max(0.1, recolorSettings.animation.speed - 0.1);
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
        updateLayerSpeed(activeLayer.id, 0.4);
      }
    },
    toggleAdvanced: actions.toggleAdvancedControls
  }), [
    toggleAnimation,
    activeLayer,
    state.mode,
    processLayer,
    convertToNormal,
    onLayerChange,
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

  // Event handlers
  const handleModeChange = useCallback(async (newMode: 'brush' | 'recolor') => {
    if (!activeLayer) return;
    
    // Show confirmation for destructive actions
    if (newMode === 'brush' && activeLayer.colorCycleData?.mode === 'recolor') {
      setConfirmationDialog({
        isOpen: true,
        title: 'Convert to Brush Mode',
        message: 'This will remove the recolor animation and convert the layer back to normal mode. This action cannot be undone.',
        action: async () => {
          await convertToNormal(activeLayer);
          onLayerChange(activeLayer);
          setConfirmationDialog((prev) => ({ ...prev, isOpen: false }));
        }
      });
      return;
    }
    
    if (newMode === 'recolor') {
      // If already in recolor mode, treat this button as a quick toggle for animation
      if (activeLayer.colorCycleData?.mode === 'recolor') {
        toggleAnimation();
      } else {
        const ok = await processLayer(activeLayer, {
          quantizationMode: 'rgb332',
          ditherMode: 'off',
          cycleColors: 16,
          gradientPreset: 'rainbow'
        });
        // Auto-start animation after successful conversion
        if (ok) {
          toggleAnimation();
        }
      }
    } else {
      await convertToNormal(activeLayer);
    }
    onLayerChange(activeLayer);
  }, [activeLayer, processLayer, convertToNormal, onLayerChange, toggleAnimation]);

  const handleExtractDialogClose = useCallback((gradient?: Array<{ position: number; color: string }>) => {
    actions.hideExtractDialog();
    
    if (gradient && activeLayer) {
      updateGradient(activeLayer, gradient);
      // Sync brush UI only when not in recolor tool to avoid brush-engine effects
      const store = useAppStore.getState();
      if (store.tools.currentTool !== 'recolor') {
        store.setBrushSettings({ colorCycleGradient: gradient });
      }
    }
  }, [activeLayer, updateGradient, onLayerChange, actions]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="recolor-panel w-full text-white p-2">
      {/* Header */}
      <div className="flex items-center mb-3">
        <h3 className="text-lg font-semibold">Recolor and animate</h3>
      </div>

      {/* Mode Toggle */}
      <div className="mb-3">
        <ModeToggle
          mode={state.mode}
          onChange={handleModeChange}
          disabled={state.isProcessing || !activeLayer}
        />
      </div>

      {/* Layer Selector */}
      <div className="mb-4">
        <LayerSelector
          layers={recolorableLayers}
          activeLayer={activeLayer}
          onLayerChange={onLayerChange}
          mode={state.mode}
        />
      </div>

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

      {/* Recolor Mode Controls */}
      {state.mode === 'recolor' && activeLayer && (
        <div className="space-y-4">
          {/* Gradient Editor (shared with Color Cycle brushes) */}
          <div className="mb-2">
            <GradientEditor
              stops={recolorSettings?.gradient || []}
              onChange={(stops) => {
                if (!activeLayer) return;
                // Update recolor layer gradient
                updateGradient(activeLayer, stops);
              // Keep brush UI in sync without mutating layer state again.
              // Avoid touching brush settings while in recolor tool to prevent brush-engine side effects.
              const store = useAppStore.getState();
              if (store.tools.currentTool !== 'recolor') {
                store.setBrushSettings({ colorCycleGradient: stops });
              }
              }}
            />
          </div>

          {/* Extract Colors (preserve feature) */}
          <button
            type="button"
            onClick={actions.showExtractDialog}
            disabled={!isRecolorEnabled}
            className={`
              w-full px-3 py-2 text-sm font-medium rounded-lg border transition-colors mb-2
              ${!isRecolorEnabled
                ? 'opacity-50 cursor-not-allowed bg-gray-700 border-gray-600 text-gray-300'
                : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'}
            `}
          >
            Extract from Layer
          </button>

          {/* Animation Controls */}
          <AnimationControls
            isPlaying={isAnimating}
            speed={recolorSettings?.animation.speed || 0.4}
            fps={recolorSettings?.animation.fps || 30}
            cycleColors={recolorSettings?.cycleColors || 16}
            flowDirection={recolorSettings?.animation.flowDirection || 'forward'}
            mappingMode={recolorSettings?.mappingMode || 'banded'}
            onToggleAnimation={toggleAnimation}
            onSpeedChange={(speed) => activeLayer && updateLayerSpeed(activeLayer.id, speed)}
            onFPSChange={updateGlobalFPS}
            onCycleColorsChange={(cycleColors) => activeLayer && updateLayerCycleColors(activeLayer.id, cycleColors)}
            onFlowDirectionChange={(direction) => activeLayer && updateLayerFlowDirection(activeLayer.id, direction)}
            onMappingModeChange={(mode) => {
              if (!activeLayer) return;
              actions.clearError();
              updateLayerMappingMode(activeLayer.id, mode);
            }}
            disabled={!isRecolorEnabled}
          />

          {/* Advanced Controls Toggle */}
          <button
            onClick={actions.toggleAdvancedControls}
            className="w-full text-left text-sm text-gray-400 hover:text-white flex items-center justify-between"
          >
            <span>Advanced Settings</span>
            <span className={`transform transition-transform ${state.showAdvancedControls ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </button>

          {/* Quality Controls (Advanced) */}
          {state.showAdvancedControls && (
            <QualityControls
              quantizationMode={recolorSettings?.quantizationMode || 'rgb332'}
              ditherMode={recolorSettings?.ditherMode || 'off'}
              currentLOD={recolorSettings?.currentLOD || 'full'}
              performanceMode={state.performanceMode}
              quality={'balanced'}
              useSpatialHash={true}
              onQuantizationModeChange={(mode) => {
                // Would trigger reprocessing
                console.log('Quantization mode changed:', mode);
              }}
              onDitherModeChange={(mode) => {
                // Would trigger reprocessing
                console.log('Dither mode changed:', mode);
              }}
              onPerformanceModeChange={actions.setPerformanceMode}
              onQualityChange={(quality) => {
                console.log('Quality changed:', quality);
              }}
              onSpatialHashChange={(enabled) => {
                console.log('Spatial hash changed:', enabled);
              }}
              disabled={!isRecolorEnabled}
            />
          )}
        </div>
      )}

      {/* Brush Mode Message */}
      {state.mode === 'brush' && (
        <div className="p-3 bg-gray-700 rounded text-sm text-gray-300">
          <p>Brush mode: Paint with color cycling brushes.</p>
          <p className="mt-1">Switch to <strong>Recolor</strong> mode to animate existing layers.</p>
        </div>
      )}

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

      {/* Performance Indicator */}
      <div className="mt-4 pt-4 border-t border-gray-600">
        <PerformanceIndicator
          recolorManager={recolorableLayers[0] ? RecolorManager.getInstance() : null}
          compact={!state.showAdvancedControls}
          performanceStats={performanceStats}
        />
      </div>

      {/* Extract Colors Dialog */}
      {state.showExtractDialog && activeLayer && (
        <ExtractColorsDialog
          layer={activeLayer}
          isOpen={state.showExtractDialog}
          onClose={handleExtractDialogClose}
          recolorManager={RecolorManager.getInstance()}
        />
      )}

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
