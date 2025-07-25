'use client';

// Simple brush controls for proof of concept
// Based on /docs/03_Features/Drawing_Tools.md (lines 8-48)

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { BrushShape } from '../../types';
import ColorPicker from './ColorPicker';
import Input from '../ui/Input';
import { Switch } from '../retroui/Switch';
import { Slider } from '../retroui/Slider';
export default function BrushControls() {
  const { tools, setBrushSettings, setEraserSettings } = useAppStore();
  const { brushSettings, eraserSettings, currentTool } = tools;
  
  // Use the appropriate settings and setter based on current tool
  const activeSettings = currentTool === 'eraser' ? eraserSettings : brushSettings;
  const setActiveSettings = currentTool === 'eraser' ? setEraserSettings : setBrushSettings;

  // Handle double-click to reset brush size to 100%
  const handleBrushSizeDoubleClick = React.useCallback(() => {
    setActiveSettings({ size: 100 });
  }, [setActiveSettings]);

  return (
    <div className="bg-[#31313A] p-4">
        {/* Color */}
        <div className="mb-3">
          <label className="block text-[#D9D9D9] mb-2" style={{ fontSize: '14px' }}>Color</label>
          <div className="flex items-start gap-2" suppressHydrationWarning>
            <ColorPicker
              color={activeSettings.color}
              onChange={(color) => setActiveSettings({ color })}
            />
            <Input
              type="text"
              variant="hex"
              value={activeSettings.color}
              onChange={(e) => setActiveSettings({ color: e.target.value })}
              className="w-22"
              placeholder="#000000"
              onFocus={(e) => e.target.select()}
            />
          </div>
        </div>


      {/* Brush Size - Unified percentage-based slider for all brushes */}
      <div className="mb-3">
        <label className="block text-[#D9D9D9] mb-2" style={{ fontSize: '14px' }}>
          Size: {activeSettings.size}{activeSettings.brushShape !== BrushShape.CUSTOM ? 'px' : ''}
        </label>
        <div onDoubleClick={handleBrushSizeDoubleClick}>
          <Slider
            value={[activeSettings.size]}
            min={1}
            max={500}
            step={1}
            onValueChange={(value) => setActiveSettings({ size: value[0] })}
            aria-label="Brush Size"
          />
        </div>
      </div>

      {/* Opacity */}
      <div className="mb-3">
        <label className="block text-[#D9D9D9] mb-2" style={{ fontSize: '14px' }}>
          Opacity: {Math.round(activeSettings.opacity * 100)}%
        </label>
        <Slider
          value={[activeSettings.opacity]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(value) => setActiveSettings({ opacity: value[0] })}
          aria-label="Opacity"
        />
      </div>

      {/* Spacing */}
      <div className="mb-3">
        <label className="block text-[#D9D9D9] mb-2" style={{ fontSize: '14px' }}>
          Spacing: {activeSettings.spacing}px
        </label>
        <Slider
          value={[activeSettings.spacing]}
          min={1}
          max={400}
          step={1}
          onValueChange={(value) => setActiveSettings({ spacing: value[0] })}
          aria-label="Spacing"
        />
      </div>

      {/* Pressure */}
      <div className="mb-3">
        <div className="flex items-center space-x-2 mb-2">
          <Switch
            id="pressure-enabled"
            checked={activeSettings.pressureEnabled || false}
            onChange={(checked) => setActiveSettings({ pressureEnabled: checked })}
          />
          <label htmlFor="pressure-enabled" className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>
            Pressure
          </label>
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
              value={activeSettings.maxPressure || activeSettings.size}
              onChange={(e) => setActiveSettings({ maxPressure: parseInt(e.target.value) || activeSettings.size })}
              min="1"
              max="1000"
              className="w-16"
            />
          </div>
        )}
      </div>

      {/* Rotation */}
      <div className="mb-3">
        <div className="flex items-center space-x-2">
          <Switch
            id="rotation-enabled"
            checked={activeSettings.rotationEnabled || false}
            onChange={(checked) => setActiveSettings({ rotationEnabled: checked })}
          />
          <label htmlFor="rotation-enabled" className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>
            Rotation
          </label>
        </div>
      </div>

      {/* Dashed */}
      <div className="mb-3">
        <div className="flex items-center space-x-2 mb-2">
          <Switch
            id="dashed-enabled"
            checked={activeSettings.dashedEnabled || false}
            onChange={(checked) => setActiveSettings({ dashedEnabled: checked })}
          />
          <label htmlFor="dashed-enabled" className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>
            Dashed
          </label>
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
      <div className="mb-3">
        <div className="flex items-center space-x-2">
          <Switch
            id="grid-snap-enabled"
            checked={activeSettings.gridSnapEnabled || false}
            onChange={(checked) => setActiveSettings({ gridSnapEnabled: checked })}
          />
          <label htmlFor="grid-snap-enabled" className="text-[#D9D9D9]" style={{ fontSize: '14px' }}>
            Grid Snap
          </label>
        </div>
      </div>
    </div>
  );
}