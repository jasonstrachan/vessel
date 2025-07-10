'use client';

// Basic Canvas Component with native Canvas API
// Based on /docs/02_System_Architecture/Overall_Design.md (lines 65-74)

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useBrushEngine } from '../../hooks/useBrushEngine';
import { calculateZoomIncrement } from '../../utils/zoomUtils';

interface DrawingCanvasProps {
  width?: number;
  height?: number;
}

export default function DrawingCanvas({ width = 2000, height = 2000 }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
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
  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  const [selectionDragStart, setSelectionDragStart] = useState<{ x: number; y: number } | null>(null);
  
  const {
    canvas,
    tools,
    setZoom,
    setCursor,
    setBrushSettings,
    setPan,
    setCanvasDimensions,
    toggleGrid,
    setSelection
  } = useAppStore();
  
  const { renderBrushStroke, resetPixelQueue } = useBrushEngine();

  // Handle clipboard paste for images
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    console.log('🎯 PASTE: Event triggered');
    e.preventDefault();
    
    if (!e.clipboardData) {
      console.log('❌ PASTE: No clipboard data');
      return;
    }
    
    const items = Array.from(e.clipboardData.items || []);
    console.log('📋 PASTE: Items found:', items.length, items.map(item => `${item.type}/${item.kind}`));
    
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (!imageItem) {
      console.log('❌ PASTE: No image item found');
      return;
    }
    
    console.log('🖼️ PASTE: Image item found:', imageItem.type);
    
    const file = imageItem.getAsFile();
    if (!file) {
      console.log('❌ PASTE: Could not get file from image item');
      return;
    }
    
    console.log('📄 PASTE: File obtained:', file.size, 'bytes, type:', file.type);
    
    try {
      const img = new Image();
      
      img.onload = () => {
        console.log('✅ PASTE: Image loaded successfully', img.width + 'x' + img.height);
        
        // Convert image to canvas-compatible format
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const ctx = tempCanvas.getContext('2d');
        
        if (!ctx) {
          console.log('❌ PASTE: Could not get canvas context');
          return;
        }
        
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        console.log('📊 PASTE: ImageData created', imageData.width + 'x' + imageData.height);
        
        // Get current cursor position in world coordinates
        const state = useAppStore.getState();
        const worldX = Math.round(state.canvas.cursor.x);
        const worldY = Math.round(state.canvas.cursor.y);
        console.log('📍 PASTE: Cursor position', worldX, worldY);
        
        // Create selection with pasted image
        const selection = {
          active: true,
          bounds: {
            x: worldX,
            y: worldY,
            width: img.width,
            height: img.height
          },
          pixels: imageData
        };
        console.log('📦 PASTE: Setting selection', selection.bounds);
        setSelection(selection);
        console.log('✅ PASTE: Selection set successfully');
      };
      
      img.onerror = (error) => {
        console.log('❌ PASTE: Image load error:', error);
      };
      
      const objectURL = URL.createObjectURL(file);
      console.log('🔗 PASTE: Object URL created, loading image...');
      img.src = objectURL;
    } catch (error) {
      console.log('❌ PASTE: Exception:', error);
    }
  }, [setSelection]);

  // Check if point is inside selection bounds
  const isPointInSelection = useCallback((worldX: number, worldY: number) => {
    if (!canvas.selection.active) return false;
    
    const { bounds } = canvas.selection;
    return worldX >= bounds.x && worldX <= bounds.x + bounds.width &&
           worldY >= bounds.y && worldY <= bounds.y + bounds.height;
  }, [canvas.selection]);

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
    
    // Disable image smoothing for pixel-perfect rendering
    ctx.imageSmoothingEnabled = false;
    
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
    
    // Draw selection overlay with marching ants
    if (canvas.selection.active) {
      console.log('🎨 RENDER: Drawing selection overlay');
      const { bounds, pixels } = canvas.selection;
      
      // Draw the pasted image
      if (pixels && pixels.width > 0 && pixels.height > 0) {
        console.log('🖼️ RENDER: Drawing pasted image at', bounds.x, bounds.y);
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = pixels.width;
        tempCanvas.height = pixels.height;
        const tempCtx = tempCanvas.getContext('2d');
        
        if (tempCtx) {
          tempCtx.putImageData(pixels, 0, 0);
          ctx.drawImage(tempCanvas, bounds.x, bounds.y);
        }
      }
      
      // Draw marching ants border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1 / canvas.zoom;
      ctx.setLineDash([4 / canvas.zoom, 4 / canvas.zoom]);
      ctx.lineDashOffset = -(Date.now() * 0.01) % (8 / canvas.zoom);
      
      ctx.beginPath();
      ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      ctx.stroke();
      
      // Draw white dashed border offset for contrast
      ctx.strokeStyle = '#ffffff';
      ctx.lineDashOffset = -(Date.now() * 0.01) % (8 / canvas.zoom) + (4 / canvas.zoom);
      
      ctx.beginPath();
      ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      ctx.stroke();
      
      // Reset line dash
      ctx.setLineDash([]);
      console.log('✅ RENDER: Marching ants drawn');
    }
    
    // Restore context state
    ctx.restore();
  }, [canvas.zoom, canvas.panX, canvas.panY, canvas.showGrid, canvas.gridSize, canvas.selection, width, height]);

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
    
    // Check if clicking on selection
    if (canvas.selection.active && isPointInSelection(point.x, point.y)) {
      setIsDraggingSelection(true);
      setSelectionDragStart(point);
      e.preventDefault();
      return;
    }

    setIsDrawing(true);
    setLastPoint(point);
    setCursor({ x: point.x, y: point.y, pressure: 1 });
    
    // Reset pixel queue for new stroke
    resetPixelQueue();
  }, [spacebarPressed, screenToCanvas, setCursor, resetPixelQueue, updateMousePosition, mouseX, mouseY, canvas.selection.active, isPointInSelection]);

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

    // Handle selection dragging
    if (isDraggingSelection && selectionDragStart) {
      const deltaX = point.x - selectionDragStart.x;
      const deltaY = point.y - selectionDragStart.y;
      
      setSelection({
        ...canvas.selection,
        bounds: {
          ...canvas.selection.bounds,
          x: canvas.selection.bounds.x + deltaX,
          y: canvas.selection.bounds.y + deltaY
        }
      });
      
      setSelectionDragStart(point);
      return;
    }

    if (isDrawing && lastPoint) {
      try {
        drawLine(lastPoint, point);
        setLastPoint(point);
      } catch (error) {
        console.warn('Canvas drawing error:', error);
      }
    }
  }, [isPanning, mouseX, mouseY, lastMouseX, lastMouseY, canvas.panX, canvas.panY, setPan, screenToCanvas, setCursor, isDrawing, lastPoint, drawLine, updateMousePosition, isDraggingSelection, selectionDragStart, canvas.selection, setSelection]);

  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      // End panning
      setIsPanning(false);
      return;
    }

    if (isDraggingSelection) {
      // End selection dragging
      setIsDraggingSelection(false);
      setSelectionDragStart(null);
      return;
    }

    setIsDrawing(false);
    setLastPoint(null);
  }, [isPanning, isDraggingSelection]);

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
    
    const oldZoom = canvas.zoom;
    
    // Determine zoom direction and calculate new zoom with curve
    let newZoom;
    if (e.deltaY < 0) {
      // Zoom in
      newZoom = Math.min(10, calculateZoomIncrement(oldZoom, 'in'));
    } else {
      // Zoom out
      newZoom = Math.max(0.1, calculateZoomIncrement(oldZoom, 'out'));
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

  // Commit selection to canvas
  const commitSelection = useCallback(() => {
    if (!canvas.selection.active) return;
    
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return;
    
    const offscreenCtx = offscreenCanvas.getContext('2d');
    if (!offscreenCtx) return;
    
    const { bounds, pixels } = canvas.selection;
    
    // Draw selection onto offscreen canvas
    if (pixels && pixels.width > 0 && pixels.height > 0) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = pixels.width;
      tempCanvas.height = pixels.height;
      const tempCtx = tempCanvas.getContext('2d');
      
      if (tempCtx) {
        tempCtx.putImageData(pixels, 0, 0);
        offscreenCtx.drawImage(tempCanvas, bounds.x, bounds.y);
      }
    }
    
    // Clear selection
    setSelection({
      active: false,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      pixels: typeof ImageData !== 'undefined' ? new ImageData(1, 1) : {} as ImageData
    });
    
    // Re-render view
    renderView();
  }, [canvas.selection, setSelection, renderView]);

  // Keyboard event handlers
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Space key for pan mode
    if (e.code === 'Space' && !spacebarPressed) {
      e.preventDefault();
      setSpacebarPressed(true);
    }
    
    // Selection controls
    if (canvas.selection.active) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitSelection();
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSelection({
          active: false,
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          pixels: typeof ImageData !== 'undefined' ? new ImageData(1, 1) : {} as ImageData
        });
        return;
      }
    }
    
    // Clipboard paste (Ctrl/Cmd + V)
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      console.log('⌨️ PASTE: Ctrl+V detected in keydown');
      e.preventDefault();
      
      // Try modern clipboard API as fallback
      if (navigator.clipboard && navigator.clipboard.read) {
        console.log('🔄 PASTE: Trying modern clipboard API fallback');
        navigator.clipboard.read().then(items => {
          console.log('📋 PASTE: Modern API items:', items);
          for (const item of items) {
            console.log('📋 PASTE: Item types:', item.types);
            for (const type of item.types) {
              if (type.startsWith('image/')) {
                console.log('🖼️ PASTE: Modern API found image:', type);
                item.getType(type).then(blob => {
                  console.log('📄 PASTE: Modern API got blob:', blob.size, 'bytes');
                  
                  const img = new Image();
                  img.onload = () => {
                    console.log('✅ PASTE: Modern API image loaded', img.width + 'x' + img.height);
                    
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = img.width;
                    tempCanvas.height = img.height;
                    const ctx = tempCanvas.getContext('2d');
                    
                    if (ctx) {
                      ctx.drawImage(img, 0, 0);
                      const imageData = ctx.getImageData(0, 0, img.width, img.height);
                      
                      const state = useAppStore.getState();
                      const worldX = Math.round(state.canvas.cursor.x);
                      const worldY = Math.round(state.canvas.cursor.y);
                      
                      setSelection({
                        active: true,
                        bounds: { x: worldX, y: worldY, width: img.width, height: img.height },
                        pixels: imageData
                      });
                      console.log('✅ PASTE: Modern API selection set');
                    }
                  };
                  img.src = URL.createObjectURL(blob);
                });
                return;
              }
            }
          }
        }).catch(err => {
          console.log('❌ PASTE: Modern API failed:', err);
        });
      }
      return;
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
  }, [spacebarPressed, setBrushSettings, tools.brushSettings.size, toggleGrid, canvas.selection.active, commitSelection, setSelection]);

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
        // Disable image smoothing for pixel-perfect rendering
        offscreenCtx.imageSmoothingEnabled = false;
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
    
    // Add clipboard event listener to multiple targets
    console.log('🔧 PASTE: Adding paste event listeners');
    window.addEventListener('paste', handlePaste);
    document.addEventListener('paste', handlePaste);
    canvasElement.addEventListener('paste', handlePaste);
    
    // Make canvas focusable
    canvasElement.tabIndex = 0;
    
    return () => {
      console.log('🔧 PASTE: Removing paste event listeners');
      window.removeEventListener('keydown', keyDownHandler);
      window.removeEventListener('keyup', keyUpHandler);
      canvasElement.removeEventListener('wheel', wheelHandler);
      window.removeEventListener('paste', handlePaste);
      document.removeEventListener('paste', handlePaste);
      canvasElement.removeEventListener('paste', handlePaste);
    };
  }, [handlePaste]); // Include handlePaste in dependency array

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

  // Animation loop for marching ants
  useEffect(() => {
    if (!canvas.selection.active) {
      return;
    }
    
    const animate = () => {
      renderView();
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [canvas.selection.active, renderView]);

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
      <div className="w-full h-full bg-[#141514] flex items-center justify-center overflow-hidden">
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
          onFocus={() => console.log('🎯 FOCUS: Canvas focused')}
          onBlur={() => console.log('🎯 FOCUS: Canvas blurred')}
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