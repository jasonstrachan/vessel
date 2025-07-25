import React from 'react';
import AdvancedColorPicker from '../toolbar/AdvancedColorPicker';
import ColorSwatches from '../toolbar/ColorSwatches';
import { useAppStore } from '../../stores/useAppStore';

const ColorPickerPanel = () => {
  const { tools, setBrushSettings, setEraserSettings } = useAppStore();
  const { brushSettings, eraserSettings, currentTool } = tools;
  
  // Use the appropriate settings and setter based on current tool
  const activeSettings = currentTool === 'eraser' ? eraserSettings : brushSettings;
  const setActiveSettings = currentTool === 'eraser' ? setEraserSettings : setBrushSettings;

  return (
    <div className="h-full overflow-y-auto bg-[#31313A]">
      {/* Advanced Color Picker - Full Width Section */}
      <div>
        <AdvancedColorPicker
          color={activeSettings.color}
          onChange={(color) => setActiveSettings({ color })}
        />
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