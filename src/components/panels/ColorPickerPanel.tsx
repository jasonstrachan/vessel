import React, { useState, useEffect, useMemo, useCallback } from 'react';

import { useAppStore } from '../../stores/useAppStore';
import ColorPicker from '../ui/ColorPicker';
import ColorSwatches from '../toolbar/ColorSwatches';
import { ColorCycleGradientSwatches } from '../toolbar/ColorCycleGradientSwatches';
import PaletteSwatches from '../ui/PaletteSwatches';
import { isColorCycleBrushShape } from '@/stores/helpers/toolsState';

type ColorEditTarget =
  | { kind: 'palette' }
  | { kind: 'gradient-stop'; gradientId: string; stopIndex: number };

const ColorPickerPanel = React.memo(() => {
  // Use individual selectors to avoid unstable object references  
  const palette = useAppStore(state => state.palette);
  const ditherEnabled = useAppStore(state => state.tools.brushSettings.ditherEnabled);
  const setActiveColor = useAppStore(state => state.setActiveColor);
  const setActivePaletteSlot = useAppStore(state => state.setActivePaletteSlot);
  const updateActiveColorCycleGradient = useAppStore(
    state => state.updateActiveColorCycleGradient,
  );
  const activeLayerIsColorCycle = useAppStore((state) => (
    state.layers.find((layer) => layer.id === state.activeLayerId)?.layerType === 'color-cycle'
  ));
  const brushShape = useAppStore((state) => state.tools.brushSettings.brushShape);
  const customBrushColorCycle = useAppStore(
    (state) => state.tools.brushSettings.customBrushColorCycle === true,
  );
  const showColorCycleGradients = activeLayerIsColorCycle
    || isColorCycleBrushShape(brushShape)
    || customBrushColorCycle;
  
  const { foregroundColor, backgroundColor, activeSlot } = palette;
  const activeColor = useMemo(
    () => (activeSlot === 'foreground' ? foregroundColor : backgroundColor),
    [activeSlot, foregroundColor, backgroundColor]
  );
  const [selectedGradientStop, setSelectedGradientStop] = useState<{
    gradientId: string;
    index: number;
  } | null>(null);
  const activeGradient = useMemo(() => palette.colorCycleGradients?.find(
    (gradient) => gradient.id === palette.activeColorCycleGradientId,
  ), [palette.activeColorCycleGradientId, palette.colorCycleGradients]);
  const selectedStop = selectedGradientStop && selectedGradientStop.gradientId === activeGradient?.id
    ? activeGradient.stops[selectedGradientStop.index]
    : undefined;
  const editableColor = selectedStop?.color ?? activeColor;
  const colorEditTarget = useMemo<ColorEditTarget>(() => (
    selectedStop && selectedGradientStop
      ? {
          kind: 'gradient-stop',
          gradientId: selectedGradientStop.gradientId,
          stopIndex: selectedGradientStop.index,
        }
      : { kind: 'palette' }
  ), [selectedGradientStop, selectedStop]);
  const paletteRef = React.useRef(palette);
  paletteRef.current = palette;

  useEffect(() => {
    if (
      !showColorCycleGradients ||
      (selectedGradientStop && selectedGradientStop.gradientId !== activeGradient?.id)
    ) {
      setSelectedGradientStop(null);
    }
  }, [activeGradient?.id, selectedGradientStop, showColorCycleGradients]);
  
  // Note: setActiveSettings removed in favor of direct setter calls to avoid re-render loops

  // RGB state for sliders
  const [rgbValues, setRgbValues] = useState({ r: 0, g: 0, b: 0 });

  // RAF-based throttling for smoother performance (matching AdvancedColorPicker)

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
  const [isColorPickerDragging, setIsColorPickerDragging] = useState(false);

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
  // Update RGB values when color changes
  useEffect(() => {
    const rgb = hexToRgb(editableColor);
    setRgbValues(rgb);
  }, [editableColor, hexToRgb]);

  // Throttle color updates: when dithering is enabled and dragging, debounce to cut UI hitches.
  const pendingColorRef = React.useRef<{
    color: string;
    target: ColorEditTarget;
  } | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const debounceHandleRef = React.useRef<number | null>(null);

  const flushPendingColor = useCallback(() => {
    const pending = pendingColorRef.current;
    rafRef.current = null;
    debounceHandleRef.current = null;
    if (pending !== null) {
      pendingColorRef.current = null;
      const target = pending.target;
      if (target.kind === 'palette') {
        setActiveColor(pending.color);
        return;
      }

      const currentPalette = paletteRef.current;
      const gradient = currentPalette.colorCycleGradients?.find(
        (entry) => entry.id === target.gradientId,
      );
      if (
        !gradient ||
        gradient.id !== currentPalette.activeColorCycleGradientId ||
        !gradient.stops[target.stopIndex]
      ) {
        return;
      }
      updateActiveColorCycleGradient(gradient.stops.map((stop, index) => (
        index === target.stopIndex
          ? { ...stop, color: pending.color.toUpperCase() }
          : { ...stop }
      )));
    }
  }, [setActiveColor, updateActiveColorCycleGradient]);

  const scheduleActiveColorUpdate = useCallback((
    color: string,
    isDragging: boolean,
    target: ColorEditTarget,
  ) => {
    pendingColorRef.current = { color, target };

    // When dragging, debounce to avoid churning the engine; dither uses a longer window.
    if (ditherEnabled && isDragging && typeof window !== 'undefined') {
      if (debounceHandleRef.current !== null) {
        window.clearTimeout(debounceHandleRef.current);
      }
      debounceHandleRef.current = window.setTimeout(flushPendingColor, 120);
      return;
    }

    if (isDragging && typeof window !== 'undefined') {
      if (debounceHandleRef.current !== null) {
        window.clearTimeout(debounceHandleRef.current);
      }
      debounceHandleRef.current = window.setTimeout(flushPendingColor, 32);
      return;
    }

    // Otherwise, lightweight rAF throttle is enough
    if (rafRef.current === null && typeof window !== 'undefined') {
      rafRef.current = window.requestAnimationFrame(flushPendingColor);
    }
  }, [ditherEnabled, flushPendingColor]);

  const requestDitherWarmup = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('vessel:dither-warmup-request'));
  }, []);

  // Cleanup RAF
  // Generic RGB value update function
  const updateRgbValue = useCallback((component: 'r' | 'g' | 'b', value: number) => {
    const newRgb = { ...rgbValues, [component]: value };
    setRgbValues(newRgb);
    const hexColor = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    scheduleActiveColorUpdate(hexColor, dragState.isDragging, colorEditTarget);
  }, [rgbValues, rgbToHex, scheduleActiveColorUpdate, dragState.isDragging, colorEditTarget]);

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
    flushPendingColor();
    requestDitherWarmup();
  }, [dragState.pointerId, flushPendingColor, requestDitherWarmup]);

  // Stable color change handlers - directly call appropriate setter to avoid re-render loops
  const handleColorChange = useCallback((color: string) => {
    scheduleActiveColorUpdate(color, isColorPickerDragging, colorEditTarget);
  }, [colorEditTarget, isColorPickerDragging, scheduleActiveColorUpdate]);

  const handleColorPickerCommit = useCallback(() => {
    flushPendingColor();
    requestDitherWarmup();
  }, [flushPendingColor, requestDitherWarmup]);

  const handleColorPickerDragStart = useCallback(() => {
    setIsColorPickerDragging(true);
  }, []);

  const handleColorPickerDragEnd = useCallback(() => {
    setIsColorPickerDragging(false);
  }, []);

  // Stable color select handler for ColorSwatches
  const handleColorSelect = useCallback((color: string) => {
    if (colorEditTarget.kind === 'gradient-stop') {
      pendingColorRef.current = { color, target: colorEditTarget };
      flushPendingColor();
    } else {
      setActiveColor(color);
    }
    requestDitherWarmup();
  }, [colorEditTarget, flushPendingColor, requestDitherWarmup, setActiveColor]);

  const handlePaletteSlotSelect = useCallback((slot: 'foreground' | 'background') => {
    setSelectedGradientStop(null);
    setActivePaletteSlot(slot);
  }, [setActivePaletteSlot]);

  return (
    <div className="h-full overflow-y-auto bg-[#1A1A1A]">
      {/* Color Picker - Full Width Section */}
      <div className="px-0">
        <ColorPicker
          color={editableColor}
          onChange={handleColorChange}
          onCommit={handleColorPickerCommit}
          onInteractionStart={handleColorPickerDragStart}
          onInteractionEnd={handleColorPickerDragEnd}
          className="w-full"
        />
      </div>

      {/* RGB Sliders - Full Width Section */}
      <div className="px-0 pb-1 bg-[#1A1A1A]">
        <div className="flex items-start gap-0">
          <PaletteSwatches
            foregroundColor={foregroundColor}
            backgroundColor={backgroundColor}
            activeSlot={activeSlot}
            onSelect={handlePaletteSlotSelect}
          />

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
        </div>
      </div>

      {showColorCycleGradients ? (
        <ColorCycleGradientSwatches
          selectedStop={selectedGradientStop}
          onSelectedStopChange={setSelectedGradientStop}
        />
      ) : (
        <ColorSwatches
          currentColor={activeColor}
          onColorSelect={handleColorSelect}
        />
      )}
    </div>
  );
});

ColorPickerPanel.displayName = 'ColorPickerPanel';

export default ColorPickerPanel;
