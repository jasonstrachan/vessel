'use client';

import React from 'react';
import MiniCanvasPanel from './MiniCanvasPanel';
import LayerPanel from '../LayerPanel';

export default function RHC1Panel() {
  return (
    <div className="bg-[#31313A] flex flex-col h-screen flex-shrink-0" style={{ width: '240px', minWidth: '240px', maxWidth: '240px' }}>
      {/* MiniCanvas Section */}
      <div className="flex-shrink-0">
        <MiniCanvasPanel />
      </div>
      
      {/* Separator */}
      <div className="h-[2px] bg-[#65656A] w-full flex-shrink-0" />
      
      {/* Layers Section */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <LayerPanel />
      </div>
    </div>
  );
}