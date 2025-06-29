'use client';

import { useState } from 'react';

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

export const ColorPicker = ({ color, onChange }: ColorPickerProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const presetColors = [
    '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF',
    '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080',
    '#FFC0CB', '#A52A2A', '#808080', '#90EE90', '#FFB6C1',
    '#87CEEB', '#DDA0DD', '#98FB98', '#F0E68C', '#D2691E'
  ];

  return (
    <div className="space-y-2">
      {/* Current Color Display */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-12 h-12 rounded-lg border-2 border-gray-600 shadow-inner"
          style={{ backgroundColor: color }}
          title="Click to open color picker"
        />
        <input
          type="text"
          value={color}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
          placeholder="#000000"
        />
      </div>

      {/* Color Picker Panel */}
      {isOpen && (
        <div className="bg-gray-700 border border-gray-600 rounded-lg p-3 space-y-3">
          {/* HTML5 Color Input */}
          <input
            type="color"
            value={color}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-8 rounded cursor-pointer"
          />

          {/* Preset Colors */}
          <div className="grid grid-cols-5 gap-1">
            {presetColors.map((presetColor) => (
              <button
                key={presetColor}
                onClick={() => onChange(presetColor)}
                className="w-8 h-8 rounded border border-gray-500 hover:border-white transition-colors"
                style={{ backgroundColor: presetColor }}
                title={presetColor}
              />
            ))}
          </div>

          {/* HSV Sliders (simplified version) */}
          <div className="space-y-2">
            <label className="text-xs text-gray-300">Opacity</label>
            <input
              type="range"
              min="0"
              max="100"
              defaultValue="100"
              className="w-full"
              onChange={(e) => {
                // Convert hex to rgba with opacity
                const hex = color.replace('#', '');
                const r = parseInt(hex.substr(0, 2), 16);
                const g = parseInt(hex.substr(2, 2), 16);
                const b = parseInt(hex.substr(4, 2), 16);
                const opacity = parseInt(e.target.value) / 100;
                onChange(`rgba(${r}, ${g}, ${b}, ${opacity})`);
              }}
            />
          </div>

          <button
            onClick={() => setIsOpen(false)}
            className="w-full py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded transition-colors"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};