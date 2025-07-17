'use client';

// Basic Canvas Component with native Canvas API
// Based on /docs/02_System_Architecture/Overall_Design.md (lines 65-74)

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useBrushEngine } from '../../hooks/useBrushEngine';
import { calculateZoomIncrement } from '../../utils/zoomUtils';
import { floodFill, type FloodFillColor } from '../../utils/floodFill';
import { restoreCanvasSnapshot } from '../../utils/canvasSnapshot';
import type { Tool } from '../../types';
import { BrushShape } from '../../types';
import BrushCursor from './BrushCursor';

interface DrawingCanvasProps {
  width?: number;
  height?: number;
}

export default function DrawingCanvas({ width = 2000, height = 2000 }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
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
  const [isCanvasInitialized, setIsCanvasInitialized] = useState(false);
  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  const [selectionDragStart, setSelectionDragStart] = useState<{ x: number; y: number } | null>(null);
  // Selection creation state
  const [isSelecting, setIsSelecting] = useState(false);
  // E key for temporary eraser mode
  const [eKeyPressed, setEKeyPressed] = useState(false);
  const [toolBeforeEraser, setToolBeforeEraser] = useState<Tool | null>(null);
  // Alt key for temporary eyedropper mode
  const [altKeyPressed, setAltKeyPressed] = useState(false);
  const [toolBeforeEyedropper, setToolBeforeEyedropper] = useState<Tool | null>(null);
  // Eyedropper preview state
  const [previewColor, setPreviewColor] = useState<string | null>(null);
  const [previewPosition, setPreviewPosition] = useState<{ x: number; y: number } | null>(null);
  // Brush cursor state
  const [showBrushCursor, setShowBrushCursor] = useState(false);
  const [isMouseOverCanvas, setIsMouseOverCanvas] = useState(false);
  const [cursorScreenX, setCursorScreenX] = useState(0);
  const [cursorScreenY, setCursorScreenY] = useState(0);
  
  const {
    canvas,
    tools,
    project,
    history,
    layers,
    layersNeedRecomposition,
    activeLayerId,
    setZoom,
    setCursor,
    setBrushSettings,
    setPan,
    setCanvasDimensions,
    toggleGrid,
    setSelection,
    setCurrentTool,
    selectionStart,
    selectionEnd,
    setSelectionBounds,
    clearSelection,
    addCustomBrush,
    addLayer,
    updateLayer,
    saveCanvasState,
    undo,
    redo,
    canUndo,
    canRedo,
    compositeLayersToCanvas,
    setLayersNeedRecomposition,
    captureCanvasToActiveLayer,
    setProjectDimensions,
  } = useAppStore();
  
  const { renderBrushStroke, resetPixelQueue } = useBrushEngine();

  // Handle clipboard paste for images
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    e.preventDefault();
    
    if (!e.clipboardData) {
      return;
    }
    
    const items = Array.from(e.clipboardData.items || []);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (!imageItem) {
      return;
    }
    
    const file = imageItem.getAsFile();
    if (!file) {
      return;
    }
    
    try {
      const img = new Image();
      
      img.onload = () => {
        // Convert image to canvas-compatible format
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const ctx = tempCanvas.getContext('2d', { willReadFrequently: true });
        
        if (!ctx) {
          return;
        }
        
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        
        // Get current cursor position in world coordinates
        const state = useAppStore.getState();
        const worldX = Math.round(state.canvas.cursor.x);
        const worldY = Math.round(state.canvas.cursor.y);
        
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
        setSelection(selection);
      };
      
      img.onerror = (error) => {
      };
      
      const objectURL = URL.createObjectURL(file);
      img.src = objectURL;
    } catch (error) {
    }
  }, [setSelection]);

  // Check if point is inside selection bounds
  const isPointInSelection = useCallback((worldX: number, worldY: number) => {
    if (!canvas.selection.active) return false;
    
    const { bounds } = canvas.selection;
    return worldX >= bounds.x && worldX <= bounds.x + bounds.width &&
           worldY >= bounds.y && worldY <= bounds.y + bounds.height;
  }, [canvas.selection]);

  // Sample color from canvas at world coordinates
  const sampleColor = useCallback((worldX: number, worldY: number) => {
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return null;
    
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    if (!offscreenCtx) return null;
    
    // Ensure coordinates are within bounds
    const x = Math.floor(Math.max(0, Math.min(worldX, offscreenCanvas.width - 1)));
    const y = Math.floor(Math.max(0, Math.min(worldY, offscreenCanvas.height - 1)));
    
    try {
      const imageData = offscreenCtx.getImageData(x, y, 1, 1);
      const [r, g, b] = imageData.data;
      
      // Convert to hex color
      const hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      return hexColor;
    } catch (error) {
      return null;
    }
  }, []);

  // Shared coordinate transformation function
  const transformScreenToCanvas = useCallback((clientX: number, clientY: number) => {
    // Ensure both the wrapper and canvas refs are available
    if (!canvasRef.current || !wrapperRef.current) {
      return { canvasX: 0, canvasY: 0, worldX: 0, worldY: 0 };
    }

    const canvasEl = canvasRef.current;
    const wrapperEl = wrapperRef.current;

    // 1. Get the position of our stable wrapper element.
    const wrapperRect = wrapperEl.getBoundingClientRect();

    // 2. Calculate mouse position relative to the wrapper's top-left corner.
    // This gives us a coordinate within our local system, immune to parent transforms.
    const mouseXInWrapper = clientX - wrapperRect.left;
    const mouseYInWrapper = clientY - wrapperRect.top;

    // 3. Adjust for the canvas border to get the coordinate relative to the drawable area.
    // This gives us the final coordinate in "Canvas CSS Pixels".
    const canvasCssX = mouseXInWrapper - canvasEl.clientLeft;
    const canvasCssY = mouseYInWrapper - canvasEl.clientTop;

    // 4. Convert to world coordinates by inverting the pan and zoom transformation.
    // Since your canvas logical buffer size and CSS display size are identical,
    // no extra scaling is needed here.
    const worldX = (canvasCssX - canvas.panX) / canvas.zoom;
    const worldY = (canvasCssY - canvas.panY) / canvas.zoom;

    return { canvasX: canvasCssX, canvasY: canvasCssY, worldX, worldY };
  }, [canvas.zoom, canvas.panX, canvas.panY]);

  // Update mouse position and world coordinates
  const updateMousePosition = useCallback((event: { clientX: number; clientY: number }, isCanvasEvent: boolean = false) => {
    if (!canvasRef.current || !wrapperRef.current) return;
    
    const coords = transformScreenToCanvas(event.clientX, event.clientY);
    
    setMouseX(coords.canvasX);
    setMouseY(coords.canvasY);
    
    
    // SIMPLE FIX: Use raw coordinates - if painting works, this should too
    // The coordinate system alignment happens in the coordinate transformation functions
    setCursorScreenX(event.clientX);
    setCursorScreenY(event.clientY);
    
    
    
    
    // Show brush cursor for brush-like tools (optimized to avoid unnecessary updates)
    const shouldShowBrushCursor = (tools.currentTool === 'brush' || tools.currentTool === 'eraser') && !spacebarPressed && isMouseOverCanvas;
    setShowBrushCursor(prev => prev !== shouldShowBrushCursor ? shouldShowBrushCursor : prev);
  }, [transformScreenToCanvas, canvas.panX, canvas.panY, canvas.zoom, tools.currentTool, spacebarPressed, isMouseOverCanvas]);
  
  // Convert screen coordinates to world coordinates
  // SIMPLIFIED: Use same coordinate system as cursor positioning for alignment
  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    
    const rect = canvasRef.current.getBoundingClientRect();
    
    // Use same coordinate system as cursor positioning
    // Canvas is positioned absolutely within its wrapper, so coordinates align directly
    const canvasX = clientX - rect.left;
    const canvasY = clientY - rect.top;
    
    // Convert to world coordinates (no scaling needed if canvas CSS size matches logical size)
    const worldX = (canvasX - canvas.panX) / canvas.zoom;
    const worldY = (canvasY - canvas.panY) / canvas.zoom;
    
    return { x: worldX, y: worldY };
  }, [canvas.panX, canvas.panY, canvas.zoom]);

  // Cached checkerboard pattern for performance
  const checkerboardPattern = useMemo(() => {
    if (typeof document === 'undefined') return null; // SSR safety
    
    const checkSize = 20;
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = checkSize * 2;
    patternCanvas.height = checkSize * 2;
    const patternCtx = patternCanvas.getContext('2d');
    if (!patternCtx) return null;
    
    // Create 2x2 checkerboard pattern
    patternCtx.fillStyle = '#fff';
    patternCtx.fillRect(0, 0, patternCanvas.width, patternCanvas.height);
    patternCtx.fillStyle = '#ccc';
    patternCtx.fillRect(0, 0, checkSize, checkSize);
    patternCtx.fillRect(checkSize, checkSize, checkSize, checkSize);
    
    return patternCanvas;
  }, []);

  // Render the view with zoom/pan transformations
  const renderView = useCallback(() => {
    const canvasElement = canvasRef.current;
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!canvasElement || !offscreenCanvas) return;
    
    const ctx = canvasElement.getContext('2d', { willReadFrequently: true });
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !offscreenCtx) return;
    
    // Disable image smoothing for pixel-perfect rendering
    ctx.imageSmoothingEnabled = false;
    
    // Clear the display canvas (use logical coordinates since context is already scaled)
    ctx.clearRect(0, 0, width, height);
    
    // Save context state
    ctx.save();
    
    // Apply zoom and pan transformations (devicePixelRatio scaling already applied in initialization)
    ctx.translate(canvas.panX, canvas.panY);
    ctx.scale(canvas.zoom, canvas.zoom);
    
    
    // Draw checkerboard pattern as background for transparency
    if (checkerboardPattern) {
      const pattern = ctx.createPattern(checkerboardPattern, 'repeat');
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
      }
    }
    
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
      const { bounds, pixels } = canvas.selection;
      
      // Draw the pasted image
      if (pixels && pixels.width > 0 && pixels.height > 0) {
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
    }
    
    // Draw selection creation overlay with marching ants
    if (selectionStart && selectionEnd) {
      const minX = Math.min(selectionStart.x, selectionEnd.x);
      const minY = Math.min(selectionStart.y, selectionEnd.y);
      const maxX = Math.max(selectionStart.x, selectionEnd.x);
      const maxY = Math.max(selectionStart.y, selectionEnd.y);
      const width = maxX - minX;
      const height = maxY - minY;
      
      // Draw marching ants border for selection creation
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1 / canvas.zoom;
      ctx.setLineDash([4 / canvas.zoom, 4 / canvas.zoom]);
      ctx.lineDashOffset = -(Date.now() * 0.01) % (8 / canvas.zoom);
      
      ctx.beginPath();
      ctx.rect(minX, minY, width, height);
      ctx.stroke();
      
      // Draw white dashed border offset for contrast
      ctx.strokeStyle = '#ffffff';
      ctx.lineDashOffset = -(Date.now() * 0.01) % (8 / canvas.zoom) + (4 / canvas.zoom);
      
      ctx.beginPath();
      ctx.rect(minX, minY, width, height);
      ctx.stroke();
      
      // Reset line dash
      ctx.setLineDash([]);
    }
    
    // Restore context state
    ctx.restore();
  }, [canvas.zoom, canvas.panX, canvas.panY, canvas.showGrid, canvas.gridSize, canvas.selection, width, height, selectionStart, selectionEnd, checkerboardPattern]);

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

  // Create custom brush from current selection
  const createCustomBrushFromSelection = useCallback(async () => {
    
    if (!selectionStart || !selectionEnd || !project) {
      return null;
    }
    
    // Calculate selection bounds
    const minX = Math.floor(Math.min(selectionStart.x, selectionEnd.x));
    const minY = Math.floor(Math.min(selectionStart.y, selectionEnd.y));
    const maxX = Math.floor(Math.max(selectionStart.x, selectionEnd.x));
    const maxY = Math.floor(Math.max(selectionStart.y, selectionEnd.y));
    const width = maxX - minX;
    const height = maxY - minY;
    
    
    if (width <= 0 || height <= 0) {
      return null;
    }
    
    // Create canvas to capture the selection
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = width;
    captureCanvas.height = height;
    const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
    
    if (!captureCtx) {
      return null;
    }
    
    // Get the offscreen canvas (contains actual drawing without overlays)
    const layerCanvas = offscreenCanvasRef.current;
    if (!layerCanvas) {
      return null;
    }
    
    
    // Capture the selection area from the offscreen canvas (no zoom/pan needed)
    try {
      // Offscreen canvas contains raw drawing data without transformations
      const sourceX = minX;
      const sourceY = minY;
      const sourceWidth = width;
      const sourceHeight = height;
      
      
      captureCtx.drawImage(
        layerCanvas,
        sourceX, sourceY, sourceWidth, sourceHeight, // Source rectangle (world space)
        0, 0, width, height        // Destination rectangle (brush space)
      );
      
    } catch (error) {
      return null;
    }
    
    // Get ImageData for the brush
    const imageData = captureCtx.getImageData(0, 0, width, height);
    
    // Create thumbnail (max 64x64)
    const thumbnailSize = 64;
    const thumbnailCanvas = document.createElement('canvas');
    thumbnailCanvas.width = thumbnailSize;
    thumbnailCanvas.height = thumbnailSize;
    const thumbnailCtx = thumbnailCanvas.getContext('2d');
    
    if (thumbnailCtx) {
      // Scale to fit thumbnail while maintaining aspect ratio
      const scale = Math.min(thumbnailSize / width, thumbnailSize / height);
      const scaledWidth = width * scale;
      const scaledHeight = height * scale;
      const offsetX = (thumbnailSize - scaledWidth) / 2;
      const offsetY = (thumbnailSize - scaledHeight) / 2;
      
      // Set background to transparent
      thumbnailCtx.clearRect(0, 0, thumbnailSize, thumbnailSize);
      
      // Draw scaled capture
      thumbnailCtx.drawImage(
        captureCanvas,
        offsetX, offsetY, scaledWidth, scaledHeight
      );
    }
    
    // Create custom brush object
    const customBrush = {
      id: `brush_${Date.now()}`,
      name: `Custom ${(project?.customBrushes?.length || 0) + 1}`,
      imageData,
      thumbnail: thumbnailCanvas.toDataURL(),
      width,
      height,
      createdAt: Date.now()
    };
    
    // Add the brush to the project
    addCustomBrush(customBrush);
    
    // Auto-select the newly created custom brush
    setBrushSettings({ 
      brushShape: BrushShape.CUSTOM,
      selectedCustomBrush: customBrush.id,
      size: 100 // Default to 100% (original size) for custom brushes
    });
    
    // Switch to brush tool for immediate use
    setCurrentTool('brush');
    
    // Clear the selection
    clearSelection();
    
    
    return customBrush;
  }, [selectionStart, selectionEnd, project, canvas.zoom, canvas.panX, canvas.panY, addCustomBrush, setBrushSettings, setCurrentTool, clearSelection]);

  // Pointer event handlers (supports pressure from stylus/pen)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    updateMousePosition(e, true); // Canvas event
    
    if (spacebarPressed) {
      // Start panning
      setIsPanning(true);
      setLastMouseX(mouseX);
      setLastMouseY(mouseY);
      e.preventDefault();
      return;
    }

    const point = screenToCanvas(e.clientX, e.clientY);
    
    // Handle eyedropper tool
    if (tools.currentTool === 'eyedropper') {
      const color = sampleColor(point.x, point.y);
      if (color) {
        setBrushSettings({ color });
      }
      e.preventDefault();
      return;
    }

    // Handle fill tool
    if (tools.currentTool === 'fill') {
      const offscreenCanvas = offscreenCanvasRef.current;
      if (offscreenCanvas) {
        // Capture state before fill operation
        saveCanvasState(offscreenCanvas, 'fill', 'Fill operation');
        
        // Get current canvas image data
        const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
          
          // Convert brush color to FloodFillColor format
          const colorMatch = tools.brushSettings.color.match(/^#([0-9a-f]{6})$/i);
          if (colorMatch) {
            const hex = colorMatch[1];
            const fillColor: FloodFillColor = {
              r: parseInt(hex.substr(0, 2), 16),
              g: parseInt(hex.substr(2, 2), 16),
              b: parseInt(hex.substr(4, 2), 16),
              a: Math.round(tools.brushSettings.opacity * 255)
            };

            // Perform flood fill
            const filledImageData = floodFill(imageData, Math.floor(point.x), Math.floor(point.y), fillColor, {
              threshold: tools.fillSettings.threshold,
              contiguous: tools.fillSettings.contiguous
            });

            // Apply the filled image data back to the canvas
            ctx.putImageData(filledImageData, 0, 0);
            
            // Re-render the view
            renderView();
          }
        }
      }
      e.preventDefault();
      return;
    }
    
    // Handle selection and custom brush tools - start new selection
    if (tools.currentTool === 'selection' || tools.currentTool === 'custom') {
      setIsSelecting(true);
      setSelectionBounds(point, point);
      e.preventDefault();
      return;
    }
    
    // Check if clicking on selection
    if (canvas.selection.active && isPointInSelection(point.x, point.y)) {
      setIsDraggingSelection(true);
      setSelectionDragStart(point);
      e.preventDefault();
      return;
    }

    // Capture state before drawing operation
    const offscreenCanvas = offscreenCanvasRef.current;
    if (offscreenCanvas) {
      const actionType = tools.currentTool === 'eraser' ? 'eraser' : 'brush';
      saveCanvasState(offscreenCanvas, actionType, `${actionType} stroke`);
    }
    
    setIsDrawing(true);
    setLastPoint(point);
    // Get pressure from pointer event (0.0 to 1.0), fallback to 0.0 for non-pressure devices when pressure is enabled
    const pressure = e.pressure || (tools.brushSettings.pressureEnabled ? 0.0 : 1.0);
    setCursor({ x: point.x, y: point.y, pressure });
    
    // Reset pixel queue for new stroke
    resetPixelQueue();
  }, [spacebarPressed, screenToCanvas, setCursor, resetPixelQueue, updateMousePosition, mouseX, mouseY, canvas.selection.active, isPointInSelection, tools.currentTool, sampleColor, setBrushSettings, setSelectionBounds, setIsSelecting, saveCanvasState, offscreenCanvasRef]);

  // RAF-throttled pointer event processing for performance
  const pendingPointerEvent = useRef<React.PointerEvent | null>(null);
  const rafId = useRef<number | undefined>(undefined);

  // Pressure smoothing for stylus input
  const pressureHistory = useRef<number[]>([]);
  const smoothPressure = useCallback((rawPressure: number) => {
    const maxHistorySize = 3;
    pressureHistory.current.push(rawPressure);
    if (pressureHistory.current.length > maxHistorySize) {
      pressureHistory.current.shift();
    }
    
    // Simple moving average
    const sum = pressureHistory.current.reduce((a, b) => a + b, 0);
    return sum / pressureHistory.current.length;
  }, []);

  // Palm rejection - track stylus state
  const isStylusActive = useRef(false);
  const lastStylusTime = useRef(0);
  
  const isPalmRejectionEvent = useCallback((e: React.PointerEvent) => {
    const currentTime = Date.now();
    
    // If this is a stylus event, mark it as active
    if (e.pointerType === 'pen') {
      isStylusActive.current = true;
      lastStylusTime.current = currentTime;
      return false;
    }
    
    // If this is a touch event but stylus was active recently (within 100ms), reject it
    if (e.pointerType === 'touch' && isStylusActive.current && 
        currentTime - lastStylusTime.current < 100) {
      return true;
    }
    
    // Reset stylus state if no stylus events for a while
    if (currentTime - lastStylusTime.current > 500) {
      isStylusActive.current = false;
    }
    
    return false;
  }, []);

  const processPointerMove = useCallback((e: React.PointerEvent) => {
    // Check for palm rejection
    if (isPalmRejectionEvent(e)) {
      return;
    }
    
    updateMousePosition(e, true); // Canvas event
    
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
    // Get pressure from pointer event (0.0 to 1.0), fallback to 0.0 for non-pressure devices when pressure is enabled
    const rawPressure = e.pressure || (tools.brushSettings.pressureEnabled ? 0.0 : 1.0);
    const smoothedPressure = smoothPressure(rawPressure);
    setCursor({ x: point.x, y: point.y, pressure: smoothedPressure });

    // Handle eyedropper color preview
    if (tools.currentTool === 'eyedropper') {
      const color = sampleColor(point.x, point.y);
      setPreviewColor(color);
      setPreviewPosition({ x: e.clientX, y: e.clientY });
    } else {
      setPreviewColor(null);
      setPreviewPosition(null);
    }

    // Handle selection creation dragging
    if (isSelecting && selectionStart) {
      setSelectionBounds(selectionStart, point);
      return;
    }
    
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
      }
    }
  }, [isPanning, mouseX, mouseY, lastMouseX, lastMouseY, canvas.panX, canvas.panY, setPan, screenToCanvas, setCursor, isDrawing, lastPoint, drawLine, updateMousePosition, isDraggingSelection, selectionDragStart, canvas.selection, setSelection, isSelecting, selectionStart, setSelectionBounds, smoothPressure, isPalmRejectionEvent]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    // Process immediately for drawing - pressure data is critical and cannot be throttled
    if (isDrawing) {
      processPointerMove(e);
      return;
    }
    
    // Only throttle non-drawing interactions for performance
    pendingPointerEvent.current = e;
    
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
    }
    
    rafId.current = requestAnimationFrame(() => {
      if (pendingPointerEvent.current) {
        processPointerMove(pendingPointerEvent.current);
        pendingPointerEvent.current = null;
      }
    });
  }, [processPointerMove, isDrawing]);

  const handlePointerUp = useCallback(async () => {
    
    if (isPanning) {
      // End panning
      setIsPanning(false);
      return;
    }

    if (isSelecting) {
      // End selection creation
      setIsSelecting(false);
      
      // If custom tool is active, automatically create a custom brush
      if (tools.currentTool === 'custom' && selectionStart && selectionEnd && project) {
        await createCustomBrushFromSelection();
      }
      
      return;
    }

    if (isDraggingSelection) {
      // End selection dragging
      setIsDraggingSelection(false);
      setSelectionDragStart(null);
      return;
    }

    // Save drawing data to active layer when finishing a stroke
    if (isDrawing && offscreenCanvasRef.current) {
      // Use the proper canvas capture function
      await captureCanvasToActiveLayer(offscreenCanvasRef.current);
    }

    setIsDrawing(false);
    setLastPoint(null);
  }, [isPanning, isDraggingSelection, isSelecting, tools, selectionStart, selectionEnd, project, createCustomBrushFromSelection, isDrawing, captureCanvasToActiveLayer]);

  // Touch event handlers for mobile support
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Note: preventDefault will be handled by native event listener for passive events
    const touch = e.touches[0];
    
    // Update mouse position from touch
    updateMousePosition(touch, true); // Canvas event
    
    if (spacebarPressed) {
      // Start panning
      setIsPanning(true);
      setLastMouseX(mouseX);
      setLastMouseY(mouseY);
      return;
    }

    const point = screenToCanvas(touch.clientX, touch.clientY);
    
    // Capture state before drawing operation
    const offscreenCanvas = offscreenCanvasRef.current;
    if (offscreenCanvas) {
      const actionType = tools.currentTool === 'eraser' ? 'eraser' : 'brush';
      saveCanvasState(offscreenCanvas, actionType, `${actionType} stroke`);
    }
    
    setIsDrawing(true);
    setLastPoint(point);
    // Touch events don't have pressure, use 0.0 when pressure is enabled, 1.0 otherwise
    setCursor({ x: point.x, y: point.y, pressure: tools.brushSettings.pressureEnabled ? 0.0 : 1.0 });
    
    // Reset pixel queue for new stroke
    resetPixelQueue();
  }, [spacebarPressed, screenToCanvas, setCursor, resetPixelQueue, updateMousePosition, mouseX, mouseY, saveCanvasState, offscreenCanvasRef]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // Note: preventDefault will be handled by native event listener for passive events
    const touch = e.touches[0];
    
    // Update mouse position from touch
    updateMousePosition(touch, true); // Canvas event
    
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
    // Touch events don't have pressure, use 0.0 when pressure is enabled, 1.0 otherwise
    setCursor({ x: point.x, y: point.y, pressure: tools.brushSettings.pressureEnabled ? 0.0 : 1.0 });

    if (isDrawing && lastPoint) {
      try {
        drawLine(lastPoint, point);
        setLastPoint(point);
      } catch (error) {
      }
    }
  }, [isPanning, mouseX, mouseY, lastMouseX, lastMouseY, canvas.panX, canvas.panY, setPan, screenToCanvas, setCursor, isDrawing, lastPoint, drawLine, updateMousePosition]);

  const handleTouchEnd = useCallback(async (e: React.TouchEvent) => {
    // Note: preventDefault will be handled by native event listener for passive events
    
    if (isPanning) {
      // End panning
      setIsPanning(false);
      return;
    }

    // Save drawing data to active layer when finishing a touch stroke
    if (isDrawing && offscreenCanvasRef.current) {
      // Use the proper canvas capture function
      await captureCanvasToActiveLayer(offscreenCanvasRef.current);
    }

    setIsDrawing(false);
    setLastPoint(null);
  }, [isPanning, isDrawing, captureCanvasToActiveLayer]);

  // Wheel event for zoom (cursor-centered)
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    if (!canvasRef.current) return;
    
    // Update mouse position first
    updateMousePosition(e, true); // Canvas event
    
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
    
    // Capture state before paste operation
    saveCanvasState(offscreenCanvas, 'paste', 'Paste selection');
    
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
  }, [canvas.selection, setSelection, renderView, saveCanvasState]);

  // Keyboard event handlers
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Undo/Redo shortcuts
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      e.stopPropagation();
      
      if (e.shiftKey) {
        // Redo (Ctrl+Shift+Z)
        if (canRedo()) {
          const snapshot = redo();
          if (snapshot && offscreenCanvasRef.current) {
            restoreCanvasSnapshot(offscreenCanvasRef.current, snapshot);
            renderView();
          }
        }
      } else {
        // Undo (Ctrl+Z)
        if (canUndo()) {
          const snapshot = undo();
          if (snapshot && offscreenCanvasRef.current) {
            restoreCanvasSnapshot(offscreenCanvasRef.current, snapshot);
            renderView();
          }
        }
      }
      return;
    }

    // Alternative Redo shortcut (Ctrl+Y)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      e.stopPropagation();
      
      if (canRedo()) {
        const snapshot = redo();
        if (snapshot && offscreenCanvasRef.current) {
          restoreCanvasSnapshot(offscreenCanvasRef.current, snapshot);
          renderView();
        }
      }
      return;
    }
    
    // E key for temporary eraser mode
    if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey) {
      if (!eKeyPressed && tools.currentTool !== 'eraser') {
        e.preventDefault();
        setEKeyPressed(true);
        setToolBeforeEraser(tools.currentTool);
        setCurrentTool('eraser');
      }
      return;
    }
    
    // Alt key for temporary eyedropper mode
    if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey) {
      if (!altKeyPressed && tools.currentTool !== 'eyedropper') {
        e.preventDefault();
        setAltKeyPressed(true);
        setToolBeforeEyedropper(tools.currentTool);
        setCurrentTool('eyedropper');
      }
      return;
    }
    
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
      e.preventDefault();
      
      // Try modern clipboard API as fallback
      if (navigator.clipboard && navigator.clipboard.read) {
        navigator.clipboard.read().then(items => {
          for (const item of items) {
            for (const type of item.types) {
              if (type.startsWith('image/')) {
                item.getType(type).then(blob => {
                  const img = new Image();
                  img.onload = () => {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = img.width;
                    tempCanvas.height = img.height;
                    const ctx = tempCanvas.getContext('2d', { willReadFrequently: true });
                    
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
                    }
                  };
                  img.src = URL.createObjectURL(blob);
                });
                return;
              }
            }
          }
        }).catch(err => {
        });
      }
      return;
    }
    
    // Tool shortcuts
    if (e.key === 'b' || e.key === 'B') {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setCurrentTool('brush');
        return;
      }
    }
    
    if (e.key === 'm' || e.key === 'M') {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setCurrentTool('selection');
        return;
      }
    }
    
    if (e.key === 'c' || e.key === 'C') {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setCurrentTool('custom');
        return;
      }
    }
    
    if (e.key === 'f' || e.key === 'F') {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setCurrentTool('fill');
        return;
      }
    }
    
    // Brush size shortcuts - different behavior for custom vs regular brushes
    if (e.key === '[') {
      if (tools.brushSettings.brushShape === BrushShape.CUSTOM) {
        // Custom brush: decrease by 10% increments, minimum 10%
        setBrushSettings({ size: Math.max(10, tools.brushSettings.size - 10) });
      } else {
        // Regular brush: decrease by 1px, minimum 1px
        setBrushSettings({ size: Math.max(1, tools.brushSettings.size - 1) });
      }
    } else if (e.key === ']') {
      if (tools.brushSettings.brushShape === BrushShape.CUSTOM) {
        // Custom brush: increase by 10% increments, maximum 500%
        setBrushSettings({ size: Math.min(500, tools.brushSettings.size + 10) });
      } else {
        // Regular brush: increase by 1px, maximum 100px
        setBrushSettings({ size: Math.min(100, tools.brushSettings.size + 1) });
      }
    }
    
    // Grid toggle (Ctrl/Cmd + G)
    if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
      e.preventDefault();
      toggleGrid();
    }
  }, [spacebarPressed, setBrushSettings, tools.brushSettings.size, toggleGrid, canvas.selection.active, commitSelection, setSelection, eKeyPressed, tools.currentTool, setCurrentTool, altKeyPressed, canUndo, canRedo, undo, redo, offscreenCanvasRef, renderView]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    // E key release - restore previous tool
    if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      setEKeyPressed(false);
      if (toolBeforeEraser) {
        setCurrentTool(toolBeforeEraser);
        setToolBeforeEraser(null);
      }
      return;
    }
    
    // Alt key release - restore previous tool
    if (e.key === 'Alt') {
      e.preventDefault();
      setAltKeyPressed(false);
      if (toolBeforeEyedropper) {
        setCurrentTool(toolBeforeEyedropper);
        setToolBeforeEyedropper(null);
      }
      return;
    }
    
    if (e.code === 'Space') {
      e.preventDefault();
      setSpacebarPressed(false);
      setIsPanning(false);
    }
  }, [toolBeforeEraser, setCurrentTool, toolBeforeEyedropper]);

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
    
    // Get device pixel ratio for high-DPI displays
    const pixelRatio = window.devicePixelRatio || 1;
    
    // Set canvas buffer size (scaled by device pixel ratio)
    const scaledWidth = width * pixelRatio;
    const scaledHeight = height * pixelRatio;
    canvasElement.width = scaledWidth;
    canvasElement.height = scaledHeight;
    
    // Set CSS display size (original dimensions) 
    canvasElement.style.width = `${width}px`;
    canvasElement.style.height = `${height}px`;
    
    // Scale context to match device pixel ratio
    ctx.scale(pixelRatio, pixelRatio);
    
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
          
          // Update project dimensions to match canvas
          setProjectDimensions(width, height);
          
          // Reset pan to default position (world origin at canvas origin)
          setPan(0, 0);
        }
      }
    } catch (error) {
    }
  }, [isCanvasInitialized, initializeCanvas, setPan, setProjectDimensions, width, height]);

  // Event listeners setup - separate from canvas initialization
  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    // Stable event handler wrappers
    const keyDownHandler = (e: KeyboardEvent) => handleKeyDownRef.current?.(e);
    const keyUpHandler = (e: KeyboardEvent) => handleKeyUpRef.current?.(e);
    const wheelHandler = (e: WheelEvent) => handleWheelRef.current?.(e);

    // Native touch event handlers to prevent default with non-passive listeners
    const nativeTouchStart = (e: TouchEvent) => {
      e.preventDefault();
    };
    const nativeTouchMove = (e: TouchEvent) => {
      e.preventDefault();
    };
    const nativeTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
    };

    // Add keyboard event listeners
    window.addEventListener('keydown', keyDownHandler);
    window.addEventListener('keyup', keyUpHandler);
    
    // Add wheel event listener with active mode
    canvasElement.addEventListener('wheel', wheelHandler, { passive: false });
    
    // Add touch event listeners with non-passive mode to enable preventDefault
    canvasElement.addEventListener('touchstart', nativeTouchStart, { passive: false });
    canvasElement.addEventListener('touchmove', nativeTouchMove, { passive: false });
    canvasElement.addEventListener('touchend', nativeTouchEnd, { passive: false });
    
    // Add clipboard event listener to multiple targets
    window.addEventListener('paste', handlePaste);
    document.addEventListener('paste', handlePaste);
    canvasElement.addEventListener('paste', handlePaste);
    
    // Make canvas focusable
    canvasElement.tabIndex = 0;
    
    return () => {
      window.removeEventListener('keydown', keyDownHandler);
      window.removeEventListener('keyup', keyUpHandler);
      canvasElement.removeEventListener('wheel', wheelHandler);
      canvasElement.removeEventListener('touchstart', nativeTouchStart);
      canvasElement.removeEventListener('touchmove', nativeTouchMove);
      canvasElement.removeEventListener('touchend', nativeTouchEnd);
      window.removeEventListener('paste', handlePaste);
      document.removeEventListener('paste', handlePaste);
      canvasElement.removeEventListener('paste', handlePaste);
    };
  }, [handlePaste]); // Include handlePaste in dependency array


  // Initialize debug utilities (development only)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      // Expose offscreen canvas for debugging
      if (typeof window !== 'undefined') {
        (window as any).tinybrushDebugCanvas = {
          getOffscreenCanvas: () => offscreenCanvasRef.current,
          getMainCanvas: () => canvasRef.current,
          isCanvasInitialized,
          canvasState: {
            width,
            height,
            zoom: canvas.zoom,
            panX: canvas.panX,
            panY: canvas.panY
          }
        };
      }
    }
  }, [isCanvasInitialized, canvas.zoom, canvas.panX, canvas.panY, width, height]);

  // Create initial layer if none exists
  useEffect(() => {
    if (isCanvasInitialized && project && layers.length === 0) {
      const initialLayer = {
        name: 'Background',
        visible: true,
        opacity: 1,
        blendMode: 'source-over' as GlobalCompositeOperation,
        locked: false,
        imageData: null,
        framebuffer: new OffscreenCanvas(project.width, project.height)
      };
      addLayer(initialLayer);
    }
  }, [isCanvasInitialized, project, layers.length, addLayer]);

  // Re-render view when zoom/pan changes
  useEffect(() => {
    if (isCanvasInitialized) {
      renderView();
    }
  }, [canvas.zoom, canvas.panX, canvas.panY, canvas.showGrid, renderView, isCanvasInitialized]);

  // Optimized animation for marching ants - only updates selection border
  const lastRenderTime = useRef(0);
  
  useEffect(() => {
    const hasActiveSelection = canvas.selection.active;
    const hasSelectionCreation = selectionStart && selectionEnd;
    
    if (!hasActiveSelection && !hasSelectionCreation) {
      return;
    }
    
    const animate = (timestamp: number) => {
      // Throttle to 30fps for marching ants animation (smooth enough, better performance)
      if (timestamp - lastRenderTime.current > 33) {
        renderView();
        lastRenderTime.current = timestamp;
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [canvas.selection.active, selectionStart, selectionEnd, renderView]);

  // Canvas styling with cursor updates
  const canvasStyle: React.CSSProperties = {
    cursor: spacebarPressed 
      ? (isPanning ? 'grabbing' : 'grab') 
      : ((tools.currentTool === 'brush' || tools.currentTool === 'eraser') ? 'none' 
         : (tools.currentTool === 'eyedropper' || tools.currentTool === 'fill') ? 'crosshair'
         : 'default'),
    imageRendering: canvas.displayMode === 'smooth' ? 'auto' : 'pixelated'
  };

  // Add document pointermove listener for better pointer tracking (mouse, stylus, touch)
  useEffect(() => {
    const handleDocumentPointerMove = (e: PointerEvent) => {
      // CRITICAL FIX: Don't update mouse position from document events when over canvas
      // This was causing the cursor misalignment!
      const canvasEl = canvasRef.current;
      if (canvasEl) {
        const rect = canvasEl.getBoundingClientRect();
        const isOverCanvas = e.clientX >= rect.left && e.clientX <= rect.right && 
                           e.clientY >= rect.top && e.clientY <= rect.bottom;
        
        if (!isOverCanvas) {
          updateMousePosition(e);
        }
      }
      
      if (isPanning) {
        // Handle panning when mouse moves outside canvas
        const deltaX = mouseX - lastMouseX;
        const deltaY = mouseY - lastMouseY;
        
        setPan(canvas.panX + deltaX, canvas.panY + deltaY);
        
        setLastMouseX(mouseX);
        setLastMouseY(mouseY);
      } else {
        // Clear eyedropper preview when not over canvas
        setPreviewColor(null);
        setPreviewPosition(null);
      }
    };
    
    const handleDocumentPointerUp = () => {
      if (isPanning) {
        setIsPanning(false);
      }
    };
    
    document.body.addEventListener('pointermove', handleDocumentPointerMove);
    document.body.addEventListener('pointerup', handleDocumentPointerUp);
    
    return () => {
      document.body.removeEventListener('pointermove', handleDocumentPointerMove);
      document.body.removeEventListener('pointerup', handleDocumentPointerUp);
    };
  }, [isPanning, mouseX, mouseY, lastMouseX, lastMouseY, canvas.panX, canvas.panY, setPan, updateMousePosition]);

  // Layer recomposition when project loads
  useEffect(() => {
    if (layersNeedRecomposition) {
      
      if (offscreenCanvasRef.current) {
        compositeLayersToCanvas(offscreenCanvasRef.current);
        renderView();
        setLayersNeedRecomposition(false);
      } else {
      }
    }
  }, [layersNeedRecomposition, compositeLayersToCanvas, renderView, setLayersNeedRecomposition, layers]);

  // Object pooling for performance optimization
  const coordinatePool = useMemo(() => {
    const pool: Array<{x: number, y: number}> = [];
    const maxSize = 100;
    
    return {
      get: () => {
        return pool.pop() || { x: 0, y: 0 };
      },
      release: (obj: {x: number, y: number}) => {
        if (pool.length < maxSize) {
          obj.x = 0;
          obj.y = 0;
          pool.push(obj);
        }
      },
      clear: () => {
        pool.length = 0;
      }
    };
  }, []);

  // Cleanup RAF and object pools on unmount
  useEffect(() => {
    return () => {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
      coordinatePool.clear();
    };
  }, [coordinatePool]);


  // Get current custom brush data
  const currentCustomBrush = tools.brushSettings.brushShape === BrushShape.CUSTOM && 
    tools.brushSettings.selectedCustomBrush && project
    ? project.customBrushes.find(b => b.id === tools.brushSettings.selectedCustomBrush)
    : null;

  return (
    <>
      <div 
        className="w-full h-full bg-[#141514] flex items-center justify-center relative"
        style={{
          overflow: 'visible'
        }}
      >
        {/* Wrapper div for absolute positioning context */}
        <div ref={wrapperRef} className="relative" style={{ width: `${width}px`, height: `${height}px` }}>
          <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className=""
          style={{
            ...canvasStyle,
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: 1,
            border: 'none',
            outline: 'none',
            padding: 0,
            margin: 0,
            boxSizing: 'border-box',
            pointerEvents: 'auto'
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerEnter={() => {
            setIsMouseOverCanvas(true);
          }}
          onPointerLeave={() => {
            handlePointerUp();
            setIsMouseOverCanvas(false);
            // Clear eyedropper preview when leaving canvas
            setPreviewColor(null);
            setPreviewPosition(null);
            // Hide brush cursor when leaving canvas
            setShowBrushCursor(false);
            setCursorScreenX(0);
            setCursorScreenY(0);
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onFocus={() => {}}
          onBlur={() => {}}
        />
        
        </div>
        
        {/* Eyedropper color preview */}
        {previewColor && previewPosition && tools.currentTool === 'eyedropper' && (
          <div 
            className="fixed pointer-events-none z-50 rounded-lg shadow-lg p-3"
            style={{
              left: previewPosition.x + 15,
              top: previewPosition.y - 35,
              transform: 'translate(0, 0)',
              backgroundColor: '#000000',
              border: '2px solid #4B5563'
            }}
          >
            <div 
              className="rounded"
              style={{ 
                backgroundColor: previewColor,
                width: '40px',
                height: '40px',
                border: '1px solid #4B5563'
              }}
            />
          </div>
        )}
      </div>

      {/* Brush cursor preview */}
      <BrushCursor
        screenX={cursorScreenX}
        screenY={cursorScreenY}
        size={tools.brushSettings.size}
        brushShape={tools.brushSettings.brushShape || BrushShape.ROUND}
        zoom={canvas.zoom}
        color={tools.brushSettings.color}
        customBrush={currentCustomBrush ? {
          imageData: currentCustomBrush.imageData,
          width: currentCustomBrush.width,
          height: currentCustomBrush.height
        } : null}
        visible={showBrushCursor}
      />
      
      
    </>
  );
}