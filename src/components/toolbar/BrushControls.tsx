'use client';

// Simple brush controls for proof of concept
// Based on /docs/03_Features/Drawing_Tools.md (lines 8-48)

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { BrushShape } from '../../types';

export default function BrushControls() {
  const { tools, setBrushSettings } = useAppStore();
  const { brushSettings } = tools;
  
  // Check if currently using a custom brush
  const isCustomBrush = brushSettings.brushShape === BrushShape.CUSTOM;

  return (
    <div className="p-4 bg-[#31313A]">
      

      {/* Brush Size - Different behavior for custom vs regular brushes */}
      <div className="mb-4">
        {isCustomBrush ? (
          // Custom brush: percentage-based slider
          <>
            <label className="block text-xs text-gray-400 mb-2">
              Scale: {brushSettings.size}% 
              <span className="text-xs text-gray-500 ml-1">(of original size)</span>
            </label>
            <input
              type="range"
              min="10"
              max="500"
              step="5"
              value={brushSettings.size}
              onChange={(e) => setBrushSettings({ size: parseInt(e.target.value) })}
              className="w-full h-2 bg-[#404040] rounded-lg appearance-none cursor-pointer slider"
            />
          </>
        ) : (
          // Regular brush: pixel-based slider
          <>
            <label className="block text-xs text-gray-400 mb-2">
              Size: {brushSettings.size}px
            </label>
            <input
              type="range"
              min="1"
              max="100"
              value={brushSettings.size}
              onChange={(e) => setBrushSettings({ size: parseInt(e.target.value) })}
              className="w-full h-2 bg-[#404040] rounded-lg appearance-none cursor-pointer slider"
            />
          </>
        )}
      </div>

      {/* Opacity */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">
          Opacity: {Math.round(brushSettings.opacity * 100)}%
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={brushSettings.opacity}
          onChange={(e) => setBrushSettings({ opacity: parseFloat(e.target.value) })}
          className="w-full h-2 bg-[#404040] rounded-lg appearance-none cursor-pointer slider"
        />
      </div>

      {/* Color */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">Color</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={brushSettings.color}
            onChange={(e) => setBrushSettings({ color: e.target.value })}
            className="w-8 h-8 rounded border border-[#404040] cursor-pointer"
          />
          <input
            type="text"
            value={brushSettings.color}
            onChange={(e) => setBrushSettings({ color: e.target.value })}
            className="flex-1 px-2 py-1 text-xs bg-[#404040] border border-[#555] rounded text-white"
            placeholder="#000000"
          />
        </div>
      </div>

      {/* Spacing */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">
          Spacing: {brushSettings.spacing}px
        </label>
        <input
          type="range"
          min="1"
          max="400"
          step="1"
          value={brushSettings.spacing}
          onChange={(e) => setBrushSettings({ spacing: parseInt(e.target.value) })}
          className="w-full h-2 bg-[#404040] rounded-lg appearance-none cursor-pointer slider"
        />
      </div>

    </div>
  );
}