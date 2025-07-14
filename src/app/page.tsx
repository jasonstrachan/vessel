'use client';

import React, { useEffect } from 'react';
import LeftToolbar from '../components/LeftToolbar';
import BrushLibrary from '../components/BrushLibrary';
import ControlsPanel from '../components/ControlsPanel';
import LayerPanel from '../components/LayerPanel';
import DrawingCanvas from '../components/canvas/DrawingCanvas';
import { useAppStore } from '../stores/useAppStore';

// Import debug utilities in development
if (process.env.NODE_ENV === 'development') {
  import('../utils/debugUtils');
}

export default function Home() {
  // Global mouse tracking removed - now handled directly in canvas
  const { saveProject, loadProject } = useAppStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Prevent default behavior for our shortcuts
      if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'o')) {
        event.preventDefault();
        
        if (event.key === 's') {
          // Ctrl+S or Cmd+S for save
          saveProject().catch(console.error);
        } else if (event.key === 'o') {
          // Ctrl+O or Cmd+O for open
          loadProject().catch(console.error);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveProject, loadProject]);

  return (
    <main className="h-screen bg-[#141514] text-white flex overflow-hidden">
      {/* Debug Panel (development only) */}
      
      {/* Left Toolbar */}
      <LeftToolbar />
      
      {/* Main Canvas Area */}
      <div 
        className="flex-1 bg-[#141514] relative"
        style={{
          overflow: 'hidden',
          position: 'relative'
        }}
      >
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