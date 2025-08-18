import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useBrushEngine } from '../../hooks/useBrushEngine';
import { useCanvasInteraction } from '../../hooks/useCanvasInteraction';
import { useCanvasStateMachine } from '../../hooks/useCanvasStateMachine';
import { useSimplePan } from '../../hooks/useSimplePan';
import { useToolStateMachine } from '../../hooks/useToolStateMachine';
import { useComprehensiveKeyboard } from '../../hooks/useComprehensiveKeyboard';
import { useDrawingHandlers } from '../../hooks/useDrawingHandlers';
import { BrushShape } from '../../types';
import { floodFill } from '../../utils/floodFill';
import BrushCursor from './BrushCursor';

const DrawingCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null); 
  const wrapperRef = useRef<HTMLDivElement>(null);
  // const isSpacePressed = useRef(false); // Now handled by state machine
  const isBusyRef = useRef(false); // Lock to prevent concurrent operations
  const isMouseDownRef = useRef(false); // Track mouse button state
  
  // Get essential store state - removed shallow comparison to avoid infinite loop
  const project = useAppStore((state) => state.project);
  const canvas = useAppStore((state) => state.canvas);
  const tools = useAppStore((state) => state.tools);
  const layers = useAppStore((state) => state.layers);
  const activeLayerId = useAppStore((state) => state.activeLayerId);
  const selectionStart = useAppStore((state) => state.selectionStart);
  const selectionEnd = useAppStore((state) => state.selectionEnd);
  const floatingPaste = useAppStore((state) => state.floatingPaste);
  
  // Get functions separately (they don't change)
  const {
    setSelectionBounds,
    clearSelection,
    setCurrentTool,
    setCurrentOffscreenCanvas,
    compositeLayersToCanvas,
    setCanvasDimensions,
    setZoom,
    undo,
    redo,
    saveCanvasState,
    setFloatingPaste,
    updateFloatingPastePosition,
    commitFloatingPaste,
    cancelFloatingPaste,
    setLayers,
    setActiveLayer,
    updateLayer,
  } = useAppStore();
  
  // Mouse position for brush cursor
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [showBrushCursor, setShowBrushCursor] = useState(false);
  const [marchingAntsOffset, setMarchingAntsOffset] = useState(0);
  
  // Determine cursor style based on tool and brush shape
  const defaultCursorStyle = useMemo(() => {
    // Fill tool uses crosshair cursor
    if (tools.currentTool === 'fill') {
      return 'crosshair';
    }
    // Gradient brushes use crosshair cursor
    const brushShape = tools.brushSettings.brushShape;
    if (brushShape === BrushShape.RECTANGLE_GRADIENT || brushShape === BrushShape.POLYGON_GRADIENT) {
      return 'crosshair';
    }
    return 'none';
  }, [tools.currentTool, tools.brushSettings.brushShape]);
  
  const [cursorStyle, setCursorStyle] = useState(defaultCursorStyle);
  
  
  // Track floating paste dragging
  const [isDraggingFloatingPaste, setIsDraggingFloatingPaste] = useState(false);
  const floatingPasteDragStart = useRef<{ x: number; y: number } | null>(null);
  const floatingPasteOriginalPos = useRef<{ x: number; y: number } | null>(null);
  
  // Cached composite canvas
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [needsRedraw, setNeedsRedraw] = useState(0);
  
  // Get brush engine
  const brushEngine = useBrushEngine();
  
  // Memoized layers hash - include more details to ensure changes are detected
  const layersHash = useMemo(() => {
    return layers.map(l => {
      // Create a simple checksum of the imageData to detect content changes
      let checksum = 0;
      if (l.imageData?.data) {
        // Sample the data at intervals for performance
        const step = Math.max(1, Math.floor(l.imageData.data.length / 100));
        for (let i = 0; i < l.imageData.data.length; i += step) {
          checksum += l.imageData.data[i];
        }
      }
      return `${l.id}_${l.visible}_${l.opacity}_${l.imageData?.data.length || 0}_${checksum}`;
    }).join('|');
  }, [layers]);
  
  // Helper function to sample color at position
  const sampleColorAtPosition = useCallback((x: number, y: number): string => {
    if (!compositeCanvasRef.current) return 'rgb(0, 0, 0)';
    
    const ctx = compositeCanvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'rgb(0, 0, 0)';
    
    const clampedX = Math.max(0, Math.min(compositeCanvasRef.current.width - 1, Math.floor(x)));
    const clampedY = Math.max(0, Math.min(compositeCanvasRef.current.height - 1, Math.floor(y)));
    
    const imageData = ctx.getImageData(clampedX, clampedY, 1, 1);
    let [r, g, b] = imageData.data;
    const a = imageData.data[3];
    
    if (a < 10) return 'rgb(255, 255, 255)';
    
    if (r <= 30 && g <= 30 && b <= 30) {
      r = 0; g = 0; b = 0;
    } else if (r >= 225 && g >= 225 && b >= 225) {
      r = 255; g = 255; b = 255;
    }
    
    return `rgb(${r}, ${g}, ${b})`;
  }, []);
  
  // Helper function to sample colors along line
  const sampleColorsAlongLine = useCallback((startX: number, startY: number, endX: number, endY: number, numSamples: number): string[] => {
    if (numSamples <= 0) return [];
    if (numSamples === 1) return [sampleColorAtPosition(startX, startY)];
    
    const colors: string[] = [];
    for (let i = 0; i < numSamples; i++) {
      const t = i / (numSamples - 1);
      const x = startX + (endX - startX) * t;
      const y = startY + (endY - startY) * t;
      colors.push(sampleColorAtPosition(x, y));
    }
    return colors;
  }, [sampleColorAtPosition]);
  
  // Drawing function
  const draw = useCallback((ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, skipDrawingCanvas = false) => {
    const { scale, offsetX, offsetY } = transform;
    
    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    if (project && project.layers.length > 0) {
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      
      // Draw checkerboard
      const checkerSize = 10;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, project.width, project.height);
      ctx.fillStyle = '#e0e0e0';
      
      for (let x = 0; x < project.width; x += checkerSize * 2) {
        for (let y = 0; y < project.height; y += checkerSize * 2) {
          ctx.fillRect(x, y, checkerSize, checkerSize);
          ctx.fillRect(x + checkerSize, y + checkerSize, checkerSize, checkerSize);
        }
      }
      
      const isPixelBrush = tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND;
      ctx.imageSmoothingEnabled = !isPixelBrush && scale < 3;
      
      // Draw composite canvas
      if (compositeCanvasRef.current) {
        ctx.drawImage(compositeCanvasRef.current, 0, 0);
      }
      
      // Draw temporary drawing canvas
      if (!skipDrawingCanvas && drawingHandlers.drawingCanvasRef.current && 
          (interaction.state.isDrawing || drawingHandlers.drawingCanvasHasContent.current)) {
        ctx.drawImage(drawingHandlers.drawingCanvasRef.current, 0, 0);
      }
      
      ctx.restore();
      
      // Draw border
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 2 / scale;
      ctx.strokeRect(0, 0, project.width, project.height);
      ctx.restore();
      
      // Draw floating paste if active
      if (floatingPaste && floatingPaste.imageData) {
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        
        // Create a temporary canvas for the floating paste
        const pasteCanvas = document.createElement('canvas');
        pasteCanvas.width = floatingPaste.width;
        pasteCanvas.height = floatingPaste.height;
        const pasteCtx = pasteCanvas.getContext('2d', { willReadFrequently: true });
        
        if (pasteCtx) {
          pasteCtx.putImageData(floatingPaste.imageData, 0, 0);
          
          // Draw the floating paste at its position
          ctx.drawImage(pasteCanvas, floatingPaste.position.x, floatingPaste.position.y);
          
          // Draw marching ants selection border around the paste
          const x = floatingPaste.position.x;
          const y = floatingPaste.position.y;
          const width = floatingPaste.width;
          const height = floatingPaste.height;
          
          // White background line
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2 / scale;
          ctx.setLineDash([]);
          ctx.strokeRect(x, y, width, height);
          
          // Black dashed line for marching ants
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1 / scale;
          ctx.setLineDash([5 / scale, 5 / scale]);
          ctx.lineDashOffset = -marchingAntsOffset / scale;
          ctx.strokeRect(x, y, width, height);
        }
        
        ctx.restore();
      }
      
      // Draw selection
      if ((selectionStart && selectionEnd) || (interaction.state.isSelecting && interaction.refs.selectionStart.current)) {
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        
        const start = selectionStart || interaction.refs.selectionStart.current;
        const end = selectionEnd || { x: 0, y: 0 };
        
        if (start) {
          const x = Math.min(start.x, end.x);
          const y = Math.min(start.y, end.y);
          const width = Math.abs(end.x - start.x);
          const height = Math.abs(end.y - start.y);
          
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1 / scale;
          ctx.setLineDash([]);
          ctx.strokeRect(x, y, width, height);
          
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1 / scale;
          ctx.setLineDash([5 / scale, 5 / scale]);
          ctx.lineDashOffset = -marchingAntsOffset / scale;
          ctx.strokeRect(x, y, width, height);
        }
        
        ctx.restore();
      }
    }
  }, [project, tools.brushSettings.brushShape, selectionStart, selectionEnd, marchingAntsOffset, floatingPaste]);
  
  // Use custom hooks
  const interaction = useCanvasInteraction();
  const stateMachine = useCanvasStateMachine();
  const pan = useSimplePan({ scale: canvas?.zoom || 1 });
  const prevStateRef = useRef(stateMachine.state);
  
  // Update cursor based on state machine mode
  React.useEffect(() => {
    switch (stateMachine.state.mode) {
      case 'AWAITING_PAN':
        setCursorStyle('grab');
        break;
      case 'PANNING':
        setCursorStyle('grabbing');
        break;
      case 'DRAGGING_PASTE':
        setCursorStyle('move');
        break;
      default:
        setCursorStyle(defaultCursorStyle);
        break;
    }
  }, [stateMachine.state.mode, defaultCursorStyle]);
  
  // View transform ref for zoom
  const viewTransformRef = useRef({ 
    scale: canvas?.zoom || 1, 
    offsetX: 0, 
    offsetY: 0 
  });
  
  // Update view transform when zoom or pan changes
  React.useEffect(() => {
    viewTransformRef.current.offsetX = pan.panState.offsetX;
    viewTransformRef.current.offsetY = pan.panState.offsetY;
    viewTransformRef.current.scale = canvas?.zoom || 1;
  }, [canvas?.zoom, pan.panState.offsetX, pan.panState.offsetY]);

  // Handle state machine transitions for panning (only transitions, not continuous updates)
  React.useEffect(() => {
    const prevMode = prevStateRef.current.mode;
    const currentMode = stateMachine.state.mode;
    
    // Only log and process if mode actually changed
    if (prevMode !== currentMode) {
      // Handle panning state transitions only
      if (currentMode === 'PANNING' && prevMode !== 'PANNING') {
        // Just entered panning mode - use lastPosition which has screen coordinates
        if (stateMachine.state.lastPosition) {
          pan.startPan(stateMachine.state.lastPosition.x, stateMachine.state.lastPosition.y);
        }
      } else if (currentMode !== 'PANNING' && prevMode === 'PANNING') {
        // Just exited panning mode - keep the pan offset
        pan.endPan();
      }
    }
    
    // Update the ref with the new state
    prevStateRef.current = stateMachine.state;
  }, [stateMachine.state.mode, pan]); // Only depend on mode changes
  
  
  const toolStateMachine = useToolStateMachine({
    sampleColorAtPosition
  });
  const drawingHandlers = useDrawingHandlers({
    project,
    screenToWorld: pan.screenToWorld,
    viewTransformRef,
    draw,
    canvasRef: canvasRef as React.RefObject<HTMLCanvasElement>,
    isBusyRef, // Pass the lock ref
  });
  
  // Handle blur to reset space key state when losing focus
  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Check if focus is actually leaving the component entirely
    // relatedTarget is the element that is receiving focus
    const newFocusTarget = e.relatedTarget as HTMLElement;
    
    // If focus is moving to another element within this component, don't reset
    if (newFocusTarget && wrapperRef.current?.contains(newFocusTarget)) {
      return;
    }
    
    // If spacebar was stuck down, force a release
    if (stateMachine.state.isSpacePressed) {
      // Space handling now in state machine
      setCursorStyle(defaultCursorStyle);
      setShowBrushCursor(true);
    }
  }, [defaultCursorStyle, setCursorStyle]);

  // Comprehensive keyboard handling
  useComprehensiveKeyboard({
    onSpacePressed: () => {
      // Dispatch to state machine
      stateMachine.dispatch({ type: 'SPACE_DOWN' });
    },
    onSpaceReleased: () => {
      // Dispatch to state machine
      stateMachine.dispatch({ type: 'SPACE_UP' });
    },
    onCustomTool: () => {
      setCurrentTool('custom');
    },
    onEraserPressed: () => {
      // Eraser key pressed - tool switch handled in hook
    },
    onEraserReleased: () => {
      // Eraser key released - tool restoration handled in hook
    },
    onUndo: () => {
      const snapshot = undo();
      if (snapshot) {
        if (snapshot.layers && snapshot.activeLayerId) {
          setLayers(snapshot.layers);
          setActiveLayer(snapshot.activeLayerId);
          
          // Immediately regenerate composite canvas
          if (compositeCanvasRef.current) {
            compositeLayersToCanvas(compositeCanvasRef.current);
            setCurrentOffscreenCanvas(compositeCanvasRef.current);
          }
          
          // Force a redraw
          setNeedsRedraw(prev => prev + 1);
          
          // Also trigger immediate redraw
          requestAnimationFrame(() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              draw(ctx, viewTransformRef.current);
            }
          });
        } else {
          const activeLayer = layers.find(l => l.id === activeLayerId);
          if (activeLayer && snapshot.imageData) {
            updateLayer(activeLayer.id, { imageData: snapshot.imageData });
            // Force a redraw by incrementing the redraw counter
            setNeedsRedraw(prev => prev + 1);
          }
        }
      }
    },
    onRedo: () => {
      const snapshot = redo();
      if (snapshot) {
        
        if (snapshot.layers && snapshot.activeLayerId) {
          setLayers(snapshot.layers);
          setActiveLayer(snapshot.activeLayerId);
          
          // Immediately regenerate composite canvas
          if (compositeCanvasRef.current) {
            compositeLayersToCanvas(compositeCanvasRef.current);
            setCurrentOffscreenCanvas(compositeCanvasRef.current);
          }
          
          // Force a redraw
          setNeedsRedraw(prev => prev + 1);
          
          // Also trigger immediate redraw
          requestAnimationFrame(() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              draw(ctx, viewTransformRef.current);
            }
          });
        } else {
          const activeLayer = layers.find(l => l.id === activeLayerId);
          if (activeLayer && snapshot.imageData) {
            updateLayer(activeLayer.id, { imageData: snapshot.imageData });
            
            // Immediately regenerate composite canvas for imageData updates too
            if (compositeCanvasRef.current) {
              compositeLayersToCanvas(compositeCanvasRef.current);
              setCurrentOffscreenCanvas(compositeCanvasRef.current);
            }
            
            // Force a redraw
            setNeedsRedraw(prev => prev + 1);
            
            // Also trigger immediate redraw
            requestAnimationFrame(() => {
              const canvas = canvasRef.current;
              const ctx = canvas?.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                draw(ctx, viewTransformRef.current);
              }
            });
          }
        }
      }
    },
    onPolygonComplete: () => {
      if (toolStateMachine.completePolygonGradient()) {
        // Draw polygon
        drawingHandlers.initDrawingCanvas();
        const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
        
        if (drawCtx && brushEngine) {
          brushEngine.drawPolygonGradient(
            drawCtx,
            {
              vertices: toolStateMachine.polygonGradientState.points.map(p => ({ x: p.x, y: p.y })),
              colors: toolStateMachine.polygonGradientState.points.map(p => p.color)
            },
            false
          );
          drawingHandlers.drawingCanvasHasContent.current = true;
          drawingHandlers.finalizeDrawing();
        }
        toolStateMachine.resetPolygonGradient();
      }
    },
    onPolygonCancel: () => {
      toolStateMachine.resetPolygonGradient();
      interaction.dispatch({ type: 'DRAWING_END' });
    },
    onEnterPressed: async () => {
      // Commit floating paste when Enter is pressed
      if (floatingPaste) {
        await commitFloatingPaste();
        // Trigger redraw
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          draw(ctx, viewTransformRef.current);
        }
      }
    },
    onEscapePressed: () => {
      // Cancel floating paste when Escape is pressed
      if (floatingPaste) {
        cancelFloatingPaste();
        // Trigger redraw
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          draw(ctx, viewTransformRef.current);
        }
      }
    },
    enabled: true // Always enable keyboard shortcuts
  });
  
  // Helper to get mouse position
  const getMousePos = useCallback((event: React.MouseEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);
  
  // Mouse event handlers
  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    // Track that mouse is down
    isMouseDownRef.current = true;
    
    // If the app is busy, ignore this mouse click completely
    if (isBusyRef.current) {
      isMouseDownRef.current = false; // Clear ref in case mouseup is missed
      return;
    }
    
    // Always prevent default to avoid browser drag behavior
    event.preventDefault();
    
    const mousePos = getMousePos(event);
    
    const scale = canvas?.zoom || 1;
    const worldPos = pan.screenToWorld(mousePos.x, mousePos.y, scale);
    
    // Dispatch to state machine with SCREEN position for panning
    stateMachine.dispatch({ 
      type: 'MOUSE_DOWN', 
      button: event.button,
      position: mousePos,  // Use screen coordinates, not world
      tool: tools.currentTool 
    });
    
    // --- PROPER FIX: Block clicks outside canvas bounds ---
    if (project) {
      if (worldPos.x < 0 || worldPos.x > project.width || 
          worldPos.y < 0 || worldPos.y > project.height) {
        return; // Don't start any action if click is out of bounds
      }
    }
    
    
    // Do nothing if in pan mode or middle/right mouse button
    if (stateMachine.state.mode === 'AWAITING_PAN' || 
        stateMachine.state.mode === 'PANNING' || 
        event.button === 1 || 
        event.button === 2) {
      return;
    }
    
    // For simple drawing mode, use the existing drawing handlers
    if (stateMachine.state.mode === 'IDLE' && 
        (tools.currentTool === 'brush' || tools.currentTool === 'eraser') &&
        !tools.shapeMode &&
        tools.brushSettings.brushShape !== BrushShape.RECTANGLE_GRADIENT &&
        tools.brushSettings.brushShape !== BrushShape.POLYGON_GRADIENT) {
      // Use the existing drawing system with brush engine
      interaction.dispatch({ type: 'DRAWING_START' });
      drawingHandlers.startDrawing(worldPos);
      return;
    }
    
    // Handle left click
    if (event.button === 0) {
      // Check if clicking on floating paste to drag it
      if (floatingPaste) {
        const pasteX = floatingPaste.position.x;
        const pasteY = floatingPaste.position.y;
        const pasteWidth = floatingPaste.width;
        const pasteHeight = floatingPaste.height;
        
        // Check if click is within floating paste bounds
        if (worldPos.x >= pasteX && worldPos.x <= pasteX + pasteWidth &&
            worldPos.y >= pasteY && worldPos.y <= pasteY + pasteHeight) {
          setIsDraggingFloatingPaste(true);
          floatingPasteDragStart.current = worldPos;
          floatingPasteOriginalPos.current = { ...floatingPaste.position };
          setCursorStyle('move');
          return;
        }
      }
      
      // Handle fill tool
      if (tools.currentTool === 'fill') {
        // Get the active layer
        const activeLayer = layers.find(l => l.id === activeLayerId);
        if (!activeLayer || !activeLayer.imageData) return;
        
        // Parse fill color - handle both hex and rgb formats
        const fillColor = tools.brushSettings.color;
        let r = 0, g = 0, b = 0;
        
        if (fillColor.startsWith('#')) {
          // Handle hex color
          const hex = fillColor.slice(1);
          r = parseInt(hex.substring(0, 2), 16);
          g = parseInt(hex.substring(2, 4), 16);
          b = parseInt(hex.substring(4, 6), 16);
        } else if (fillColor.startsWith('rgb')) {
          // Handle rgb/rgba color
          const matches = fillColor.match(/\d+/g);
          if (matches) {
            [r, g, b] = matches.map(Number);
          }
        }
        
        // Perform flood fill on the active layer's image data
        const filledImageData = floodFill(
          activeLayer.imageData,
          Math.floor(worldPos.x),
          Math.floor(worldPos.y),
          { r, g, b, a: 255 },
          {
            threshold: tools.fillSettings.threshold,
            contiguous: tools.fillSettings.contiguous
          }
        );
        
        // Update the layer with the filled image data
        if (activeLayerId) {
          updateLayer(activeLayerId, { imageData: filledImageData });
        }
        
        // Save state for undo
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = project?.width || 1920;
        tempCanvas.height = project?.height || 1080;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        if (tempCtx) {
          tempCtx.putImageData(filledImageData, 0, 0);
          saveCanvasState(tempCanvas, 'fill', 'Flood fill');
        }
        
        return;
      }
      
      // Handle selection tool
      if (tools.currentTool === 'selection' || tools.currentTool === 'custom') {
        interaction.dispatch({ type: 'SELECTION_START' });
        interaction.refs.selectionStart.current = worldPos;
        setSelectionBounds(worldPos, worldPos);
        if (tools.currentTool === 'custom') {
          setShowBrushCursor(false); // Hide brush cursor when making custom brush selection
        }
        return;
      }
      
      // Handle rectangle gradient
      if (toolStateMachine.isRectangleGradient) {
        const result = toolStateMachine.handleRectangleGradientMouseDown(worldPos);
        if (result === 'finalize') {
          // This click finalizes the width - draw the rectangle
          const currentRectState = toolStateMachine.rectangleBrushState;
          
          drawingHandlers.initDrawingCanvas();
          const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
          
          if (drawCtx && brushEngine) {
            const dx = currentRectState.endPos.x - currentRectState.startPos.x;
            const dy = currentRectState.endPos.y - currentRectState.startPos.y;
            const length = Math.hypot(dx, dy);
            
            if (length > 0) {
              // Calculate perpendicular distance from mouse to line
              const lineVecX = dx / length;
              const lineVecY = dy / length;
              const toMouseX = worldPos.x - currentRectState.startPos.x;
              const toMouseY = worldPos.y - currentRectState.startPos.y;
              const perpDist = Math.abs(-lineVecY * toMouseX + lineVecX * toMouseY);
              const width = perpDist * 2;
              
              // Sample colors along the rectangle length
              const numColors = tools.brushSettings.colors || 2;
              const sampledColors = sampleColorsAlongLine(
                currentRectState.startPos.x,
                currentRectState.startPos.y,
                currentRectState.endPos.x,
                currentRectState.endPos.y,
                numColors
              );
              
              // Draw the rectangle gradient
              brushEngine.drawRectangleGradient(
                drawCtx,
                {
                  startPos: currentRectState.startPos,
                  endPos: currentRectState.endPos,
                  width: width,
                  startColor: sampledColors[0] || tools.brushSettings.color,
                  endColor: sampledColors[sampledColors.length - 1] || tools.brushSettings.color,
                  colors: sampledColors,
                  ditherEnabled: tools.brushSettings.ditherEnabled
                },
                false
              );
              
              drawingHandlers.drawingCanvasHasContent.current = true;
              drawingHandlers.finalizeDrawing();
            }
          }
          
          toolStateMachine.resetRectangleGradient();
        } else if (result === true) {
          interaction.dispatch({ type: 'DRAWING_START', mode: 'definingLength' });
        }
        return;
      }
      
      // Handle polygon gradient
      if (toolStateMachine.isPolygonGradient) {
        if (toolStateMachine.handlePolygonGradientMouseDown(worldPos)) {
          interaction.dispatch({ type: 'DRAWING_START' });
        }
        return;
      }
      
      // Normal brush or shape mode
      interaction.dispatch({ type: 'DRAWING_START' });
      if (tools.shapeMode) {
        drawingHandlers.startShapeDrawing(worldPos);
      } else {
        drawingHandlers.startDrawing(worldPos);
      }
    }
  }, [getMousePos, interaction, tools.currentTool, toolStateMachine, canvas, 
      setSelectionBounds, drawingHandlers, floatingPaste, project, 
      stateMachine.state.mode, stateMachine.dispatch, pan]);
  
  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const currentMousePos = getMousePos(event);
    const scale = canvas?.zoom || 1;
    const worldPos = pan.screenToWorld(currentMousePos.x, currentMousePos.y, scale);
    
    // Always dispatch to state machine first with screen coordinates
    stateMachine.dispatch({ 
      type: 'MOUSE_MOVE',
      position: currentMousePos 
    });
    
    // Handle panning update if in PANNING mode
    if (stateMachine.state.mode === 'PANNING') {
      pan.updatePan(currentMousePos.x, currentMousePos.y);
      // Trigger redraw
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        draw(ctx, viewTransformRef.current);
      }
      return; // Don't process other mouse move logic while panning
    }
    
    // No clamping needed - line clipping in useDrawingHandlers handles edge cases properly
    
    // Update mouse position for cursor
    setMousePosition({ x: event.clientX, y: event.clientY });
    
    // Show brush cursor unless we're in custom brush selection or dragging floating paste
    if (stateMachine.state.mode !== 'AWAITING_PAN' && stateMachine.state.mode !== 'PANNING' && tools.currentTool !== 'custom' && !isDraggingFloatingPaste) {
      setShowBrushCursor(true);
    } else if (tools.currentTool === 'custom' || isDraggingFloatingPaste) {
      setShowBrushCursor(false);
    }
    
    // Handle dragging floating paste
    if (isDraggingFloatingPaste && floatingPasteDragStart.current && floatingPasteOriginalPos.current) {
      const deltaX = worldPos.x - floatingPasteDragStart.current.x;
      const deltaY = worldPos.y - floatingPasteDragStart.current.y;
      
      const newX = floatingPasteOriginalPos.current.x + deltaX;
      const newY = floatingPasteOriginalPos.current.y + deltaY;
      
      updateFloatingPastePosition({ x: newX, y: newY });
      
      // Redraw
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        draw(ctx, viewTransformRef.current);
      }
      return;
    }
    
    // Check for rectangle gradient width preview mode (special case - works without mouse down)
    if (toolStateMachine.isRectangleGradient && 
        toolStateMachine.rectangleBrushState.drawingState === 'definingWidth') {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        draw(ctx, viewTransformRef.current);
        
        // Width definition preview - show full rectangle with gradient
        const currentRectState = toolStateMachine.rectangleBrushState;
        const startPos = currentRectState.startPos;
        const endPos = currentRectState.endPos;
        const dx = endPos.x - startPos.x;
        const dy = endPos.y - startPos.y;
        const length = Math.hypot(dx, dy);
        
        if (length > 0) {
          const lineVecX = dx / length;
          const lineVecY = dy / length;
          const toMouseX = worldPos.x - startPos.x;
          const toMouseY = worldPos.y - startPos.y;
          const perpDist = Math.abs(-lineVecY * toMouseX + lineVecX * toMouseY);
          const previewWidth = perpDist * 2;
          
          const perpX = -dy / length * (previewWidth / 2);
          const perpY = dx / length * (previewWidth / 2);
          
          const corners = [
            { x: startPos.x + perpX, y: startPos.y + perpY },
            { x: startPos.x - perpX, y: startPos.y - perpY },
            { x: endPos.x - perpX, y: endPos.y - perpY },
            { x: endPos.x + perpX, y: endPos.y + perpY }
          ];
          
          ctx.save();
          ctx.translate(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
          ctx.scale(viewTransformRef.current.scale, viewTransformRef.current.scale);
          
          ctx.globalAlpha = tools.brushSettings.opacity || 1;
          ctx.globalCompositeOperation = tools.currentTool === 'eraser' ? 'destination-out' : (tools.brushSettings.blendMode || 'source-over');
          
          // Sample colors for preview
          const numColors = tools.brushSettings.colors || 2;
          const sampledColors = sampleColorsAlongLine(
            startPos.x,
            startPos.y,
            endPos.x,
            endPos.y,
            numColors
          );
          
          // Create gradient for preview
          const gradient = ctx.createLinearGradient(startPos.x, startPos.y, endPos.x, endPos.y);
          
          if (sampledColors.length > 0) {
            sampledColors.forEach((color, index) => {
              const position = sampledColors.length === 1 ? 0 : index / (sampledColors.length - 1);
              gradient.addColorStop(position, color);
            });
          } else {
            gradient.addColorStop(0, tools.brushSettings.color);
            gradient.addColorStop(1, tools.brushSettings.color);
          }
          
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          ctx.lineTo(corners[1].x, corners[1].y);
          ctx.lineTo(corners[2].x, corners[2].y);
          ctx.lineTo(corners[3].x, corners[3].y);
          ctx.closePath();
          ctx.fill();
          
          ctx.restore();
        }
      }
      return;
    }
    
    
    // Handle selection
    if (interaction.state.isSelecting) {
      if (interaction.refs.selectionStart.current) {
        setSelectionBounds(interaction.refs.selectionStart.current, worldPos);
      }
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        draw(ctx, viewTransformRef.current);
      }
      return;
    }
    
    // Handle drawing
    if (interaction.state.isDrawing) {
      // Rectangle gradient
      if (toolStateMachine.isRectangleGradient) {
        const previewType = toolStateMachine.handleRectangleGradientMouseMove(worldPos);
        if (previewType) {
          // Draw preview
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            draw(ctx, viewTransformRef.current);
            
            // Get current rectangle state
            const currentRectState = toolStateMachine.rectangleBrushState;
            
            if (previewType === 'length') {
              // Length definition preview - show thin line
              ctx.save();
              ctx.translate(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
              ctx.scale(viewTransformRef.current.scale, viewTransformRef.current.scale);
              
              ctx.strokeStyle = tools.brushSettings.color;
              ctx.lineWidth = 2 / viewTransformRef.current.scale;
              ctx.beginPath();
              ctx.moveTo(currentRectState.startPos.x, currentRectState.startPos.y);
              ctx.lineTo(currentRectState.endPos.x, currentRectState.endPos.y);
              ctx.stroke();
              
              ctx.restore();
            } else if (previewType === 'width') {
              // Width definition preview - show full rectangle with gradient
              const startPos = currentRectState.startPos;
              const endPos = currentRectState.endPos;
              const dx = endPos.x - startPos.x;
              const dy = endPos.y - startPos.y;
              const length = Math.hypot(dx, dy);
              
              if (length > 0) {
                const lineVecX = dx / length;
                const lineVecY = dy / length;
                const toMouseX = worldPos.x - startPos.x;
                const toMouseY = worldPos.y - startPos.y;
                const perpDist = Math.abs(-lineVecY * toMouseX + lineVecX * toMouseY);
                const previewWidth = perpDist * 2;
                
                const perpX = -dy / length * (previewWidth / 2);
                const perpY = dx / length * (previewWidth / 2);
                
                const corners = [
                  { x: startPos.x + perpX, y: startPos.y + perpY },
                  { x: startPos.x - perpX, y: startPos.y - perpY },
                  { x: endPos.x - perpX, y: endPos.y - perpY },
                  { x: endPos.x + perpX, y: endPos.y + perpY }
                ];
                
                ctx.save();
                ctx.translate(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
                ctx.scale(viewTransformRef.current.scale, viewTransformRef.current.scale);
                
                ctx.globalAlpha = tools.brushSettings.opacity || 1;
                ctx.globalCompositeOperation = tools.currentTool === 'eraser' ? 'destination-out' : (tools.brushSettings.blendMode || 'source-over');
                
                // Sample colors for preview
                const numColors = tools.brushSettings.colors || 2;
                const sampledColors = sampleColorsAlongLine(
                  startPos.x,
                  startPos.y,
                  endPos.x,
                  endPos.y,
                  numColors
                );
                
                // Create gradient for preview
                const gradient = ctx.createLinearGradient(startPos.x, startPos.y, endPos.x, endPos.y);
                
                if (sampledColors.length > 0) {
                  sampledColors.forEach((color, index) => {
                    const position = sampledColors.length === 1 ? 0 : index / (sampledColors.length - 1);
                    gradient.addColorStop(position, color);
                  });
                } else {
                  gradient.addColorStop(0, tools.brushSettings.color);
                  gradient.addColorStop(1, tools.brushSettings.color);
                }
                
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.moveTo(corners[0].x, corners[0].y);
                ctx.lineTo(corners[1].x, corners[1].y);
                ctx.lineTo(corners[2].x, corners[2].y);
                ctx.lineTo(corners[3].x, corners[3].y);
                ctx.closePath();
                ctx.fill();
                
                ctx.restore();
              }
            }
          }
        }
        return;
      }
      
      // Polygon gradient
      if (toolStateMachine.isPolygonGradient) {
        if (toolStateMachine.handlePolygonGradientMouseMove(worldPos)) {
          // Draw preview
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d', { willReadFrequently: true });
          const currentPolygonState = toolStateMachine.polygonGradientState;
          
          if (ctx && currentPolygonState.points.length > 0) {
            draw(ctx, viewTransformRef.current);
            
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.translate(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
            ctx.scale(viewTransformRef.current.scale, viewTransformRef.current.scale);
            
            // Build preview vertices including current mouse position
            const previewVertices = [
              ...currentPolygonState.points.map(p => ({ x: p.x, y: p.y })),
              { x: worldPos.x, y: worldPos.y }
            ];
            
            if (previewVertices.length >= 3) {
              // Calculate bounds for gradient
              const minX = Math.min(...previewVertices.map(v => v.x));
              const minY = Math.min(...previewVertices.map(v => v.y));
              const maxX = Math.max(...previewVertices.map(v => v.x));
              const maxY = Math.max(...previewVertices.map(v => v.y));
              const width = maxX - minX;
              const height = maxY - minY;
              
              // Choose gradient direction based on polygon shape
              let gradient;
              if (width > height) {
                gradient = ctx.createLinearGradient(minX, (minY + maxY) / 2, maxX, (minY + maxY) / 2);
              } else {
                gradient = ctx.createLinearGradient((minX + maxX) / 2, minY, (minX + maxX) / 2, maxY);
              }
              
              // Build preview colors
              const previewColors = [
                ...currentPolygonState.points.map(p => p.color),
                sampleColorAtPosition(worldPos.x, worldPos.y)
              ];
              
              // Create gradient stops
              if (previewColors.length >= 3) {
                gradient.addColorStop(0, previewColors[0]);
                gradient.addColorStop(0.5, previewColors[Math.floor(previewColors.length / 2)]);
                gradient.addColorStop(1, previewColors[previewColors.length - 1]);
              } else if (previewColors.length === 2) {
                gradient.addColorStop(0, previewColors[0]);
                gradient.addColorStop(1, previewColors[1]);
              } else if (previewColors.length === 1) {
                gradient.addColorStop(0, previewColors[0]);
                gradient.addColorStop(1, previewColors[0]);
              }
              
              // Draw filled polygon preview
              ctx.fillStyle = gradient;
              ctx.beginPath();
              ctx.moveTo(previewVertices[0].x, previewVertices[0].y);
              for (let i = 1; i < previewVertices.length; i++) {
                ctx.lineTo(previewVertices[i].x, previewVertices[i].y);
              }
              ctx.closePath();
              ctx.fill();
            }
            
            ctx.restore();
          }
        }
        return;
      }
      
      // Normal brush or shape mode
      if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
        drawingHandlers.continueShapeDrawing(worldPos);
      } else {
        drawingHandlers.continueDrawing(worldPos);
      }
      
      // Draw shape preview if in shape mode
      if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current && drawingHandlers.shapePointsRef.current.length > 0) {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          draw(ctx, viewTransformRef.current);
          
          // Draw preview of the shape
          ctx.save();
          ctx.translate(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
          ctx.scale(viewTransformRef.current.scale, viewTransformRef.current.scale);
          
          // Disable antialiasing for pixel brushes
          const isPixelBrush = tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND || 
                              tools.brushSettings.brushShape === BrushShape.SQUARE ||
                              !tools.brushSettings.antialiasing;
          ctx.imageSmoothingEnabled = !isPixelBrush;
          
          // Set up preview style with actual brush settings
          ctx.globalAlpha = tools.brushSettings.opacity; // Full opacity as requested
          ctx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';
          
          // Create the path
          ctx.beginPath();
          const points = drawingHandlers.shapePointsRef.current;
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
          }
          // Connect to current mouse position
          ctx.lineTo(worldPos.x, worldPos.y);
          ctx.closePath();
          
          // Fill with color or pattern based on brush type
          if (tools.brushSettings.brushShape === BrushShape.CUSTOM && 
              tools.brushSettings.selectedCustomBrush && 
              tools.brushSettings.currentBrushTip) {
            // Create tiled pattern for custom brush
            const patternCanvas = document.createElement('canvas');
            const brushTip = tools.brushSettings.currentBrushTip;
            const brushWidth = brushTip.width || 32;
            const brushHeight = brushTip.height || 32;
            const scaledSize = (tools.brushSettings.size / 100) * Math.max(brushWidth, brushHeight);
            
            patternCanvas.width = scaledSize;
            patternCanvas.height = scaledSize;
            const patternCtx = patternCanvas.getContext('2d', { willReadFrequently: true });
            
            if (patternCtx) {
              // Create temp canvas for the brush tip
              const tipCanvas = document.createElement('canvas');
              tipCanvas.width = brushWidth;
              tipCanvas.height = brushHeight;
              const tipCtx = tipCanvas.getContext('2d', { willReadFrequently: true });
              
              if (tipCtx) {
                tipCtx.putImageData(brushTip.imageData, 0, 0);
                
                // Scale and draw to pattern canvas
                patternCtx.drawImage(tipCanvas, 0, 0, scaledSize, scaledSize);
                
                // Create pattern and fill
                const pattern = ctx.createPattern(patternCanvas, 'repeat');
                if (pattern) {
                  ctx.fillStyle = pattern;
                  ctx.fill();
                }
              }
            }
          } else {
            // Fill with solid color for regular brushes
            ctx.fillStyle = tools.brushSettings.color;
            ctx.fill();
          }
          
          // No outline - only fill as requested
          
          ctx.restore();
        }
      }
    }
  }, [getMousePos, interaction, toolStateMachine, setSelectionBounds, canvas, 
      draw, drawingHandlers, isDraggingFloatingPaste, floatingPaste, updateFloatingPastePosition, project, isBusyRef,
      stateMachine.state.mode, stateMachine.dispatch, pan, viewTransformRef]);
  
  const handleMouseUp = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    // Clear mouse down state
    isMouseDownRef.current = false;
    
    const mousePos = getMousePos(event);
    const scale = canvas?.zoom || 1;
    const worldPos = pan.screenToWorld(mousePos.x, mousePos.y, scale);
    
    // Dispatch to state machine
    stateMachine.dispatch({ 
      type: 'MOUSE_UP',
      position: mousePos 
    });
    
    // For other modes, dispatch with screen position
    stateMachine.dispatch({ 
      type: 'MOUSE_UP',
      position: mousePos 
    });
    
    // Handle floating paste drag end
    if (isDraggingFloatingPaste) {
      setIsDraggingFloatingPaste(false);
      floatingPasteDragStart.current = null;
      floatingPasteOriginalPos.current = null;
      setCursorStyle(defaultCursorStyle);
      setShowBrushCursor(true);
      return;
    }
    
    
    // Handle selection
    if (interaction.state.isSelecting) {
      interaction.dispatch({ type: 'SELECTION_END' });
      const mousePos = getMousePos(event);
      const scale = canvas?.zoom || 1;
      let worldPos = pan.screenToWorld(mousePos.x, mousePos.y, scale);
      
      // Clamp world position to canvas bounds
      if (project) {
        worldPos = {
          x: Math.max(0, Math.min(project.width - 1, worldPos.x)),
          y: Math.max(0, Math.min(project.height - 1, worldPos.y))
        };
      }
      if (interaction.refs.selectionStart.current) {
        setSelectionBounds(interaction.refs.selectionStart.current, worldPos);
        if (tools.currentTool === 'custom') {
          setCurrentTool('brush');
          clearSelection();
          setShowBrushCursor(true); // Show brush cursor again after custom brush selection
        }
      }
      interaction.refs.selectionStart.current = null;
      return;
    }
    
    // Handle drawing
    if (interaction.state.isDrawing) {
      // Rectangle gradient
      if (toolStateMachine.isRectangleGradient) {
        // Just handle the state transition - actual drawing is done in mouseDown when finalizing
        toolStateMachine.handleRectangleGradientMouseUp();
        // Don't end drawing state - stay active for width definition
        return;
      }
      
      // Polygon gradient
      if (toolStateMachine.isPolygonGradient) {
        if (toolStateMachine.handlePolygonGradientMouseUp()) {
          // Finalize polygon - we have at least 3 points
          const currentPolygonState = toolStateMachine.polygonGradientState;
          
          if (currentPolygonState.points.length >= 3) {
            drawingHandlers.initDrawingCanvas();
            const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
            
            if (drawCtx && brushEngine) {
              // Draw the polygon gradient
              brushEngine.drawPolygonGradient(
                drawCtx,
                {
                  vertices: currentPolygonState.points.map(p => ({ x: p.x, y: p.y })),
                  colors: currentPolygonState.points.map(p => p.color)
                },
                false // not preview
              );
              
              drawingHandlers.drawingCanvasHasContent.current = true;
            }
          }
          
          // Finalize the drawing
          drawingHandlers.finalizeDrawing();
          toolStateMachine.resetPolygonGradient();
        }
        interaction.dispatch({ type: 'DRAWING_END' });
        return;
      }
      
      // Normal brush or shape mode
      interaction.dispatch({ type: 'DRAWING_END' });
      if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
        drawingHandlers.finalizeShapeDrawing();
      } else {
        drawingHandlers.finalizeDrawing();
      }
    }
  }, [interaction, getMousePos, setSelectionBounds, tools.currentTool, 
      setCurrentTool, clearSelection, toolStateMachine, drawingHandlers, isDraggingFloatingPaste, project,
      stateMachine, layers, activeLayerId, updateLayer, saveCanvasState, tools, pan, canvas]);
  
  const handleMouseLeave = useCallback(() => {
    setShowBrushCursor(false);
    
    
    // If the user is drawing, finalize the stroke when they leave the canvas
    if (interaction.state.isDrawing) {
      interaction.dispatch({ type: 'DRAWING_END' });
      
      // Check if we're in shape mode or regular drawing mode
      if (drawingHandlers.isDrawingShapeRef && drawingHandlers.isDrawingShapeRef.current) {
        drawingHandlers.finalizeShapeDrawing();
      } else {
        drawingHandlers.finalizeDrawing();
      }
    }
  }, [interaction, drawingHandlers]);
  
  // Effects
  
  // Update cursor style when brush shape changes
  useEffect(() => {
    // Only update if we're not in a special mode (dragging, etc.)
    if (stateMachine.state.mode !== 'AWAITING_PAN' && stateMachine.state.mode !== 'PANNING' && !isDraggingFloatingPaste) {
      setCursorStyle(defaultCursorStyle);
    }
  }, [defaultCursorStyle, isDraggingFloatingPaste, setCursorStyle]);
  
  // Regenerate composite canvas when layers change
  useEffect(() => {
    if (!project || !compositeLayersToCanvas) return;
    
    if (!compositeCanvasRef.current) {
      compositeCanvasRef.current = document.createElement('canvas');
    }
    if (compositeCanvasRef.current.width !== project.width || 
        compositeCanvasRef.current.height !== project.height) {
      compositeCanvasRef.current.width = project.width;
      compositeCanvasRef.current.height = project.height;
    }
    
    const compCtx = compositeCanvasRef.current.getContext('2d', { willReadFrequently: true });
    if (compCtx) {
      compCtx.imageSmoothingEnabled = false;
    }
    
    compositeLayersToCanvas(compositeCanvasRef.current);
    setCurrentOffscreenCanvas(compositeCanvasRef.current);
    setNeedsRedraw(prev => prev + 1);
  }, [layersHash, project, compositeLayersToCanvas, setCurrentOffscreenCanvas]);
  
  // Animate marching ants
  useEffect(() => {
    let animationId: number | null = null;
    let frameCount = 0;
    let isActive = true;
    
    if ((selectionStart && selectionEnd) || floatingPaste) {
      const animate = () => {
        // Check if effect is still active before continuing animation
        if (!isActive) return;
        
        frameCount++;
        if (frameCount % 3 === 0) {
          setMarchingAntsOffset(prev => (prev + 1) % 10);
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            // We need to call draw here, but we don't include it in dependencies
            // to avoid circular dependency that causes infinite loop
            draw(ctx, viewTransformRef.current);
          }
        }
        animationId = requestAnimationFrame(animate);
      };
      animationId = requestAnimationFrame(animate);
    }
    
    return () => {
      isActive = false;
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    };
  // FIX: Removed `draw` from dependencies to break circular dependency
  // The animation only needs to know when to start/stop, not when draw changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionStart, selectionEnd, floatingPaste, viewTransformRef]);
  
  // Handle wheel events for zooming and panning
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      // Always read from the ref to get the most up-to-date values
      // without needing to re-create this handler on every render.
      const { scale: currentScale, offsetX: currentOffsetX, offsetY: currentOffsetY } = viewTransformRef.current;

      // Always zoom with vertical scroll
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        // --- Zoom Logic (vertical scroll) ---
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const scrollSensitivity = 0.001;
        const zoomFactor = 1 - e.deltaY * scrollSensitivity;
        const newScale = Math.max(0.1, Math.min(currentScale * zoomFactor, 32));
        
        const worldX = (mouseX - currentOffsetX) / currentScale;
        const worldY = (mouseY - currentOffsetY) / currentScale;
        
        const newOffsetX = mouseX - worldX * newScale;
        const newOffsetY = mouseY - worldY * newScale;
        
        // Set state and let React handle the redraw
        setZoom(newScale);
        // Update pan to keep zoom centered on cursor
        pan.setPan(newOffsetX, newOffsetY);

      } else if (e.deltaX !== 0) {
        // Horizontal scroll - no action
      }
    };
    
    const canvasElement = canvasRef.current;
    if (canvasElement) {
      canvasElement.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (canvasElement) {
        canvasElement.removeEventListener('wheel', handleWheel);
      }
    };
    // The ref handles stale data, so dependencies can be minimal and stable.
  }, [setZoom, viewTransformRef, pan]);
  
  // Consolidated safety net for resetting interaction state
  useEffect(() => {
    const handleInteractionReset = () => {
      // Safety reset handler
      
      
      // Check if the space key state is stuck
      if (stateMachine.state.isSpacePressed) {
        
        // Space handling now in state machine
        
        // Always restore the default cursor and show the brush
        setCursorStyle(defaultCursorStyle);
        setShowBrushCursor(true);
      } else {
      }
    };

    const handleVisibilityChange = () => {
      // Reset state if the tab is hidden
      if (document.hidden) {
        handleInteractionReset();
      }
    };

    // Listen for the window losing focus (e.g., Alt-Tab)
    window.addEventListener('blur', handleInteractionReset);
    
    // Listen for the tab being switched away
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup: remove listeners when the component unmounts
    return () => {
      window.removeEventListener('blur', handleInteractionReset);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    
    // Dependencies ensure the handler has the correct functions/values if they ever change.
  }, [defaultCursorStyle, setCursorStyle, setShowBrushCursor]);
  
  // Center canvas on mount and focus
  useEffect(() => {
    // centerCanvas removed();
    // Auto-focus the canvas wrapper for keyboard events
    if (wrapperRef.current) {
      wrapperRef.current.focus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Save initial state
  useEffect(() => {
    if (project && layers.length > 0 && compositeCanvasRef.current) {
      const store = useAppStore.getState();
      if (store.history.undoStack.length === 0) {
        const activeLayer = layers.find(l => l.id === activeLayerId) || layers[0];
        if (activeLayer) {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = project.width;
          tempCanvas.height = project.height;
          const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
          if (tempCtx && activeLayer.imageData) {
            tempCtx.putImageData(activeLayer.imageData, 0, 0);
            saveCanvasState(tempCanvas, 'brush', 'Initial state');
          }
        }
      }
    }
  }, [project, layers, activeLayerId, saveCanvasState]);
  
  // Redraw whenever the view transform state or composite canvas changes
  useEffect(() => {
    const canvasElement = canvasRef.current;
    const ctx = canvasElement?.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    // Build the transform from the latest state that triggered this render
    const transform = {
      scale: canvas?.zoom || 1,  // canvas here is from store, not DOM element
      offsetX: pan.panState.offsetX,
      offsetY: pan.panState.offsetY
    };
    
    draw(ctx, transform);

  // This now correctly depends on the sources of truth for a redraw
  }, [canvas?.zoom, pan.panState.offsetX, pan.panState.offsetY, draw, needsRedraw]);
  
  // Handle paste event
  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      event.preventDefault();
      
      const items = event.clipboardData?.items;
      if (!items) return;
      
      for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
          const blob = item.getAsFile();
          if (!blob) continue;
          
          // Convert blob to image
          const reader = new FileReader();
          reader.onload = async (e) => {
            const img = new Image();
            img.onload = async () => {
              // Create a canvas to draw the image
              const tempCanvas = document.createElement('canvas');
              const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
              if (!tempCtx || !project) return;
              
              // Set canvas size to match project
              tempCanvas.width = project.width;
              tempCanvas.height = project.height;
              
              // Calculate position to center the image
              const scale = Math.min(
                project.width / img.width,
                project.height / img.height,
                1 // Don't scale up
              );
              
              const scaledWidth = img.width * scale;
              const scaledHeight = img.height * scale;
              const x = (project.width - scaledWidth) / 2;
              const y = (project.height - scaledHeight) / 2;
              
              // Draw the image centered and scaled
              tempCtx.drawImage(img, x, y, scaledWidth, scaledHeight);
              
              // Get only the actual image area, not the entire canvas
              const imageX = Math.floor(x);
              const imageY = Math.floor(y);
              const imageWidth = Math.ceil(scaledWidth);
              const imageHeight = Math.ceil(scaledHeight);
              
              // Get the image data for just the pasted content
              const pasteImageData = tempCtx.getImageData(imageX, imageY, imageWidth, imageHeight);
              
              // Create floating paste with actual image dimensions
              setFloatingPaste({
                imageData: pasteImageData,
                position: { x: imageX, y: imageY }, // Start at the centered position
                width: imageWidth,
                height: imageHeight
              });
              
              // Trigger redraw to show floating paste
              requestAnimationFrame(() => {
                const canvas = canvasRef.current;
                const ctx = canvas?.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  draw(ctx, viewTransformRef.current);
                }
              });
            };
            
            img.src = e.target?.result as string;
          };
          
          reader.readAsDataURL(blob);
          break; // Only handle first image
        }
      }
    };
    
    // Add paste event listener
    document.addEventListener('paste', handlePaste);
    
    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, [project, layers, activeLayerId, saveCanvasState, draw]);

  // Handle canvas resizing
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    const resizeObserver = new ResizeObserver(entries => {
      window.requestAnimationFrame(() => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        canvas.width = width;
        canvas.height = height;
        setCanvasDimensions(width, height);
        draw(ctx, viewTransformRef.current);
      });
    });
    resizeObserver.observe(wrapper);
    
    const { width, height } = wrapper.getBoundingClientRect();
    canvas.width = width;
    canvas.height = height;
    setCanvasDimensions(width, height);
    draw(ctx, viewTransformRef.current);
    
    return () => resizeObserver.disconnect();
  }, [draw, setCanvasDimensions, viewTransformRef]);
  
  return (
    <div
      ref={wrapperRef}
      className="w-full h-full relative"
      style={{ 
        overflow: 'hidden', 
        backgroundColor: '#2a2a2a',
        cursor: cursorStyle
      }}
      tabIndex={0}
      onBlur={handleBlur}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onContextMenu={(e) => e.preventDefault()}
        tabIndex={-1}
        style={{ 
          display: 'block', 
          width: '100%', 
          height: '100%',
          imageRendering: (canvas?.zoom || 1) > 3 ? 'pixelated' : 'auto'
        }}
      />
      
      {/* Zoom indicator */}
      <div className="absolute bottom-4 right-4 bg-black/50 text-white px-2 py-1 rounded text-sm">
        {Math.round((canvas?.zoom || 1) * 100)}%
      </div>
      
      {/* Brush cursor preview */}
      <BrushCursor
        screenX={mousePosition.x}
        screenY={mousePosition.y}
        size={tools.brushSettings.size}
        brushShape={tools.brushSettings.brushShape || BrushShape.ROUND}
        zoom={canvas?.zoom || 1}
        color={tools.brushSettings.color}
        customBrush={tools.brushSettings.currentBrushTip ? {
          imageData: tools.brushSettings.currentBrushTip.imageData,
          width: tools.brushSettings.currentBrushTip.width || 32,
          height: tools.brushSettings.currentBrushTip.height || 32
        } : null}
        visible={showBrushCursor && stateMachine.state.mode !== 'AWAITING_PAN' && stateMachine.state.mode !== 'PANNING' && cursorStyle !== 'crosshair'}
      />
    </div>
  );
};

export default React.memo(DrawingCanvas);