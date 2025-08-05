'use client';

import React, { useRef, useEffect } from 'react';

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match parent
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const drawMarchingAnts = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Transform bounds to screen coordinates (world to screen)
      const screenX = bounds.x * zoom + panX;
      const screenY = bounds.y * zoom + panY;
      const screenWidth = bounds.width * zoom;
      const screenHeight = bounds.height * zoom;

      // Draw 50% black overlay everywhere except the editing area
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Clear the editing area (create a "hole" in the overlay)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(screenX, screenY, screenWidth, screenHeight);
      ctx.globalCompositeOperation = 'source-over';

      // Set up marching ants style
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = offsetRef.current;

      // Draw selection rectangle
      ctx.strokeRect(screenX, screenY, screenWidth, screenHeight);

      // Draw second stroke with inverted color for better visibility
      ctx.strokeStyle = '#000000';
      ctx.lineDashOffset = offsetRef.current + 6;
      ctx.strokeRect(screenX, screenY, screenWidth, screenHeight);

      // Update animation offset
      offsetRef.current = (offsetRef.current + 0.5) % 12;

      animationRef.current = requestAnimationFrame(drawMarchingAnts);
    };

    drawMarchingAnts();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [bounds, zoom, panX, panY, canvasWidth, canvasHeight]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-10"
    />
  );
}