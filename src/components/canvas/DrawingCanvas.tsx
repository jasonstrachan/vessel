'use client';

// Basic Canvas Component with native Canvas API
// Based on /docs/02_System_Architecture/Overall_Design.md (lines 65-74)

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useBrushEngine } from '../../hooks/useBrushEngine';
import { calculateZoomIncrement } from '../../utils/zoomUtils';
import { floodFill, type FloodFillColor } from '../../utils/floodFill';
import { restoreCanvasSnapshot } from '../../utils/canvasSnapshot';
import { canvasPool } from '../../utils/canvasPool';
import { memoryManager } from '../../utils/memoryCleanup';
import { scaledBrushCache } from '../../utils/scaledBrushCache';
import { brushCache } from '../../utils/brushCache';
import { calculateGridDimensions } from '../../utils/gridSnap';
import { createShapePath, renderShape, renderShapePreview, simplifyPath } from '../../utils/shapeUtils';
import type { Tool } from '../../types';
import { BrushShape } from '../../types';
import BrushCursor from './BrushCursor';
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from '../../constants/canvas';

/**
 * Samples a square area of pixels from a canvas context and returns the average color.
 * @param {CanvasRenderingContext2D} ctx The canvas context to sample from.
 * @param {number} x The center X coordinate of the sample area.
 * @param {number} y The center Y coordinate of the sample area.
 * @param {number} areaSize The width and height of the square area to sample (e.g., 5 for a 5x5 area).
 * @returns {string|null} The average color as a hex string (e.g., '#RRGGBB'), or null on error.
 */
const sampleAverageColor = (ctx: CanvasRenderingContext2D, x: number, y: number, areaSize = 5): string | null => {
  const halfSize = Math.floor(areaSize / 2);
  const startX = Math.round(x - halfSize);
  const startY = Math.round(y - halfSize);

  try {
    // Read the block of pixel data from the canvas
    const imageData = ctx.getImageData(startX, startY, areaSize, areaSize).data;

    let totalR = 0;
    let totalG = 0;
    let totalB = 0;

    // Loop through all pixels in the data (each pixel is 4 bytes: R, G, B, A)
    for (let i = 0; i < imageData.length; i += 4) {
      totalR += imageData[i];
      totalG += imageData[i + 1];
      totalB += imageData[i + 2];
    }

    const pixelCount = areaSize * areaSize;
    const avgR = Math.round(totalR / pixelCount);
    const avgG = Math.round(totalG / pixelCount);
    const avgB = Math.round(totalB / pixelCount);

    // Helper to convert a number to a 2-digit hex string
    const toHex = (c: number) => ('0' + c.toString(16)).slice(-2);

    return `#${toHex(avgR)}${toHex(avgG)}${toHex(avgB)}`;
  } catch (e) {
    // This can happen if you sample outside the canvas bounds or have CORS issues.
    console.error("Color sampling failed. This is often due to sampling off-canvas.", e);
    return null;
  }
};

interface DrawingCanvasProps {
  width?: number;
  height?: number;
}

