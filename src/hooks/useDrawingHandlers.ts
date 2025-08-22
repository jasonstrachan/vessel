import { useCallback, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
// Using adapter for safe migration between implementations
import { useBrushEngineAdapter } from './useBrushEngineAdapter';
import { useUserBrushEngine } from './useUserBrushEngine';
import { BrushShape } from '../types';
import { getRisographPattern } from '../utils/risographTexture';

interface UseDrawingHandlersProps {
  project: { width: number; height: number } | null;
  screenToWorld: (x: number, y: number) => { x: number; y: number };
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isBusyRef?: React.MutableRefObject<boolean>;
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
    { p: -dx, q: x1 - xmin },
    { p: dx, q: xmax - x1 },
    { p: -dy, q: y1 - ymin },
    { p: dy, q: ymax - y1 }
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
  canvasRef,
  isBusyRef,
}: UseDrawingHandlersProps) {
  const brushEngine = useBrushEngineAdapter();
  const userBrushEngine = useUserBrushEngine();
  const { activeBrushComponents, captureCanvasToActiveLayer, saveCanvasState, tools } = useAppStore();
  
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawingCanvasHasContent = useRef(false);
  const isCapturing = useRef(false);
  const lastDrawPosRef = useRef<{ x: number; y: number } | null>(null);
  
  // OPTIMIZATION: The separate eraser mask canvas is no longer needed.
  // We will perform erasing directly on the drawingCanvas.
  
  const shapePointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const isDrawingShapeRef = useRef(false);
  
  const initDrawingCanvas = useCallback(() => {
    if (!project) return;

    if (!drawingCanvasRef.current) {
      drawingCanvasRef.current = document.createElement('canvas');
      drawingCanvasRef.current.width = project.width;
      drawingCanvasRef.current.height = project.height;
    } else {
      // Resize if project dimensions have changed
      if (drawingCanvasRef.current.width !== project.width || 
          drawingCanvasRef.current.height !== project.height) {
        drawingCanvasRef.current.width = project.width;
        drawingCanvasRef.current.height = project.height;
      }
    }
    // Always get a fresh context, especially after resizing
    drawingCtxRef.current = drawingCanvasRef.current.getContext('2d', { 
      willReadFrequently: true,
      alpha: true,
      desynchronized: true 
    });
  }, [project]);

  // OPTIMIZATION: Helper function to draw an eraser segment. Using a stroked
  // line is often faster than stamping multiple circles.
  const drawEraserSegment = useCallback((
    ctx: CanvasRenderingContext2D,
    p1: { x: number; y: number },
    p2: { x: number; y: number }
  ) => {
    const { tools } = useAppStore.getState();
    const brushSize = tools.brushSettings.size || 20;  // Use brushSettings.size for consistency
    const opacity = tools.eraserSettings.opacity || 1;

    ctx.lineWidth = brushSize * 2; // Diameter to match circle-based approach
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // The "color" of the eraser determines its strength. Black with opacity.
    ctx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;
    
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }, []);
  
  const startDrawing = useCallback((worldPos: { x: number; y: number }, pressure: number = 0.5) => {
    const currentState = useAppStore.getState();
    const currentTool = currentState.tools.currentTool;
    const currentBrushId = currentState.currentBrushPreset?.id;
    
    initDrawingCanvas();
    
    // Reset stroke for new drawing (modular engine)
    if (brushEngine.resetStroke) {
      brushEngine.resetStroke();
    }
    const drawCtx = drawingCtxRef.current;
    if (!drawCtx || !drawingCanvasRef.current || !project) return;
      
    drawCtx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
    drawingCanvasHasContent.current = true;
    lastDrawPosRef.current = worldPos;
    
    if (currentTool === 'eraser') {
      // OPTIMIZATION: Copy the active layer to the drawing canvas ONCE at the start.
      const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
      if (activeLayer?.imageData) {
        drawCtx.putImageData(activeLayer.imageData, 0, 0);
      }
      
      // OPTIMIZATION: Prepare the context for erasing. We will now "cut out"
      // from the image we just placed on the drawing canvas.
      drawCtx.globalCompositeOperation = 'destination-out';
      
      // Draw the initial eraser point.
      drawEraserSegment(drawCtx, worldPos, worldPos);

    } else { // Brush tool
      drawCtx.globalAlpha = 1.0;
      drawCtx.globalCompositeOperation = 'source-over';
      
      // Check if this is a user brush
      if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
        userBrushEngine.setActiveBrush(currentBrushId);
        userBrushEngine.startStroke(drawCtx, worldPos.x, worldPos.y, pressure);
      } else if (brushEngine) {
        brushEngine.renderBrushStroke(
          drawCtx,
          worldPos,
          worldPos,
          { pressure },
          activeBrushComponents
        );
      }
    }
    
    // Initial point drawn - parent component will handle redraw
  }, [initDrawingCanvas, brushEngine, userBrushEngine, project, activeBrushComponents, drawEraserSegment]);

  const continueDrawing = useCallback((worldPos: { x: number; y: number }, pressure: number = 0.5) => {
    const currentState = useAppStore.getState();
    const currentTool = currentState.tools.currentTool;
    const currentBrushId = currentState.currentBrushPreset?.id;
    const lastPoint = lastDrawPosRef.current;
    const drawCtx = drawingCtxRef.current;

    if (!lastPoint || !project || !drawCtx) {
      lastDrawPosRef.current = worldPos;
      return;
    }

    const boundary = { x: 0, y: 0, width: project.width, height: project.height };
    const clippedSegment = clipLineSegment(lastPoint, worldPos, boundary);

    if (clippedSegment) {
      const [clippedStart, clippedEnd] = clippedSegment;
      
      if (currentTool === 'eraser') {
        // OPTIMIZATION: The context is already set to 'destination-out'.
        // We just draw the new line segment. This is extremely fast as there's
        // no clearing or image data manipulation happening here.
        drawEraserSegment(drawCtx, clippedStart, clippedEnd);
      } else { // Brush tool
        // Check if this is a user brush
        if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
          userBrushEngine.continueStroke(drawCtx, clippedEnd.x, clippedEnd.y, pressure);
        } else if (brushEngine) {
          drawCtx.globalAlpha = 1.0;
          drawCtx.globalCompositeOperation = 'source-over';
          brushEngine.renderBrushStroke(
            drawCtx,
            clippedStart,
            clippedEnd,
            { pressure },
            activeBrushComponents
          );
        }
        
      }

      // Parent component will handle redraw
    }
    
    lastDrawPosRef.current = worldPos;
  }, [brushEngine, userBrushEngine, project, activeBrushComponents, drawEraserSegment]);
  
  const finalizeDrawing = useCallback(async () => {
    if (isBusyRef?.current || !drawingCanvasRef.current || !drawingCanvasHasContent.current || !project) return;
    
    try {
      if (isBusyRef) isBusyRef.current = true;
      lastDrawPosRef.current = null;

      // Finalize the stroke (draw any waiting pixels) for modular engine
      if (brushEngine.finalizeStroke && drawingCtxRef.current) {
        brushEngine.finalizeStroke(drawingCtxRef.current);
      }

      const currentState = useAppStore.getState();
      const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
      const currentTool = currentState.tools.currentTool;
      const currentBrushId = currentState.currentBrushPreset?.id;
      
      // End stroke for user brushes
      if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
        userBrushEngine.endStroke();
      }

      if (activeLayer) {
        if (currentTool === 'eraser') {
          // OPTIMIZATION: The drawingCanvas already has the final erased result.
          // We can capture it directly without any extra compositing.
          await captureCanvasToActiveLayer(drawingCanvasRef.current);
          saveCanvasState(drawingCanvasRef.current, 'eraser', 'Erased stroke');
        } else { // Brush tool
          const activeSettings = currentState.tools.brushSettings;
          
          // Now composite the drawing (with risograph already applied per-stamp) onto the layer
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = project.width;
          tempCanvas.height = project.height;
          const tempCtx = tempCanvas.getContext('2d', {
            willReadFrequently: true,
            alpha: true
          });
          
          if (tempCtx) {
            if (activeLayer.imageData) {
              tempCtx.putImageData(activeLayer.imageData, 0, 0);
            }
            // Don't re-apply opacity and blend mode - they were already applied during drawing
            tempCtx.globalCompositeOperation = 'source-over';
            tempCtx.globalAlpha = 1;
            tempCtx.drawImage(drawingCanvasRef.current, 0, 0);
            
            await captureCanvasToActiveLayer(tempCanvas);
            saveCanvasState(tempCanvas, 'brush', 'Drawing stroke');
          }
        }
      }
      
      // Cleanup
      drawingCtxRef.current?.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
      drawingCanvasHasContent.current = false;
      
      // Parent component will handle final redraw
    } catch (error) {
      console.error("Error during finalization:", error);
    } finally {
      if (isBusyRef) isBusyRef.current = false;
    }
  }, [project, captureCanvasToActiveLayer, saveCanvasState, isBusyRef, userBrushEngine, brushEngine, tools.shapeMode]);
  
  const clearDrawingCanvas = useCallback(() => {
    if (drawingCtxRef.current && drawingCanvasRef.current) {
      drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
    }
    drawingCanvasHasContent.current = false;
    lastDrawPosRef.current = null;
  }, []);
  
  const startShapeDrawing = useCallback((worldPos: { x: number; y: number }, pressure: number = 0.5) => {
    if (tools.shapeMode) {
      initDrawingCanvas();
      shapePointsRef.current = [worldPos];
      isDrawingShapeRef.current = true;
    } else {
      startDrawing(worldPos, pressure);
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
        const drawCtx = drawingCtxRef.current;
        if (drawCtx && brushEngine) {
          drawCtx.globalAlpha = 1.0;
          drawCtx.globalCompositeOperation = 'source-over';
          
          // Check if we're using a custom brush
          const isCustomBrush = tools.brushSettings.brushShape === BrushShape.CUSTOM;
          let customBrushImageData: ImageData | null = null;
          let customBrushWidth = 0;
          let customBrushHeight = 0;
          let isColorizable = false;
          
          if (isCustomBrush) {
            // Try to get custom brush from currentBrushTip first
            if (tools.brushSettings.currentBrushTip) {
              const brushTip = tools.brushSettings.currentBrushTip;
              console.log('[DEBUG useDrawingHandlers] Using currentBrushTip:', {
                brushId: brushTip.brushId,
                width: brushTip.width || brushTip.imageData.width,
                height: brushTip.height || brushTip.imageData.height,
                dataLength: brushTip.imageData.data.length
              });
              customBrushImageData = brushTip.imageData;
              customBrushWidth = brushTip.width || brushTip.imageData.width;
              customBrushHeight = brushTip.height || brushTip.imageData.height;
              isColorizable = brushTip.isColorizable || tools.brushSettings.useSwatchColor;
            } else if (tools.brushSettings.selectedCustomBrush) {
              // Look for custom brush in project's custom brushes from the store
              const currentState = useAppStore.getState();
              
              // First check temporary brush
              if (currentState.temporaryCustomBrush?.id === tools.brushSettings.selectedCustomBrush) {
                const tempBrush = currentState.temporaryCustomBrush;
                console.log('[DEBUG useDrawingHandlers] Using temporary brush:', {
                  id: tempBrush.id,
                  width: tempBrush.width,
                  height: tempBrush.height,
                  dataLength: tempBrush.imageData.data.length
                });
                customBrushImageData = tempBrush.imageData;
                customBrushWidth = tempBrush.width;
                customBrushHeight = tempBrush.height;
                isColorizable = tools.brushSettings.useSwatchColor;
              } else {
                // Then check saved custom brushes
                const customBrush = currentState.project?.customBrushes?.find(b => b.id === tools.brushSettings.selectedCustomBrush);
                if (customBrush) {
                  console.log('[DEBUG useDrawingHandlers] Using saved custom brush:', {
                    id: customBrush.id,
                    width: customBrush.width,
                    height: customBrush.height,
                    dataLength: customBrush.imageData.data.length
                  });
                  customBrushImageData = customBrush.imageData;
                  customBrushWidth = customBrush.width;
                  customBrushHeight = customBrush.height;
                  isColorizable = tools.brushSettings.useSwatchColor;
                }
              }
            }
          }
          
          if (isCustomBrush && customBrushImageData) {
            // Calculate scaled size based on brush settings
            const scaledSize = (tools.brushSettings.size / 100) * Math.max(customBrushWidth, customBrushHeight);
            
            // Create a pattern canvas at the scaled size
            const patternCanvas = document.createElement('canvas');
            patternCanvas.width = scaledSize;
            patternCanvas.height = scaledSize;
            const patternCtx = patternCanvas.getContext('2d');
            
            if (patternCtx) {
              // Create temp canvas for the original brush tip
              const tipCanvas = document.createElement('canvas');
              tipCanvas.width = customBrushWidth;
              tipCanvas.height = customBrushHeight;
              const tipCtx = tipCanvas.getContext('2d');
              
              if (tipCtx) {
                tipCtx.putImageData(customBrushImageData, 0, 0);
                
                // Apply color if the brush is colorizable
                if (isColorizable) {
                  tipCtx.globalCompositeOperation = 'source-atop';
                  tipCtx.fillStyle = tools.brushSettings.color;
                  tipCtx.fillRect(0, 0, tipCanvas.width, tipCanvas.height);
                }
                
                // Scale and draw to pattern canvas
                patternCtx.drawImage(tipCanvas, 0, 0, scaledSize, scaledSize);
                
                // Create pattern from the scaled brush
                const pattern = drawCtx.createPattern(patternCanvas, 'repeat');
                if (pattern) {
                  drawCtx.fillStyle = pattern;
                } else {
                  drawCtx.fillStyle = tools.brushSettings.color;
                }
              } else {
                drawCtx.fillStyle = tools.brushSettings.color;
              }
            } else {
              drawCtx.fillStyle = tools.brushSettings.color;
            }
          } else {
            // Use solid color for non-custom brushes or if custom brush not found
            drawCtx.fillStyle = tools.brushSettings.color;
          }

          drawCtx.beginPath();
          drawCtx.moveTo(shapePointsRef.current[0].x, shapePointsRef.current[0].y);
          for (let i = 1; i < shapePointsRef.current.length; i++) {
            drawCtx.lineTo(shapePointsRef.current[i].x, shapePointsRef.current[i].y);
          }
          drawCtx.closePath();
          drawCtx.fill();
          
          // Apply risograph effect if enabled (matching monolithic implementation)
          const risographIntensity = tools.brushSettings.risographIntensity || 0;
          if (risographIntensity > 0) {
            // Use GPU-accelerated risograph effect with cached pattern
            const pattern = getRisographPattern(drawCtx);
            
            if (pattern) {
              // Save current state
              drawCtx.save();
              
              // Add misregistration offset
              const effectStrength = risographIntensity / 100;
              const misregX = (Math.random() - 0.5) * effectStrength * 2;
              const misregY = (Math.random() - 0.5) * effectStrength * 2;
              drawCtx.translate(misregX, misregY);
              
              // Create clipping path for the polygon (with optional roughness)
              drawCtx.beginPath();
              drawCtx.moveTo(shapePointsRef.current[0].x, shapePointsRef.current[0].y);
              for (let i = 1; i < shapePointsRef.current.length; i++) {
                if (tools.brushSettings.risographOutline) {
                  // Add slight roughness to edges only if outline is enabled
                  const roughX = shapePointsRef.current[i].x + (Math.random() - 0.5) * effectStrength;
                  const roughY = shapePointsRef.current[i].y + (Math.random() - 0.5) * effectStrength;
                  drawCtx.lineTo(roughX, roughY);
                } else {
                  // Clean edges without roughness
                  drawCtx.lineTo(shapePointsRef.current[i].x, shapePointsRef.current[i].y);
                }
              }
              drawCtx.closePath();
              drawCtx.clip();
              
              // Apply texture with appropriate alpha based on brush type
              // Shape fills need stronger effect since they don't have overlapping stamps like strokes
              // Use higher multiplier to match visual strength of strokes
              const isPixelBrush = tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND || 
                (tools.brushSettings.brushShape === BrushShape.SQUARE && !tools.brushSettings.antialiasing);
              const risoAlpha = isPixelBrush ? 0.8 : 0.5;
              
              drawCtx.globalCompositeOperation = 'multiply';
              drawCtx.globalAlpha = effectStrength * risoAlpha;
              drawCtx.fillStyle = pattern;
              drawCtx.fillRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);
              
              // Restore state
              drawCtx.restore();
            }
          }
          
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