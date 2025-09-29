'use client';

import React from 'react';
import ColorSlidersPanel from '@/components/panels/ColorSlidersPanel';
import { useAppStore } from '@/stores/useAppStore';
import { scaledBrushCache } from '@/utils/scaledBrushCache';
import { brushCache } from '@/utils/brushCache';
import { BrushShape } from '@/types';

const ColorAdjustmentsPanel: React.FC = () => {
  const brushSettings = useAppStore(state => state.tools.brushSettings);
  const setBrushSettings = useAppStore(state => state.setBrushSettings);

  const hueShift = brushSettings.hueShift ?? 0;
  const saturation = brushSettings.saturationAdjust ?? 100;

  const getCurrentBrushId = React.useCallback(() => {
    if (brushSettings.brushShape === BrushShape.CUSTOM && brushSettings.selectedCustomBrush) {
      return brushSettings.selectedCustomBrush;
    }
    return `standard_${brushSettings.brushShape}`;
  }, [brushSettings.brushShape, brushSettings.selectedCustomBrush]);

  const handleHueShiftChange = React.useCallback((newHueShift: number) => {
    setBrushSettings({ hueShift: newHueShift });

    if (brushSettings.brushShape === BrushShape.CUSTOM) {
      const brushId = getCurrentBrushId();
      scaledBrushCache.clearForBrush(brushId);
      scaledBrushCache.clearForBrush('current-brush-tip');
      brushCache.clear();
    }
  }, [brushSettings.brushShape, getCurrentBrushId, setBrushSettings]);

  const handleSaturationChange = React.useCallback((newSaturation: number) => {
    setBrushSettings({ saturationAdjust: newSaturation });

    if (brushSettings.brushShape === BrushShape.CUSTOM) {
      const brushId = getCurrentBrushId();
      scaledBrushCache.clearForBrush(brushId);
      scaledBrushCache.clearForBrush('current-brush-tip');
      brushCache.clear();
    }
  }, [brushSettings.brushShape, getCurrentBrushId, setBrushSettings]);

  if (brushSettings.brushShape !== BrushShape.CUSTOM) {
    return null;
  }

  return (
    <div className="bg-[#2C2C2C] border-t border-[#404040] px-4 py-3">
      <ColorSlidersPanel
        hueShift={hueShift}
        saturation={saturation}
        onHueShiftChange={handleHueShiftChange}
        onSaturationChange={handleSaturationChange}
        brushShape={brushSettings.brushShape}
      />
    </div>
  );
};

export default React.memo(ColorAdjustmentsPanel);
