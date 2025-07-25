'use client';

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import MiniCanvas from '../canvas/MiniCanvas';

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