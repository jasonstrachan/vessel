"use client";

// Simple brush controls for proof of concept
// Based on /docs/03_Features/Drawing_Tools.md (lines 8-48)

import React from "react";
import { useAppStore } from "../../stores/useAppStore";
import { BrushShape, type Layer } from "../../types";
import { createDefaultLayerAlignment } from "@/utils/layoutDefaults";
import Input from "../ui/Input";
import CustomSwitch from "../ui/CustomSwitch";
import ProgressSlider from "../ui/ProgressSlider";
// Using ProgressSlider to match pixel square brush opacity style
import Dropdown from "../ui/Dropdown";
import ButtonGroup from "../ui/ButtonGroup";
import { drawTestSwatches } from "../../utils/drawTestSwatches";
import { GradientEditor } from "../ui/GradientEditor";
import { isStrokeBrush } from "../../utils/brushCategories";
import { getPresetOptions as getRectGradientPresetOptions, getPresetStops } from "../../utils/gradientPresets";
import { isColorCycleBrush, getShapeModeForBrush, setSharedColorCycleGradient } from "../../utils/colorCycleGradients";

// Stable default rainbow gradient to avoid re-creating arrays every render
const DEFAULT_RAINBOW_STOPS = [
  { position: 0.0, color: '#ff0000' },
  { position: 0.17, color: '#ff7f00' },
  { position: 0.33, color: '#ffff00' },
  { position: 0.5, color: '#00ff00' },
  { position: 0.67, color: '#0000ff' },
  { position: 0.83, color: '#4b0082' },
  { position: 1.0, color: '#9400d3' }
];

const DEFAULT_SHAPE_FILL_LINE_WIDTH = 1;
const DEFAULT_SHAPE_FILL_HARDENING = 1;
const DEFAULT_SHAPE_FILL_HARDENING_THRESHOLD = 0.5;
const DEFAULT_SHAPE_FILL_EDGE_FEATHER = 1;
const DEFAULT_CROSS_HATCH_LINE_WIDTH = 1;

// Get access to drawing handlers via a context or ref - we'll need to create this
export interface ColorCycleAnimationContext {
  startContinuousColorCycleAnimation: () => void;
  stopContinuousColorCycleAnimation: () => void;
  updateColorCycleGradient?: (stops: Array<{ position: number; color: string }>) => void;
  setFlowDirection?: (direction: 'forward' | 'backward') => void;
}

declare global {
  interface Window {
    colorCycleAnimationHandlers?: ColorCycleAnimationContext | null;
  }
}

// For now, we'll store this globally - a proper solution would use React context
let colorCycleAnimationHandlers: ColorCycleAnimationContext | null = null;
let globalIsAnimating = true; // Track global animation state (default to playing)

export const setColorCycleAnimationHandlers = (handlers: ColorCycleAnimationContext | null) => {
  colorCycleAnimationHandlers = handlers;
  // Also make it available globally for LayerPanel
  window.colorCycleAnimationHandlers = handlers;
};

export const getColorCycleAnimationState = () => globalIsAnimating;
export const setColorCycleAnimationState = (isAnimating: boolean) => {
  globalIsAnimating = isAnimating;
  try {
    // Unified broadcast so all UIs sync immediately
    window.dispatchEvent(new CustomEvent('colorCycleAnimationState', {
      detail: { isPlaying: isAnimating, source: 'brush' }
    }));
  } catch {}
};

