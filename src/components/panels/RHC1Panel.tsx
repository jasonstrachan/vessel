'use client';

import React from 'react';
import ColorSlidersPanel from './ColorSlidersPanel';
import LayerPanel from '../LayerPanel';
import { useAppStore } from '../../stores/useAppStore';
import { scaledBrushCache } from '../../utils/scaledBrushCache';
import { brushCache } from '../../utils/brushCache';
import { BrushShape } from '../../types';

export default function RHC1Panel() {
  const { tools, setBrushSettings } = useAppStore();
  const { brushSettings } = tools;
  
  // Use global state for hue shift and saturation
  const hueShift = brushSettings.hueShift ?? 0;
  const saturation = brushSettings.saturationAdjust ?? 100;

  // Helper function to get current brush ID
  const getCurrentBrushId = React.useCallback(() => {
    if (brushSettings.brushShape === BrushShape.CUSTOM && brushSettings.selectedCustomBrush) {
      return brushSettings.selectedCustomBrush;
    }
    return `standard_${brushSettings.brushShape}`;
  }, [brushSettings.brushShape, brushSettings.selectedCustomBrush]);

  // Enhanced hue shift handler that clears cache
  const handleHueShiftChange = React.useCallback((newHueShift: number) => {
    setBrushSettings({ hueShift: newHueShift });
    
    // Clear both cache systems for custom brushes when hue changes
    if (brushSettings.brushShape === BrushShape.CUSTOM) {
      const brushId = getCurrentBrushId();
      scaledBrushCache.clearForBrush(brushId);
      // Also clear cache for current-brush-tip which is used when hue/saturation is applied
      scaledBrushCache.clearForBrush('current-brush-tip');
      brushCache.clear();
    }
  }, [brushSettings.brushShape, getCurrentBrushId, setBrushSettings]);

  // Enhanced saturation handler that clears cache
  const handleSaturationChange = React.useCallback((newSaturation: number) => {
    setBrushSettings({ saturationAdjust: newSaturation });
    
    // Clear both cache systems for custom brushes when saturation changes
    if (brushSettings.brushShape === BrushShape.CUSTOM) {
      const brushId = getCurrentBrushId();
      scaledBrushCache.clearForBrush(brushId);
      // Also clear cache for current-brush-tip which is used when hue/saturation is applied
      scaledBrushCache.clearForBrush('current-brush-tip');
      brushCache.clear();
    }
  }, [brushSettings.brushShape, getCurrentBrushId, setBrushSettings]);

  return (
    <div className="bg-[#2C2C2C] flex flex-col h-screen flex-shrink-0" style={{ width: '240px', minWidth: '240px', maxWidth: '240px' }}>
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
      <div className="h-[2px] bg-[#424242] w-full flex-shrink-0" />
      
      {/* Layers Section */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <LayerPanel />
      </div>
    </div>
  );
}