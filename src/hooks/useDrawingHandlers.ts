import { useCallback, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { useBrushEngine } from './useBrushEngine';

interface UseDrawingHandlersProps {
  project: { width: number; height: number } | null;
  screenToWorld: (x: number, y: number) => { x: number; y: number };
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  draw: (ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }) => void;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isBusyRef?: React.MutableRefObject<boolean>; // Lock ref to prevent concurrent operations
}

/**
 * Clips a line segment to a rectangular boundary.
 */
function clipLineSegment(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number }
): [{ x: number; y: number }, { x: number; y: number }] | null {
  const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
  const { x: xmin, y: ymin, width, height } = rect;
  const xmax = xmin + width;
  const ymax = ymin + height;

  let t0 = 0, t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;

  const checks = [
    { p: -dx, q: x1 - xmin }, // Left
    { p: dx, q: xmax - x1 },  // Right
    { p: -dy, q: y1 - ymin }, // Top
    { p: dy, q: ymax - y1 }   // Bottom
  ];

  for (const { p, q } of checks) {
    if (p === 0 && q < 0) return null;

    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else if (p > 0) {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }

  return [
    { x: x1 + t0 * dx, y: y1 + t0 * dy },
    { x: x1 + t1 * dx, y: y1 + t1 * dy }
  ];
}

export function useDrawingHandlers({
  project,
  viewTransformRef,
  draw,
  canvasRef,
  isBusyRef,
}: UseDrawingHandlersProps) {
  const brushEngine = useBrushEngine();
  const { activeBrushComponents, captureCanvasToActiveLayer, saveCanvasState, tools } = useAppStore();
  
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingCanvasHasContent = useRef(false);
  const isCapturing = useRef(false);
  const lastDrawPosRef = useRef<{ x: number; y: number } | null>(null);
  const drawAnimationFrameRef = useRef<number | null>(null);
  
  const shapePointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const isDrawingShapeRef = useRef(false);
  
  const initDrawingCanvas = useCallback(() => {
    if (!drawingCanvasRef.current && project) {
      drawingCanvasRef.current = document.createElement('canvas');
      drawingCanvasRef.current.width = project.width;
      drawingCanvasRef.current.height = project.height;
    } else if (drawingCanvasRef.current && project) {
      if (drawingCanvasRef.current.width !== project.width || 
          drawingCanvasRef.current.height !== project.height) {
        drawingCanvasRef.current.width = project.width;
        drawingCanvasRef.current.height = project.height;
      }
    }
  }, [project]);
  
  const startDrawing = useCallback((worldPos: { x: number; y: number }) => {
    // DEBUG: Check which tool is active at the very start.
    const currentTool = useAppStore.getState().tools.currentTool;
    console.log(`%c[DEBUG] Start Drawing -> Tool: ${currentTool}`, 'color: blue; font-weight: bold;');

    initDrawingCanvas();
    
    if (drawingCanvasRef.current) {
      const clearCtx = drawingCanvasRef.current.getContext('2d', { willReadFrequently: true });
      if (clearCtx) {
        clearCtx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
      }
    }
    
    drawingCanvasHasContent.current = true;
    
    const drawCtx = drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
    if (drawCtx && brushEngine && project) {
      lastDrawPosRef.current = worldPos;
      
      // FIX: Force the stamp to be drawn at 100% opacity.
      drawCtx.globalAlpha = 1.0;
      drawCtx.globalCompositeOperation = 'source-over';
      
      // DEBUG: Verify brush engine for eraser
      console.log('[DEBUG] Brush components for eraser:', activeBrushComponents);
      console.log('[DEBUG] Current tool at stroke time:', useAppStore.getState().tools.currentTool);
      
      brushEngine.renderBrushStroke(
        drawCtx,
        worldPos,
        worldPos,
        { pressure: 1.0 },
        activeBrushComponents
      );
      
      // DEBUG: Check the stamp content
      const imageData = drawCtx.getImageData(0, 0, 10, 10);
      const hasContent = imageData.data.some((val, i) => i % 4 === 3 && val > 0);
      console.log('[DEBUG] Stamp has content after initial stroke:', hasContent);
      
      requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          draw(ctx, viewTransformRef.current);
        }
      });
    }
  }, [initDrawingCanvas, brushEngine, project, activeBrushComponents, draw, viewTransformRef, canvasRef]);
  
  const continueDrawing = useCallback((worldPos: { x: number; y: number }) => {
    const lastPoint = lastDrawPosRef.current;

    if (!lastPoint || !project) {
      lastDrawPosRef.current = worldPos;
      return;
    }

    const boundary = { x: 0, y: 0, width: project.width, height: project.height };
    const clippedSegment = clipLineSegment(lastPoint, worldPos, boundary);

    if (clippedSegment) {
      const [clippedStart, clippedEnd] = clippedSegment;
      const drawCtx = drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });

      if (drawCtx && brushEngine) {
        // FIX: Force the stamp to be drawn at 100% opacity.
        drawCtx.globalAlpha = 1.0;
        drawCtx.globalCompositeOperation = 'source-over';
        
        // DEBUG: Verify brush engine for eraser
        console.log('[DEBUG] Brush components for eraser (continue):', activeBrushComponents);
        console.log('[DEBUG] Current tool at continue stroke:', useAppStore.getState().tools.currentTool);
        
        brushEngine.renderBrushStroke(
          drawCtx,
          clippedStart,
          clippedEnd,
          { pressure: 1.0 },
          activeBrushComponents
        );
        
        // DEBUG: Check the stamp content
        const imageData = drawCtx.getImageData(0, 0, 10, 10);
        const hasContent = imageData.data.some((val, i) => i % 4 === 3 && val > 0);
        console.log('[DEBUG] Stamp has content after continue stroke:', hasContent);

        if (drawAnimationFrameRef.current) {
          cancelAnimationFrame(drawAnimationFrameRef.current);
        }
        drawAnimationFrameRef.current = requestAnimationFrame(() => {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            draw(ctx, viewTransformRef.current);
          }
          drawAnimationFrameRef.current = null;
        });
      }
    }
    lastDrawPosRef.current = worldPos;
  }, [brushEngine, project, activeBrushComponents, draw, viewTransformRef, canvasRef]);
  
  const finalizeDrawing = useCallback(async () => {
    console.log('[DEBUG] Finalize drawing called.');
    if (isBusyRef?.current || !drawingCanvasRef.current || !drawingCanvasHasContent.current) {
        console.warn('[DEBUG] Finalize aborted.', { 
          isBusy: isBusyRef?.current, 
          hasCanvas: !!drawingCanvasRef.current, 
          hasContent: drawingCanvasHasContent.current 
        });
        return;
    }
    
    try {
      if (isBusyRef) isBusyRef.current = true;
      
      lastDrawPosRef.current = null;
      
      if (project) {
        const currentState = useAppStore.getState();
        const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
        
        if (activeLayer) {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = project.width;
          tempCanvas.height = project.height;
          const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
          
          if (tempCtx) {
            if (activeLayer.imageData) {
              tempCtx.putImageData(activeLayer.imageData, 0, 0);
            }
            
            const { currentTool, brushSettings } = currentState.tools;
            // DEBUG: Log the tool and the temporary "stamp" canvas right before compositing.
            console.log(`%c[DEBUG] Finalizing stroke... Tool: ${currentTool}`, 'color: green; font-weight: bold;');
            console.log('[DEBUG] Stamp canvas to be applied:', drawingCanvasRef.current);

            if (currentTool === 'eraser') {
              // DEBUG: This is the most important log for the eraser.
              console.log('%c[DEBUG] Applying ERASER effect (destination-out)', 'color: red; font-weight: bold;');
              tempCtx.globalCompositeOperation = 'destination-out';
            } else if (brushSettings.blendMode) {
              console.log(`[DEBUG] Applying BRUSH effect (${brushSettings.blendMode})`);
              tempCtx.globalCompositeOperation = brushSettings.blendMode;
            } else {
              console.log('[DEBUG] Applying default BRUSH effect (source-over)');
              tempCtx.globalCompositeOperation = 'source-over';
            }
            
            tempCtx.drawImage(drawingCanvasRef.current, 0, 0);
            
            // DEBUG: Check the actual pixel data after composite
            const testX = Math.floor(project.width / 2);
            const testY = Math.floor(project.height / 2);
            const testData = tempCtx.getImageData(testX - 5, testY - 5, 10, 10);
            const nonTransparentPixels = Array.from(testData.data).filter((val, i) => i % 4 === 3 && val > 0).length;
            console.log(`[DEBUG] Pixels after composite at (${testX}, ${testY}):`, {
              nonTransparentPixels,
              sampleAlpha: testData.data[3], // First pixel's alpha
              tool: currentTool
            });
            
            // DEBUG: Log the final canvas state before it's saved.
            console.log('[DEBUG] Final composite result:', tempCanvas);

            await captureCanvasToActiveLayer(tempCanvas);
            saveCanvasState(tempCanvas, 'brush', 'Drawing stroke');
            
            requestAnimationFrame(() => {
              if (drawingCanvasRef.current) {
                const clearCtx = drawingCanvasRef.current.getContext('2d', { willReadFrequently: true });
                if (clearCtx) {
                  clearCtx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
                }
              }
              drawingCanvasHasContent.current = false;
              
              const canvas = canvasRef.current;
              const ctx = canvas?.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                draw(ctx, viewTransformRef.current);
              }
            });
          }
        }
      }
    } catch (error) {
      console.error("Error during finalization:", error);
    } finally {
      if (isBusyRef) isBusyRef.current = false;
    }
  }, [project, captureCanvasToActiveLayer, saveCanvasState, draw, viewTransformRef, canvasRef, isBusyRef]);
  
  const clearDrawingCanvas = useCallback(() => {
    if (drawingCanvasRef.current) {
      const ctx = drawingCanvasRef.current.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
      }
      drawingCanvasHasContent.current = false;
    }
    lastDrawPosRef.current = null;
  }, []);
  
  const startShapeDrawing = useCallback((worldPos: { x: number; y: number }) => {
    if (tools.shapeMode) {
      initDrawingCanvas();
      shapePointsRef.current = [worldPos];
      isDrawingShapeRef.current = true;
    } else {
      startDrawing(worldPos);
    }
  }, [tools.shapeMode, initDrawingCanvas, startDrawing]);
  
  const continueShapeDrawing = useCallback((worldPos: { x: number; y: number }) => {
    if (tools.shapeMode && isDrawingShapeRef.current) {
      const lastPoint = shapePointsRef.current[shapePointsRef.current.length - 1];
      if (lastPoint) {
        const distance = Math.hypot(worldPos.x - lastPoint.x, worldPos.y - lastPoint.y);
        if (distance >= 5) {
          shapePointsRef.current.push(worldPos);
        }
      }
    } else if (!tools.shapeMode) {
      continueDrawing(worldPos);
    }
  }, [tools.shapeMode, continueDrawing]);
  
  const finalizeShapeDrawing = useCallback(async () => {
    if (!tools.shapeMode) {
      return finalizeDrawing();
    }
    
    if (isBusyRef?.current) return;
    
    try {
      if (isBusyRef) isBusyRef.current = true;
      
      if (isDrawingShapeRef.current && shapePointsRef.current.length >= 3) {
        const drawCtx = drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
        if (drawCtx && brushEngine) {
          
          // FIX: Use 100% opacity for the shape fill, ignoring the brush setting.
          drawCtx.globalAlpha = 1.0;
          drawCtx.globalCompositeOperation = 'source-over';
          drawCtx.fillStyle = tools.brushSettings.color;

          drawCtx.beginPath();
          drawCtx.moveTo(shapePointsRef.current[0].x, shapePointsRef.current[0].y);
          for (let i = 1; i < shapePointsRef.current.length; i++) {
            drawCtx.lineTo(shapePointsRef.current[i].x, shapePointsRef.current[i].y);
          }
          drawCtx.closePath();
          drawCtx.fill();
          
          drawingCanvasHasContent.current = true;
        }
        
        shapePointsRef.current = [];
        isDrawingShapeRef.current = false;
        
        if (isBusyRef) isBusyRef.current = false;
        await finalizeDrawing();
        return;
      } else if (isDrawingShapeRef.current) {
        shapePointsRef.current = [];
        isDrawingShapeRef.current = false;
      }
    } catch (error) {
      console.error("Error during shape finalization:", error);
    } finally {
      if (isBusyRef) isBusyRef.current = false;
    }
  }, [tools.shapeMode, tools.brushSettings, brushEngine, finalizeDrawing, isBusyRef]);
  
  return {
    drawingCanvasRef,
    drawingCanvasHasContent,
    isCapturing,
    startDrawing,
    continueDrawing,
    finalizeDrawing,
    clearDrawingCanvas,
    startShapeDrawing,
    continueShapeDrawing,
    finalizeShapeDrawing,
  };
}