import React, { useCallback, useRef, useEffect, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape } from '@/types';
import Button from '@/components/ui/Button';
import { brushCache } from '@/utils/brushCache';
import { scaledBrushCache } from '@/utils/scaledBrushCache';
import { useKeyboardScope } from '@/hooks/useKeyboardScope';
import { useBrushEngineSimplified } from '@/hooks/useBrushEngineSimplified';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_IN_FACTOR = 1.1;
const ZOOM_OUT_FACTOR = 0.9;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface BrushEditorUIProps {}

const BrushEditorUI: React.FC<BrushEditorUIProps> = () => {
  const brushEditor = useAppStore((state) => state.brushEditor);
  const customBrushes = useAppStore((state) => state.project?.customBrushes || []);
  const brushColor = useAppStore((state) => state.tools.brushSettings.color);
  const brushSize = useAppStore((state) => state.tools.brushSettings.size);
  const currentTool = useAppStore((state) => state.tools.currentTool);
  const setBrushEditorHue = useAppStore((state) => state.setBrushEditorHue);
  const setBrushEditorLightness = useAppStore((state) => state.setBrushEditorLightness);
  const setBrushEditorSaturation = useAppStore((state) => state.setBrushEditorSaturation);
  const saveBrushEdit = useAppStore((state) => state.saveBrushEdit);
  const cancelBrushEdit = useAppStore((state) => state.cancelBrushEdit);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [basePixels, setBasePixels] = useState<ImageData | null>(null); // Current base pixels (original + drawn) before adjustments
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPoint, setLastPoint] = useState<{x: number, y: number} | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [modalPosition, setModalPosition] = useState({ x: 40, y: 30 }); // Start near center-ish but not exactly
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState<{x: number, y: number} | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [modalSize, setModalSize] = useState({ width: 600, height: 500 });
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null);

  const brushEngine = useBrushEngineSimplified();

  const editingBounds = brushEditor.editingBounds;
  const canvasPixelWidth = editingBounds?.width ?? 0;
  const canvasPixelHeight = editingBounds?.height ?? 0;

  const getCanvasContext = useCallback(() => {
    if (!canvasRef.current) return null;
    if (!canvasContextRef.current) {
      canvasContextRef.current = canvasRef.current.getContext('2d', { willReadFrequently: true });
    }
    return canvasContextRef.current;
  }, [canvasRef]);

  // While editing, suspend global/canvas shortcuts
  useKeyboardScope('modal', brushEditor.status === 'EDITING');

  useEffect(() => {
    if (brushEditor.status === 'EDITING') {
      setSpacePressed(false);
      setIsPanning(false);
      setLastPanPoint(null);
    } else {
      canvasContextRef.current = null;
    }
  }, [brushEditor.status]);

  const getCanvasCoordinates = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }, []);

  // Helper functions for flood fill
  const getPixelColor = (imageData: ImageData, x: number, y: number) => {
    const index = (y * imageData.width + x) * 4;
    return {
      r: imageData.data[index],
      g: imageData.data[index + 1],
      b: imageData.data[index + 2],
      a: imageData.data[index + 3]
    };
  };

  const hexToRgba = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
      a: 255
    } : { r: 0, g: 0, b: 0, a: 255 };
  };

  const colorsMatch = (c1: { r: number; g: number; b: number; a: number }, c2: { r: number; g: number; b: number; a: number }) => {
    return c1.r === c2.r && c1.g === c2.g && c1.b === c2.b && c1.a === c2.a;
  };

  const floodFillCanvas = (imageData: ImageData, x: number, y: number, fillColor: { r: number; g: number; b: number; a: number }, targetColor: { r: number; g: number; b: number; a: number }) => {
    const stack = [[x, y]];
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    
    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      
      if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
      
      const index = (cy * width + cx) * 4;
      
      if (data[index] === targetColor.r && 
          data[index + 1] === targetColor.g && 
          data[index + 2] === targetColor.b && 
          data[index + 3] === targetColor.a) {
        
        data[index] = fillColor.r;
        data[index + 1] = fillColor.g;
        data[index + 2] = fillColor.b;
        data[index + 3] = fillColor.a;
        
        stack.push([cx + 1, cy]);
        stack.push([cx - 1, cy]);
        stack.push([cx, cy + 1]);
        stack.push([cx, cy - 1]);
      }
    }
  };

  // Draw checkerboard pattern for transparency
  const drawCheckerboard = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const checkSize = 4; // Smaller checkerboard
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#e0e0e0';
    
    for (let y = 0; y < height; y += checkSize) {
      for (let x = 0; x < width; x += checkSize) {
        if ((x / checkSize + y / checkSize) % 2 === 0) {
          ctx.fillRect(x, y, checkSize, checkSize);
        }
      }
    }
  }, []);

  const handleHueChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setBrushEditorHue(Number(e.target.value));
  }, [setBrushEditorHue]);

  const handleLightnessChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setBrushEditorLightness(Number(e.target.value));
  }, [setBrushEditorLightness]);

  const handleSaturationChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setBrushEditorSaturation(Number(e.target.value));
  }, [setBrushEditorSaturation]);

  const handleClose = useCallback(() => {
    // Save changes and close the modal - use the modal canvas, not main canvas
    if (canvasRef.current) {
      saveBrushEdit(canvasRef.current);
    }
  }, [saveBrushEdit]);

  const handleCancelEdit = useCallback(() => {
    if (canvasRef.current) {
      cancelBrushEdit(canvasRef.current);
    }
  }, [cancelBrushEdit]);

  const handleCloseButtonMouseDown = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  }, []);



  // Drawing handlers for the modal canvas
  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;

    const shouldPan = spacePressed || event.button === 1 || event.button === 2;

    if (shouldPan) {
      event.preventDefault();
      setIsPanning(true);
      setLastPanPoint({ x: event.clientX, y: event.clientY });
      try {
        canvasRef.current.setPointerCapture?.(event.pointerId);
      } catch {}
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const coordinates = getCanvasCoordinates(event.clientX, event.clientY);
    if (!coordinates) return;
    const { x, y } = coordinates;

    const ctx = getCanvasContext();
    if (!ctx) return;

    try {
      canvasRef.current.setPointerCapture?.(event.pointerId);
    } catch {}

    const pointerPressure = event.pressure && event.pressure > 0 ? event.pressure : 1;

    if (currentTool === 'fill') {
      const currentImageData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
      const targetColor = getPixelColor(currentImageData, Math.floor(x), Math.floor(y));
      const fillColor = hexToRgba(brushColor);

      if (colorsMatch(targetColor, fillColor)) return;

      floodFillCanvas(currentImageData, Math.floor(x), Math.floor(y), fillColor, targetColor);
      ctx.putImageData(currentImageData, 0, 0);
      return;
    }

    setIsDrawing(true);
    setLastPoint({ x, y });

    if (currentTool === 'eraser') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      const halfSize = brushSize / 2;
      ctx.beginPath();
      ctx.arc(x, y, halfSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    brushEngine.resetStroke();
    brushEngine.drawBrush(ctx, { x, y }, { x, y }, { pressure: pointerPressure });
  }, [brushColor, brushSize, brushEngine, currentTool, getCanvasContext, getCanvasCoordinates, spacePressed]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;

    if (isPanning && lastPanPoint) {
      event.preventDefault();
      const dx = event.clientX - lastPanPoint.x;
      const dy = event.clientY - lastPanPoint.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastPanPoint({ x: event.clientX, y: event.clientY });
      return;
    }

    if (!isDrawing || !lastPoint) return;

    const coordinates = getCanvasCoordinates(event.clientX, event.clientY);
    if (!coordinates) return;
    const { x, y } = coordinates;

    const ctx = getCanvasContext();
    if (!ctx) return;

    if (currentTool === 'eraser') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(lastPoint.x, lastPoint.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
    } else {
      const pointerPressure = event.pressure && event.pressure > 0 ? event.pressure : 1;
      brushEngine.drawBrush(ctx, lastPoint, { x, y }, { pressure: pointerPressure });
    }

    setLastPoint({ x, y });
  }, [brushEngine, brushSize, currentTool, getCanvasContext, getCanvasCoordinates, isDrawing, isPanning, lastPoint, lastPanPoint]);

  const handlePointerUp = useCallback((event?: React.PointerEvent<HTMLCanvasElement>) => {
    if (event && canvasRef.current) {
      if (isPanning) {
        event.preventDefault();
      }
      try {
        canvasRef.current.releasePointerCapture?.(event.pointerId);
      } catch {}
    }

    if (isDrawing && canvasRef.current) {
      const ctx = getCanvasContext();
      if (ctx) {
        if (currentTool !== 'eraser' && currentTool !== 'fill') {
          brushEngine.finalizeStroke(ctx);
          brushEngine.resetStroke();
        }

        const currentCanvas = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
        setBasePixels(currentCanvas);
        setBrushEditorHue(0);
        setBrushEditorLightness(0);
        setBrushEditorSaturation(100);
      }
    }

    setIsDrawing(false);
    setLastPoint(null);
    setIsPanning(false);
    setLastPanPoint(null);
  }, [brushEngine, currentTool, getCanvasContext, isDrawing, isPanning, setBrushEditorHue, setBrushEditorLightness, setBrushEditorSaturation]);

  const handleContainerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target === canvasRef.current) return;

    const shouldPan = spacePressed || event.button === 1 || event.button === 2;

    if (!shouldPan) return;

    event.preventDefault();
    setIsPanning(true);
    setLastPanPoint({ x: event.clientX, y: event.clientY });
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {}
  }, [spacePressed]);

  const handleContainerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanning || !lastPanPoint) return;
    event.preventDefault();
    const dx = event.clientX - lastPanPoint.x;
    const dy = event.clientY - lastPanPoint.y;
    setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    setLastPanPoint({ x: event.clientX, y: event.clientY });
  }, [isPanning, lastPanPoint]);

  const handleContainerPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {}
    setIsPanning(false);
    setLastPanPoint(null);
  }, []);

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (spacePressed || isPanning) {
      event.preventDefault();
    }
  }, [isPanning, spacePressed]);

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    const modalElement = e.currentTarget.parentElement as HTMLElement;
    const rect = modalElement.getBoundingClientRect();
    // Calculate offset from click position to modal's top-left corner
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
    setIsDragging(true);
    e.preventDefault();
  }, []);

  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    // Calculate new position maintaining the offset
    const newLeft = e.clientX - dragOffset.x;
    const newTop = e.clientY - dragOffset.y;
    
    // Convert to percentage for responsive positioning
    const x = (newLeft / window.innerWidth) * 100;
    const y = (newTop / window.innerHeight) * 100;
    
    setModalPosition({ x, y });
  }, [isDragging, dragOffset]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
  }, []);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    
    // Calculate new size based on mouse position
    // Since resize handle is in bottom-right, width increases as mouse moves right
    const modalElement = document.querySelector('.brush-editor-modal') as HTMLElement;
    if (!modalElement) return;
    
    const rect = modalElement.getBoundingClientRect();
    const newWidth = Math.max(300, e.clientX - rect.left);
    const newHeight = Math.max(400, e.clientY - rect.top);
    
    setModalSize({ width: newWidth, height: newHeight });
  }, [isResizing]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
      return () => {
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  // Handle wheel zoom with non-passive listener (zoom to cursor)
  useEffect(() => {
    if (brushEditor.status !== 'EDITING') return;

    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      const canvasElement = canvasRef.current;
      if (!canvasElement) return;

      const canvasWidth = canvasElement.width;
      const canvasHeight = canvasElement.height;
      if (canvasWidth === 0 || canvasHeight === 0) return;

      event.preventDefault();

      const containerRect = container.getBoundingClientRect();
      const mouseX = event.clientX - containerRect.left;
      const mouseY = event.clientY - containerRect.top;

      setZoom((previousZoom) => {
        const zoomFactor = event.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR;
        const unclamped = previousZoom * zoomFactor;
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, unclamped));

        if (nextZoom === previousZoom) {
          return previousZoom;
        }

        setPan((previousPan) => {
          const worldX = (mouseX - previousPan.x) / previousZoom;
          const worldY = (mouseY - previousPan.y) / previousZoom;

          return {
            x: mouseX - worldX * nextZoom,
            y: mouseY - worldY * nextZoom,
          };
        });

        return nextZoom;
      });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [brushEditor.status]);

  useEffect(() => {
    if (brushEditor.status !== 'EDITING') return;

    setZoom(1);

    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      const canvasElement = canvasRef.current;

      if (!container || !canvasElement) {
        setPan({ x: 0, y: 0 });
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const canvasWidth = canvasElement.width;
      const canvasHeight = canvasElement.height;

      const centeredPan = {
        x: (containerRect.width - canvasWidth) / 2,
        y: (containerRect.height - canvasHeight) / 2,
      };

      setPan(centeredPan);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    brushEditor.status,
    brushEditor.editingBrushId,
    brushEditor.editingBounds?.width,
    brushEditor.editingBounds?.height,
  ]);

  // Keyboard handlers for spacebar panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spacePressed) {
        e.preventDefault();
        setSpacePressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setSpacePressed(false);
        setIsPanning(false);
        setLastPanPoint(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [spacePressed]);

  // Initialize modal canvas once when editing begins
  useEffect(() => {
    if (brushEditor.status !== 'EDITING' || !brushEditor.editingBounds || !canvasRef.current) {
      return;
    }

    const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    canvasContextRef.current = ctx;

    const bounds = brushEditor.editingBounds;

    // Set canvas size
    canvasRef.current.width = bounds.width;
    canvasRef.current.height = bounds.height;
    
    // Clear canvas to transparent
    ctx.clearRect(0, 0, bounds.width, bounds.height);
    
    // Initialize with existing brush data if editing an existing brush
    if (brushEditor.editingBrushId && customBrushes.length > 0) {
      const existingBrush = customBrushes.find(b => b.id === brushEditor.editingBrushId);
      if (existingBrush && existingBrush.imageData) {
        // Use the stored brush data directly (it's already ImageData)
        const imageData = existingBrush.imageData;
        
        // Store base pixels
        setBasePixels(imageData);
        
        // Draw the brush on canvas
        ctx.putImageData(imageData, 0, 0);
      } else {
        // Start with empty canvas for new brush
        const emptyData = ctx.getImageData(0, 0, bounds.width, bounds.height);
        setBasePixels(emptyData);
      }
    } else {
      // Start with empty canvas for new brush
      const emptyData = ctx.getImageData(0, 0, bounds.width, bounds.height);
      setBasePixels(emptyData);
    }
  }, [brushEditor.status, brushEditor.editingBounds, brushEditor.editingBrushId, customBrushes, drawCheckerboard]);

  // Apply adjustments to base pixels
  useEffect(() => {
    if (!basePixels || !canvasRef.current || isDrawing) {
      return;
    }

    const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Apply color adjustments to ALL base pixels
    const adjustedPixels = new ImageData(
      new Uint8ClampedArray(basePixels.data),
      basePixels.width,
      basePixels.height
    );
    const data = adjustedPixels.data;

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a > 0) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // Convert to HSL
        const [h, s, l] = rgbToHsl(r, g, b);

        // Apply adjustments
        const newH = (h + brushEditor.hueShift + 360) % 360;
        const newL = Math.max(0, Math.min(100, l + brushEditor.lightness));
        const newS = Math.max(0, Math.min(100, s * (brushEditor.saturation / 100)));

        // Convert back to RGB
        const [newR, newG, newB] = hslToRgb(newH, newS, newL);

        data[i] = newR;
        data[i + 1] = newG;
        data[i + 2] = newB;
      }
    }

    // Draw the adjusted pixels
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.putImageData(adjustedPixels, 0, 0);
    
    // Update the brush if it's currently selected
    const currentBrushSettings = useAppStore.getState().tools.brushSettings;
    if (brushEditor.editingBrushId && 
        currentBrushSettings.brushShape === BrushShape.CUSTOM &&
        currentBrushSettings.selectedCustomBrush === brushEditor.editingBrushId) {
      // Clear caches and update the current brush tip
      brushCache.clear();
      scaledBrushCache.clear();
      
      useAppStore.getState().updateCurrentBrushTip({
        imageData: adjustedPixels,
        brushId: brushEditor.editingBrushId,
        isColorizable: false,
        width: adjustedPixels.width,
        height: adjustedPixels.height
      });
    }
  }, [basePixels, brushEditor.hueShift, brushEditor.lightness, brushEditor.saturation, brushEditor.editingBrushId, isDrawing]);

  // This effect is now handled by the color adjustment effect above
  // Removed to prevent conflicts

  if (brushEditor.status !== 'EDITING' || !brushEditor.editingBounds) {
    return null;
  }

  // Modal overlay styles

  const canvasContainerStyle: React.CSSProperties = {
    position: 'relative',
    display: 'block',
    minHeight: '200px',
    backgroundColor: 'transparent',
    overflow: 'hidden',
  };

  const canvasStyle: React.CSSProperties = {
    imageRendering: 'pixelated', // Keep pixels crisp when scaled
    width: canvasPixelWidth ? `${canvasPixelWidth}px` : 'auto',
    height: canvasPixelHeight ? `${canvasPixelHeight}px` : 'auto',
    display: 'block',
    touchAction: 'none',
  };

  const controlsStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
  };

  const sliderContainerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
  };

  const sliderStyle: React.CSSProperties = {
    width: '100%',
    height: '20px',
    borderRadius: '0',
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none' as const,
    cursor: 'pointer',
  };

  const buttonContainerStyle: React.CSSProperties = {
    display: 'flex',
    gap: '0',
    justifyContent: 'stretch',
    marginTop: '0',
  };


  // Create gradient backgrounds
  const hueGradient = 'linear-gradient(to right, ' +
    'hsl(0, 100%, 50%), ' +
    'hsl(60, 100%, 50%), ' +
    'hsl(120, 100%, 50%), ' +
    'hsl(180, 100%, 50%), ' +
    'hsl(240, 100%, 50%), ' +
    'hsl(300, 100%, 50%), ' +
    'hsl(360, 100%, 50%))';

  const lightnessGradient = 'linear-gradient(to right, ' +
    'hsl(0, 0%, 0%), ' +
    'hsl(0, 0%, 50%), ' +
    'hsl(0, 0%, 100%))';

  const saturationGradient = 'linear-gradient(to right, ' +
    'hsl(0, 0%, 50%), ' +      // Gray (no saturation)
    'hsl(0, 50%, 50%), ' +     // Medium saturation
    'hsl(0, 100%, 50%))';      // Full saturation

  return (
    <>
      <style>{`
        .brush-editor-slider::-webkit-slider-thumb {
          appearance: none;
          width: 20px;
          height: 20px;
          background: white;
          border: none;
          border-radius: 0;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        
        .brush-editor-slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          background: white;
          border: none;
          border-radius: 0;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        .brush-editor-slider::-webkit-slider-thumb:hover {
          transform: scale(1.1);
        }

        .brush-editor-slider::-moz-range-thumb:hover {
          transform: scale(1.1);
        }
      `}</style>
      
      {/* Brush Editor Panel - Draggable and Resizable */}
      <div 
        className="brush-editor-modal"
        style={{
        position: 'fixed',
        left: `${modalPosition.x}%`,
        top: `${modalPosition.y}%`,
        transform: 'none', // Remove centering transform
        width: `${modalSize.width}px`,
        height: `${modalSize.height}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: '0',
        zIndex: 100,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        borderRadius: '0',
        overflow: 'hidden',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      }}>
        {/* Drag Handle */}
        <div
          onMouseDown={handleDragStart}
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            padding: '8px 12px',
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none',
            borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
            fontSize: '12px',
            color: '#d9d9d9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <span style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>Brush Editor</span>
          <button
            type="button"
            onMouseDown={handleCloseButtonMouseDown}
            onClick={handleCancelEdit}
            aria-label="Close brush editor"
            title="Close without saving"
            style={{
              background: 'transparent',
              color: '#f0f0f0',
              border: 'none',
              fontSize: '16px',
              lineHeight: 1,
              cursor: 'pointer',
              padding: '4px 6px',
            }}
          >
            ×
          </button>
        </div>
        {/* Canvas Preview */}
        <div 
          ref={containerRef}
          style={{
            ...canvasContainerStyle,
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: '#404040', // Match main canvas dark grey
            flex: 1, // Take remaining space after header and controls
            touchAction: 'none',
          }}
          onPointerDown={handleContainerPointerDown}
          onPointerMove={handleContainerPointerMove}
          onPointerUp={handleContainerPointerUp}
          onPointerLeave={handleContainerPointerUp}
          onPointerCancel={handleContainerPointerUp}
          onContextMenu={handleContextMenu}
        >
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              // Checkerboard pattern that scales with zoom
              backgroundImage: `
                linear-gradient(45deg, #606060 25%, transparent 25%),
                linear-gradient(-45deg, #606060 25%, transparent 25%),
                linear-gradient(45deg, transparent 75%, #606060 75%),
                linear-gradient(-45deg, transparent 75%, #606060 75%)
              `,
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
              width: canvasPixelWidth ? `${canvasPixelWidth}px` : 'auto',
              height: canvasPixelHeight ? `${canvasPixelHeight}px` : 'auto',
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                ...canvasStyle,
                cursor: isPanning ? 'grabbing' : spacePressed ? 'grab' : 'crosshair'
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onContextMenu={handleContextMenu}
            />
          </div>
        </div>

        {/* Controls */}
        <div style={controlsStyle}>
          {/* Hue Slider */}
          <div style={sliderContainerStyle}>
            <input
              className="brush-editor-slider"
              type="range"
              min="-180"
              max="180"
              value={brushEditor.hueShift}
              onChange={handleHueChange}
              style={{
                ...sliderStyle,
                background: hueGradient,
              }}
            />
          </div>

          {/* Lightness Slider */}
          <div style={sliderContainerStyle}>
            <input
              className="brush-editor-slider"
              type="range"
              min="-100"
              max="100"
              value={brushEditor.lightness}
              onChange={handleLightnessChange}
              style={{
                ...sliderStyle,
                background: lightnessGradient,
              }}
            />
          </div>

          {/* Saturation Slider */}
          <div style={sliderContainerStyle}>
            <input
              className="brush-editor-slider"
              type="range"
              min="0"
              max="200"
              value={brushEditor.saturation}
              onChange={handleSaturationChange}
              style={{
                ...sliderStyle,
                background: saturationGradient,
              }}
            />
          </div>
        </div>

        {/* Save Button */}
        <div style={buttonContainerStyle}>
          <Button
            onClick={handleClose}
            variant="primary"
            size="md"
            fullWidth
          >
            Save
          </Button>
        </div>
        
        {/* Resize Handle - Bottom Right Corner */}
        <div
          onMouseDown={handleResizeStart}
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: '20px',
            height: '20px',
            cursor: isResizing ? 'grabbing' : 'nwse-resize',
            backgroundColor: 'transparent',
            borderRight: '3px solid rgba(255, 255, 255, 0.3)',
            borderBottom: '3px solid rgba(255, 255, 255, 0.3)',
            transition: 'border-color 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.6)';
          }}
          onMouseLeave={(e) => {
            if (!isResizing) {
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
            }
          }}
        />
      </div>
    </>
  );
};

// Helper functions for color conversion
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  s /= 100;
  l /= 100;

  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export default BrushEditorUI;
