'use client';

import React from 'react';
import MiniCanvasPanel from './MiniCanvasPanel';
import ColorSlidersPanel from './ColorSlidersPanel';
import LayerPanel from '../LayerPanel';
import { useAppStore } from '../../stores/useAppStore';
import { scaledBrushCache } from '../../utils/scaledBrushCache';
import { brushCache } from '../../utils/brushCache';
import { BrushShape } from '../../types';

export default function RHC1Panel() {
  const { tools } = useAppStore();
  const { brushSettings } = tools;
  
  // Local state for hue shift and saturation
  const [hueShift, setHueShift] = React.useState(0);
  const [saturation, setSaturation] = React.useState(100);

  // Reset hue shift and saturation when brush changes
  React.useEffect(() => {
    setHueShift(0);
    setSaturation(100);
  }, [brushSettings.brushShape, brushSettings.selectedCustomBrush]);

  // Helper function to get current brush ID
  const getCurrentBrushId = React.useCallback(() => {
    if (brushSettings.brushShape === BrushShape.CUSTOM && brushSettings.selectedCustomBrush) {
      return brushSettings.selectedCustomBrush;
    }
    return `standard_${brushSettings.brushShape}`;
  }, [brushSettings.brushShape, brushSettings.selectedCustomBrush]);

  // Enhanced hue shift handler that clears cache
  const handleHueShiftChange = React.useCallback((newHueShift: number) => {
    setHueShift(newHueShift);
    
    // Clear both cache systems for custom brushes when hue changes
    if (brushSettings.brushShape === BrushShape.CUSTOM) {
      const brushId = getCurrentBrushId();
      scaledBrushCache.clearForBrush(brushId);
      // Also clear cache for current-brush-tip which is used when hue/saturation is applied
      scaledBrushCache.clearForBrush('current-brush-tip');
      brushCache.clear();
    }
  }, [brushSettings.brushShape, getCurrentBrushId]);

  // Enhanced saturation handler that clears cache
  const handleSaturationChange = React.useCallback((newSaturation: number) => {
    setSaturation(newSaturation);
    
    // Clear both cache systems for custom brushes when saturation changes
    if (brushSettings.brushShape === BrushShape.CUSTOM) {
      const brushId = getCurrentBrushId();
      scaledBrushCache.clearForBrush(brushId);
      // Also clear cache for current-brush-tip which is used when hue/saturation is applied
      scaledBrushCache.clearForBrush('current-brush-tip');
      brushCache.clear();
    }
  }, [brushSettings.brushShape, getCurrentBrushId]);

  return (
    <div className="bg-[#31313A] flex flex-col h-screen flex-shrink-0" style={{ width: '240px', minWidth: '240px', maxWidth: '240px' }}>
      {/* MiniCanvas Section */}
      <div className="flex-shrink-0">
        <MiniCanvasPanel 
          hueShift={hueShift}
          saturation={saturation}
          onHueShiftChange={handleHueShiftChange}
          onSaturationChange={handleSaturationChange}
        />
      </div>
      
      {/* Color Sliders Section */}
      <div className="flex-shrink-0">
        <ColorSlidersPanel
          hueShift={hueShift}
          saturation={saturation}
          onHueShiftChange={handleHueShiftChange}
          onSaturationChange={handleSaturationChange}
          brushShape={brushSettings.brushShape}
          onSaveUndoState={() => {
            // This will be called when sliders need to save undo state
          }}
        />
      </div>
      
      {/* Separator */}
      <div className="h-[2px] bg-[#65656A] w-full flex-shrink-0" />
      
      {/* Layers Section */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <LayerPanel />
      </div>
    </div>
  );
}