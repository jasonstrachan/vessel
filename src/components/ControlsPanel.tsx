import React from 'react';
import BrushControls from './toolbar/BrushControls';

const ControlsPanel = () => {
  return (
    <div className="h-full overflow-y-auto">
      <BrushControls />
    </div>
  );
};

export default ControlsPanel;