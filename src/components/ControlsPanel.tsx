import React from 'react';
import BrushControls from './toolbar/BrushControls';
import FillControls from './toolbar/FillControls';
import { CustomBrushPanel } from './toolbar/CustomBrushPanel';
import { useAppStore } from '../stores/useAppStore';

const ControlsPanel = () => {
  const { tools } = useAppStore();
  
  return (
    <div className="h-full overflow-y-auto bg-[#31313A]">
      {(tools.currentTool === 'brush' || tools.currentTool === 'eraser') && <BrushControls />}
      {tools.currentTool === 'fill' && <FillControls />}
      {tools.currentTool === 'custom' && <CustomBrushPanel />}
    </div>
  );
};

export default ControlsPanel;