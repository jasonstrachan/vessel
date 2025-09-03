import React from 'react';
import BrushControls from './toolbar/BrushControls';
import FillControls from './toolbar/FillControls';
import { CustomBrushPanel } from './toolbar/CustomBrushPanel';
import { ColorCycleUI } from './colorCycle/integration/ColorCycleUI';
import { useAppStore } from '../stores/useAppStore';

const ControlsPanel = () => {
  const { tools } = useAppStore();
  
  return (
    <div className="h-full overflow-y-auto bg-[#2C2C2C]">
      {(tools.currentTool === 'brush' || tools.currentTool === 'eraser') && <BrushControls />}
      {tools.currentTool === 'fill' && <FillControls />}
      {tools.currentTool === 'custom' && <CustomBrushPanel />}
      
      {/* Full Color Cycle System */}
      <ColorCycleUI isVisible={true} />
    </div>
  );
};

export default ControlsPanel;