'use client';

// Simple brush controls for proof of concept
// Based on /docs/03_Features/Drawing_Tools.md (lines 8-48)

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';

export default function BrushControls() {
  const { tools, setBrushSettings } = useAppStore();
  const { brushSettings } = tools;

  return (
    <div className="p-4 bg-[#353535] rounded border border-[#404040]">
      

      {/* Brush Size */}
      <div className="mb-4">
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
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>1</span>
          <span>100</span>
        </div>
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
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>0%</span>
          <span>100%</span>
        </div>
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
          max="20"
          step="1"
          value={brushSettings.spacing}
          onChange={(e) => setBrushSettings({ spacing: parseInt(e.target.value) })}
          className="w-full h-2 bg-[#404040] rounded-lg appearance-none cursor-pointer slider"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>1px</span>
          <span>20px</span>
        </div>
      </div>

    </div>
  );
}