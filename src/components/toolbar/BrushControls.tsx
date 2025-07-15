'use client';

// Simple brush controls for proof of concept
// Based on /docs/03_Features/Drawing_Tools.md (lines 8-48)

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { BrushShape } from '../../types';
import ColorPicker from './ColorPicker';
import Input from '../ui/Input';

export default function BrushControls() {
  const { tools, setBrushSettings } = useAppStore();
  const { brushSettings } = tools;
  
  // Check if currently using a custom brush
  const isCustomBrush = brushSettings.brushShape === BrushShape.CUSTOM;

  return (
    <div className="p-4 bg-[#31313A]">
      

      {/* Color */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">Color</label>
        <div className="flex items-center gap-2">
          <ColorPicker
            color={brushSettings.color}
            onChange={(color) => setBrushSettings({ color })}
          />
          <Input
            type="text"
            variant="hex"
            value={brushSettings.color}
            onChange={(e) => setBrushSettings({ color: e.target.value })}
            className="flex-1"
            placeholder="#000000"
          />
        </div>
      </div>

      {/* Brush Size - Different behavior for custom vs regular brushes */}
      <div className="mb-4">
        {isCustomBrush ? (
          // Custom brush: percentage-based slider
          <>
            <label className="block text-xs text-gray-400 mb-2">
              Scale: {brushSettings.size}% 
              <span className="text-xs text-gray-500 ml-1">(of original size)</span>
            </label>
            <Input
              type="range"
              min="10"
              max="500"
              step="5"
              value={brushSettings.size}
              onChange={(e) => setBrushSettings({ size: parseInt(e.target.value) })}
              fullWidth
            />
          </>
        ) : (
          // Regular brush: pixel-based slider
          <>
            <label className="block text-xs text-gray-400 mb-2">
              Size: {brushSettings.size}px
            </label>
            <Input
              type="range"
              min="1"
              max="100"
              value={brushSettings.size}
              onChange={(e) => setBrushSettings({ size: parseInt(e.target.value) })}
              fullWidth
            />
          </>
        )}
      </div>

      {/* Opacity */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">
          Opacity: {Math.round(brushSettings.opacity * 100)}%
        </label>
        <Input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={brushSettings.opacity}
          onChange={(e) => setBrushSettings({ opacity: parseFloat(e.target.value) })}
          fullWidth
        />
      </div>

      {/* Spacing */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">
          Spacing: {brushSettings.spacing}px
        </label>
        <Input
          type="range"
          min="1"
          max="400"
          step="1"
          value={brushSettings.spacing}
          onChange={(e) => setBrushSettings({ spacing: parseInt(e.target.value) })}
          fullWidth
        />
      </div>

      {/* Pressure */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Input
            type="checkbox"
            id="pressure-enabled"
            checked={brushSettings.pressureEnabled || false}
            onChange={(e) => setBrushSettings({ pressureEnabled: e.target.checked })}
            className="w-3 h-3"
          />
          <label htmlFor="pressure-enabled" className="text-xs text-gray-400">
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
            <span className="text-xs text-gray-400">-</span>
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
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Input
            type="checkbox"
            id="rotation-enabled"
            checked={brushSettings.rotationEnabled || false}
            onChange={(e) => setBrushSettings({ rotationEnabled: e.target.checked })}
            className="w-3 h-3"
          />
          <label htmlFor="rotation-enabled" className="text-xs text-gray-400">
            Rotation
          </label>
        </div>
      </div>

      {/* Dashed */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Input
            type="checkbox"
            id="dashed-enabled"
            checked={brushSettings.dashedEnabled || false}
            onChange={(e) => setBrushSettings({ dashedEnabled: e.target.checked })}
            className="w-3 h-3"
          />
          <label htmlFor="dashed-enabled" className="text-xs text-gray-400">
            Dashed
          </label>
        </div>
        
        {(brushSettings.dashedEnabled || false) && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400 w-12" title="Dash length as multiple of brush size">Length</label>
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
              <span className="text-xs text-gray-500">×</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400 w-12" title="Gap length as multiple of brush size">Gap</label>
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
              <span className="text-xs text-gray-500">×</span>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}