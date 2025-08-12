import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { extractColorsFromLayers } from '../../utils/colorAnalysis';

const ColorCyclePanel = () => {
  const { 
    colorCycleState,
    setColorCyclePlaying,
    setColorCyclePlayingWithCapture,
    addColorCycleColor,
    removeColorCycleColor,
    reorderColorCycleColors,
    setColorCycleFPS,
    setColorCycleLayers,
    resetColorCycle,
    precomputeColorCycleMaps,
    layers,
    tools,
    project
  } = useAppStore();

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isPickingColor, setIsPickingColor] = useState(false);

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

  const handlePlayPause = async () => {
    if (!colorCycleState.isPlaying) {
      // When starting, use the new method that captures current state
      await setColorCyclePlayingWithCapture(true);
    } else {
      // When stopping, use regular method
      setColorCyclePlaying(false);
    }
  };

  const handleAddColor = () => {
    // Add current brush color to the cycle
    addColorCycleColor(tools.brushSettings.color);
  };

  const handleToggleColorPicking = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPickingColor(!isPickingColor);
  };

  // Function to get color from canvas coordinates
  const getColorFromCanvas = (x: number, y: number, canvas: HTMLCanvasElement): string | null => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    try {
      const imageData = ctx.getImageData(x, y, 1, 1);
      const [r, g, b, a] = imageData.data;
      
      // Skip transparent pixels
      if (a < 10) return null;
      
      // Convert RGB to hex
      const toHex = (n: number) => n.toString(16).padStart(2, '0');
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    } catch (error) {
      console.warn('Failed to get color from canvas:', error);
      return null;
    }
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

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== dropIndex) {
      reorderColorCycleColors(draggedIndex, dropIndex);
    }
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Handle canvas clicks for color picking
  useEffect(() => {
    if (!isPickingColor) return;

    const handleCanvasClick = (e: MouseEvent) => {
      // Prevent this click from bubbling and closing the picker
      e.stopPropagation();
      
      // Check if we clicked on a canvas element
      const target = e.target as HTMLElement;
      if (target.tagName !== 'CANVAS') return;

      // Get the visible canvas (the one user sees and clicks on)
      const visibleCanvas = target as HTMLCanvasElement;
      
      // Try to find the offscreen canvas from the store
      const offscreenCanvas = useAppStore.getState().currentOffscreenCanvas;
      
      // Use offscreen canvas if available, otherwise use the visible canvas
      const sourceCanvas = offscreenCanvas || visibleCanvas;

      // Get click coordinates relative to the canvas
      const rect = visibleCanvas.getBoundingClientRect();
      const scale = sourceCanvas.width / rect.width; // Handle any scaling
      const x = Math.floor((e.clientX - rect.left) * scale);
      const y = Math.floor((e.clientY - rect.top) * scale);

      const color = getColorFromCanvas(x, y, sourceCanvas);
      if (color) {
        // Check if color already exists
        if (!colorCycleState.selectedColors.includes(color)) {
          addColorCycleColor(color);
        }
      }
      
      // Don't turn off picking mode - keep it active
      e.preventDefault();
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPickingColor(false);
      }
    };

    if (isPickingColor) {
      // Use capture phase to get canvas clicks before they bubble
      document.addEventListener('click', handleCanvasClick, true);
      document.addEventListener('keydown', handleEscape);
      // Set cursor on the whole document
      const style = document.createElement('style');
      style.id = 'color-picker-cursor';
      style.textContent = '* { cursor: crosshair !important; }';
      document.head.appendChild(style);
    }

    return () => {
      document.removeEventListener('click', handleCanvasClick, true);
      document.removeEventListener('keydown', handleEscape);
      // Remove cursor style
      const style = document.getElementById('color-picker-cursor');
      if (style) {
        style.remove();
      }
    };
  }, [isPickingColor, addColorCycleColor, colorCycleState.selectedColors]);

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
                <div className="w-3 h-3 bg-white"></div>
                Stop
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
                onClick={handleToggleColorPicking}
                className={`text-white text-xs px-2 py-1 rounded transition-colors ${
                  isPickingColor 
                    ? 'bg-blue-600 hover:bg-blue-700' 
                    : 'bg-[#404040] hover:bg-[#505050]'
                }`}
                title={isPickingColor ? "Click on canvas to pick colors (Click here or ESC to stop)" : "Pick colors from canvas"}
              >
                {isPickingColor ? 'Stop' : 'Pick'}
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
              <div 
                key={index} 
                className="relative group"
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
              >
                <div
                  className={`w-12 h-12 rounded border-2 transition-all cursor-move ${
                    draggedIndex === index 
                      ? 'border-blue-500 opacity-50 scale-105' 
                      : 'border-[#404040] hover:border-[#606060]'
                  }`}
                  style={{ backgroundColor: color }}
                  title={`${color} - Drag to reorder`}
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

    </div>
  );
};

export default ColorCyclePanel;