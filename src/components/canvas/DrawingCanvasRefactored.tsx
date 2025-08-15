import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useBrushEngine } from '../../hooks/useBrushEngine';
import { useCanvasInteraction } from '../../hooks/useCanvasInteraction';
import { usePanAndZoom } from '../../hooks/usePanAndZoom';
import { useToolStateMachine } from '../../hooks/useToolStateMachine';
import { useComprehensiveKeyboard } from '../../hooks/useComprehensiveKeyboard';
import { useDrawingHandlers } from '../../hooks/useDrawingHandlers';
import { BrushShape } from '../../types';
import BrushCursor from './BrushCursor';

const DrawingCanvasRefactored = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  
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
  const [cursorStyle, setCursorStyle] = useState('none');
  
  // Track if we're in temporary pan mode (space held)
  const isTemporaryPanMode = useRef(false);
  
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
    
    const ctx = compositeCanvasRef.current.getContext('2d');
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
        const pasteCtx = pasteCanvas.getContext('2d');
        
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
  const panAndZoom = usePanAndZoom({ canvasRef, wrapperRef, draw });
  const toolStateMachine = useToolStateMachine({
    screenToWorld: panAndZoom.screenToWorld,
    sampleColorAtPosition,
    sampleColorsAlongLine,
  });
  const drawingHandlers = useDrawingHandlers({
    project,
    screenToWorld: panAndZoom.screenToWorld,
    viewTransformRef: panAndZoom.viewTransformRef,
    draw,
    canvasRef,
  });
  
  // Handle blur to reset pan state when losing focus
  const handleBlur = useCallback(() => {
    console.log('EVENT: Canvas lost focus (blur)');
    // If spacebar was stuck down, force a release
    if (isTemporaryPanMode.current) {
      console.log('  - Resetting stuck pan mode');
      isTemporaryPanMode.current = false;
      setCursorStyle('none');
      setShowBrushCursor(true);
      interaction.dispatch({ type: 'SPACE_RELEASED' });
      if (interaction.stateRef.current.isPanning) {
        interaction.dispatch({ type: 'PAN_END' });
        panAndZoom.finalizePan();
      }
    }
  }, [interaction, panAndZoom]);

  // Comprehensive keyboard handling
  useComprehensiveKeyboard({
    onSpacePressed: () => {
      console.log('EVENT: Space Pressed'); // Debug log
      isTemporaryPanMode.current = true;
      setCursorStyle('grab');
      interaction.dispatch({ type: 'SPACE_PRESSED' });
    },
    onSpaceReleased: () => {
      console.log('EVENT: Space Released'); // Debug log
      isTemporaryPanMode.current = false;
      
      // Always restore cursor state when space is released
      setCursorStyle('none');
      setShowBrushCursor(true);
      
      interaction.dispatch({ type: 'SPACE_RELEASED' });
      
      // If we were panning, end it
      if (interaction.stateRef.current.isPanning) {
        console.log('  - Ending active pan from space release');
        interaction.dispatch({ type: 'PAN_END' });
        panAndZoom.finalizePan();
      }
    },
    onCustomTool: () => {
      setCurrentTool('custom');
    },
    onUndo: () => {
      console.log('🔙 Undo handler called in DrawingCanvasRefactored');
      const snapshot = undo();
      if (snapshot) {
        console.log('✅ Undo snapshot retrieved:', snapshot.description);
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
            const ctx = canvas?.getContext('2d');
            if (ctx) {
              draw(ctx, panAndZoom.viewTransformRef.current);
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
      console.log('🔄 Redo handler called in DrawingCanvasRefactored');
      const snapshot = redo();
      if (snapshot) {
        console.log('✅ Redo snapshot retrieved:', {
          description: snapshot.description,
          hasLayers: !!snapshot.layers,
          layersCount: snapshot.layers?.length,
          hasActiveLayerId: !!snapshot.activeLayerId,
          hasImageData: !!snapshot.imageData
        });
        
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
            const ctx = canvas?.getContext('2d');
            if (ctx) {
              draw(ctx, panAndZoom.viewTransformRef.current);
            }
          });
        } else {
          console.log('⚠️ Redo: Using imageData fallback path');
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
              const ctx = canvas?.getContext('2d');
              if (ctx) {
                draw(ctx, panAndZoom.viewTransformRef.current);
              }
            });
          }
        }
      } else {
        console.log('❌ Redo: No snapshot returned');
      }
    },
    onCompletePolygon: () => {
      if (toolStateMachine.completePolygonGradient()) {
        // Draw polygon
        drawingHandlers.initDrawingCanvas();
        const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d');
        
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
    onCancelPolygon: () => {
      toolStateMachine.resetPolygonGradient();
      interaction.dispatch({ type: 'DRAWING_END' });
    },
    onEnterPressed: async () => {
      // Commit floating paste when Enter is pressed
      if (floatingPaste) {
        await commitFloatingPaste();
        // Trigger redraw
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx) {
          draw(ctx, panAndZoom.viewTransformRef.current);
        }
      }
    },
    onEscapePressed: () => {
      // Cancel floating paste when Escape is pressed
      if (floatingPaste) {
        cancelFloatingPaste();
        // Trigger redraw
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx) {
          draw(ctx, panAndZoom.viewTransformRef.current);
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
    // Always prevent default to avoid browser drag behavior
    event.preventDefault();
    
    const mousePos = getMousePos(event);
    const worldPos = panAndZoom.screenToWorld(mousePos.x, mousePos.y);
    
    
    // Handle panning - check isTemporaryPanMode instead of keyboard.isSpacePressed
    // This ensures we check the actual pan mode state
    if (isTemporaryPanMode.current || event.button === 1 || event.button === 2) {
      console.log('EVENT: Mouse down - Starting pan', { 
        isTemporaryPanMode: isTemporaryPanMode.current,
        button: event.button 
      });
      setShowBrushCursor(false); // Hide brush cursor when panning
      setCursorStyle('grabbing');
      interaction.dispatch({ type: 'PAN_START', payload: mousePos });
      interaction.refs.panStartOffset.current = { 
        x: panAndZoom.viewTransformRef.current.offsetX, 
        y: panAndZoom.viewTransformRef.current.offsetY 
      };
      // Store the initial pan position in the state
      interaction.state.panStart = mousePos;
      return;
    }
    
    // Handle left click
    if (event.button === 0 && !isTemporaryPanMode.current) {
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
        if (toolStateMachine.handleRectangleGradientMouseDown(worldPos)) {
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
      
      // Normal brush
      interaction.dispatch({ type: 'DRAWING_START' });
      drawingHandlers.startDrawing(worldPos);
    }
  }, [getMousePos, panAndZoom, interaction, tools.currentTool, toolStateMachine, 
      setSelectionBounds, drawingHandlers, floatingPaste]);
  
  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const currentMousePos = getMousePos(event);
    const worldPos = panAndZoom.screenToWorld(currentMousePos.x, currentMousePos.y);
    
    // Update mouse position for cursor
    setMousePosition({ x: event.clientX, y: event.clientY });
    
    // Show brush cursor unless we're in pan mode or custom brush selection or dragging floating paste
    if (!isTemporaryPanMode.current && !interaction.state.isPanning && tools.currentTool !== 'custom' && !isDraggingFloatingPaste) {
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
      const ctx = canvas?.getContext('2d');
      if (ctx) {
        draw(ctx, panAndZoom.viewTransformRef.current);
      }
      return;
    }
    
    // Handle panning - check both state and actual panning condition
    if (interaction.state.isPanning) {
      if (!interaction.refs.panStartOffset.current) {
        interaction.refs.panStartOffset.current = {
          x: panAndZoom.viewTransformRef.current.offsetX,
          y: panAndZoom.viewTransformRef.current.offsetY
        };
      }
      const deltaX = currentMousePos.x - interaction.state.panStart.x;
      const deltaY = currentMousePos.y - interaction.state.panStart.y;
      
      const newTransform = panAndZoom.updatePan(deltaX, deltaY, interaction.refs.panStartOffset.current);
      
      // Cancel previous frame if exists
      if (interaction.refs.panAnimationFrame.current) {
        cancelAnimationFrame(interaction.refs.panAnimationFrame.current);
      }
      
      interaction.refs.panAnimationFrame.current = requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx && interaction.state.isPanning) {
          draw(ctx, newTransform);
        }
        interaction.refs.panAnimationFrame.current = null;
      });
      return;
    }
    
    // Handle selection
    if (interaction.state.isSelecting) {
      if (interaction.refs.selectionStart.current) {
        setSelectionBounds(interaction.refs.selectionStart.current, worldPos);
      }
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx) {
        draw(ctx, panAndZoom.viewTransformRef.current);
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
          const ctx = canvas?.getContext('2d');
          if (ctx) {
            draw(ctx, panAndZoom.viewTransformRef.current);
            // Add preview rendering logic here if needed
          }
        }
        return;
      }
      
      // Polygon gradient
      if (toolStateMachine.isPolygonGradient) {
        if (toolStateMachine.handlePolygonGradientMouseMove(worldPos)) {
          // Draw preview
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (ctx) {
            draw(ctx, panAndZoom.viewTransformRef.current);
            // Add preview rendering logic here if needed
          }
        }
        return;
      }
      
      // Normal brush
      drawingHandlers.continueDrawing(worldPos);
    }
  }, [getMousePos, panAndZoom, interaction, toolStateMachine, setSelectionBounds, 
      draw, drawingHandlers, isDraggingFloatingPaste, floatingPaste, updateFloatingPastePosition]);
  
  const handleMouseUp = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    // Handle floating paste drag end
    if (isDraggingFloatingPaste) {
      setIsDraggingFloatingPaste(false);
      floatingPasteDragStart.current = null;
      floatingPasteOriginalPos.current = null;
      setCursorStyle('none');
      setShowBrushCursor(true);
      return;
    }
    
    // Handle panning
    if (interaction.state.isPanning) {
      console.log('EVENT: Mouse up - Ending pan', {
        isTemporaryPanMode: isTemporaryPanMode.current
      });
      if (interaction.refs.panAnimationFrame.current) {
        cancelAnimationFrame(interaction.refs.panAnimationFrame.current);
        interaction.refs.panAnimationFrame.current = null;
      }
      
      // If space is still held, stay in grab mode, otherwise restore tool cursor
      if (isTemporaryPanMode.current) {
        console.log('  - Space still held, staying in grab mode');
        setCursorStyle('grab');
      } else {
        console.log('  - Space not held, restoring normal mode');
        setCursorStyle('none');
        setShowBrushCursor(true); // Restore brush cursor
      }
      
      interaction.dispatch({ type: 'PAN_END' });
      panAndZoom.finalizePan();
      return;
    }
    
    // Handle selection
    if (interaction.state.isSelecting) {
      interaction.dispatch({ type: 'SELECTION_END' });
      const mousePos = getMousePos(event);
      const worldPos = panAndZoom.screenToWorld(mousePos.x, mousePos.y);
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
        if (toolStateMachine.handleRectangleGradientMouseUp()) {
          // Draw the rectangle
          // TODO: Add rectangle drawing logic here when needed
          toolStateMachine.resetRectangleGradient();
        } else {
          // Transition to width defining
          interaction.dispatch({ type: 'DRAWING_MODE_CHANGE', mode: 'definingWidth' });
        }
        return;
      }
      
      // Polygon gradient
      if (toolStateMachine.isPolygonGradient) {
        if (toolStateMachine.handlePolygonGradientMouseUp()) {
          // Finalize polygon
          drawingHandlers.finalizeDrawing();
          toolStateMachine.resetPolygonGradient();
        }
        interaction.dispatch({ type: 'DRAWING_END' });
        return;
      }
      
      // Normal brush
      interaction.dispatch({ type: 'DRAWING_END' });
      drawingHandlers.finalizeDrawing();
    }
  }, [interaction, panAndZoom, getMousePos, setSelectionBounds, tools.currentTool, 
      setCurrentTool, clearSelection, toolStateMachine, drawingHandlers, isDraggingFloatingPaste]);
  
  const handleMouseLeave = useCallback(() => {
    setShowBrushCursor(false);
    
    // Don't end panning on mouse leave if space is held
    // This allows user to pan beyond canvas boundaries
    if (interaction.state.isPanning && !isTemporaryPanMode.current) {
      if (interaction.refs.panAnimationFrame.current) {
        cancelAnimationFrame(interaction.refs.panAnimationFrame.current);
        interaction.refs.panAnimationFrame.current = null;
      }
      interaction.dispatch({ type: 'PAN_END' });
      panAndZoom.finalizePan();
    }
    
    // Only stop normal drawing, not gradient tools
    const brushShape = tools.brushSettings.brushShape;
    if (interaction.state.isDrawing && 
        brushShape !== BrushShape.POLYGON_GRADIENT && 
        brushShape !== BrushShape.RECTANGLE_GRADIENT) {
      interaction.dispatch({ type: 'DRAWING_END' });
    }
  }, [interaction, panAndZoom, tools.brushSettings.brushShape]);
  
  // Effects
  
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
    
    const compCtx = compositeCanvasRef.current.getContext('2d');
    if (compCtx) {
      compCtx.imageSmoothingEnabled = false;
    }
    
    compositeLayersToCanvas(compositeCanvasRef.current);
    setCurrentOffscreenCanvas(compositeCanvasRef.current);
    setNeedsRedraw(prev => prev + 1);
  }, [layersHash, project, compositeLayersToCanvas, setCurrentOffscreenCanvas]);
  
  // Animate marching ants
  useEffect(() => {
    let animationId: number;
    let frameCount = 0;
    
    if ((selectionStart && selectionEnd) || floatingPaste) {
      const animate = () => {
        frameCount++;
        if (frameCount % 3 === 0) {
          setMarchingAntsOffset(prev => (prev + 1) % 10);
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (ctx) {
            draw(ctx, panAndZoom.viewTransformRef.current);
          }
        }
        animationId = requestAnimationFrame(animate);
      };
      animationId = requestAnimationFrame(animate);
    }
    
    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [selectionStart, selectionEnd, floatingPaste, draw, panAndZoom.viewTransformRef]);
  
  // Handle wheel events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('wheel', panAndZoom.handleWheel, { passive: false });
    }
    return () => {
      if (canvas) {
        canvas.removeEventListener('wheel', panAndZoom.handleWheel);
      }
    };
  }, [panAndZoom.handleWheel]);
  
  // Center canvas on mount and focus
  useEffect(() => {
    panAndZoom.centerCanvas();
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
          const tempCtx = tempCanvas.getContext('2d');
          if (tempCtx && activeLayer.imageData) {
            tempCtx.putImageData(activeLayer.imageData, 0, 0);
            saveCanvasState(tempCanvas, 'brush', 'Initial state');
          }
        }
      }
    }
  }, [project, layers, activeLayerId, saveCanvasState]);
  
  // Redraw when composite updates
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    draw(ctx, panAndZoom.viewTransformRef.current);
  }, [needsRedraw, draw, panAndZoom.viewTransformRef]);
  
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
              const tempCtx = tempCanvas.getContext('2d');
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
                const ctx = canvas?.getContext('2d');
                if (ctx) {
                  draw(ctx, panAndZoom.viewTransformRef.current);
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
  }, [project, layers, activeLayerId, saveCanvasState, draw, panAndZoom]);

  // Handle canvas resizing
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const resizeObserver = new ResizeObserver(entries => {
      window.requestAnimationFrame(() => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        canvas.width = width;
        canvas.height = height;
        setCanvasDimensions(width, height);
        draw(ctx, panAndZoom.viewTransformRef.current);
      });
    });
    resizeObserver.observe(wrapper);
    
    const { width, height } = wrapper.getBoundingClientRect();
    canvas.width = width;
    canvas.height = height;
    setCanvasDimensions(width, height);
    draw(ctx, panAndZoom.viewTransformRef.current);
    
    return () => resizeObserver.disconnect();
  }, [draw, setCanvasDimensions, panAndZoom.viewTransformRef]);
  
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
          imageRendering: panAndZoom.viewTransform.scale > 3 ? 'pixelated' : 'auto'
        }}
      />
      
      {/* Zoom indicator */}
      <div className="absolute bottom-4 right-4 bg-black/50 text-white px-2 py-1 rounded text-sm">
        {Math.round(panAndZoom.viewTransform.scale * 100)}%
      </div>
      
      {/* Brush cursor preview */}
      <BrushCursor
        screenX={mousePosition.x}
        screenY={mousePosition.y}
        size={tools.brushSettings.size}
        brushShape={tools.brushSettings.brushShape || BrushShape.ROUND}
        zoom={panAndZoom.viewTransform.scale}
        color={tools.brushSettings.color}
        customBrush={tools.brushSettings.currentBrushTip ? {
          imageData: tools.brushSettings.currentBrushTip.imageData,
          width: tools.brushSettings.currentBrushTip.width || 32,
          height: tools.brushSettings.currentBrushTip.height || 32
        } : null}
        visible={showBrushCursor && !interaction.state.isPanning && !isTemporaryPanMode.current}
      />
    </div>
  );
};

export default React.memo(DrawingCanvasRefactored);