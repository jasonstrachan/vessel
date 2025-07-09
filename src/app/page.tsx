'use client';

import React, { useEffect } from 'react';
import LeftToolbar from '../components/LeftToolbar';
import BrushLibrary from '../components/BrushLibrary';
import ControlsPanel from '../components/ControlsPanel';
// import LayerPanel from '../components/LayerPanel';
import DrawingCanvas from '../components/canvas/DrawingCanvas';

export default function Home() {
  // Simple global mouse position tracking
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      (window as any).lastMouseEvent = { clientX: e.clientX, clientY: e.clientY };
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    console.log('🖱️ Global mouse tracking enabled');
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <main className="h-screen bg-[#2d2d2d] text-white flex overflow-hidden">
      {/* Left Toolbar */}
      <LeftToolbar />
      
      {/* Main Canvas Area */}
      <div className="flex-1 bg-[#404040] relative overflow-hidden">
        <DrawingCanvas />
      </div>
      
      {/* Right Panel */}
      <div className="w-80 bg-[#2d2d2d] border-l border-[#404040] flex flex-col gap-4 h-screen" style={{ padding: '16px' }}>
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