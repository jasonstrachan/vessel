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
  const offscreenCanvasRef = useRef<HTMLCanvasElement>(null);
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const handleKeyUpRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const handleWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);
  // New zoom/pan state variables
  const [spacebarPressed, setSpacebarPressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [lastMouseX, setLastMouseX] = useState(0);
  const [lastMouseY, setLastMouseY] = useState(0);
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
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

  // Update mouse position and world coordinates
  const updateMousePosition = useCallback((event: { clientX: number; clientY: number }) => {
    if (!canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const clientXRelativeToCanvas = event.clientX - rect.left;
    const clientYRelativeToCanvas = event.clientY - rect.top;
    
    // Scale to canvas drawing buffer coordinates
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    
    const newMouseX = clientXRelativeToCanvas * scaleX;
    const newMouseY = clientYRelativeToCanvas * scaleY;
    
    setMouseX(newMouseX);
    setMouseY(newMouseY);
  }, []);
  
  // Convert screen coordinates to world coordinates
  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    
    const rect = canvasRef.current.getBoundingClientRect();
    const clientXRelativeToCanvas = clientX - rect.left;
    const clientYRelativeToCanvas = clientY - rect.top;
    
    // Scale to canvas drawing buffer coordinates
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    
    const mouseX = clientXRelativeToCanvas * scaleX;
    const mouseY = clientYRelativeToCanvas * scaleY;
    
    // Convert to world coordinates
    const worldX = (mouseX - canvas.panX) / canvas.zoom;
    const worldY = (mouseY - canvas.panY) / canvas.zoom;
    
    return { x: worldX, y: worldY };
  }, [canvas.zoom, canvas.panX, canvas.panY]);

  // Render the view with zoom/pan transformations
  const renderView = useCallback(() => {
    const canvasElement = canvasRef.current;
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!canvasElement || !offscreenCanvas) return;
    
    const ctx = canvasElement.getContext('2d');
    const offscreenCtx = offscreenCanvas.getContext('2d');
    if (!ctx || !offscreenCtx) return;
    
    // Clear the display canvas
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Save context state
    ctx.save();
    
    // Apply zoom and pan transformations
    ctx.translate(canvas.panX, canvas.panY);
    ctx.scale(canvas.zoom, canvas.zoom);
    
    // Draw the offscreen canvas (containing artwork) with transformations
    ctx.drawImage(offscreenCanvas, 0, 0);
    
    // Draw grid if enabled
    if (canvas.showGrid) {
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1 / canvas.zoom;
      const gridSize = canvas.gridSize || 50;
      
      // Draw vertical lines
      for (let x = 0; x <= width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      
      // Draw horizontal lines
      for (let y = 0; y <= height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }
    
    // Restore context state
    ctx.restore();
  }, [canvas.zoom, canvas.panX, canvas.panY, canvas.showGrid, canvas.gridSize, width, height]);

  // Enhanced drawing function - draws on offscreen canvas and re-renders view
  const drawLine = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return;
    
    const offscreenCtx = offscreenCanvas.getContext('2d');
    if (!offscreenCtx) return;
    
    // Draw on the offscreen canvas (no transformations - world coordinates)
    renderBrushStroke(offscreenCtx, from, to);
    
    // Re-render the view with current zoom/pan
    renderView();
  }, [renderBrushStroke, renderView]);

  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    updateMousePosition(e);
    
    if (spacebarPressed) {
      // Start panning
      setIsPanning(true);
      setLastMouseX(mouseX);
      setLastMouseY(mouseY);
      e.preventDefault();
      return;
    }

    const point = screenToCanvas(e.clientX, e.clientY);
    setIsDrawing(true);
    setLastPoint(point);
    setCursor({ x: point.x, y: point.y, pressure: 1 });
    
    // Reset pixel queue for new stroke
    resetPixelQueue();
  }, [spacebarPressed, screenToCanvas, setCursor, resetPixelQueue, updateMousePosition, mouseX, mouseY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    updateMousePosition(e);
    
    if (isPanning) {
      // Handle panning - calculate delta in canvas coordinates
      const deltaX = mouseX - lastMouseX;
      const deltaY = mouseY - lastMouseY;
      
      setPan(canvas.panX + deltaX, canvas.panY + deltaY);
      
      // Update last mouse position for next frame
      setLastMouseX(mouseX);
      setLastMouseY(mouseY);
      return;
    }

    const point = screenToCanvas(e.clientX, e.clientY);
    setCursor({ x: point.x, y: point.y, pressure: 1 });

    if (isDrawing && lastPoint) {
      try {
        drawLine(lastPoint, point);
        setLastPoint(point);
      } catch (error) {
        console.warn('Canvas drawing error:', error);
      }
    }
  }, [isPanning, mouseX, mouseY, lastMouseX, lastMouseY, canvas.panX, canvas.panY, setPan, screenToCanvas, setCursor, isDrawing, lastPoint, drawLine, updateMousePosition]);

  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      // End panning
      setIsPanning(false);
      return;
    }

    setIsDrawing(false);
    setLastPoint(null);
  }, [isPanning]);

  // Touch event handlers for mobile support
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    
    // Update mouse position from touch
    updateMousePosition(touch);
    
    if (spacebarPressed) {
      // Start panning
      setIsPanning(true);
      setLastMouseX(mouseX);
      setLastMouseY(mouseY);
      return;
    }

    const point = screenToCanvas(touch.clientX, touch.clientY);
    setIsDrawing(true);
    setLastPoint(point);
    setCursor({ x: point.x, y: point.y, pressure: 1 });
    
    // Reset pixel queue for new stroke
    resetPixelQueue();
  }, [spacebarPressed, screenToCanvas, setCursor, resetPixelQueue, updateMousePosition, mouseX, mouseY]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    
    // Update mouse position from touch
    updateMousePosition(touch);
    
    if (isPanning) {
      // Handle panning - calculate delta in canvas coordinates
      const deltaX = mouseX - lastMouseX;
      const deltaY = mouseY - lastMouseY;
      
      setPan(canvas.panX + deltaX, canvas.panY + deltaY);
      
      // Update last mouse position for next frame
      setLastMouseX(mouseX);
      setLastMouseY(mouseY);
      return;
    }

    const point = screenToCanvas(touch.clientX, touch.clientY);
    setCursor({ x: point.x, y: point.y, pressure: 1 });

    if (isDrawing && lastPoint) {
      try {
        drawLine(lastPoint, point);
        setLastPoint(point);
      } catch (error) {
        console.warn('Canvas drawing error:', error);
      }
    }
  }, [isPanning, mouseX, mouseY, lastMouseX, lastMouseY, canvas.panX, canvas.panY, setPan, screenToCanvas, setCursor, isDrawing, lastPoint, drawLine, updateMousePosition]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    
    if (isPanning) {
      // End panning
      setIsPanning(false);
      return;
    }

    setIsDrawing(false);
    setLastPoint(null);
  }, [isPanning]);

  // Wheel event for zoom (cursor-centered)
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    if (!canvasRef.current) return;
    
    // Update mouse position first
    updateMousePosition(e);
    
    const zoomSensitivity = 0.15;
    const oldZoom = canvas.zoom;
    
    // Determine zoom direction
    let newZoom;
    if (e.deltaY < 0) {
      // Zoom in
      newZoom = oldZoom + zoomSensitivity;
    } else {
      // Zoom out
      newZoom = oldZoom - zoomSensitivity;
      if (newZoom < 0.1) newZoom = 0.1; // Minimum zoom
    }
    
    // Calculate world coordinates that should remain under cursor
    const worldX = (mouseX - canvas.panX) / oldZoom;
    const worldY = (mouseY - canvas.panY) / oldZoom;
    
    // Calculate new pan to keep world point under cursor
    const newPanX = mouseX - worldX * newZoom;
    const newPanY = mouseY - worldY * newZoom;
    
    // Update zoom and pan
    setZoom(newZoom);
    setPan(newPanX, newPanY);
  }, [canvas.zoom, canvas.panX, canvas.panY, mouseX, mouseY, setZoom, setPan, updateMousePosition]);

  // Keyboard event handlers
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Space key for pan mode
    if (e.code === 'Space' && !spacebarPressed) {
      e.preventDefault();
      setSpacebarPressed(true);
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
  }, [spacebarPressed, setBrushSettings, tools.brushSettings.size, toggleGrid]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault();
      setSpacebarPressed(false);
      setIsPanning(false);
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
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    const updateCanvasDimensions = () => {
      const rect = canvasElement.getBoundingClientRect();
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

  // Initialize canvases - main display and offscreen drawing buffer
  const initializeCanvas = useCallback(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    
    const ctx = canvasElement.getContext('2d');
    if (!ctx) return;
    
    // Create offscreen canvas for storing artwork
    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
      offscreenCanvasRef.current.width = width;
      offscreenCanvasRef.current.height = height;
      
      // Initialize offscreen canvas with white background
      const offscreenCtx = offscreenCanvasRef.current.getContext('2d');
      if (offscreenCtx) {
        offscreenCtx.fillStyle = '#ffffff';
        offscreenCtx.fillRect(0, 0, width, height);
      }
    }
  }, [width, height]);

  // Canvas initialization - only setup on first mount
  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    // Setup canvas context with error handling
    try {
      const ctx = canvasElement.getContext('2d');
      if (ctx) {
        // Only initialize once
        if (!isCanvasInitialized) {
          initializeCanvas();
          setIsCanvasInitialized(true);
        }
      }
    } catch (error) {
      console.error('Canvas initialization error:', error);
    }
  }, [isCanvasInitialized, initializeCanvas]);

  // Event listeners setup - separate from canvas initialization
  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    // Stable event handler wrappers
    const keyDownHandler = (e: KeyboardEvent) => handleKeyDownRef.current?.(e);
    const keyUpHandler = (e: KeyboardEvent) => handleKeyUpRef.current?.(e);
    const wheelHandler = (e: WheelEvent) => handleWheelRef.current?.(e);

    // Add keyboard event listeners
    window.addEventListener('keydown', keyDownHandler);
    window.addEventListener('keyup', keyUpHandler);
    
    // Add wheel event listener with active mode
    canvasElement.addEventListener('wheel', wheelHandler, { passive: false });
    
    return () => {
      window.removeEventListener('keydown', keyDownHandler);
      window.removeEventListener('keyup', keyUpHandler);
      canvasElement.removeEventListener('wheel', wheelHandler);
    };
  }, []); // Empty dependency array - stable event listeners

  // Show build timestamp on load
  useEffect(() => {
    const buildTime = process.env.BUILD_TIMESTAMP?.slice(0, 19).replace('T', ' ') || 'Development';
    setCurrentTime(buildTime);
    console.log(`🏗️ Build timestamp: ${buildTime}`);
  }, []);

  // Re-render view when zoom/pan changes
  useEffect(() => {
    if (isCanvasInitialized) {
      renderView();
    }
  }, [canvas.zoom, canvas.panX, canvas.panY, canvas.showGrid, renderView, isCanvasInitialized]);

  // Canvas styling with cursor updates
  const canvasStyle: React.CSSProperties = {
    cursor: spacebarPressed ? (isPanning ? 'grabbing' : 'grab') : (tools.currentTool === 'brush' ? 'crosshair' : 'default'),
    imageRendering: canvas.displayMode === 'smooth' ? 'auto' : 'pixelated'
  };

  // Add document mousemove listener for better mouse tracking
  useEffect(() => {
    const handleDocumentMouseMove = (e: MouseEvent) => {
      updateMousePosition(e);
      
      if (isPanning) {
        // Handle panning when mouse moves outside canvas
        const deltaX = mouseX - lastMouseX;
        const deltaY = mouseY - lastMouseY;
        
        setPan(canvas.panX + deltaX, canvas.panY + deltaY);
        
        setLastMouseX(mouseX);
        setLastMouseY(mouseY);
      }
    };
    
    const handleDocumentMouseUp = () => {
      if (isPanning) {
        setIsPanning(false);
      }
    };
    
    document.body.addEventListener('mousemove', handleDocumentMouseMove);
    document.body.addEventListener('mouseup', handleDocumentMouseUp);
    
    return () => {
      document.body.removeEventListener('mousemove', handleDocumentMouseMove);
      document.body.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [isPanning, mouseX, mouseY, lastMouseX, lastMouseY, canvas.panX, canvas.panY, setPan, updateMousePosition]);

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