'use client';

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import MiniCanvas from '../canvas/MiniCanvas';

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
    
    // Default brushes should remain colorizable, custom brushes respect useSwatchColor setting
    const isColorizable = brushSettings.brushShape !== 'custom' || brushSettings.useSwatchColor;
      
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
    <div className="">
      <MiniCanvas 
        width={240} 
        height={240} 
        hueShift={hueShift}
        onHueShiftChange={setHueShift}
        onBrushTipChange={handleBrushTipChange}
        onSaveUndoState={() => {
          // This will be called by MiniCanvas when it needs to save undo state
        }}
        className="w-full"
      />
    </div>
  );
}