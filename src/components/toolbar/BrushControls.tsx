"use client";

// Simple brush controls for proof of concept
// Based on /docs/03_Features/Drawing_Tools.md (lines 8-48)

import React from "react";
import { useAppStore } from "../../stores/useAppStore";
import {
  selectActiveLayerId,
  selectLayers,
} from '@/stores/selectors/layersSelectors';
import {
  selectBrushSettings,
  selectCurrentTool,
  selectEraserSettings,
  selectGlobalBrushSize,
  selectShapeMode,
} from '@/stores/selectors/toolsSelectors';
import { BrushShape, type BrushSettings } from "../../types";
import Input from "../ui/Input";
import ProgressSlider from "../ui/ProgressSlider";
// Using ProgressSlider to match pixel square brush opacity style
import Dropdown from "../ui/Dropdown";
import ButtonGroup from "../ui/ButtonGroup";
import { drawTestSwatches } from "../../utils/drawTestSwatches";
import { GradientEditor } from "../ui/GradientEditor";
import CustomSwitch from "../ui/CustomSwitch";
import { isStrokeBrush } from "../../utils/brushCategories";
import {
  DEFAULT_GRADIENT_STOPS,
  getPresetOptions as getRectGradientPresetOptions,
  getPresetStops
} from '@/utils/gradientPresets';
import { isColorCycleBrush, getShapeModeForBrush, setSharedColorCycleGradient } from "../../utils/colorCycleGradients";
import {
  PRESSURE_MIN_PERCENT,
  clampPressurePercent,
  getDefaultMaxPressurePercent,
} from '@/utils/pressureSettings';
import ShapeFillControls from "./ShapeFillControls";
import {
  COLOR_CYCLE_SPEED_STEP,
  MAX_BRUSH_COLOR_CYCLE_SPEED,
  MIN_BRUSH_COLOR_CYCLE_SPEED,
} from '@/constants/colorCycle';

const PRESSURE_MIN_BOUND = PRESSURE_MIN_PERCENT;
const CONTROL_LABEL_CLASS = 'text-[#D9D9D9] w-16';
const CONTROL_LABEL_STYLE: React.CSSProperties = { fontSize: '14px' };

