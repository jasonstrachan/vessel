'use client';

import React from 'react';
import MiniCanvasPanel from './MiniCanvasPanel';
import ColorSlidersPanel from './ColorSlidersPanel';
import LayerPanel from '../LayerPanel';
import { useAppStore } from '../../stores/useAppStore';

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

  return (
    <div className="bg-[#31313A] flex flex-col h-screen flex-shrink-0" style={{ width: '240px', minWidth: '240px', maxWidth: '240px' }}>
      {/* MiniCanvas Section */}
      <div className="flex-shrink-0">
        <MiniCanvasPanel 
          hueShift={hueShift}
          saturation={saturation}
          onHueShiftChange={setHueShift}
          onSaturationChange={setSaturation}
        />
      </div>
      
      {/* Color Sliders Section */}
      <div className="flex-shrink-0">
        <ColorSlidersPanel
          hueShift={hueShift}
          saturation={saturation}
          onHueShiftChange={setHueShift}
          onSaturationChange={setSaturation}
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