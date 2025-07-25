'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useBrushEngine } from '../../hooks/useBrushEngine';
import { Pin, PinOff, RotateCcw, Minus, Plus, Undo2, Redo2 } from 'lucide-react';
import { BrushShape } from '../../types';
import { adjustHueAndSaturation } from '../../utils/imageProcessing';

interface MiniCanvasProps {
  width?: number;
  height?: number;
  className?: string;
  hueShift?: number;
  saturation?: number;
  onBrushTipChange?: (imageData: ImageData) => void;
}

export default function MiniCanvas({ 
  width = 128, 
  height = 128, 
  className = '', 
  hueShift = 0, 
  saturation = 100,
  onBrushTipChange
}: MiniCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Local state
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPoint, setLastPoint] = useState<{ x: number; y: number } | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [originalBrushData, setOriginalBrushData] = useState<ImageData | null>(null);
  const [pinnedBrushTip, setPinnedBrushTip] = useState<ImageData | null>(null);
  
  // Panning state
  const [spacebarPressed, setSpacebarPressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [mouseStart, setMouseStart] = useState({ x: 0, y: 0 });
  
  // Mini canvas undo/redo state
  const [undoStack, setUndoStack] = useState<ImageData[]>([]);
  const [redoStack, setRedoStack] = useState<ImageData[]>([]);

  // App state
  const { tools, project, temporaryCustomBrush, saveCanvasState, brushPresets, setBrushSettings } = useAppStore();
  const { brushSettings } = tools;
  
  // Get brush engine for drawing
  const { renderBrushStroke } = useBrushEngine();

  // Helper function to check if current brush is a default brush
  const isDefaultBrush = useCallback(() => {
    // Non-custom brushes are always default
    if (brushSettings.brushShape !== BrushShape.CUSTOM) {
      return true;
    }
    
    // Check if the selected custom brush is actually a default brush preset
    if (brushSettings.selectedCustomBrush) {
      const preset = brushPresets.find(p => p.id === brushSettings.selectedCustomBrush);
      return preset?.isDefault === true;
    }
    
    return false;
  }, [brushSettings.brushShape, brushSettings.selectedCustomBrush, brushPresets]);

  // Initialize canvases
  useEffect(() => {
    const canvas = canvasRef.current;
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!canvas || !offscreenCanvas) return;

    // Set up display canvas
    canvas.width = width;
    canvas.height = height;
    
    // Set up offscreen canvas (actual brush size)
    const brushSize = getBrushTipSize();
    offscreenCanvas.width = brushSize;
    offscreenCanvas.height = brushSize;

    // Only update brush tip if not pinned
    if (!isPinned) {
      initializeBrushTip();
    }
    
    renderCanvas();
  }, [width, height, brushSettings.brushShape, brushSettings.selectedCustomBrush, brushSettings.currentBrushTip, isPinned, temporaryCustomBrush, brushPresets]);

  // Get the size of the brush tip to display
  const getBrushTipSize = useCallback(() => {
    if (brushSettings.brushShape === BrushShape.CUSTOM && brushSettings.selectedCustomBrush) {
      let customBrush = temporaryCustomBrush && temporaryCustomBrush.id === brushSettings.selectedCustomBrush
        ? temporaryCustomBrush
        : project?.customBrushes.find(b => b.id === brushSettings.selectedCustomBrush);
      
      // If not found in temporary or project brushes, check brush presets
      if (!customBrush) {
        const preset = brushPresets.find(p => p.isCustomBrush && p.customBrushData && 
          p.id === brushSettings.selectedCustomBrush);
        
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
        return Math.max(customBrush.width, customBrush.height);
      }
    }
    // For standard brushes, use a fixed size for editing
    return 64;
  }, [brushSettings.brushShape, brushSettings.selectedCustomBrush, temporaryCustomBrush, project?.customBrushes, brushPresets]);

  // Initialize the brush tip data
  const initializeBrushTip = () => {
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return;

    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const size = getBrushTipSize();
    
    // Create current brush ID
    const currentBrushId = brushSettings.brushShape === BrushShape.CUSTOM && brushSettings.selectedCustomBrush 
      ? brushSettings.selectedCustomBrush // Use raw format (matches BrushControls)
      : `standard_${brushSettings.brushShape}`;
    
    // Check if we have a currentBrushTip for THIS specific brush
    if (brushSettings.currentBrushTip && brushSettings.currentBrushTip.brushId === currentBrushId) {
      // Use the edited brush tip for this brush
      ctx.clearRect(0, 0, size, size);
      ctx.putImageData(brushSettings.currentBrushTip.imageData, 0, 0);
      // Don't update originalBrushData here, keep the original for reset
      return;
    }
    
    if (brushSettings.brushShape === BrushShape.CUSTOM && brushSettings.selectedCustomBrush) {
      // Load custom brush - check temporary brush first, then project brushes, then brush presets
      let customBrush = temporaryCustomBrush && temporaryCustomBrush.id === brushSettings.selectedCustomBrush
        ? temporaryCustomBrush
        : project?.customBrushes.find(b => b.id === brushSettings.selectedCustomBrush);
      
      // If not found in temporary or project brushes, check brush presets
      if (!customBrush) {
        const preset = brushPresets.find(p => p.isCustomBrush && p.customBrushData && 
          p.id === brushSettings.selectedCustomBrush);
        
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
        ctx.clearRect(0, 0, size, size);
        
        // Center the custom brush data in the canvas
        const offsetX = Math.floor((size - customBrush.width) / 2);
        const offsetY = Math.floor((size - customBrush.height) / 2);
        
        
        try {
          ctx.putImageData(customBrush.imageData, offsetX, offsetY);
        } catch (error) {
        }
        
        // Store original data for reset
        const brushData = ctx.getImageData(0, 0, size, size);
        setOriginalBrushData(brushData);
        
        // Notify parent that brush tip has changed
        if (onBrushTipChange) {
          onBrushTipChange(brushData);
        }
        
        // Force a render update to display the custom brush
        renderCanvas();
      }
    } else {
      // Create preview for standard brushes
      ctx.fillStyle = '#000000';
      ctx.clearRect(0, 0, size, size);
      
      const center = size / 2;
      const radius = Math.min(16, size / 4);
      
      switch (brushSettings.brushShape) {
        case BrushShape.ROUND:
          ctx.beginPath();
          ctx.arc(center, center, radius, 0, 2 * Math.PI);
          ctx.fill();
          break;
        case BrushShape.SQUARE:
          ctx.fillRect(center - radius, center - radius, radius * 2, radius * 2);
          break;
        default: // PIXEL
          ctx.fillRect(center - 1, center - 1, 2, 2);
          break;
      }
      
      // Store original data for reset only if we don't already have it
      if (!originalBrushData) {
        setOriginalBrushData(ctx.getImageData(0, 0, size, size));
      }
    }
  };

  // Render the canvas with zoom and pan
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!canvas || !offscreenCanvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !offscreenCtx) return;

    // Clear display canvas
    ctx.clearRect(0, 0, width, height);

    // Draw checkerboard background for transparency
    drawCheckerboard(ctx, width, height);

    // Calculate display parameters
    const sourceSize = getBrushTipSize();
    const displaySize = sourceSize * zoom;
    const x = (width - displaySize) / 2 + pan.x;
    const y = (height - displaySize) / 2 + pan.y;

    // Disable image smoothing for pixel-perfect display
    ctx.imageSmoothingEnabled = false;
    
    // Apply hue shift and saturation if needed and draw the brush tip
    if ((hueShift !== 0 || saturation !== 100) && originalBrushData) {
      // Apply hue shift and saturation to the original brush data for accurate preview
      const adjustedData = adjustHueAndSaturation(originalBrushData, hueShift, saturation);
      
      // Create a temporary canvas to draw the adjusted data
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = sourceSize;
      tempCanvas.height = sourceSize;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      if (tempCtx) {
        tempCtx.putImageData(adjustedData, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0, sourceSize, sourceSize, x, y, displaySize, displaySize);
      }
    } else {
      ctx.drawImage(offscreenCanvas, 0, 0, sourceSize, sourceSize, x, y, displaySize, displaySize);
    }

    // Draw border
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, displaySize, displaySize);
  }, [width, height, zoom, pan.x, pan.y, hueShift, saturation, originalBrushData]);

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
    const sourceSize = getBrushTipSize();
    const displaySize = sourceSize * zoom;
    const offsetX = (width - displaySize) / 2 + pan.x;
    const offsetY = (height - displaySize) / 2 + pan.y;

    const canvasX = ((x - offsetX) / displaySize) * sourceSize;
    const canvasY = ((y - offsetY) / displaySize) * sourceSize;

    return { 
      x: Math.max(0, Math.min(sourceSize - 1, Math.floor(canvasX))), 
      y: Math.max(0, Math.min(sourceSize - 1, Math.floor(canvasY)))
    };
  };

  // Handle drawing on the mini canvas
  const drawOnCanvas = (x: number, y: number, isStart: boolean = false) => {
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return;

    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Use the current brush settings but smaller size for mini canvas
    const brushSize = Math.max(1, Math.floor(brushSettings.size / 4));
    
    // Always use black for default brushes to keep them colorizable
    const isDefaultBrush = brushSettings.brushShape !== BrushShape.CUSTOM;
    const drawColor = isDefaultBrush ? '#000000' : brushSettings.color;
    
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
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(() => {
      renderCanvas();
      
      // Emit the updated brush tip
      if (onBrushTipChange) {
        const size = getBrushTipSize();
        const updatedImageData = ctx.getImageData(0, 0, size, size);
        onBrushTipChange(updatedImageData);
      }
    });
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
    
    // Don't allow drawing on default brushes
    if (isDefaultBrush()) return;
    
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
  const zoomIn = () => setZoom(Math.min(16, zoom + 1));
  const zoomOut = () => setZoom(Math.max(1, zoom - 1));

  // Reset brush tip
  const resetBrushTip = () => {
    if (!originalBrushData) return;
    
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return;
    
    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    ctx.putImageData(originalBrushData, 0, 0);
    renderCanvas();
    
    // Clear the currentBrushTip to go back to default brush behavior
    const { setBrushSettings } = useAppStore.getState();
    setBrushSettings({ currentBrushTip: undefined });
    
    // Clear undo/redo stacks
    setUndoStack([]);
    setRedoStack([]);
  };

  // Toggle pin state
  const togglePin = () => {
    if (!isPinned) {
      // Save current brush tip when pinning
      const offscreenCanvas = offscreenCanvasRef.current;
      if (offscreenCanvas) {
        const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          const size = getBrushTipSize();
          setPinnedBrushTip(ctx.getImageData(0, 0, size, size));
        }
      }
    } else {
      // Clear pinned brush tip when unpinning
      setPinnedBrushTip(null);
    }
    setIsPinned(!isPinned);
  };

  // Save current state to undo stack
  const saveToUndoStack = useCallback(() => {
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return;
    
    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    const size = getBrushTipSize();
    const currentData = ctx.getImageData(0, 0, size, size);
    
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
    
    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    // Save current state to redo stack
    const size = getBrushTipSize();
    const currentData = ctx.getImageData(0, 0, size, size);
    setRedoStack(prev => [...prev, currentData]);
    
    // Restore previous state
    const previousState = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    
    ctx.putImageData(previousState, 0, 0);
    renderCanvas();
    
    // Emit the restored brush tip
    if (onBrushTipChange) {
      onBrushTipChange(previousState);
    }
  }, [undoStack, getBrushTipSize, renderCanvas, onBrushTipChange]);

  // Redo last undone action
  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    
    const offscreenCanvas = offscreenCanvasRef.current;
    if (!offscreenCanvas) return;
    
    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    // Save current state to undo stack
    const size = getBrushTipSize();
    const currentData = ctx.getImageData(0, 0, size, size);
    setUndoStack(prev => [...prev, currentData]);
    
    // Restore next state
    const nextState = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    
    ctx.putImageData(nextState, 0, 0);
    renderCanvas();
    
    // Emit the restored brush tip
    if (onBrushTipChange) {
      onBrushTipChange(nextState);
    }
  }, [redoStack, getBrushTipSize, renderCanvas, onBrushTipChange]);

  // Update rendering when zoom/pan changes
  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

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
          onBrushTipChange(adjustedData);
        } else {
          // Reset to original when both hue is 0 and saturation is 100
          onBrushTipChange(originalBrushData);
        }
      }, 50); // 50ms debounce
      
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
              : (isDefaultBrush() ? 'cursor-default' : 'cursor-crosshair')
          }`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        
        {/* Offscreen canvas for actual brush data */}
        <canvas
          ref={offscreenCanvasRef}
          style={{ display: 'none' }}
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
            <div className="w-[2px] self-stretch bg-[#65656A]" />
          </>
        )}
        
        {/* Zoom out */}
        <button
          onClick={zoomOut}
          className="py-1 px-2 text-[#D9D9D9] hover:bg-[#3A3A42] rounded flex-1"
          disabled={zoom <= 1}
        >
          <Minus size={12} />
        </button>
        
        <div className="w-[2px] self-stretch bg-[#65656A]" />
        
        {/* Zoom in */}
        <button
          onClick={zoomIn}
          className="py-1 px-2 text-[#D9D9D9] hover:bg-[#3A3A42] rounded flex-1"
          disabled={zoom >= 16}
        >
          <Plus size={12} />
        </button>
        
        <div className="w-[2px] self-stretch bg-[#65656A]" />
        
        {/* Pin toggle */}
        <button
          onClick={togglePin}
          className={`py-1 px-2 rounded flex-1 ${
            isPinned 
              ? 'text-blue-400 bg-blue-400/20' 
              : 'text-[#D9D9D9] hover:bg-[#3A3A42]'
          }`}
          title={isPinned ? 'Unpin to show current brush tip' : 'Pin to use selected brush for editing'}
        >
          {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
        </button>
        
        <div className="w-[2px] self-stretch bg-[#65656A]" />
        
        {/* Undo */}
        <button
          onClick={handleUndo}
          disabled={undoStack.length === 0 || isDefaultBrush()}
          className={`py-1 px-2 rounded flex-1 ${
            undoStack.length === 0 || isDefaultBrush()
              ? 'text-[#666] cursor-not-allowed'
              : 'text-[#D9D9D9] hover:bg-[#3A3A42]'
          }`}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={12} />
        </button>
        
        <div className="w-[2px] self-stretch bg-[#65656A]" />
        
        {/* Redo */}
        <button
          onClick={handleRedo}
          disabled={redoStack.length === 0 || isDefaultBrush()}
          className={`py-1 px-2 rounded flex-1 ${
            redoStack.length === 0 || isDefaultBrush()
              ? 'text-[#666] cursor-not-allowed'
              : 'text-[#D9D9D9] hover:bg-[#3A3A42]'
          }`}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={12} />
        </button>


        <div className="w-[2px] self-stretch bg-[#65656A]" />
        
        {/* Reset */}
        <button
          onClick={resetBrushTip}
          disabled={isDefaultBrush()}
          className={`py-1 px-2 rounded flex-1 ${
            isDefaultBrush()
              ? 'text-[#666] cursor-not-allowed'
              : 'text-[#D9D9D9] hover:bg-[#3A3A42]'
          }`}
          title="Reset to original"
        >
          <RotateCcw size={12} />
        </button>
      </div>

      {/* Status */}
      {isPinned && (
        <div className="mt-2 text-base text-blue-400 px-3">
          Using selected brush for editing
        </div>
      )}
    </div>
  );
}