const BrushControls = () => {
  // Use individual selectors to avoid unstable object references
  const setBrushSettings = useAppStore(state => state.setBrushSettings);
  const setEraserSettings = useAppStore(state => state.setEraserSettings);
  const setGlobalBrushSize = useAppStore(state => state.setGlobalBrushSize);
  const setCustomBrushSizePercent = useAppStore(state => state.setCustomBrushSizePercent);
  const brushSettings = useAppStore(selectBrushSettings);
  const eraserSettings = useAppStore(selectEraserSettings);
  const currentTool = useAppStore(selectCurrentTool);
  const globalBrushSize = useAppStore(selectGlobalBrushSize);
  const customBrushPercent = brushSettings.customBrushSizePercent ?? 100;
  const shapeMode = useAppStore(selectShapeMode);
  const setShapeMode = useAppStore(state => state.setShapeMode);
  const setBrushPreset = useAppStore(state => state.setBrushPreset);
  const brushPresets = useAppStore((state) => state.brushPresets);
  // For per-layer CC brush speed
  const activeLayerId = useAppStore(selectActiveLayerId);
  const layers = useAppStore(selectLayers);
  const updateLayer = useAppStore((state) => state.updateLayer);
  const addNotification = useAppStore((state) => state.addNotification);
  const desiredColorCyclePlaying = useAppStore(state => state.colorCyclePlayback.desiredPlaying);
  const playColorCycle = useAppStore(state => state.playColorCycle);
  const pauseColorCycle = useAppStore(state => state.pauseColorCycle);
  const colorCycleRuntimeHandlers = useAppStore(state => state.colorCycleRuntimeHandlers);
  const activeLayer = React.useMemo(
    () => layers.find((layer) => layer.id === activeLayerId) ?? null,
    [layers, activeLayerId]
  );
  
  const showColorCycleLayerHint = React.useCallback(() => {
    if (typeof addNotification !== 'function') {
      return;
    }

    addNotification({
      type: 'info',
      title: 'Select a color cycle layer',
      message: 'Custom brush color cycling only works on color cycle layers. Pick one in the Layers panel first.',
      timestamp: new Date()
    });
  }, [addNotification]);

  // Determine if current brush is custom (uses percentage) or default (uses pixels)
  const activeSettings =
    currentTool === 'eraser' ? eraserSettings : brushSettings;
  const isActiveCustomBrush = activeSettings.brushShape === BrushShape.CUSTOM;
  const sizeUnit = isActiveCustomBrush ? '%' : 'px';

  // Use the appropriate settings and setter based on current tool
  const setActiveSettings =
    currentTool === 'eraser' ? setEraserSettings : setBrushSettings;

  const isCustomColorCycleEnabled = isActiveCustomBrush && !!activeSettings.customBrushColorCycle;
  const isShapeFillBrush = brushSettings.brushShape === BrushShape.SHAPE_FILL;
  const eraserLinkSize = eraserSettings.linkSizeToBrush !== false;

  const [pressureDraft, setPressureDraft] = React.useState(() => ({
    min: (activeSettings.minPressure ?? PRESSURE_MIN_BOUND).toString(),
    max: (
      activeSettings.maxPressure ?? getDefaultMaxPressurePercent(activeSettings.brushShape)
    ).toString(),
  }));
  const [pressureEditing, setPressureEditing] = React.useState<{ min: boolean; max: boolean }>({
    min: false,
    max: false,
  });

  const updatePressureEditing = React.useCallback((key: 'min' | 'max', value: boolean) => {
    setPressureEditing((prev) => {
      if (prev[key] === value) {
        return prev;
      }
      return { ...prev, [key]: value };
    });
  }, []);

  React.useEffect(() => {
    if (pressureEditing.min) {
      return;
    }
    const nextMin = (activeSettings.minPressure ?? PRESSURE_MIN_BOUND).toString();
    setPressureDraft((draft) => (draft.min === nextMin ? draft : { ...draft, min: nextMin }));
  }, [activeSettings.minPressure, pressureEditing.min]);

  React.useEffect(() => {
    if (pressureEditing.max) {
      return;
    }
    const nextMax = (
      activeSettings.maxPressure ?? getDefaultMaxPressurePercent(activeSettings.brushShape)
    ).toString();
    setPressureDraft((draft) => (draft.max === nextMax ? draft : { ...draft, max: nextMax }));
  }, [activeSettings.maxPressure, activeSettings.brushShape, pressureEditing.max]);

  React.useEffect(() => {
    if (activeSettings.pressureEnabled) {
      return;
    }
    setPressureEditing((prev) =>
      prev.min === false && prev.max === false ? prev : { min: false, max: false }
    );
    const nextMin = (activeSettings.minPressure ?? PRESSURE_MIN_BOUND).toString();
    const nextMax = (
      activeSettings.maxPressure ?? getDefaultMaxPressurePercent(activeSettings.brushShape)
    ).toString();
    setPressureDraft((draft) =>
      draft.min === nextMin && draft.max === nextMax ? draft : { min: nextMin, max: nextMax }
    );
  }, [
    activeSettings.pressureEnabled,
    activeSettings.minPressure,
    activeSettings.maxPressure,
    activeSettings.brushShape,
  ]);

  const handleMinChange = React.useCallback(
    (raw: string) => {
      if (raw === '') {
        setPressureDraft((draft) => (draft.min === '' ? draft : { ...draft, min: '' }));
        return;
      }
      const parsed = Number.parseInt(raw, 10);
      if (Number.isNaN(parsed)) {
        return;
      }
      const clamped = clampPressurePercent(parsed);
      const currentMax =
        activeSettings.maxPressure ?? getDefaultMaxPressurePercent(activeSettings.brushShape);
      const updates: Partial<BrushSettings> = { minPressure: clamped };
      let nextMax = currentMax;
      if (currentMax < clamped) {
        updates.maxPressure = clamped;
        nextMax = clamped;
      }
      setActiveSettings(updates);
      setPressureDraft((draft) => {
        const minString = clamped.toString();
        const maxString = nextMax.toString();
        if (draft.min === minString && draft.max === maxString) {
          return draft;
        }
        return { ...draft, min: minString, max: maxString };
      });
    },
    [activeSettings.maxPressure, activeSettings.brushShape, setActiveSettings]
  );

  const handleMinFocus = React.useCallback(() => {
    updatePressureEditing('min', true);
  }, [updatePressureEditing]);

  const handleMinBlur = React.useCallback(() => {
    updatePressureEditing('min', false);
    if (pressureDraft.min === '') {
      const fallback = clampPressurePercent(activeSettings.minPressure ?? PRESSURE_MIN_BOUND);
      const currentMax =
        activeSettings.maxPressure ?? getDefaultMaxPressurePercent(activeSettings.brushShape);
      const updates: Partial<BrushSettings> = { minPressure: fallback };
      let nextMax = currentMax;
      if (currentMax < fallback) {
        updates.maxPressure = fallback;
        nextMax = fallback;
      }
      setActiveSettings(updates);
      setPressureDraft((draft) => {
        const minString = fallback.toString();
        const maxString = nextMax.toString();
        if (draft.min === minString && draft.max === maxString) {
          return draft;
        }
        return { ...draft, min: minString, max: maxString };
      });
      return;
    }
    handleMinChange(pressureDraft.min);
  }, [
    pressureDraft.min,
    activeSettings.minPressure,
    activeSettings.maxPressure,
    activeSettings.brushShape,
    updatePressureEditing,
    handleMinChange,
    setActiveSettings,
  ]);

  const handleMaxChange = React.useCallback(
    (raw: string) => {
      if (raw === '') {
        setPressureDraft((draft) => (draft.max === '' ? draft : { ...draft, max: '' }));
        return;
      }
      const parsed = Number.parseInt(raw, 10);
      if (Number.isNaN(parsed)) {
        return;
      }
      const baseMin = clampPressurePercent(activeSettings.minPressure ?? PRESSURE_MIN_BOUND);
      const clamped = Math.max(clampPressurePercent(parsed), baseMin);
      const nextString = clamped.toString();
      setActiveSettings({ maxPressure: clamped });
      setPressureDraft((draft) => (draft.max === nextString ? draft : { ...draft, max: nextString }));
    },
    [activeSettings.minPressure, setActiveSettings]
  );

  const handleMaxFocus = React.useCallback(() => {
    updatePressureEditing('max', true);
  }, [updatePressureEditing]);

  const handleMaxBlur = React.useCallback(() => {
    updatePressureEditing('max', false);
    if (pressureDraft.max === '') {
      setActiveSettings({ maxPressure: undefined });
      const fallback = getDefaultMaxPressurePercent(activeSettings.brushShape).toString();
      setPressureDraft((draft) => (draft.max === fallback ? draft : { ...draft, max: fallback }));
      return;
    }
    handleMaxChange(pressureDraft.max);
  }, [
    pressureDraft.max,
    activeSettings.brushShape,
    updatePressureEditing,
    handleMaxChange,
    setActiveSettings,
  ]);

  React.useEffect(() => {
    // Only auto-enable shapeMode for SHAPE_FILL when the current tool is 'brush'
    // This prevents shape mode from being enabled when using other tools
    if (isShapeFillBrush && !shapeMode && currentTool === 'brush') {
      setShapeMode(true);
    }
  }, [isShapeFillBrush, shapeMode, setShapeMode, currentTool]);

  const gradientDebounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const gradientFrameRef = React.useRef<number | null>(null);
  const pendingGradientRef = React.useRef<Array<{ position: number; color: string }>>(
    brushSettings.colorCycleGradient
      ? brushSettings.colorCycleGradient.map(stop => ({ ...stop }))
      : DEFAULT_GRADIENT_STOPS.map(stop => ({ ...stop }))
  );
  const pendingLayerUpdateRef = React.useRef<{
    layerId: string;
    gradient: Array<{ position: number; color: string }>;
  } | null>(null);

  const flushPendingGradient = React.useCallback(() => {
    const stops = pendingGradientRef.current;
    const clonedStops = stops.map(stop => ({ ...stop }));
    setActiveSettings({ colorCycleGradient: clonedStops });
    setSharedColorCycleGradient(clonedStops);

    const pendingLayerUpdate = pendingLayerUpdateRef.current;
    if (pendingLayerUpdate) {
      updateLayer(pendingLayerUpdate.layerId, {
        colorCycleData: {
          gradient: pendingLayerUpdate.gradient.map(stop => ({ ...stop }))
        }
      });
      pendingLayerUpdateRef.current = null;
    }

    colorCycleRuntimeHandlers.updateGradient?.(clonedStops);
    pendingGradientRef.current = clonedStops;
  }, [setActiveSettings, updateLayer, colorCycleRuntimeHandlers]);

  const scheduleFlushFrame = React.useCallback(() => {
    if (gradientFrameRef.current !== null) {
      cancelAnimationFrame(gradientFrameRef.current);
      gradientFrameRef.current = null;
    }

    gradientFrameRef.current = requestAnimationFrame(() => {
      gradientFrameRef.current = null;
      flushPendingGradient();
    });
  }, [flushPendingGradient]);

  const scheduleGradientFlush = React.useCallback(
    (stops: Array<{ position: number; color: string }>, immediate = false) => {
      pendingGradientRef.current = stops.map(stop => ({ ...stop }));
      if (gradientDebounceTimerRef.current) {
        clearTimeout(gradientDebounceTimerRef.current);
        gradientDebounceTimerRef.current = null;
      }

      if (activeLayerId) {
        pendingLayerUpdateRef.current = {
          layerId: activeLayerId,
          gradient: pendingGradientRef.current
        };
      } else {
        pendingLayerUpdateRef.current = null;
      }

      if (immediate) {
        scheduleFlushFrame();
        return;
      }

      gradientDebounceTimerRef.current = setTimeout(() => {
        gradientDebounceTimerRef.current = null;
        scheduleFlushFrame();
      }, 80);
    },
    [scheduleFlushFrame, activeLayerId]
  );

  React.useEffect(() => {
    return () => {
      if (gradientDebounceTimerRef.current) {
        clearTimeout(gradientDebounceTimerRef.current);
        gradientDebounceTimerRef.current = null;
      }
      if (gradientFrameRef.current !== null) {
        cancelAnimationFrame(gradientFrameRef.current);
        gradientFrameRef.current = null;
      }
      flushPendingGradient();
    };
  }, [flushPendingGradient]);

  React.useEffect(() => {
    const currentStops = activeSettings.colorCycleGradient || DEFAULT_GRADIENT_STOPS;
    pendingGradientRef.current = currentStops.map(stop => ({ ...stop }));
  }, [activeSettings.colorCycleGradient]);

  const handleToggleCustomColorCycle = React.useCallback((checked: boolean) => {
    if (checked && activeLayer?.layerType !== 'color-cycle') {
      showColorCycleLayerHint();
      setActiveSettings({ customBrushColorCycle: false });
      return;
    }

    const updates: Partial<typeof activeSettings> = {
      customBrushColorCycle: checked
    };

    if (checked) {
      if (!activeSettings.colorCycleGradient || activeSettings.colorCycleGradient.length === 0) {
        updates.colorCycleGradient = DEFAULT_GRADIENT_STOPS.map(stop => ({ ...stop }));
      }
      if (!activeSettings.colorCycleSpeed) {
        updates.colorCycleSpeed = 0.1;
      }
    }

    setActiveSettings(updates);
  }, [activeLayer, activeSettings.colorCycleGradient, activeSettings.colorCycleSpeed, setActiveSettings, showColorCycleLayerHint]);

  // Ensure Color Cycle brushes start with a sensible spacing value even when no preset overrides exist
  React.useEffect(() => {
    const shape = activeSettings.brushShape;
    if (
      shape !== BrushShape.COLOR_CYCLE &&
      shape !== BrushShape.COLOR_CYCLE_TRIANGLE &&
      shape !== BrushShape.COLOR_CYCLE_SHAPE
    ) {
      return;
    }

    const currentSpacing = activeSettings.spacing;
    if (currentSpacing && currentSpacing >= 1) {
      return;
    }

    const fallbackSpacing = shape === BrushShape.COLOR_CYCLE_SHAPE ? 4 : 2;
    setActiveSettings({ spacing: fallbackSpacing });
  }, [activeSettings.brushShape, activeSettings.spacing, setActiveSettings]);
  
  // Handle animation when switching brush types
  const previousBrushShape = React.useRef(activeSettings.brushShape);
  
  React.useEffect(() => {
    const previousShape = previousBrushShape.current;
    const wasColorCycle = isColorCycleBrush(previousShape);
    const isCurrentColorCycle = isColorCycleBrush(activeSettings.brushShape);

    if (!wasColorCycle && isCurrentColorCycle) {
      if (desiredColorCyclePlaying) {
        playColorCycle('toolbar');
      }
    } else if (wasColorCycle && !isCurrentColorCycle) {
      if (desiredColorCyclePlaying) {
        pauseColorCycle('toolbar');
      }
      // Reset Color Cycle speed to default when leaving CC mode
      setActiveSettings({ colorCycleSpeed: 0.1 });
    }

    if (isCurrentColorCycle) {
      const forcedShapeMode = getShapeModeForBrush(activeSettings.brushShape);
      if (forcedShapeMode !== undefined && shapeMode !== forcedShapeMode) {
        setShapeMode(forcedShapeMode);
      }
    }

    previousBrushShape.current = activeSettings.brushShape;
  }, [
    activeSettings.brushShape,
    desiredColorCyclePlaying,
    pauseColorCycle,
    playColorCycle,
    setActiveSettings,
    shapeMode,
    setShapeMode
  ]);


  // Show special controls for Color Cycle brushes (both stroke and shape variants)
  if (isColorCycleBrush(activeSettings.brushShape)) {
    if (typeof window !== 'undefined') {
      console.log('[BrushControls] ColorCycle branch', activeSettings.brushShape);
    }
    return (
      <div className="p-4">
        {/* Color Cycle variant switcher (Stroke vs Triangle vs Shape) */}
        <div className="mb-3">
          <ButtonGroup
            options={[
              { label: 'Stroke', value: 'stroke' },
              { label: 'Triangle', value: 'triangle' },
              { label: 'Shape', value: 'shape' }
            ]}
            value={
              activeSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE
                ? 'shape'
                : activeSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE
                  ? 'triangle'
                  : 'stroke'
            }
            onChange={(value) => {
              const strokePreset = brushPresets.find(p => p.id === 'color-cycle-stroke');
              const shapePreset = brushPresets.find(p => p.id === 'color-cycle-shape');
              const trianglePreset = brushPresets.find(p => p.id === 'color-cycle-triangle');
              if (value === 'shape' && shapePreset) {
                setBrushPreset(shapePreset, true);
              } else if (value === 'triangle' && trianglePreset) {
                setBrushPreset(trianglePreset, true);
              } else if (value === 'stroke' && strokePreset) {
                setBrushPreset(strokePreset, true);
              }
            }}
            size="sm"
          />
        </div>
        {/* Fill Mode Tabs - only for Color Cycle Shape, not for Color Cycle Stroke */}
        {activeSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE && (
          <div className="mb-3">
            <ButtonGroup
              options={[
                { label: 'Concentric', value: 'concentric' },
                { label: 'Linear', value: 'linear' },
                { label: 'Circular', value: 'circular' }
              ]}
              value={activeSettings.colorCycleFillMode || 'concentric'}
              onChange={(value) => setActiveSettings({ 
                colorCycleFillMode: value as 'concentric' | 'linear' | 'circular' 
              })}
              size="sm"
            />
          </div>
        )}

        {/* Gradient Editor (sampling toggle moved into dropdown) */}
        <div className="mb-4">
          <GradientEditor
            sampleTarget="brush"
            stops={activeSettings.colorCycleGradient || DEFAULT_GRADIENT_STOPS}
            onChange={(stops) => {
              scheduleGradientFlush(stops);
            }}
          />
        </div>
        
        {/* Animation Speed */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Speed
            </label>
            <ProgressSlider
              value={(function() {
                // If the active layer is a CC layer in brush mode, bind to its per-layer speed
                const layer = layers.find(l => l.id === activeLayerId);
                const isCCBrushLayer = layer?.layerType === 'color-cycle' && layer?.colorCycleData?.mode !== 'recolor';
                if (isCCBrushLayer) {
                  return layer?.colorCycleData?.brushSpeed ?? 0.1;
                }
                return activeSettings.colorCycleSpeed || 0.1;
              })()}
              min={MIN_BRUSH_COLOR_CYCLE_SPEED}
              max={MAX_BRUSH_COLOR_CYCLE_SPEED}
              step={COLOR_CYCLE_SPEED_STEP}
              onChange={(value) => {
                // Update per-layer speed when on a CC brush layer, else update global brush setting
                const layer = layers.find(l => l.id === activeLayerId);
                const isCCBrushLayer = layer?.layerType === 'color-cycle' && layer?.colorCycleData?.mode !== 'recolor';
                const clampedValue = Math.max(
                  MIN_BRUSH_COLOR_CYCLE_SPEED,
                  Math.min(MAX_BRUSH_COLOR_CYCLE_SPEED, value)
                );
                if (isCCBrushLayer && activeLayerId && layer?.colorCycleData) {
                  updateLayer(activeLayerId, {
                    colorCycleData: {
                      ...layer.colorCycleData,
                      brushSpeed: clampedValue
                    }
                  });
                } else {
                  setActiveSettings({ colorCycleSpeed: clampedValue });
                }
              }}
              aria-label="Animation Speed"
              className="flex-1"
            />
          </div>
        </div>

        {/* FPS Control */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              FPS
            </label>
            <ProgressSlider
              value={activeSettings.colorCycleFPS || 30}
              min={15}
              max={60}
              step={5}
              onChange={(value) => setActiveSettings({ colorCycleFPS: Math.round(value) })}
              aria-label="Frames Per Second"
              className="flex-1"
            />
          </div>
        </div>

        {/* Size - hide for COLOR_CYCLE_SHAPE since it uses shape size */}
        {activeSettings.brushShape !== BrushShape.COLOR_CYCLE_SHAPE && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
                Size px
              </label>
              <ProgressSlider
                value={
                  currentTool === 'eraser' && !eraserLinkSize
                    ? eraserSettings.size ?? globalBrushSize
                    : globalBrushSize
                }
                min={1}
                max={500}
                step={1}
                onChange={(value) => {
                  const next = Math.max(1, value);
                  if (currentTool === 'eraser' && !eraserLinkSize) {
                    setEraserSettings({ size: next });
                    return;
                  }
                  setGlobalBrushSize(next);
                  if (currentTool === 'eraser') {
                    setEraserSettings({ size: next });
                  }
                }}
                aria-label="Brush Size (px)"
                className="flex-1"
              />
            </div>
            {currentTool === 'eraser' && (
              <div className="flex items-center gap-2 mt-2">
                <label className="text-[#D9D9D9] w-32" style={{ fontSize: '12px' }}>
                  Link size to brush
                </label>
                <CustomSwitch
                  checked={eraserLinkSize}
                  onChange={(checked) => {
                    setEraserSettings({
                      linkSizeToBrush: checked,
                      size: checked ? globalBrushSize : eraserSettings.size ?? globalBrushSize
                    });
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Opacity */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
              Opacity
            </label>
            <ProgressSlider
              value={(activeSettings.opacity ?? 1) * 100}
              min={1}
              max={100}
              step={1}
              onChange={(value) => setActiveSettings({ opacity: value / 100 })}
              aria-label="Opacity"
              className="flex-1"
            />
          </div>
        </div>
        {/* Spacing (Color Cycle stroke variants only) */}
        {(activeSettings.brushShape === BrushShape.COLOR_CYCLE ||
          activeSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                Spacing
              </label>
              <ProgressSlider
                value={activeSettings.spacing ?? 2}
                min={1}
                max={50}
                step={1}
                onChange={(value) =>
                  setActiveSettings({ spacing: Math.max(1, Math.round(value)) })
                }
                aria-label="Spacing (px between stamps)"
                className="flex-1"
              />
            </div>
          </div>
        )}

        {/* Riso */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
              Riso
            </label>
            <ProgressSlider
              value={activeSettings.risographIntensity || 0}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                setActiveSettings({ risographIntensity: Math.round(value) })
              }
              aria-label="Risograph Intensity"
              className="flex-1"
            />
          </div>
          {(activeSettings.risographIntensity || 0) > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <label
                htmlFor="riso-outline-color-cycle"
                className={`${CONTROL_LABEL_CLASS} text-xs`}
              >
                Edges
              </label>
              <CustomSwitch
                id="riso-outline-color-cycle"
                checked={activeSettings.risographOutline || false}
                onChange={(checked) =>
                  setActiveSettings({ risographOutline: checked })
                }
              />
            </div>
          )}
        </div>

        {/* Gradient Bands / Band Gap */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
              {activeSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE
                ? 'Band Gap'
                : (activeSettings.ditherEnabled ? 'Colors' : 'Bands')}
            </label>
            <ProgressSlider
              value={activeSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE
                ? (activeSettings.colorCycleBandSpacingPx ?? 12)
                : (activeSettings.gradientBands || 12)}
              min={activeSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE ? 4 : 2}
              max={activeSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE ? 96 : 128}
              step={1}
              onChange={(value) => {
                if (activeSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE) {
                  setActiveSettings({ colorCycleBandSpacingPx: Math.max(4, Math.round(value)) });
                } else {
                  setActiveSettings({ gradientBands: Math.round(value) });
                }
              }}
              aria-label={activeSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE
                ? 'Band gap distance (px)'
                : 'Gradient Bands (number of color steps)'}
              className="flex-1"
            />
          </div>
        </div>

        {activeSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="dither-enabled-color-cycle"
                className={CONTROL_LABEL_CLASS}
                style={CONTROL_LABEL_STYLE}
              >
                Dither
              </label>
              <CustomSwitch
                id="dither-enabled-color-cycle"
                checked={activeSettings.ditherEnabled || false}
                onChange={(checked) => setActiveSettings({ ditherEnabled: checked })}
              />
            </div>
            {activeSettings.ditherEnabled && (
              <div className="flex items-center gap-2 mt-2">
                <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                  Res
                </label>
                <ProgressSlider
                  value={activeSettings.fillResolution || 1}
                  min={1}
                  max={16}
                  step={1}
                  onChange={(value) => setActiveSettings({ fillResolution: Math.round(value) })}
                  aria-label="Dither Resolution"
                  className="flex-1"
                />
              </div>
            )}
            <div className="flex items-center gap-2 mt-2 opacity-100">
              <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                Sprd
              </label>
              <ProgressSlider
                value={activeSettings.ditherPaletteSpread ?? 0}
                min={0}
                max={100}
                step={1}
                disabled={!activeSettings.ditherEnabled}
                onChange={(value) => setActiveSettings({ ditherPaletteSpread: Math.max(0, Math.min(100, Math.round(value))) })}
                aria-label="Dither Palette Spread"
                className="flex-1"
              />
            </div>
          </div>
        )}

        {/* Color Jitter */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
              Col Jit
            </label>
            <ProgressSlider
              value={activeSettings.colorJitter || 0}
              min={0}
              max={100}
              step={1}
              onChange={(value) => setActiveSettings({ colorJitter: Math.round(value) })}
              aria-label="Color Jitter"
              className="flex-1"
            />
          </div>
        </div>

        {(activeSettings.brushShape === BrushShape.COLOR_CYCLE ||
          activeSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="stamp-dither-color-cycle"
                className={CONTROL_LABEL_CLASS}
                style={CONTROL_LABEL_STYLE}
              >
                Dither
              </label>
              <CustomSwitch
                id="stamp-dither-color-cycle"
                checked={Boolean(activeSettings.colorCycleStampDitherEnabled)}
                onChange={(checked) =>
                  setActiveSettings({ colorCycleStampDitherEnabled: checked })
                }
              />
            </div>
            {activeSettings.colorCycleStampDitherEnabled && (
              <>
                <div className="flex items-center gap-2 mt-2">
                  <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                    Res
                  </label>
                  <ProgressSlider
                    value={activeSettings.colorCycleStampDitherPixelSize ?? 1}
                    min={1}
                    max={16}
                    step={1}
                    onChange={(value) =>
                      setActiveSettings({
                        colorCycleStampDitherPixelSize: Math.max(1, Math.round(value))
                      })
                    }
                    aria-label="Stamp Dither Resolution"
                    className="flex-1"
                  />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <label className={CONTROL_LABEL_CLASS} style={CONTROL_LABEL_STYLE}>
                    Erase
                  </label>
                  <CustomSwitch
                    id="stamp-dither-clear-color-cycle"
                    checked={Boolean(activeSettings.colorCycleStampDitherClears)}
                    onChange={(checked) =>
                      setActiveSettings({ colorCycleStampDitherClears: checked })
                    }
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* Shape Mode - Hidden for Color Cycle brushes as it's auto-managed */}

        {/* Pressure - only for Color Cycle stroke variants */}
        {(activeSettings.brushShape === BrushShape.COLOR_CYCLE ||
          activeSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="pressure-enabled-color-cycle"
                className="text-[#D9D9D9] w-16"
                style={{ fontSize: "14px" }}
              >
                Pressure
              </label>
              <CustomSwitch
                id="pressure-enabled-color-cycle"
                checked={activeSettings.pressureEnabled || false}
                onChange={(checked) => {
                  setActiveSettings({ pressureEnabled: checked });
                }}
              />
              {(activeSettings.pressureEnabled || false) && (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    variant="compact"
                    value={pressureDraft.min}
                    onChange={(e) => handleMinChange(e.target.value)}
                    onFocus={handleMinFocus}
                    onBlur={handleMinBlur}
                    min="1"
                    max="1000"
                    className="w-16 bg-transparent text-right"
                  />
                  <Input
                    type="number"
                    variant="compact"
                    value={pressureDraft.max}
                    onChange={(e) => handleMaxChange(e.target.value)}
                    onFocus={handleMaxFocus}
                    onBlur={handleMaxBlur}
                    min="1"
                    max="1000"
                    className="w-16 bg-transparent text-right"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Rotation - only for stroke variants */}
        {(activeSettings.brushShape === BrushShape.COLOR_CYCLE ||
          activeSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="rotation-enabled-color-cycle"
                className="text-[#D9D9D9] w-16"
                style={{ fontSize: "14px" }}
              >
                Rotation
              </label>
              <CustomSwitch
                id="rotation-enabled-color-cycle"
                checked={activeSettings.rotationEnabled || false}
                onChange={(checked) =>
                  setActiveSettings({ rotationEnabled: checked })
                }
              />
            </div>
          </div>
        )}

        {/* Dashed removed for Color Cycle brushes */}

        {/* Grid Snap removed for Color Cycle brushes */}
      </div>
    );
  }

  // Show special controls for Spam brush
  if (activeSettings.brushShape === BrushShape.SPAM_TEXT) {
    if (typeof window !== 'undefined') {
      console.log('[BrushControls] Spam branch');
    }
    // Define spam text presets
    const spamPresets: Record<string, string> = {
      mixed: 'WINNER!!! TO THE MOON!!! DEAR BENEFICIARY!!! CHEAP MEDS!!! ACT NOW!!! HODL!!! BANK OF NIGERIA!!! FDA APPROVED!!! FREE FREE FREE!!! DIAMOND HANDS!!! MILLION DOLLARS!!! SPECIAL PRICE!!! 100% GUARANTEED!!! PUMP IT!!! URGENT!!! ',
      classic: 'WINNER!!! ACT NOW!!! LIMITED TIME OFFER!!! CONGRATULATIONS!!! FREE FREE FREE!!! CLICK HERE!!! URGENT MESSAGE!!! HOT SINGLES IN YOUR AREA!!! 100% GUARANTEED!!! NO RISK!!! CALL NOW!!! AMAZING OFFER!!! EARN $$$!!! LOSE WEIGHT FAST!!! MIRACLE CURE!!! SECRET REVEALED!!! ',
      crypto: 'TO THE MOON!!! HODL!!! DIAMOND HANDS!!! BUY THE DIP!!! WHALE ALERT!!! 100X GAINS!!! PUMP IT!!! NOT FINANCIAL ADVICE!!! LAMBO SOON!!! MOON MISSION!!! GEM FOUND!!! RUG PROOF!!! DYOR!!! APE IN NOW!!! ',
      prince: 'DEAR BENEFICIARY!!! INHERITANCE FUND!!! BANK OF NIGERIA!!! TRANSFER FEES REQUIRED!!! MILLION DOLLARS!!! TRUSTED BARRISTER!!! URGENT RESPONSE NEEDED!!! STRICTLY CONFIDENTIAL!!! GOD BLESS!!! AWAITING YOUR REPLY!!! KINDLY SEND DETAILS!!! WESTERN UNION!!! ',
      pharma: 'CHEAP MEDS!!! NO PRESCRIPTION!!! FDA APPROVED!!! GENERIC PILLS!!! DISCREET SHIPPING!!! ONLINE PHARMACY!!! SPECIAL PRICE!!! ORDER TODAY!!! DOCTOR APPROVED!!! SAFE & EFFECTIVE!!! FAST DELIVERY!!! '
    };

    return (
      <div className="p-4">
        {/* Content Type - dropdown that pre-populates text */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Content
            </label>
            <Dropdown
              value={activeSettings.spamContentType || 'mixed'}
              onChange={(value) => {
                setActiveSettings({ 
                  spamContentType: value,
                  spamCustomText: spamPresets[value] || spamPresets.mixed
                });
              }}
              options={[
                { label: 'Mixed Chaos', value: 'mixed' },
                { label: 'Classic Spam', value: 'classic' },
                { label: 'Crypto Spam', value: 'crypto' },
                { label: 'Nigerian Prince', value: 'prince' },
                { label: 'Pharma Ads', value: 'pharma' }
              ]}
              className="flex-1"
            />
          </div>
        </div>

        {/* Custom Text Input - no label */}
        <div className="mb-2">
          <textarea
            value={activeSettings.spamCustomText || spamPresets[activeSettings.spamContentType || 'mixed']}
            onChange={(e) => setActiveSettings({ spamCustomText: e.target.value })}
            placeholder="Enter custom text here..."
            className="w-full h-20 p-2 border border-[#D9D9D9] bg-transparent text-[#D9D9D9] resize-none focus:outline-none focus:border-[#F3F3F7]"
            style={{ fontSize: "12px", fontFamily: 'monospace' }}
          />
        </div>

        {/* Font Selection */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Font
            </label>
            <Dropdown
              value={activeSettings.spamFont || 'courier'}
              onChange={(value) => setActiveSettings({ spamFont: value })}
              options={[
                { label: 'Courier New', value: 'courier' },
                { label: 'Consolas', value: 'consolas' },
                { label: 'Monaco', value: 'monaco' },
                { label: 'Lucida Console', value: 'lucida' },
                { label: 'Roboto Mono', value: 'roboto' },
                { label: 'Source Code Pro', value: 'source' },
                { label: 'Terminal', value: 'terminal' },
                { label: 'Menlo', value: 'menlo' }
              ]}
              className="flex-1"
            />
          </div>
        </div>

        {/* Size */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Size px
            </label>
            <ProgressSlider
              value={globalBrushSize}
              min={8}
              max={72}
              step={1}
              onChange={(value) => {
                const next = Math.max(8, value);
                setGlobalBrushSize(next);
                if (currentTool === 'eraser') {
                  setEraserSettings({ size: next });
                }
              }}
              aria-label="Text Size (px)"
              className="flex-1"
            />
          </div>
        </div>

        {/* Opacity */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Opacity
            </label>
            <ProgressSlider
              value={activeSettings.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setActiveSettings({ opacity: value })}
              aria-label="Opacity"
              className="flex-1"
            />
          </div>
        </div>

        {/* Spacing */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Spacing
            </label>
            <ProgressSlider
              value={activeSettings.spacing}
              min={1}
              max={40}
              step={1}
              onChange={(value) =>
                setActiveSettings({ spacing: Math.max(1, Math.round(value)) })
              }
              aria-label="Spacing"
              className="flex-1"
            />
          </div>
        </div>

        {/* Pressure */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="pressure-enabled-spam"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Pressure
            </label>
            <CustomSwitch
              id="pressure-enabled-spam"
              checked={activeSettings.pressureEnabled || false}
              onChange={(checked) => setActiveSettings({ pressureEnabled: checked })}
            />
            {(activeSettings.pressureEnabled || false) && (
              <>
                  <Input
                    type="number"
                    variant="compact"
                    value={pressureDraft.min}
                    onChange={(e) => handleMinChange(e.target.value)}
                    onFocus={handleMinFocus}
                    onBlur={handleMinBlur}
                    min="1"
                    max="1000"
                    className="w-16 bg-transparent text-right"
                  />
                <span className="text-[#D9D9D9]" style={{ fontSize: "14px" }}>
                  -
                </span>
                  <Input
                    type="number"
                    variant="compact"
                    value={pressureDraft.max}
                    onChange={(e) => handleMaxChange(e.target.value)}
                    onFocus={handleMaxFocus}
                    onBlur={handleMaxBlur}
                    min="1"
                    max="1000"
                    className="w-16 bg-transparent text-right"
                  />
              </>
            )}
          </div>
        </div>

        {/* Grid Snap */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="grid-snap-enabled-spam"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Grid Snap
            </label>
            <CustomSwitch
              id="grid-snap-enabled-spam"
              checked={activeSettings.gridSnapEnabled || false}
              onChange={(checked) =>
                setActiveSettings({ gridSnapEnabled: checked })
              }
            />
          </div>
        </div>
      </div>
    );
  }

  // Show special controls for Resampler brush
  if (activeSettings.brushShape === BrushShape.RESAMPLER) {
    if (typeof window !== 'undefined') {
      console.log('[BrushControls] Resampler branch');
    }
    return (
      <div className="p-4">
        {/* Continuous Sampling Toggle */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label 
              htmlFor="continuous-sampling"
              className="text-[#D9D9D9] w-16" 
              style={{ fontSize: "14px" }}
            >
              Continuous
            </label>
            <CustomSwitch
              id="continuous-sampling"
              checked={activeSettings.continuousSampling || false}
              onChange={(checked) =>
                setActiveSettings({ continuousSampling: checked })
              }
            />
          </div>
        </div>
        
        {/* Resample Interval Slider - always shown for resampler brush */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Interval
            </label>
            <ProgressSlider
              value={activeSettings.resampleInterval || 5}
              min={1}
              max={10}
              step={1}
              onChange={(value) =>
                setActiveSettings({ resampleInterval: Math.round(value) })
              }
              aria-label="Resample Interval"
              className="flex-1"
            />
          </div>
        </div>

        {/* Size */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Size {sizeUnit}
            </label>
            <ProgressSlider
              value={isActiveCustomBrush ? customBrushPercent : globalBrushSize}
              min={isActiveCustomBrush ? 5 : 1}
              max={isActiveCustomBrush ? 1000 : 500}
              step={isActiveCustomBrush ? 5 : 1}
              onChange={(value) => {
                if (isActiveCustomBrush) {
                  setCustomBrushSizePercent(value);
                  if (currentTool === 'eraser' && eraserSettings.linkSizeToBrush === false) {
                    const updatedSize =
                      useAppStore.getState().tools.brushSettings.size ?? globalBrushSize;
                    setEraserSettings({ size: updatedSize });
                  }
                  return;
                }
                const min = 1;
                const max = 500;
                const next = Math.min(max, Math.max(min, Math.round(value)));
                setGlobalBrushSize(next);
                if (currentTool === 'eraser') {
                  setEraserSettings({ size: next });
                }
              }}
              aria-label={`Brush Size (${sizeUnit})`}
              className="flex-1"
            />
          </div>
        </div>

        {/* Opacity */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Opacity
            </label>
            <ProgressSlider
              value={activeSettings.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setActiveSettings({ opacity: value })}
              aria-label="Opacity"
              className="flex-1"
            />
          </div>
        </div>

        {/* Spacing */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Spacing
            </label>
            <ProgressSlider
              value={activeSettings.spacing}
              min={1}
              max={40}
              step={1}
              onChange={(value) =>
                setActiveSettings({ spacing: Math.max(1, Math.round(value)) })
              }
              aria-label="Spacing"
              className="flex-1"
            />
          </div>
        </div>


        {/* Riso */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Riso
            </label>
            <ProgressSlider
              value={activeSettings.risographIntensity || 0}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                setActiveSettings({ risographIntensity: Math.round(value) })
              }
              aria-label="Risograph Intensity"
              className="flex-1"
            />
          </div>
          {/* Risograph Outline Toggle - only show when risograph is enabled */}
          {(activeSettings.risographIntensity || 0) > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <label
                htmlFor="riso-outline-resampler"
                className="text-[#D9D9D9] w-16 text-xs"
              >
                Edges
              </label>
              <CustomSwitch
                id="riso-outline-resampler"
                checked={activeSettings.risographOutline || false}
                onChange={(checked) =>
                  setActiveSettings({ risographOutline: checked })
                }
              />
            </div>
          )}
        </div>

        {/* Shape Mode - Draw closed polygon shapes */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="shape-mode-resampler"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Shape
            </label>
            <CustomSwitch
              id="shape-mode-resampler"
              checked={shapeMode || false}
              onChange={(checked) => {
                try { console.log('[SHAPE/UI] toggle (resampler)', { checked }); } catch {}
                setShapeMode(checked);
              }}
            />
          </div>
        </div>

        {/* Pressure */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="pressure-enabled-resampler"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Pressure
            </label>
            <CustomSwitch
              id="pressure-enabled-resampler"
              checked={activeSettings.pressureEnabled || false}
              onChange={(checked) => {
                setActiveSettings({ pressureEnabled: checked });
              }}
            />
            {(activeSettings.pressureEnabled || false) && (
              <>
                <Input
                  type="number"
                  variant="compact"
                  value={pressureDraft.min}
                  onChange={(e) => handleMinChange(e.target.value)}
                  onFocus={handleMinFocus}
                  onBlur={handleMinBlur}
                  min="1"
                  max="1000"
                  className="w-16 bg-transparent text-right"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: "14px" }}>
                  -
                </span>
                <Input
                  type="number"
                  variant="compact"
                  value={pressureDraft.max}
                  onChange={(e) => handleMaxChange(e.target.value)}
                  onFocus={handleMaxFocus}
                  onBlur={handleMaxBlur}
                  min="1"
                  max="1000"
                  className="w-16 bg-transparent text-right"
                />
              </>
            )}
          </div>
        </div>

        {/* Rotation - only for stroke brushes */}
        {isStrokeBrush(activeSettings.brushShape || BrushShape.RESAMPLER) && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="rotation-enabled-resampler"
                className="text-[#D9D9D9] w-16"
                style={{ fontSize: "14px" }}
              >
                Rotation
              </label>
              <CustomSwitch
                id="rotation-enabled-resampler"
                checked={activeSettings.rotationEnabled || false}
                onChange={(checked) =>
                  setActiveSettings({ rotationEnabled: checked })
                }
              />
            </div>
          </div>
        )}

        {/* Dashed */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="dashed-enabled-resampler"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Dashed
            </label>
            <CustomSwitch
              id="dashed-enabled-resampler"
              checked={activeSettings.dashedEnabled || false}
              onChange={(checked) =>
                setActiveSettings({ dashedEnabled: checked })
              }
            />
            {(activeSettings.dashedEnabled || false) && (
              <>
                <span className="text-[#D9D9D9]" style={{ fontSize: "12px" }}>
                  L
                </span>
                <Input
                  type="number"
                  variant="compact"
                  value={activeSettings.dashLength || 3}
                  onChange={(e) =>
                    setActiveSettings({
                      dashLength: parseInt(e.target.value) || 3,
                    })
                  }
                  min="1"
                  max="20"
            className="w-12 bg-transparent text-right"
                  title="Length multiplier (×brush size)"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: "12px" }}>
                  G
                </span>
                <Input
                  type="number"
                  variant="compact"
                  value={activeSettings.dashGap || 2}
                  onChange={(e) =>
                    setActiveSettings({ dashGap: parseInt(e.target.value) || 2 })
                  }
                  min="1"
                  max="20"
            className="w-12 bg-transparent text-right"
                  title="Gap multiplier (×brush size)"
                />
              </>
            )}
          </div>
        </div>

        {/* Grid Snap */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="grid-snap-enabled-resampler"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Grid Snap
            </label>
            <CustomSwitch
              id="grid-snap-enabled-resampler"
              checked={activeSettings.gridSnapEnabled || false}
              onChange={(checked) =>
                setActiveSettings({ gridSnapEnabled: checked })
              }
            />
          </div>
        </div>
      </div>
    );
  }



  // Show special controls for Polygon brush
  if (activeSettings.brushShape === BrushShape.POLYGON) {
    if (typeof window !== 'undefined') {
      console.log('[BrushControls] Polygon branch');
    }
    return (
      <div className="p-4">
        {/* Polygon Sides */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Sides
            </label>
            <ProgressSlider
              value={activeSettings.polygonSides || 6}
              min={3}
              max={12}
              step={1}
              onChange={(value) =>
                setActiveSettings({ polygonSides: Math.round(value) })
              }
              aria-label="Polygon Sides"
              className="flex-1"
            />
          </div>
        </div>

        {/* Dither Resolution */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Dither
            </label>
            <ProgressSlider
              value={activeSettings.polygonDitherResolution || 3}
              min={1}
              max={32}
              step={1}
              onChange={(value) =>
                setActiveSettings({ polygonDitherResolution: Math.round(value) })
              }
              aria-label="Dither Resolution"
              className="flex-1"
            />
          </div>
        </div>

        {/* Dither Enabled */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="dither-enabled-polygon"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Dither
            </label>
            <CustomSwitch
              id="dither-enabled-polygon"
              checked={activeSettings.ditherEnabled || false}
              onChange={(checked) =>
                setActiveSettings({ ditherEnabled: checked })
              }
            />
          </div>
        </div>

        {/* Standard brush controls */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Size px
            </label>
            <ProgressSlider
              value={globalBrushSize}
              min={1}
              max={500}
              step={1}
              onChange={(value) => {
                const next = Math.max(1, value);
                setGlobalBrushSize(next);
                if (currentTool === 'eraser') {
                  setEraserSettings({ size: next });
                }
              }}
              aria-label="Brush Size"
              className="flex-1"
            />
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Opacity
            </label>
            <ProgressSlider
              value={activeSettings.opacity}
              min={1}
              max={100}
              onChange={(value) => setActiveSettings({ opacity: value })}
              aria-label="Brush Opacity"
              className="flex-1"
            />
          </div>
        </div>
      </div>
    );
  }

  // Show Colors and Film Grain sliders for gradient brushes
  if (
    activeSettings.brushShape === BrushShape.RECTANGLE_GRADIENT ||
    activeSettings.brushShape === BrushShape.POLYGON_GRADIENT
  ) {
    if (typeof window !== 'undefined') {
      console.log('[BrushControls] Gradient branch', activeSettings.brushShape);
    }
    return (
      <div className="p-4">
        {/* Gradient Source (Rectangle only): None = sample canvas, Presets = fixed list */}
        {activeSettings.brushShape === BrushShape.RECTANGLE_GRADIENT && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
                Gradient
              </label>
              <Dropdown
                value={activeSettings.rectGradientPresetId || 'none'}
                options={[{ value: 'none', label: 'None' }, ...getRectGradientPresetOptions()]}
                onChange={(value) => setActiveSettings({ rectGradientPresetId: value })}
                renderOption={(option) => {
                  if (option.value === 'none') {
                    return (
                      <div className="flex items-center gap-2 w-full">
                        <span className="text-[#D9D9D9] text-xs">None</span>
                      </div>
                    );
                  }
                  const stops = getPresetStops(option.value) || [];
                  const gradientCss = stops
                    .map(s => `${s.color} ${Math.round(s.position * 100)}%`)
                    .join(', ');
                  return (
                    <div className="flex items-center gap-2 w-full">
                      <div
                        className="flex-1 h-5 border border-[#666]"
                        style={{ background: `linear-gradient(90deg, ${gradientCss})` }}
                      />
                    </div>
                  );
                }}
                renderValue={(selected) => {
                  if (!selected || selected.value === 'none') {
                    return <span className="truncate">None</span>;
                  }
                  const stops = getPresetStops(selected.value) || [];
                  const gradientCss = stops
                    .map(s => `${s.color} ${Math.round(s.position * 100)}%`)
                    .join(', ');
                  return (
                    <div
                      className="h-5 w-full border border-[#666]"
                      style={{ background: `linear-gradient(90deg, ${gradientCss})` }}
                    />
                  );
                }}
                className="flex-1"
              />
            </div>
          </div>
        )}

        {/* Colors (final bands). Rectangle: 2-64; Polygon: 1-10 (unchanged) */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Colors
            </label>
            <ProgressSlider
              value={activeSettings.colors || 2}
              min={activeSettings.brushShape === BrushShape.RECTANGLE_GRADIENT ? 2 : 1}
              max={activeSettings.brushShape === BrushShape.RECTANGLE_GRADIENT ? 64 : 10}
              step={1}
              onChange={(value) =>
                setActiveSettings({ colors: Math.round(value) })
              }
              aria-label="Gradient Colors"
              className="flex-1"
            />
          </div>
        </div>

        {activeSettings.brushShape === BrushShape.POLYGON_GRADIENT && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="polygon-sample-colors"
                className="text-[#D9D9D9] w-16"
                style={{ fontSize: "14px" }}
              >
                Sample
              </label>
              <CustomSwitch
                id="polygon-sample-colors"
                checked={activeSettings.polygonSampleColors !== false}
                onChange={(checked) =>
                  setActiveSettings({ polygonSampleColors: checked })
                }
              />
            </div>
          </div>
        )}

        {/* Riso */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Riso
            </label>
            <ProgressSlider
              value={activeSettings.risographIntensity || 0}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                setActiveSettings({ risographIntensity: Math.round(value) })
              }
              aria-label="Risograph Intensity"
              className="flex-1"
            />
          </div>
          {/* Risograph Outline Toggle - only show when risograph is enabled */}
          {(activeSettings.risographIntensity || 0) > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <label
                htmlFor="riso-outline-gradient"
                className="text-[#D9D9D9] w-16 text-xs"
              >
                Edges
              </label>
              <CustomSwitch
                id="riso-outline-gradient"
                checked={activeSettings.risographOutline || false}
                onChange={(checked) =>
                  setActiveSettings({ risographOutline: checked })
                }
              />
            </div>
          )}
        </div>

        {/* Dither */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="dither-enabled"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Dither
            </label>
            <div className="flex items-center gap-2 flex-1">
              <CustomSwitch
                id="dither-enabled"
                checked={activeSettings.ditherEnabled || false}
                onChange={(checked) =>
                  setActiveSettings({ ditherEnabled: checked })
                }
              />
              {/* Fill Res */}
              <div className="flex items-center gap-2 flex-1">
                <span className="text-[#D9D9D9] text-xs">
                  Res
                </span>
                <ProgressSlider
                  value={activeSettings.fillResolution || 1}
                  min={1}
                  max={16}
                  step={1}
                  disabled={!activeSettings.ditherEnabled}
                  onChange={(value) =>
                    setActiveSettings({ fillResolution: Math.round(value) })
                  }
                  aria-label="Dither Resolution"
                  className="flex-1"
                />
              </div>
              <div className="flex items-center gap-2 flex-1 mt-2">
                <span className="text-[#D9D9D9] text-xs">
                  Sprd
                </span>
                <ProgressSlider
                  value={activeSettings.ditherPaletteSpread ?? 0}
                  min={0}
                  max={100}
                  step={1}
                  disabled={!activeSettings.ditherEnabled}
                  onChange={(value) =>
                    setActiveSettings({
                      ditherPaletteSpread: Math.max(0, Math.min(100, Math.round(value)))
                    })
                  }
                  aria-label="Dither Palette Spread"
                  className="flex-1"
                />
              </div>
            </div>
          </div>
          
          {/* Dither Algorithm Dropdown - only show when dithering is enabled */}
          {activeSettings.ditherEnabled && (
            <>
              <div className="flex items-center gap-2 mt-2">
                <div className="w-16" /> {/* Empty space to align with label column */}
                <Dropdown
                  value={activeSettings.ditherAlgorithm || 'sierra-lite'}
                  options={[
                    { value: 'sierra-lite', label: 'Sierra Lite' },
                    { value: 'floyd-steinberg', label: 'Floyd-Steinberg' },
                    { value: 'bayer', label: 'Bayer Matrix' },
                    { value: 'atkinson', label: 'Atkinson' },
                    { value: 'blue-noise', label: 'Blue Noise' },
                    { value: 'pattern', label: 'Pattern' }
                  ]}
                  onChange={(value) => setActiveSettings({ ditherAlgorithm: value as 'floyd-steinberg' | 'bayer' | 'sierra-lite' | 'atkinson' | 'blue-noise' | 'pattern' })}
                  className="flex-1"
                />
              </div>
              
              {/* Pattern Style Dropdown - only show when Pattern algorithm is selected */}
              {activeSettings.ditherAlgorithm === 'pattern' && (
                <div className="flex items-center gap-2 mt-2">
                  <div className="w-16" /> {/* Empty space to align with label column */}
                  <Dropdown
                    value={activeSettings.patternStyle || 'dots'}
                    options={[
                      { value: 'dots', label: 'Dots' },
                      { value: 'lines', label: 'Diagonal Lines' },
                      { value: 'vertical-lines', label: 'Vertical Lines' },
                      { value: 'horizontal-lines', label: 'Horizontal Lines' },
                      { value: 'crosshatch', label: 'Crosshatch' },
                      { value: 'diagonal', label: 'Diamond' }
                    ]}
                    onChange={(value) => setActiveSettings({ patternStyle: value as 'dots' | 'lines' | 'vertical-lines' | 'horizontal-lines' | 'crosshatch' | 'diagonal' })}
                    className="flex-1"
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Test Swatches Button */}
        <div className="mb-2">
          <button
            onClick={drawTestSwatches}
            className="w-full px-3 py-1 text-sm bg-[#4a4a4a] text-[#D9D9D9] rounded hover:bg-[#5a5a5a] transition-colors"
            style={{ fontSize: "12px" }}
          >
            Draw Test Swatches
          </button>
        </div>
      </div>
    );
  }

  if (isShapeFillBrush) {
    if (typeof window !== 'undefined') {
      console.log('[BrushControls] ShapeFill branch');
    }
    return (
      <div className="flex flex-col gap-4">
        <div className="px-4">
          <div className="flex items-center gap-2 mb-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
              Dither
            </label>
            <CustomSwitch
              checked={Boolean(activeSettings.ditherEnabled)}
              onChange={(checked) => setActiveSettings({ ditherEnabled: checked })}
            />
            {activeSettings.ditherEnabled && (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-[#D9D9D9] text-xs">Res</span>
                <ProgressSlider
                  value={activeSettings.fillResolution || 1}
                  min={1}
                  max={16}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ fillResolution: Math.max(1, Math.round(value)) })
                  }
                  aria-label="Dither Resolution"
                  className="flex-1"
                />
              </div>
            )}
          </div>
        </div>
        <ShapeFillControls />
      </div>
    );
  }

  return (
    <div className="p-4">
      {isActiveCustomBrush && (
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Color Cycle
            </label>
            <CustomSwitch
              checked={isCustomColorCycleEnabled}
              onChange={handleToggleCustomColorCycle}
            />
          </div>

          {isCustomColorCycleEnabled && (
            <div className="mt-2">
              <GradientEditor
                sampleTarget="brush"
                stops={activeSettings.colorCycleGradient || DEFAULT_GRADIENT_STOPS}
                onChange={(stops) => {
                  scheduleGradientFlush(stops);
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Size */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
            Size {sizeUnit}
          </label>
          <ProgressSlider
            value={isActiveCustomBrush ? customBrushPercent : globalBrushSize}
            min={isActiveCustomBrush ? 5 : 1}
            max={isActiveCustomBrush ? 1000 : 500}
            step={isActiveCustomBrush ? 5 : 1}
            onChange={(value) => {
              if (isActiveCustomBrush) {
                setCustomBrushSizePercent(value);
                if (currentTool === 'eraser' && eraserSettings.linkSizeToBrush === false) {
                  const updatedSize =
                    useAppStore.getState().tools.brushSettings.size ?? globalBrushSize;
                  setEraserSettings({ size: updatedSize });
                }
                return;
              }
              const min = 1;
              const max = 500;
              const next = Math.min(max, Math.max(min, Math.round(value)));
              setGlobalBrushSize(next);
              if (currentTool === 'eraser') {
                setEraserSettings({ size: next });
              }
            }}
            aria-label={`Brush Size (${sizeUnit})`}
            className="flex-1"
          />
        </div>
      </div>

      {/* Opacity */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
            Opacity
          </label>
          <ProgressSlider
            value={activeSettings.opacity}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => setActiveSettings({ opacity: value })}
            aria-label="Opacity"
            className="flex-1"
          />
        </div>
      </div>

      {/* Spacing */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
            Spacing
          </label>
          <ProgressSlider
            value={activeSettings.spacing}
            min={1}
            max={40}
            step={1}
            onChange={(value) =>
              setActiveSettings({ spacing: Math.max(1, Math.round(value)) })
            }
            aria-label="Spacing"
            className="flex-1"
          />
        </div>
      </div>

      {/* Dither */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
            Dither
          </label>
          <CustomSwitch
            checked={Boolean(activeSettings.ditherEnabled)}
            onChange={(checked) => setActiveSettings({ ditherEnabled: checked })}
          />
        </div>
        {activeSettings.ditherEnabled && (
          <>
            <div className="flex items-center gap-2 mt-2">
              <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
                Res
              </label>
              <ProgressSlider
                value={activeSettings.fillResolution || 1}
                min={1}
                max={16}
                step={1}
                onChange={(value) =>
                  setActiveSettings({ fillResolution: Math.max(1, Math.round(value)) })
                }
                aria-label="Dither Resolution"
                className="flex-1"
              />
            </div>
            <div className="flex items-center gap-2 mt-2">
              <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
                Sprd
              </label>
              <ProgressSlider
                value={activeSettings.ditherPaletteSpread ?? 0}
                min={0}
                max={100}
                step={1}
                onChange={(value) =>
                  setActiveSettings({
                    ditherPaletteSpread: Math.max(0, Math.min(100, Math.round(value)))
                  })
                }
                aria-label="Dither Palette Spread"
                className="flex-1"
              />
            </div>
          </>
        )}
      </div>


      {/* Riso */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
            Riso
          </label>
          <ProgressSlider
            value={activeSettings.risographIntensity || 0}
            min={0}
            max={100}
            step={1}
            onChange={(value) =>
              setActiveSettings({ risographIntensity: Math.round(value) })
            }
            aria-label="Risograph Intensity"
            className="flex-1"
          />
        </div>
        {/* Risograph Outline Toggle - only show when risograph is enabled */}
        {(activeSettings.risographIntensity || 0) > 0 && (
          <div className="flex items-center gap-2 mt-1">
            <label
              htmlFor="riso-outline"
              className="text-[#D9D9D9] w-16 text-xs"
            >
              Edges
            </label>
            <CustomSwitch
              id="riso-outline"
              checked={activeSettings.risographOutline || false}
              onChange={(checked) =>
                setActiveSettings({ risographOutline: checked })
              }
            />
          </div>
        )}
      </div>

      {/* Shape Mode - Draw closed polygon shapes */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label
            htmlFor="shape-mode"
            className="text-[#D9D9D9] w-16"
            style={{ fontSize: "14px" }}
          >
            Shape
          </label>
          <CustomSwitch
            id="shape-mode"
            checked={shapeMode || false}
            onChange={(checked) => {
              try { console.log('[SHAPE/UI] toggle (default)', { checked }); } catch {}
              setShapeMode(checked);
            }}
          />
        </div>
      </div>

      {/* Pressure */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label
            htmlFor="pressure-enabled"
            className="text-[#D9D9D9] w-16"
            style={{ fontSize: "14px" }}
          >
            Pressure
          </label>
          <CustomSwitch
            id="pressure-enabled"
            checked={activeSettings.pressureEnabled || false}
            onChange={(checked) => {
              setActiveSettings({ pressureEnabled: checked });
            }}
          />
            {(activeSettings.pressureEnabled || false) && (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  variant="compact"
                  value={pressureDraft.min}
                  onChange={(e) => handleMinChange(e.target.value)}
                  onFocus={handleMinFocus}
                  onBlur={handleMinBlur}
                  min="1"
                  max="1000"
                  className="w-12 bg-transparent text-right"
                />
                <Input
                  type="number"
                  variant="compact"
                  value={pressureDraft.max}
                  onChange={(e) => handleMaxChange(e.target.value)}
                  onFocus={handleMaxFocus}
                  onBlur={handleMaxBlur}
                  min="1"
                  max="1000"
                  className="w-12 bg-transparent text-right"
                />
              </div>
            )}
        </div>
      </div>

      {/* Rotation - only for stroke brushes */}
      {isStrokeBrush(activeSettings.brushShape || BrushShape.ROUND) && (
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="rotation-enabled"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Rotation
            </label>
            <CustomSwitch
              id="rotation-enabled"
              checked={activeSettings.rotationEnabled || false}
              onChange={(checked) =>
                setActiveSettings({ rotationEnabled: checked })
              }
            />
          </div>
        </div>
      )}

      {/* Dashed */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label
            htmlFor="dashed-enabled"
            className="text-[#D9D9D9] w-16"
            style={{ fontSize: "14px" }}
          >
            Dashed
          </label>
          <CustomSwitch
            id="dashed-enabled"
            checked={activeSettings.dashedEnabled || false}
            onChange={(checked) =>
              setActiveSettings({ dashedEnabled: checked })
            }
          />
          {(activeSettings.dashedEnabled || false) && (
            <>
              <span className="text-[#D9D9D9]" style={{ fontSize: "12px" }}>
                L
              </span>
              <Input
                type="number"
                variant="compact"
                value={activeSettings.dashLength || 3}
                onChange={(e) =>
                  setActiveSettings({
                    dashLength: parseInt(e.target.value) || 3,
                  })
                }
                min="1"
                max="20"
                className="w-12 bg-transparent text-right"
                title="Length multiplier (×brush size)"
              />
              <span className="text-[#D9D9D9]" style={{ fontSize: "12px" }}>
                G
              </span>
              <Input
                type="number"
                variant="compact"
                value={activeSettings.dashGap || 2}
                onChange={(e) =>
                  setActiveSettings({ dashGap: parseInt(e.target.value) || 2 })
                }
                min="1"
                max="20"
                className="w-12 bg-transparent text-right"
                title="Gap multiplier (×brush size)"
              />
            </>
          )}
        </div>
      </div>

      {/* Grid Snap */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label
            htmlFor="grid-snap-enabled"
            className="text-[#D9D9D9] w-16"
            style={{ fontSize: "14px" }}
          >
            Grid Snap
          </label>
          <CustomSwitch
            id="grid-snap-enabled"
            checked={activeSettings.gridSnapEnabled || false}
            onChange={(checked) =>
              setActiveSettings({ gridSnapEnabled: checked })
            }
          />
        </div>
      </div>
    </div>
  );
};

export default React.memo(BrushControls);
