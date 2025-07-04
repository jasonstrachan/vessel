'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

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
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const h = (x / rect.width) * 360;
    
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

  // Color palette matching the screenshot
  const presetColors = [
    // Row 1: Basic colors
    '#FF0000', '#FF1493', '#8B00FF', '#0000FF', '#0080FF', '#00FFFF', '#00FF80', '#00FF00',
    '#80FF00', '#FFFF00', '#FFA500', '#FF4500', '#8B4513', '#404040', '#808080', '#C0C0C0'
  ];

  return (
    <div className="relative">
      {/* Current Color Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="w-8 h-8 rounded border border-[#404040] hover:border-[#888888] transition-all"
        style={{ backgroundColor: color }}
        title={`Current color: ${color}`}
      />

      {/* Popover */}
      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-300 rounded shadow-lg p-3 w-72"
        >
          <div className="space-y-3">
            {/* HSV Color Picker Area */}
            <div className="space-y-2">
              {/* Saturation/Brightness Picker */}
              <div 
                ref={saturationRef}
                className="relative w-full h-32 cursor-crosshair rounded"
                style={{
                  background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`
                }}
                onMouseDown={handleSaturationMouseDown}
              >
                {/* Saturation/Brightness Indicator */}
                <div
                  className="absolute w-3 h-3 border-2 border-white rounded-full transform -translate-x-1.5 -translate-y-1.5 shadow-sm"
                  style={{
                    left: `${(hsv.s / 100) * 100}%`,
                    top: `${100 - (hsv.v / 100) * 100}%`
                  }}
                />
              </div>

              {/* Hue Slider */}
              <div className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-full border border-gray-300 flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <div 
                  ref={hueRef}
                  className="relative flex-1 h-4 cursor-pointer rounded"
                  style={{
                    background: 'linear-gradient(to right, #ff0000, #ff8000, #ffff00, #80ff00, #00ff00, #00ff80, #00ffff, #0080ff, #0000ff, #8000ff, #ff00ff, #ff0080, #ff0000)'
                  }}
                  onMouseDown={handleHueMouseDown}
                >
                  {/* Hue Indicator */}
                  <div
                    className="absolute w-3 h-3 border-2 border-white rounded-full transform -translate-x-1.5 -translate-y-0.5 shadow-sm"
                    style={{
                      left: `${(hsv.h / 360) * 100}%`,
                      top: '50%'
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Hex Input */}
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-xs font-medium">HEX</span>
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
                className="flex-1 px-2 py-1 bg-gray-100 text-gray-800 text-xs font-mono rounded border border-gray-300"
                placeholder="#000000"
              />
            </div>

            {/* Color Palette */}
            <div className="grid grid-cols-8 gap-1">
              {presetColors.map((presetColor) => (
                <button
                  key={presetColor}
                  onClick={() => {
                    onChange(presetColor);
                    addToRecentColors(presetColor);
                    setIsOpen(false);
                  }}
                  className={`w-6 h-6 rounded border-2 transition-all ${
                    color === presetColor ? 'border-gray-800' : 'border-gray-300 hover:border-gray-500'
                  }`}
                  style={{ backgroundColor: presetColor }}
                  title={presetColor}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};