'use client';

import React from 'react';
import LayersPanel from '@/components/panels/LayersPanel';
import AlignmentPanel from '@/components/panels/AlignmentPanel';
import AnimationControlsPanel from '@/components/panels/AnimationControlsPanel';

const LayerPanel: React.FC = () => {
  return (
    <div className="flex flex-col h-full bg-[#1A1A1A]">
      <LayersPanel />
      <AlignmentPanel />
      <AnimationControlsPanel />
    </div>
  );
};

export default React.memo(LayerPanel);
