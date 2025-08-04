import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import AdvancedColorPicker from '../toolbar/AdvancedColorPicker';
import { extractColorsFromLayers, getLiveColorPalette } from '../../utils/colorAnalysis';

const ColorCyclePanel = () => {
  const { 
    colorCycleState,
    setColorCyclePlaying,
    addColorCycleColor,
    removeColorCycleColor,
    setColorCycleFPS,
    setColorCycleLayers,
    resetColorCycle,
    precomputeColorCycleMaps,
    layers,
    tools,
    project
  } = useAppStore();

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [pickerColor, setPickerColor] = useState('#ff0000');

  // Trigger precomputation when colors or layers change
  useEffect(() => {
    const { selectedLayers, selectedColors } = colorCycleState;
    
    // Only precompute if we have both colors and layers selected
    if (selectedColors.length > 0 && selectedLayers.length > 0) {
      // Use setTimeout to avoid blocking the UI thread immediately
      const timeoutId = setTimeout(() => {
        precomputeColorCycleMaps();
      }, 50);
      
      return () => clearTimeout(timeoutId);
    }
  }, [colorCycleState.selectedLayers, colorCycleState.selectedColors, precomputeColorCycleMaps]);

  const handlePlayPause = () => {
    setColorCyclePlaying(!colorCycleState.isPlaying);
  };

  const handleAddColor = () => {
    // Add current brush color to the cycle
    addColorCycleColor(tools.brushSettings.color);
  };

  const handlePickerAddColor = () => {
    // Add color from color picker
    addColorCycleColor(pickerColor);
    setShowColorPicker(false);
  };

  const handleExtractFromCanvas = () => {
    // Extract colors from selected layers or all visible layers
    const selectedLayers = colorCycleState.selectedLayers.length > 0 
      ? layers.filter(layer => colorCycleState.selectedLayers.includes(layer.id))
      : layers.filter(layer => layer.visible);
    
    if (selectedLayers.length > 0) {
      const extractedColors = extractColorsFromLayers(selectedLayers, 8);
      // Add each extracted color to the cycle (avoiding duplicates)
      extractedColors.forEach(color => {
        if (!colorCycleState.selectedColors.includes(color)) {
          addColorCycleColor(color);
        }
      });
    } else if (project) {
      // Fallback to project-wide color extraction
      const extractedColors = extractColorsFromLayers(layers, 8);
      extractedColors.forEach(color => {
        if (!colorCycleState.selectedColors.includes(color)) {
          addColorCycleColor(color);
        }
      });
    }
  };

  const handleRemoveColor = (index: number) => {
    removeColorCycleColor(index);
  };

  const handleFPSChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fps = Math.max(1, Math.min(60, parseInt(event.target.value) || 18));
    setColorCycleFPS(fps);
  };

  const handleLayerToggle = (layerId: string) => {
    const isSelected = colorCycleState.selectedLayers.includes(layerId);
    if (isSelected) {
      setColorCycleLayers(colorCycleState.selectedLayers.filter(id => id !== layerId));
    } else {
      setColorCycleLayers([...colorCycleState.selectedLayers, layerId]);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#2C2C2C] p-3">
      <div className="mb-4">
        <h3 className="text-white text-sm font-medium mb-3">Color Cycle</h3>
        
        {/* Play/Pause Controls */}
        <div className="mb-4">
          <button
            onClick={handlePlayPause}
            className={`w-full py-2 px-3 rounded text-sm font-medium transition-colors ${
              colorCycleState.isPlaying
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            {colorCycleState.isPlaying ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-3 h-3 flex gap-1">
                  <div className="w-1 h-3 bg-white"></div>
                  <div className="w-1 h-3 bg-white"></div>
                </div>
                Pause
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <div className="w-0 h-0 border-l-[6px] border-l-white border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent"></div>
                Play
              </div>
            )}
          </button>
        </div>

        {/* Color Swatches */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-white text-xs">Colors</label>
            <div className="flex gap-1">
              <button
                onClick={handleAddColor}
                className="bg-[#404040] hover:bg-[#505050] text-white text-xs px-2 py-1 rounded transition-colors"
                title="Add current brush color"
              >
                Current
              </button>
              <button
                onClick={() => setShowColorPicker(true)}
                className="bg-[#404040] hover:bg-[#505050] text-white text-xs px-2 py-1 rounded transition-colors"
                title="Pick a color"
              >
                Pick
              </button>
              <button
                onClick={handleExtractFromCanvas}
                className="bg-[#404040] hover:bg-[#505050] text-white text-xs px-2 py-1 rounded transition-colors"
                title="Extract colors from canvas"
              >
                Extract
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-4 gap-2 mb-2">
            {colorCycleState.selectedColors.map((color, index) => (
              <div key={index} className="relative group">
                <div
                  className="w-12 h-12 rounded border-2 border-[#404040] transition-colors"
                  style={{ backgroundColor: color }}
                />
                <button
                  className="absolute -bottom-1 -right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-red-600 rounded-full w-6 h-6 flex items-center justify-center text-white text-sm font-bold shadow-lg hover:bg-red-700 cursor-pointer"
                  onClick={() => handleRemoveColor(index)}
                  title="Remove color"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          
          {colorCycleState.selectedColors.length === 0 && (
            <div className="text-gray-400 text-xs text-center py-2">
              No colors selected
            </div>
          )}
        </div>

        {/* FPS Control */}
        <div className="mb-4">
          <label className="text-white text-xs block mb-2">
            FPS: {colorCycleState.fps}
          </label>
          <input
            type="range"
            min="1"
            max="60"
            value={colorCycleState.fps}
            onChange={handleFPSChange}
            className="w-full h-2 bg-[#404040] rounded-lg appearance-none cursor-pointer slider"
            style={{
              background: `linear-gradient(to right, #4A90E2 0%, #4A90E2 ${((colorCycleState.fps - 1) / 59) * 100}%, #404040 ${((colorCycleState.fps - 1) / 59) * 100}%, #404040 100%)`
            }}
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>1</span>
            <span>60</span>
          </div>
        </div>

        {/* Layer Selection */}
        <div className="mb-4">
          <label className="text-white text-xs block mb-2">Apply to Layers</label>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {layers.map((layer) => (
              <label key={layer.id} className="flex items-center text-xs text-white cursor-pointer hover:bg-[#404040] p-1 rounded">
                <input
                  type="checkbox"
                  checked={colorCycleState.selectedLayers.includes(layer.id)}
                  onChange={() => handleLayerToggle(layer.id)}
                  className="mr-2 accent-blue-500"
                />
                <span className="truncate">{layer.name}</span>
              </label>
            ))}
          </div>
          
          {layers.length === 0 && (
            <div className="text-gray-400 text-xs text-center py-2">
              No layers available
            </div>
          )}
        </div>

        {/* Reset Button */}
        <button
          onClick={resetColorCycle}
          className="w-full py-2 px-3 rounded text-sm bg-[#404040] hover:bg-[#505050] text-white transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Color Picker Modal */}
      {showColorPicker && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-[#2C2C2C] border border-[#404040] rounded-lg p-4 max-w-sm w-full mx-4">
            <div className="mb-4">
              <h3 className="text-white text-sm font-medium mb-3">Pick a Color</h3>
              <div className="mb-3">
                <AdvancedColorPicker
                  color={pickerColor}
                  onChange={setPickerColor}
                />
              </div>
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-8 h-8 rounded border border-[#404040]"
                  style={{ backgroundColor: pickerColor }}
                />
                <span className="text-white text-sm font-mono">{pickerColor}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePickerAddColor}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm py-2 px-3 rounded transition-colors"
              >
                Add Color
              </button>
              <button
                onClick={() => setShowColorPicker(false)}
                className="flex-1 bg-[#404040] hover:bg-[#505050] text-white text-sm py-2 px-3 rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ColorCyclePanel;