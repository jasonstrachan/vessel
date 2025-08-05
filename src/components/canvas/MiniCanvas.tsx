'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Minus, Plus, Undo2, Redo2 } from 'lucide-react';
import { BrushShape } from '../../types';
import { adjustHueAndSaturation } from '../../utils/imageProcessing';

interface MiniCanvasProps {
  width?: number;
  height?: number;
  className?: string;
  hueShift?: number;
  saturation?: number;
  onBrushTipChange?: (imageData: ImageData, actualWidth: number, actualHeight: number) => void;
}

const MiniCanvas = ({ 
  width = 128, 
  height = 128, 
  className = '', 
  hueShift = 0, 
  saturation = 100,
  onBrushTipChange
}: MiniCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const renderPendingRef = useRef<boolean>(false);

  // Local state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);
  const [originalBrushData, setOriginalBrushData] = useState<ImageData | null>(null);
  const [previousBrushType, setPreviousBrushType] = useState<string>('');
  
  // Panning state
  const [spacebarPressed, setSpacebarPressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [mouseStart, setMouseStart] = useState({ x: 0, y: 0 });
  
  // Mini canvas undo/redo state
  const [undoStack, setUndoStack] = useState<ImageData[]>([]);
  const [redoStack, setRedoStack] = useState<ImageData[]>([]);

  // Selective app state - only subscribe to what we actually need
  const brushSettings = useAppStore(state => state.tools.brushSettings);
  const temporaryCustomBrush = useAppStore(state => state.temporaryCustomBrush);
  const customBrushes = useAppStore(state => state.project?.customBrushes || []);
  const brushPresets = useAppStore(state => state.brushPresets);
  
  // Filter custom brush presets (memoized to avoid infinite loops)
  const customBrushPresets = React.useMemo(() => 
    brushPresets.filter(p => p.isCustomBrush && p.customBrushData),
    [brushPresets]
  );
  
  // Actions (stable references, don't cause re-renders)
  const setBrushSettings = useAppStore(state => state.setBrushSettings);

  // Helper function to check if current brush is read-only (should not be editable)
  const isBrushReadOnly = useCallback(() => {
    // Standard brush shapes (Round, Square, Pixel) are not editable
    if (brushSettings.brushShape !== BrushShape.CUSTOM) {
      return true;
    }
    
    // For custom brushes, ensure we have both the shape setting AND a valid selected brush
    if (!brushSettings.selectedCustomBrush) {
      return true; // No custom brush selected, treat as read-only
    }
    
    // Validate that the selected custom brush actually exists
    const customBrushExists = (
      // Check temporary custom brush
      (temporaryCustomBrush && temporaryCustomBrush.id === brushSettings.selectedCustomBrush) ||
      // Check project custom brushes
      (customBrushes.find(b => b.id === brushSettings.selectedCustomBrush)) ||
      // Check brush presets for custom brush data
      (customBrushPresets.find(p => p.id === brushSettings.selectedCustomBrush))
    );
    
    return !customBrushExists; // Read-only if brush doesn't exist
  }, [brushSettings.brushShape, brushSettings.selectedCustomBrush, temporaryCustomBrush, customBrushes, customBrushPresets]);

  // Helper function to calculate appropriate zoom
  const calculateFitZoom = (brushWidth: number, brushHeight: number): number => {
    const maxBrushDimension = Math.max(brushWidth, brushHeight);
    const canvasSize = Math.min(width, height);
    const targetSize = canvasSize * 0.8;
    return targetSize / maxBrushDimension;
  };


  // Initialize canvases
  useEffect(() => {
    const canvas = canvasRef.current;
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!canvas || !offscreenCanvas) return;

    // Detect brush type change
    const currentBrushType = `${brushSettings.brushShape}_${brushSettings.selectedCustomBrush || 'none'}`;
    const brushTypeChanged = previousBrushType && previousBrushType !== currentBrushType;
    setPreviousBrushType(currentBrushType);

    // Set up display canvas
    canvas.width = width;
    canvas.height = height;
    
    // Set up offscreen canvas (actual brush dimensions)
    const brushSize = getBrushTipSize();
    
    // CRITICAL: Clear the offscreen canvas when resizing to prevent stale data
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (offscreenCtx) {
      // Save current dimensions
      const oldWidth = offscreenCanvas.width;
      const oldHeight = offscreenCanvas.height;
      
      // Resize canvas
      offscreenCanvas.width = brushSize.width;
      offscreenCanvas.height = brushSize.height;
      
      // Clear the entire canvas if dimensions changed or brush type changed
      if (oldWidth !== brushSize.width || oldHeight !== brushSize.height || brushTypeChanged) {
        offscreenCtx.clearRect(0, 0, brushSize.width, brushSize.height);
      }
    }

    // Update brush tip with fresh data
    initializeBrushTip();
    
    // Calculate zoom to fit brush with padding
    const fitZoom = calculateFitZoom(brushSize.width, brushSize.height);
    setZoom(fitZoom);
    setPan({ x: 0, y: 0 }); // Reset pan to center
    
    // Clear undo/redo stacks when switching brushes
    if (brushTypeChanged) {
      setUndoStack([]);
      setRedoStack([]);
      setOriginalBrushData(null); // Clear original data to force fresh capture
    }
    
    // Schedule render
    scheduleRender();
  }, [width, height, brushSettings.brushShape, brushSettings.selectedCustomBrush, brushSettings.currentBrushTip, brushSettings.color, temporaryCustomBrush, customBrushPresets]);


  // Get the actual dimensions of the custom brush
  const getActualBrushDimensions = useCallback(() => {
    if (brushSettings.brushShape === BrushShape.CUSTOM && brushSettings.selectedCustomBrush) {
      let customBrush = temporaryCustomBrush && temporaryCustomBrush.id === brushSettings.selectedCustomBrush
        ? temporaryCustomBrush
        : customBrushes.find(b => b.id === brushSettings.selectedCustomBrush);
      
      // If not found in temporary or project brushes, check brush presets
      if (!customBrush) {
        const preset = customBrushPresets.find(p => p.id === brushSettings.selectedCustomBrush);
        
        if (preset && preset.customBrushData) {
          customBrush = {
            id: brushSettings.selectedCustomBrush,
            name: preset.name,
            imageData: preset.customBrushData.imageData,
            width: preset.customBrushData.width,
            height: preset.customBrushData.height,
            thumbnail: preset.thumbnail,
            createdAt: preset.createdAt.getTime()
          };
        }
      }
      
      if (customBrush) {
        return { width: customBrush.width, height: customBrush.height };
      }
    }
    // For standard brushes
    return { width: 64, height: 64 };
  }, [brushSettings.brushShape, brushSettings.selectedCustomBrush, temporaryCustomBrush, customBrushes, customBrushPresets]);

  // Get the size of the brush tip to display
  const getBrushTipSize = useCallback(() => {
    if (brushSettings.brushShape === BrushShape.CUSTOM && brushSettings.selectedCustomBrush) {
      let customBrush = temporaryCustomBrush && temporaryCustomBrush.id === brushSettings.selectedCustomBrush
        ? temporaryCustomBrush
        : customBrushes.find(b => b.id === brushSettings.selectedCustomBrush);
      
      // If not found in temporary or project brushes, check brush presets
      if (!customBrush) {
        const preset = customBrushPresets.find(p => p.id === brushSettings.selectedCustomBrush);
        
        if (preset && preset.customBrushData) {
          customBrush = {
            id: brushSettings.selectedCustomBrush,
            name: preset.name,
            imageData: preset.customBrushData.imageData,
            width: preset.customBrushData.width,
            height: preset.customBrushData.height,
            thumbnail: preset.thumbnail,
            createdAt: preset.createdAt.getTime()
          };
        }
      }
      
      if (customBrush) {
        // Return actual dimensions, not padded square
        return { width: customBrush.width, height: customBrush.height };
      }
    }
    // For standard brushes, use a fixed size for editing
    return { width: 64, height: 64 };
  }, [brushSettings.brushShape, brushSettings.selectedCustomBrush, temporaryCustomBrush, customBrushes, customBrushPresets]);


  // Initialize the brush tip data
  const initializeBrushTip = useCallback(() => {
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return;

    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx) return;

    const dimensions = getBrushTipSize();
    
    // Clear canvas only when necessary
    ctx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    
    // CRITICAL: Standard brushes should NEVER use currentBrushTip data
    if (brushSettings.brushShape !== BrushShape.CUSTOM) {
      // For standard brushes, always generate fresh geometric preview with current color
      ctx.fillStyle = brushSettings.color;
      
      const center = Math.max(dimensions.width, dimensions.height) / 2;
      const radius = Math.min(16, Math.max(dimensions.width, dimensions.height) / 4);
      
      switch (brushSettings.brushShape) {
        case BrushShape.ROUND:
          ctx.beginPath();
          ctx.arc(center, center, radius, 0, 2 * Math.PI);
          ctx.fill();
          break;
        case BrushShape.PIXEL_ROUND:
          ctx.beginPath();
          ctx.arc(center, center, Math.max(1, radius), 0, 2 * Math.PI);
          ctx.fill();
          break;
        case BrushShape.SQUARE:
          ctx.fillRect(center - radius, center - radius, radius * 2, radius * 2);
          break;
        case BrushShape.TRIANGLE:
          ctx.beginPath();
          ctx.moveTo(center, center - radius);
          ctx.lineTo(center - radius, center + radius);
          ctx.lineTo(center + radius, center + radius);
          ctx.closePath();
          ctx.fill();
          break;
        default: // Fallback
          ctx.fillRect(center - 1, center - 1, 2, 2);
          break;
      }
      
      // Store original data for reset
      setOriginalBrushData(ctx.getImageData(0, 0, dimensions.width, dimensions.height));
      return;
    }
    
    // Create current brush ID for custom brushes only
    const currentBrushId = brushSettings.selectedCustomBrush || 'no-custom-brush';
    
    // Check if we have a currentBrushTip for THIS specific custom brush
    if (brushSettings.currentBrushTip && 
        brushSettings.currentBrushTip.brushId === currentBrushId &&
        brushSettings.brushShape === BrushShape.CUSTOM) {
      // Use the edited brush tip for this custom brush (canvas already cleared above)
      ctx.putImageData(brushSettings.currentBrushTip.imageData, 0, 0);
      // Don't update originalBrushData here, keep the original for reset
      return;
    }
    
    if (brushSettings.brushShape === BrushShape.CUSTOM) {
      // Return early if no custom brush is selected
      if (!brushSettings.selectedCustomBrush) {
        return;
      }
      
      // Load custom brush - check temporary brush first, then project brushes, then brush presets
      let customBrush = temporaryCustomBrush && temporaryCustomBrush.id === brushSettings.selectedCustomBrush
        ? temporaryCustomBrush
        : customBrushes.find(b => b.id === brushSettings.selectedCustomBrush);
      
      
      // If not found in temporary or project brushes, check brush presets
      if (!customBrush) {
        const preset = customBrushPresets.find(p => p.id === brushSettings.selectedCustomBrush);
        
        if (preset && preset.customBrushData) {
          customBrush = {
            id: brushSettings.selectedCustomBrush,
            name: preset.name,
            imageData: preset.customBrushData.imageData,
            width: preset.customBrushData.width,
            height: preset.customBrushData.height,
            thumbnail: preset.thumbnail,
            createdAt: preset.createdAt.getTime()
          };
        }
      }
      
      if (customBrush) {
        // Canvas already cleared above - no need to clear again
        
        // 1. Store the UNMODIFIED, original brush data. This is the crucial step.
        setOriginalBrushData(customBrush.imageData);

        // 2. Apply hue/saturation for the preview on the offscreen canvas.
        //    Always transform from the true original data.
        let displayImageData = customBrush.imageData;
        if (hueShift !== 0 || saturation !== 100) {
          displayImageData = adjustHueAndSaturation(
            customBrush.imageData, // Always use the clean source
            hueShift,
            saturation
          );
        }
        
        // 3. Put the correctly transformed data onto the offscreen canvas.
        try {
          ctx.putImageData(displayImageData, 0, 0);
        } catch (error) {
          console.error("Failed to put image data on offscreen canvas:", error);
        }
        
        // NOTE: The onBrushTipChange call that was here can be removed.
        // A separate useEffect at the end of the file already handles this,
        // and it will now work correctly with the fixed originalBrushData.
        
        // Render update will be handled by caller
      }
    } else {
      // Create preview for standard brushes
      const dimensions = getBrushTipSize(); // For standard brushes, this returns {width: 64, height: 64}
      ctx.fillStyle = brushSettings.color;
      // Canvas already cleared above - no need to clear again
      
      const center = Math.max(dimensions.width, dimensions.height) / 2;
      const radius = Math.min(16, Math.max(dimensions.width, dimensions.height) / 4);
      
      switch (brushSettings.brushShape) {
        case BrushShape.ROUND:
          ctx.beginPath();
          ctx.arc(center, center, radius, 0, 2 * Math.PI);
          ctx.fill();
          break;
        case BrushShape.PIXEL_ROUND:
          ctx.beginPath();
          ctx.arc(center, center, Math.max(1, radius), 0, 2 * Math.PI);
          ctx.fill();
          break;
        case BrushShape.SQUARE:
          ctx.fillRect(center - radius, center - radius, radius * 2, radius * 2);
          break;
        case BrushShape.TRIANGLE:
          ctx.beginPath();
          ctx.moveTo(center, center - radius);
          ctx.lineTo(center - radius, center + radius);
          ctx.lineTo(center + radius, center + radius);
          ctx.closePath();
          ctx.fill();
          break;
        default: // Fallback
          ctx.fillRect(center - 1, center - 1, 2, 2);
          break;
      }
      
      // Store original data for reset only if we don't already have it
      if (!originalBrushData) {
        setOriginalBrushData(ctx.getImageData(0, 0, dimensions.width, dimensions.height));
      }
    }
  }, [brushSettings, temporaryCustomBrush, customBrushes, customBrushPresets, hueShift, saturation, originalBrushData, onBrushTipChange, getBrushTipSize, getActualBrushDimensions]);

  // Render the canvas with zoom and pan
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!canvas || !offscreenCanvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx || !offscreenCtx) return;

    // Save the current canvas state before clearing
    ctx.save();
    
    // Clear display canvas
    ctx.clearRect(0, 0, width, height);

    // Draw checkerboard background for transparency
    drawCheckerboard(ctx, width, height);

    // Calculate display parameters
    const brushDimensions = getBrushTipSize();
    const displayWidth = brushDimensions.width * zoom;
    const displayHeight = brushDimensions.height * zoom;
    const x = (width - displayWidth) / 2 + pan.x;
    const y = (height - displayHeight) / 2 + pan.y;

    // Disable image smoothing for pixel-perfect display
    ctx.imageSmoothingEnabled = false;
    
    // Apply hue shift and saturation if needed and draw the brush tip
    if ((hueShift !== 0 || saturation !== 100) && originalBrushData) {
      // Apply hue shift and saturation to the original brush data for accurate preview
      const adjustedData = adjustHueAndSaturation(originalBrushData, hueShift, saturation);
      
      // Create a temporary canvas to draw the adjusted data
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = brushDimensions.width;
      tempCanvas.height = brushDimensions.height;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      if (tempCtx) {
        tempCtx.putImageData(adjustedData, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0, brushDimensions.width, brushDimensions.height, x, y, displayWidth, displayHeight);
      }
    } else {
      ctx.drawImage(offscreenCanvas, 0, 0, brushDimensions.width, brushDimensions.height, x, y, displayWidth, displayHeight);
    }

    // Draw border
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, displayWidth, displayHeight);
    
    // Restore canvas state
    ctx.restore();
  }, [width, height, zoom, pan.x, pan.y, hueShift, saturation, originalBrushData, getBrushTipSize]);

  // Schedule a render to prevent multiple renders per frame
  const scheduleRender = useCallback(() => {
    if (renderPendingRef.current) return;
    renderPendingRef.current = true;
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    animationFrameRef.current = requestAnimationFrame(() => {
      renderPendingRef.current = false;
      renderCanvas();
    });
  }, [renderCanvas]);

  // Separate effect for hue/saturation changes - trigger re-rendering
  useEffect(() => {
    if (brushSettings.brushShape === BrushShape.CUSTOM && brushSettings.selectedCustomBrush) {
      // Force re-initialization to pick up hue/saturation changes
      initializeBrushTip();
      scheduleRender();
    }
  }, [hueShift, saturation, brushSettings.brushShape, brushSettings.selectedCustomBrush, scheduleRender, initializeBrushTip]);

  // Draw checkerboard background
  const drawCheckerboard = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const checkSize = 8;
    ctx.fillStyle = '#404040';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#606060';
    
    for (let x = 0; x < w; x += checkSize) {
      for (let y = 0; y < h; y += checkSize) {
        if ((Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2) {
          ctx.fillRect(x, y, checkSize, checkSize);
        }
      }
    }
  };

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = (screenX: number, screenY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;

    // Convert to offscreen canvas coordinates
    const brushDimensions = getBrushTipSize();
    const displayWidth = brushDimensions.width * zoom;
    const displayHeight = brushDimensions.height * zoom;
    const offsetX = (width - displayWidth) / 2 + pan.x;
    const offsetY = (height - displayHeight) / 2 + pan.y;

    const canvasX = ((x - offsetX) / displayWidth) * brushDimensions.width;
    const canvasY = ((y - offsetY) / displayHeight) * brushDimensions.height;

    return { 
      x: Math.max(0, Math.min(brushDimensions.width - 1, Math.floor(canvasX))), 
      y: Math.max(0, Math.min(brushDimensions.height - 1, Math.floor(canvasY)))
    };
  };

  // Handle drawing on the mini canvas
  const drawOnCanvas = (x: number, y: number, isStart: boolean = false) => {
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return;

    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx) return;

    // Use the current brush settings but smaller size for mini canvas
    const brushSize = Math.max(1, Math.floor(brushSettings.size / 4));
    
    // Use current brush color for all brushes
    const drawColor = brushSettings.color;
    
    if (isStart || !lastPoint) {
      // Single dot
      ctx.fillStyle = drawColor;
      ctx.globalAlpha = brushSettings.opacity;
      
      if (brushSettings.brushShape === BrushShape.ROUND) {
        ctx.beginPath();
        ctx.arc(x, y, brushSize / 2, 0, 2 * Math.PI);
        ctx.fill();
      } else {
        ctx.fillRect(x - brushSize / 2, y - brushSize / 2, brushSize, brushSize);
      }
      
      setLastPoint({ x, y });
    } else {
      // Draw line from last point
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = brushSettings.brushShape === BrushShape.ROUND ? 'round' : 'square';
      ctx.globalAlpha = brushSettings.opacity;
      
      ctx.beginPath();
      ctx.moveTo(lastPoint.x, lastPoint.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      
      setLastPoint({ x, y });
    }
    
    // Request a render update
    scheduleRender();
    
    // Emit the updated brush tip
    if (onBrushTipChange) {
      const brushDimensions = getBrushTipSize();
      const updatedImageData = ctx.getImageData(0, 0, brushDimensions.width, brushDimensions.height);
      const dimensions = getActualBrushDimensions();
      onBrushTipChange(updatedImageData, dimensions.width, dimensions.height);
    }
  };

  // Mouse event handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    
    // If spacebar is pressed, start panning instead of drawing
    if (spacebarPressed) {
      setIsPanning(true);
      setPanStart({ x: pan.x, y: pan.y });
      setMouseStart({ x: e.clientX, y: e.clientY });
      return;
    }
    
    // Don't allow drawing on read-only brushes
    if (isBrushReadOnly()) return;
    
    // Save current state to undo stack before editing
    saveToUndoStack();
    
    setIsDrawing(true);
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    drawOnCanvas(x, y, true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    e.preventDefault();
    
    // Handle panning
    if (isPanning) {
      const deltaX = e.clientX - mouseStart.x;
      const deltaY = e.clientY - mouseStart.y;
      setPan({
        x: panStart.x + deltaX,
        y: panStart.y + deltaY
      });
      return;
    }
    
    // Handle drawing
    if (!isDrawing) return;
    
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    drawOnCanvas(x, y);
  };

  const handlePointerUp = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }
    
    setIsDrawing(false);
    setLastPoint(null);
  };

  // Zoom controls
  const zoomIn = () => setZoom(Math.min(16, zoom * 1.2));
  const zoomOut = () => setZoom(Math.max(0.1, zoom / 1.2));



  // Save current state to undo stack
  const saveToUndoStack = useCallback(() => {
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return;
    
    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx) return;
    
    const brushDimensions = getBrushTipSize();
    const currentData = ctx.getImageData(0, 0, brushDimensions.width, brushDimensions.height);
    
    setUndoStack(prev => {
      const newStack = [...prev, currentData];
      // Keep max 20 undo states for mini canvas
      return newStack.slice(-20);
    });
    
    // Clear redo stack when new action is performed
    setRedoStack([]);
  }, [getBrushTipSize]);

  // Undo last action
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return;
    
    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx) return;
    
    // Save current state to redo stack
    const brushDimensions = getBrushTipSize();
    const currentData = ctx.getImageData(0, 0, brushDimensions.width, brushDimensions.height);
    setRedoStack(prev => [...prev, currentData]);
    
    // Restore previous state
    const previousState = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    
    ctx.putImageData(previousState, 0, 0);
    scheduleRender();
    
    // Emit the restored brush tip
    if (onBrushTipChange) {
      const dimensions = getActualBrushDimensions();
      onBrushTipChange(previousState, dimensions.width, dimensions.height);
    }
  }, [undoStack, getBrushTipSize, renderCanvas, onBrushTipChange, getActualBrushDimensions]);

  // Redo last undone action
  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return;
    
    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx) return;
    
    // Save current state to undo stack
    const brushDimensions = getBrushTipSize();
    const currentData = ctx.getImageData(0, 0, brushDimensions.width, brushDimensions.height);
    setUndoStack(prev => [...prev, currentData]);
    
    // Restore next state
    const nextState = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    
    ctx.putImageData(nextState, 0, 0);
    scheduleRender();
    
    // Emit the restored brush tip
    if (onBrushTipChange) {
      const dimensions = getActualBrushDimensions();
      onBrushTipChange(nextState, dimensions.width, dimensions.height);
    }
  }, [redoStack, getBrushTipSize, renderCanvas, onBrushTipChange, getActualBrushDimensions]);

  // Update rendering when zoom/pan changes
  useEffect(() => {
    scheduleRender();
  }, [scheduleRender]);

  // Keyboard shortcuts for undo/redo in mini canvas
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when mini canvas is focused or mouse is over it
      if (!wrapperRef.current) return;
      
      const isOverMiniCanvas = wrapperRef.current.contains(document.activeElement) ||
                               wrapperRef.current.matches(':hover');
      
      if (!isOverMiniCanvas) return;
      
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'Z' || e.key === 'y')) {
        e.preventDefault();
        handleRedo();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  // Spacebar panning for mini canvas
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle spacebar when mouse is over mini canvas
      if (!wrapperRef.current) return;
      
      const isOverMiniCanvas = wrapperRef.current.matches(':hover');
      if (!isOverMiniCanvas) return;
      
      if (e.code === 'Space' && !spacebarPressed) {
        e.preventDefault();
        setSpacebarPressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setSpacebarPressed(false);
        setIsPanning(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [spacebarPressed]);

  // Emit brush tip changes when hue shift changes with debounce
  useEffect(() => {
    if (onBrushTipChange && originalBrushData) {
      const timer = setTimeout(() => {
        if (hueShift !== 0 || saturation !== 100) {
          // Apply hue shift and saturation to the original brush data
          const adjustedData = adjustHueAndSaturation(originalBrushData, hueShift, saturation);
          const dimensions = getActualBrushDimensions();
          onBrushTipChange(adjustedData, dimensions.width, dimensions.height);
        } else {
          // Reset to original when both hue is 0 and saturation is 100
          const dimensions = getActualBrushDimensions();
          onBrushTipChange(originalBrushData, dimensions.width, dimensions.height);
        }
      }, 16); // ~60fps debounce for more responsive updates
      
      return () => clearTimeout(timer);
    }
  }, [hueShift, saturation, originalBrushData]); // Only depend on stable values


  return (
    <div className={className}>
      {/* Canvas */}
      <div ref={wrapperRef} className="relative overflow-hidden">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className={`block ${
            spacebarPressed 
              ? (isPanning ? 'cursor-grabbing' : 'cursor-grab')
              : (isBrushReadOnly() ? 'cursor-default' : 'cursor-crosshair')
          }`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        
        {/* Offscreen canvas for actual brush data */}
        <canvas
          ref={offscreenCanvasRef}
          className="truly-offscreen-canvas"
        />
      </div>

      {/* Controls below canvas */}
      <div className="flex items-center justify-evenly">
        {/* Swatch Color Toggle - only show for custom brushes */}
        {brushSettings.brushShape === BrushShape.CUSTOM && (
          <>
            <button
              onClick={() => {
                const newValue = !brushSettings.useSwatchColor;
                setBrushSettings({ useSwatchColor: newValue });
              }}
              className={`py-1 px-2 hover:bg-[#3A3A42] rounded text-base flex-1 ${
                brushSettings.useSwatchColor ? 'bg-[#3A3A42]' : 'text-[#D9D9D9]'
              }`}
              title={brushSettings.useSwatchColor ? 'Using swatch color (click to use brush tip colors)' : 'Using brush tip colors (click to use swatch color)'}
            >
              <span 
                style={brushSettings.useSwatchColor ? { color: brushSettings.color } : undefined}
                className={brushSettings.useSwatchColor ? '' : 'text-[#D9D9D9]'}
              >
                {brushSettings.useSwatchColor ? '⬢' : '●'}
              </span>
            </button>
            <div className="w-[2px] self-stretch bg-[#424242]" />
          </>
        )}
        
        {/* Zoom out */}
        <button
          onClick={zoomOut}
          className="py-1 px-2 text-[#D9D9D9] hover:bg-[#3A3A42] rounded flex-1"
          disabled={zoom <= 0.1}
        >
          <Minus size={12} />
        </button>
        
        <div className="w-[2px] self-stretch bg-[#424242]" />
        
        {/* Zoom in */}
        <button
          onClick={zoomIn}
          className="py-1 px-2 text-[#D9D9D9] hover:bg-[#3A3A42] rounded flex-1"
          disabled={zoom >= 16}
        >
          <Plus size={12} />
        </button>
        
        <div className="w-[2px] self-stretch bg-[#424242]" />
        
        {/* Undo */}
        <button
          onClick={handleUndo}
          disabled={undoStack.length === 0 || isBrushReadOnly()}
          className={`py-1 px-2 rounded flex-1 ${
            undoStack.length === 0 || isBrushReadOnly()
              ? 'text-[#666] cursor-not-allowed'
              : 'text-[#D9D9D9] hover:bg-[#3A3A42]'
          }`}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={12} />
        </button>
        
        <div className="w-[2px] self-stretch bg-[#424242]" />
        
        {/* Redo */}
        <button
          onClick={handleRedo}
          disabled={redoStack.length === 0 || isBrushReadOnly()}
          className={`py-1 px-2 rounded flex-1 ${
            redoStack.length === 0 || isBrushReadOnly()
              ? 'text-[#666] cursor-not-allowed'
              : 'text-[#D9D9D9] hover:bg-[#3A3A42]'
          }`}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={12} />
        </button>
      </div>
    </div>
  );
};

export default React.memo(MiniCanvas, (prevProps, nextProps) => {
  return prevProps.width === nextProps.width &&
         prevProps.height === nextProps.height &&
         prevProps.className === nextProps.className &&
         prevProps.hueShift === nextProps.hueShift &&
         prevProps.saturation === nextProps.saturation &&
         prevProps.onBrushTipChange === nextProps.onBrushTipChange;
});