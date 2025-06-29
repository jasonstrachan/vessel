'use client';

import { useState, useRef, useEffect } from 'react';

interface ColorPickerPopoverProps {
  color: string;
  onChange: (color: string) => void;
}

export const ColorPickerPopover = ({ color, onChange }: ColorPickerPopoverProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const presetColors = [
    '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF',
    '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080',
    '#FFC0CB', '#A52A2A', '#808080', '#90EE90', '#FFB6C1',
    '#87CEEB', '#DDA0DD', '#98FB98', '#F0E68C', '#D2691E'
  ];

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current && 
        !popoverRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative">
      {/* Color Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="w-6 h-6 rounded border border-gray-500 hover:border-gray-400 transition-colors shadow-sm"
        style={{ backgroundColor: color }}
        title={`Current color: ${color}`}
      />

      {/* Popover */}
      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-8 z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-lg p-3 w-64"
        >
          {/* Color Input */}
          <div className="mb-3">
            <input
              type="color"
              value={color}
              onChange={(e) => onChange(e.target.value)}
              className="w-full h-8 rounded cursor-pointer"
            />
          </div>

          {/* Hex Input */}
          <div className="mb-3">
            <input
              type="text"
              value={color}
              onChange={(e) => onChange(e.target.value)}
              className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
              placeholder="#000000"
            />
          </div>

          {/* Preset Colors */}
          <div className="mb-3">
            <div className="text-xs text-gray-300 mb-2">Presets</div>
            <div className="grid grid-cols-8 gap-1">
              {presetColors.map((presetColor) => (
                <button
                  key={presetColor}
                  onClick={() => onChange(presetColor)}
                  className="w-6 h-6 rounded border border-gray-500 hover:border-gray-300 transition-colors"
                  style={{ backgroundColor: presetColor }}
                  title={presetColor}
                />
              ))}
            </div>
          </div>

          {/* Close Button */}
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