'use client';

import React from 'react';
import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from '../../constants/canvas';
import { useAppStore } from '../../stores/useAppStore';
import { calculateZoomIncrement } from '../../utils/zoomUtils';
import Input from '../ui/Input';

export default function ZoomControls() {
  const { canvas, setZoom } = useAppStore();
  const { zoom } = canvas;

  // Zoom at center of canvas since we don't have reliable cursor position from buttons
  const zoomAtCenter = (newZoom: number) => {
    const canvasElement = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvasElement) {
      return;
    }

    // Just set the zoom - panning is handled elsewhere
    setZoom(newZoom);
  };

  const handleZoomIn = () => {
    const newZoom = Math.min(MAX_CANVAS_ZOOM, calculateZoomIncrement(zoom, 'in'));
    zoomAtCenter(newZoom);
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(MIN_CANVAS_ZOOM, calculateZoomIncrement(zoom, 'out'));
    zoomAtCenter(newZoom);
  };

  const handleZoomReset = () => {
    setZoom(1);
    // TODO: Reset pan when we have access to pan state
  };

  const handleZoomFit = () => {
    setZoom(1);
    // TODO: Reset pan when we have access to pan state
  };

  return (
    <div className="p-4 bg-[#2d2d2d] border-b border-[#404040]">
      <h3 className="text-base font-medium mb-3 text-green-400">🔍 Zoom Controls (CANVAS)</h3>
      
      {/* Zoom Buttons */}
      <div className="mb-4">
        <label className="block text-base text-[#D9D9D9] mb-2">Zoom</label>
        <div className="flex gap-2 mb-2">
          <button
            onClick={handleZoomOut}
            className="flex-1 px-3 py-2 text-base bg-[#404040] text-[#D9D9D9] rounded hover:bg-[#555] transition-colors"
          >
            -
          </button>
          <div className="flex-1 px-3 py-2 text-base bg-[#1a1a1a] text-[#D9D9D9] rounded text-center border border-[#404040]">
            {Math.round(zoom * 100)}%
          </div>
          <button
            onClick={handleZoomIn}
            className="flex-1 px-3 py-2 text-base bg-[#404040] text-[#D9D9D9] rounded hover:bg-[#555] transition-colors"
          >
            +
          </button>
        </div>
      </div>

      {/* Zoom Slider */}
      <div className="mb-4">
        <label className="block text-base text-[#D9D9D9] mb-2">
          Zoom Level: {Math.round(zoom * 100)}%
        </label>
        <Input
          type="range"
          min={MIN_CANVAS_ZOOM}
          max={MAX_CANVAS_ZOOM}
          step="0.1"
          value={zoom}
          onChange={(e) => {
            const newZoom = parseFloat(e.target.value);
            zoomAtCenter(newZoom);
          }}
          fullWidth
        />
      </div>

      {/* Quick Actions */}
      <div className="mb-4">
        <div className="flex gap-2">
          <button
            onClick={handleZoomReset}
            className="flex-1 px-2 py-1 text-base bg-[#404040] text-[#D9D9D9] rounded hover:bg-[#555] transition-colors"
          >
            100%
          </button>
          <button
            onClick={handleZoomFit}
            className="flex-1 px-2 py-1 text-base bg-[#404040] text-[#D9D9D9] rounded hover:bg-[#555] transition-colors"
          >
            Fit
          </button>
        </div>
      </div>
    </div>
  );
}
