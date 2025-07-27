'use client';

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import MiniCanvas from '../canvas/MiniCanvas';
import { scaledBrushCache } from '../../utils/scaledBrushCache';

interface MiniCanvasPanelProps {
  hueShift: number;
  saturation: number;
  onHueShiftChange: (hue: number) => void;
  onSaturationChange: (saturation: number) => void;
}

export default function MiniCanvasPanel({ 
  hueShift, 
  saturation, 
  onHueShiftChange, 
  onSaturationChange 
}: MiniCanvasPanelProps) {
  const { tools, setBrushSettings } = useAppStore();
  const { brushSettings } = tools;

  // Handle brush tip changes from MiniCanvas
  const handleBrushTipChange = React.useCallback((imageData: ImageData, actualWidth: number, actualHeight: number) => {
    // Create brush ID based on current brush
    const brushId = brushSettings.brushShape === 'custom' && brushSettings.selectedCustomBrush 
      ? brushSettings.selectedCustomBrush // Use the selectedCustomBrush ID directly (now contains preset ID)
      : `standard_${brushSettings.brushShape}`;
    
    // Default brushes should remain colorizable, custom brushes respect useSwatchColor setting
    const isColorizable = brushSettings.brushShape !== 'custom' || brushSettings.useSwatchColor;
    
    // Clear scaled brush cache for this brush to ensure color changes are reflected immediately
    // This prevents the delay between MiniCanvas updates and main canvas drawing
    scaledBrushCache.clearForBrush(brushId);
      
    setBrushSettings({ 
      currentBrushTip: {
        imageData,
        brushId,
        isColorizable,
        width: actualWidth,
        height: actualHeight
      }
    });
  }, [setBrushSettings, brushSettings.brushShape, brushSettings.selectedCustomBrush, brushSettings.useSwatchColor]);

  return (
    <div className="">
      <MiniCanvas 
        width={240} 
        height={240} 
        hueShift={hueShift}
        saturation={saturation}
        onBrushTipChange={handleBrushTipChange}
        className="w-full"
      />
    </div>
  );
}