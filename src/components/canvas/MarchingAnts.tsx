'use client';

import React, { useRef, useEffect } from 'react';
import { useAppStore } from '../../stores/useAppStore';

interface MarchingAntsProps {
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  zoom: number;
  panX: number;
  panY: number;
  canvasWidth: number;
  canvasHeight: number;
}

export default function MarchingAnts({ bounds, zoom, panX, panY, canvasWidth, canvasHeight }: MarchingAntsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const offsetRef = useRef(0);
  
  // Get editing state from store to make the component lifecycle-aware
  const isEditing = useAppStore((state) => state.brushEditing.isEditing);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // --- RESTRUCTURED LOGIC ---

    // Conditionally set up the animation only if we are in editing mode.
    if (isEditing) {
      const parent = canvas.parentElement;
      const resizeCanvas = () => {
        if (parent) {
          canvas.width = parent.clientWidth;
          canvas.height = parent.clientHeight;
        }
      };
      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);

      const drawMarchingAnts = () => {
        // No need for an extra state check here, the loop will be cancelled by cleanup.
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const screenX = bounds.x * zoom + panX;
        const screenY = bounds.y * zoom + panY;
        const screenWidth = bounds.width * zoom;
        const screenHeight = bounds.height * zoom;

        // Draw overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Create a "hole"
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillRect(screenX, screenY, screenWidth, screenHeight);
        ctx.globalCompositeOperation = 'source-over';

        // Draw ants border
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = offsetRef.current;
        ctx.strokeRect(screenX, screenY, screenWidth, screenHeight);

        ctx.strokeStyle = '#000000';
        ctx.lineDashOffset = offsetRef.current + 6;
        ctx.strokeRect(screenX, screenY, screenWidth, screenHeight);

        offsetRef.current = (offsetRef.current + 0.5) % 12;
        animationRef.current = requestAnimationFrame(drawMarchingAnts);
      };

      drawMarchingAnts();

      // The cleanup function is now tied to THIS effect instance
      return () => {
        console.log('🐜✨ MarchingAnts Cleanup: Cancelling animation and clearing canvas.');
        window.removeEventListener('resize', resizeCanvas);
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = 0;
        }
        if (ctx && canvas) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      };
    }

    // If isEditing is false, the effect does nothing but will still
    // have triggered the cleanup from the previous (true) state.
    // We can return an empty cleanup function for this case.
    return () => {};

  }, [isEditing, bounds, zoom, panX, panY]); // Removed canvasWidth/Height as they are derived inside

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-10"
    />
  );
}