import { useCallback, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { useBrushEngineSimplified } from './useBrushEngineSimplified';
import { useUserBrushEngine } from './useUserBrushEngine';
import { BrushShape } from '../types';
import { getRisographPattern } from '../utils/risographTexture';
import { shouldApplyGridSnapPure, snapToGridPure, calculateGridSpacing } from '../hooks/brushEngine/utilities';
import { shouldDrawStamp, createPixelQueue } from '../hooks/brushEngine/strokeProcessor';

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
  const brushEngine = useBrushEngineSimplified();
  const userBrushEngine = useUserBrushEngine();
  const { captureCanvasToActiveLayer, saveCanvasState, tools } = useAppStore();
  
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawingCanvasHasContent = useRef(false);
  const isCapturing = useRef(false);
  const lastDrawPosRef = useRef<{ x: number; y: number } | null>(null);
  
  // Performance optimization: Throttling for stroke processing
  const strokeBatchRef = useRef<Array<{ pos: { x: number; y: number }, pressure: number }>>([]);
  const strokeBatchTimerRef = useRef<number | null>(null);
  const lastProcessedTimeRef = useRef<number>(0);
  const THROTTLE_MS = 8; // Process strokes at ~120fps max
  
  // OPTIMIZATION: The separate eraser mask canvas is no longer needed.
  // We will perform erasing directly on the drawingCanvas.
  
  const shapePointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const isDrawingShapeRef = useRef(false);
  
  // Store resampler brush data for the entire stroke
  const resamplerBrushDataRef = useRef<{
    imageData: ImageData;
    width: number;
    height: number;
    isColorizable: boolean;
    isResampler?: boolean;
  } | undefined>(undefined);
  
  // Track stamp count for continuous resampling
  const stampCounterRef = useRef<number>(0);
  
  // Animation frame for color cycle rendering
  const colorCycleAnimationRef = useRef<number | null>(null);
  
  // Track distance for color cycle stamp spacing
  const colorCycleDistanceRef = useRef<number>(0);
  const colorCycleLastPosRef = useRef<{ x: number; y: number } | null>(null);
  
  // Pixel queue for color cycle dashed pattern support
  const colorCyclePixelQueue = useRef(createPixelQueue());
  
  // Continuous animation for color cycle when play button is pressed
  const continuousColorCycleAnimationRef = useRef<number | null>(null);
  
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
    
    // Reset color cycle brush for new stroke and start animation
    if (currentState.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE) {
      // Don't set up callback here - let startContinuousColorCycleAnimation handle it
      brushEngine.resetColorCycle();
      
      // Reset distance tracking for consistent spacing
      colorCycleDistanceRef.current = 0;
      colorCycleLastPosRef.current = null;
      
      // Reset pixel queue for dashed pattern support
      colorCyclePixelQueue.current = createPixelQueue();
      
      // Start animation loop for rendering color cycle during drawing
      // This will continuously update the animation while drawing
      let lastRenderTime = 0;
      const targetFPS = 24;
      const frameInterval = 1000 / targetFPS;
      
      const animateWhileDrawing = (timestamp: number) => {
        // Only animate if we're still in color cycle mode
        if (!colorCycleAnimationRef.current) return;
        
        if (timestamp - lastRenderTime >= frameInterval) {
          if (drawingCtxRef.current && drawingCanvasRef.current) {
            // Clear and render the animated color cycle
            drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
            brushEngine.renderColorCycle(drawingCtxRef.current, true); // true = apply opacity
            drawingCanvasHasContent.current = true;
          }
          lastRenderTime = timestamp;
        }
        
        colorCycleAnimationRef.current = requestAnimationFrame(animateWhileDrawing);
      };
      
      // Start the animation
      colorCycleAnimationRef.current = requestAnimationFrame(animateWhileDrawing);
    }
    
    // Reset stamp counter for continuous sampling
    stampCounterRef.current = 0;
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
        // Check if we're using a custom brush or resampler
        let customBrushData = undefined;
        
        // Handle Color Cycle brush - only paints to WebGL buffer
        if (currentState.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE) {
          brushEngine.drawColorCycle(drawCtx, worldPos.x, worldPos.y, pressure);
          colorCycleLastPosRef.current = worldPos;
          // Rendering happens in the animation loop, not here
        } else if (currentState.tools.brushSettings.brushShape === BrushShape.RESAMPLER && 
            !currentState.tools.brushSettings.continuousSampling) {
          // Use the exact same approach as CustomBrushPanel for capturing
          const brushSize = currentState.tools.brushSettings.size || 20;
          const halfSize = brushSize / 2;
          
          
          const compositeCanvas = currentState.currentOffscreenCanvas;
          if (compositeCanvas) {
            // Calculate bounds exactly like CustomBrushPanel
            const minX = Math.floor(worldPos.x - halfSize);
            const minY = Math.floor(worldPos.y - halfSize);
            const maxX = Math.floor(worldPos.x + halfSize);
            const maxY = Math.floor(worldPos.y + halfSize);
            
            // Clamp to canvas bounds
            const sampleX = Math.max(0, minX);
            const sampleY = Math.max(0, minY);
            const sampleEndX = Math.min(compositeCanvas.width, maxX);
            const sampleEndY = Math.min(compositeCanvas.height, maxY);
            const width = sampleEndX - sampleX;
            const height = sampleEndY - sampleY;
            
            if (width > 0 && height > 0) {
              // Create canvas to capture the selection - EXACTLY like CustomBrushPanel
              const captureCanvas = document.createElement('canvas');
              captureCanvas.width = width;
              captureCanvas.height = height;
              const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
              
              if (captureCtx) {
                // Capture the selection area from the composite canvas
                try {
                  captureCtx.drawImage(
                    compositeCanvas,
                    sampleX, sampleY, width, height, // Source rectangle
                    0, 0, width, height              // Destination rectangle
                  );
                  
                  // Get ImageData for the brush
                  const imageData = captureCtx.getImageData(0, 0, width, height);
                  
                  customBrushData = {
                    imageData,
                    width,
                    height,
                    isColorizable: false, // Resampler uses sampled colors as-is
                    isResampler: true // Flag to identify resampler brush data
                  } as any;
                  
                  // Store for the entire stroke
                  resamplerBrushDataRef.current = customBrushData;
                  
                  // DON'T change brush size - keep it as is so the sample matches cursor size
                  // The captured area is already the right size based on current brush size
                  
                } catch (e) {
                  console.warn('Failed to sample canvas for Resampler brush:', e);
                }
              }
            }
          }
        } else if (currentState.tools.brushSettings.brushShape === BrushShape.CUSTOM) {
          // Try to get custom brush from currentBrushTip first
          if (currentState.tools.brushSettings.currentBrushTip) {
            const brushTip = currentState.tools.brushSettings.currentBrushTip;
            customBrushData = {
              imageData: brushTip.imageData,
              width: brushTip.width || brushTip.imageData.width,
              height: brushTip.height || brushTip.imageData.height,
              isColorizable: brushTip.isColorizable || currentState.tools.brushSettings.useSwatchColor
            };
          } else if (currentState.tools.brushSettings.selectedCustomBrush) {
            // Look for custom brush in project's custom brushes
            if (currentState.temporaryCustomBrush?.id === currentState.tools.brushSettings.selectedCustomBrush) {
              const tempBrush = currentState.temporaryCustomBrush;
              customBrushData = {
                imageData: tempBrush.imageData,
                width: tempBrush.width,
                height: tempBrush.height,
                isColorizable: currentState.tools.brushSettings.useSwatchColor
              };
            } else {
              const customBrush = currentState.project?.customBrushes?.find(b => b.id === currentState.tools.brushSettings.selectedCustomBrush);
              if (customBrush) {
                customBrushData = {
                  imageData: customBrush.imageData,
                  width: customBrush.width,
                  height: customBrush.height,
                  isColorizable: currentState.tools.brushSettings.useSwatchColor
                };
              }
            }
          }
        }
        
        brushEngine.drawBrush(
          drawCtx,
          worldPos,
          worldPos,
          { pressure, customBrushData }
        );
      }
    }
    
    // Initial point drawn - parent component will handle redraw
  }, [initDrawingCanvas, brushEngine, userBrushEngine, project, drawEraserSegment]);

  // Process batched stroke points
  const processBatchedStrokes = useCallback(() => {
    const batch = strokeBatchRef.current;
    if (batch.length === 0) return;
    
    const currentState = useAppStore.getState();
    const currentTool = currentState.tools.currentTool;
    const currentBrushId = currentState.currentBrushPreset?.id;
    const drawCtx = drawingCtxRef.current;
    
    if (!drawCtx || !project) {
      strokeBatchRef.current = [];
      return;
    }
    
    const boundary = { x: 0, y: 0, width: project.width, height: project.height };
    
    // Process all points in the batch
    for (let i = 0; i < batch.length; i++) {
      const { pos: worldPos, pressure } = batch[i];
      const lastPoint = lastDrawPosRef.current;
      
      if (!lastPoint) {
        lastDrawPosRef.current = worldPos;
        continue;
      }
      
      const clippedSegment = clipLineSegment(lastPoint, worldPos, boundary);
      
      if (clippedSegment) {
        const [clippedStart, clippedEnd] = clippedSegment;
        
        if (currentTool === 'eraser') {
          drawEraserSegment(drawCtx, clippedStart, clippedEnd);
        } else {
          if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
            userBrushEngine.continueStroke(drawCtx, clippedEnd.x, clippedEnd.y, pressure);
          } else if (brushEngine) {
            drawCtx.globalAlpha = 1.0;
            drawCtx.globalCompositeOperation = 'source-over';
            
            // Check if we're using a custom brush or resampler
            let customBrushData = undefined;
            
            // Check for Color Cycle brush with stroke processor features
            if (currentState.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE) {
              // Use the spacing setting from brush controls, defaulting to 25% of size
              const spacingPercent = (currentState.tools.brushSettings.spacing || 25) / 100;
              const spacing = (currentState.tools.brushSettings.size || 20) * spacingPercent;
              
              if (colorCycleLastPosRef.current) {
                const dx = clippedEnd.x - colorCycleLastPosRef.current.x;
                const dy = clippedEnd.y - colorCycleLastPosRef.current.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                colorCycleDistanceRef.current += distance;
                
                // Calculate rotation if enabled
                const rotation = currentState.tools.brushSettings.rotationEnabled 
                  ? Math.atan2(dy, dx) 
                  : 0;
                
                // Draw stamps at consistent intervals with stroke processor features
                while (colorCycleDistanceRef.current >= spacing) {
                  const t = 1 - (colorCycleDistanceRef.current - spacing) / distance;
                  let stampX = colorCycleLastPosRef.current.x + dx * t;
                  let stampY = colorCycleLastPosRef.current.y + dy * t;
                  
                  // Apply grid snapping if enabled
                  if (shouldApplyGridSnapPure(currentState.tools.brushSettings)) {
                    const gridSpacing = calculateGridSpacing(currentState.tools.brushSettings);
                    const snapped = snapToGridPure(stampX, stampY, gridSpacing);
                    stampX = snapped.x;
                    stampY = snapped.y;
                  }
                  
                  // Check dashed pattern before drawing
                  if (shouldDrawStamp(currentState.tools.brushSettings, colorCyclePixelQueue.current, currentState.tools.brushSettings.size)) {
                    // TODO: Rotation support requires ColorCycleBrush.ts modification to accept rotation parameter
                    // and update the WebGL shader to apply rotation transformation to stamps
                    // For now, we calculate rotation but don't apply it
                    if (currentState.tools.brushSettings.rotationEnabled && rotation !== 0) {
                      // Future: brushEngine.drawColorCycle(drawCtx, stampX, stampY, pressure, rotation);
                      brushEngine.drawColorCycle(drawCtx, stampX, stampY, pressure);
                    } else {
                      brushEngine.drawColorCycle(drawCtx, stampX, stampY, pressure);
                    }
                  }
                  
                  colorCycleDistanceRef.current -= spacing;
                }
              }
              
              colorCycleLastPosRef.current = clippedEnd;
            } else if (currentState.tools.brushSettings.brushShape === BrushShape.RESAMPLER) {
              if (currentState.tools.brushSettings.continuousSampling) {
                // Continuous sampling mode - check if we need to resample
                stampCounterRef.current++;
                const resampleInterval = currentState.tools.brushSettings.resampleInterval || 5;
                
                // Resample when counter reaches interval or if we don't have data yet
                if (stampCounterRef.current >= resampleInterval || !resamplerBrushDataRef.current) {
                  // Reset counter
                  stampCounterRef.current = 0;
                  
                  // Capture new sample at current position
                  const brushSize = currentState.tools.brushSettings.size || 20;
                  const halfSize = brushSize / 2;
                  const compositeCanvas = currentState.currentOffscreenCanvas;
                  
                  if (compositeCanvas) {
                    // Use clippedEnd position for sampling
                    const samplePos = clippedEnd;
                    
                    // Calculate bounds
                    const minX = Math.floor(samplePos.x - halfSize);
                    const minY = Math.floor(samplePos.y - halfSize);
                    const maxX = Math.floor(samplePos.x + halfSize);
                    const maxY = Math.floor(samplePos.y + halfSize);
                    
                    // Clamp to canvas bounds
                    const sampleX = Math.max(0, minX);
                    const sampleY = Math.max(0, minY);
                    const sampleEndX = Math.min(compositeCanvas.width, maxX);
                    const sampleEndY = Math.min(compositeCanvas.height, maxY);
                    const width = sampleEndX - sampleX;
                    const height = sampleEndY - sampleY;
                    
                    if (width > 0 && height > 0) {
                      // Create canvas to capture the selection
                      const captureCanvas = document.createElement('canvas');
                      captureCanvas.width = width;
                      captureCanvas.height = height;
                      const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
                      
                      if (captureCtx) {
                        // Capture the selection area from the composite canvas
                        try {
                          captureCtx.drawImage(
                            compositeCanvas,
                            sampleX, sampleY, width, height, // Source rectangle
                            0, 0, width, height              // Destination rectangle
                          );
                          
                          // Get ImageData for the brush
                          const imageData = captureCtx.getImageData(0, 0, width, height);
                          
                          resamplerBrushDataRef.current = {
                            imageData,
                            width,
                            height,
                            isColorizable: false, // Resampler uses sampled colors as-is
                            isResampler: true // Flag to identify resampler brush data
                          } as any;
                        } catch (e) {
                          console.warn('Failed to sample canvas for continuous Resampler:', e);
                        }
                      }
                    }
                  }
                }
                
                // Use the current resampler data
                if (resamplerBrushDataRef.current) {
                  customBrushData = resamplerBrushDataRef.current as any; // Type assertion for isResampler flag
                }
              } else if (resamplerBrushDataRef.current) {
                // Single sample mode - use the stored resampler data for the entire stroke
                customBrushData = resamplerBrushDataRef.current as any; // Type assertion for isResampler flag
              }
            } else if (currentState.tools.brushSettings.brushShape === BrushShape.CUSTOM) {
              // Try to get custom brush from currentBrushTip first
              if (currentState.tools.brushSettings.currentBrushTip) {
                const brushTip = currentState.tools.brushSettings.currentBrushTip;
                customBrushData = {
                  imageData: brushTip.imageData,
                  width: brushTip.width || brushTip.imageData.width,
                  height: brushTip.height || brushTip.imageData.height,
                  isColorizable: brushTip.isColorizable || currentState.tools.brushSettings.useSwatchColor
                };
              } else if (currentState.tools.brushSettings.selectedCustomBrush) {
                // Look for custom brush in project's custom brushes
                if (currentState.temporaryCustomBrush?.id === currentState.tools.brushSettings.selectedCustomBrush) {
                  const tempBrush = currentState.temporaryCustomBrush;
                  customBrushData = {
                    imageData: tempBrush.imageData,
                    width: tempBrush.width,
                    height: tempBrush.height,
                    isColorizable: currentState.tools.brushSettings.useSwatchColor
                  };
                } else {
                  const customBrush = currentState.project?.customBrushes?.find(b => b.id === currentState.tools.brushSettings.selectedCustomBrush);
                  if (customBrush) {
                    customBrushData = {
                      imageData: customBrush.imageData,
                      width: customBrush.width,
                      height: customBrush.height,
                      isColorizable: currentState.tools.brushSettings.useSwatchColor
                    };
                  }
                }
              }
            }
            
            brushEngine.drawBrush(
              drawCtx,
              clippedStart,
              clippedEnd,
              { pressure, customBrushData }
            );
          }
        }
      }
      
      lastDrawPosRef.current = worldPos;
    }
    
    // Clear the batch
    strokeBatchRef.current = [];
    strokeBatchTimerRef.current = null;
  }, [brushEngine, userBrushEngine, project, drawEraserSegment]);

  const continueDrawing = useCallback((worldPos: { x: number; y: number }, pressure: number = 0.5) => {
    const now = performance.now();
    
    // Add to batch
    strokeBatchRef.current.push({ pos: worldPos, pressure });
    
    // Check if we should process immediately (throttling)
    if (now - lastProcessedTimeRef.current >= THROTTLE_MS) {
      // Process immediately
      processBatchedStrokes();
      lastProcessedTimeRef.current = now;
    } else {
      // Schedule batch processing if not already scheduled
      if (!strokeBatchTimerRef.current) {
        strokeBatchTimerRef.current = window.requestAnimationFrame(() => {
          processBatchedStrokes();
          lastProcessedTimeRef.current = performance.now();
        });
      }
    }
  }, [processBatchedStrokes]);
  
  const finalizeDrawing = useCallback(async () => {
    if (isBusyRef?.current || !drawingCanvasRef.current || !drawingCanvasHasContent.current || !project) return;
    
    try {
      if (isBusyRef) isBusyRef.current = true;
      
      // Process any remaining batched strokes
      if (strokeBatchRef.current.length > 0) {
        processBatchedStrokes();
      }
      
      // Cancel any pending batch timer
      if (strokeBatchTimerRef.current) {
        cancelAnimationFrame(strokeBatchTimerRef.current);
        strokeBatchTimerRef.current = null;
      }
      
      lastDrawPosRef.current = null;
      
      // Clear resampler data and reset counter after stroke ends
      resamplerBrushDataRef.current = undefined;
      stampCounterRef.current = 0;

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
          
          // For color cycle brush, stop the animation and do final render
          if (activeSettings.brushShape === BrushShape.COLOR_CYCLE && drawingCtxRef.current) {
            // Stop animation loop
            if (colorCycleAnimationRef.current) {
              cancelAnimationFrame(colorCycleAnimationRef.current);
              colorCycleAnimationRef.current = null;
            }
            
            // End stroke and do final render
            brushEngine.endColorCycleStroke();
            
            // Clear and do one final render at FULL OPACITY
            drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
            brushEngine.renderColorCycle(drawingCtxRef.current, false); // false = don't apply opacity
          }
          
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
            
            // Clean up temporary canvas to prevent memory leak
            tempCanvas.width = 1;
            tempCanvas.height = 1;
            tempCtx.clearRect(0, 0, 1, 1);
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
  }, [project, captureCanvasToActiveLayer, saveCanvasState, isBusyRef, userBrushEngine, brushEngine, tools.shapeMode, processBatchedStrokes]);
  
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
          
          // Check if we're using a pixel brush - need crisp edges
          const isPixelBrush = tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND || 
            (tools.brushSettings.brushShape === BrushShape.SQUARE && !tools.brushSettings.antialiasing);
          
          // Set ALL smoothing properties to ensure pixel-perfect shapes
          if (isPixelBrush) {
            drawCtx.imageSmoothingEnabled = false;
            // Force pixel-perfect rendering by disabling all smoothing algorithms
            if ('imageSmoothingQuality' in drawCtx) {
              (drawCtx as any).imageSmoothingQuality = 'low';
            }
          } else {
            drawCtx.imageSmoothingEnabled = true;
            if ('imageSmoothingQuality' in drawCtx) {
              (drawCtx as any).imageSmoothingQuality = 'high';
            }
          }
          
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
                customBrushImageData = tempBrush.imageData;
                customBrushWidth = tempBrush.width;
                customBrushHeight = tempBrush.height;
                isColorizable = tools.brushSettings.useSwatchColor;
              } else {
                // Then check saved custom brushes
                const customBrush = currentState.project?.customBrushes?.find(b => b.id === tools.brushSettings.selectedCustomBrush);
                if (customBrush) {
                  customBrushImageData = customBrush.imageData;
                  customBrushWidth = customBrush.width;
                  customBrushHeight = customBrush.height;
                  isColorizable = tools.brushSettings.useSwatchColor;
                }
              }
            }
          }
          
          if (isCustomBrush && customBrushImageData) {
            // Calculate scaled size based on brush settings, maintaining aspect ratio
            const scale = tools.brushSettings.size / 100;
            const scaledWidth = Math.round(customBrushWidth * scale);
            const scaledHeight = Math.round(customBrushHeight * scale);
            
            // Create a pattern canvas at the scaled size
            const patternCanvas = document.createElement('canvas');
            patternCanvas.width = scaledWidth;
            patternCanvas.height = scaledHeight;
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
                patternCtx.drawImage(tipCanvas, 0, 0, scaledWidth, scaledHeight);
                
                // Create pattern from the scaled brush
                const pattern = drawCtx.createPattern(patternCanvas, 'repeat');
                if (pattern) {
                  drawCtx.fillStyle = pattern;
                } else {
                  drawCtx.fillStyle = tools.brushSettings.color;
                }
                
                // Clean up tip canvas to prevent memory leak
                tipCanvas.width = 1;
                tipCanvas.height = 1;
                tipCtx.clearRect(0, 0, 1, 1);
              } else {
                drawCtx.fillStyle = tools.brushSettings.color;
              }
              
              // Clean up pattern canvas to prevent memory leak
              patternCanvas.width = 1;
              patternCanvas.height = 1;
              patternCtx.clearRect(0, 0, 1, 1);
            } else {
              drawCtx.fillStyle = tools.brushSettings.color;
              
              // Clean up pattern canvas even if context failed
              patternCanvas.width = 1;
              patternCanvas.height = 1;
            }
          } else {
            // Use solid color for non-custom brushes or if custom brush not found
            drawCtx.fillStyle = tools.brushSettings.color;
          }

          drawCtx.beginPath();
          if (isPixelBrush) {
            // For pixel brushes, snap all coordinates to integer pixels for crisp edges
            drawCtx.moveTo(Math.round(shapePointsRef.current[0].x), Math.round(shapePointsRef.current[0].y));
            for (let i = 1; i < shapePointsRef.current.length; i++) {
              drawCtx.lineTo(Math.round(shapePointsRef.current[i].x), Math.round(shapePointsRef.current[i].y));
            }
          } else {
            // Use original coordinates for smooth brushes
            drawCtx.moveTo(shapePointsRef.current[0].x, shapePointsRef.current[0].y);
            for (let i = 1; i < shapePointsRef.current.length; i++) {
              drawCtx.lineTo(shapePointsRef.current[i].x, shapePointsRef.current[i].y);
            }
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
              if (isPixelBrush) {
                // For pixel brushes, use pixel-aligned coordinates
                drawCtx.moveTo(Math.round(shapePointsRef.current[0].x), Math.round(shapePointsRef.current[0].y));
                for (let i = 1; i < shapePointsRef.current.length; i++) {
                  if (tools.brushSettings.risographOutline) {
                    // Add slight roughness to edges only if outline is enabled
                    const roughX = Math.round(shapePointsRef.current[i].x + (Math.random() - 0.5) * effectStrength);
                    const roughY = Math.round(shapePointsRef.current[i].y + (Math.random() - 0.5) * effectStrength);
                    drawCtx.lineTo(roughX, roughY);
                  } else {
                    // Clean edges without roughness, pixel-aligned
                    drawCtx.lineTo(Math.round(shapePointsRef.current[i].x), Math.round(shapePointsRef.current[i].y));
                  }
                }
              } else {
                // For smooth brushes, use original coordinates
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
              }
              drawCtx.closePath();
              drawCtx.clip();
              
              // Apply texture with appropriate alpha based on brush type
              // Shape fills need stronger effect since they don't have overlapping stamps like strokes
              // Use higher multiplier to match visual strength of strokes
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
  
  // Start continuous color cycle animation (for when play button is pressed)
  const startContinuousColorCycleAnimation = useCallback(() => {
    
    // Stop any existing continuous animation
    if (continuousColorCycleAnimationRef.current) {
      cancelAnimationFrame(continuousColorCycleAnimationRef.current);
      continuousColorCycleAnimationRef.current = null;
    }
    
    // Initialize drawing canvas if needed
    if (!drawingCanvasRef.current || !drawingCtxRef.current) {
      console.log('[DrawingHandlers] Initializing drawing canvas for color cycle');
      initDrawingCanvas();
    }
    
    // Check again after initialization
    if (!drawingCtxRef.current || !drawingCanvasRef.current) {
      console.error('[DrawingHandlers] Failed to initialize drawing canvas');
      return;
    }
    
    // Ensure color cycle brush exists and is not in drawing mode
    brushEngine.ensureColorCycleBrush();
    
    // Resume the color cycle brush animation (don't toggle, just ensure it's playing)
    if (!brushEngine.isColorCycleAnimating()) {
      brushEngine.toggleColorCycleAnimation();
    }
    
    // Mark that the drawing canvas has content so it gets rendered
    drawingCanvasHasContent.current = true;
    
    let lastRenderTime = 0;
    const targetFPS = 30; // Increased for smoother animation
    const frameInterval = 1000 / targetFPS;
    
    // Store the animation state on the ref so stop can access it
    (continuousColorCycleAnimationRef as any).isAnimating = true;
    
    const animateContinuousColorCycle = (timestamp: number) => {
      // IMMEDIATELY schedule the next frame to ensure continuity
      if ((continuousColorCycleAnimationRef as any).isAnimating) {
        continuousColorCycleAnimationRef.current = requestAnimationFrame(animateContinuousColorCycle);
      } else {
        continuousColorCycleAnimationRef.current = null;
        return;
      }
      
      // Then do the rendering work
      if (timestamp - lastRenderTime >= frameInterval) {
        if (drawingCtxRef.current && drawingCanvasRef.current) {
          // Update the color cycle animation state manually
          // This ensures the animation progresses even without mouse events
          brushEngine.updateColorCycleAnimation?.();
          
          // Clear the drawing canvas
          drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
          // Render all color cycle strokes with preview opacity
          brushEngine.renderColorCycle(drawingCtxRef.current, true); // true = apply opacity for preview
          
          // Mark that we have content to ensure it gets composited
          drawingCanvasHasContent.current = true;
        }
        lastRenderTime = timestamp;
      }
    };
    
    // Start the animation
    continuousColorCycleAnimationRef.current = requestAnimationFrame(animateContinuousColorCycle);
  }, [brushEngine, initDrawingCanvas]);
  
  // Stop continuous color cycle animation
  const stopContinuousColorCycleAnimation = useCallback(() => {
    // Set the flag to stop animation
    if (continuousColorCycleAnimationRef.current) {
      (continuousColorCycleAnimationRef as any).isAnimating = false;
      cancelAnimationFrame(continuousColorCycleAnimationRef.current);
      continuousColorCycleAnimationRef.current = null;
    }
    
    // Pause the brush animation (don't toggle, just ensure it's paused)
    if (brushEngine.isColorCycleAnimating()) {
      brushEngine.toggleColorCycleAnimation();
    }
    
    // Clear the drawing canvas when animation stops
    if (drawingCtxRef.current && drawingCanvasRef.current) {
      drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
      drawingCanvasHasContent.current = false;
    }
  }, [brushEngine]);
  
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
    startContinuousColorCycleAnimation,
    stopContinuousColorCycleAnimation,
  };
}