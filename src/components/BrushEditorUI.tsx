import React, { useCallback, useRef, useEffect, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';

interface BrushEditorUIProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const BrushEditorUI: React.FC<BrushEditorUIProps> = ({ canvasRef: mainCanvasRef }) => {
  const brushEditor = useAppStore((state) => state.brushEditor);
  const customBrushes = useAppStore((state) => state.project?.customBrushes || []);
  const brushColor = useAppStore((state) => state.tools.brushSettings.color);
  const brushSize = useAppStore((state) => state.tools.brushSettings.size);
  const currentTool = useAppStore((state) => state.tools.currentTool);
  const setBrushEditorHue = useAppStore((state) => state.setBrushEditorHue);
  const setBrushEditorLightness = useAppStore((state) => state.setBrushEditorLightness);
  const saveBrushEdit = useAppStore((state) => state.saveBrushEdit);
  const cancelBrushEdit = useAppStore((state) => state.cancelBrushEdit);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [brushPixels, setBrushPixels] = useState<ImageData | null>(null);
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
    setBrushEditorHue(Number(e.target.value));
  }, [setBrushEditorHue]);

  const handleLightnessChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setBrushEditorLightness(Number(e.target.value));
  }, [setBrushEditorLightness]);

  const handleClose = useCallback(() => {
    // Save changes and close the modal - use the modal canvas, not main canvas
    if (canvasRef.current) {
      saveBrushEdit(canvasRef.current);
    }
  }, [saveBrushEdit]);

  const handleCancel = useCallback(() => {
    // Cancel without saving - still need main canvas for restoring state
    if (mainCanvasRef.current) {
      cancelBrushEdit(mainCanvasRef.current);
    }
  }, [cancelBrushEdit, mainCanvasRef]);

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
      // Simple flood fill implementation
      const imageData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
      const targetColor = getPixelColor(imageData, Math.floor(x), Math.floor(y));
      const fillColor = hexToRgba(brushColor);
      
      if (colorsMatch(targetColor, fillColor)) return;
      
      floodFillCanvas(imageData, Math.floor(x), Math.floor(y), fillColor, targetColor);
      ctx.putImageData(imageData, 0, 0);
      setBrushPixels(imageData);
      return;
    }
    
    // Regular drawing
    setIsDrawing(true);
    setLastPoint({ x, y });
    
    // Draw with brush size
    ctx.fillStyle = brushColor;
    const halfSize = brushSize / 2;
    ctx.beginPath();
    ctx.arc(x, y, halfSize, 0, Math.PI * 2);
    ctx.fill();
    
    // Update brush pixels
    const imageData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    setBrushPixels(imageData);
  }, [brushColor, brushSize, currentTool, zoom, pan, spacePressed]);

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
    
    const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      // Draw a line from last point to current point with brush size
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(lastPoint.x, lastPoint.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      
      setLastPoint({ x, y });
      
      // Update brush pixels
      const imageData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
      setBrushPixels(imageData);
    }
  }, [isDrawing, isPanning, lastPoint, lastPanPoint, brushColor, brushSize, zoom, pan]);

  const handlePointerUp = useCallback(() => {
    setIsDrawing(false);
    setLastPoint(null);
    setIsPanning(false);
    setLastPanPoint(null);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.max(0.1, Math.min(10, prev * delta)));
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
        
        // Set the brush pixels for adjustments
        setBrushPixels(imageData);
        
        // Draw the brush on top of checkerboard
        ctx.putImageData(imageData, 0, 0);
      } else {
        // Start with empty canvas for new brush
        setBrushPixels(ctx.getImageData(0, 0, bounds.width, bounds.height));
      }
    } else {
      // Start with empty canvas for new brush
      setBrushPixels(ctx.getImageData(0, 0, bounds.width, bounds.height));
    }
  }, [brushEditor.status, brushEditor.editingBounds, brushEditor.editingBrushId, customBrushes, drawCheckerboard]);

  useEffect(() => {
    if (!brushPixels || !canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Apply hue and lightness adjustments to the pixels
    const imageData = ctx.createImageData(brushPixels);
    const data = imageData.data;
    const originalData = brushPixels.data;

    for (let i = 0; i < data.length; i += 4) {
      // Get original RGB values
      const r = originalData[i];
      const g = originalData[i + 1];
      const b = originalData[i + 2];
      const a = originalData[i + 3];

      // Only adjust colors if pixel has opacity
      if (a > 0) {
        // Convert to HSL
        const [h, s, l] = rgbToHsl(r, g, b);

        // Apply adjustments
        const newH = (h + brushEditor.hueShift + 360) % 360;
        const newL = Math.max(0, Math.min(100, l + brushEditor.lightness));

        // Convert back to RGB
        const [newR, newG, newB] = hslToRgb(newH, s, newL);

        // Set new values
        data[i] = newR;
        data[i + 1] = newG;
        data[i + 2] = newB;
      } else {
        // Keep transparent pixels transparent
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
      data[i + 3] = a; // Always preserve alpha
    }

    // Clear and draw the adjusted image
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.putImageData(imageData, 0, 0);
  }, [brushPixels, brushEditor.hueShift, brushEditor.lightness]);

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
    borderRadius: '4px',
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none' as any,
    cursor: 'pointer',
  };

  const buttonContainerStyle: React.CSSProperties = {
    display: 'flex',
    gap: '10px',
    justifyContent: 'flex-end',
    marginTop: '10px',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '4px',
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

  return (
    <>
      <style>{`
        .brush-editor-slider::-webkit-slider-thumb {
          appearance: none;
          width: 20px;
          height: 20px;
          background: white;
          border: 2px solid #333;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        
        .brush-editor-slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          background: white;
          border: 2px solid #333;
          border-radius: 50%;
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
      
      {/* Brush Editor Panel - Draggable */}
      <div style={{
        position: 'fixed',
        left: `${modalPosition.x}%`,
        top: `${modalPosition.y}%`,
        transform: 'none', // Remove centering transform
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        zIndex: 100,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        borderRadius: '8px',
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
        <div style={{ padding: '15px', paddingTop: '0' }}>
        {/* Canvas Preview */}
        <div 
          style={{
            ...canvasContainerStyle,
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: '#404040', // Match main canvas dark grey
          }}
          onWheel={handleWheel}
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
        </div>

        {/* Apply Button */}
        <div style={buttonContainerStyle}>
          <button
            onClick={handleClose}
            style={{
              ...buttonStyle,
              backgroundColor: '#00ff00',
              color: 'white',
            }}
          >
            Save
          </button>
        </div>
        </div>
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