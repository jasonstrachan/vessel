"use client";

// Simple brush controls for proof of concept
// Based on /docs/03_Features/Drawing_Tools.md (lines 8-48)

import React from "react";
import { useAppStore } from "../../stores/useAppStore";
import { BrushShape } from "../../types";
import Input from "../ui/Input";
import CustomSwitch from "../ui/CustomSwitch";
import ProgressSlider from "../ui/ProgressSlider";
import { drawTestSwatches } from "../../utils/drawTestSwatches";
import { GradientEditor } from "../ui/GradientEditor";

// Get access to drawing handlers via a context or ref - we'll need to create this
interface ColorCycleAnimationContext {
  startContinuousColorCycleAnimation: () => void;
  stopContinuousColorCycleAnimation: () => void;
  updateColorCycleGradient?: (stops: Array<{ position: number; color: string }>) => void;
}

// For now, we'll store this globally - a proper solution would use React context
let colorCycleAnimationHandlers: ColorCycleAnimationContext | null = null;

export const setColorCycleAnimationHandlers = (handlers: ColorCycleAnimationContext | null) => {
  colorCycleAnimationHandlers = handlers;
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
  
  // Determine if current brush is custom (uses percentage) or default (uses pixels)
  const isCustomBrush = brushSettings.brushShape === BrushShape.CUSTOM;
  const sizeUnit = isCustomBrush ? '%' : 'px';

  // Use the appropriate settings and setter based on current tool
  const activeSettings =
    currentTool === "eraser" ? eraserSettings : brushSettings;
  const setActiveSettings =
    currentTool === "eraser" ? setEraserSettings : setBrushSettings;
  
  // Use state to track animation status for proper re-renders
  const [isAnimating, setIsAnimating] = React.useState(false);
  
  // Stop animation when switching away from color cycle brush
  React.useEffect(() => {
    if (activeSettings.brushShape !== BrushShape.COLOR_CYCLE) {
      // Stop continuous animation when not using color cycle brush
      if (colorCycleAnimationHandlers) {
        colorCycleAnimationHandlers.stopContinuousColorCycleAnimation();
      }
      setIsAnimating(false);
    }
  }, [activeSettings.brushShape]);


  // Show special controls for Color Cycle brush
  if (activeSettings.brushShape === BrushShape.COLOR_CYCLE) {
    return (
      <div className="p-4">
        {/* Play/Pause Button */}
        <div className="mb-4">
          <button
            onClick={() => {
              // Toggle animation state
              const newIsAnimating = !isAnimating;
              setIsAnimating(newIsAnimating);
              
              // Start or stop the continuous animation loop based on play state
              if (colorCycleAnimationHandlers) {
                if (newIsAnimating) {
                  colorCycleAnimationHandlers.startContinuousColorCycleAnimation();
                } else {
                  colorCycleAnimationHandlers.stopContinuousColorCycleAnimation();
                }
              }
            }}
            className="w-full py-2 px-4 bg-[#333] hover:bg-[#444] text-[#D9D9D9] rounded transition-colors"
            style={{ fontSize: "14px" }}
          >
            {isAnimating ? '⏸ Pause Animation' : '▶ Play Animation'}
          </button>
        </div>
        
        {/* Gradient Editor - moved below play/pause button */}
        <div className="mb-4">
          <GradientEditor
            stops={activeSettings.colorCycleGradient || [
              { position: 0.0, color: '#ff0000' },
              { position: 0.17, color: '#ff7f00' },
              { position: 0.33, color: '#ffff00' },
              { position: 0.5, color: '#00ff00' },
              { position: 0.67, color: '#0000ff' },
              { position: 0.83, color: '#4b0082' },
              { position: 1.0, color: '#9400d3' }
            ]}
            onChange={(stops) => {
              setActiveSettings({ colorCycleGradient: stops });
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
              value={activeSettings.colorCycleSpeed || 1.0}
              min={0.1}
              max={5.0}
              step={0.1}
              onChange={(value) =>
                setActiveSettings({ colorCycleSpeed: value })
              }
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
              onChange={(value) =>
                setActiveSettings({ colorCycleFPS: Math.round(value) })
              }
              aria-label="Frames Per Second"
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

        {/* Opacity */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Opacity
            </label>
            <ProgressSlider
              value={activeSettings.opacity * 100}
              min={1}
              max={100}
              onChange={(value) =>
                setActiveSettings({ opacity: value / 100 })
              }
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
              value={activeSettings.spacing || 25}
              min={1}
              max={400}
              step={1}
              onChange={(value) =>
                setActiveSettings({ spacing: Math.max(1, Math.round(value)) })
              }
              aria-label="Spacing"
              className="flex-1"
            />
          </div>
        </div>

        {/* Flow */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Flow
            </label>
            <ProgressSlider
              value={activeSettings.flow || 1}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) =>
                setActiveSettings({ flow: value })
              }
              aria-label="Flow"
              className="flex-1"
            />
          </div>
        </div>

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
              onChange={(value) =>
                setActiveSettings({ colorJitter: Math.round(value) })
              }
              aria-label="Color Jitter"
              className="flex-1"
            />
          </div>
        </div>

        {/* Pressure */}
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

        {/* Rotation */}
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

        {/* Dashed */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="dashed-enabled-color-cycle"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Dashed
            </label>
            <CustomSwitch
              id="dashed-enabled-color-cycle"
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
              htmlFor="grid-snap-enabled-color-cycle"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Grid Snap
            </label>
            <CustomSwitch
              id="grid-snap-enabled-color-cycle"
              checked={activeSettings.gridSnapEnabled || false}
              onChange={(checked) =>
                setActiveSettings({ gridSnapEnabled: checked })
              }
            />
          </div>
        </div>

        {/* Shape Mode - Draw closed polygon shapes */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label
              htmlFor="shape-mode-color-cycle"
              className="text-[#D9D9D9] w-16"
              style={{ fontSize: "14px" }}
            >
              Shape
            </label>
            <CustomSwitch
              id="shape-mode-color-cycle"
              checked={shapeMode || false}
              onChange={(checked) => setShapeMode(checked)}
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
              max={400}
              step={1}
              onChange={(value) =>
                setActiveSettings({ spacing: Math.max(1, Math.round(value)) })
              }
              aria-label="Spacing"
              className="flex-1"
            />
          </div>
        </div>

        {/* Col Jit */}
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
              onChange={(value) =>
                setActiveSettings({ colorJitter: Math.round(value) })
              }
              aria-label="Color Jitter"
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
              onChange={(checked) => setShapeMode(checked)}
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
                console.log('[Pressure Toggle Debug]', {
                  previousState: activeSettings.pressureEnabled,
                  newState: checked,
                  minPressure: activeSettings.minPressure,
                  maxPressure: activeSettings.maxPressure
                });
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
                    console.log('[Min Pressure Input Debug]', {
                      oldValue: activeSettings.minPressure,
                      newValue: newMin,
                      pressureEnabled: activeSettings.pressureEnabled
                    });
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
                    console.log('[Max Pressure Input Debug]', {
                      oldValue: activeSettings.maxPressure,
                      newValue: value,
                      pressureEnabled: activeSettings.pressureEnabled
                    });
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

        {/* Rotation */}
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
  if (activeSettings.brushShape === BrushShape.CONTOUR_POLYGON) {
    return (
      <div className="p-4">
        {/* Contour Spacing */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
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
        
        {/* Contour Variance */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
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
        
        {/* Contour Smoothness */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
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
        {/* Colors */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
              Colors
            </label>
            <ProgressSlider
              value={activeSettings.colors || 2}
              min={1}
              max={10}
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
                <select
                  value={activeSettings.ditherAlgorithm || 'sierra-lite'}
                  onChange={(e) => {
                    setActiveSettings({ ditherAlgorithm: e.target.value as 'floyd-steinberg' | 'bayer' | 'sierra-lite' | 'atkinson' | 'blue-noise' | 'pattern' });
                    e.currentTarget.blur();
                  }}
                  className="flex-1 bg-[#4a4a4a] text-[#D9D9D9] border border-[#5a5a5a] rounded px-2 py-1 text-xs focus:outline-none focus:border-[#6a6a6a]"
                >
                  <option value="sierra-lite">Sierra Lite</option>
                  <option value="floyd-steinberg">Floyd-Steinberg</option>
                  <option value="bayer">Bayer Matrix</option>
                  <option value="atkinson">Atkinson</option>
                  <option value="blue-noise">Blue Noise</option>
                  <option value="pattern">Pattern</option>
                </select>
              </div>
              
              {/* Pattern Style Dropdown - only show when Pattern algorithm is selected */}
              {activeSettings.ditherAlgorithm === 'pattern' && (
                <div className="flex items-center gap-2 mt-2">
                  <div className="w-16" /> {/* Empty space to align with label column */}
                  <select
                    value={activeSettings.patternStyle || 'dots'}
                    onChange={(e) => {
                      setActiveSettings({ patternStyle: e.target.value as 'dots' | 'lines' | 'vertical-lines' | 'horizontal-lines' | 'crosshatch' | 'diagonal' });
                      e.currentTarget.blur();
                    }}
                    className="flex-1 bg-[#4a4a4a] text-[#D9D9D9] border border-[#5a5a5a] rounded px-2 py-1 text-xs focus:outline-none focus:border-[#6a6a6a]"
                  >
                    <option value="dots">Dots</option>
                    <option value="lines">Diagonal Lines</option>
                    <option value="vertical-lines">Vertical Lines</option>
                    <option value="horizontal-lines">Horizontal Lines</option>
                    <option value="crosshatch">Crosshatch</option>
                    <option value="diagonal">Diamond</option>
                  </select>
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
            max={400}
            step={1}
            onChange={(value) =>
              setActiveSettings({ spacing: Math.max(1, Math.round(value)) })
            }
            aria-label="Spacing"
            className="flex-1"
          />
        </div>
      </div>

      {/* Col Jit */}
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
            onChange={(value) =>
              setActiveSettings({ colorJitter: Math.round(value) })
            }
            aria-label="Color Jitter"
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
            onChange={(checked) => setShapeMode(checked)}
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
              console.log('[Pressure Toggle Debug]', {
                previousState: activeSettings.pressureEnabled,
                newState: checked,
                minPressure: activeSettings.minPressure,
                maxPressure: activeSettings.maxPressure
              });
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
                  console.log('[Min Pressure Input Debug]', {
                    oldValue: activeSettings.minPressure,
                    newValue: newMin,
                    pressureEnabled: activeSettings.pressureEnabled
                  });
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
                  console.log('[Max Pressure Input Debug]', {
                    oldValue: activeSettings.maxPressure,
                    newValue: value,
                    pressureEnabled: activeSettings.pressureEnabled
                  });
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

      {/* Rotation */}
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
