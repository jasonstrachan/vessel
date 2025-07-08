'use client';

// Zoom controls component for canvas pan/zoom functionality
// Based on the same styling patterns as BrushControls.tsx

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';

export default function ZoomControls() {
  const { canvas, setZoom, setPan } = useAppStore();
  const { zoom } = canvas;

  // Zoom increment/decrement functions exactly following your specification
  const handleZoomIn = () => {
    const z = 1.25; // Your specification: z = 1.25 for zoom in
    const newZoom = Math.min(10, zoom * z);
    
    console.log(`🔍 Zoom In: ${zoom} -> ${newZoom} (factor: ${z})`);
    
    // Update offsets BEFORE applying zoom (following your spec exactly)
    const ocWidth = 800; // Canvas width - should match DrawingCanvas
    const ocHeight = 600; // Canvas height - should match DrawingCanvas
    
    // Your spec: state.panX -= ocWidth / 10 / zoom BEFORE zoom *= z
    const newPanX = canvas.panX - ocWidth / 10 / zoom;
    const newPanY = canvas.panY - ocHeight / 10 / zoom;
    
    console.log(`📍 Pan: (${canvas.panX}, ${canvas.panY}) -> (${newPanX}, ${newPanY})`);
    
    // Apply pan first, then zoom (following your sequence)
    setPan(newPanX, newPanY);
    setZoom(newZoom);
  };

  const handleZoomOut = () => {
    const z = 0.8; // Your specification: z = 0.8 for zoom out  
    const newZoom = Math.max(0.1, zoom * z);
    
    console.log(`🔍 Zoom Out: ${zoom} -> ${newZoom} (factor: ${z})`);
    
    // Update offsets BEFORE applying zoom (following your spec exactly)
    const ocWidth = 800; // Canvas width - should match DrawingCanvas
    const ocHeight = 600; // Canvas height - should match DrawingCanvas
    
    // Your spec: state.panX += ocWidth / 10 / zoom BEFORE zoom *= z  
    const newPanX = canvas.panX + ocWidth / 10 / zoom;
    const newPanY = canvas.panY + ocHeight / 10 / zoom;
    
    console.log(`📍 Pan: (${canvas.panX}, ${canvas.panY}) -> (${newPanX}, ${newPanY})`);
    
    // Apply pan first, then zoom (following your sequence)
    setPan(newPanX, newPanY);
    setZoom(newZoom);
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
            const newZoom = parseFloat(e.target.value);
            console.log(`🎚️ Slider zoom: ${zoom} -> ${newZoom}`);
            
            // Update offsets for slider zoom as well
            const ocWidth = 800;
            const ocHeight = 600;
            
            const zoomRatio = newZoom / zoom;
            let newPanX, newPanY;
            
            if (zoomRatio > 1) {
              // Zoom in
              newPanX = canvas.panX - ocWidth / 10 / zoom;
              newPanY = canvas.panY - ocHeight / 10 / zoom;
            } else {
              // Zoom out
              newPanX = canvas.panX + ocWidth / 10 / zoom;
              newPanY = canvas.panY + ocHeight / 10 / zoom;
            }
            
            setPan(newPanX, newPanY);
            setZoom(newZoom);
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