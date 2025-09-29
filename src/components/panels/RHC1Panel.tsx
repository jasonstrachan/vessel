'use client';

import React from 'react';
import LayerPanel from '@/components/LayerPanel';
import ColorAdjustmentsPanel from '@/components/panels/ColorAdjustmentsPanel';

const RHC1Panel: React.FC = () => {
  return (
    <div className="bg-[#2C2C2C] flex flex-col h-screen flex-shrink-0" style={{ width: '260px', minWidth: '260px', maxWidth: '260px' }}>
      <ColorAdjustmentsPanel />
      <div className="flex-1 min-h-0 overflow-hidden">
        <LayerPanel />
      </div>
    </div>
  );
};

export default React.memo(RHC1Panel);
