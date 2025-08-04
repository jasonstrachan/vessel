import React, { useState, useEffect } from 'react';
import AdvancedColorPicker from '../toolbar/AdvancedColorPicker';
import ColorSwatches from '../toolbar/ColorSwatches';
import { useAppStore } from '../../stores/useAppStore';

const ColorPickerPanel = () => {
  const { tools, setBrushSettings, setEraserSettings } = useAppStore();
  const { brushSettings, eraserSettings, currentTool } = tools;
  
  // Use the appropriate settings and setter based on current tool
  const activeSettings = currentTool === 'eraser' ? eraserSettings : brushSettings;
  const setActiveSettings = currentTool === 'eraser' ? setEraserSettings : setBrushSettings;

  // RGB state for sliders
  const [rgbValues, setRgbValues] = useState({ r: 0, g: 0, b: 0 });

  // Convert hex to RGB
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  };

  // Convert RGB to hex
  const rgbToHex = (r: number, g: number, b: number) => {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  };

  // Update RGB values when color changes
  useEffect(() => {
    const rgb = hexToRgb(activeSettings.color);
    setRgbValues(rgb);
  }, [activeSettings.color]);

  // Handle RGB slider changes
  const handleRgbChange = (component: 'r' | 'g' | 'b', value: number) => {
    const newRgb = { ...rgbValues, [component]: value };
    setRgbValues(newRgb);
    const hexColor = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    setActiveSettings({ color: hexColor });
  };

  return (
    <div className="h-full overflow-y-auto bg-[#2C2C2C]">
      {/* Advanced Color Picker - Full Width Section */}
      <div>
        <AdvancedColorPicker
          color={activeSettings.color}
          onChange={(color) => setActiveSettings({ color })}
        />
      </div>

      {/* RGB Sliders - Full Width Section */}
      <div className="px-1 py-1 bg-[#2C2C2C]">
        <div>
          {/* Red slider */}
          <input
            type="range"
            className="slider rgb-slider red-slider w-full"
            value={rgbValues.r}
            min={0}
            max={255}
            step={1}
            onChange={(e) => handleRgbChange('r', parseInt(e.target.value))}
            aria-label="Red"
          />
          
          {/* Green slider */}
          <div className="-mt-0.5">
            <input
              type="range"
              className="slider rgb-slider green-slider w-full"
              value={rgbValues.g}
              min={0}
              max={255}
              step={1}
              onChange={(e) => handleRgbChange('g', parseInt(e.target.value))}
              aria-label="Green"
            />
          </div>
          
          {/* Blue slider */}
          <div className="-mt-0.5">
            <input
              type="range"
              className="slider rgb-slider blue-slider w-full"
              value={rgbValues.b}
              min={0}
              max={255}
              step={1}
              onChange={(e) => handleRgbChange('b', parseInt(e.target.value))}
              aria-label="Blue"
            />
          </div>
        </div>
      </div>

      {/* Color Swatches - Full Width Section */}
      <div>
        <ColorSwatches
          currentColor={activeSettings.color}
          onColorSelect={(color) => setActiveSettings({ color })}
        />
      </div>
    </div>
  );
};

export default ColorPickerPanel;