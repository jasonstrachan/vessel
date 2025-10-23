import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ColorPicker from '../ui/ColorPicker';
import PaletteSwatches from '../ui/PaletteSwatches';
import ColorSwatches from '../toolbar/ColorSwatches';
import { useAppStore } from '../../stores/useAppStore';

const ColorPickerPanel = React.memo(() => {
  // Use individual selectors to avoid unstable object references  
  const setBrushSettings = useAppStore(state => state.setBrushSettings);
  const setEraserSettings = useAppStore(state => state.setEraserSettings);
  const currentTool = useAppStore(state => state.tools.currentTool);
  const palette = useAppStore(state => state.palette);
  const setPaletteColor = useAppStore(state => state.setPaletteColor);
  const setActivePaletteSlot = useAppStore(state => state.setActivePaletteSlot);
  
  const { foregroundColor, backgroundColor, activeSlot } = palette;
  const activeColor = useMemo(
    () => (activeSlot === 'foreground' ? foregroundColor : backgroundColor),
    [activeSlot, foregroundColor, backgroundColor]
  );
  
  // Note: setActiveSettings removed in favor of direct setter calls to avoid re-render loops

  // RGB state for sliders
  const [rgbValues, setRgbValues] = useState({ r: 0, g: 0, b: 0 });

  // RAF-based throttling for smoother performance (matching AdvancedColorPicker)
  const rafRef = useRef<number | null>(null);
  const pendingUpdate = useRef(false);
  const paletteUpdateRafRef = useRef<number | null>(null);
  const paletteUpdateState = useRef<{ slot: 'foreground' | 'background'; color: string } | null>(null);

  const applyToolColor = useCallback((color: string) => {
    if (currentTool === 'eraser') {
      setEraserSettings({ color });
    } else {
      setBrushSettings({ color });
    }
  }, [currentTool, setBrushSettings, setEraserSettings]);

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
  const throttledToolColorUpdate = useCallback((hexColor: string) => {
    if (pendingUpdate.current) return;
    
    pendingUpdate.current = true;
    rafRef.current = requestAnimationFrame(() => {
      applyToolColor(hexColor);
      pendingUpdate.current = false;
      rafRef.current = null;
    });
  }, [applyToolColor]);

  // Update RGB values when color changes
  useEffect(() => {
    const rgb = hexToRgb(activeColor);
    setRgbValues(rgb);
  }, [activeColor, hexToRgb]);

  const schedulePaletteUpdate = useCallback((slot: 'foreground' | 'background', color: string) => {
    paletteUpdateState.current = { slot, color };
    if (paletteUpdateRafRef.current !== null) {
      return;
    }
    paletteUpdateRafRef.current = requestAnimationFrame(() => {
      paletteUpdateRafRef.current = null;
      const latest = paletteUpdateState.current;
      if (latest) {
        setPaletteColor(latest.slot, latest.color);
      }
    });
  }, [setPaletteColor]);

  // Cleanup RAF
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (paletteUpdateRafRef.current) {
        cancelAnimationFrame(paletteUpdateRafRef.current);
        paletteUpdateRafRef.current = null;
      }
    };
  }, []);

  // Generic RGB value update function
  const updateRgbValue = useCallback((component: 'r' | 'g' | 'b', value: number) => {
    const newRgb = { ...rgbValues, [component]: value };
    setRgbValues(newRgb);
    const hexColor = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    schedulePaletteUpdate(activeSlot, hexColor);
    if (activeSlot === 'foreground') {
      throttledToolColorUpdate(hexColor);
    }
  }, [rgbValues, rgbToHex, schedulePaletteUpdate, activeSlot, throttledToolColorUpdate]);

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
    schedulePaletteUpdate(activeSlot, color);
    if (activeSlot === 'foreground') {
      applyToolColor(color);
    }
  }, [activeSlot, schedulePaletteUpdate, applyToolColor]);

  // Stable color select handler for ColorSwatches
  const handleColorSelect = useCallback((color: string) => {
    setPaletteColor(activeSlot, color);
    if (activeSlot === 'foreground') {
      applyToolColor(color);
    }
  }, [activeSlot, setPaletteColor, applyToolColor]);

  return (
    <div className="h-full overflow-y-auto bg-[#1A1A1A]">
      {/* Color Picker - Full Width Section */}
      <div className="px-0">
        <ColorPicker
          color={activeColor}
          onChange={handleColorChange}
          className="w-full"
        />
      </div>

      {/* RGB Sliders - Full Width Section */}
      <div className="px-2 py-1 bg-[#1A1A1A] flex items-stretch gap-3">
        <div className="flex-1 flex flex-col gap-1">
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
            style={{
              touchAction: 'none',
              '--slider-progress': `${(rgbValues.r / 255) * 100}%`
            } as React.CSSProperties & { '--slider-progress': string }}
          />
          {/* Green slider */}
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
            style={{
              touchAction: 'none',
              '--slider-progress': `${(rgbValues.g / 255) * 100}%`
            } as React.CSSProperties & { '--slider-progress': string }}
          />
          {/* Blue slider */}
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
            style={{
              touchAction: 'none',
              '--slider-progress': `${(rgbValues.b / 255) * 100}%`
            } as React.CSSProperties & { '--slider-progress': string }}
          />
        </div>

        <div className="flex h-full flex-col">
          <PaletteSwatches
            foregroundColor={foregroundColor}
            backgroundColor={backgroundColor}
            activeSlot={activeSlot}
            onSelect={setActivePaletteSlot}
          />
        </div>
      </div>

      {/* Color Swatches - Full Width Section */}
      <ColorSwatches
        currentColor={activeColor}
        onColorSelect={handleColorSelect}
      />
    </div>
  );
});

ColorPickerPanel.displayName = 'ColorPickerPanel';

export default ColorPickerPanel;
