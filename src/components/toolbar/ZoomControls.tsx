'use client';

// Zoom controls component for canvas pan/zoom functionality
// Based on the same styling patterns as BrushControls.tsx

import React, { useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '../../stores/useAppStore';

export default function ZoomControls() {
  const { canvas, setZoom, setPan } = useAppStore();
  const { zoom } = canvas;
  const lastCursorPos = useRef({ x: 0, y: 0 });
  
  // Track cursor position globally (only setup once)
  useEffect(() => {
    console.log('🔍 SETTING UP CURSOR TRACKING');
    const handleMouseMove = (e: MouseEvent) => {
      lastCursorPos.current = { x: e.clientX, y: e.clientY };
      // Reduce cursor spam - only log every 10th movement
      if (Math.random() < 0.1) {
        console.log('🖱️ CURSOR TRACK:', e.clientX, e.clientY);
      }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    console.log('🔍 CURSOR TRACKING LISTENER ADDED');
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      console.log('🔍 CURSOR TRACKING LISTENER REMOVED');
    };
  }, []);

  // Zoom function using cursor position at click time (for buttons)
  const zoomToPointAtClick = useCallback((newZoom: number, clickX: number, clickY: number) => {
    console.log('🔍 BUTTON ZOOM START:', newZoom, 'from', canvas.zoom);
    console.log('🖱️ BUTTON CURSOR AT CLICK:', clickX, clickY);
    
    // Use canvas element for bounds (same as wheel zoom)
    const canvasElement = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvasElement) {
      console.log('❌ CANVAS NOT FOUND');
      return;
    }
    
    const rect = canvasElement.getBoundingClientRect();
    console.log('📐 BUTTON BOUNDS:', rect.left, rect.top, rect.width, rect.height);
    
    const relativeX = clickX - rect.left;
    const relativeY = clickY - rect.top;
    console.log('📍 BUTTON RELATIVE:', relativeX, relativeY);
    
    // Use same calculation as wheel zoom in DrawingCanvas
    // Convert cursor position to canvas coordinates before zoom
    const canvasPointX = relativeX / canvas.zoom - canvas.panX;
    const canvasPointY = relativeY / canvas.zoom - canvas.panY;
    console.log('🎯 BUTTON CANVAS POINT:', canvasPointX, canvasPointY);
    
    // Calculate new pan to keep the cursor point stationary
    const newPanX = relativeX / newZoom - canvasPointX;
    const newPanY = relativeY / newZoom - canvasPointY;
    console.log('🔄 BUTTON NEW PAN:', newPanX, newPanY, 'old:', canvas.panX, canvas.panY);
    
    // Update both zoom and pan
    setZoom(newZoom);
    setPan(newPanX, newPanY);
    
    console.log('✅ BUTTON ZOOM COMPLETE');
  }, [canvas.zoom, canvas.panX, canvas.panY, setZoom, setPan]);
  
  // Shared zoom function that uses last tracked cursor position (for slider)
  const zoomToPoint = useCallback((newZoom: number) => {
    // Use tracked cursor position
    const cursorX = lastCursorPos.current.x;
    const cursorY = lastCursorPos.current.y;
    zoomToPointAtClick(newZoom, cursorX, cursorY);
  }, [zoomToPointAtClick]);

  const handleZoomIn = (e: React.MouseEvent) => {
    console.log('🔍 ZOOM IN BUTTON CLICKED');
    const newZoom = Math.min(10, zoom * 1.25);
    // Use cursor position at click time, not last tracked position
    zoomToPointAtClick(newZoom, e.clientX, e.clientY);
  };

  const handleZoomOut = (e: React.MouseEvent) => {
    console.log('🔍 ZOOM OUT BUTTON CLICKED');
    const newZoom = Math.max(0.1, zoom * 0.8);
    // Use cursor position at click time, not last tracked position
    zoomToPointAtClick(newZoom, e.clientX, e.clientY);
  };

  const handleZoomReset = () => {
    setZoom(1);
  };

  const handleZoomFit = () => {
    // For now, just reset to 1x - can be enhanced later
    setZoom(1);
  };

  return (
    <div className="p-4 bg-[#2d2d2d] border-b border-[#404040]">
      <h3 className="text-sm font-medium mb-3 text-green-400">🔍 Zoom Controls (DEBUG)</h3>
      
      {/* Zoom Buttons */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">Zoom</label>
        <div className="flex gap-2 mb-2">
          <button
            onClick={handleZoomOut}
            className="flex-1 px-3 py-2 text-xs bg-[#404040] text-gray-300 rounded hover:bg-[#555] transition-colors"
            id="minus"
          >
            -
          </button>
          <div className="flex-1 px-3 py-2 text-xs bg-[#1a1a1a] text-white rounded text-center border border-[#404040]">
            {Math.round(zoom * 100)}%
          </div>
          <button
            onClick={handleZoomIn}
            className="flex-1 px-3 py-2 text-xs bg-[#404040] text-gray-300 rounded hover:bg-[#555] transition-colors"
            id="plus"
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
            console.log('🎚️ SLIDER CHANGED');
            const newZoom = parseFloat(e.target.value);
            zoomToPoint(newZoom);
          }}
          className="w-full h-2 bg-[#404040] rounded-lg appearance-none cursor-pointer slider"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>10%</span>
          <span>1000%</span>
        </div>
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

      {/* Keyboard Shortcuts */}
      <div className="pt-3 border-t border-[#404040]">
        <p className="text-xs text-gray-500 mb-2">Shortcuts:</p>
        <div className="text-xs text-gray-400 space-y-1">
          <div>Mouse wheel - Zoom in/out</div>
          <div>Ctrl/Cmd + 0 - Reset zoom</div>
          <div>Space - Pan (hold)</div>
        </div>
      </div>
    </div>
  );
}