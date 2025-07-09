'use client';

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { calculateZoomIncrement } from '../../utils/zoomUtils';

export default function ZoomControls() {
  const { canvas, setZoom, setPan } = useAppStore();
  const { zoom } = canvas;

  // Zoom at center of canvas since we don't have reliable cursor position from buttons
  const zoomAtCenter = (newZoom: number) => {
    // Get canvas element
    const canvasElement = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvasElement) {
      console.log('❌ No canvas found');
      return;
    }

    // Get canvas bounds
    const rect = canvasElement.getBoundingClientRect();
    
    // Calculate center of canvas in canvas coordinates
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    // Scale to canvas drawing buffer coordinates
    const scaleX = canvasElement.width / rect.width;
    const scaleY = canvasElement.height / rect.height;
    
    const canvasCenterX = centerX * scaleX;
    const canvasCenterY = centerY * scaleY;
    
    console.log('🔍 CENTER ZOOM:', {
      canvasBounds: { width: rect.width, height: rect.height },
      center: { x: canvasCenterX, y: canvasCenterY },
      currentZoom: canvas.zoom,
      newZoom
    });
    
    // Calculate world coordinates of center point
    const worldX = (canvasCenterX - canvas.panX) / canvas.zoom;
    const worldY = (canvasCenterY - canvas.panY) / canvas.zoom;
    
    // Calculate new pan to keep center point at center
    const newPanX = canvasCenterX - worldX * newZoom;
    const newPanY = canvasCenterY - worldY * newZoom;
    
    setZoom(newZoom);
    setPan(newPanX, newPanY);
  };

  const handleZoomIn = () => {
    console.log('🔍🔍🔍 ZOOM IN CLICKED - NEW CANVAS VERSION! 🔍🔍🔍');
    const newZoom = Math.min(10, calculateZoomIncrement(zoom, 'in'));
    zoomAtCenter(newZoom);
  };

  const handleZoomOut = () => {
    console.log('🔍🔍🔍 ZOOM OUT CLICKED - NEW CANVAS VERSION! 🔍🔍🔍');
    const newZoom = Math.max(0.1, calculateZoomIncrement(zoom, 'out'));
    zoomAtCenter(newZoom);
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
      <h3 className="text-sm font-medium mb-3 text-green-400">🔍 Zoom Controls (CANVAS)</h3>
      
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
            zoomAtCenter(newZoom);
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