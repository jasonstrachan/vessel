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
  const { captureCanvasToActiveLayer, saveCanvasState, tools, layers, activeLayerId } = useAppStore();
  
  // Feedback message state
  const feedbackMessageRef = useRef<((message: string) => void) | null>(null);
  
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
    
    // Early return if no project
    if (!project) return;
    
    // Layer type handling and validation
    let activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
    if (activeLayer) {
      // Prevent drawing on hidden layers - show cursor but don't draw
      if (!activeLayer.visible) {
        return; // Exit silently, cursor will still show
      }
      const isColorCycleBrush = currentState.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE;
      
      // If layer has no type yet, convert it based on first stroke
      if (!activeLayer.layerType) {
        if (isColorCycleBrush) {
          // Convert to CC layer with current gradient
          const gradient = currentState.tools.brushSettings.colorCycleGradient || [
            { position: 0.0, color: '#ff0000' },
            { position: 0.17, color: '#ff7f00' },
            { position: 0.33, color: '#ffff00' },
            { position: 0.5, color: '#00ff00' },
            { position: 0.67, color: '#0000ff' },
            { position: 0.83, color: '#4b0082' },
            { position: 1.0, color: '#9400d3' }
          ];
          
          // PRESERVE EXISTING CONTENT: Store current imageData before conversion
          const existingImageData = activeLayer.imageData;
          
          // Update layer to be CC type
          currentState.updateLayer(activeLayer.id, {
            layerType: 'color-cycle',
            colorCycleData: {
              gradient: gradient,
              isAnimating: true
            }
          });
          
          // Initialize the Canvas2D Color Cycle brush for this layer
          currentState.initColorCycleForLayer(activeLayer.id, project.width, project.height);
          
          // PRESERVE CONTENT: If there was existing content, restore it after conversion
          if (existingImageData) {
            // The layer still has its imageData, it's preserved in the updateLayer
            // We just need to ensure the framebuffer is updated
            const updatedLayer = useAppStore.getState().layers.find(l => l.id === activeLayer?.id);
            if (updatedLayer?.framebuffer) {
              const fbCtx = updatedLayer.framebuffer.getContext('2d');
              if (fbCtx) {
                fbCtx.putImageData(existingImageData, 0, 0);
              }
            }
          }
          
          // Refresh the active layer reference after update
          activeLayer = useAppStore.getState().layers.find(l => l.id === currentState.activeLayerId);
        } else {
          // PRESERVE EXISTING CONTENT: Store current imageData before conversion
          const existingImageData = activeLayer.imageData;
          
          // If converting from color-cycle, capture the current CC canvas content
          if (activeLayer.layerType === 'color-cycle' && activeLayer.colorCycleData?.canvas) {
            const ccCanvas = activeLayer.colorCycleData.canvas;
            const tempCtx = document.createElement('canvas').getContext('2d');
            if (tempCtx && ccCanvas) {
              tempCtx.canvas.width = ccCanvas.width;
              tempCtx.canvas.height = ccCanvas.height;
              
              // Render the final state of the color cycle
              if (activeLayer.colorCycleData.colorCycleBrush) {
                activeLayer.colorCycleData.colorCycleBrush.renderDirectToCanvas(tempCtx.canvas, activeLayer.id);
              } else {
                tempCtx.drawImage(ccCanvas, 0, 0);
              }
              
              const ccImageData = tempCtx.getImageData(0, 0, ccCanvas.width, ccCanvas.height);
              
              // Clean up the color cycle resources BEFORE converting
              if (activeLayer.colorCycleData.colorCycleBrush) {
                activeLayer.colorCycleData.colorCycleBrush.destroy();
              }
              
              // Convert to normal layer
              currentState.updateLayer(activeLayer.id, {
                layerType: 'normal',
                imageData: ccImageData // Preserve the CC content
              });
            } else {
              // Fallback: just convert with existing imageData
              currentState.updateLayer(activeLayer.id, {
                layerType: 'normal'
              });
            }
          } else {
            // Convert to normal layer
            currentState.updateLayer(activeLayer.id, {
              layerType: 'normal'
            });
          }
          
          // PRESERVE CONTENT: If there was existing content, ensure it's preserved
          if (existingImageData) {
            const updatedLayer = useAppStore.getState().layers.find(l => l.id === activeLayer?.id);
            if (updatedLayer?.framebuffer && !updatedLayer.imageData) {
              // Only restore if we don't already have imageData from CC conversion
              const fbCtx = updatedLayer.framebuffer.getContext('2d');
              if (fbCtx) {
                fbCtx.putImageData(existingImageData, 0, 0);
                currentState.updateLayer(activeLayer.id, { imageData: existingImageData });
              }
            }
          }
          
          // Refresh the active layer reference after update
          activeLayer = useAppStore.getState().layers.find(l => l.id === currentState.activeLayerId);
        }
      } else {
        // Layer already has a type, validate compatibility
        const isColorCycleLayer = activeLayer.layerType === 'color-cycle';
        
        // Check for incompatible combinations
        if (isColorCycleBrush && !isColorCycleLayer) {
          // CC brush on normal layer
          if (feedbackMessageRef.current) {
            feedbackMessageRef.current("Can't use Color Cycle brush on a normal layer. Create a new layer.");
          }
          return; // Block drawing
        }
        
        if (!isColorCycleBrush && isColorCycleLayer && currentTool !== 'eraser') {
          // Normal brush on CC layer (allow eraser on any layer)
          if (feedbackMessageRef.current) {
            feedbackMessageRef.current("Can't use regular brushes on a Color Cycle layer. Switch layers.");
          }
          return; // Block drawing
        }
        
        // Check gradient compatibility for CC layers
        if (isColorCycleBrush && isColorCycleLayer) {
          // Ensure the CC layer has Canvas2D brush initialized
          if (!activeLayer.colorCycleData?.colorCycleBrush) {
            // Initialize it now if needed
            currentState.initColorCycleForLayer(activeLayer.id, project.width, project.height);
          }
          
          const brushGradient = currentState.tools.brushSettings.colorCycleGradient;
          const layerGradient = activeLayer.colorCycleData?.gradient;
          
          if (brushGradient && layerGradient) {
            // Compare gradients
            const gradientsMatch = JSON.stringify(brushGradient) === JSON.stringify(layerGradient);
            if (!gradientsMatch) {
              if (feedbackMessageRef.current) {
                feedbackMessageRef.current("This layer uses a different gradient");
              }
              return; // Block drawing
            }
          }
        }
      }
    }
    
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
            // Clear once for all layers
            drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
            
            // Inline render for color cycle layers to avoid closure issues
            const currentState = useAppStore.getState();
            let hasRendered = false;
            
            // Check active layer for color cycle
            const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
            if (activeLayer?.visible && activeLayer.layerType === 'color-cycle' && 
                activeLayer.colorCycleData?.colorCycleBrush && activeLayer.colorCycleData?.canvas) {
              
              const colorCycleBrush = activeLayer.colorCycleData.colorCycleBrush;
              
              // Update and render
              colorCycleBrush.updateAnimation();
              colorCycleBrush.renderDirectToCanvas(activeLayer.colorCycleData.canvas, activeLayer.id);
              
              // Draw to drawing canvas
              drawingCtxRef.current.globalAlpha = tools.brushSettings.opacity || 1;
              drawingCtxRef.current.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';
              drawingCtxRef.current.drawImage(activeLayer.colorCycleData.canvas, 0, 0);
              hasRendered = true;
            }
            
            // If no color cycle layer was found, fallback to legacy
            if (!hasRendered) {
              brushEngine.renderColorCycle(drawingCtxRef.current, true);
            }
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
        
        // Handle Color Cycle brush - only paints to Canvas2D buffer
        if (currentState.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE) {
          // SAFETY CHECK: Verify we're on a compatible CC layer with matching gradient
          // This prevents crashes when continueDrawing is called after startDrawing blocked
          const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
          const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
          
          if (isColorCycleLayer) {
            // Also check gradient compatibility
            const brushGradient = currentState.tools.brushSettings.colorCycleGradient;
            const layerGradient = activeLayer.colorCycleData?.gradient;
            const gradientsMatch = !brushGradient || !layerGradient || 
                                  JSON.stringify(brushGradient) === JSON.stringify(layerGradient);
            
            if (gradientsMatch) {
              brushEngine.drawColorCycle(drawCtx, worldPos.x, worldPos.y, pressure);
              colorCycleLastPosRef.current = worldPos;
              // Rendering happens in the animation loop, not here
            }
            // If gradients don't match, silently skip drawing (warning was already shown in startDrawing)
          }
          // If not a CC layer, silently skip (warning was already shown in startDrawing)
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
              // GUARD: Verify layer compatibility before calling color cycle functions
              const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
              const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
              
              if (!isColorCycleLayer && activeLayer?.layerType) {
                // Color cycle brush on non-CC layer - skip processing to prevent crash
                continue; // Skip this batch item and continue with next
              }
              
              // GUARD: Also check gradient compatibility
              if (isColorCycleLayer) {
                const brushGradient = currentState.tools.brushSettings.colorCycleGradient;
                const layerGradient = activeLayer.colorCycleData?.gradient;
                const gradientsMatch = !brushGradient || !layerGradient || 
                                      JSON.stringify(brushGradient) === JSON.stringify(layerGradient);
                
                if (!gradientsMatch) {
                  // Wrong gradient - skip processing to prevent crash
                  continue; // Skip this batch item and continue with next
                }
              }
              
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
                    // TODO: Rotation support requires ColorCycleBrush modification to accept rotation parameter
                    // and update the Canvas2D rendering to apply rotation transformation to stamps
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
    // Check if layer is still visible before continuing drawing
    const currentState = useAppStore.getState();
    const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
    if (activeLayer && !activeLayer.visible) {
      return; // Exit silently if layer became hidden mid-stroke
    }
    
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
            
            // Phase 3: Direct rendering approach
            const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
            const colorCycleBrush = activeLayer?.colorCycleData?.colorCycleBrush;
            
            if (colorCycleBrush && activeLayer?.colorCycleData?.canvas) {
              // Final render directly to layer canvas at full opacity
              colorCycleBrush.renderDirectToCanvas(activeLayer.colorCycleData.canvas, activeLayer.id);
              
              // Copy to drawing canvas for final composite
              drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
              drawingCtxRef.current.globalAlpha = 1.0; // Full opacity for final
              drawingCtxRef.current.drawImage(activeLayer.colorCycleData.canvas, 0, 0);
            } else {
              // Fallback: Clear and do one final render at FULL OPACITY
              drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
              brushEngine.renderColorCycle(drawingCtxRef.current, false); // false = don't apply opacity
            }
            
            // IMPORTANT: Check if we should continue animating after stroke ends
            // The animation should continue if the play button is active
            // We'll rely on the DrawingCanvas to restart it based on UI state
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
    // Check if layer is still visible before continuing shape drawing
    const currentState = useAppStore.getState();
    const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
    if (activeLayer && !activeLayer.visible) {
      return; // Exit silently if layer became hidden mid-stroke
    }
    
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
          
          // For color cycle brush, we need to fill the shape and render it
          if (tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE && drawCtx) {
            // Don't stop the animation - let it continue if it's playing
            // We'll just add the shape to the color cycle layers
            
            // Reset and fill the shape with color cycle gradient
            brushEngine.resetColorCycle();
            
            // Fill the shape with gradient
            if (shapePointsRef.current.length >= 3) {
              brushEngine.fillColorCycleShape(shapePointsRef.current);
            }
            
            // CRITICAL FIX: Force immediate texture update and render after filling shape
            const currentState = useAppStore.getState();
            const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
            const activeLayerId = activeLayer?.id;
            if (activeLayerId) {
              brushEngine.updateColorCycleTexture(activeLayerId);
              
              // Force the color cycle brush to render its content immediately
              const colorCycleBrush = currentState.getLayerColorCycleBrush(activeLayerId);
              if (colorCycleBrush) {
                colorCycleBrush.render(true); // Force full render
              }
            }
            
            // Clear and do one final render at FULL OPACITY
            if (drawingCanvasRef.current) {
              drawCtx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
              brushEngine.renderColorCycle(drawCtx, false); // false = don't apply opacity
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
  
  // Helper function to render all visible color cycle layers
  const renderAllColorCycleLayers = useCallback((targetCtx: CanvasRenderingContext2D, onlyActiveLayer: boolean = false) => {
    const currentState = useAppStore.getState();
    let hasRendered = false;
    
    // Iterate through all layers and render color cycles
    currentState.layers.forEach(layer => {
      // Skip if we only want active layer and this isn't it
      if (onlyActiveLayer && layer.id !== currentState.activeLayerId) {
        return;
      }
      
      // Check if layer has color cycle and is visible
      if (layer.visible && layer.layerType === 'color-cycle' && 
          layer.colorCycleData?.colorCycleBrush && layer.colorCycleData?.canvas) {
        
        const colorCycleBrush = layer.colorCycleData.colorCycleBrush;
        
        // Update animation for this layer's brush
        colorCycleBrush.updateAnimation();
        
        // Render directly to this layer's canvas
        colorCycleBrush.renderDirectToCanvas(layer.colorCycleData.canvas, layer.id);
        
        // Composite this layer onto the target canvas
        if (layer.id === currentState.activeLayerId || !onlyActiveLayer) {
          targetCtx.globalAlpha = layer.opacity;
          targetCtx.globalCompositeOperation = layer.blendMode || 'source-over';
          targetCtx.drawImage(layer.colorCycleData.canvas, 0, 0);
          hasRendered = true;
        }
      }
    });
    
    return hasRendered;
  }, []);

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
    
    // IMPORTANT: Do an initial render to show existing content
    // This ensures color cycle shapes are visible when switching back
    if (drawingCtxRef.current && drawingCanvasRef.current) {
      // Phase 3: Direct rendering approach for initial content
      const currentState = useAppStore.getState();
      const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
      const colorCycleBrush = activeLayer?.colorCycleData?.colorCycleBrush;
      
      if (colorCycleBrush && activeLayer?.colorCycleData?.canvas) {
        // Render to layer canvas first
        colorCycleBrush.renderDirectToCanvas(activeLayer.colorCycleData.canvas, activeLayer.id);
        
        // Copy to drawing canvas for display
        drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
        drawingCtxRef.current.globalAlpha = currentState.tools.brushSettings.opacity || 1;
        drawingCtxRef.current.drawImage(activeLayer.colorCycleData.canvas, 0, 0);
      } else {
        // Fallback: Legacy rendering
        drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
        brushEngine.renderColorCycle(drawingCtxRef.current, true);
      }
      // Mark as having content if color cycle has any strokes
      // This prevents the content from disappearing
    }
    
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
          // Clear drawing canvas once
          drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
          
          // Use the helper to render all color cycle layers
          // During continuous animation, only show active layer
          const hasColorCycleContent = renderAllColorCycleLayers(drawingCtxRef.current, true);
          
          // If no color cycle layers were rendered, try legacy fallback
          if (!hasColorCycleContent) {
            // Fallback: Legacy rendering for compatibility
            brushEngine.updateColorCycleAnimation?.();
            brushEngine.renderColorCycle(drawingCtxRef.current, true);
            drawingCanvasHasContent.current = true;
          } else {
            drawingCanvasHasContent.current = true;
          }
          
          // Trigger main canvas redraw to composite the updated drawing canvas
          window.dispatchEvent(new CustomEvent('colorCycleFrameReady'));
        }
        lastRenderTime = timestamp;
      }
    };
    
    // Start the animation
    continuousColorCycleAnimationRef.current = requestAnimationFrame(animateContinuousColorCycle);
  }, [brushEngine, initDrawingCanvas, renderAllColorCycleLayers]);
  
  // Stop continuous color cycle animation AND pause it
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
    
    // DON'T clear the drawing canvas when animation stops - this was causing content loss
    // The canvas should retain the color cycle content so it can be composited
    // Only clear when starting a new stroke or when explicitly needed
    drawingCanvasHasContent.current = true; // Ensure content is marked as present
  }, [brushEngine]);
  
  // Setter for feedback message callback
  const setFeedbackCallback = useCallback((callback: (message: string) => void) => {
    feedbackMessageRef.current = callback;
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
    startShapeDrawing,
    continueShapeDrawing,
    finalizeShapeDrawing,
    shapePointsRef,
    isDrawingShapeRef,
    startContinuousColorCycleAnimation,
    stopContinuousColorCycleAnimation,
    setFeedbackCallback
  };
}