export default function DrawingCanvas({ width: propWidth, height: propHeight }: DrawingCanvasProps) {
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement>(null);
  const needsRedraw = useRef(false);
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const handleKeyUpRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const handleWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  
  // Stable refs for dynamic values to prevent keyboard handler re-registration
  const stateRef = useRef({
    spacebarPressed: false,
    eKeyPressed: false,
    altKeyPressed: false,
    isSelecting: false,
    canUndo: (() => false) as () => boolean,
    canRedo: (() => false) as () => boolean,
    undo: (() => null) as any,
    redo: (() => null) as any,
    tools: { currentTool: 'brush' as Tool, brushSettings: { size: 10, brushShape: BrushShape.ROUND } },
    canvas: { selection: { active: false } },
    setBrushSettings: (() => {}) as any,
    setCurrentTool: (() => {}) as any,
    commitSelection: (() => {}) as any,
    setSelection: (() => {}) as any,
    renderView: (() => {}) as any,
    toolBeforeEraser: null as Tool | null,
    toolBeforeEyedropper: null as Tool | null
  });
  
  // Prevent double saveCanvasState calls from pointer + touch events
  const lastSaveCanvasStateTime = useRef(0);
  const SAVE_DEDUPLICATION_WINDOW = 50; // 50ms window to prevent duplicates
  const [isDrawing, setIsDrawing] = useState(false);
  
  // Performance monitoring
  const performanceRef = useRef({
    pointerDownTime: 0,
    pointerUpTime: 0,
    strokeStartTime: 0
  });
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);
  // Lock target layer when drawing starts to prevent pixel swapping
  const [drawingTargetLayerId, setDrawingTargetLayerId] = useState<string | null>(null);
  // New zoom/pan state variables
  const [spacebarPressed, setSpacebarPressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [lastMouseX, setLastMouseX] = useState(0);
  const [lastMouseY, setLastMouseY] = useState(0);
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const [isCanvasInitialized, setIsCanvasInitialized] = useState(false);
  
  // Dirty rectangle tracking for performance optimization (using refs to avoid render loops)
  const dirtyRegionsRef = useRef<{x: number, y: number, width: number, height: number}[]>([]);
  const fullRedrawNeeded = useRef(true); // Force full redraw initially
  
  // Helper function to shift hue for better visibility
  const shiftHue = useCallback((color: string, degrees: number): string => {
    // Parse hex color
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;
    
    // Convert RGB to HSL
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;
    
    if (max === min) {
      h = s = 0; // achromatic
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
        default: h = 0;
      }
      h /= 6;
    }
    
    // Shift hue
    h = (h + degrees / 360) % 1;
    if (h < 0) h += 1;
    
    // Convert HSL back to RGB
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    let newR, newG, newB;
    if (s === 0) {
      newR = newG = newB = l; // achromatic
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      newR = hue2rgb(p, q, h + 1/3);
      newG = hue2rgb(p, q, h);
      newB = hue2rgb(p, q, h - 1/3);
    }
    
    // Convert back to hex
    const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0');
    return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
  }, []);

  // Helper functions for dirty rectangle management
  const addDirtyRegion = useCallback((x: number, y: number, width: number, height: number) => {
    const margin = 20; // Extra margin for brush effects
    
    // Clamp coordinates to canvas boundaries
    const left = Math.max(0, x - margin);
    const top = Math.max(0, y - margin);
    const right = Math.min(DEFAULT_CANVAS_WIDTH, x + width + margin);
    const bottom = Math.min(DEFAULT_CANVAS_HEIGHT, y + height + margin);
    
    // Only add region if it's within canvas bounds
    if (left < right && top < bottom) {
      const dirtyRect = {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
      };
      
      dirtyRegionsRef.current.push(dirtyRect);
    }
  }, []);
  
  const markFullRedraw = useCallback(() => {
    fullRedrawNeeded.current = true;
    dirtyRegionsRef.current = [];
  }, []);
  
  const clearDirtyRegions = useCallback(() => {
    dirtyRegionsRef.current = [];
    fullRedrawNeeded.current = false;
  }, []);
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
  
  // Shape preview cache for performance
  const shapePreviewCacheRef = useRef<HTMLCanvasElement | null>(null);
  
  // Rectangle brush live state (use ref to avoid re-renders during drag)
  const rectangleBrushLiveState = useRef({
    currentPos: { x: 0, y: 0 },
    width: 0
  });

  // Live state for polygon gradient (performance optimization)
  const polygonGradientLiveState = useRef({
    livePoints: [] as Array<{ x: number; y: number; color: string }>
  });

  // Shift color hue by specified degrees
  const shiftColorHue = useCallback((r: number, g: number, b: number, hueShift: number): string => {
    // Convert RGB to HSL
    r /= 255;
    g /= 255;
    b /= 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h: number, s: number;
    const l = (max + min) / 2;
    
    if (max === min) {
      h = s = 0; // achromatic
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    
    // Shift hue
    h = (h + hueShift / 360) % 1;
    if (h < 0) h += 1;
    
    // Convert HSL back to RGB
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    let newR: number, newG: number, newB: number;
    
    if (s === 0) {
      newR = newG = newB = l; // achromatic
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      newR = hue2rgb(p, q, h + 1/3);
      newG = hue2rgb(p, q, h);
      newB = hue2rgb(p, q, h - 1/3);
    }
    
    // Convert back to 0-255 range
    newR = Math.round(newR * 255);
    newG = Math.round(newG * 255);
    newB = Math.round(newB * 255);
    
    return `rgb(${newR}, ${newG}, ${newB})`;
  }, []);

  // Sample colors from canvas at actual drawing path points
  const sampleCanvasColors = useCallback((ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>, numSamples: number): string[] => {
    if (points.length < 1) {
      return ['rgb(128, 128, 128)'];
    }

    // Select sampling points
    const samplePoints = numSamples >= points.length 
      ? points
      : Array.from({ length: numSamples }, (_, i) => {
          const pathIndex = Math.floor((i / (numSamples - 1)) * (points.length - 1));
          return points[pathIndex];
        });

    // Find bounding box for efficient batch sampling
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of samplePoints) {
      minX = Math.min(minX, Math.round(point.x));
      minY = Math.min(minY, Math.round(point.y));
      maxX = Math.max(maxX, Math.round(point.x));
      maxY = Math.max(maxY, Math.round(point.y));
    }

    // Batch sample the entire region
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    
    let imageData: ImageData;
    try {
      imageData = ctx.getImageData(minX, minY, width, height);
    } catch (e) {
      // Fallback to default colors if sampling fails
      return Array(samplePoints.length).fill('rgb(128, 128, 128)');
    }
    
    const colors: string[] = [];
    
    // Extract colors from the batch data
    for (const point of samplePoints) {
      const x = Math.round(point.x) - minX;
      const y = Math.round(point.y) - minY;
      
      if (x >= 0 && x < width && y >= 0 && y < height) {
        const pixelIndex = (y * width + x) * 4;
        const r = imageData.data[pixelIndex];
        const g = imageData.data[pixelIndex + 1];
        const b = imageData.data[pixelIndex + 2];
        
        // Apply +8 hue shift to sampled colors
        const hueShiftedColor = shiftColorHue(r, g, b, 8);
        colors.push(hueShiftedColor);
      } else {
        colors.push('rgb(128, 128, 128)');
      }
    }

    return colors;
  }, []);
  
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
    captureCanvasToLayer,
    setProjectDimensions,
    shapeState,
    setShapeDrawing,
    addShapePoint,
    clearShapePoints,
    setShapePreviewPath,
    rectangleBrushState,
    setRectangleBrushState,
    polygonGradientState,
    setPolygonGradientState,
    addPolygonGradientPoint,
    clearPolygonGradientPoints,
  } = useAppStore();
  
  const { renderBrushStroke, resetPixelQueue, drawRectangleGradient, drawPolygonGradient } = useBrushEngine();
  
  // Get current custom brush data
  const temporaryCustomBrush = useAppStore((state) => state.temporaryCustomBrush);
  
  // Use project dimensions if available, otherwise use props or defaults
  const width = project?.width || propWidth || DEFAULT_CANVAS_WIDTH;
  const height = project?.height || propHeight || DEFAULT_CANVAS_HEIGHT;
  
  // Clear shape state when shape mode is disabled
  useEffect(() => {
    if (!tools.brushSettings.shapeEnabled && shapeState.isDrawing) {
      setShapeDrawing(false);
      clearShapePoints();
      setShapePreviewPath(undefined);
      shapePreviewCacheRef.current = null;
    }
  }, [tools.brushSettings.shapeEnabled, shapeState.isDrawing, setShapeDrawing, clearShapePoints, setShapePreviewPath]);

  // Deduplicated saveCanvasState to prevent double calls from pointer + touch events
  const saveCanvasStateDeduped = useCallback((canvas: HTMLCanvasElement, actionType: 'brush' | 'eraser' | 'fill' | 'selection' | 'paste', description: string) => {
    const now = Date.now();
    if (now - lastSaveCanvasStateTime.current < SAVE_DEDUPLICATION_WINDOW) {
      return; // Skip duplicate call within window
    }
    lastSaveCanvasStateTime.current = now;
    saveCanvasState(canvas, actionType, description);
  }, [saveCanvasState]);

  // Keep stateRef updated with current values for stable keyboard handlers
  useEffect(() => {
    stateRef.current = {
      spacebarPressed,
      eKeyPressed,
      altKeyPressed,
      isSelecting,
      canUndo,
      canRedo,
      undo,
      redo,
      tools: {
        ...tools,
        brushSettings: {
          ...tools.brushSettings,
          brushShape: tools.brushSettings.brushShape || BrushShape.ROUND
        }
      },
      canvas,
      setBrushSettings,
      setCurrentTool,
        commitSelection,
      setSelection,
      renderView,
      toolBeforeEraser,
      toolBeforeEyedropper
    };
  });

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
        const tempCanvas = canvasPool.acquire(img.width, img.height);
        const ctx = tempCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
        
        if (!ctx) {
          canvasPool.release(tempCanvas);
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
        
        // Release canvas back to pool
        canvasPool.release(tempCanvas);
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

  // Sample color from canvas at world coordinates (optimized for speed)
  const sampleColor = useCallback((worldX: number, worldY: number) => {
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return null;
    
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!offscreenCtx) return null;
    
    // Fast bounds check and floor in one operation
    const x = Math.floor(Math.max(0, Math.min(worldX, offscreenCanvas.width - 1)));
    const y = Math.floor(Math.max(0, Math.min(worldY, offscreenCanvas.height - 1)));
    
    try {
      // Use the fastest possible pixel read
      const imageData = offscreenCtx.getImageData(x, y, 1, 1);
      const data = imageData.data;
      
      // Optimized hex conversion - avoid string padding when possible
      const r = data[0];
      const g = data[1]; 
      const b = data[2];
      
      // Fast hex conversion
      return `#${(r < 16 ? '0' : '') + r.toString(16)}${(g < 16 ? '0' : '') + g.toString(16)}${(b < 16 ? '0' : '') + b.toString(16)}`;
    } catch {
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
    // Use current canvas dimensions from state for accurate coordinate mapping
    const currentCanvasWidth = canvas.canvasWidth || width;
    const currentCanvasHeight = canvas.canvasHeight || height;
    
    // Clamp coordinates to canvas bounds before transformation
    const clampedX = Math.max(0, Math.min(canvasCssX, currentCanvasWidth));
    const clampedY = Math.max(0, Math.min(canvasCssY, currentCanvasHeight));
    
    const worldX = (clampedX - canvas.panX) / canvas.zoom;
    const worldY = (clampedY - canvas.panY) / canvas.zoom;

    return { canvasX: clampedX, canvasY: clampedY, worldX, worldY };
  }, [canvas.zoom, canvas.panX, canvas.panY, canvas.canvasWidth, canvas.canvasHeight, width, height]);

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
    
    
    
    
    // Show brush cursor for brush-like tools, including during shape drawing (optimized to avoid unnecessary updates)
    const shouldShowBrushCursor = (tools.currentTool === 'brush' || tools.currentTool === 'eraser') && !spacebarPressed && isMouseOverCanvas;
    setShowBrushCursor(prev => prev !== shouldShowBrushCursor ? shouldShowBrushCursor : prev);
  }, [transformScreenToCanvas, canvas.panX, canvas.panY, canvas.zoom, tools.currentTool, spacebarPressed, isMouseOverCanvas, shapeState.isDrawing]);
  
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
    const patternCtx = patternCanvas.getContext('2d', { colorSpace: 'srgb' });
    if (!patternCtx) return null;
    
    // Create 2x2 checkerboard pattern
    patternCtx.fillStyle = '#404040';
    patternCtx.fillRect(0, 0, patternCanvas.width, patternCanvas.height);
    patternCtx.fillStyle = '#606060';
    patternCtx.fillRect(0, 0, checkSize, checkSize);
    patternCtx.fillRect(checkSize, checkSize, checkSize, checkSize);
    
    return patternCanvas;
  }, []);

  // Render the view with zoom/pan transformations using dirty rectangle optimization
  const renderView = useCallback(() => {
    const canvasElement = canvasRef.current;
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!canvasElement || !offscreenCanvas) return;
    
    const ctx = canvasElement.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx || !offscreenCtx) return;
    
    // Disable image smoothing for pixel-perfect rendering
    ctx.imageSmoothingEnabled = false;
    
    // ALWAYS perform a full clear at the start of each render cycle
    // This ensures no residual artifacts from previous renders
    ctx.clearRect(0, 0, width, height);
    
    // Determine what needs to redraw for optimization purposes
    const needsFullRedraw = fullRedrawNeeded.current || dirtyRegionsRef.current.length === 0;
    
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
    
    // Grid snap functionality is preserved in useBrushEngine, visual grid removed
    
    // Draw selection overlay with marching ants
    if (canvas.selection.active) {
      const { bounds, pixels } = canvas.selection;
      
      // Draw the pasted image
      if (pixels && pixels.width > 0 && pixels.height > 0) {
        const tempCanvas = canvasPool.acquire(pixels.width, pixels.height);
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
        
        if (tempCtx) {
          tempCtx.putImageData(pixels, 0, 0);
          ctx.drawImage(tempCanvas, bounds.x, bounds.y);
          canvasPool.release(tempCanvas);
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
    
    // Draw shape preview if in shape mode (optimized with caching)
    if (shapeState.isDrawing && shapeState.previewPath && tools.brushSettings.shapeEnabled) {
      const brushSettings = tools.brushSettings;
      const currentCustomBrush = brushSettings.brushShape === BrushShape.CUSTOM && 
        brushSettings.selectedCustomBrush
        ? (temporaryCustomBrush && temporaryCustomBrush.id === brushSettings.selectedCustomBrush
            ? temporaryCustomBrush
            : project?.customBrushes?.find(b => b.id === brushSettings.selectedCustomBrush))
        : null;

      // Use cached preview canvas for better performance
      if (!shapePreviewCacheRef.current) {
        shapePreviewCacheRef.current = document.createElement('canvas');
        shapePreviewCacheRef.current.width = width;
        shapePreviewCacheRef.current.height = height;
      }
      
      const previewCtx = shapePreviewCacheRef.current.getContext('2d', { colorSpace: 'srgb' });
      if (previewCtx) {
        // Clear and render to cache canvas
        previewCtx.clearRect(0, 0, width, height);
        previewCtx.save();
        previewCtx.globalAlpha = brushSettings.opacity; // Use actual brush opacity - no transparency
        previewCtx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
        
        renderShape(
          previewCtx,
          shapeState.previewPath,
          brushSettings.color,
          currentCustomBrush || undefined,
          brushSettings.useSwatchColor,
          brushSettings.hueShift,
          brushSettings.saturationAdjust,
          brushSettings.brushShape,
          brushSettings.antialiasing,
          shapeState.points
        );
        
        previewCtx.restore();
        
        // Draw cached preview to main canvas
        ctx.save();
        ctx.drawImage(shapePreviewCacheRef.current, 0, 0);
        ctx.restore();
      }
    }
    
    // --- RECTANGLE GRADIENT PREVIEW START ---
    if (
      tools.currentTool === 'brush' &&
      tools.brushSettings.brushShape === BrushShape.RECTANGLE_GRADIENT &&
      rectangleBrushState.drawingState !== 'idle'
    ) {
      ctx.save();
      
      // Get committed state from the store
      const { drawingState, startPos, endPos, startColor, endColor } = rectangleBrushState;
      // Get LIVE state from the ref for smooth previews
      const { currentPos, width } = rectangleBrushLiveState.current;

      if (drawingState === 'definingLength') {
        // --- 1. Get current state ---
        const { brushSettings } = tools;

        // --- 2. Define the shared width ---
        // Fixed 4px preview line thickness, scaled for zoom
        const previewWidth = 4 / canvas.zoom;

        // --- 3. Draw the main preview line ---
        // This line is fully visible and sets the core direction and width.
        ctx.beginPath();
        ctx.moveTo(startPos.x, startPos.y);
        ctx.lineTo(currentPos.x, currentPos.y);
        ctx.strokeStyle = startColor;
        ctx.lineWidth = previewWidth; // Use the shared width
        ctx.lineCap = 'round'; // Optional: makes the line ends look nicer
        ctx.stroke();

        // --- 4. Draw live gradient preview (optimized) ---
        // Only sample color and draw gradient every few frames for performance
        if (!rectangleBrushLiveState.current.lastSampleTime || 
            Date.now() - rectangleBrushLiveState.current.lastSampleTime > 16) { // ~60fps
          rectangleBrushLiveState.current.cachedEndColor = sampleColor(currentPos.x, currentPos.y) || '#ffffff';
          rectangleBrushLiveState.current.lastSampleTime = Date.now();
        }

        ctx.globalAlpha = 0.5;
        drawRectangleGradient(ctx, {
          startPos,
          endPos: currentPos,
          width: previewWidth,
          startColor: startColor,
          endColor: rectangleBrushLiveState.current.cachedEndColor || '#ffffff',
        });
        ctx.globalAlpha = 1.0;
      } else if (drawingState === 'definingWidth') {
        // Create slightly hue-shifted colors for better visibility
        const offsetStartColor = shiftHue(startColor, 8);
        const offsetEndColor = shiftHue(endColor, 8);
        
        // Use the final drawing function but with transparency for the preview
        ctx.globalAlpha = 0.65;
        drawRectangleGradient(ctx, { startPos, endPos, width, startColor: offsetStartColor, endColor: offsetEndColor });
      }

      ctx.restore();
    }
    // --- RECTANGLE GRADIENT PREVIEW END ---
    
    // --- POLYGON GRADIENT PREVIEW START ---
    if (
      tools.currentTool === 'brush' &&
      tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT &&
      polygonGradientState.drawingState === 'drawing'
    ) {
      const livePoints = polygonGradientLiveState.current.livePoints;

      if (livePoints.length >= 3) {
        ctx.save();
        // No transparency - match final result exactly

        // Sample SAME number of colors as final (8) for identical appearance
        // Sample from the main visible canvas instead of offscreen canvas
        const mainCanvasCtx = canvasRef.current?.getContext('2d');
        let previewColors = ['#FFF', '#000']; // Default fallback gradient

        if (mainCanvasCtx) {
          // Get 8 colors (same as final) for identical preview
          previewColors = sampleCanvasColors(mainCanvasCtx, livePoints, 8);
        }
        
        // Create points with sampled colors for preview
        const previewPointsWithColors = livePoints.map((point, index) => ({
          ...point,
          color: previewColors[Math.floor((index / livePoints.length) * previewColors.length)]
        }));
        
        // Draw the polygon using SAME number of colors as final (8)
        drawPolygonGradient(ctx, { vertices: livePoints, colors: previewColors });

        ctx.restore();
      }
    }
    // --- POLYGON GRADIENT PREVIEW END ---
    
    // Restore context state
    ctx.restore();
    
    // Clear dirty regions after rendering
    clearDirtyRegions();
  }, [canvas.zoom, canvas.panX, canvas.panY, canvas.selection, width, height, selectionStart, selectionEnd, checkerboardPattern, clearDirtyRegions, tools.brushSettings.brushShape, tools.brushSettings.selectedCustomBrush, tools.brushSettings.size, tools.brushSettings.gridSnapEnabled, tools.brushSettings.shapeEnabled, project?.customBrushes, shapeState, temporaryCustomBrush, rectangleBrushState, drawRectangleGradient, polygonGradientState, drawPolygonGradient]);

  // Enhanced drawing function - draws on offscreen canvas and re-renders view
  const drawLine = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    // Prevent drawing during selection
    if (isSelecting) {
      return;
    }
    
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return;
    
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!offscreenCtx) return;
    
    // Calculate actual brush size for dirty region (accounts for custom brushes)
    const { brushSettings } = useAppStore.getState().tools;
    let actualBrushSize = brushSettings.size || 20;
    
    // For custom brushes, calculate the actual pixel size
    if (brushSettings.brushShape === BrushShape.CUSTOM) {
      const customBrush = project?.customBrushes?.find(b => b.id === brushSettings.selectedCustomBrush) ||
                         useAppStore.getState().temporaryCustomBrush;
      
      if (customBrush) {
        // Custom brush size is percentage of brush dimensions
        const customBrushBaseSize = Math.max(customBrush.width, customBrush.height);
        actualBrushSize = (brushSettings.size / 100) * customBrushBaseSize;
      }
    } else {
      // Regular brushes: convert percentage to pixels
      const baseSize = 10; // Default base size for regular brushes
      actualBrushSize = (brushSettings.size / 100) * baseSize;
    }
    
    // Add dirty region for the brush stroke
    const minX = Math.min(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxX = Math.max(from.x, to.x);
    const maxY = Math.max(from.y, to.y);
    
    addDirtyRegion(
      minX - actualBrushSize,
      minY - actualBrushSize,
      (maxX - minX) + actualBrushSize * 2,
      (maxY - minY) + actualBrushSize * 2
    );
    
    // Draw on the offscreen canvas (no transformations - world coordinates)
    renderBrushStroke(offscreenCtx, from, to);
    
    // Mark that we need to redraw the view
    needsRedraw.current = true;
  }, [renderBrushStroke, isSelecting, addDirtyRegion, project]);

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
    const captureCanvas = canvasPool.acquire(width, height);
    const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    
    if (!captureCtx) {
      canvasPool.release(captureCanvas);
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
      canvasPool.release(captureCanvas);
      return null;
    }
    
    // Get ImageData for the brush
    const imageData = captureCtx.getImageData(0, 0, width, height);
    
    // Schedule cleanup of the ImageData after use
    memoryManager.scheduleCleanup(() => {
      // The imageData will be stored in the custom brush object, so we don't null it here
      // But we can schedule periodic cleanup of old unused ImageData objects
    });
    
    // Create thumbnail (max 64x64)
    const thumbnailSize = 64;
    const thumbnailCanvas = canvasPool.acquire(thumbnailSize, thumbnailSize);
    const thumbnailCtx = thumbnailCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    
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
      name: `B${(project?.customBrushes?.length || 0) + 1}`,
      imageData,
      thumbnail: thumbnailCanvas.toDataURL(),
      width,
      height,
      createdAt: Date.now()
    };
    
    // Release canvases back to pool
    canvasPool.release(captureCanvas);
    canvasPool.release(thumbnailCanvas);
    
    // Add the brush to the project
    addCustomBrush(customBrush);
    
    // CRITICAL: Clear brush caches to ensure immediate update
    scaledBrushCache.clear();
    brushCache.clear();
    
    // Auto-select the newly created custom brush and clear any cached brush tips
    setBrushSettings({ 
      brushShape: BrushShape.CUSTOM,
      selectedCustomBrush: customBrush.id,
      size: 100, // Default to 100% (original size) for custom brushes
      useSwatchColor: false, // Default to false so custom brushes use their tip colors
      currentBrushTip: undefined, // Clear any cached brush tips
      hueShift: 0,           // Reset global hueShift when selecting custom brush
      saturationAdjust: 100  // Reset global saturationAdjust when selecting custom brush
    });
    
    // Switch to brush tool for immediate use
    setCurrentTool('brush');
    
    // Clear the selection
    clearSelection();
    
    
    return customBrush;
  }, [selectionStart, selectionEnd, project, canvas.zoom, canvas.panX, canvas.panY, addCustomBrush, setBrushSettings, setCurrentTool, clearSelection]);

  // Create temporary custom brush for immediate use (without saving to library)
  const createTemporaryCustomBrush = useCallback(async () => {
    
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
    const captureCanvas = canvasPool.acquire(width, height);
    const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    
    if (!captureCtx) {
      canvasPool.release(captureCanvas);
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
      canvasPool.release(captureCanvas);
      return null;
    }
    
    // Get image data for the brush
    const imageData = captureCtx.getImageData(0, 0, width, height);
    
    // Schedule cleanup after brush usage
    memoryManager.scheduleCleanup(() => {
      // Temporary brush will be replaced frequently, cleanup can help
    });
    
    // Create temporary brush object (not saved to library)
    const tempBrush = {
      id: `temp_brush_${Date.now()}`,
      name: `Brush ${Date.now().toString().slice(-3)}`,
      imageData,
      width,
      height,
      thumbnail: '', // Will be generated when saving as preset
      createdAt: Date.now()
    };
    
    // Release canvas back to pool
    canvasPool.release(captureCanvas);
    
    // Store the temporary brush in the store
    const store = useAppStore.getState();
    store.setTemporaryCustomBrush(tempBrush);
    
    // CRITICAL: Clear brush caches to ensure immediate update
    scaledBrushCache.clear();
    brushCache.clear();
    
    // Set the temporary brush as active for immediate use and clear any cached brush tips
    setBrushSettings({ 
      brushShape: BrushShape.CUSTOM,
      selectedCustomBrush: tempBrush.id,
      size: 100, // Default to 100% (original size) for custom brushes
      useSwatchColor: false, // Default to false so custom brushes use their tip colors
      currentBrushTip: undefined, // Clear any cached brush tips
      hueShift: 0,           // Reset global hueShift when selecting custom brush
      saturationAdjust: 100  // Reset global saturationAdjust when selecting custom brush
    });
    
    // Switch to brush tool for immediate use
    setCurrentTool('brush');
    
    // Clear the selection
    clearSelection();
    
    
    return tempBrush;
    
  }, [selectionStart, selectionEnd, project, setBrushSettings, setCurrentTool, clearSelection]);

  // Shape completion handler
  const handleDoubleClick = useCallback(async (e: React.MouseEvent) => {
    // Double-click now does nothing special for shapes since they complete on mouse up
    e.preventDefault();
  }, []);

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
        // Get current canvas image data
        const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
          
          // Schedule cleanup of large ImageData objects
          memoryManager.scheduleCleanup(() => {
            memoryManager.cleanupImageData(imageData);
          });
          
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
            
            // Capture the fill result to the active layer
            captureCanvasToActiveLayer(offscreenCanvas).then(() => {
              // Save state AFTER the fill is complete and captured
              saveCanvasState(offscreenCanvas, 'fill', 'Fill operation');
            }).catch((error) => {
            });
            
            // Flood fill affects large areas, require full redraw
            markFullRedraw();
            // Request re-render
            needsRedraw.current = true;
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
      // Ensure drawing is disabled during selection
      setIsDrawing(false);
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

    // Handle shape mode for brush and eraser tools
    if ((tools.currentTool === 'brush' || tools.currentTool === 'eraser') && tools.brushSettings.shapeEnabled) {
      // Start new shape (like starting a brush stroke)
      setShapeDrawing(true);
      clearShapePoints();
      addShapePoint(point);
      
      // Also set normal drawing state so pointer move events work
      setIsDrawing(true);
      setLastPoint(point);
      
      // Lock the target layer to prevent pixel swapping if user switches layers mid-stroke
      const targetLayerId = activeLayerId || layers[0]?.id || null;
      
      // Check transparency lock - if enabled, only allow painting over non-transparent pixels
      const targetLayer = layers.find(l => l.id === targetLayerId);
      if (targetLayer?.locked) {
        // Store transparency lock state for use in brush engine
        (window as any).transparencyLockEnabled = true;
        (window as any).transparencyLockLayerId = targetLayerId;
      } else {
        (window as any).transparencyLockEnabled = false;
      }
      
      setDrawingTargetLayerId(targetLayerId);
      
      e.preventDefault();
      return;
    }

    // Handle rectangle gradient brush
    if (tools.currentTool === 'brush' && tools.brushSettings.brushShape === BrushShape.RECTANGLE_GRADIENT) {
      e.preventDefault();
      
      if (rectangleBrushState.drawingState === 'idle') {
        // Start length definition - begin drag
        setRectangleBrushState({
          drawingState: 'definingLength',
          startPos: point,
          currentPos: point,
          startColor: sampleColor(point.x, point.y) || '#000000',
        });
        // Initialize ref state for smooth dragging
        rectangleBrushLiveState.current.currentPos = point;
        setIsDrawing(true); // Enable drag mode
        needsRedraw.current = true; // Immediately show the starting point
      } else if (rectangleBrushState.drawingState === 'definingWidth') {
        // Finalize rectangle
        const offscreenCanvas = offscreenCanvasRef.current;
        if (offscreenCanvas) {
          const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
          if (ctx) {
            // Create final rectangle state with width from ref and hue-shifted colors
            const finalRectangleState = {
              ...rectangleBrushState,
              width: rectangleBrushLiveState.current.width,
              startColor: shiftHue(rectangleBrushState.startColor, 8),
              endColor: shiftHue(rectangleBrushState.endColor, 8)
            };
            
            // Draw the rectangle gradient
            drawRectangleGradient(ctx, finalRectangleState);
            
            // Save canvas state for undo/redo
            saveCanvasState(offscreenCanvas, 'brush', 'Rectangle gradient');
            needsRedraw.current = true;
          }
        }
        setRectangleBrushState({ drawingState: 'idle' });
      }
      return;
    }

    // Handle polygon gradient brush
    if (tools.currentTool === 'brush' && tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT) {
      e.preventDefault();
      
      if (polygonGradientState.drawingState === 'idle') {
        // Start free drawing - initialize live state and begin drawing
        setPolygonGradientState({ drawingState: 'drawing' });
        // Initialize live points with first point (no color sampling yet)
        polygonGradientLiveState.current.livePoints = [{ x: point.x, y: point.y, color: '' }];
        setIsDrawing(true);
      }
      
      needsRedraw.current = true;
      return;
    }

    // Note: State will be captured AFTER stroke completion in handlePointerUp
    
    // Lock the target layer to prevent pixel swapping if user switches layers mid-stroke
    const targetLayerId = activeLayerId || layers[0]?.id || null;
    
    // Check transparency lock - if enabled, only allow painting over non-transparent pixels
    const targetLayer = layers.find(l => l.id === targetLayerId);
    if (targetLayer?.locked) {
      // Store transparency lock state for use in brush engine
      (window as any).transparencyLockEnabled = true;
      (window as any).transparencyLockLayerId = targetLayerId;
    } else {
      (window as any).transparencyLockEnabled = false;
    }
    
    setDrawingTargetLayerId(targetLayerId);
    
    setIsDrawing(true);
    setLastPoint(point);
    // Get pressure from pointer event (0.0 to 1.0), ensure consistent behavior between mouse and stylus
    const pressure = tools.brushSettings.pressureEnabled && e.pressure !== undefined ? e.pressure : 1.0;
    setCursor({ x: point.x, y: point.y, pressure });
    
    // Performance monitoring
    if (process.env.NODE_ENV === 'development') {
      performanceRef.current.pointerDownTime = performance.now();
      performanceRef.current.strokeStartTime = performance.now();
    }
    
    // Reset pixel queue for new stroke
    resetPixelQueue();
  }, [spacebarPressed, screenToCanvas, setCursor, resetPixelQueue, updateMousePosition, mouseX, mouseY, canvas.selection.active, isPointInSelection, tools.currentTool, sampleColor, setBrushSettings, setSelectionBounds, setIsSelecting, saveCanvasStateDeduped, offscreenCanvasRef]);

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
    // Get pressure from pointer event (0.0 to 1.0), ensure consistent behavior between mouse and stylus
    const rawPressure = tools.brushSettings.pressureEnabled && e.pressure !== undefined ? e.pressure : 1.0;
    const smoothedPressure = smoothPressure(rawPressure);
    setCursor({ x: point.x, y: point.y, pressure: smoothedPressure });

    // --- RECTANGLE GRADIENT LOGIC ---
    if (tools.currentTool === 'brush' && tools.brushSettings.brushShape === BrushShape.RECTANGLE_GRADIENT) {
      const { drawingState, startPos, endPos } = rectangleBrushState;

      if (drawingState === 'definingLength') {
        // Update the LIVE state in the ref, NOT the store
        rectangleBrushLiveState.current.currentPos = point;
        needsRedraw.current = true; // Tell the render loop to draw the preview
      } else if (drawingState === 'definingWidth') {
        // Calculate and update the LIVE width in the ref
        const dx = endPos.x - startPos.x;
        const dy = endPos.y - startPos.y;
        const dist = Math.abs(dy * point.x - dx * point.y + endPos.x * startPos.y - endPos.y * startPos.x) / Math.hypot(dx, dy);
        rectangleBrushLiveState.current.width = dist * 2;
        needsRedraw.current = true; // Tell the render loop to draw the preview
      }
      // IMPORTANT: We return here to stop any other brush logic from running
      return;
    }

    // --- POLYGON GRADIENT LOGIC ---
    if (tools.currentTool === 'brush' && tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT) {
      if (polygonGradientState.drawingState === 'drawing' && isDrawing) {
        // Only collect path points (no expensive color sampling)
        const livePoints = polygonGradientLiveState.current.livePoints;
        const lastPoint = livePoints[livePoints.length - 1];
        const minDistance = 8; // Moderate distance for smooth drawing
        
        if (!lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= minDistance) {
          // Add to LIVE ref state (just coordinates, no color)
          livePoints.push({ x: point.x, y: point.y, color: '' });
        }
        
        needsRedraw.current = true;
      }
      return;
    }

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

    // Only draw if not in selection mode
    if (isDrawing && lastPoint && !isSelecting) {
      // Handle shape mode - collect points while drawing
      if ((tools.currentTool === 'brush' || tools.currentTool === 'eraser') && tools.brushSettings.shapeEnabled && shapeState.isDrawing) {
        // Add point to shape with some distance threshold to avoid too many points
        const lastShapePoint = shapeState.points[shapeState.points.length - 1];
        if (!lastShapePoint || 
            Math.sqrt(Math.pow(point.x - lastShapePoint.x, 2) + Math.pow(point.y - lastShapePoint.y, 2)) > 5) {
          addShapePoint(point);
          
          // Update preview path
          const simplifiedPoints = simplifyPath(shapeState.points, 3);
          if (simplifiedPoints.length >= 2) {
            const previewPath = createShapePath(simplifiedPoints);
            setShapePreviewPath(previewPath);
          }
        }
      } else {
        // Normal brush drawing
        try {
          drawLine(lastPoint, point);
        } catch (error) {
        }
      }
      setLastPoint(point);
    }
  }, [isPanning, mouseX, mouseY, lastMouseX, lastMouseY, canvas.panX, canvas.panY, setPan, screenToCanvas, setCursor, isDrawing, lastPoint, drawLine, updateMousePosition, isDraggingSelection, selectionDragStart, canvas.selection, setSelection, isSelecting, selectionStart, setSelectionBounds, smoothPressure, isPalmRejectionEvent, tools.currentTool, tools.brushSettings.shapeEnabled, shapeState.isDrawing, shapeState.points, addShapePoint, setShapePreviewPath]);

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
      
      // If custom tool is active, create a temporary custom brush for immediate use
      if (tools.currentTool === 'custom' && selectionStart && selectionEnd && project) {
        await createTemporaryCustomBrush();
      }
      
      return;
    }

    if (isDraggingSelection) {
      // End selection dragging
      setIsDraggingSelection(false);
      setSelectionDragStart(null);
      return;
    }

    // Handle rectangle gradient brush state transitions
    if (tools.currentTool === 'brush' && tools.brushSettings.brushShape === BrushShape.RECTANGLE_GRADIENT) {
      const { drawingState } = rectangleBrushState;
      
      if (drawingState === 'definingLength' && isDrawing) {
        // Release from drag - switch to width definition mode
        setIsDrawing(false);
        const currentPos = rectangleBrushLiveState.current.currentPos;
        setRectangleBrushState({
          drawingState: 'definingWidth',
          endPos: currentPos,
          endColor: sampleColor(currentPos.x, currentPos.y) || '#000000',
        });
        return;
      }
    }

    // Handle polygon gradient brush completion
    if (tools.currentTool === 'brush' && tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT) {
      if (polygonGradientState.drawingState === 'drawing' && isDrawing) {
        const livePoints = polygonGradientLiveState.current.livePoints;
        
        // Complete polygon if we have at least 3 points
        if (livePoints.length >= 3) {
          const offscreenCanvas = offscreenCanvasRef.current;
          if (offscreenCanvas) {
            const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
            if (ctx) {
              // NOW do the expensive color sampling only once on completion
              // Sample from the main visible canvas for accurate colors
              const mainCanvasCtx = canvasRef.current?.getContext('2d');
              const finalColors = mainCanvasCtx ? 
                sampleCanvasColors(mainCanvasCtx, livePoints, 8) : 
                ['#FFF', '#000'];
              
              // Create final points with proper color sampling
              const finalPointsWithColors = livePoints.map((point, index) => ({
                ...point,
                color: finalColors[Math.floor((index / livePoints.length) * finalColors.length)]
              }));
              
              drawPolygonGradient(ctx, { vertices: livePoints, colors: finalColors });
              saveCanvasState(offscreenCanvas, 'brush', 'Polygon gradient');
              needsRedraw.current = true;
            }
          }
        }
        
        // Clear both live and store state
        polygonGradientLiveState.current.livePoints = [];
        clearPolygonGradientPoints();
        setPolygonGradientState({ drawingState: 'idle' });
        setIsDrawing(false);
        return;
      }
    }

    // Handle shape completion on pointer up (for shape mode)
    if (shapeState.isDrawing && (tools.currentTool === 'brush' || tools.currentTool === 'eraser') && tools.brushSettings.shapeEnabled) {
      // Complete the shape on mouse up
      const offscreenCanvas = offscreenCanvasRef.current;
      if (offscreenCanvas && shapeState.points.length >= 3) {
        const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
        if (ctx) {
          // Create and render the final shape
          const simplifiedPoints = simplifyPath(shapeState.points);
          const shapePath = createShapePath(simplifiedPoints);
          
          // Get current brush settings for shape rendering
          const brushSettings = tools.brushSettings;
          const currentCustomBrush = brushSettings.brushShape === BrushShape.CUSTOM && 
            brushSettings.selectedCustomBrush
            ? (temporaryCustomBrush && temporaryCustomBrush.id === brushSettings.selectedCustomBrush
                ? temporaryCustomBrush
                : project?.customBrushes?.find(b => b.id === brushSettings.selectedCustomBrush))
            : null;

          // Render the shape directly to offscreen canvas (this "bakes" it)
          ctx.save();
          ctx.globalAlpha = brushSettings.opacity;
          ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
          
          renderShape(
            ctx,
            shapePath,
            brushSettings.color,
            currentCustomBrush || undefined,
            brushSettings.useSwatchColor,
            brushSettings.hueShift,
            brushSettings.saturationAdjust,
            brushSettings.brushShape,
            brushSettings.antialiasing,
            shapeState.points
          );
          
          ctx.restore();

          // Capture to layer and save state (shape is now baked into offscreen canvas)
          const targetLayerId = activeLayerId || layers[0]?.id || null;
          await captureCanvasToLayer(offscreenCanvas, targetLayerId);
          const actionType = tools.currentTool === 'eraser' ? 'eraser' : 'brush';
          saveCanvasStateDeduped(offscreenCanvas, actionType, `${actionType} shape`);
          
          // Force full redraw and layer recomposition to show the baked result
          markFullRedraw();
          setLayersNeedRecomposition(true);
          needsRedraw.current = true;
          
          // Reset shape state after the shape is baked and rendered
          setTimeout(() => {
            setShapeDrawing(false);
            clearShapePoints();
            setShapePreviewPath(undefined);
            shapePreviewCacheRef.current = null;
          }, 100); // Delay to ensure everything is rendered
        }
      }

      // Also clear normal drawing state
      setIsDrawing(false);
      setLastPoint(null);
      setDrawingTargetLayerId(null);
      
      return;
    }

    // OPTIMIZATION: Immediately update UI state to prevent brush from continuing to paint
    // BUT only for actual drawing operations, not selections
    const wasDrawing = isDrawing;
    const targetLayerId = drawingTargetLayerId;
    const offscreenCanvas = offscreenCanvasRef.current;
    
    // Immediately clear drawing state for responsive UI
    setIsDrawing(false);
    setLastPoint(null);
    setDrawingTargetLayerId(null);
    
    // Performance monitoring (silent - data available in dev tools if needed)
    if (process.env.NODE_ENV === 'development' && wasDrawing) {
      performanceRef.current.pointerUpTime = performance.now();
      // Latency data available for debugging if needed
    }

    // Defer heavy operations to avoid blocking the UI
    if (wasDrawing && offscreenCanvas) {
      // Use requestIdleCallback for non-critical operations
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
          // Capture canvas to layer
          captureCanvasToLayer(offscreenCanvas, targetLayerId).then(() => {
            // Save state after capture completes
            const actionType = tools.currentTool === 'eraser' ? 'eraser' : 'brush';
            saveCanvasStateDeduped(offscreenCanvas, actionType, `${actionType} stroke`);
          });
        }, { timeout: 100 }); // Ensure it runs within 100ms
      } else {
        // Fallback for browsers without requestIdleCallback
        setTimeout(() => {
          captureCanvasToLayer(offscreenCanvas, targetLayerId).then(() => {
            const actionType = tools.currentTool === 'eraser' ? 'eraser' : 'brush';
            saveCanvasStateDeduped(offscreenCanvas, actionType, `${actionType} stroke`);
          });
        }, 0);
      }
    }
  }, [isPanning, isDraggingSelection, isSelecting, tools, selectionStart, selectionEnd, project, createTemporaryCustomBrush, isDrawing, captureCanvasToLayer, drawingTargetLayerId, saveCanvasStateDeduped, shapeState.isDrawing, shapeState.points, activeLayerId, layers, temporaryCustomBrush, markFullRedraw, renderView, setLayersNeedRecomposition, setShapeDrawing, clearShapePoints, setShapePreviewPath]);

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
    
    // Note: State will be captured AFTER stroke completion in handleTouchEnd
    
    // Lock the target layer to prevent pixel swapping if user switches layers mid-stroke  
    const targetLayerId = activeLayerId || layers[0]?.id || null;
    setDrawingTargetLayerId(targetLayerId);
    
    setIsDrawing(true);
    setLastPoint(point);
    // Touch events don't have pressure, use 0.0 when pressure is enabled, 1.0 otherwise
    setCursor({ x: point.x, y: point.y, pressure: tools.brushSettings.pressureEnabled ? 0.0 : 1.0 });
    
    // Performance monitoring
    if (process.env.NODE_ENV === 'development') {
      performanceRef.current.strokeStartTime = performance.now();
    }
    
    // Reset pixel queue for new stroke
    resetPixelQueue();
  }, [spacebarPressed, screenToCanvas, setCursor, resetPixelQueue, updateMousePosition, mouseX, mouseY, saveCanvasStateDeduped, offscreenCanvasRef]);

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

    // OPTIMIZATION: Immediately update UI state to prevent brush from continuing to paint
    const wasDrawing = isDrawing;
    const targetLayerId = drawingTargetLayerId;
    const offscreenCanvas = offscreenCanvasRef.current;
    
    // Immediately clear drawing state for responsive UI
    setIsDrawing(false);
    setLastPoint(null);
    setDrawingTargetLayerId(null);
    
    // Performance monitoring (silent - data available in dev tools if needed)
    if (process.env.NODE_ENV === 'development' && wasDrawing) {
      const touchEndTime = performance.now();
      // Touch stroke timing data available for debugging if needed
    }

    // Defer heavy operations to avoid blocking the UI
    if (wasDrawing && offscreenCanvas) {
      // Use requestIdleCallback for non-critical operations
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
          // Capture canvas to layer
          captureCanvasToLayer(offscreenCanvas, targetLayerId).then(() => {
            // Save state after capture completes
            const actionType = tools.currentTool === 'eraser' ? 'eraser' : 'brush';
            saveCanvasStateDeduped(offscreenCanvas, actionType, `${actionType} stroke`);
          });
        }, { timeout: 100 }); // Ensure it runs within 100ms
      } else {
        // Fallback for browsers without requestIdleCallback
        setTimeout(() => {
          captureCanvasToLayer(offscreenCanvas, targetLayerId).then(() => {
            const actionType = tools.currentTool === 'eraser' ? 'eraser' : 'brush';
            saveCanvasStateDeduped(offscreenCanvas, actionType, `${actionType} stroke`);
          });
        }, 0);
      }
    }
  }, [isPanning, isDrawing, captureCanvasToLayer, drawingTargetLayerId, tools.currentTool, saveCanvasStateDeduped]);

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
    
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!offscreenCtx) return;
    
    const { bounds, pixels } = canvas.selection;
    
    // Draw selection onto offscreen canvas
    if (pixels && pixels.width > 0 && pixels.height > 0) {
      const tempCanvas = canvasPool.acquire(pixels.width, pixels.height);
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      
      if (tempCtx) {
        tempCtx.putImageData(pixels, 0, 0);
        offscreenCtx.drawImage(tempCanvas, bounds.x, bounds.y);
        canvasPool.release(tempCanvas);
      }
    }
    
    // Clear selection
    setSelection({
      active: false,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      pixels: typeof ImageData !== 'undefined' ? new ImageData(1, 1) : {} as ImageData
    });
    
    // Capture the pasted content to the active layer
    captureCanvasToActiveLayer(offscreenCanvas).then(() => {
    }).catch((error) => {
    });
    
    // Paste affects large areas, require full redraw
    markFullRedraw();
    // Request re-render
    needsRedraw.current = true;
  }, [canvas.selection, setSelection, renderView, saveCanvasState, captureCanvasToActiveLayer, markFullRedraw]);

  // Keyboard event handlers
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore synthetic keyboard events that might be triggered by stylus input
    if (!e.isTrusted || e.detail > 0) {
      return;
    }
    
    const state = stateRef.current;
    
    // Prevent tool switching during selection operations
    if (state.isSelecting) {
      return;
    }
    // Undo/Redo shortcuts
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      e.stopPropagation();
      
      // Get fresh store state instead of stale ref
      const store = useAppStore.getState();
      
      if (e.shiftKey) {
        // Redo (Ctrl+Shift+Z)
        if (store.canRedo()) {
          const snapshot = store.redo();
          if (snapshot && offscreenCanvasRef.current) {
            restoreCanvasSnapshot(offscreenCanvasRef.current, snapshot);
            markFullRedraw();
            needsRedraw.current = true;
          } else {
          }
        } else {
        }
      } else {
        // Undo (Ctrl+Z)
        if (store.canUndo()) {
          const snapshot = store.undo();
          if (snapshot && offscreenCanvasRef.current) {
            restoreCanvasSnapshot(offscreenCanvasRef.current, snapshot);
            markFullRedraw();
            needsRedraw.current = true;
          } else {
          }
        } else {
        }
      }
      return;
    }
    
    // E key for temporary eraser mode
    if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey) {
      if (!state.eKeyPressed && state.tools.currentTool !== 'eraser') {
        e.preventDefault();
        setEKeyPressed(true);
        setToolBeforeEraser(state.tools.currentTool);
        state.setCurrentTool('eraser');
      }
      return;
    }
    
    // Alt key for temporary eyedropper mode
    if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey) {
      if (!state.altKeyPressed && state.tools.currentTool !== 'eyedropper') {
        e.preventDefault();
        setAltKeyPressed(true);
        setToolBeforeEyedropper(state.tools.currentTool);
        state.setCurrentTool('eyedropper');
      }
      return;
    }
    
    // Space key for pan mode
    if (e.code === 'Space' && !state.spacebarPressed) {
      e.preventDefault();
      setSpacebarPressed(true);
    }
    
    // Selection controls
    if (state.canvas.selection.active) {
      if (e.key === 'Enter') {
        e.preventDefault();
        state.commitSelection();
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        state.setSelection({
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
                    const tempCanvas = canvasPool.acquire(img.width, img.height);
                    const ctx = tempCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
                    
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
                      
                      canvasPool.release(tempCanvas);
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
        state.setCurrentTool('brush');
        return;
      }
    }
    
    if (e.key === 'm' || e.key === 'M') {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        state.setCurrentTool('selection');
        return;
      }
    }
    
    if (e.key === 'c' || e.key === 'C') {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        state.setCurrentTool('custom');
        return;
      }
    }
    
    if (e.key === 'f' || e.key === 'F') {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        state.setCurrentTool('fill');
        return;
      }
    }
    
    // Brush settings toggle shortcuts
    if (e.key === 's' || e.key === 'S') {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        state.setBrushSettings({ shapeEnabled: !state.tools.brushSettings.shapeEnabled });
        return;
      }
    }
    
    if (e.key === 'j' || e.key === 'J') {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        // Toggle color jitter between 0 and previous value (or 20 as default)
        const currentJitter = state.tools.brushSettings.colorJitter || 0;
        const newJitter = currentJitter > 0 ? 0 : 20;
        state.setBrushSettings({ colorJitter: newJitter });
        return;
      }
    }
    
    if (e.key === 'g' || e.key === 'G') {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        state.setBrushSettings({ gridSnapEnabled: !state.tools.brushSettings.gridSnapEnabled });
        return;
      }
    }
    
    if (e.key === 'p' || e.key === 'P') {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        state.setBrushSettings({ pressureEnabled: !state.tools.brushSettings.pressureEnabled });
        return;
      }
    }
    
    if (e.key === 'r' || e.key === 'R') {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        state.setBrushSettings({ rotationEnabled: !state.tools.brushSettings.rotationEnabled });
        return;
      }
    }
    
    if (e.key === 'd' || e.key === 'D') {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        state.setBrushSettings({ dashedEnabled: !state.tools.brushSettings.dashedEnabled });
        return;
      }
    }
    
    // Brush size shortcuts - different behavior for custom vs regular brushes
    if (e.key === '[') {
      if (state.tools.brushSettings.brushShape === BrushShape.CUSTOM) {
        // Custom brush: decrease by 10% increments, minimum 10%
        state.setBrushSettings({ size: Math.max(10, state.tools.brushSettings.size - 10) });
      } else {
        // Regular brush: decrease by 1px, minimum 1px
        state.setBrushSettings({ size: Math.max(1, state.tools.brushSettings.size - 1) });
      }
    } else if (e.key === ']') {
      if (state.tools.brushSettings.brushShape === BrushShape.CUSTOM) {
        // Custom brush: increase by 10% increments, maximum 500%
        state.setBrushSettings({ size: Math.min(500, state.tools.brushSettings.size + 10) });
      } else {
        // Regular brush: increase by 1px, maximum 100px
        state.setBrushSettings({ size: Math.min(100, state.tools.brushSettings.size + 1) });
      }
    }
    
    // Handle polygon gradient cancellation
    if (tools.currentTool === 'brush' && tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT) {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Cancel polygon creation while drawing
        if (polygonGradientState.drawingState === 'drawing') {
          // Clear both live and store state
          polygonGradientLiveState.current.livePoints = [];
          clearPolygonGradientPoints();
          setPolygonGradientState({ drawingState: 'idle' });
          setIsDrawing(false);
          needsRedraw.current = true;
        }
      }
    }
    
  }, [offscreenCanvasRef, setEKeyPressed, setToolBeforeEraser, setAltKeyPressed, setToolBeforeEyedropper, setSpacebarPressed, setSelection, renderView, tools.currentTool, tools.brushSettings.brushShape, polygonGradientState, drawPolygonGradient, clearPolygonGradientPoints, setPolygonGradientState]);

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
    
    const ctx = canvasElement.getContext('2d', { colorSpace: 'srgb' });
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
      
      // Initialize offscreen canvas
      const offscreenCtx = offscreenCanvasRef.current.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      if (offscreenCtx) {
        // Disable image smoothing for pixel-perfect rendering
        offscreenCtx.imageSmoothingEnabled = false;
        // Only fill background if project has a non-transparent background
        if (project?.backgroundColor && project.backgroundColor !== 'transparent') {
          offscreenCtx.fillStyle = project.backgroundColor;
          offscreenCtx.fillRect(0, 0, width, height);
        }
      }
    }
  }, [width, height, project?.backgroundColor]);

  // Update canvas dimensions when needed
  const updateCanvasDimensions = useCallback(() => {
    const canvasElement = canvasRef.current;
    const wrapperElement = wrapperRef.current;
    if (!canvasElement || !wrapperElement) return;
    
    const ctx = canvasElement.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) return;
    
    // Update wrapper dimensions to match new canvas size
    wrapperElement.style.width = `${width}px`;
    wrapperElement.style.height = `${height}px`;
    
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
    
    // Update offscreen canvas dimensions
    if (offscreenCanvasRef.current) {
      const currentWidth = offscreenCanvasRef.current.width;
      const currentHeight = offscreenCanvasRef.current.height;
      
      // Only resize if dimensions actually changed
      if (currentWidth !== width || currentHeight !== height) {
        // Save current content before resizing
        const offscreenCtx = offscreenCanvasRef.current.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
        if (offscreenCtx) {
          const imageData = offscreenCtx.getImageData(0, 0, 
            Math.min(currentWidth, width), 
            Math.min(currentHeight, height)
          );
          
          // Resize the canvas
          offscreenCanvasRef.current.width = width;
          offscreenCanvasRef.current.height = height;
          
          // Restore content
          offscreenCtx.putImageData(imageData, 0, 0);
        }
      }
    }
    
    // Force full redraw after dimension update
    markFullRedraw();
    needsRedraw.current = true;
  }, [width, height, markFullRedraw, renderView]);

  // Detect dimension changes and update canvas state
  useEffect(() => {
    if (canvas.canvasWidth !== width || canvas.canvasHeight !== height) {
      // Project dimension change detected - update canvas dimensions
      setCanvasDimensions(width, height);
    }
  }, [width, height, canvas.canvasWidth, canvas.canvasHeight, setCanvasDimensions]);

  // Handle canvas dimension updates when needed
  useEffect(() => {
    if (canvas.needsDimensionUpdate) {
      // Canvas dimension update triggered
      updateCanvasDimensions();
      
      // Force layer recomposition after dimension update
      setLayersNeedRecomposition(true);
      
      // Clear the flag after updating using the store
      useAppStore.setState((state) => ({
        canvas: { ...state.canvas, needsDimensionUpdate: false }
      }));
    }
  }, [canvas.needsDimensionUpdate, updateCanvasDimensions, setLayersNeedRecomposition, width, height, canvas.canvasWidth, canvas.canvasHeight]);

  // Update offscreen canvas size when project dimensions change
  useEffect(() => {
    if (offscreenCanvasRef.current && project) {
      const currentWidth = offscreenCanvasRef.current.width;
      const currentHeight = offscreenCanvasRef.current.height;
      
      // Only resize if dimensions actually changed
      if (currentWidth !== width || currentHeight !== height) {
        
        // Save current content before resizing
        const ctx = offscreenCanvasRef.current.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, 
            Math.min(currentWidth, width), 
            Math.min(currentHeight, height)
          );
          
          // Resize the canvas
          offscreenCanvasRef.current.width = width;
          offscreenCanvasRef.current.height = height;
          
          // Restore content
          ctx.putImageData(imageData, 0, 0);
          
          // Request re-render
          needsRedraw.current = true;
        }
      }
    }
  }, [width, height, project, renderView]);

  // Canvas initialization - only setup on first mount
  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    // Setup canvas context with error handling
    try {
      const ctx = canvasElement.getContext('2d', { colorSpace: 'srgb' });
      if (ctx) {
        // Only initialize once
        if (!isCanvasInitialized) {
          initializeCanvas();
          setIsCanvasInitialized(true);
          
          // Update project dimensions to match canvas
          setProjectDimensions(width, height);
          
          // Reset pan to default position (world origin at canvas origin)
          setPan(0, 0);
          
          // Capture initial blank canvas state for undo history
          setTimeout(() => {
            const offscreenCanvas = offscreenCanvasRef.current;
            if (offscreenCanvas) {
              saveCanvasState(offscreenCanvas, 'brush', 'Initial state');
              // Reset the deduplication timer so first stroke isn't blocked
              lastSaveCanvasStateTime.current = 0;
            }
          }, 100); // Small delay to ensure canvas is fully initialized
        }
      }
    } catch (error) {
    }
  }, [isCanvasInitialized, initializeCanvas, setPan, setProjectDimensions, width, height, saveCanvasState]);

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
      
      // Cleanup memory manager when component unmounts
      memoryManager.runCleanup();
    };
  }, [handlePaste]); // Include handlePaste in dependency array



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
      // These changes require full redraw
      markFullRedraw();
      needsRedraw.current = true;
    }
  }, [canvas.zoom, canvas.panX, canvas.panY, isCanvasInitialized, markFullRedraw]);

  // Optimized animation for marching ants - only updates selection border
  const lastRenderTime = useRef(0);
  
  // Master render loop - single source of truth for all rendering
  useEffect(() => {
    let animationFrameId: number;
    
    const masterRenderLoop = (timestamp: number) => {
      // Check if rendering is needed for any reason
      const hasSelection = canvas.selection.active || (selectionStart && selectionEnd);
      const isCurrentlyDrawing = isDrawing;
      
      // Throttle selection animation to 30fps for better performance
      const shouldRenderSelection = hasSelection && (timestamp - lastRenderTime.current > 33);
      
      // Render if: needsRedraw flag is set, drawing is active, or selection needs animation
      if (needsRedraw.current || isCurrentlyDrawing || shouldRenderSelection) {
        renderView();
        needsRedraw.current = false;
        
        if (shouldRenderSelection) {
          lastRenderTime.current = timestamp;
        }
      }
      
      // Continue the loop
      animationFrameId = requestAnimationFrame(masterRenderLoop);
    };
    
    // Start the master loop
    animationFrameId = requestAnimationFrame(masterRenderLoop);
    
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [renderView, canvas.selection.active, selectionStart, selectionEnd, isDrawing]);

  // Canvas styling with cursor updates
  const canvasStyle: React.CSSProperties = {
    cursor: spacebarPressed 
      ? (isPanning ? 'grabbing' : 'grab') 
      : (tools.brushSettings.brushShape === BrushShape.RECTANGLE_GRADIENT || tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT) ? 'crosshair'
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
      
      // Skip layer recomposition during history operations to prevent interference
      if (history.isCapturing) {
        return;
      }
      
      if (offscreenCanvasRef.current) {
        compositeLayersToCanvas(offscreenCanvasRef.current);
        markFullRedraw();
        needsRedraw.current = true;
        setLayersNeedRecomposition(false);
      } else {
      }
    }
  }, [layersNeedRecomposition, compositeLayersToCanvas, renderView, setLayersNeedRecomposition, layers, history.isCapturing, markFullRedraw]);

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


  const currentCustomBrush = tools.brushSettings.brushShape === BrushShape.CUSTOM && 
    tools.brushSettings.selectedCustomBrush
    ? (temporaryCustomBrush && temporaryCustomBrush.id === tools.brushSettings.selectedCustomBrush
        ? temporaryCustomBrush
        : project?.customBrushes?.find(b => b.id === tools.brushSettings.selectedCustomBrush))
    : null;


  return (
    <>
      <div 
        className="w-full h-full bg-[#141514] relative"
        style={{
          overflow: 'visible'
        }}
      >
        {/* Wrapper div for absolute positioning context */}
        <div ref={wrapperRef} className="relative mx-auto" style={{ width: `${width}px`, height: `${height}px` }}>
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
          onDoubleClick={handleDoubleClick}
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