'use client';

// Basic Canvas Component with native Canvas API
// Based on /docs/02_System_Architecture/Overall_Design.md (lines 65-74)

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useBrushEngine } from '../../hooks/useBrushEngine';

interface DrawingCanvasProps {
  width?: number;
  height?: number;
}

export default function DrawingCanvas({ width = 800, height = 600 }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);
  const [isPanMode, setIsPanMode] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStartPoint, setPanStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [initialPan, setInitialPan] = useState<{ x: number; y: number } | null>(null);
  const [currentTime, setCurrentTime] = useState<string>('');
  
  const {
    canvas,
    tools,
    setZoom,
    setCursor,
    setBrushSettings,
    setPan
  } = useAppStore();
  
  const { renderBrushStroke } = useBrushEngine();

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (clientX - rect.left) / canvas.zoom - canvas.panX;
    const y = (clientY - rect.top) / canvas.zoom - canvas.panY;
    
    return { x, y };
  }, [canvas.zoom, canvas.panX, canvas.panY]);

  // Enhanced drawing function using brush engine
  const drawLine = useCallback((ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }) => {
    // Use the modular brush engine for rendering
    renderBrushStroke(ctx, from, to);
  }, [renderBrushStroke]);

  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isPanMode) {
      // Start panning
      setIsPanning(true);
      setPanStartPoint({ x: e.clientX, y: e.clientY });
      setInitialPan({ x: canvas.panX, y: canvas.panY });
      e.preventDefault();
      return;
    }

    const point = screenToCanvas(e.clientX, e.clientY);
    setIsDrawing(true);
    setLastPoint(point);
    setCursor({ x: point.x, y: point.y, pressure: 1 });
  }, [isPanMode, screenToCanvas, setCursor, canvas.panX, canvas.panY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning && panStartPoint && initialPan) {
      // Handle panning - convert screen deltas to canvas space
      const deltaX = (e.clientX - panStartPoint.x) / canvas.zoom;
      const deltaY = (e.clientY - panStartPoint.y) / canvas.zoom;
      setPan(initialPan.x + deltaX, initialPan.y + deltaY);
      return;
    }

    const point = screenToCanvas(e.clientX, e.clientY);
    setCursor({ x: point.x, y: point.y, pressure: 1 });

    if (isDrawing && lastPoint && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        drawLine(ctx, lastPoint, point);
        setLastPoint(point);
      }
    }
  }, [isPanning, panStartPoint, initialPan, setPan, screenToCanvas, setCursor, isDrawing, lastPoint, drawLine]);

  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      // End panning
      setIsPanning(false);
      setPanStartPoint(null);
      setInitialPan(null);
      return;
    }

    setIsDrawing(false);
    setLastPoint(null);
  }, [isPanning]);

  // Touch event handlers for mobile support
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    
    if (isPanMode) {
      // Start panning
      setIsPanning(true);
      setPanStartPoint({ x: touch.clientX, y: touch.clientY });
      setInitialPan({ x: canvas.panX, y: canvas.panY });
      return;
    }

    const point = screenToCanvas(touch.clientX, touch.clientY);
    setIsDrawing(true);
    setLastPoint(point);
    setCursor({ x: point.x, y: point.y, pressure: 1 });
  }, [isPanMode, screenToCanvas, setCursor, canvas.panX, canvas.panY]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    
    if (isPanning && panStartPoint && initialPan) {
      // Handle panning - convert screen deltas to canvas space
      const deltaX = (touch.clientX - panStartPoint.x) / canvas.zoom;
      const deltaY = (touch.clientY - panStartPoint.y) / canvas.zoom;
      setPan(initialPan.x + deltaX, initialPan.y + deltaY);
      return;
    }

    const point = screenToCanvas(touch.clientX, touch.clientY);
    setCursor({ x: point.x, y: point.y, pressure: 1 });

    if (isDrawing && lastPoint && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        drawLine(ctx, lastPoint, point);
        setLastPoint(point);
      }
    }
  }, [isPanning, panStartPoint, initialPan, setPan, screenToCanvas, setCursor, isDrawing, lastPoint, drawLine]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    
    if (isPanning) {
      // End panning
      setIsPanning(false);
      setPanStartPoint(null);
      setInitialPan(null);
      return;
    }

    setIsDrawing(false);
    setLastPoint(null);
  }, [isPanning]);

  // Wheel event for zoom (cursor-centered)
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    if (!canvasRef.current) return;
    
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = canvas.zoom * delta;
    
    // Get cursor position in screen coordinates
    const rect = canvasRef.current.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    
    // Convert cursor position to canvas coordinates before zoom
    const canvasPointX = cursorX / canvas.zoom - canvas.panX;
    const canvasPointY = cursorY / canvas.zoom - canvas.panY;
    
    // Calculate new pan to keep the cursor point stationary
    const newPanX = cursorX / newZoom - canvasPointX;
    const newPanY = cursorY / newZoom - canvasPointY;
    
    // Update both zoom and pan
    setZoom(newZoom);
    setPan(newPanX, newPanY);
  }, [canvas.zoom, canvas.panX, canvas.panY, setZoom, setPan]);

  // Keyboard event handlers
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Space key for pan mode
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      setIsPanMode(true);
    }
    
    // Brush size shortcuts
    if (e.key === '[') {
      setBrushSettings({ size: Math.max(1, tools.brushSettings.size - 1) });
    } else if (e.key === ']') {
      setBrushSettings({ size: Math.min(100, tools.brushSettings.size + 1) });
    }
  }, [setBrushSettings, tools.brushSettings.size]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault();
      setIsPanMode(false);
      setIsPanning(false);
      setPanStartPoint(null);
      setInitialPan(null);
    }
  }, []);

  // Setup canvas and event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Setup canvas context
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Clear canvas
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }

    // Add keyboard event listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    // Add wheel event listener with active mode
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [width, height, handleKeyDown, handleKeyUp, handleWheel]);

  // Show build timestamp on load
  useEffect(() => {
    const buildTime = process.env.BUILD_TIMESTAMP?.slice(0, 19).replace('T', ' ') || 'Development';
    setCurrentTime(buildTime);
    console.log(`🏗️ Build timestamp: ${buildTime}`);
  }, []);

  // Apply zoom and pan transforms
  const canvasStyle: React.CSSProperties = {
    transform: `scale(${canvas.zoom}) translate(${canvas.panX}px, ${canvas.panY}px)`,
    transformOrigin: '0 0',
    cursor: isPanMode ? (isPanning ? 'grabbing' : 'grab') : (tools.currentTool === 'brush' ? 'crosshair' : 'default'),
    imageRendering: tools.brushSettings.antialiasing ? 'auto' : 'pixelated'
  };

  return (
    <>
      <div className="w-full h-full bg-[#303030] flex items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={canvasStyle}
          className="border border-[#555] bg-white"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
        
        {/* Grid overlay */}
        {canvas.showGrid && (
          <div 
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,255,255,0.2) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.2) 1px, transparent 1px)
              `,
              backgroundSize: `${canvas.gridSize * canvas.zoom}px ${canvas.gridSize * canvas.zoom}px`,
              backgroundPosition: `${canvas.panX}px ${canvas.panY}px`
            }}
          />
        )}
      </div>
      
      {/* Current code timestamp overlay */}
      {currentTime && (
        <div className="fixed bottom-4 right-4 pointer-events-none text-xs text-white bg-red-600 px-2 py-1 rounded font-mono" style={{zIndex: 9999}}>
          {currentTime}
        </div>
      )}
    </>
  );
}