const BrushControls = () => {
  // Use individual selectors to avoid unstable object references
  const setBrushSettings = useAppStore(state => state.setBrushSettings);
  const setEraserSettings = useAppStore(state => state.setEraserSettings);
  const setGlobalBrushSize = useAppStore(state => state.setGlobalBrushSize);
  const brushSettings = useAppStore(state => state.tools.brushSettings);
  const eraserSettings = useAppStore(state => state.tools.eraserSettings);
  const currentTool = useAppStore(state => state.tools.currentTool);
  const globalBrushSize = useAppStore(state => state.globalBrushSize);
  const shapeMode = useAppStore(state => state.tools.shapeMode);
  const setShapeMode = useAppStore(state => state.setShapeMode);
  const setBrushPreset = useAppStore(state => state.setBrushPreset);
  const brushPresets = useAppStore(state => state.brushPresets);
  // For per-layer CC brush speed
  const activeLayerId = useAppStore(state => state.activeLayerId);
  const layers = useAppStore(state => state.layers);
  const updateLayer = useAppStore(state => state.updateLayer);
  
  const ensureCustomColorCycleLayer = React.useCallback(() => {
    const state = useAppStore.getState();
    const activeLayer = state.layers.find(l => l.id === state.activeLayerId);
    if (activeLayer?.layerType === 'color-cycle') {
      return activeLayer.id;
    }

    const ccLayerCount = state.layers.filter(l => l.layerType === 'color-cycle').length;
    const width = state.project?.width || 1920;
    const height = state.project?.height || 1080;

    const makeFramebuffer = (w: number, h: number): OffscreenCanvas | HTMLCanvasElement => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      return canvas;
    };

    const gradient = state.tools.brushSettings.colorCycleGradient || DEFAULT_RAINBOW_STOPS;

    const newLayer: Omit<Layer, 'id' | 'order'> = {
      name: `CC Brush ${ccLayerCount + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      imageData: null,
      framebuffer: makeFramebuffer(width, height),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        mode: 'brush',
        gradient: gradient.map(stop => ({ ...stop })),
        isAnimating: false,
        brushSpeed: state.tools.brushSettings.colorCycleSpeed || 0.1
      }
    };

    try {
      const newLayerId = state.addLayer(newLayer);
      if (newLayerId) {
        if (state.project) {
          state.initColorCycleForLayer(newLayerId, width, height);
        }
        state.setActiveLayer(newLayerId);
        state.setBrushSettings({ customBrushColorCycle: true });
      }
      return newLayerId;
    } catch (error) {
      console.error('[BrushControls] Failed to create CC layer for custom brush:', error);
      return null;
    }
  }, []);

  // Determine if current brush is custom (uses percentage) or default (uses pixels)
  const isCustomBrush = brushSettings.brushShape === BrushShape.CUSTOM;
  const sizeUnit = isCustomBrush ? '%' : 'px';

  // Use the appropriate settings and setter based on current tool
  const activeSettings =
    currentTool === "eraser" ? eraserSettings : brushSettings;
  const setActiveSettings =
    currentTool === "eraser" ? setEraserSettings : setBrushSettings;

  const shapeFillLineWidth = activeSettings.shapeFillLineWidth ?? DEFAULT_SHAPE_FILL_LINE_WIDTH;
  const shapeFillLineWidthLabel = Number.isFinite(shapeFillLineWidth)
    ? (Number.isInteger(shapeFillLineWidth) ? shapeFillLineWidth.toString() : shapeFillLineWidth.toFixed(1))
    : DEFAULT_SHAPE_FILL_LINE_WIDTH.toFixed(1);
  const shapeFillHardening = Math.max(0, Math.min(1, activeSettings.shapeFillHardening ?? DEFAULT_SHAPE_FILL_HARDENING));
  const shapeFillHardeningLabel = `${Math.round(shapeFillHardening * 100)}%`;
  const shapeFillHardeningThreshold = Math.max(0, Math.min(1, activeSettings.shapeFillHardeningThreshold ?? DEFAULT_SHAPE_FILL_HARDENING_THRESHOLD));
  const shapeFillHardeningThresholdLabel = shapeFillHardeningThreshold.toFixed(2);
  const shapeFillEdgeFeather = Math.max(0.5, activeSettings.shapeFillEdgeFeather ?? DEFAULT_SHAPE_FILL_EDGE_FEATHER);
  const shapeFillEdgeFeatherLabel = `${shapeFillEdgeFeather.toFixed(2)}x`;

  const crossHatchLineWidth = activeSettings.crossHatchLineWidth
    ?? activeSettings.shapeFillLineWidth
    ?? DEFAULT_CROSS_HATCH_LINE_WIDTH;
  const crossHatchLineWidthLabel = Number.isFinite(crossHatchLineWidth)
    ? (Number.isInteger(crossHatchLineWidth) ? crossHatchLineWidth.toString() : crossHatchLineWidth.toFixed(1))
    : DEFAULT_CROSS_HATCH_LINE_WIDTH.toFixed(1);

  const isCustomColorCycleEnabled = isCustomBrush && !!activeSettings.customBrushColorCycle;

  const handleToggleCustomColorCycle = React.useCallback((checked: boolean) => {
    const updates: Partial<typeof activeSettings> = {
      customBrushColorCycle: checked
    };

    if (checked) {
      if (!activeSettings.colorCycleGradient || activeSettings.colorCycleGradient.length === 0) {
        updates.colorCycleGradient = DEFAULT_RAINBOW_STOPS;
      }
      if (!activeSettings.colorCycleSpeed) {
        updates.colorCycleSpeed = 0.1;
      }
    }

    setActiveSettings(updates);

    if (checked) {
      ensureCustomColorCycleLayer();
    }
  }, [activeSettings.colorCycleGradient, activeSettings.colorCycleSpeed, ensureCustomColorCycleLayer, setActiveSettings]);

  // Use state to track animation status for proper re-renders
  const [isAnimating, setIsAnimating] = React.useState(true); // Default to playing

  // Ensure Color Cycle brushes start with a sensible spacing value even when no preset overrides exist
  React.useEffect(() => {
    const shape = activeSettings.brushShape;
    if (shape !== BrushShape.COLOR_CYCLE && shape !== BrushShape.COLOR_CYCLE_SHAPE) {
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
    const wasColorCycle = isColorCycleBrush(previousBrushShape.current);
    const isCurrentColorCycle = isColorCycleBrush(activeSettings.brushShape);
    
    if (isCurrentColorCycle) {
      // Start animation when switching to color cycle brush (if play is active)
      if (isAnimating && colorCycleAnimationHandlers) {
        colorCycleAnimationHandlers.startContinuousColorCycleAnimation();
      }
      
      // Set appropriate shape mode based on brush variant
      const forcedShapeMode = getShapeModeForBrush(activeSettings.brushShape);
      if (forcedShapeMode !== undefined && shapeMode !== forcedShapeMode) {
        setShapeMode(forcedShapeMode);
      }
    } else {
      // ALWAYS stop animation when switching to ANY other tool
      // This prevents lag when using other tools
      if (colorCycleAnimationHandlers) {
        colorCycleAnimationHandlers.stopContinuousColorCycleAnimation();
      }
      
      if (wasColorCycle) {
        // Reset Color Cycle speed to default when leaving CC mode
        setActiveSettings({ colorCycleSpeed: 0.1 });
      }
      setIsAnimating(true); // Reset to playing state for next time
    }
    
    previousBrushShape.current = activeSettings.brushShape;
  }, [activeSettings.brushShape, isAnimating, setActiveSettings, shapeMode, setShapeMode]);


  // Show special controls for Color Cycle brushes (both stroke and shape variants)
  if (isColorCycleBrush(activeSettings.brushShape)) {
    return (
      <div className="p-4">
        {/* Color Cycle variant switcher (Stroke vs Shape) */}
        <div className="mb-3">
          <ButtonGroup
            options={[
              { label: 'Stroke', value: 'stroke' },
              { label: 'Shape', value: 'shape' }
            ]}
            value={activeSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE ? 'shape' : 'stroke'}
            onChange={(value) => {
              const strokePreset = brushPresets.find(p => p.id === 'color-cycle-stroke');
              const shapePreset = brushPresets.find(p => p.id === 'color-cycle-shape');
              if (value === 'shape' && shapePreset) {
                setBrushPreset(shapePreset, true);
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
              className="w-full"
            />
          </div>
        )}

        {/* Gradient Editor (sampling toggle moved into dropdown) */}
        <div className="mb-4">
          <GradientEditor
            sampleTarget="brush"
            stops={activeSettings.colorCycleGradient || DEFAULT_RAINBOW_STOPS}
            onChange={(stops) => {
              setActiveSettings({ colorCycleGradient: stops });

              // Keep shared gradient in sync across all Color Cycle tools
              setSharedColorCycleGradient(stops);
              
              // Update the active layer's gradient if it's a color-cycle layer
              const state = useAppStore.getState();
              const activeLayer = state.layers.find(l => l.id === state.activeLayerId);
              if (activeLayer?.layerType === 'color-cycle' && state.activeLayerId) {
                state.updateLayer(state.activeLayerId, {
                  colorCycleData: {
                    ...activeLayer.colorCycleData,
                    gradient: stops,
                    isAnimating: activeLayer.colorCycleData?.isAnimating || false
                  }
                });
              }
              
              // Use the shared handler from DrawingCanvas if available
              if (colorCycleAnimationHandlers?.updateColorCycleGradient) {
                colorCycleAnimationHandlers.updateColorCycleGradient(stops);
              }
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
              min={0.02}
              max={1.0}
              step={0.01}
              onChange={(value) => {
                // Update per-layer speed when on a CC brush layer, else update global brush setting
                const layer = layers.find(l => l.id === activeLayerId);
                const isCCBrushLayer = layer?.layerType === 'color-cycle' && layer?.colorCycleData?.mode !== 'recolor';
                if (isCCBrushLayer && activeLayerId && layer?.colorCycleData) {
                  const clampedValue = Math.max(0.02, Math.min(1.0, value));
                  updateLayer(activeLayerId, {
                    colorCycleData: {
                      ...layer.colorCycleData,
                      brushSpeed: clampedValue
                    }
                  });
                } else {
                  setActiveSettings({ colorCycleSpeed: value });
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

        {/* Flow Direction Toggle */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Flow
            </label>
            <CustomSwitch
              checked={activeSettings.colorCycleFlowForward === true}
              onChange={(checked) => {
                setActiveSettings({ colorCycleFlowForward: checked });
                // Set flow direction based on toggle state
                if (colorCycleAnimationHandlers?.setFlowDirection) {
                  colorCycleAnimationHandlers.setFlowDirection(checked ? 'forward' : 'backward');
                }
              }}
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
                value={globalBrushSize}
                min={1}
                max={500}
                step={1}
                onChange={(value) => {
                  setGlobalBrushSize(Math.max(1, value));
                }}
                aria-label="Brush Size (px)"
                className="flex-1"
              />
            </div>
          </div>
        )}

        {/* Opacity */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
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
        {/* Spacing (Color Cycle Stroke only) */}
        {activeSettings.brushShape === BrushShape.COLOR_CYCLE && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
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

        {/* Gradient Bands - always shown; when Dither is ON we dither between bands */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              {activeSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE && (activeSettings.ditherEnabled || false) ? 'Colors' : 'Bands'}
            </label>
              <ProgressSlider
                value={activeSettings.gradientBands || 12}
                min={2}
                max={128}
                step={1}
                onChange={(value) => setActiveSettings({ gradientBands: Math.round(value) })}
                aria-label="Gradient Bands (number of color steps)"
                className="flex-1"
              />
          </div>
        </div>

        {activeSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="dither-enabled-color-cycle"
                className="text-[#D9D9D9] w-16"
                style={{ fontSize: '14px' }}
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
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                  Resolution
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
          </div>
        )}


        {/* Color Jitter */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
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

        {/* Shape Mode - Hidden for Color Cycle brushes as it's auto-managed */}

        {/* Pressure - only for Color Cycle stroke variant */}
        {activeSettings.brushShape === BrushShape.COLOR_CYCLE && (
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
                <>
                  <Input
                    type="number"
                    variant="compact"
                    value={activeSettings.minPressure || 1}
                    onChange={(e) => {
                      const newMin = parseInt(e.target.value) || 1;
                      setActiveSettings({
                        minPressure: newMin,
                      });
                    }}
                    min="1"
                    max="1000"
                    className="w-12 bg-[#4a4a4a] border-none focus:outline-none h-5"
                  />
                  <span className="text-[#D9D9D9]" style={{ fontSize: "14px" }}>
                    -
                  </span>
                  <Input
                    type="number"
                    variant="compact"
                    value={activeSettings.maxPressure ?? 200}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      setActiveSettings({ maxPressure: value || undefined });
                    }}
                    min="1"
                    max="1000"
                    className="w-12 bg-[#4a4a4a] border-none focus:outline-none h-5"
                  />
                </>
              )}
            </div>
          </div>
        )}

        {/* Rotation - only for stroke variant */}
        {activeSettings.brushShape === BrushShape.COLOR_CYCLE && (
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
            className="w-full h-20 p-2 bg-[#4a4a4a] text-[#D9D9D9] border-none rounded resize-none focus:outline-none focus:ring-1 focus:ring-[#5a5a5a]"
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
              onChange={(value) => setGlobalBrushSize(Math.max(8, value))}
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
                  value={activeSettings.minPressure || 1}
                  onChange={(e) => {
                    const newMin = parseInt(e.target.value) || 1;
                    setActiveSettings({ minPressure: newMin });
                  }}
                  min="1"
                  max="1000"
                  className="w-12 bg-[#4a4a4a] border-none focus:outline-none h-5"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: "14px" }}>
                  -
                </span>
                <Input
                  type="number"
                  variant="compact"
                  value={activeSettings.maxPressure ?? 200}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    setActiveSettings({ maxPressure: value || undefined });
                  }}
                  min="1"
                  max="1000"
                  className="w-12 bg-[#4a4a4a] border-none focus:outline-none h-5"
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
              value={globalBrushSize}
              min={isCustomBrush ? 5 : 1}
              max={isCustomBrush ? 500 : 500}
              step={isCustomBrush ? 5 : 1}
              onChange={(value) => {
                // For custom brushes, ensure we stay on 5% increments
                const finalValue = isCustomBrush ? Math.round(value / 5) * 5 : value;
                setGlobalBrushSize(Math.max(isCustomBrush ? 5 : 1, finalValue));
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
                  value={activeSettings.minPressure || 1}
                  onChange={(e) => {
                    const newMin = parseInt(e.target.value) || 1;
                    setActiveSettings({
                      minPressure: newMin,
                    });
                  }}
                  min="1"
                  max="1000"
                  className="w-12 bg-[#4a4a4a] border-none focus:outline-none h-5"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: "14px" }}>
                  -
                </span>
                <Input
                  type="number"
                  variant="compact"
                  value={activeSettings.maxPressure ?? 200}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    setActiveSettings({ maxPressure: value || undefined });
                  }}
                  min="1"
                  max="1000"
                  className="w-12 bg-[#4a4a4a] border-none focus:outline-none h-5"
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
                  className="w-7 bg-[#4a4a4a] border-none focus:outline-none px-0 h-5"
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
                  className="w-7 bg-[#4a4a4a] border-none focus:outline-none px-0 h-5"
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

  // Show Contour Spacing slider for contour polygon brush
  if (
    activeSettings.brushShape === BrushShape.CONTOUR_POLYGON ||
    activeSettings.brushShape === BrushShape.NEW_SHAPE_FILL
  ) {
    const isNewShapeFill = activeSettings.brushShape === BrushShape.NEW_SHAPE_FILL;
    const shapeModeOptions = isNewShapeFill
      ? [{ label: 'Contour', value: 'contour' }]
      : [
          { label: 'Contour', value: 'contour' },
          { label: 'Lines', value: 'lines' },
          { label: 'Lines 2', value: 'lines2' },
          { label: 'Flow', value: 'flow' },
          { label: 'Ribbons', value: 'inkRibbons' },
          { label: 'Delaunator', value: 'triangle' },
          { label: 'Hatch', value: 'crosshatch' },
        ];
    return (
      <div className="p-4">
        {/* Shape Mode Selector */}
        <div className="mb-3">
          <ButtonGroup
            options={shapeModeOptions}
            value={
              isNewShapeFill
                ? 'contour'
                : (activeSettings.shapeGradientMode === 'mesh'
                    ? 'lines'
                    : activeSettings.shapeGradientMode) || 'contour'
            }
            onChange={(value) => {
              if (isNewShapeFill) {
                setActiveSettings({ shapeGradientMode: 'contour' });
                return;
              }
              setActiveSettings({
                shapeGradientMode: value as
                  | 'contour'
                  | 'lines'
                  | 'lines2'
                  | 'triangle'
                  | 'crosshatch'
                  | 'flow'
                  | 'inkRibbons',
              });
            }}
            className="w-full"
          />
        </div>

        <div className="mb-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                Sample
              </label>
              <CustomSwitch
                id="shape-fill-sample-toggle"
                checked={activeSettings.shapeFillUseSampledColor ?? false}
                onChange={(checked) => setActiveSettings({ shapeFillUseSampledColor: checked })}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                Pixel
              </label>
              <CustomSwitch
                id="shape-fill-pixel-toggle"
                checked={activeSettings.shapeFillPixelMode ?? true}
                onChange={(checked) => setActiveSettings({ shapeFillPixelMode: checked })}
              />
            </div>
          </div>
        </div>

        {!isNewShapeFill &&
          activeSettings.shapeGradientMode !== 'crosshatch' &&
          activeSettings.shapeGradientMode !== 'inkRibbons' && (
          <div className="mb-2">
            <div className="flex items-center gap-2">
              <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                Line
              </label>
              <ProgressSlider
                value={shapeFillLineWidth}
                min={0.5}
                max={10}
                step={0.5}
                onChange={(value) =>
                  setActiveSettings({ shapeFillLineWidth: value })
                }
                aria-label="Fill Line Width"
                className="flex-1"
              />
              <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                {shapeFillLineWidthLabel}px
              </span>
            </div>
          </div>
        )}

        {!isNewShapeFill && (
          <>
            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                  Hardening
                </label>
                <ProgressSlider
                  value={shapeFillHardening}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(value) => setActiveSettings({ shapeFillHardening: Number(value.toFixed(2)) })}
                  aria-label="Shape Fill Hardening"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {shapeFillHardeningLabel}
                </span>
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                  Threshold
                </label>
                <ProgressSlider
                  value={shapeFillHardeningThreshold}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(value) => setActiveSettings({ shapeFillHardeningThreshold: Number(value.toFixed(2)) })}
                  aria-label="Shape Fill Hardening Threshold"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {shapeFillHardeningThresholdLabel}
                </span>
              </div>
            </div>

            <div className="mb-3">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                  Feather
                </label>
                <ProgressSlider
                  value={shapeFillEdgeFeather}
                  min={0.5}
                  max={3}
                  step={0.1}
                  onChange={(value) => setActiveSettings({ shapeFillEdgeFeather: Number(value.toFixed(2)) })}
                  aria-label="Shape Fill Edge Feather"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {shapeFillEdgeFeatherLabel}
                </span>
              </div>
            </div>
          </>
        )}

        {/* Contour controls */}
        {(activeSettings.shapeGradientMode || 'contour') === 'contour' && (
          <>
            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                  Spacing
                </label>
                <ProgressSlider
                  value={activeSettings.contourSpacing || 5}
                  min={1}
                  max={10}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ contourSpacing: Math.round(value) })
                  }
                  aria-label="Contour Spacing"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                  Variance
                </label>
                <ProgressSlider
                  value={activeSettings.contourVariance ?? 5}
                  min={0}
                  max={10}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ contourVariance: Math.round(value) })
                  }
                  aria-label="Contour Variance"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                  Smooth
                </label>
                <ProgressSlider
                  value={activeSettings.contourSmoothness ?? 2.5}
                  min={0}
                  max={5}
                  step={0.5}
                  onChange={(value) =>
                    setActiveSettings({ contourSmoothness: value })
                  }
                  aria-label="Contour Smoothness"
                  className="flex-1"
                />
              </div>
            </div>
          </>
        )}

        {/* Lines2 controls */}
        {!isNewShapeFill && activeSettings.shapeGradientMode === 'lines2' && (
          <>
            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Bundle Spacing
                </label>
                <ProgressSlider
                  value={activeSettings.contourLines2Spacing ?? 4}
                  min={1}
                  max={20}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ contourLines2Spacing: Math.round(value) })
                  }
                  aria-label="Lines2 Bundle Spacing"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '2rem', textAlign: 'right' }}>
                  {activeSettings.contourLines2Spacing ?? 4}
                </span>
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Line Density
                </label>
                <ProgressSlider
                  value={activeSettings.contourLines2Density ?? 5}
                  min={1}
                  max={10}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ contourLines2Density: Math.round(value) })
                  }
                  aria-label="Lines2 Density"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '2rem', textAlign: 'right' }}>
                  {activeSettings.contourLines2Density ?? 5}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                Alternate
              </label>
              <CustomSwitch
                id="contour-lines2-alternate"
                checked={activeSettings.contourLines2Alternate ?? true}
                onChange={(checked) =>
                  setActiveSettings({ contourLines2Alternate: checked })
                }
              />
              <span className="text-[#9FA0A4]" style={{ fontSize: '12px' }}>
                Toggle offset direction every other line group.
              </span>
            </div>
          </>
        )}

        {activeSettings.shapeGradientMode === 'flow' && (
          <>
            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Seed Spacing
                </label>
                <ProgressSlider
                  value={activeSettings.flowSeedSpacing ?? 18}
                  min={4}
                  max={80}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ flowSeedSpacing: Math.round(value) })
                  }
                  aria-label="Flow Seed Spacing"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {Math.round(activeSettings.flowSeedSpacing ?? 18)}px
                </span>
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Step Length
                </label>
                <ProgressSlider
                  value={activeSettings.flowStepSize ?? 4}
                  min={0.5}
                  max={20}
                  step={0.5}
                  onChange={(value) =>
                    setActiveSettings({ flowStepSize: Number(value.toFixed(1)) })
                  }
                  aria-label="Flow Step Length"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {(activeSettings.flowStepSize ?? 4).toFixed(1)}px
                </span>
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Max Steps
                </label>
                <ProgressSlider
                  value={activeSettings.flowMaxSteps ?? 120}
                  min={10}
                  max={400}
                  step={10}
                  onChange={(value) =>
                    setActiveSettings({ flowMaxSteps: Math.round(value) })
                  }
                  aria-label="Flow Max Steps"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {Math.round(activeSettings.flowMaxSteps ?? 120)}
                </span>
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Field Step
                </label>
                <ProgressSlider
                  value={activeSettings.flowFieldResolution ?? 8}
                  min={2}
                  max={32}
                  step={2}
                  onChange={(value) =>
                    setActiveSettings({ flowFieldResolution: Math.round(value) })
                  }
                  aria-label="Flow Field Resolution"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {Math.round(activeSettings.flowFieldResolution ?? 8)}px
                </span>
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Orientation
                </label>
                <ProgressSlider
                  value={activeSettings.flowOrientationAngle ?? 0}
                  min={0}
                  max={360}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ flowOrientationAngle: Math.round(value) })
                  }
                  aria-label="Flow Orientation"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {Math.round(activeSettings.flowOrientationAngle ?? 0)}°
                </span>
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Seed Jitter
                </label>
                <ProgressSlider
                  value={Math.round((activeSettings.flowSeedJitter ?? 0.6) * 100)}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ flowSeedJitter: Math.max(0, Math.min(1, value / 100)) })
                  }
                  aria-label="Flow Seed Jitter"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {Math.round((activeSettings.flowSeedJitter ?? 0.6) * 100)}%
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                Orthogonal
              </label>
              <CustomSwitch
                id="flow-orthogonal-toggle"
                checked={activeSettings.flowUseOrthogonal ?? false}
                onChange={(checked) => setActiveSettings({ flowUseOrthogonal: checked })}
              />
              <span className="text-[#9FA0A4]" style={{ fontSize: '12px' }}>
                Rotate streamlines 90° for cross-flow patterns.
              </span>
            </div>
          </>
        )}

        {activeSettings.shapeGradientMode === 'inkRibbons' && (
          <>
            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Field Step
                </label>
                <ProgressSlider
                  value={activeSettings.ribbonSdfStep ?? 8}
                  min={4}
                  max={64}
                  step={2}
                  onChange={(value) =>
                    setActiveSettings({ ribbonSdfStep: Math.round(value) })
                  }
                  aria-label="Ribbon Field Step"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Seed Spacing
                </label>
                <ProgressSlider
                  value={activeSettings.ribbonSeedSpacing ?? 18}
                  min={6}
                  max={140}
                  step={2}
                  onChange={(value) =>
                    setActiveSettings({ ribbonSeedSpacing: Math.round(value) })
                  }
                  aria-label="Ribbon Seed Spacing"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Step Length
                </label>
                <ProgressSlider
                  value={activeSettings.ribbonStepSize ?? 1.7}
                  min={0.4}
                  max={10}
                  step={0.1}
                  onChange={(value) =>
                    setActiveSettings({ ribbonStepSize: Number(value.toFixed(1)) })
                  }
                  aria-label="Ribbon Step Length"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Max Steps
                </label>
                <ProgressSlider
                  value={activeSettings.ribbonMaxSteps ?? 370}
                  min={50}
                  max={1000}
                  step={10}
                  onChange={(value) =>
                    setActiveSettings({ ribbonMaxSteps: Math.round(value) })
                  }
                  aria-label="Ribbon Max Steps"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Tangent
                </label>
                <ProgressSlider
                  value={activeSettings.ribbonTangentWeight ?? 0.6}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(value) =>
                    setActiveSettings({ ribbonTangentWeight: Number(value.toFixed(2)) })
                  }
                  aria-label="Ribbon Tangent Weight"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Bias Angle
                </label>
                <ProgressSlider
                  value={activeSettings.ribbonBiasAngle ?? 80}
                  min={0}
                  max={360}
                  step={5}
                  onChange={(value) =>
                    setActiveSettings({ ribbonBiasAngle: Math.round(value) })
                  }
                  aria-label="Ribbon Bias Angle"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Noise Amt
                </label>
                <ProgressSlider
                  value={activeSettings.ribbonNoiseStrength ?? 0.45}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(value) =>
                    setActiveSettings({ ribbonNoiseStrength: Number(value.toFixed(2)) })
                  }
                  aria-label="Ribbon Noise Strength"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Noise Scale
                </label>
                <ProgressSlider
                  value={activeSettings.ribbonNoiseScale ?? 220}
                  min={10}
                  max={400}
                  step={10}
                  onChange={(value) =>
                    setActiveSettings({ ribbonNoiseScale: Math.round(value) })
                  }
                  aria-label="Ribbon Noise Scale"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Octaves
                </label>
                <ProgressSlider
                  value={activeSettings.ribbonNoiseOctaves ?? 3}
                  min={1}
                  max={6}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ ribbonNoiseOctaves: Math.round(value) })
                  }
                  aria-label="Ribbon Noise Octaves"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Line Width
                </label>
                <ProgressSlider
                  value={activeSettings.ribbonLineWidth ?? activeSettings.shapeFillLineWidth ?? 1.6}
                  min={0.5}
                  max={6}
                  step={0.1}
                  onChange={(value) =>
                    setActiveSettings({ ribbonLineWidth: Number(value.toFixed(2)) })
                  }
                  aria-label="Ribbon Line Width"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Seed Jitter
                </label>
                <ProgressSlider
                  value={activeSettings.ribbonJitter ?? 0.25}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(value) =>
                    setActiveSettings({ ribbonJitter: Number(value.toFixed(2)) })
                  }
                  aria-label="Ribbon Seed Jitter"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Anchor Ease
                </label>
                <ProgressSlider
                  value={activeSettings.ribbonAnchorFalloff ?? 0.3}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(value) =>
                    setActiveSettings({ ribbonAnchorFalloff: Number(value.toFixed(2)) })
                  }
                  aria-label="Ribbon Anchor Falloff"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-20" style={{ fontSize: '14px' }}>
                  Seed
                </label>
                <Input
                  type="number"
                  variant="compact"
                  value={Math.round(activeSettings.ribbonSeed ?? 2025)}
                  min="0"
                  max="4294967295"
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    setActiveSettings({ ribbonSeed: Number.isFinite(parsed) ? parsed : 2025 });
                  }}
                  className="w-24 bg-[#4a4a4a] border-none focus:outline-none h-6 text-[#D9D9D9]"
                />
              </div>
            </div>
          </>
        )}

        {activeSettings.shapeGradientMode === 'triangle' && (
          <>
            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                  Rotation
                </label>
                <ProgressSlider
                  value={activeSettings.triangleFillRotation ?? 0}
                  min={0}
                  max={180}
                  step={5}
                  onChange={(value) =>
                    setActiveSettings({ triangleFillRotation: Math.round(value) })
                  }
                  aria-label="Triangle Rotation"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {(activeSettings.triangleFillRotation ?? 0)}°
                </span>
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                  Size
                </label>
                <ProgressSlider
                  value={activeSettings.triangleFillSize ?? 36}
                  min={8}
                  max={160}
                  step={2}
                  onChange={(value) =>
                    setActiveSettings({ triangleFillSize: Math.round(value) })
                  }
                  aria-label="Triangle Size"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {(activeSettings.triangleFillSize ?? 36)}px
                </span>
              </div>
            </div>

            <div className="mb-1">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                  Variation
                </label>
                <ProgressSlider
                  value={activeSettings.triangleFillJitter ?? 35}
                  min={0}
                  max={100}
                  step={5}
                  onChange={(value) =>
                    setActiveSettings({ triangleFillJitter: Math.round(value) })
                  }
                  aria-label="Triangle Variation"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {(activeSettings.triangleFillJitter ?? 35)}%
                </span>
              </div>
            </div>
          </>
        )}

        {/* Hatch controls */}
        {activeSettings.shapeGradientMode === 'crosshatch' && (
          <>
            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                  Rotation
                </label>
                <ProgressSlider
                  value={activeSettings.crossHatchRotation || 45}
                  min={0}
                  max={360}
                  step={5}
                  onChange={(value) =>
                    setActiveSettings({ crossHatchRotation: Math.round(value) })
                  }
                  aria-label="Hatch Rotation"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {activeSettings.crossHatchRotation || 45}°
                </span>
              </div>
            </div>

            <div className="mb-2">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                  Spacing
                </label>
                <ProgressSlider
                  value={activeSettings.crossHatchSpacing || 10}
                  min={2}
                  max={50}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ crossHatchSpacing: Math.round(value) })
                  }
                  aria-label="Hatch Spacing"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {activeSettings.crossHatchSpacing || 10}px
                </span>
              </div>
            </div>

            <div className="mb-1">
              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
                  Width
                </label>
                <ProgressSlider
                  value={crossHatchLineWidth}
                  min={0.5}
                  max={10}
                  step={0.5}
                  onChange={(value) =>
                    setActiveSettings({
                      crossHatchLineWidth: value,
                      shapeFillLineWidth: value,
                    })
                  }
                  aria-label="Hatch Line Width"
                  className="flex-1"
                />
                <span className="text-[#D9D9D9]" style={{ fontSize: '14px', minWidth: '3rem', textAlign: 'right' }}>
                  {crossHatchLineWidthLabel}px
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // Show special controls for Polygon brush
  if (activeSettings.brushShape === BrushShape.POLYGON) {
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
              onChange={(value) => setGlobalBrushSize(value)}
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
              {/* Fill Res - only show when dithering is enabled */}
              {activeSettings.ditherEnabled && (
                <ProgressSlider
                  value={activeSettings.fillResolution || 1}
                  min={1}
                  max={16}
                  step={1}
                  onChange={(value) =>
                    setActiveSettings({ fillResolution: Math.round(value) })
                  }
                  aria-label="Fill Resolution"
                  className="flex-1"
                />
              )}
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

  return (
    <div className="p-4">
      {isCustomBrush && (
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
            <div className="mt-2 space-y-2">
              <GradientEditor
                sampleTarget="brush"
                stops={activeSettings.colorCycleGradient || DEFAULT_RAINBOW_STOPS}
                onChange={(stops) => {
                  setActiveSettings({ colorCycleGradient: stops });
                  setSharedColorCycleGradient(stops);

                  const state = useAppStore.getState();
                  const activeLayer = state.layers.find(l => l.id === state.activeLayerId);
                  if (activeLayer?.layerType === 'color-cycle' && state.activeLayerId) {
                    state.updateLayer(state.activeLayerId, {
                      colorCycleData: {
                        ...activeLayer.colorCycleData,
                        gradient: stops,
                        isAnimating: activeLayer.colorCycleData?.isAnimating || false
                      }
                    });
                  }

                  if (colorCycleAnimationHandlers?.updateColorCycleGradient) {
                    colorCycleAnimationHandlers.updateColorCycleGradient(stops);
                  }
                }}
              />

              <div className="flex items-center gap-2">
                <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
                  Speed
                </label>
                <ProgressSlider
                  value={activeSettings.colorCycleSpeed || 0.1}
                  min={0.02}
                  max={1.0}
                  step={0.01}
                  onChange={(value) => {
                    const clamped = Math.max(0.02, Math.min(1.0, value));
                    setActiveSettings({ colorCycleSpeed: clamped });

                    const state = useAppStore.getState();
                    const layer = state.layers.find(l => l.id === state.activeLayerId);

                    if (layer?.layerType === 'color-cycle' && state.activeLayerId) {
                      state.updateLayer(state.activeLayerId, {
                        colorCycleData: {
                          ...(layer.colorCycleData || {}),
                          brushSpeed: clamped
                        }
                      });
                    }
                  }}
                  aria-label="Color Cycle Speed"
                  className="flex-1"
                />
              </div>
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
            value={globalBrushSize}
            min={isCustomBrush ? 5 : 1}
            max={isCustomBrush ? 500 : 500}
            step={isCustomBrush ? 5 : 1}
            onChange={(value) => {
              // For custom brushes, ensure we stay on 5% increments
              const finalValue = isCustomBrush ? Math.round(value / 5) * 5 : value;
              setGlobalBrushSize(Math.max(isCustomBrush ? 5 : 1, finalValue));
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
            <>
              <Input
                type="number"
                variant="compact"
                value={activeSettings.minPressure || 1}
                onChange={(e) => {
                  const newMin = parseInt(e.target.value) || 1;
                  setActiveSettings({
                    minPressure: newMin,
                  });
                }}
                min="1"
                max="1000"
                className="w-8 bg-[#4a4a4a] border-none focus:outline-none h-5"
              />
              <span className="text-[#D9D9D9]" style={{ fontSize: "14px" }}>
                -
              </span>
              <Input
                type="number"
                variant="compact"
                value={activeSettings.maxPressure ?? 100}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  setActiveSettings({ maxPressure: value || undefined });
                }}
                min="1"
                max="1000"
                className="w-8 bg-[#4a4a4a] border-none focus:outline-none h-5"
              />
            </>
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
                className="w-7 bg-[#4a4a4a] border-none focus:outline-none px-0 h-5"
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
                className="w-7 bg-[#4a4a4a] border-none focus:outline-none px-0 h-5"
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
