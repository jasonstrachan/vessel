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

export default function DrawingCanvas({ width = 2000, height = 2000 }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const handleKeyUpRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const handleWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);
  const [isPanMode, setIsPanMode] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStartPoint, setPanStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [initialPan, setInitialPan] = useState<{ x: number; y: number } | null>(null);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [isCanvasInitialized, setIsCanvasInitialized] = useState(false);
  
  const {
    canvas,
    tools,
    setZoom,
    setCursor,
    setBrushSettings,
    setPan,
    setCanvasDimensions,
    toggleGrid
  } = useAppStore();
  
  const { renderBrushStroke, resetPixelQueue } = useBrushEngine();

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    
    const rect = canvasRef.current.getBoundingClientRect();
    // getBoundingClientRect() already accounts for CSS transforms including pan
    const x = (clientX - rect.left) / canvas.zoom;
    const y = (clientY - rect.top) / canvas.zoom;
    
    
    return { x, y };
  }, [canvas.zoom]);

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
    
    // Reset pixel queue for new stroke
    resetPixelQueue();
  }, [isPanMode, screenToCanvas, setCursor, canvas.panX, canvas.panY, resetPixelQueue]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning && panStartPoint && initialPan) {
      // Handle panning - convert screen deltas to canvas space
      const deltaX = (e.clientX - panStartPoint.x) / canvas.zoom;
      const deltaY = (e.clientY - panStartPoint.y) / canvas.zoom;
      const newPanX = initialPan.x + deltaX;
      const newPanY = initialPan.y + deltaY;
      
      
      setPan(newPanX, newPanY);
      return;
    }

    const point = screenToCanvas(e.clientX, e.clientY);
    
    // Store screen coordinates relative to canvas bounds for zoom calculations
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const screenRelativeX = e.clientX - rect.left;
      const screenRelativeY = e.clientY - rect.top;
      setCursor({ x: screenRelativeX, y: screenRelativeY, pressure: 1 });
    }

    if (isDrawing && lastPoint && canvasRef.current) {
      try {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          
          drawLine(ctx, lastPoint, point);
          setLastPoint(point);
        }
      } catch (error) {
        console.warn('Canvas drawing error:', error);
      }
    }
  }, [isPanning, panStartPoint, initialPan, canvas.zoom, setPan, screenToCanvas, setCursor, isDrawing, lastPoint, drawLine]);

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
    
    // Reset pixel queue for new stroke
    resetPixelQueue();
  }, [isPanMode, screenToCanvas, setCursor, canvas.panX, canvas.panY, resetPixelQueue]);

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
      try {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          drawLine(ctx, lastPoint, point);
          setLastPoint(point);
        }
      } catch (error) {
        console.warn('Canvas drawing error:', error);
      }
    }
  }, [isPanning, panStartPoint, initialPan, canvas.zoom, setPan, screenToCanvas, setCursor, isDrawing, lastPoint, drawLine]);

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
    
    // Grid toggle (Ctrl/Cmd + G)
    if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
      e.preventDefault();
      toggleGrid();
    }
  }, [setBrushSettings, tools.brushSettings.size, toggleGrid]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault();
      setIsPanMode(false);
      setIsPanning(false);
      setPanStartPoint(null);
      setInitialPan(null);
    }
  }, []);

  // Update refs when handlers change
  useEffect(() => {
    handleKeyDownRef.current = handleKeyDown;
    handleKeyUpRef.current = handleKeyUp;
    handleWheelRef.current = handleWheel;
  }, [handleKeyDown, handleKeyUp, handleWheel]);

  // Canvas dimensions tracking - measure and store canvas size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateCanvasDimensions = () => {
      const rect = canvas.getBoundingClientRect();
      setCanvasDimensions(rect.width, rect.height);
      console.log('📏 Canvas dimensions updated:', rect.width, rect.height);
    };

    // Initial measurement
    updateCanvasDimensions();

    // Listen for window resize events
    window.addEventListener('resize', updateCanvasDimensions);
    
    return () => {
      window.removeEventListener('resize', updateCanvasDimensions);
    };
  }, [setCanvasDimensions]);

  // Canvas initialization - only clear on first mount or size change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Setup canvas context with error handling
    try {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Only clear canvas if not initialized or size changed
        if (!isCanvasInitialized) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          setIsCanvasInitialized(true);
        }
      }
    } catch (error) {
      console.error('Canvas initialization error:', error);
    }
  }, [width, height, isCanvasInitialized]);

  // Event listeners setup - separate from canvas initialization
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Stable event handler wrappers
    const keyDownHandler = (e: KeyboardEvent) => handleKeyDownRef.current?.(e);
    const keyUpHandler = (e: KeyboardEvent) => handleKeyUpRef.current?.(e);
    const wheelHandler = (e: WheelEvent) => handleWheelRef.current?.(e);

    // Add keyboard event listeners
    window.addEventListener('keydown', keyDownHandler);
    window.addEventListener('keyup', keyUpHandler);
    
    // Add wheel event listener with active mode
    canvas.addEventListener('wheel', wheelHandler, { passive: false });
    
    return () => {
      window.removeEventListener('keydown', keyDownHandler);
      window.removeEventListener('keyup', keyUpHandler);
      canvas.removeEventListener('wheel', wheelHandler);
    };
  }, []); // Empty dependency array - stable event listeners

  // Show build timestamp on load
  useEffect(() => {
    const buildTime = process.env.BUILD_TIMESTAMP?.slice(0, 19).replace('T', ' ') || 'Development';
    setCurrentTime(buildTime);
    console.log(`🏗️ Build timestamp: ${buildTime}`);
  }, []);

  // Center the canvas on initial load
  useEffect(() => {
    if (!isCanvasInitialized) {
      const centerX = (window.innerWidth - width * canvas.zoom) / 2 / canvas.zoom;
      const centerY = (window.innerHeight - height * canvas.zoom) / 2 / canvas.zoom;
      setPan(centerX, centerY);
      setIsCanvasInitialized(true);
    }
  }, [width, height, canvas.zoom, setPan, isCanvasInitialized]);

  // Canvas styling without transforms - coordinate conversion handles zoom/pan
  const canvasStyle: React.CSSProperties = {
    cursor: isPanMode ? (isPanning ? 'grabbing' : 'grab') : (tools.currentTool === 'brush' ? 'crosshair' : 'default'),
    imageRendering: canvas.displayMode === 'smooth' ? 'auto' : 'pixelated'
  };

  return (
    <>
      <div className="w-full h-full bg-[#303030] flex items-center justify-center overflow-hidden">
        <div 
          style={{
            transform: `scale(${canvas.zoom}) translate(${canvas.panX}px, ${canvas.panY}px)`,
            transformOrigin: '0 0'
          }}
        >
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
        </div>
        
        {/* Grid overlay */}
        {canvas.showGrid && (
          <div 
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `
                linear-gradient(${
                  canvas.zoom >= 8 && canvas.gridSize === 1 
                    ? 'rgba(255,255,255,0.4)' 
                    : 'rgba(255,255,255,0.2)'
                } 1px, transparent 1px),
                linear-gradient(90deg, ${
                  canvas.zoom >= 8 && canvas.gridSize === 1 
                    ? 'rgba(255,255,255,0.4)' 
                    : 'rgba(255,255,255,0.2)'
                } 1px, transparent 1px)
              `,
              backgroundSize: `${canvas.gridSize * canvas.zoom}px ${canvas.gridSize * canvas.zoom}px`,
              backgroundPosition: `${canvas.panX * canvas.zoom}px ${canvas.panY * canvas.zoom}px`
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