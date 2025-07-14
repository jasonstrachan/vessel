'use client';

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';

export default function FillControls() {
  const { tools, setFillSettings, setBrushSettings } = useAppStore();
  const { fillSettings, brushSettings } = tools;

  return (
    <div className="p-4 bg-[#31313A]">
      
      {/* Fill Color */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">Fill Color</label>
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

      {/* Threshold */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">
          Threshold: {fillSettings.threshold}
        </label>
        <input
          type="range"
          min="0"
          max="255"
          step="1"
          value={fillSettings.threshold}
          onChange={(e) => setFillSettings({ threshold: Math.min(255, Math.max(0, parseInt(e.target.value))) })}
          className="w-full h-2 bg-[#404040] rounded-lg appearance-none cursor-pointer slider"
        />
      </div>

      {/* Connected Pixels */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">Connected Pixels</label>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={fillSettings.contiguous}
            onChange={(e) => setFillSettings({ contiguous: e.target.checked })}
            className="w-4 h-4 rounded border border-[#404040] cursor-pointer"
          />
          <span className="text-xs text-gray-300">
            {fillSettings.contiguous ? 'On' : 'Off'}
          </span>
        </div>
      </div>

    </div>
  );
}