import React, { useCallback, useRef, useEffect, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import Button from './ui/Button';

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
  const [brushPixels, setBrushPixels] = useState<ImageData | null>(null);
  const [originalBrushPixels, setOriginalBrushPixels] = useState<ImageData | null>(null);
  const [basePixelsForShift, setBasePixelsForShift] = useState<ImageData | null>(null); // Pixels to apply shift to
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
  const [modalSize, setModalSize] = useState({ width: 400, height: 500 });

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

  const colorsMatch = (c1: any, c2: any) => {
    return c1.r === c2.r && c1.g === c2.g && c1.b === c2.b && c1.a === c2.a;
  };

  const floodFillCanvas = (imageData: ImageData, x: number, y: number, fillColor: any, targetColor: any) => {
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
    // When slider changes, current drawing becomes the new base
    setBasePixelsForShift(originalBrushPixels);
    setBrushEditorHue(Number(e.target.value));
  }, [setBrushEditorHue, originalBrushPixels]);

  const handleLightnessChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // When slider changes, current drawing becomes the new base
    setBasePixelsForShift(originalBrushPixels);
    setBrushEditorLightness(Number(e.target.value));
  }, [setBrushEditorLightness, originalBrushPixels]);

  const handleSaturationChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // When slider changes, current drawing becomes the new base
    setBasePixelsForShift(originalBrushPixels);
    setBrushEditorSaturation(Number(e.target.value));
  }, [setBrushEditorSaturation, originalBrushPixels]);

  const handleClose = useCallback(() => {
    // Save changes and close the modal - use the modal canvas, not main canvas
    if (canvasRef.current) {
      saveBrushEdit(canvasRef.current);
    }
  }, [saveBrushEdit]);

  const handleCancel = useCallback(() => {
    // Cancel without saving - use the brush editor modal canvas
    if (canvasRef.current) {
      cancelBrushEdit(canvasRef.current);
    }
  }, [cancelBrushEdit]);

  // Drawing handlers for the modal canvas
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    
    // Get the parent container rect (not affected by transform)
    const containerRect = canvasRef.current.parentElement?.parentElement?.getBoundingClientRect();
    if (!containerRect) return;
    
    // Calculate position relative to canvas origin, accounting for pan and zoom
    const x = ((e.clientX - containerRect.left) - pan.x) / zoom;
    const y = ((e.clientY - containerRect.top) - pan.y) / zoom;
    
    // Handle spacebar panning
    if (spacePressed || currentTool === 'pan') {
      setIsPanning(true);
      setLastPanPoint({ x: e.clientX, y: e.clientY });
      return;
    }
    
    const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    // Handle flood fill
    if (currentTool === 'fill') {
      // Create a copy of original pixels to modify
      const imageData = originalBrushPixels ? 
        new ImageData(
          new Uint8ClampedArray(originalBrushPixels.data),
          originalBrushPixels.width,
          originalBrushPixels.height
        ) : ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      const targetColor = getPixelColor(imageData, Math.floor(x), Math.floor(y));
      const fillColor = hexToRgba(brushColor);
      
      if (colorsMatch(targetColor, fillColor)) return;
      
      floodFillCanvas(imageData, Math.floor(x), Math.floor(y), fillColor, targetColor);
      setOriginalBrushPixels(imageData);
      return;
    }
    
    // Regular drawing
    setIsDrawing(true);
    setLastPoint({ x, y });
    
    // Draw on a temporary canvas first to get the raw drawing
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvasRef.current.width;
    tempCanvas.height = canvasRef.current.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;
    
    // Copy original pixels to temp canvas
    if (originalBrushPixels) {
      tempCtx.putImageData(originalBrushPixels, 0, 0);
    }
    
    // Draw with brush size on temp canvas
    tempCtx.fillStyle = brushColor;
    const halfSize = brushSize / 2;
    tempCtx.beginPath();
    tempCtx.arc(x, y, halfSize, 0, Math.PI * 2);
    tempCtx.fill();
    
    // Update original brush pixels
    const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    setOriginalBrushPixels(imageData);
  }, [brushColor, brushSize, currentTool, zoom, pan, spacePressed, originalBrushPixels]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    
    // Handle panning
    if (isPanning && lastPanPoint) {
      const dx = e.clientX - lastPanPoint.x;
      const dy = e.clientY - lastPanPoint.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastPanPoint({ x: e.clientX, y: e.clientY });
      return;
    }
    
    if (!isDrawing || !lastPoint) return;
    
    // Get the parent container rect (not affected by transform)
    const containerRect = canvasRef.current.parentElement?.parentElement?.getBoundingClientRect();
    if (!containerRect) return;
    
    // Calculate position relative to canvas origin, accounting for pan and zoom
    const x = ((e.clientX - containerRect.left) - pan.x) / zoom;
    const y = ((e.clientY - containerRect.top) - pan.y) / zoom;
    
    // Draw on a temporary canvas to maintain original pixels
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvasRef.current.width;
    tempCanvas.height = canvasRef.current.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;
    
    // Copy original pixels to temp canvas
    if (originalBrushPixels) {
      tempCtx.putImageData(originalBrushPixels, 0, 0);
    }
    
    // Draw a line from last point to current point with brush size
    tempCtx.strokeStyle = brushColor;
    tempCtx.lineWidth = brushSize;
    tempCtx.lineCap = 'round';
    tempCtx.beginPath();
    tempCtx.moveTo(lastPoint.x, lastPoint.y);
    tempCtx.lineTo(x, y);
    tempCtx.stroke();
    
    setLastPoint({ x, y });
    
    // Update original brush pixels
    const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    setOriginalBrushPixels(imageData);
  }, [isDrawing, isPanning, lastPoint, lastPanPoint, brushColor, brushSize, zoom, pan, originalBrushPixels]);

  const handlePointerUp = useCallback(() => {
    setIsDrawing(false);
    setLastPoint(null);
    setIsPanning(false);
    setLastPanPoint(null);
  }, []);

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
    
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      // Get container bounds
      const rect = container.getBoundingClientRect();
      
      // Calculate mouse position relative to container
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Calculate the position in canvas space (before zoom)
      const canvasX = (mouseX - pan.x) / zoom;
      const canvasY = (mouseY - pan.y) / zoom;
      
      // Calculate new zoom
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(10, zoom * delta));
      
      // Calculate new pan to keep the mouse position fixed
      const newPanX = mouseX - canvasX * newZoom;
      const newPanY = mouseY - canvasY * newZoom;
      
      // Apply both zoom and pan together
      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    };
    
    // Add listener with passive: false to allow preventDefault
    container.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [brushEditor.status, zoom, pan]);

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
        
        // Set both original and display pixels
        setOriginalBrushPixels(imageData);
        setBasePixelsForShift(imageData);
        setBrushPixels(imageData);
        
        // Draw the brush on top of checkerboard
        ctx.putImageData(imageData, 0, 0);
      } else {
        // Start with empty canvas for new brush
        const emptyData = ctx.getImageData(0, 0, bounds.width, bounds.height);
        setOriginalBrushPixels(emptyData);
        setBasePixelsForShift(emptyData);
        setBrushPixels(emptyData);
      }
    } else {
      // Start with empty canvas for new brush
      const emptyData = ctx.getImageData(0, 0, bounds.width, bounds.height);
      setOriginalBrushPixels(emptyData);
      setBasePixelsForShift(emptyData);
      setBrushPixels(emptyData);
    }
  }, [brushEditor.status, brushEditor.editingBounds, brushEditor.editingBrushId, customBrushes, drawCheckerboard]);

  // Apply adjustments: shift basePixels, keep new drawings in original color
  useEffect(() => {
    if (!originalBrushPixels || !basePixelsForShift) {
      setBrushPixels(originalBrushPixels);
      return;
    }

    // Start with the current drawing state (includes new pixels)
    const imageData = new ImageData(
      new Uint8ClampedArray(originalBrushPixels.data),
      originalBrushPixels.width,
      originalBrushPixels.height
    );
    const data = imageData.data;
    const baseData = basePixelsForShift.data;

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      const baseA = baseData[i + 3];

      // Only apply adjustments to pixels that existed in basePixelsForShift
      if (a > 0 && baseA > 0) {
        // Get RGB values from base (pre-shift state)
        const r = baseData[i];
        const g = baseData[i + 1];
        const b = baseData[i + 2];
        
        // Convert to HSL
        const [h, s, l] = rgbToHsl(r, g, b);

        // Apply adjustments
        const newH = (h + brushEditor.hueShift + 360) % 360;
        const newL = Math.max(0, Math.min(100, l + brushEditor.lightness));
        const newS = Math.max(0, Math.min(100, s * (brushEditor.saturation / 100)));

        // Convert back to RGB
        const [newR, newG, newB] = hslToRgb(newH, newS, newL);

        // Set new values (overwriting what's in originalBrushPixels for these pixels)
        data[i] = newR;
        data[i + 1] = newG;
        data[i + 2] = newB;
      }
      // New pixels (not in basePixelsForShift) keep their original color from originalBrushPixels
    }

    // Set the adjusted pixels for display
    setBrushPixels(imageData);
  }, [originalBrushPixels, basePixelsForShift, brushEditor.hueShift, brushEditor.lightness, brushEditor.saturation]);

  // Draw the adjusted pixels to canvas whenever they change
  useEffect(() => {
    if (!brushPixels || !canvasRef.current) return;
    
    const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    // Clear and draw the adjusted image
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.putImageData(brushPixels, 0, 0);
  }, [brushPixels]);

  if (brushEditor.status !== 'EDITING' || !brushEditor.editingBounds) {
    return null;
  }

  // Modal overlay styles
  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const modalStyle: React.CSSProperties = {
    backgroundColor: 'transparent',
    maxWidth: '90vw',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  };

  const canvasContainerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '200px',
    backgroundColor: 'transparent',
    overflow: 'auto',
  };

  const canvasStyle: React.CSSProperties = {
    imageRendering: 'pixelated', // Keep pixels crisp when scaled
    maxWidth: '100%',
    height: 'auto',
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
    WebkitAppearance: 'none' as any,
    cursor: 'pointer',
  };

  const buttonContainerStyle: React.CSSProperties = {
    display: 'flex',
    gap: '0',
    justifyContent: 'stretch',
    marginTop: '0',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '0',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
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
            padding: '8px',
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none',
            borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
            fontSize: '12px',
            color: '#999',
            textAlign: 'center',
          }}
        >
::::::::::::::::::
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
          }}
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
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                ...canvasStyle,
                cursor: isPanning ? 'grabbing' : currentTool === 'pan' ? 'grab' : 'crosshair'
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
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

        {/* Apply Button */}
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