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
  const { activeBrushComponents, layers, activeLayerId, captureCanvasToActiveLayer, saveCanvasState } = useAppStore();
  
  // Drawing canvas ref
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingCanvasHasContent = useRef(false);
  const isCapturing = useRef(false);
  const lastDrawPosRef = useRef<{ x: number; y: number } | null>(null);
  const drawAnimationFrameRef = useRef<number | null>(null);
  
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
    lastDrawPosRef.current = worldPos;
    
    // Draw initial point
    const drawCtx = drawingCanvasRef.current?.getContext('2d');
    if (drawCtx && brushEngine && project) {
      brushEngine.resetPixelQueue();
      
      const clampedPos = {
        x: Math.max(0, Math.min(project.width - 1, worldPos.x)),
        y: Math.max(0, Math.min(project.height - 1, worldPos.y))
      };
      
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
      
      lastDrawPosRef.current = worldPos;
      
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
  
  return {
    drawingCanvasRef,
    drawingCanvasHasContent,
    isCapturing,
    initDrawingCanvas,
    startDrawing,
    continueDrawing,
    finalizeDrawing,
    clearDrawingCanvas,
  };
}