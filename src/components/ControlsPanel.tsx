import React from 'react';
import BrushControls from './toolbar/BrushControls';
import ZoomControls from './toolbar/ZoomControls';

const ControlsPanel = () => {
  return (
    <div className="h-full overflow-y-auto">
      <BrushControls />
      <ZoomControls />
    </div>
  );
};

export default ControlsPanel;