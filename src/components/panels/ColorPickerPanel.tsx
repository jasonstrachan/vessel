import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ColorPicker from '../ui/ColorPicker';
import ColorSwatches from '../toolbar/ColorSwatches';
import { useAppStore } from '../../stores/useAppStore';

const ColorPickerPanel = React.memo(() => {
  // Use individual selectors to avoid unstable object references  
  const setBrushSettings = useAppStore(state => state.setBrushSettings);
  const setEraserSettings = useAppStore(state => state.setEraserSettings);
  const brushSettings = useAppStore(state => state.tools.brushSettings);
  const eraserSettings = useAppStore(state => state.tools.eraserSettings);
  const currentTool = useAppStore(state => state.tools.currentTool);
  
  // Use the appropriate settings and setter based on current tool
  const activeSettings = useMemo(() => 
    currentTool === 'eraser' ? eraserSettings : brushSettings,
    [currentTool, eraserSettings, brushSettings]
  );
  
  // Note: setActiveSettings removed in favor of direct setter calls to avoid re-render loops

  // RGB state for sliders
  const [rgbValues, setRgbValues] = useState({ r: 0, g: 0, b: 0 });

  // RAF-based throttling for smoother performance (matching AdvancedColorPicker)
  const rafRef = useRef<number | null>(null);
  const pendingUpdate = useRef(false);

  // Drag state for smooth slider interaction
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    activeSlider: 'r' | 'g' | 'b' | null;
    pointerId: number | null;
  }>({
    isDragging: false,
    activeSlider: null,
    pointerId: null
  });

  // Convert hex to RGB (memoized)
  const hexToRgb = useCallback((hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }, []);

  // Convert RGB to hex (memoized)
  const rgbToHex = useCallback((r: number, g: number, b: number) => {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }, []);

  // RAF-based color update to prevent excessive store updates
  const throttledColorUpdate = useCallback((hexColor: string) => {
    if (pendingUpdate.current) return;
    
    pendingUpdate.current = true;
    rafRef.current = requestAnimationFrame(() => {
      if (currentTool === 'eraser') {
        setEraserSettings({ color: hexColor });
      } else {
        setBrushSettings({ color: hexColor });
      }
      pendingUpdate.current = false;
      rafRef.current = null;
    });
  }, [currentTool, setEraserSettings, setBrushSettings]);

  // Update RGB values when color changes
  useEffect(() => {
    const rgb = hexToRgb(activeSettings.color);
    setRgbValues(rgb);
  }, [activeSettings.color, hexToRgb]);

  // Cleanup RAF
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Generic RGB value update function
  const updateRgbValue = useCallback((component: 'r' | 'g' | 'b', value: number) => {
    const newRgb = { ...rgbValues, [component]: value };
    setRgbValues(newRgb);
    const hexColor = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    throttledColorUpdate(hexColor);
  }, [rgbValues, rgbToHex, throttledColorUpdate]);

  // Handle RGB slider changes (memoized individual handlers with throttling)
  const handleRedChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    updateRgbValue('r', value);
  }, [updateRgbValue]);

  const handleGreenChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    updateRgbValue('g', value);
  }, [updateRgbValue]);

  const handleBlueChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    updateRgbValue('b', value);
  }, [updateRgbValue]);

  // Drag handling for smooth interaction
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLInputElement>, slider: 'r' | 'g' | 'b') => {
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    
    setDragState({
      isDragging: true,
      activeSlider: slider,
      pointerId: e.pointerId
    });
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLInputElement>) => {
    if (!dragState.isDragging || e.pointerId !== dragState.pointerId) return;
    
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const value = Math.round(progress * 255);
    
    if (dragState.activeSlider) {
      updateRgbValue(dragState.activeSlider, value);
    }
  }, [dragState.isDragging, dragState.pointerId, dragState.activeSlider, updateRgbValue]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLInputElement>) => {
    if (e.pointerId !== dragState.pointerId) return;
    
    const target = e.currentTarget;
    target.releasePointerCapture(e.pointerId);
    
    setDragState({
      isDragging: false,
      activeSlider: null,
      pointerId: null
    });
  }, [dragState.pointerId]);

  // Stable color change handlers - directly call appropriate setter to avoid re-render loops
  const handleColorChange = useCallback((color: string) => {
    if (currentTool === 'eraser') {
      setEraserSettings({ color });
    } else {
      setBrushSettings({ color });
    }
  }, [currentTool, setEraserSettings, setBrushSettings]);

  // Stable color select handler for ColorSwatches
  const handleColorSelect = useCallback((color: string) => {
    if (currentTool === 'eraser') {
      setEraserSettings({ color });
    } else {
      setBrushSettings({ color });
    }
  }, [currentTool, setEraserSettings, setBrushSettings]);

  return (
    <div className="h-full overflow-y-auto bg-[#2C2C2C]">
      {/* Color Picker - Full Width Section */}
      <div className="px-4 flex justify-center">
        <ColorPicker
          color={activeSettings.color}
          onChange={handleColorChange}
          className="-ml-2"
        />
      </div>

      {/* RGB Sliders - Full Width Section */}
      <div className="px-2 py-1 bg-[#2C2C2C]">
        <div>
          {/* Red slider */}
          <input
            type="range"
            className="slider rgb-slider red-slider w-full"
            value={rgbValues.r}
            min={0}
            max={255}
            step={1}
            onChange={handleRedChange}
            onPointerDown={(e) => handlePointerDown(e, 'r')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            aria-label="Red"
            style={{ touchAction: 'none' }}
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
              onChange={handleGreenChange}
              onPointerDown={(e) => handlePointerDown(e, 'g')}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              aria-label="Green"
              style={{ touchAction: 'none' }}
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
              onChange={handleBlueChange}
              onPointerDown={(e) => handlePointerDown(e, 'b')}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              aria-label="Blue"
              style={{ touchAction: 'none' }}
            />
          </div>
        </div>
      </div>

      {/* Color Swatches - Full Width Section */}
      <ColorSwatches
        currentColor={activeSettings.color}
        onColorSelect={handleColorSelect}
      />
    </div>
  );
});

ColorPickerPanel.displayName = 'ColorPickerPanel';

export default ColorPickerPanel;