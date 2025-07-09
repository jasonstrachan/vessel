'use client';

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';

export default function ZoomControls() {
  const { canvas, setZoom, setPan } = useAppStore();
  const { zoom } = canvas;

  // Simple, direct zoom function - gets cursor position at moment of click
  const zoomAtCurrentCursor = (newZoom: number) => {
    // Get canvas element
    const canvasElement = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvasElement) {
      console.log('❌ No canvas found');
      return;
    }

    // Get current mouse position relative to the entire page
    const mouseEvent = (window as any).lastMouseEvent || { clientX: 0, clientY: 0 };
    
    // Get canvas bounds
    const rect = canvasElement.getBoundingClientRect();
    
    // Calculate cursor position relative to canvas
    const cursorX = mouseEvent.clientX - rect.left;
    const cursorY = mouseEvent.clientY - rect.top;
    
    console.log('🔍 DIRECT ZOOM:', {
      mouseEvent: { x: mouseEvent.clientX, y: mouseEvent.clientY },
      canvasBounds: { left: rect.left, top: rect.top },
      cursorRelativeToCanvas: { x: cursorX, y: cursorY },
      currentZoom: canvas.zoom,
      newZoom
    });
    
    // Same calculation as wheel zoom
    const canvasPointX = cursorX / canvas.zoom - canvas.panX;
    const canvasPointY = cursorY / canvas.zoom - canvas.panY;
    
    const newPanX = cursorX / newZoom - canvasPointX;
    const newPanY = cursorY / newZoom - canvasPointY;
    
    setZoom(newZoom);
    setPan(newPanX, newPanY);
  };

  const handleZoomIn = () => {
    console.log('🔍🔍🔍 ZOOM IN CLICKED - NEW SIMPLE VERSION! 🔍🔍🔍');
    const newZoom = Math.min(10, zoom * 1.25);
    zoomAtCurrentCursor(newZoom);
  };

  const handleZoomOut = () => {
    console.log('🔍🔍🔍 ZOOM OUT CLICKED - NEW SIMPLE VERSION! 🔍🔍🔍');
    const newZoom = Math.max(0.1, zoom * 0.8);
    zoomAtCurrentCursor(newZoom);
  };

  const handleZoomReset = () => {
    setZoom(1);
    setPan(0, 0);
  };

  const handleZoomFit = () => {
    setZoom(1);
    setPan(0, 0);
  };

  return (
    <div className="p-4 bg-[#2d2d2d] border-b border-[#404040]">
      <h3 className="text-sm font-medium mb-3 text-green-400">🔍 Zoom Controls (SIMPLE)</h3>
      
      {/* Zoom Buttons */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">Zoom</label>
        <div className="flex gap-2 mb-2">
          <button
            onClick={handleZoomOut}
            className="flex-1 px-3 py-2 text-xs bg-[#404040] text-gray-300 rounded hover:bg-[#555] transition-colors"
          >
            -
          </button>
          <div className="flex-1 px-3 py-2 text-xs bg-[#1a1a1a] text-white rounded text-center border border-[#404040]">
            {Math.round(zoom * 100)}%
          </div>
          <button
            onClick={handleZoomIn}
            className="flex-1 px-3 py-2 text-xs bg-[#404040] text-gray-300 rounded hover:bg-[#555] transition-colors"
          >
            +
          </button>
        </div>
      </div>

      {/* Zoom Slider */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">
          Zoom Level: {Math.round(zoom * 100)}%
        </label>
        <input
          type="range"
          min="0.1"
          max="10"
          step="0.1"
          value={zoom}
          onChange={(e) => {
            const newZoom = parseFloat(e.target.value);
            zoomAtCurrentCursor(newZoom);
          }}
          className="w-full h-2 bg-[#404040] rounded-lg appearance-none cursor-pointer slider"
        />
      </div>

      {/* Quick Actions */}
      <div className="mb-4">
        <div className="flex gap-2">
          <button
            onClick={handleZoomReset}
            className="flex-1 px-2 py-1 text-xs bg-[#404040] text-gray-300 rounded hover:bg-[#555] transition-colors"
          >
            100%
          </button>
          <button
            onClick={handleZoomFit}
            className="flex-1 px-2 py-1 text-xs bg-[#404040] text-gray-300 rounded hover:bg-[#555] transition-colors"
          >
            Fit
          </button>
        </div>
      </div>
    </div>
  );
}