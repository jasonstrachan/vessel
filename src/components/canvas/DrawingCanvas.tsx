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
    clearSelection,
    updateLayer,
    undo,
    redo,
    saveCanvasState
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
  const isCapturing = useRef(false); // Track if we're in the middle of capturing to prevent premature redraws
  
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
    if (!compositeCanvasRef.current) return 'rgb(0, 0, 0)';
    
    const ctx = compositeCanvasRef.current.getContext('2d');
    if (!ctx) return 'rgb(0, 0, 0)';
    
    // Clamp coordinates to canvas bounds
    const clampedX = Math.max(0, Math.min(compositeCanvasRef.current.width - 1, Math.floor(x)));
    const clampedY = Math.max(0, Math.min(compositeCanvasRef.current.height - 1, Math.floor(y)));
    
    const imageData = ctx.getImageData(clampedX, clampedY, 1, 1);
    let [r, g, b, a] = imageData.data;
    
    // If transparent or nearly transparent, return the current canvas background color (white)
    if (a < 10) return 'rgb(255, 255, 255)';
    
    // Snap very dark colors to pure black (threshold of 30)
    if (r <= 30 && g <= 30 && b <= 30) {
      r = 0;
      g = 0; 
      b = 0;
    }
    // Snap very light colors to pure white (threshold of 225)
    else if (r >= 225 && g >= 225 && b >= 225) {
      r = 255;
      g = 255;
      b = 255;
    }
    
    // Return RGB format for proper gradient rendering
    return `rgb(${r}, ${g}, ${b})`;
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
    
    // Handle panning first
    if (isSpacePressed || event.button === 1 || event.button === 2) {
      event.preventDefault();
      setIsPanning(true);
      panStartRef.current = mousePos;
      panStartOffsetRef.current = { x: viewTransform.offsetX, y: viewTransform.offsetY };
      return;
    }
    
    // Handle left click
    if (event.button === 0 && !isSpacePressed) {
      // --- FIX: Check the tool's state BEFORE doing anything else ---
      const brushShape = tools.brushSettings.brushShape;
      const currentRectState = useAppStore.getState().rectangleBrushState;

      // If we are in the middle of defining the width, this mousedown should do nothing.
      // The subsequent `mouseup` event will handle the finalization.
      if (brushShape === BrushShape.RECTANGLE_GRADIENT && currentRectState.drawingState === 'definingWidth') {
        event.preventDefault();
        return; // <-- This return is the entire fix.
      }
      // --- End of Fix ---

      const worldPos = screenToWorld(mousePos.x, mousePos.y);
      
      // Handle selection tool
      if (tools.currentTool === 'selection' || tools.currentTool === 'custom') {
        setIsSelecting(true);
        selectionStartRef.current = worldPos;
        setSelectionBounds(worldPos, worldPos);
        return;
      }
      
      // Handle starting a NEW rectangle gradient
      if (brushShape === BrushShape.RECTANGLE_GRADIENT) {
        const startColor = sampleColorAtPosition(worldPos.x, worldPos.y);
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
        // Start polygon gradient drawing - first point
        const startColor = sampleColorAtPosition(worldPos.x, worldPos.y);
        
        const newState = {
          drawingState: 'drawing' as const,
          points: [{
            x: worldPos.x,
            y: worldPos.y,
            color: startColor
          }]
        };
        
        
        setPolygonGradientState(newState);
        setIsDrawing(true);
        isDrawingRef.current = true;
        lastDrawPosRef.current = null; // Clear this to prevent normal brush drawing
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
    if (brushShape === BrushShape.RECTANGLE_GRADIENT) { // Check for the tool first
        
        // --- FIX: Get fresh state from the store ---
        const currentRectState = useAppStore.getState().rectangleBrushState;

        if (currentRectState.drawingState === 'definingLength') {
          
          // --- FIX: Transition state AND explicitly stop the "drawing" mode ---
          setRectangleBrushState({
            ...currentRectState,
            drawingState: 'definingWidth'
          });
          // This is the key change: we are no longer "drawing" with the mouse down.
          setIsDrawing(false);
          isDrawingRef.current = false; 
          return; // Exit to prevent other logic from running
        } else if (currentRectState.drawingState === 'definingWidth') {
          
          
          // Second mouse up: actually draw the rectangle
          initDrawingCanvas();
          const drawCtx = drawingCanvasRef.current?.getContext('2d');
          
          
          if (drawCtx && brushEngine) {
            // Check if we have valid start and end positions
            if (!currentRectState.startPos || !currentRectState.endPos) {
              console.log('⚠️ [RECT DEBUG] Missing start or end position, resetting state');
              setRectangleBrushState({ isDrawing: false, startPos: null, endPos: null, drawingState: 'idle' });
              return;
            }
            
            // Calculate width from mouse position perpendicular to the line
            const mousePos = getMousePos(event);
            const worldPos = screenToWorld(mousePos.x, mousePos.y);
            
            // Calculate the perpendicular distance for width
            const dx = currentRectState.endPos.x - currentRectState.startPos.x;
            const dy = currentRectState.endPos.y - currentRectState.startPos.y;
            const length = Math.hypot(dx, dy);
            
            console.log('🔍 [RECT DEBUG] Rectangle dimensions:', {
              dx, dy, length,
              startPos: currentRectState.startPos,
              endPos: currentRectState.endPos
            });
            
            if (length > 0) {
              console.log('✅ [RECT DEBUG] Length check passed, proceeding with drawing');
              // Calculate perpendicular distance from mouse to line
              const lineVecX = dx / length;
              const lineVecY = dy / length;
              const toMouseX = worldPos.x - currentRectState.startPos.x;
              const toMouseY = worldPos.y - currentRectState.startPos.y;
              const perpDist = Math.abs(-lineVecY * toMouseX + lineVecX * toMouseY);
              const width = perpDist * 2; // Full width is twice the perpendicular distance
              
              // Sample colors along the rectangle length based on the number of colors setting
              const numColors = tools.brushSettings.colors || 2;
              const sampledColors = sampleColorsAlongLine(
                currentRectState.startPos.x,
                currentRectState.startPos.y,
                currentRectState.endPos.x,
                currentRectState.endPos.y,
                numColors
              );
              
              console.log('🎨 [RECT DEBUG] Drawing rectangle with parameters:', {
                startPos: currentRectState.startPos,
                endPos: currentRectState.endPos,
                width,
                length,
                numColors,
                sampledColors,
                drawingCanvasHasContent: drawingCanvasHasContent.current,
                isCapturing: isCapturing.current
              });
              
              // Draw the rectangle gradient with sampled colors
              brushEngine.drawRectangleGradient(
                drawCtx,
                {
                  startPos: currentRectState.startPos,
                  endPos: currentRectState.endPos,
                  width: width,
                  startColor: sampledColors[0] || tools.color,
                  endColor: sampledColors[sampledColors.length - 1] || tools.backgroundColor || tools.color,
                  colors: sampledColors,
                  ditherEnabled: tools.brushSettings.ditherEnabled,
                  ditherIntensity: tools.brushSettings.ditherIntensity
                },
                false // not preview
              );
              
              console.log('✅ [RECT DEBUG] Rectangle drawn to drawingCanvas, setting flags:', {
                drawingCanvasHasContentBefore: drawingCanvasHasContent.current,
                isCapturingBefore: isCapturing.current
              });
              
              drawingCanvasHasContent.current = true; // Set this first to trigger layers effect redraw
              isCapturing.current = true; // Set this after to prevent further layers effect redraws
              
              console.log('🔧 [RECT DEBUG] Flags after setting:', {
                drawingCanvasHasContentAfter: drawingCanvasHasContent.current,
                isCapturingAfter: isCapturing.current
              });
            } else {
              console.log('⚠️ [RECT DEBUG] Rectangle too small to draw, resetting state:', {
                dx,
                dy,
                length,
                startPos: currentRectState.startPos,
                endPos: currentRectState.endPos
              });
              // Reset state for rectangles that are too small
              setRectangleBrushState({ isDrawing: false, startPos: null, endPos: null, drawingState: 'idle' });
            }
          } else {
            console.error('❌ [RECT DEBUG] Missing drawCtx or brushEngine:', {
              drawCtx: !!drawCtx,
              brushEngine: !!brushEngine
            });
          }
          
          // Reset rectangle state
          setRectangleBrushState({
            drawingState: 'idle',
            startPos: { x: 0, y: 0 },
            endPos: { x: 0, y: 0 }
          });
          
          // Keep isDrawingRef true until capture completes to prevent premature redraws
          // This prevents the layers effect from triggering a redraw while capture is in progress
          
          console.log('🚀 [RECT DEBUG] Starting capture process:', {
            hasDrawingCanvas: !!drawingCanvasRef.current,
            hasProject: !!project,
            drawingCanvasHasContent: drawingCanvasHasContent.current,
            activeLayerId,
            layersCount: layers.length
          });
          
          // Need to manually handle capture for rectangle gradient
          // Since we don't use the normal isDrawing flow
          if (drawingCanvasRef.current && project && drawingCanvasHasContent.current) {
            const activeLayer = layers.find(l => l.id === activeLayerId) || layers[0];
            if (activeLayer) {
              console.log('🔄 [RECT DEBUG] Creating temp canvas for capture:', {
                activeLayerHasImageData: !!activeLayer.imageData,
                projectDimensions: { width: project.width, height: project.height }
              });
              
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
                
                console.log('📡 [RECT DEBUG] About to capture to layer...');
                
                // Capture this merged canvas directly to the active layer
                captureCanvasToActiveLayer(tempCanvas).then(() => {
                  console.log('✅ [RECT DEBUG] Capture completed successfully, cleaning up...');
                  
                  // Save state for undo/redo after capturing
                  if (tempCanvas) {
                    saveCanvasState(tempCanvas, 'brush', 'Rectangle brush stroke');
                  }
                  
                  // Wait for next frame to ensure React has re-rendered with the updated layer
                  requestAnimationFrame(() => {
                    console.log('🧹 [RECT DEBUG] Cleaning drawing canvas and resetting flags...');
                    
                    // Clear the drawing canvas itself
                    const clearCtx = drawingCanvasRef.current?.getContext('2d');
                    if (clearCtx) {
                      clearCtx.clearRect(0, 0, drawingCanvasRef.current!.width, drawingCanvasRef.current!.height);
                      console.log('🗑️ [RECT DEBUG] Drawing canvas cleared');
                    }
                    
                    // Now it's safe to stop showing the offscreen canvas and allow redraws
                    console.log('🏁 [RECT DEBUG] Resetting flags:', {
                      drawingCanvasHasContentBefore: drawingCanvasHasContent.current,
                      isDrawingRefBefore: isDrawingRef.current,
                      isCapturingBefore: isCapturing.current
                    });
                    
                    drawingCanvasHasContent.current = false;
                    isDrawingRef.current = false; // NOW it's safe to set this to false
                    isCapturing.current = false; // Clear capturing flag
                    
                    console.log('🏁 [RECT DEBUG] Flags reset:', {
                      drawingCanvasHasContentAfter: drawingCanvasHasContent.current,
                      isDrawingRefAfter: isDrawingRef.current,
                      isCapturingAfter: isCapturing.current
                    });
                    
                    // Invalidate the composite cache since we just updated a layer
                    lastLayersHashRef.current = '';
                    
                    console.log('🎨 [RECT DEBUG] Triggering final redraw...');
                    
                    // Trigger a redraw to reflect the change
                    const canvas = canvasRef.current;
                    const ctx = canvas?.getContext('2d');
                    if (ctx) {
                      draw(ctx, viewTransformRef.current);
                    }
                  });
                }).catch(err => {
                  console.error('❌ [RECT DEBUG] Failed to capture rectangle:', err);
                  drawingCanvasHasContent.current = false;
                  isDrawingRef.current = false; // Also clear in error case
                  isCapturing.current = false; // Also clear capturing flag in error case
                });
              }
            }
          }
          return; // Exit after handling rectangle
        }
    }
    
    if (isDrawingRef.current) {
      // Skip normal capture flow for rectangle gradients - they handle it themselves
      if (brushShape === BrushShape.RECTANGLE_GRADIENT) {
        return;
      }
      
      // FIX: Get fresh polygon state to avoid stale closure
      const currentPolygonState = useAppStore.getState().polygonGradientState;
      
      // Handle polygon gradient completion
      if (brushShape === BrushShape.POLYGON_GRADIENT && currentPolygonState.drawingState === 'drawing') {
        
        if (currentPolygonState.points.length >= 3) {
          initDrawingCanvas();
          const drawCtx = drawingCanvasRef.current?.getContext('2d');
          
          if (drawCtx && brushEngine) {
            
            // Use fresh state to get the points and colors
            brushEngine.drawPolygonGradient(
              drawCtx,
              {
                vertices: currentPolygonState.points.map(p => ({ x: p.x, y: p.y })),
                colors: currentPolygonState.points.map(p => p.color)
              },
              false // not preview
            );
            drawingCanvasHasContent.current = true;
          }
        }
        
        // Always reset polygon state when releasing mouse, regardless of point count
        setPolygonGradientState({
          drawingState: 'idle',
          points: []
        });
      }
      
      setIsDrawing(false);
      isDrawingRef.current = false; // Update ref
      lastDrawPosRef.current = null;
      
      // Capture the drawing to the active layer
      if (drawingCanvasRef.current && project) {
        isCapturing.current = true;
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
              // Save state for undo/redo after capturing
              if (tempCanvas) {
                saveCanvasState(tempCanvas, 'brush', 'Drawing stroke');
              }
              // Wait for next frame to ensure React has re-rendered with the updated layer
              requestAnimationFrame(() => {
                // Clear the drawing canvas itself
                const clearCtx = drawingCanvasRef.current?.getContext('2d');
                if (clearCtx) {
                  clearCtx.clearRect(0, 0, drawingCanvasRef.current!.width, drawingCanvasRef.current!.height);
                }
                // Now it's safe to stop showing the offscreen canvas
                drawingCanvasHasContent.current = false;
                isCapturing.current = false; // Clear capturing flag
                
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
              isCapturing.current = false; // Also clear capturing flag in error case
            });
          }
        }
      }
    }
  }, [isPanning, viewTransform, setPan, draw, captureCanvasToActiveLayer, project, layers, activeLayerId, tools, rectangleBrushState, setRectangleBrushState, polygonGradientState, setPolygonGradientState, brushEngine, initDrawingCanvas, isSelecting, getMousePos, screenToWorld, setSelectionBounds, sampleColorsAlongLine, saveCanvasState]);

  const handleMouseLeave = useCallback(() => {
    // Only handle panning and normal drawing on mouse leave
    // Do NOT finalize polygon or rectangle gradients as the user might just be moving fast
    if (isPanning) {
      setIsPanning(false);
      setViewTransform(viewTransformRef.current);
      setPan(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
    }
    
    // Only stop normal drawing, not gradient tools
    const brushShape = tools.brushSettings.brushShape;
    if (isDrawingRef.current && 
        brushShape !== BrushShape.POLYGON_GRADIENT && 
        brushShape !== BrushShape.RECTANGLE_GRADIENT) {
      setIsDrawing(false);
      isDrawingRef.current = false;
      lastDrawPosRef.current = null;
    }
  }, [isPanning, setPan, tools.brushSettings.brushShape]);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const currentMousePos = getMousePos(event);
    const worldPos = screenToWorld(currentMousePos.x, currentMousePos.y);

    // --- REFACTORED LOGIC ---
    // Check for and handle the 'definingWidth' state separately and first.
    // This allows the width preview to work even when the mouse is not down.
    const currentRectState = useAppStore.getState().rectangleBrushState;
    if (tools.brushSettings.brushShape === BrushShape.RECTANGLE_GRADIENT && currentRectState.drawingState === 'definingWidth') {
      // All the preview drawing logic for width definition
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx) {
        draw(ctx, viewTransformRef.current); // Redraw base
        
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
      return; // Exit after handling width preview
    }
    
    // Check if we're in polygon gradient drawing state
    const isPolygonDrawing = tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT && 
                             polygonGradientState.drawingState === 'drawing';
    
    // --- Standard mouse move logic for panning, selecting, and drawing ---
    // Early return if nothing requires mouse move handling
    if (!isPanning && !isDrawingRef.current && !isSelecting && !isPolygonDrawing) {
      return;
    }
    
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
    
    // Handle all "mouse is down" drawing (including rectangle length)
    if (isDrawingRef.current && project) {
      const brushShape = tools.brushSettings.brushShape;
      
      // The logic for defining the rectangle's LENGTH still happens here
      if (brushShape === BrushShape.RECTANGLE_GRADIENT) {
        const currentRectState = useAppStore.getState().rectangleBrushState;
        
        if (currentRectState.drawingState === 'definingLength') {
          // Update endPos during length definition
          const newState = {
            ...currentRectState,
            endPos: { x: worldPos.x, y: worldPos.y }
          };
          setRectangleBrushState(newState);
          
          // Draw preview for length definition
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (ctx) {
            draw(ctx, viewTransformRef.current);
            
            // For length definition, show a thin line preview
            const endX = worldPos.x;
            const endY = worldPos.y;
            
            const dx = endX - currentRectState.startPos.x;
            const dy = endY - currentRectState.startPos.y;
            const length = Math.hypot(dx, dy);
            
            if (length > 0) {
              // Thin line preview for length definition
              const previewWidth = 2;
              
              // Calculate perpendicular vector for width
              const perpX = -dy / length * (previewWidth / 2);
              const perpY = dx / length * (previewWidth / 2);
              
              // Rectangle corners
              const corners = [
                { x: currentRectState.startPos.x + perpX, y: currentRectState.startPos.y + perpY },
                { x: currentRectState.startPos.x - perpX, y: currentRectState.startPos.y - perpY },
                { x: endX - perpX, y: endY - perpY },
                { x: endX + perpX, y: endY + perpY }
              ];
              
              // Draw thin line preview
              ctx.save();
              ctx.translate(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
              ctx.scale(viewTransformRef.current.scale, viewTransformRef.current.scale);
              
              // Simple line for length preview
              ctx.strokeStyle = tools.brushSettings.color;
              ctx.lineWidth = 2 / viewTransformRef.current.scale;
              ctx.beginPath();
              ctx.moveTo(currentRectState.startPos.x, currentRectState.startPos.y);
              ctx.lineTo(endX, endY);
              ctx.stroke();
              
              ctx.restore();
            }
          }
        }
        return;
      }
      
      // The logic for the polygon gradient brush still happens here
      if (brushShape === BrushShape.POLYGON_GRADIENT) {
        // FIX: Get the LATEST state directly from the store
        const currentPolygonState = useAppStore.getState().polygonGradientState;
        
        // Now check the drawingState using the fresh state
        if (currentPolygonState.drawingState === 'drawing') {
          
          // Use currentPolygonState for all logic from here
          const lastPoint = currentPolygonState.points[currentPolygonState.points.length - 1];
          if (lastPoint) {
            const distance = Math.hypot(worldPos.x - lastPoint.x, worldPos.y - lastPoint.y);
            const minSpacing = 5; // Minimum spacing between points for higher resolution
            
            if (distance >= minSpacing) {
              const newColor = sampleColorAtPosition(worldPos.x, worldPos.y);
              const newPoints = [...currentPolygonState.points, {
                x: worldPos.x,
                y: worldPos.y,
                color: newColor
              }];
              
              
              // Update the state with new points
              setPolygonGradientState({
                drawingState: 'drawing',
                points: newPoints
              });
            }
          }
          
          // Update preview logic to use fresh state
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          // Use currentPolygonState for the check and rendering
          if (ctx && currentPolygonState.points.length > 0) {
            draw(ctx, viewTransformRef.current);
            
            ctx.save();
            // Disable anti-aliasing for pixel-perfect polygon
            ctx.imageSmoothingEnabled = false;
            ctx.translate(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
            ctx.scale(viewTransformRef.current.scale, viewTransformRef.current.scale);
            
            // Use currentPolygonState to build preview vertices
            const previewVertices = [
              ...currentPolygonState.points.map(p => ({ x: p.x, y: p.y })),
              { x: worldPos.x, y: worldPos.y }
            ];
            
            if (previewVertices.length >= 3) {
              // Calculate bounds for better gradient
              const minX = Math.min(...previewVertices.map(v => v.x));
              const minY = Math.min(...previewVertices.map(v => v.y));
              const maxX = Math.max(...previewVertices.map(v => v.x));
              const maxY = Math.max(...previewVertices.map(v => v.y));
              const width = maxX - minX;
              const height = maxY - minY;
              
              // Choose gradient direction based on polygon shape
              let gradient;
              if (width > height) {
                // Horizontal gradient for wide polygons
                gradient = ctx.createLinearGradient(minX, (minY + maxY) / 2, maxX, (minY + maxY) / 2);
              } else {
                // Vertical gradient for tall polygons
                gradient = ctx.createLinearGradient((minX + maxX) / 2, minY, (minX + maxX) / 2, maxY);
              }
              
              // Use currentPolygonState to build preview colors
              const previewColors = [
                ...currentPolygonState.points.map(p => p.color),
                sampleColorAtPosition(worldPos.x, worldPos.y)
              ];
              
              // Match the gradient logic from useBrushEngine.ts
              // For smoother gradients, use key colors instead of all points
              if (previewColors.length >= 3) {
                // Use first color, a middle color, and last color for smooth gradient
                gradient.addColorStop(0, previewColors[0]);
                gradient.addColorStop(0.5, previewColors[Math.floor(previewColors.length / 2)]);
                gradient.addColorStop(1, previewColors[previewColors.length - 1]);
              } else if (previewColors.length === 2) {
                // Two colors - simple gradient
                gradient.addColorStop(0, previewColors[0]);
                gradient.addColorStop(1, previewColors[1]);
              } else if (previewColors.length === 1) {
                // Single color - solid fill
                gradient.addColorStop(0, previewColors[0]);
                gradient.addColorStop(1, previewColors[0]);
              }
              
              // Draw filled polygon preview with full opacity and no outline
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
          return; // This return is crucial to prevent falling through to normal drawing logic
        }
        // Also return if polygon brush is selected but not drawing to prevent normal brush
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
  }, [getMousePos, isPanning, isSelecting, screenToWorld, draw, brushEngine, activeBrushComponents, project, tools, setRectangleBrushState, setSelectionBounds, sampleColorsAlongLine, polygonGradientState, setPolygonGradientState, sampleColorAtPosition]);

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
      // Handle Undo (Ctrl+Z / Cmd+Z)
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        const snapshot = undo();
        if (snapshot) {
          // Apply the restored snapshot to the active layer
          const activeLayer = layers.find(l => l.id === activeLayerId);
          if (activeLayer && snapshot.imageData) {
            updateLayer(activeLayer.id, { imageData: snapshot.imageData });
            // Force redraw
            lastLayersHashRef.current = '';
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (ctx) {
              draw(ctx, viewTransformRef.current);
            }
          }
        }
      } 
      // Handle Redo (Ctrl+Shift+Z / Cmd+Shift+Z)
      else if ((event.ctrlKey || event.metaKey) && event.key === 'z' && event.shiftKey) {
        event.preventDefault();
        const snapshot = redo();
        if (snapshot) {
          // Apply the restored snapshot to the active layer
          const activeLayer = layers.find(l => l.id === activeLayerId);
          if (activeLayer && snapshot.imageData) {
            updateLayer(activeLayer.id, { imageData: snapshot.imageData });
            // Force redraw
            lastLayersHashRef.current = '';
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (ctx) {
              draw(ctx, viewTransformRef.current);
            }
          }
        }
      } 
      else if (event.code === 'Space' && !event.repeat) {
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
      } else if ((event.key === 'Enter' || event.key === 'Escape') && 
                 tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT && 
                 polygonGradientState.points.length >= 3) {
        // Complete polygon gradient on Enter, cancel on Escape
        event.preventDefault();
        
        if (event.key === 'Enter') {
          // Complete the polygon
          initDrawingCanvas();
          const drawCtx = drawingCanvasRef.current?.getContext('2d');
          
          if (drawCtx && brushEngine) {
            brushEngine.drawPolygonGradient(
              drawCtx,
              {
                vertices: polygonGradientState.points.map(p => ({ x: p.x, y: p.y })),
                colors: polygonGradientState.points.map(p => p.color)
              },
              false
            );
            drawingCanvasHasContent.current = true;
            
            // Capture to layer
            if (drawingCanvasRef.current && project) {
              const activeLayer = layers.find(l => l.id === activeLayerId) || layers[0];
              if (activeLayer) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = project.width;
                tempCanvas.height = project.height;
                const tempCtx = tempCanvas.getContext('2d');
                
                if (tempCtx) {
                  tempCtx.putImageData(activeLayer.imageData, 0, 0);
                  tempCtx.drawImage(drawingCanvasRef.current, 0, 0);
                  
                  captureCanvasToActiveLayer(tempCanvas).then(() => {
                    // Save state for undo/redo after capturing
                    if (tempCanvas) {
                      saveCanvasState(tempCanvas, 'brush', 'Polygon gradient');
                    }
                    requestAnimationFrame(() => {
                      const clearCtx = drawingCanvasRef.current?.getContext('2d');
                      if (clearCtx) {
                        clearCtx.clearRect(0, 0, drawingCanvasRef.current!.width, drawingCanvasRef.current!.height);
                      }
                      drawingCanvasHasContent.current = false;
                      lastLayersHashRef.current = '';
                      const canvas = canvasRef.current;
                      const ctx = canvas?.getContext('2d');
                      if (ctx) {
                        draw(ctx, viewTransformRef.current);
                      }
                    });
                  });
                }
              }
            }
          }
        }
        
        // Reset polygon state for both Enter and Escape
        setPolygonGradientState({
          drawingState: 'idle',
          points: []
        });
        setIsDrawing(false);
        isDrawingRef.current = false;
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
  }, [handleWheel, setCurrentTool, undo, redo, layers, activeLayerId, updateLayer, draw, polygonGradientState, setPolygonGradientState, tools.brushSettings.brushShape, brushEngine, initDrawingCanvas, project, captureCanvasToActiveLayer, saveCanvasState]);

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
    
    // Only redraw if we're not currently drawing, panning, or capturing
    if (!isDrawingRef.current && !isPanning && !isCapturing.current) {
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
        onMouseLeave={handleMouseLeave} // Use dedicated handler that doesn't finalize gradient tools
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