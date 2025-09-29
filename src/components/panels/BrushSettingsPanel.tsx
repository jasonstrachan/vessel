'use client';

import React from 'react';
import BrushControls from '@/components/toolbar/BrushControls';
import FillControls from '@/components/toolbar/FillControls';
import { CustomBrushPanel } from '@/components/toolbar/CustomBrushPanel';
import { ColorCycleUI } from '@/components/colorCycle/integration/ColorCycleUI';
import { useAppStore } from '@/stores/useAppStore';

const BrushSettingsPanel: React.FC = () => {
  const currentTool = useAppStore(state => state.tools.currentTool);

  return (
    <div className="bg-[#2C2C2C] flex flex-col h-full">
      <div className="flex-shrink-0 px-4 py-2 border-b border-[#404040]">
        <h3 className="font-medium text-[#D9D9D9]" style={{ fontSize: '14px' }}>Brush Settings</h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        {(currentTool === 'brush' || currentTool === 'eraser') && <BrushControls />}
        {currentTool === 'fill' && <FillControls />}
        {currentTool === 'custom' && <CustomBrushPanel />}
        {currentTool === 'recolor' && (
          <div className="p-2">
            <ColorCycleUI isVisible={true} />
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(BrushSettingsPanel);
