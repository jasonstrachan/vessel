import { useCallback, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { useBrushEngine } from './useBrushEngine';

interface UseDrawingHandlersProps {
  project: any;
  screenToWorld: (x: number, y: number) => { x: number; y: number };
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  draw: (ctx: CanvasRenderingContext2D, transform: any) => void;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

export function useDrawingHandlers({
  project,
  screenToWorld,
  viewTransformRef,
  draw,
  canvasRef,
}: UseDrawingHandlersProps) {
  const brushEngine = useBrushEngine();
  const { activeBrushComponents, layers, activeLayerId, captureCanvasToActiveLayer, saveCanvasState, tools } = useAppStore();
  
  // Drawing canvas ref
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingCanvasHasContent = useRef(false);
  const isCapturing = useRef(false);
  const lastDrawPosRef = useRef<{ x: number; y: number } | null>(null);
  const drawAnimationFrameRef = useRef<number | null>(null);
  
  // Shape mode state
  const shapePointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const isDrawingShapeRef = useRef(false);
  
  // Initialize drawing canvas
  const initDrawingCanvas = useCallback(() => {
    if (!drawingCanvasRef.current && project) {
      drawingCanvasRef.current = document.createElement('canvas');
      drawingCanvasRef.current.width = project.width;
      drawingCanvasRef.current.height = project.height;
      const ctx = drawingCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
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
  
  // Start drawing
  const startDrawing = useCallback((worldPos: { x: number; y: number }) => {
    initDrawingCanvas();
    
    // Clear the drawing canvas for a fresh start
    if (drawingCanvasRef.current) {
      const clearCtx = drawingCanvasRef.current.getContext('2d');
      if (clearCtx) {
        clearCtx.imageSmoothingEnabled = false;
        clearCtx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
      }
    }
    
    drawingCanvasHasContent.current = true;
    
    // Draw initial point
    const drawCtx = drawingCanvasRef.current?.getContext('2d');
    if (drawCtx && brushEngine && project) {
      // Set up clipping region to prevent drawing outside canvas bounds
      drawCtx.save();
      drawCtx.beginPath();
      drawCtx.rect(0, 0, project.width, project.height);
      drawCtx.clip();
      
      brushEngine.resetPixelQueue();
      
      const clampedPos = {
        x: Math.max(0, Math.min(project.width - 1, worldPos.x)),
        y: Math.max(0, Math.min(project.height - 1, worldPos.y))
      };
      
      // Store the clamped position to ensure consistency
      lastDrawPosRef.current = clampedPos;
      
      brushEngine.renderBrushStroke(
        drawCtx,
        clampedPos,
        clampedPos,
        { pressure: 1.0 },
        activeBrushComponents
      );
    }
  }, [initDrawingCanvas, brushEngine, project, activeBrushComponents]);
  
  // Continue drawing
  const continueDrawing = useCallback((worldPos: { x: number; y: number }) => {
    if (!lastDrawPosRef.current || !project) return;
    
    const clampedPos = {
      x: Math.max(0, Math.min(project.width - 1, worldPos.x)),
      y: Math.max(0, Math.min(project.height - 1, worldPos.y))
    };
    
    const clampedLastPos = {
      x: Math.max(0, Math.min(project.width - 1, lastDrawPosRef.current.x)),
      y: Math.max(0, Math.min(project.height - 1, lastDrawPosRef.current.y))
    };
    
    const drawCtx = drawingCanvasRef.current?.getContext('2d');
    if (drawCtx && brushEngine) {
      brushEngine.renderBrushStroke(
        drawCtx,
        clampedLastPos,
        clampedPos,
        { pressure: 1.0 },
        activeBrushComponents
      );
      
      // Store the clamped position instead of the raw worldPos
      // This prevents edge artifacts when cursor moves outside canvas
      lastDrawPosRef.current = clampedPos;
      
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
  }, [brushEngine, project, activeBrushComponents, draw, viewTransformRef, canvasRef]);
  
  // Finalize drawing
  const finalizeDrawing = useCallback(async () => {
    lastDrawPosRef.current = null;
    
    if (drawingCanvasRef.current && project && drawingCanvasHasContent.current) {
      // Restore the context to remove clipping mask
      const drawCtx = drawingCanvasRef.current.getContext('2d');
      if (drawCtx) {
        drawCtx.restore();
      }
      
      isCapturing.current = true;
      const activeLayer = layers.find(l => l.id === activeLayerId) || layers[0];
      
      if (activeLayer) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = project.width;
        tempCanvas.height = project.height;
        const tempCtx = tempCanvas.getContext('2d');
        
        if (tempCtx) {
          tempCtx.putImageData(activeLayer.imageData, 0, 0);
          tempCtx.drawImage(drawingCanvasRef.current, 0, 0);
          
          await captureCanvasToActiveLayer(tempCanvas);
          
          // Save state for undo/redo
          const updatedLayer = useAppStore.getState().layers.find(l => l.id === activeLayerId);
          if (updatedLayer) {
            const saveCanvas = document.createElement('canvas');
            saveCanvas.width = project.width;
            saveCanvas.height = project.height;
            const saveCtx = saveCanvas.getContext('2d');
            if (saveCtx) {
              saveCtx.putImageData(updatedLayer.imageData, 0, 0);
              saveCanvasState(saveCanvas, 'brush', 'Drawing stroke');
            }
          }
          
          requestAnimationFrame(() => {
            const clearCtx = drawingCanvasRef.current?.getContext('2d');
            if (clearCtx) {
              clearCtx.clearRect(0, 0, drawingCanvasRef.current!.width, drawingCanvasRef.current!.height);
            }
            drawingCanvasHasContent.current = false;
            isCapturing.current = false;
            
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (ctx) {
              draw(ctx, viewTransformRef.current);
            }
          });
        }
      }
    }
  }, [project, layers, activeLayerId, captureCanvasToActiveLayer, saveCanvasState, draw, viewTransformRef, canvasRef]);
  
  // Clear drawing canvas
  const clearDrawingCanvas = useCallback(() => {
    if (drawingCanvasRef.current) {
      const ctx = drawingCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
      }
      drawingCanvasHasContent.current = false;
    }
    lastDrawPosRef.current = null;
  }, []);
  
  // Shape mode functions
  const startShapeDrawing = useCallback((worldPos: { x: number; y: number }) => {
    if (tools.shapeMode) {
      initDrawingCanvas();
      shapePointsRef.current = [worldPos];
      isDrawingShapeRef.current = true;
    } else {
      // Regular drawing
      startDrawing(worldPos);
    }
  }, [tools.shapeMode, initDrawingCanvas, startDrawing]);
  
  const continueShapeDrawing = useCallback((worldPos: { x: number; y: number }) => {
    if (tools.shapeMode && isDrawingShapeRef.current) {
      // Add points to shape with minimum distance check
      const lastPoint = shapePointsRef.current[shapePointsRef.current.length - 1];
      if (lastPoint) {
        const distance = Math.hypot(worldPos.x - lastPoint.x, worldPos.y - lastPoint.y);
        if (distance >= 5) { // Minimum spacing between points
          shapePointsRef.current.push(worldPos);
        }
      }
    } else if (!tools.shapeMode) {
      // Regular drawing
      continueDrawing(worldPos);
    }
  }, [tools.shapeMode, continueDrawing]);
  
  const finalizeShapeDrawing = useCallback(() => {
    if (tools.shapeMode && isDrawingShapeRef.current && shapePointsRef.current.length >= 3) {
      // Draw closed polygon with current brush
      const drawCtx = drawingCanvasRef.current?.getContext('2d');
      if (drawCtx && brushEngine) {
        drawCtx.save();
        
        // Disable antialiasing for pixel brushes
        const isPixelBrush = tools.brushSettings.brushShape === 'pixel_round' || 
                            tools.brushSettings.brushShape === 'square' ||
                            !tools.brushSettings.antialiasing;
        drawCtx.imageSmoothingEnabled = !isPixelBrush;
        
        drawCtx.globalAlpha = tools.brushSettings.opacity;
        drawCtx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';
        
        // Create path for the polygon
        drawCtx.beginPath();
        drawCtx.moveTo(shapePointsRef.current[0].x, shapePointsRef.current[0].y);
        for (let i = 1; i < shapePointsRef.current.length; i++) {
          drawCtx.lineTo(shapePointsRef.current[i].x, shapePointsRef.current[i].y);
        }
        drawCtx.closePath();
        
        // Fill with appropriate style based on brush type
        if (tools.brushSettings.brushShape === 'custom' && tools.brushSettings.selectedCustomBrush && tools.brushSettings.currentBrushTip) {
          // Create a pattern from the custom brush
          const patternCanvas = document.createElement('canvas');
          const brushTip = tools.brushSettings.currentBrushTip;
          const brushWidth = brushTip.width || 32;
          const brushHeight = brushTip.height || 32;
          const scaledSize = (tools.brushSettings.size / 100) * Math.max(brushWidth, brushHeight);
          
          patternCanvas.width = scaledSize;
          patternCanvas.height = scaledSize;
          const patternCtx = patternCanvas.getContext('2d');
          
          if (patternCtx) {
            // Create temp canvas for the brush tip
            const tipCanvas = document.createElement('canvas');
            tipCanvas.width = brushWidth;
            tipCanvas.height = brushHeight;
            const tipCtx = tipCanvas.getContext('2d');
            
            if (tipCtx) {
              tipCtx.putImageData(brushTip.imageData, 0, 0);
              
              // Scale and draw to pattern canvas
              patternCtx.drawImage(tipCanvas, 0, 0, scaledSize, scaledSize);
              
              // Create pattern and fill the polygon
              const pattern = drawCtx.createPattern(patternCanvas, 'repeat');
              if (pattern) {
                drawCtx.fillStyle = pattern;
                drawCtx.fill();
              }
            }
          }
        } else {
          // Solid fill for regular brushes
          drawCtx.fillStyle = tools.brushSettings.color;
          drawCtx.fill();
        }
        
        // No outline - only fill as requested
        
        drawCtx.restore();
        drawingCanvasHasContent.current = true;
      }
      
      // Reset shape state
      shapePointsRef.current = [];
      isDrawingShapeRef.current = false;
      
      // Finalize to layer
      finalizeDrawing();
    } else if (!tools.shapeMode) {
      // Regular finalize
      finalizeDrawing();
    } else if (tools.shapeMode && isDrawingShapeRef.current) {
      // Not enough points for a shape, clear
      shapePointsRef.current = [];
      isDrawingShapeRef.current = false;
    }
  }, [tools.shapeMode, tools.brushSettings, brushEngine, finalizeDrawing]);
  
  return {
    drawingCanvasRef,
    drawingCanvasHasContent,
    isCapturing,
    initDrawingCanvas,
    startDrawing,
    continueDrawing,
    finalizeDrawing,
    clearDrawingCanvas,
    startShapeDrawing,
    continueShapeDrawing,
    finalizeShapeDrawing,
    shapePointsRef,
    isDrawingShapeRef,
  };
}