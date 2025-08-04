'use client';

// Simple brush controls for proof of concept
// Based on /docs/03_Features/Drawing_Tools.md (lines 8-48)

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { BrushShape } from '../../types';
import Input from '../ui/Input';
import CustomSwitch from '../ui/CustomSwitch';
import ProgressSlider from '../ui/ProgressSlider';
const BrushControls = () => {
  const { tools, setBrushSettings, setEraserSettings, globalBrushSize, setGlobalBrushSize } = useAppStore();
  const { brushSettings, eraserSettings, currentTool } = tools;
  
  
  // Use the appropriate settings and setter based on current tool
  const activeSettings = currentTool === 'eraser' ? eraserSettings : brushSettings;
  const setActiveSettings = currentTool === 'eraser' ? setEraserSettings : setBrushSettings;

  // Handle double-click to reset brush size to 100%
  const handleBrushSizeDoubleClick = React.useCallback(() => {
    setGlobalBrushSize(100);
  }, [setGlobalBrushSize]);

  // Show Colors and Film Grain sliders for gradient brushes
  if (activeSettings.brushShape === BrushShape.RECTANGLE_GRADIENT || 
      activeSettings.brushShape === BrushShape.POLYGON_GRADIENT) {
    return (
      <div className="p-4">
        {/* Colors */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
              Colors
            </label>
            <ProgressSlider
              value={activeSettings.colors || 2}
              min={1}
              max={10}
              step={1}
              onChange={(value) => setActiveSettings({ colors: Math.round(value) })}
              aria-label="Gradient Colors"
              className="flex-1"
            />
          </div>
        </div>
        
        {/* Riso */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
              Riso
            </label>
            <ProgressSlider
              value={activeSettings.risographIntensity || 0}
              min={0}
              max={100}
              step={1}
              onChange={(value) => setActiveSettings({ risographIntensity: Math.round(value) })}
              aria-label="Risograph Intensity"
              className="flex-1"
            />
          </div>
        </div>

        {/* Dither */}
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <label htmlFor="dither-enabled" className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
              Dither
            </label>
            <CustomSwitch
              id="dither-enabled"
              checked={activeSettings.ditherEnabled || false}
              onChange={(checked) => setActiveSettings({ ditherEnabled: checked })}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">


      {/* Size */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
            Size
          </label>
          <ProgressSlider
            value={globalBrushSize}
            min={1}
            max={500}
            step={1}
            onChange={(value) => setGlobalBrushSize(Math.max(1, value))}
            aria-label="Brush Size"
            className="flex-1"
          />
        </div>
      </div>

      {/* Opacity */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
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
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
            Spacing
          </label>
          <ProgressSlider
            value={activeSettings.spacing}
            min={1}
            max={400}
            step={1}
            onChange={(value) => setActiveSettings({ spacing: Math.max(1, Math.round(value)) })}
            aria-label="Spacing"
            className="flex-1"
          />
        </div>
      </div>

      {/* Col Jit */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
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

      {/* Riso */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
            Riso
          </label>
          <ProgressSlider
            value={activeSettings.risographIntensity || 0}
            min={0}
            max={100}
            step={1}
            onChange={(value) => setActiveSettings({ risographIntensity: Math.round(value) })}
            aria-label="Risograph Intensity"
            className="flex-1"
          />
        </div>
      </div>

      {/* Shape */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label htmlFor="shape-enabled" className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
            Shape
          </label>
          <CustomSwitch
            id="shape-enabled"
            checked={activeSettings.shapeEnabled || false}
            onChange={(checked) => setActiveSettings({ shapeEnabled: checked })}
          />
        </div>
      </div>

      {/* Pressure */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label htmlFor="pressure-enabled" className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
            Pressure
          </label>
          <CustomSwitch
            id="pressure-enabled"
            checked={activeSettings.pressureEnabled || false}
            onChange={(checked) => setActiveSettings({ pressureEnabled: checked })}
          />
        </div>
        
        {(activeSettings.pressureEnabled || false) && (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              variant="compact"
              value={activeSettings.minPressure || 1}
              onChange={(e) => setActiveSettings({ minPressure: parseInt(e.target.value) || 1 })}
              min="1"
              max="1000"
              className="w-16"
            />
            <span className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>-</span>
            <Input
              type="number"
              variant="compact"
              value={activeSettings.maxPressure ?? (activeSettings.brushShape === BrushShape.CUSTOM ? 100 : '')}
              onChange={(e) => {
                const value = parseInt(e.target.value);
                setActiveSettings({ maxPressure: value || undefined });
              }}
              min="1"
              max="1000"
              className="w-16"
            />
          </div>
        )}
      </div>

      {/* Rotation */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label htmlFor="rotation-enabled" className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
            Rotation
          </label>
          <CustomSwitch
            id="rotation-enabled"
            checked={activeSettings.rotationEnabled || false}
            onChange={(checked) => setActiveSettings({ rotationEnabled: checked })}
          />
        </div>
      </div>

      {/* Dashed */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label htmlFor="dashed-enabled" className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
            Dashed
          </label>
          <CustomSwitch
            id="dashed-enabled"
            checked={activeSettings.dashedEnabled || false}
            onChange={(checked) => setActiveSettings({ dashedEnabled: checked })}
          />
        </div>
        
        {(activeSettings.dashedEnabled || false) && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-[#D9D9D9] w-12" style={{ fontSize: '14px' }} title="Dash length as multiple of brush size">Length</label>
              <Input
                type="number"
                variant="compact"
                value={activeSettings.dashLength || 3}
                onChange={(e) => setActiveSettings({ dashLength: parseInt(e.target.value) || 3 })}
                min="1"
                max="20"
                className="w-16"
                title="Length multiplier (×brush size)"
              />
              <span className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>×</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[#D9D9D9] w-12" style={{ fontSize: '14px' }} title="Gap length as multiple of brush size">Gap</label>
              <Input
                type="number"
                variant="compact"
                value={activeSettings.dashGap || 2}
                onChange={(e) => setActiveSettings({ dashGap: parseInt(e.target.value) || 2 })}
                min="1"
                max="20"
                className="w-16"
                title="Gap multiplier (×brush size)"
              />
              <span className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>×</span>
            </div>
          </div>
        )}
      </div>

      {/* Grid Snap */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label htmlFor="grid-snap-enabled" className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
            Grid Snap
          </label>
          <CustomSwitch
            id="grid-snap-enabled"
            checked={activeSettings.gridSnapEnabled || false}
            onChange={(checked) => setActiveSettings({ gridSnapEnabled: checked })}
          />
        </div>
      </div>
    </div>
  );
};

export default React.memo(BrushControls);