import React from 'react';
import BrushControls from './toolbar/BrushControls';
import FillControls from './toolbar/FillControls';
import { CustomBrushPanel } from './toolbar/CustomBrushPanel';
import { useAppStore } from '../stores/useAppStore';
import { ColorCycleUI } from './colorCycle/integration/ColorCycleUI';

const ControlsPanel = () => {
  const { tools } = useAppStore();
  
  return (
    <div className="h-full overflow-y-auto bg-[#2C2C2C]">
      {(tools.currentTool === 'brush' || tools.currentTool === 'eraser') && <BrushControls />}
      {tools.currentTool === 'fill' && <FillControls />}
      {tools.currentTool === 'custom' && <CustomBrushPanel />}
      {tools.currentTool === 'recolor' && (
        <div className="p-2">
          {/* Inline Recolor & animate panel in the brush settings area */}
          <ColorCycleUI isVisible={true} />
        </div>
      )}
    </div>
  );
};

export default ControlsPanel;
