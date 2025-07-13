import React from 'react';
import BrushControls from './toolbar/BrushControls';
import { CustomBrushPanel } from './toolbar/CustomBrushPanel';
import { useAppStore } from '../stores/useAppStore';

const ControlsPanel = () => {
  const { tools } = useAppStore();
  
  return (
    <div className="h-full overflow-y-auto">
      <BrushControls />
      {tools.currentTool === 'custom' && <CustomBrushPanel />}
    </div>
  );
};

export default ControlsPanel;