'use client';

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import MiniCanvas from '../canvas/MiniCanvas';
import { scaledBrushCache } from '../../utils/scaledBrushCache';
import { brushCache } from '../../utils/brushCache';
import { BrushShape } from '../../types';

interface MiniCanvasPanelProps {
  hueShift: number;
  saturation: number;
  onHueShiftChange: (hue: number) => void;
  onSaturationChange: (saturation: number) => void;
}

export default function MiniCanvasPanel({ 
  hueShift, 
  saturation, 
  onHueShiftChange: _onHueShiftChange, 
  onSaturationChange: _onSaturationChange 
}: MiniCanvasPanelProps) {
  const { tools, setBrushSettings } = useAppStore();
  const { brushSettings } = tools;

  // Handle brush tip changes from MiniCanvas
  const handleBrushTipChange = React.useCallback((imageData: ImageData, actualWidth: number, actualHeight: number) => {
    // CRITICAL: Only allow brush tip changes for custom brushes
    if (brushSettings.brushShape !== BrushShape.CUSTOM) {
      return; // Standard brushes should never have their tips modified
    }
    
    // Create brush ID for custom brush only
    const brushId = brushSettings.selectedCustomBrush || 'no-custom-brush';
    
    // Custom brushes respect useSwatchColor setting
    const isColorizable = brushSettings.useSwatchColor;
    
    // Clear both cache systems for custom brushes to ensure edits are reflected immediately
    scaledBrushCache.clearForBrush(brushId);
    // Also clear cache for current-brush-tip which is used when drawing edited brushes
    scaledBrushCache.clearForBrush('current-brush-tip');
    brushCache.clear();
      
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