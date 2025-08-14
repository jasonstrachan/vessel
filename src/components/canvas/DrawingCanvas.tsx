import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useBrushEngine } from '../../hooks/useBrushEngine';
import { BrushShape } from '../../types';

// This component implements a responsive canvas with pan and zoom functionality.
// It separates "world space" (where drawings live) from "screen space" (the visible canvas).
const DrawingCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  
  // Get store state
  const { 
    shapeState,
    setShapeDrawing,
    canvas,
    setCanvasDimensions,
    setZoom,
    setPan,
    project,
    compositeLayersToCanvas,
    captureCanvasToActiveLayer,
    tools,
    setCurrentTool,
    activeBrushComponents,
    layers,
    activeLayerId,
    rectangleBrushState,
    setRectangleBrushState,
    polygonGradientState,
    setPolygonGradientState,
    setCurrentOffscreenCanvas,
    selectionStart,
    selectionEnd,
    setSelectionBounds,
    clearSelection
  } = useAppStore();

  // State for the view transformation (pan and zoom)
  const [viewTransform, setViewTransform] = useState({
    scale: canvas?.zoom || 1,
    offsetX: canvas?.panX || 0,
    offsetY: canvas?.panY || 0,
  });

  // Use ref for immediate updates during interaction
  const viewTransformRef = useRef(viewTransform);
  viewTransformRef.current = viewTransform;

  // State to track panning
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panStartOffsetRef = useRef({ x: 0, y: 0 });
  const animationFrameRef = useRef<number | null>(null);
  
  // Drawing state
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastDrawPosRef = useRef<{ x: number, y: number } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const isDrawingRef = useRef(false); // Ref to track drawing state for event handlers
  const drawingCanvasHasContent = useRef(false); // Track if drawing canvas has content
  const drawAnimationFrameRef = useRef<number | null>(null); // For drawing animation frame
  
  // Selection state
  const [isSelecting, setIsSelecting] = useState(false);
  const selectionStartRef = useRef<{ x: number, y: number } | null>(null);
  const [marchingAntsOffset, setMarchingAntsOffset] = useState(0);
  
  // Cached composite canvas - only recreate when layers change
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastLayersHashRef = useRef<string>('');
  
  // Get brush engine
  const brushEngine = useBrushEngine();

  // --- Coordinate Conversion Helpers ---

  // Converts screen coordinates (e.g., mouse position) to world coordinates
  const screenToWorld = useCallback((x: number, y: number) => {
    const { offsetX, offsetY, scale } = viewTransform;
    return {
      x: (x - offsetX) / scale,
      y: (y - offsetY) / scale,
    };
  }, [viewTransform]);


  // --- Drawing Logic ---

  // Initialize drawing canvas based on project size
  const initDrawingCanvas = useCallback(() => {
    if (!drawingCanvasRef.current && project) {
      drawingCanvasRef.current = document.createElement('canvas');
      drawingCanvasRef.current.width = project.width;
      drawingCanvasRef.current.height = project.height;
      const ctx = drawingCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = false; // Ensure pixel-perfect drawing
        ctx.clearRect(0, 0, project.width, project.height);
      }
    } else if (drawingCanvasRef.current && project) {
      // Resize if project size changed
      if (drawingCanvasRef.current.width !== project.width || 
          drawingCanvasRef.current.height !== project.height) {
        drawingCanvasRef.current.width = project.width;
        drawingCanvasRef.current.height = project.height;
      }
    }
  }, [project]);

  // Helper function to sample color at a specific world position
  const sampleColorAtPosition = useCallback((x: number, y: number): string => {
    if (!compositeCanvasRef.current) return '#000000';
    
    const ctx = compositeCanvasRef.current.getContext('2d');
    if (!ctx) return '#000000';
    
    // Clamp coordinates to canvas bounds
    const clampedX = Math.max(0, Math.min(compositeCanvasRef.current.width - 1, Math.floor(x)));
    const clampedY = Math.max(0, Math.min(compositeCanvasRef.current.height - 1, Math.floor(y)));
    
    const imageData = ctx.getImageData(clampedX, clampedY, 1, 1);
    const [r, g, b] = imageData.data;
    
    // Convert to hex color
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }, []);

  // Helper function to sample N colors along a line
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

  // The draw function now takes the view transform as an argument.
  // All drawing operations are done in WORLD coordinates.
  const draw = useCallback((ctx: CanvasRenderingContext2D, transform: typeof viewTransform, skipDrawingCanvas = false) => {
    const { scale, offsetX, offsetY } = transform;

    // Clear the canvas with very dark grey background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw the layers from the project
    if (project && project.layers.length > 0) {
      // Generate a simple hash of layers to detect changes
      const layersHash = layers.map(l => `${l.id}_${l.visible}_${l.opacity}_${l.imageData?.data.length || 0}`).join('|');
      
      // Only recreate composite canvas if layers changed or it doesn't exist
      if (!compositeCanvasRef.current || 
          compositeCanvasRef.current.width !== project.width || 
          compositeCanvasRef.current.height !== project.height ||
          lastLayersHashRef.current !== layersHash) {
        
        // Create or resize composite canvas
        if (!compositeCanvasRef.current) {
          compositeCanvasRef.current = document.createElement('canvas');
        }
        compositeCanvasRef.current.width = project.width;
        compositeCanvasRef.current.height = project.height;
        
        // Ensure no smoothing on composite canvas
        const compCtx = compositeCanvasRef.current.getContext('2d');
        if (compCtx) {
          compCtx.imageSmoothingEnabled = false;
        }
        
        // Composite layers to cached canvas
        compositeLayersToCanvas(compositeCanvasRef.current);
        lastLayersHashRef.current = layersHash;
        
        // Update the currentOffscreenCanvas for custom brush creation
        setCurrentOffscreenCanvas(compositeCanvasRef.current);
      }
      
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      
      // Draw transparency checkerboard pattern inside canvas
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
      
      // Check if pixel brush is active to disable smoothing
      const isPixelBrush = tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND;
      
      // Set image smoothing based on brush type and zoom level
      ctx.imageSmoothingEnabled = !isPixelBrush && scale < 3;
      
      // Draw the cached composite result
      if (compositeCanvasRef.current) {
        ctx.drawImage(compositeCanvasRef.current, 0, 0);
      }
      
      // Draw the temporary drawing canvas on top if it has content
      if (!skipDrawingCanvas && drawingCanvasRef.current && (isDrawing || drawingCanvasHasContent.current)) {
        ctx.drawImage(drawingCanvasRef.current, 0, 0);
      }
      
      ctx.restore();
      
      // Draw canvas border to show edges
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 2 / scale; // Keep border consistent regardless of zoom
      ctx.strokeRect(0, 0, project.width, project.height);
      ctx.restore();
      
      // Draw selection rectangle if active
      if ((selectionStart && selectionEnd) || (isSelecting && selectionStartRef.current)) {
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        
        const start = selectionStart || selectionStartRef.current;
        const end = selectionEnd || { x: 0, y: 0 };
        
        if (start) {
          const x = Math.min(start.x, end.x);
          const y = Math.min(start.y, end.y);
          const width = Math.abs(end.x - start.x);
          const height = Math.abs(end.y - start.y);
          
          // Draw selection rectangle with marching ants effect (black and white)
          // First draw white background line
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1 / scale;
          ctx.setLineDash([]);
          ctx.strokeRect(x, y, width, height);
          
          // Then draw black dashed line on top
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1 / scale;
          ctx.setLineDash([5 / scale, 5 / scale]);
          ctx.lineDashOffset = -marchingAntsOffset / scale;
          ctx.strokeRect(x, y, width, height);
        }
        
        ctx.restore();
      }
    }
    
  }, [project, compositeLayersToCanvas, isDrawing, layers, tools.brushSettings.brushShape, setCurrentOffscreenCanvas, selectionStart, selectionEnd, isSelecting, marchingAntsOffset]);

  // --- Event Handlers for Pan and Zoom ---

  // Helper to get mouse position relative to the canvas element
  const getMousePos = useCallback((event: React.MouseEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const mousePos = getMousePos(event);
    
    // Check for panning: space + left click, middle mouse, or right mouse
    if (isSpacePressed || event.button === 1 || event.button === 2) {
      event.preventDefault();
      setIsPanning(true);
      // Store the starting position and current offset
      panStartRef.current = mousePos;
      panStartOffsetRef.current = { x: viewTransform.offsetX, y: viewTransform.offsetY };
      return;
    }
    
    // Left click for drawing or selection (only if space not pressed)
    if (event.button === 0 && !isSpacePressed) {
      const worldPos = screenToWorld(mousePos.x, mousePos.y);
      
      // Handle selection for both selection tool and custom brush tool
      if (tools.currentTool === 'selection' || tools.currentTool === 'custom') {
        setIsSelecting(true);
        selectionStartRef.current = worldPos;
        setSelectionBounds(worldPos, worldPos);
        return;
      }
      
      const brushShape = tools.brushSettings.brushShape;
      
      // Handle gradient brushes separately
      if (brushShape === BrushShape.RECTANGLE_GRADIENT) {
        // Sample the color at the starting position
        const startColor = sampleColorAtPosition(worldPos.x, worldPos.y);
        
        // Start rectangle gradient drawing
        setRectangleBrushState({
          drawingState: 'definingLength',
          startPos: { x: worldPos.x, y: worldPos.y },
          endPos: { x: worldPos.x, y: worldPos.y },
          startColor: startColor
        });
        setIsDrawing(true);
        isDrawingRef.current = true;
        return;
      } else if (brushShape === BrushShape.POLYGON_GRADIENT) {
        // Add point to polygon gradient
        const newPoints = [...polygonGradientState.points, {
          x: worldPos.x,
          y: worldPos.y,
          color: tools.brushSettings.color
        }];
        setPolygonGradientState({
          ...polygonGradientState,
          points: newPoints
        });
        setIsDrawing(true);
        isDrawingRef.current = true;
        return;
      }
      
      // Normal brush handling
      initDrawingCanvas();
      
      // Clear the drawing canvas for a fresh start
      if (drawingCanvasRef.current) {
        const clearCtx = drawingCanvasRef.current.getContext('2d');
        if (clearCtx) {
          clearCtx.imageSmoothingEnabled = false; // Ensure pixel-perfect drawing
          clearCtx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
        }
      }
      
      setIsDrawing(true);
      isDrawingRef.current = true; // Update ref for event handlers
      drawingCanvasHasContent.current = true; // Mark that we have content
      lastDrawPosRef.current = worldPos;
      
      // Get the drawing context from the active layer or drawing canvas
      const drawCtx = drawingCanvasRef.current?.getContext('2d');
      if (drawCtx && brushEngine && project) {
        // Reset brush state for new stroke to prevent connecting to previous stroke
        brushEngine.resetPixelQueue();
        
        // Clamp world position to project bounds
        const clampedPos = {
          x: Math.max(0, Math.min(project.width - 1, worldPos.x)),
          y: Math.max(0, Math.min(project.height - 1, worldPos.y))
        };
        
        // Draw initial point using the brush engine
        brushEngine.renderBrushStroke(
          drawCtx,
          clampedPos,
          clampedPos,
          { pressure: 1.0 }, // Default pressure for mouse
          activeBrushComponents
        );
      }
    }
  }, [getMousePos, screenToWorld, isSpacePressed, viewTransform, initDrawingCanvas, brushEngine, activeBrushComponents, project, tools.brushSettings.brushShape, tools.color, tools.currentTool, setRectangleBrushState, polygonGradientState, setPolygonGradientState, setSelectionBounds, sampleColorAtPosition]);

  const handleMouseUp = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setIsPanning(false);
      // Update state to match the ref (which has been updated during panning)
      setViewTransform(viewTransformRef.current);
      // Sync the final position to the store
      setPan(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
    }
    
    // Handle selection tool
    if (isSelecting) {
      setIsSelecting(false);
      const mousePos = getMousePos(event);
      const worldPos = screenToWorld(mousePos.x, mousePos.y);
      if (selectionStartRef.current) {
        setSelectionBounds(selectionStartRef.current, worldPos);
        
        // If using custom tool, immediately switch to brush tool for testing
        if (tools.currentTool === 'custom') {
          setCurrentTool('brush');
          // Clear the selection after creating the custom brush
          clearSelection();
        }
      }
      selectionStartRef.current = null;
    }
    
    // Special handling for rectangle gradient
    const brushShape = tools.brushSettings.brushShape;
    if (brushShape === BrushShape.RECTANGLE_GRADIENT && rectangleBrushState.drawingState !== 'idle') {
        if (rectangleBrushState.drawingState === 'definingLength') {
          // First mouse up: transition to defining width
          setRectangleBrushState({
            ...rectangleBrushState,
            drawingState: 'definingWidth'
          });
          // Keep drawing active to track width
          return;
        } else if (rectangleBrushState.drawingState === 'definingWidth') {
          // Second mouse up: actually draw the rectangle
          initDrawingCanvas();
          const drawCtx = drawingCanvasRef.current?.getContext('2d');
          
          if (drawCtx && brushEngine) {
            // Calculate width from mouse position perpendicular to the line
            const mousePos = getMousePos(event);
            const worldPos = screenToWorld(mousePos.x, mousePos.y);
            
            // Calculate the perpendicular distance for width
            const dx = rectangleBrushState.endPos.x - rectangleBrushState.startPos.x;
            const dy = rectangleBrushState.endPos.y - rectangleBrushState.startPos.y;
            const length = Math.hypot(dx, dy);
            
            if (length > 0) {
              // Calculate perpendicular distance from mouse to line
              const lineVecX = dx / length;
              const lineVecY = dy / length;
              const toMouseX = worldPos.x - rectangleBrushState.startPos.x;
              const toMouseY = worldPos.y - rectangleBrushState.startPos.y;
              const perpDist = Math.abs(-lineVecY * toMouseX + lineVecX * toMouseY);
              const width = perpDist * 2; // Full width is twice the perpendicular distance
              
              // Sample colors along the rectangle length based on the number of colors setting
              const numColors = tools.brushSettings.colors || 2;
              const sampledColors = sampleColorsAlongLine(
                rectangleBrushState.startPos.x,
                rectangleBrushState.startPos.y,
                rectangleBrushState.endPos.x,
                rectangleBrushState.endPos.y,
                numColors
              );
              
              // Draw the rectangle gradient with sampled colors
              brushEngine.drawRectangleGradient(
                drawCtx,
                {
                  startPos: rectangleBrushState.startPos,
                  endPos: rectangleBrushState.endPos,
                  width: width,
                  startColor: sampledColors[0] || tools.color,
                  endColor: sampledColors[sampledColors.length - 1] || tools.backgroundColor || tools.color,
                  colors: sampledColors,
                  ditherEnabled: tools.brushSettings.ditherEnabled,
                  ditherIntensity: tools.brushSettings.ditherIntensity
                },
                false // not preview
              );
              drawingCanvasHasContent.current = true;
            }
          }
          
          // Reset rectangle state
          setRectangleBrushState({
            drawingState: 'idle',
            startPos: { x: 0, y: 0 },
            endPos: { x: 0, y: 0 }
          });
          
          // Fall through to capture the drawing - DON'T RETURN
        }
    }
    
    if (isDrawingRef.current) {
      // Handle polygon gradient completion (e.g., on double-click or special key)
      if (brushShape === BrushShape.POLYGON_GRADIENT && polygonGradientState.points.length >= 3) {
        initDrawingCanvas();
        const drawCtx = drawingCanvasRef.current?.getContext('2d');
        
        if (drawCtx && brushEngine) {
          // Draw the polygon gradient with proper format
          brushEngine.drawPolygonGradient(
            drawCtx,
            {
              vertices: polygonGradientState.points.map(p => ({ x: p.x, y: p.y })),
              colors: polygonGradientState.points.map(p => p.color)
            },
            false // not preview
          );
          drawingCanvasHasContent.current = true;
        }
        
        // Reset polygon state
        setPolygonGradientState({
          points: [],
          isDrawing: false
        });
      }
      
      setIsDrawing(false);
      isDrawingRef.current = false; // Update ref
      lastDrawPosRef.current = null;
      
      // Capture the drawing to the active layer
      if (drawingCanvasRef.current && project) {
        const activeLayer = layers.find(l => l.id === activeLayerId) || layers[0];
        if (activeLayer) {
          // Create a temporary canvas with merged content
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = project.width;
          tempCanvas.height = project.height;
          const tempCtx = tempCanvas.getContext('2d');
          
          if (tempCtx) {
            // First draw the existing layer content
            tempCtx.putImageData(activeLayer.imageData, 0, 0);
            
            // Then composite the drawing on top
            tempCtx.drawImage(drawingCanvasRef.current, 0, 0);
            
            // Capture this merged canvas directly to the active layer
            // Note: captureCanvasToActiveLayer replaces the layer content entirely
            captureCanvasToActiveLayer(tempCanvas).then(() => {
              // Wait for next frame to ensure React has re-rendered with the updated layer
              requestAnimationFrame(() => {
                // Clear the drawing canvas itself
                const clearCtx = drawingCanvasRef.current?.getContext('2d');
                if (clearCtx) {
                  clearCtx.clearRect(0, 0, drawingCanvasRef.current!.width, drawingCanvasRef.current!.height);
                }
                // Now it's safe to stop showing the offscreen canvas
                drawingCanvasHasContent.current = false;
                
                // Invalidate the composite cache since we just updated a layer
                lastLayersHashRef.current = '';
                
                // Trigger a redraw to reflect the change
                const canvas = canvasRef.current;
                const ctx = canvas?.getContext('2d');
                if (ctx) {
                  draw(ctx, viewTransformRef.current);
                }
              });
            }).catch(err => {
              console.error('❌ Failed to capture layer:', err);
              drawingCanvasHasContent.current = false;
            });
          }
        }
      }
    }
  }, [isPanning, viewTransform, setPan, draw, captureCanvasToActiveLayer, project, layers, activeLayerId, tools, rectangleBrushState, setRectangleBrushState, polygonGradientState, setPolygonGradientState, brushEngine, initDrawingCanvas, isSelecting, getMousePos, screenToWorld, setSelectionBounds, sampleColorsAlongLine]);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    // Special case: rectangle gradient in definingWidth state needs mouse tracking even when not "drawing"
    const isDefiningWidth = tools.brushSettings.brushShape === BrushShape.RECTANGLE_GRADIENT && 
                           rectangleBrushState.drawingState === 'definingWidth';
    
    if (!isPanning && !isDrawing && !isSelecting && !isDefiningWidth) return;
    
    const currentMousePos = getMousePos(event);
    
    // Handle panning
    if (isPanning && panStartRef.current) {
      // Calculate total delta from start position
      const deltaX = currentMousePos.x - panStartRef.current.x;
      const deltaY = currentMousePos.y - panStartRef.current.y;

      // Update ref immediately for smooth rendering
      const newTransform = {
        scale: viewTransformRef.current.scale,
        offsetX: panStartOffsetRef.current.x + deltaX,
        offsetY: panStartOffsetRef.current.y + deltaY,
      };
      
      viewTransformRef.current = newTransform;
      
      // Cancel previous frame if exists
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      // Schedule redraw
      animationFrameRef.current = requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx) {
          draw(ctx, viewTransformRef.current);
        }
        // Don't update state during panning - only update ref
        // State will be updated on mouse up
      });
      return;
    }
    
    // Handle selection
    if (isSelecting) {
      const worldPos = screenToWorld(currentMousePos.x, currentMousePos.y);
      if (selectionStartRef.current) {
        setSelectionBounds(selectionStartRef.current, worldPos);
      }
      
      // Redraw to show selection
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx) {
        draw(ctx, viewTransformRef.current);
      }
      return;
    }
    
    // Handle drawing and rectangle width definition
    if ((isDrawing || isDefiningWidth) && project) {
      const worldPos = screenToWorld(currentMousePos.x, currentMousePos.y);
      const brushShape = tools.brushSettings.brushShape;
      
      // Handle rectangle gradient preview
      if (brushShape === BrushShape.RECTANGLE_GRADIENT) {
        // Only update endPos during length definition
        if (rectangleBrushState.drawingState === 'definingLength') {
          setRectangleBrushState({
            ...rectangleBrushState,
            endPos: { x: worldPos.x, y: worldPos.y }
          });
        }
        // During width definition, we just show preview without updating state
        
        // Draw preview
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx) {
          draw(ctx, viewTransformRef.current);
          
          // Calculate rectangle geometry for preview
          // Use different endpoints based on state
          const endX = rectangleBrushState.drawingState === 'definingWidth' ? rectangleBrushState.endPos.x : worldPos.x;
          const endY = rectangleBrushState.drawingState === 'definingWidth' ? rectangleBrushState.endPos.y : worldPos.y;
          
          const dx = endX - rectangleBrushState.startPos.x;
          const dy = endY - rectangleBrushState.startPos.y;
          const length = Math.hypot(dx, dy);
          
          if (length > 0) {
            // Different preview based on current state
            let previewWidth = 2; // Default thin line for length definition
            
            if (rectangleBrushState.drawingState === 'definingWidth') {
              // Calculate perpendicular distance from mouse to line for width preview
              const lineVecX = dx / length;
              const lineVecY = dy / length;
              const toMouseX = worldPos.x - rectangleBrushState.startPos.x;
              const toMouseY = worldPos.y - rectangleBrushState.startPos.y;
              const perpDist = Math.abs(-lineVecY * toMouseX + lineVecX * toMouseY);
              previewWidth = perpDist * 2;
            }
            
            // Calculate perpendicular vector for width
            const perpX = -dy / length * (previewWidth / 2);
            const perpY = dx / length * (previewWidth / 2);
            
            // Rectangle corners
            const corners = [
              { x: rectangleBrushState.startPos.x + perpX, y: rectangleBrushState.startPos.y + perpY },
              { x: rectangleBrushState.startPos.x - perpX, y: rectangleBrushState.startPos.y - perpY },
              { x: endX - perpX, y: endY - perpY },
              { x: endX + perpX, y: endY + perpY }
            ];
            
            // Draw FULL rectangle preview with gradient
            ctx.save();
            ctx.translate(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
            ctx.scale(viewTransformRef.current.scale, viewTransformRef.current.scale);
            
            // Use actual brush opacity for preview
            ctx.globalAlpha = tools.brushSettings.opacity || 1;
            ctx.globalCompositeOperation = tools.currentTool === 'eraser' ? 'destination-out' : (tools.brushSettings.blendMode || 'source-over');
            
            // Sample colors for preview
            const numColors = tools.brushSettings.colors || 2;
            const sampledColors = sampleColorsAlongLine(
              rectangleBrushState.startPos.x,
              rectangleBrushState.startPos.y,
              endX,
              endY,
              numColors
            );
            
            // Create gradient for preview
            const gradient = ctx.createLinearGradient(
              rectangleBrushState.startPos.x,
              rectangleBrushState.startPos.y,
              endX,
              endY
            );
            
            // Add color stops from sampled colors
            if (sampledColors.length > 0) {
              sampledColors.forEach((color, index) => {
                const position = sampledColors.length === 1 ? 0 : index / (sampledColors.length - 1);
                gradient.addColorStop(position, color);
              });
            } else {
              // Fallback to brush color if no samples
              gradient.addColorStop(0, tools.brushSettings.color);
              gradient.addColorStop(1, tools.brushSettings.color);
            }
            
            // Fill the rectangle with gradient
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.moveTo(corners[0].x, corners[0].y);
            corners.slice(1).forEach(corner => ctx.lineTo(corner.x, corner.y));
            ctx.closePath();
            ctx.fill();
            
            ctx.restore();
          }
        }
        return;
      }
      
      // Handle polygon gradient preview (just visual feedback)
      if (brushShape === BrushShape.POLYGON_GRADIENT) {
        // Could draw preview lines here if needed
        return;
      }
      
      // Exit early if we're just tracking width for rectangle gradient
      if (isDefiningWidth) {
        return;
      }
      
      // Normal brush drawing
      if (!lastDrawPosRef.current) return;
      
      // Clamp positions to project bounds
      const clampedPos = {
        x: Math.max(0, Math.min(project.width - 1, worldPos.x)),
        y: Math.max(0, Math.min(project.height - 1, worldPos.y))
      };
      
      const clampedLastPos = {
        x: Math.max(0, Math.min(project.width - 1, lastDrawPosRef.current.x)),
        y: Math.max(0, Math.min(project.height - 1, lastDrawPosRef.current.y))
      };
      
      // Draw using the brush engine
      const drawCtx = drawingCanvasRef.current?.getContext('2d');
      if (drawCtx && brushEngine) {
        brushEngine.renderBrushStroke(
          drawCtx,
          clampedLastPos,
          clampedPos,
          { pressure: 1.0 }, // Default pressure for mouse
          activeBrushComponents
        );
        
        lastDrawPosRef.current = worldPos; // Keep unclamp for smooth tracking
        
        // Cancel previous draw frame if exists
        if (drawAnimationFrameRef.current) {
          cancelAnimationFrame(drawAnimationFrameRef.current);
        }
        
        // Schedule a single redraw per frame
        drawAnimationFrameRef.current = requestAnimationFrame(() => {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (ctx) {
            draw(ctx, viewTransformRef.current);
          }
          drawAnimationFrameRef.current = null;
        });
      }
    }
  }, [getMousePos, isPanning, isDrawing, isSelecting, screenToWorld, draw, brushEngine, activeBrushComponents, project, tools, rectangleBrushState, setRectangleBrushState, setSelectionBounds, sampleColorsAlongLine]);

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    const canvas = canvasRef.current;
    if (!rect || !canvas) return;
    
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const scrollSensitivity = 0.001;
    const zoomFactor = 1 - event.deltaY * scrollSensitivity;
    const newScale = Math.max(0.1, Math.min(viewTransformRef.current.scale * zoomFactor, 10));
    
    // Calculate the world position under the mouse before zoom
    const worldX = (mouseX - viewTransformRef.current.offsetX) / viewTransformRef.current.scale;
    const worldY = (mouseY - viewTransformRef.current.offsetY) / viewTransformRef.current.scale;
    
    // Calculate new offset to keep the world position under the mouse
    const newOffsetX = mouseX - worldX * newScale;
    const newOffsetY = mouseY - worldY * newScale;
    
    // Update ref immediately for smooth rendering
    viewTransformRef.current = {
      scale: newScale,
      offsetX: newOffsetX,
      offsetY: newOffsetY,
    };
    
    // Draw immediately with the new transform
    const ctx = canvas.getContext('2d');
    if (ctx) {
      draw(ctx, viewTransformRef.current);
    }
    
    // Update state and store (won't cause redraw since we removed the effect)
    setViewTransform(viewTransformRef.current);
    setZoom(newScale);
    setPan(newOffsetX, newOffsetY);
  }, [setZoom, setPan, draw]);

  // --- Effects ---
  
  // Animate marching ants for selection
  useEffect(() => {
    let animationId: number;
    let frameCount = 0;
    
    if (selectionStart && selectionEnd) {
      const animate = () => {
        frameCount++;
        // Only update every 3 frames to slow down animation
        if (frameCount % 3 === 0) {
          setMarchingAntsOffset(prev => (prev + 1) % 10);
          
          // Redraw canvas with new offset
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (ctx) {
            draw(ctx, viewTransformRef.current);
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
  }, [selectionStart, selectionEnd, draw]);

  // Handle keyboard events for space key and wheel events
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault();
        setIsSpacePressed(true);
      } else if (event.key === 'c' || event.key === 'C') {
        // C key to activate custom brush tool for area selection
        event.preventDefault();
        setCurrentTool('custom');
      } else if (event.key === '[') {
        // [ key to decrease brush size
        event.preventDefault();
        const store = useAppStore.getState();
        const currentSize = store.tools.brushSettings.size;
        const newSize = Math.max(1, currentSize - 5);
        store.setBrushSettings({ size: newSize });
      } else if (event.key === ']') {
        // ] key to increase brush size
        event.preventDefault();
        const store = useAppStore.getState();
        const currentSize = store.tools.brushSettings.size;
        const newSize = Math.min(500, currentSize + 5);
        store.setBrushSettings({ size: newSize });
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        setIsSpacePressed(false);
        setIsPanning(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Add wheel event listener with passive: false
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (canvas) {
        canvas.removeEventListener('wheel', handleWheel);
      }
    };
  }, [handleWheel, setCurrentTool]);

  // Initialize view transform from store on mount only
  useEffect(() => {
    if (canvas) {
      setViewTransform({
        scale: canvas.zoom,
        offsetX: canvas.panX,
        offsetY: canvas.panY,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty - only run on mount
  
  // Redraw when layers change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Only redraw if we're not currently drawing or panning
    if (!isDrawingRef.current && !isPanning) {
      draw(ctx, viewTransformRef.current);
    }
  }, [layers, draw, isPanning]);

  // This effect only handles canvas resizing, not redrawing
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set up a resize observer to handle canvas resizing
    const resizeObserver = new ResizeObserver(entries => {
      window.requestAnimationFrame(() => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        canvas.width = width;
        canvas.height = height;
        
        // Update canvas size in store
        setCanvasDimensions(width, height);
        
        // Redraw with the current transform after resizing
        draw(ctx, viewTransformRef.current);
      });
    });
    resizeObserver.observe(wrapper);

    // Initial size setup
    const { width, height } = wrapper.getBoundingClientRect();
    canvas.width = width;
    canvas.height = height;
    setCanvasDimensions(width, height);
    
    // Initial draw
    draw(ctx, viewTransformRef.current);

    // Cleanup: disconnect the observer when the component unmounts
    return () => resizeObserver.disconnect();
  }, [draw, setCanvasDimensions]);

  // Determine cursor style
  const getCursorStyle = () => {
    if (isPanning) return 'grabbing';
    if (isSpacePressed) return 'grab';
    if (isDrawing) return 'crosshair';
    return 'crosshair';
  };

  return (
    <div
      ref={wrapperRef}
      className="w-full h-full relative"
      style={{ 
        overflow: 'hidden', 
        backgroundColor: '#2a2a2a',
        cursor: getCursorStyle()
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseUp} // Stop panning/drawing if mouse leaves canvas
        onContextMenu={(e) => e.preventDefault()} // Prevent context menu
        style={{ 
          display: 'block', 
          width: '100%', 
          height: '100%',
          imageRendering: viewTransform.scale > 3 ? 'pixelated' : 'auto'
        }}
      />
      
      {/* Zoom indicator */}
      <div className="absolute bottom-4 right-4 bg-black/50 text-white px-2 py-1 rounded text-sm">
        {Math.round(viewTransform.scale * 100)}%
      </div>
    </div>
  );
};

export default React.memo(DrawingCanvas);