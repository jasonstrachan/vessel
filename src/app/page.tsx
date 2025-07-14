'use client';

import React from 'react';
import LeftToolbar from '../components/LeftToolbar';
import BrushLibrary from '../components/BrushLibrary';
import ControlsPanel from '../components/ControlsPanel';
import LayerPanel from '../components/LayerPanel';
import DrawingCanvas from '../components/canvas/DrawingCanvas';

export default function Home() {
  // Global mouse tracking removed - now handled directly in canvas

  return (
    <main className="h-screen bg-[#141514] text-white flex overflow-hidden">
      {/* Left Toolbar */}
      <LeftToolbar />
      
      {/* Main Canvas Area */}
      <div className="flex-1 bg-[#141514] relative overflow-hidden">
        <DrawingCanvas />
      </div>
      
      {/* Right Panel */}
      <div className="bg-[#31313A] flex flex-col gap-4 h-screen flex-shrink-0" style={{ padding: '16px', width: '240px', minWidth: '240px', maxWidth: '240px' }}>
        {/* <LayerPanel /> */}
        <div className="flex-[2] min-h-0">
          <BrushLibrary />
        </div>
        <div className="flex-[3] min-h-0">
          <ControlsPanel />
        </div>
      </div>
    </main>
  );
}