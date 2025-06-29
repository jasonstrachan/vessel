'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '@/stores/useAppStore';

interface HSVColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

interface HSV {
  h: number; // 0-360
  s: number; // 0-100
  v: number; // 0-100
}

export const HSVColorPicker = ({ color, onChange }: HSVColorPickerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hsv, setHsv] = useState<HSV>({ h: 0, s: 100, v: 100 });
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const saturationRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef<{ saturation?: boolean; hue?: boolean }>({});

  // Convert hex to HSV
  const hexToHsv = useCallback((hex: string): HSV => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;

    let h = 0;
    if (diff !== 0) {
      if (max === r) h = ((g - b) / diff + 6) % 6;
      else if (max === g) h = (b - r) / diff + 2;
      else h = (r - g) / diff + 4;
    }
    h = Math.round(h * 60);

    const s = max === 0 ? 0 : Math.round((diff / max) * 100);
    const v = Math.round(max * 100);

    return { h, s, v };
  }, []);

  // Convert HSV to hex
  const hsvToHex = useCallback((hsv: HSV): string => {
    const { h, s, v } = hsv;
    const c = (v / 100) * (s / 100);
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v / 100 - c;

    let r = 0, g = 0, b = 0;
    if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
    else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
    else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
    else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
    else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
    else if (h >= 300 && h < 360) { r = c; g = 0; b = x; }

    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }, []);

  // Load recent colors from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('tinybrush-recent-colors');
    if (saved) {
      setRecentColors(JSON.parse(saved));
    }
  }, []);

  // Update HSV when color prop changes
  useEffect(() => {
    setHsv(hexToHsv(color));
  }, [color, hexToHsv]);

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

  const addToRecentColors = (newColor: string) => {
    const updated = [newColor, ...recentColors.filter(c => c !== newColor)].slice(0, 12);
    setRecentColors(updated);
    localStorage.setItem('tinybrush-recent-colors', JSON.stringify(updated));
  };

  const handleColorChange = (newHsv: HSV) => {
    setHsv(newHsv);
    const hexColor = hsvToHex(newHsv);
    onChange(hexColor);
    addToRecentColors(hexColor);
  };

  const handleSaturationMouseDown = (e: React.MouseEvent) => {
    isDragging.current.saturation = true;
    handleSaturationMouseMove(e);
  };

  const handleSaturationMouseMove = (e: React.MouseEvent | MouseEvent) => {
    if (!isDragging.current.saturation || !saturationRef.current) return;
    
    const rect = saturationRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    
    const s = (x / rect.width) * 100;
    const v = ((rect.height - y) / rect.height) * 100;
    
    handleColorChange({ ...hsv, s, v });
  };

  const handleHueMouseDown = (e: React.MouseEvent) => {
    isDragging.current.hue = true;
    handleHueMouseMove(e);
  };

  const handleHueMouseMove = (e: React.MouseEvent | MouseEvent) => {
    if (!isDragging.current.hue || !hueRef.current) return;
    
    const rect = hueRef.current.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const h = (y / rect.height) * 360;
    
    handleColorChange({ ...hsv, h });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current.saturation) handleSaturationMouseMove(e);
      if (isDragging.current.hue) handleHueMouseMove(e);
    };

    const handleMouseUp = () => {
      isDragging.current = {};
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [hsv]);

  const presetColors = [
    '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF',
    '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080',
    '#FFC0CB', '#A52A2A', '#808080', '#90EE90', '#FFB6C1',
    '#87CEEB', '#DDA0DD', '#98FB98', '#F0E68C', '#D2691E'
  ];

  return (
    <div className="space-y-2">
      {/* Color Swatches */}
      <div className="grid grid-cols-8 gap-1">
        {presetColors.slice(0, 16).map((presetColor) => (
          <button
            key={presetColor}
            onClick={() => {
              onChange(presetColor);
              addToRecentColors(presetColor);
            }}
            className={`w-6 h-6 rounded border-2 transition-all ${
              color === presetColor ? 'border-white' : 'border-[#404040] hover:border-[#888888]'
            }`}
            style={{ backgroundColor: presetColor }}
            title={presetColor}
          />
        ))}
      </div>

      {/* Current Color Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-8 rounded border border-[#404040] hover:border-[#888888] transition-all flex items-center justify-between px-2"
        style={{ backgroundColor: color }}
        title={`Current color: ${color}`}
      >
        <span className="text-white text-xs font-mono bg-black bg-opacity-50 px-1 rounded">
          {color.toUpperCase()}
        </span>
        <span className="text-white text-xs">▼</span>
      </button>

      {/* Popover */}
      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full mt-1 z-50 bg-[#2a2a2a] border border-[#404040] rounded shadow-lg p-3 w-64"
        >
          <div className="space-y-3">
            {/* HSV Color Picker */}
            <div className="flex gap-2">
              {/* Saturation/Value Square */}
              <div
                ref={saturationRef}
                className="w-40 h-40 relative cursor-crosshair border border-[#404040] rounded"
                style={{
                  background: `linear-gradient(to top, black, transparent), linear-gradient(to right, white, hsl(${hsv.h}, 100%, 50%))`
                }}
                onMouseDown={handleSaturationMouseDown}
              >
                {/* Saturation/Value Cursor */}
                <div
                  className="absolute w-2 h-2 border border-white rounded-full pointer-events-none"
                  style={{
                    left: `${(hsv.s / 100) * 100}%`,
                    top: `${100 - (hsv.v / 100) * 100}%`,
                    transform: 'translate(-50%, -50%)',
                    boxShadow: '0 0 0 1px rgba(0,0,0,0.5)'
                  }}
                />
              </div>

              {/* Hue Slider */}
              <div
                ref={hueRef}
                className="w-4 h-40 cursor-pointer border border-[#404040] rounded"
                style={{
                  background: 'linear-gradient(to bottom, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'
                }}
                onMouseDown={handleHueMouseDown}
              >
                {/* Hue Cursor */}
                <div
                  className="absolute w-6 h-0.5 bg-white border border-black pointer-events-none"
                  style={{
                    top: `${(hsv.h / 360) * 100}%`,
                    left: '50%',
                    transform: 'translate(-50%, -50%)'
                  }}
                />
              </div>
            </div>

            {/* Hex Input */}
            <input
              type="text"
              value={color.toUpperCase()}
              onChange={(e) => {
                const hex = e.target.value;
                if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                  onChange(hex);
                  addToRecentColors(hex);
                }
              }}
              className="w-full px-2 py-1 bg-[#1a1a1a] border border-[#404040] rounded text-white text-xs font-mono"
              placeholder="#000000"
            />
          </div>
        </div>
      )}
    </div>
  );
};