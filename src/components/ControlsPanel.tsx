import React from 'react';
import BrushControls from './toolbar/BrushControls';

const ControlsPanel = () => {
  return (
    <div className="flex-1 overflow-y-auto">
      <BrushControls />
    </div>
  );
};

export default ControlsPanel;