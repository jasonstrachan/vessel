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
  const { tools, setBrushSettings } = useAppStore();
  const { brushSettings } = tools;

  // Handle double-click to reset brush size to 100%
  const handleBrushSizeDoubleClick = React.useCallback(() => {
    setBrushSettings({ size: 100 });
  }, [setBrushSettings]);

  return (
    <div className="p-4 bg-[#31313A]">

      {/* Color */}
      <div className="mb-3">
        <label className="block text-base text-[#D9D9D9] mb-2">Color</label>
        <div className="flex items-start gap-2" suppressHydrationWarning>
          <ColorPicker
            color={brushSettings.color}
            onChange={(color) => setBrushSettings({ color })}
          />
          <Input
            type="text"
            variant="hex"
            value={brushSettings.color}
            onChange={(e) => setBrushSettings({ color: e.target.value })}
            className="w-22"
            placeholder="#000000"
            onFocus={(e) => e.target.select()}
          />
        </div>
      </div>


      {/* Brush Size - Unified percentage-based slider for all brushes */}
      <div className="mb-3">
        <label className="block text-base text-[#D9D9D9] mb-2">
          Size: {brushSettings.size}{brushSettings.brushShape !== BrushShape.CUSTOM ? 'px' : ''}
        </label>
        <div onDoubleClick={handleBrushSizeDoubleClick}>
          <Slider
            value={[brushSettings.size]}
            min={1}
            max={500}
            step={1}
            onValueChange={(value) => setBrushSettings({ size: value[0] })}
            aria-label="Brush Size"
          />
        </div>
      </div>

      {/* Opacity */}
      <div className="mb-3">
        <label className="block text-base text-[#D9D9D9] mb-2">
          Opacity: {Math.round(brushSettings.opacity * 100)}%
        </label>
        <Slider
          value={[brushSettings.opacity]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(value) => setBrushSettings({ opacity: value[0] })}
          aria-label="Opacity"
        />
      </div>

      {/* Spacing */}
      <div className="mb-3">
        <label className="block text-base text-[#D9D9D9] mb-2">
          Spacing: {brushSettings.spacing}px
        </label>
        <Slider
          value={[brushSettings.spacing]}
          min={1}
          max={400}
          step={1}
          onValueChange={(value) => setBrushSettings({ spacing: value[0] })}
          aria-label="Spacing"
        />
      </div>

      {/* Pressure */}
      <div className="mb-3">
        <div className="flex items-center space-x-2 mb-2">
          <Switch
            id="pressure-enabled"
            checked={brushSettings.pressureEnabled || false}
            onChange={(checked) => setBrushSettings({ pressureEnabled: checked })}
          />
          <label htmlFor="pressure-enabled" className="text-base text-[#D9D9D9]">
            Pressure
          </label>
        </div>
        
        {(brushSettings.pressureEnabled || false) && (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              variant="compact"
              value={brushSettings.minPressure || 1}
              onChange={(e) => setBrushSettings({ minPressure: parseInt(e.target.value) || 1 })}
              min="1"
              max="1000"
              className="w-16"
            />
            <span className="text-base text-[#D9D9D9]">-</span>
            <Input
              type="number"
              variant="compact"
              value={brushSettings.maxPressure || brushSettings.size}
              onChange={(e) => setBrushSettings({ maxPressure: parseInt(e.target.value) || brushSettings.size })}
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
            checked={brushSettings.rotationEnabled || false}
            onChange={(checked) => setBrushSettings({ rotationEnabled: checked })}
          />
          <label htmlFor="rotation-enabled" className="text-base text-[#D9D9D9]">
            Rotation
          </label>
        </div>
      </div>

      {/* Dashed */}
      <div className="mb-3">
        <div className="flex items-center space-x-2 mb-2">
          <Switch
            id="dashed-enabled"
            checked={brushSettings.dashedEnabled || false}
            onChange={(checked) => setBrushSettings({ dashedEnabled: checked })}
          />
          <label htmlFor="dashed-enabled" className="text-base text-[#D9D9D9]">
            Dashed
          </label>
        </div>
        
        {(brushSettings.dashedEnabled || false) && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-base text-[#D9D9D9] w-12" title="Dash length as multiple of brush size">Length</label>
              <Input
                type="number"
                variant="compact"
                value={brushSettings.dashLength || 3}
                onChange={(e) => setBrushSettings({ dashLength: parseInt(e.target.value) || 3 })}
                min="1"
                max="20"
                className="w-16"
                title="Length multiplier (×brush size)"
              />
              <span className="text-base text-[#D9D9D9]">×</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-base text-[#D9D9D9] w-12" title="Gap length as multiple of brush size">Gap</label>
              <Input
                type="number"
                variant="compact"
                value={brushSettings.dashGap || 2}
                onChange={(e) => setBrushSettings({ dashGap: parseInt(e.target.value) || 2 })}
                min="1"
                max="20"
                className="w-16"
                title="Gap multiplier (×brush size)"
              />
              <span className="text-base text-[#D9D9D9]">×</span>
            </div>
          </div>
        )}
      </div>

      {/* Grid Snap */}
      <div className="mb-3">
        <div className="flex items-center space-x-2">
          <Switch
            id="grid-snap-enabled"
            checked={brushSettings.gridSnapEnabled || false}
            onChange={(checked) => setBrushSettings({ gridSnapEnabled: checked })}
          />
          <label htmlFor="grid-snap-enabled" className="text-base text-[#D9D9D9]">
            Grid Snap
          </label>
        </div>
      </div>

    </div>
  );
}