'use client';

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import MiniCanvas from '../canvas/MiniCanvas';
import { Slider } from '../retroui/Slider';

export default function MiniCanvasPanel() {
  const { tools, setBrushSettings } = useAppStore();
  const { brushSettings } = tools;
  
  // Local state for hue shift
  const [hueShift, setHueShift] = React.useState(0);

  // Handle brush tip changes from MiniCanvas
  const handleBrushTipChange = React.useCallback((imageData: ImageData) => {
    // Create brush ID based on current brush
    const brushId = brushSettings.brushShape === 'custom' && brushSettings.selectedCustomBrush 
      ? brushSettings.selectedCustomBrush // Use the selectedCustomBrush ID directly (now contains preset ID)
      : `standard_${brushSettings.brushShape}`;
    
    // Default brushes should remain colorizable, custom brushes have baked colors
    const isColorizable = brushSettings.brushShape !== 'custom';
      
    setBrushSettings({ 
      currentBrushTip: {
        imageData,
        brushId,
        isColorizable
      }
    });
  }, [setBrushSettings, brushSettings.brushShape, brushSettings.selectedCustomBrush]);

  // Reset hue shift when brush changes (but keep currentBrushTip)
  React.useEffect(() => {
    setHueShift(0);
  }, [brushSettings.brushShape, brushSettings.selectedCustomBrush]);

  return (
    <div className="p-3 bg-[#31313A]">
      <MiniCanvas 
        width={216} 
        height={216} 
        hueShift={hueShift}
        onHueShiftChange={setHueShift}
        onBrushTipChange={handleBrushTipChange}
        onSaveUndoState={() => {
          // This will be called by MiniCanvas when it needs to save undo state
        }}
        className="w-full"
      />
      
      {/* Hue adjustment slider */}
      <div className="mt-2">
        <label className="block text-sm text-[#D9D9D9] mb-1">
          Hue Shift: {hueShift > 0 ? '+' : ''}{hueShift}°
        </label>
        <Slider
          value={[hueShift]}
          min={-180}
          max={180}
          step={1}
          onValueChange={(value) => {
            // Only save state if this is the first change (when going from 0 to non-zero)
            if (hueShift === 0 && value[0] !== 0) {
              // TODO: Save mini canvas state before hue change
            }
            setHueShift(value[0]);
          }}
          aria-label="Hue Shift"
        />
      </div>
    </div>
  );
}