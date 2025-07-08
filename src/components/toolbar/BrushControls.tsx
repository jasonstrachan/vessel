'use client';

// Simple brush controls for proof of concept
// Based on /docs/03_Features/Drawing_Tools.md (lines 8-48)

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';

export default function BrushControls() {
  const { tools, canvas, setBrushSettings, setCurrentTool, setDisplayMode } = useAppStore();
  const { brushSettings, currentTool } = tools;

  return (
    <div className="p-4 bg-[#2d2d2d] border-b border-[#404040]">
      <h3 className="text-sm font-medium mb-3">Brush Tool</h3>
      
      {/* Tool Selection */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">Tool</label>
        <div className="flex gap-2">
          <button
            onClick={() => setCurrentTool('brush')}
            className={`px-3 py-1 text-xs rounded ${
              currentTool === 'brush' 
                ? 'bg-blue-600 text-white' 
                : 'bg-[#404040] text-gray-300 hover:bg-[#555]'
            }`}
          >
            Brush
          </button>
          <button
            onClick={() => setCurrentTool('eraser')}
            className={`px-3 py-1 text-xs rounded ${
              currentTool === 'eraser' 
                ? 'bg-blue-600 text-white' 
                : 'bg-[#404040] text-gray-300 hover:bg-[#555]'
            }`}
          >
            Eraser
          </button>
        </div>
      </div>

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

      {/* Antialiasing Toggle */}
      <div className="mb-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={brushSettings.antialiasing}
            onChange={(e) => setBrushSettings({ antialiasing: e.target.checked })}
            className="w-4 h-4 rounded border border-[#404040] bg-[#404040] text-blue-600 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-300">Antialiasing</span>
        </label>
        <p className="text-xs text-gray-500 mt-1">
          Uncheck for pixel-perfect drawing
        </p>
      </div>

      {/* Canvas Display Mode */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">Canvas Display</label>
        <div className="flex gap-2">
          <button
            onClick={() => setDisplayMode('pixelated')}
            className={`flex-1 px-2 py-1 text-xs rounded ${
              canvas.displayMode === 'pixelated'
                ? 'bg-blue-600 text-white'
                : 'bg-[#404040] text-gray-300 hover:bg-[#555]'
            }`}
          >
            Pixelated
          </button>
          <button
            onClick={() => setDisplayMode('smooth')}
            className={`flex-1 px-2 py-1 text-xs rounded ${
              canvas.displayMode === 'smooth'
                ? 'bg-blue-600 text-white'
                : 'bg-[#404040] text-gray-300 hover:bg-[#555]'
            }`}
          >
            Smooth
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Controls how all canvas content is displayed
        </p>
      </div>

      {/* Spacing */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">
          Spacing: {Math.round(brushSettings.spacing * 100)}%
        </label>
        <input
          type="range"
          min="0.1"
          max="2"
          step="0.05"
          value={brushSettings.spacing}
          onChange={(e) => setBrushSettings({ spacing: parseFloat(e.target.value) })}
          className="w-full h-2 bg-[#404040] rounded-lg appearance-none cursor-pointer slider"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>10%</span>
          <span>200%</span>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="pt-3 border-t border-[#404040]">
        <div className="flex gap-2">
          <button
            onClick={() => setBrushSettings({ size: 1, opacity: 1, antialiasing: false })}
            className="flex-1 px-2 py-1 text-xs bg-[#404040] text-gray-300 rounded hover:bg-[#555]"
          >
            Pixel Art
          </button>
          <button
            onClick={() => setBrushSettings({ size: 20, opacity: 0.8, antialiasing: true })}
            className="flex-1 px-2 py-1 text-xs bg-[#404040] text-gray-300 rounded hover:bg-[#555]"
          >
            Digital Paint
          </button>
        </div>
      </div>

      {/* Keyboard Shortcuts */}
      <div className="mt-4 pt-3 border-t border-[#404040]">
        <p className="text-xs text-gray-500 mb-2">Shortcuts:</p>
        <div className="text-xs text-gray-400 space-y-1">
          <div>[ / ] - Decrease/Increase brush size</div>
          <div>Mouse wheel - Zoom in/out</div>
          <div>Space - Pan (hold)</div>
        </div>
      </div>
    </div>
  );
}