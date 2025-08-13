import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useBrushEngine } from '../../hooks/useBrushEngine';

// This component implements a responsive canvas with pan and zoom functionality.
// It separates "world space" (where drawings live) from "screen space" (the visible canvas).
const DrawingCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  
  // Get store state
  const { 
    currentBrush, 
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
    activeBrushComponents,
    layers,
    activeLayerId
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
  const [isCapturing, setIsCapturing] = useState(false); // Track when we're capturing to layer
  
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

  // The draw function now takes the view transform as an argument.
  // All drawing operations are done in WORLD coordinates.
  const draw = useCallback((ctx: CanvasRenderingContext2D, transform: typeof viewTransform, skipDrawingCanvas = false) => {
    const { scale, offsetX, offsetY } = transform;

    // Clear the canvas with dark background
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw simple checkerboard pattern
    ctx.save();
    
    const checkerSize = 20;
    const scaledSize = checkerSize * scale;
    
    // Calculate visible range
    const startX = Math.floor(-offsetX / scaledSize) * scaledSize;
    const startY = Math.floor(-offsetY / scaledSize) * scaledSize;
    const endX = startX + ctx.canvas.width + scaledSize * 2;
    const endY = startY + ctx.canvas.height + scaledSize * 2;
    
    ctx.fillStyle = '#333333';
    
    // Draw checkerboard
    for (let x = startX; x < endX; x += scaledSize) {
      for (let y = startY; y < endY; y += scaledSize) {
        const gridX = Math.floor((x - offsetX) / scaledSize);
        const gridY = Math.floor((y - offsetY) / scaledSize);
        
        if ((Math.abs(gridX) + Math.abs(gridY)) % 2 === 0) {
          ctx.fillRect(
            x + offsetX,
            y + offsetY,
            scaledSize,
            scaledSize
          );
        }
      }
    }
    
    ctx.restore();

    // Draw the layers from the project
    if (project && project.layers.length > 0) {
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      
      // Create temporary canvas for compositing if needed
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = project.width;
      tempCanvas.height = project.height;
      
      // Composite layers to temp canvas
      compositeLayersToCanvas(tempCanvas);
      
      // Draw the composited result
      ctx.drawImage(tempCanvas, 0, 0);
      
      // Draw the temporary drawing canvas on top if we're drawing or capturing
      if (!skipDrawingCanvas && drawingCanvasRef.current && (isDrawing || isCapturing)) {
        ctx.drawImage(drawingCanvasRef.current, 0, 0);
      }
      
      ctx.restore();
    }
    
  }, [project, compositeLayersToCanvas, isDrawing, isCapturing]);

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
    console.log('🖱️ handleMouseDown - button:', event.button, 'isSpacePressed:', isSpacePressed);
    
    // Check for panning: space + left click, middle mouse, or right mouse
    if (isSpacePressed || event.button === 1 || event.button === 2) {
      event.preventDefault();
      setIsPanning(true);
      // Store the starting position and current offset
      panStartRef.current = mousePos;
      panStartOffsetRef.current = { x: viewTransform.offsetX, y: viewTransform.offsetY };
      return;
    }
    
    // Left click for drawing (only if space not pressed)
    if (event.button === 0 && !isSpacePressed) {
      console.log('🎨 Starting drawing');
      initDrawingCanvas();
      const worldPos = screenToWorld(mousePos.x, mousePos.y);
      setIsDrawing(true);
      isDrawingRef.current = true; // Update ref for event handlers
      lastDrawPosRef.current = worldPos;
      
      // Get the drawing context from the active layer or drawing canvas
      const drawCtx = drawingCanvasRef.current?.getContext('2d');
      if (drawCtx && brushEngine && project) {
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
  }, [getMousePos, screenToWorld, isSpacePressed, viewTransform, initDrawingCanvas, brushEngine, activeBrushComponents, project]);

  const handleMouseUp = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    console.log('🖱️ handleMouseUp - isDrawingRef:', isDrawingRef.current, 'isPanning:', isPanning);
    
    if (isPanning) {
      setIsPanning(false);
      // Sync the final position to the store
      setPan(viewTransform.offsetX, viewTransform.offsetY);
    }
    
    if (isDrawingRef.current) {
      console.log('🎨 Processing drawing on mouse up');
      setIsDrawing(false);
      isDrawingRef.current = false; // Update ref
      setIsCapturing(true); // Keep drawing visible during capture
      lastDrawPosRef.current = null;
      
      // Capture the drawing to the active layer
      console.log('📦 Checking capture conditions:', {
        hasDrawingCanvas: !!drawingCanvasRef.current,
        hasProject: !!project,
        layersCount: layers.length,
        activeLayerId
      });
      
      if (drawingCanvasRef.current && project) {
        const activeLayer = layers.find(l => l.id === activeLayerId) || layers[0];
        console.log('📦 Active layer:', activeLayer?.id);
        if (activeLayer) {
          // Create a temporary canvas with merged content
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = project.width;
          tempCanvas.height = project.height;
          const tempCtx = tempCanvas.getContext('2d');
          console.log('📦 Created temp canvas context:', !!tempCtx);
          
          if (tempCtx) {
            // First draw the existing layer content
            console.log('📦 Drawing layer imageData to temp canvas');
            tempCtx.putImageData(activeLayer.imageData, 0, 0);
            
            // Then composite the drawing on top
            tempCtx.drawImage(drawingCanvasRef.current, 0, 0);
            
            console.log('📸 About to capture to layer, activeLayer:', activeLayer.id);
            console.log('📸 tempCanvas dimensions:', tempCanvas.width, 'x', tempCanvas.height);
            
            // Capture this merged canvas directly to the active layer
            // Note: captureCanvasToActiveLayer replaces the layer content entirely
            captureCanvasToActiveLayer(tempCanvas).then(() => {
              console.log('✅ Layer captured successfully');
              
              // Clear the drawing canvas after successful capture
              if (drawingCanvasRef.current) {
                const clearCtx = drawingCanvasRef.current.getContext('2d');
                if (clearCtx) {
                  clearCtx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
                }
              }
              
              setIsCapturing(false); // Now we can hide the drawing canvas
              
              // Force immediate redraw to show the updated layer
              requestAnimationFrame(() => {
                const canvas = canvasRef.current;
                const ctx = canvas?.getContext('2d');
                if (ctx) {
                  console.log('🎨 Redrawing canvas after capture');
                  draw(ctx, viewTransformRef.current);
                }
              });
            }).catch(err => {
              console.error('❌ Failed to capture layer:', err);
              setIsCapturing(false);
            });
          }
        }
      }
    }
  }, [isPanning, viewTransform, setPan, draw, captureCanvasToActiveLayer, project, layers, activeLayerId]);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPanning && !isDrawing) return;
    
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
        // Update state less frequently
        setViewTransform(viewTransformRef.current);
      });
      return;
    }
    
    // Handle drawing
    if (isDrawing && lastDrawPosRef.current && project) {
      const worldPos = screenToWorld(currentMousePos.x, currentMousePos.y);
      
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
        
        // Redraw the canvas to show the updated drawing
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx) {
          draw(ctx, viewTransformRef.current);
          
          // Draw the temporary drawing canvas on top
          if (drawingCanvasRef.current) {
            ctx.save();
            ctx.translate(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
            ctx.scale(viewTransformRef.current.scale, viewTransformRef.current.scale);
            ctx.drawImage(drawingCanvasRef.current, 0, 0);
            ctx.restore();
          }
        }
      }
    }
  }, [getMousePos, isPanning, isDrawing, screenToWorld, draw, brushEngine, activeBrushComponents, project]);

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    setViewTransform(prev => {
      const scrollSensitivity = 0.001;
      const zoomFactor = 1 - event.deltaY * scrollSensitivity;
      const newScale = Math.max(0.1, Math.min(prev.scale * zoomFactor, 10));
      
      // Calculate the world position under the mouse before zoom
      const worldX = (mouseX - prev.offsetX) / prev.scale;
      const worldY = (mouseY - prev.offsetY) / prev.scale;
      
      // Calculate new offset to keep the world position under the mouse
      const newOffsetX = mouseX - worldX * newScale;
      const newOffsetY = mouseY - worldY * newScale;
      
      // Sync to store
      requestAnimationFrame(() => {
        setZoom(newScale);
        setPan(newOffsetX, newOffsetY);
      });
      
      return {
        scale: newScale,
        offsetX: newOffsetX,
        offsetY: newOffsetY,
      };
    });
  }, [setZoom, setPan]);

  // --- Effects ---

  // Handle keyboard events for space key and wheel events
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault();
        setIsSpacePressed(true);
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
  }, [handleWheel]);

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

  // This single effect handles resizing and redrawing.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Redraw whenever the view transform changes
    draw(ctx, viewTransform);

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
        draw(ctx, viewTransform);
      });
    });
    resizeObserver.observe(wrapper);

    // Initial size setup
    const { width, height } = wrapper.getBoundingClientRect();
    canvas.width = width;
    canvas.height = height;
    setCanvasDimensions(width, height);

    // Cleanup: disconnect the observer when the component unmounts
    return () => resizeObserver.disconnect();
  }, [draw, viewTransform, setCanvasDimensions]);

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

export default DrawingCanvas;