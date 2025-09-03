import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useBrushEngineSimplified } from '../../hooks/useBrushEngineSimplified';
import { useCanvasInteraction } from '../../hooks/useCanvasInteraction';
import { useCanvasStateMachine } from '../../hooks/useCanvasStateMachine';
import { debugLog } from '../../utils/debug';
import { useSimplePan } from '../../hooks/useSimplePan';
import { useToolStateMachine } from '../../hooks/useToolStateMachine';
import { useComprehensiveKeyboard } from '../../hooks/useComprehensiveKeyboard';
import { useDrawingHandlers } from '../../hooks/useDrawingHandlers';
import { useCanvasEventHandlers } from '../../hooks/canvas/useCanvasEventHandlers';
import { BrushShape } from '../../types';
import { floodFill } from '../../utils/floodFill';
import { detectWacomIssues, testWacomPressure } from '../../utils/detectWacom';
import BrushCursor from './BrushCursor';
import { setColorCycleAnimationHandlers, getColorCycleAnimationState } from '../toolbar/BrushControls';
import { SimplifiedColorCycleManager } from './SimplifiedColorCycleManager';

interface DrawingCanvasProps {
  showFeedback?: (message: string) => void;
}

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ showFeedback }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null); 
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isBusyRef = useRef(false); // Lock to prevent concurrent operations
  const isMouseDownRef = useRef(false); // Track mouse button state
  const drawAnimationFrameRef = useRef<number | null>(null); // RAF throttling for pan
  const pointerMoveThrottled = useRef<number>(0); // Throttle pointer move to 120fps
  
  // Get essential store state - removed shallow comparison to avoid infinite loop
  const project = useAppStore((state) => state.project);
  const canvas = useAppStore((state) => state.canvas);
  const tools = useAppStore((state) => state.tools);
  const layers = useAppStore((state) => state.layers);
  const activeLayerId = useAppStore((state) => state.activeLayerId);
  const selectionStart = useAppStore((state) => state.selectionStart);
  const selectionEnd = useAppStore((state) => state.selectionEnd);
  const floatingPaste = useAppStore((state) => state.floatingPaste);
  const layersNeedRecomposition = useAppStore((state) => state.layersNeedRecomposition);
  
  // Get functions separately (they don't change)
  const {
    setSelectionBounds,
    clearSelection,
    setCurrentTool,
    setCurrentOffscreenCanvas,
    compositeLayersToCanvas,
    setCanvasDimensions,
    setZoom,
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
    setLayersNeedRecomposition,
  } = useAppStore();
  
  // Mouse position for brush cursor
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [showBrushCursor, setShowBrushCursor] = useState(false);
  const [marchingAntsOffset, setMarchingAntsOffset] = useState(0);
  
  // Determine cursor style based on tool and brush shape
  const defaultCursorStyle = useMemo(() => {
    // Fill tool uses crosshair cursor
    if (tools.currentTool === 'fill') {
      return 'crosshair';
    }
    // Selection tool and custom selection use crosshair cursor
    if (tools.currentTool === 'selection' || tools.currentTool === 'custom') {
      return 'crosshair';
    }
    // Custom brush shape uses crosshair cursor
    if (tools.brushSettings.brushShape === BrushShape.CUSTOM) {
      return 'crosshair';
    }
    // Gradient, contour, shape brushes, and spam text use crosshair cursor
    const brushShape = tools.brushSettings.brushShape;
    if (brushShape === BrushShape.RECTANGLE_GRADIENT || 
        brushShape === BrushShape.POLYGON_GRADIENT || 
        brushShape === BrushShape.CONTOUR_POLYGON ||
        brushShape === BrushShape.COLOR_CYCLE_SHAPE ||
        brushShape === BrushShape.SPAM_TEXT) {
      return 'crosshair';
    }
    // Color cycle uses standard brush cursor to show size
    return 'none';
  }, [tools.currentTool, tools.brushSettings.brushShape]);
  
  const [cursorStyle, setCursorStyle] = useState(defaultCursorStyle);
  
  // Update cursor style when defaultCursorStyle changes
  useEffect(() => {
    setCursorStyle(defaultCursorStyle);
  }, [defaultCursorStyle]);
  
  // Debug cursor style
  useEffect(() => {
    console.log('Cursor style:', cursorStyle, 'Tool:', tools.currentTool, 'BrushShape:', tools.brushSettings.brushShape);
  }, [cursorStyle, tools.currentTool, tools.brushSettings.brushShape]);
  
  
  // Track floating paste dragging
  const [isDraggingFloatingPaste, setIsDraggingFloatingPaste] = useState(false);
  const floatingPasteDragStart = useRef<{ x: number; y: number } | null>(null);
  const floatingPasteOriginalPos = useRef<{ x: number; y: number } | null>(null);
  
  // Cached composite canvas
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositeCanvasDirtyRef = useRef(true); // Track if composite needs update
  const lastCompositeHashRef = useRef<string>(''); // Track last composite state
  const [needsRedraw, setNeedsRedraw] = useState(0);
  
  // Ref for draw function to use in resize observer
  const drawRef = useRef<((ctx: CanvasRenderingContext2D, viewTransform: { scale: number; offsetX: number; offsetY: number }) => void) | null>(null);
  
  // Get brush engine (using adapter for migration)
  const brushEngine = useBrushEngineSimplified();
  
  // Memoized layers hash - only compute when layers actually change
  const layersHash = useMemo(() => {
    return layers.map(l => {
      // Use simpler hash: id, visibility, opacity, and data length
      // Avoid expensive checksum calculation
      return `${l.id}_${l.visible}_${l.opacity}_${l.imageData?.data?.length || 0}`;
    }).join('|');
  }, [layers]);
  
  // Helper function to sample color at position
  const sampleColorAtPosition = useCallback((x: number, y: number): string => {
    if (!compositeCanvasRef.current) return 'rgb(0, 0, 0)';
    
    const ctx = compositeCanvasRef.current.getContext('2d', { willReadFrequently: true });
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
  
  // Drawing function - base implementation without hooks
  const drawBase = useCallback((ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, skipDrawingCanvas = false, drawingCanvasRef?: HTMLCanvasElement | null, isDrawing?: boolean, drawingCanvasHasContent?: boolean, isSelecting?: boolean, selectionStartRef?: { x: number; y: number } | null) => {
    const { scale, offsetX, offsetY } = transform;
    
    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    if (project && layers.length > 0) {
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      
      // Draw checkerboard using simple fills (more efficient for panning)
      const checkerSize = 10;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, project.width, project.height);
      ctx.fillStyle = '#e0e0e0';
      
      // Only draw visible checkers - ensure we stay within canvas bounds
      const startX = Math.floor(Math.max(0, -offsetX / scale) / (checkerSize * 2)) * (checkerSize * 2);
      const startY = Math.floor(Math.max(0, -offsetY / scale) / (checkerSize * 2)) * (checkerSize * 2);
      const endX = Math.min(project.width, Math.ceil((ctx.canvas.width - offsetX) / scale));
      const endY = Math.min(project.height, Math.ceil((ctx.canvas.height - offsetY) / scale));
      
      for (let x = startX; x < endX; x += checkerSize * 2) {
        for (let y = startY; y < endY; y += checkerSize * 2) {
          // Clip checkers to canvas bounds
          const w1 = Math.min(checkerSize, project.width - x);
          const h1 = Math.min(checkerSize, project.height - y);
          const w2 = Math.min(checkerSize, project.width - (x + checkerSize));
          const h2 = Math.min(checkerSize, project.height - (y + checkerSize));
          
          if (w1 > 0 && h1 > 0) ctx.fillRect(x, y, w1, h1);
          if (w2 > 0 && h2 > 0) ctx.fillRect(x + checkerSize, y + checkerSize, w2, h2);
        }
      }
      
      const isPixelBrush = tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND ||
        (tools.brushSettings.brushShape === BrushShape.SQUARE && !tools.brushSettings.antialiasing);
      ctx.imageSmoothingEnabled = !isPixelBrush && scale < 3;
      
      
      // Check if we're actively erasing
      const isActivelyErasing = tools.currentTool === 'eraser' && isDrawing && drawingCanvasRef && drawingCanvasHasContent;
      
      // Draw composite canvas ONLY if we're not actively erasing
      if (compositeCanvasRef.current && !isActivelyErasing) {
        ctx.drawImage(compositeCanvasRef.current, 0, 0);
      }
      
      // Draw temporary drawing canvas  
      if (!skipDrawingCanvas && drawingCanvasRef && 
          (isDrawing || drawingCanvasHasContent)) {
        
        // Skip drawing canvas overlay during color cycle animation to prevent 
        // CC layers from appearing on top - they're now animated in compositeLayersToCanvas
        const isColorCycleAnimating = colorCycleManagerRef.current?.isPlaying() || false;
        
        if (!isColorCycleAnimating) {
          // For eraser, the drawing canvas contains the entire modified layer
          // For brush, it's just the new strokes to overlay
          ctx.drawImage(drawingCanvasRef, 0, 0);
        }
      }
      
      // Note: Color cycle animation is now rendered to the drawing canvas
      // in useDrawingHandlers, so it gets composited in the correct layer order
      
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
        const pasteCtx = pasteCanvas.getContext('2d', { willReadFrequently: true });
        
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
      if ((selectionStart && selectionEnd) || (isSelecting && selectionStartRef)) {
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        
        const start = selectionStart || selectionStartRef;
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
  }, [project, layers, tools.brushSettings.brushShape, selectionStart, selectionEnd, marchingAntsOffset, floatingPaste]);
  
  // Use custom hooks
  const interaction = useCanvasInteraction();
  const stateMachine = useCanvasStateMachine();
  const pan = useSimplePan({ scale: canvas?.zoom || 1 });
  // const prevStateRef = useRef(stateMachine.state);
  
  // Simplified cursor state ref for space key
  const isSpacePressedRef = useRef(false);
  
  // Refs for instant panning without re-renders
  const panRef = useRef(pan);
  panRef.current = pan;
  const setCursorStyleRef = useRef(setCursorStyle);
  setCursorStyleRef.current = setCursorStyle;
  const setShowBrushCursorRef = useRef(setShowBrushCursor);
  setShowBrushCursorRef.current = setShowBrushCursor;
  
  // View transform ref for zoom
  const viewTransformRef = useRef({ 
    scale: canvas?.zoom || 1, 
    offsetX: 0, 
    offsetY: 0 
  });
  
  // Update view transform when zoom or pan changes (but not during active panning)
  React.useEffect(() => {
    // Skip updates during active panning to avoid conflicts
    if (stateMachine.state.mode !== 'PANNING') {
      viewTransformRef.current.offsetX = pan.panState.offsetX;
      viewTransformRef.current.offsetY = pan.panState.offsetY;
    }
    viewTransformRef.current.scale = canvas?.zoom || 1;
  }, [canvas?.zoom, pan.panState.offsetX, pan.panState.offsetY, stateMachine.state.mode]);

  // Removed old state machine panning logic - now handled directly in mouse events
  
  
  const toolStateMachine = useToolStateMachine({
    sampleColorAtPosition
  });
  const drawingHandlers = useDrawingHandlers({
    project,
    screenToWorld: pan.screenToWorld,
    viewTransformRef,
    canvasRef: canvasRef as React.RefObject<HTMLCanvasElement>,
    isBusyRef, // Pass the lock ref
  });
  
  // Refs for event handlers (moved up from line 1228)
  const drawingAnimationFrameRef = useRef<number | null>(null);
  const previewAnimationFrameRef = useRef<number | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Extract the color cycle animation functions for use by BrushControls
  const { startContinuousColorCycleAnimation, stopContinuousColorCycleAnimation, setFeedbackCallback } = drawingHandlers;
  
  // Connect feedback callback
  useEffect(() => {
    if (showFeedback && setFeedbackCallback) {
      setFeedbackCallback(showFeedback);
    }
  }, [showFeedback, setFeedbackCallback]);
  
  // Simplified color cycle animation manager
  const colorCycleManagerRef = useRef<SimplifiedColorCycleManager | null>(null);
  
  // Initialize color cycle manager
  useEffect(() => {
    colorCycleManagerRef.current = new SimplifiedColorCycleManager({
      targetFPS: 24,
      onFrame: () => {
        // Trigger a redraw on each animation frame
        setNeedsRedraw(prev => prev + 1);
      }
    });
    
    return () => {
      colorCycleManagerRef.current?.destroy();
      colorCycleManagerRef.current = null;
    };
  }, []);
  
  // Simplified animation control functions
  const wrappedStartAnimation = useCallback(() => {
    // Start the color cycle animation in drawing handlers
    startContinuousColorCycleAnimation();
    
    // Start the animation manager
    colorCycleManagerRef.current?.start();
  }, [startContinuousColorCycleAnimation]);
  
  const wrappedStopAnimation = useCallback(() => {
    // Stop the animation manager
    colorCycleManagerRef.current?.stop();
    
    // Stop the color cycle animation
    stopContinuousColorCycleAnimation();
    
    // Do one final redraw to ensure clean state
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (ctx && drawRef.current) {
      drawRef.current(ctx, viewTransformRef.current);
    }
  }, [stopContinuousColorCycleAnimation]);
  
  // Set up the animation handlers for BrushControls
  useEffect(() => {
    setColorCycleAnimationHandlers({
      startContinuousColorCycleAnimation: wrappedStartAnimation,
      stopContinuousColorCycleAnimation: wrappedStopAnimation,
      updateColorCycleGradient: brushEngine.updateColorCycleGradient,
      setFlowDirection: brushEngine.setColorCycleFlowDirection,
    });
    
    // Cleanup on unmount
    return () => {
      setColorCycleAnimationHandlers(null);
      colorCycleManagerRef.current?.stop();
    };
  }, [wrappedStartAnimation, wrappedStopAnimation, brushEngine.updateColorCycleGradient, brushEngine.setColorCycleFlowDirection]);
  
  // Wrapper draw function that uses current hook values
  const draw = useCallback((ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, skipDrawingCanvas = false) => {
    drawBase(
      ctx, 
      transform, 
      skipDrawingCanvas,
      drawingHandlers.drawingCanvasRef.current,
      interaction.state.isDrawing,
      drawingHandlers.drawingCanvasHasContent.current,
      interaction.state.isSelecting,
      interaction.refs.selectionStart.current
    );
  }, [drawBase, drawingHandlers, interaction]);
  
  // Update drawRef when draw changes and trigger initial draw
  useEffect(() => {
    drawRef.current = draw;
    
    // Trigger initial draw when draw function is ready
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx && viewTransformRef.current) {
        draw(ctx, viewTransformRef.current);
      }
    }
  }, [draw]);
  
  // Listen for color cycle animation frame updates
  useEffect(() => {
    const handleColorCycleFrame = () => {
      // Trigger a redraw when color cycle animation updates
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx && drawRef.current && viewTransformRef.current) {
        drawRef.current(ctx, viewTransformRef.current);
      }
    };
    
    const handleColorCycleFrameUpdate = (event: CustomEvent) => {
      console.log('[DrawingCanvas] Color cycle frame update received:', event.detail);
      
      // Mark composite canvas as dirty
      compositeCanvasDirtyRef.current = true;
      
      // Regenerate composite canvas to include updated layer imageData
      if (compositeCanvasRef.current && project && compositeLayersToCanvas) {
        compositeLayersToCanvas(compositeCanvasRef.current);
      }
      
      // Trigger a redraw to show the updated animation frame
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx && drawRef.current && viewTransformRef.current) {
        drawRef.current(ctx, viewTransformRef.current);
      }
      
      console.log('[DrawingCanvas] Animation frame redraw completed');
    };
    
    window.addEventListener('colorCycleFrameReady', handleColorCycleFrame);
    window.addEventListener('colorCycleFrameUpdate', handleColorCycleFrameUpdate as EventListener);
    
    return () => {
      window.removeEventListener('colorCycleFrameReady', handleColorCycleFrame);
      window.removeEventListener('colorCycleFrameUpdate', handleColorCycleFrameUpdate as EventListener);
    };
  }, [project, compositeLayersToCanvas]);
  
  // Handle blur to reset space key state when losing focus
  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Check if focus is actually leaving the component entirely
    // relatedTarget is the element that is receiving focus
    const newFocusTarget = e.relatedTarget as HTMLElement;
    
    // If focus is moving to another element within this component, don't reset
    if (newFocusTarget && wrapperRef.current?.contains(newFocusTarget)) {
      return;
    }
    
    // If spacebar was stuck down, force a release
    if (stateMachine.state.isSpacePressed) {
      // Dispatch SPACE_UP to correctly transition the state machine
      stateMachine.dispatch({ type: 'SPACE_UP' });
      setCursorStyle(defaultCursorStyle);
      setShowBrushCursor(true);
    }
  }, [defaultCursorStyle, setCursorStyle]);


  // Direct DOM keyboard handling for instant panning response
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isSpacePressedRef.current) {
        e.preventDefault();
        
        // Block if drawing
        if (interaction.stateRef.current.isDrawing) return;
        
        isSpacePressedRef.current = true;
        setShowBrushCursorRef.current(false);
        setCursorStyleRef.current('grab');
        
        // Start panning immediately if mouse is down
        if (isMouseDownRef.current && mousePosition.x !== undefined && mousePosition.y !== undefined) {
          panRef.current.startPan(mousePosition.x, mousePosition.y);
          setCursorStyleRef.current('grabbing');
        }
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        isSpacePressedRef.current = false;
        
        if (panRef.current.panState.isPanning) {
          panRef.current.endPan();
        }
        setCursorStyleRef.current(defaultCursorStyle);
        setShowBrushCursorRef.current(true);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [defaultCursorStyle]); // Only defaultCursorStyle as it's a string constant

  // Monitor undo stack changes
  useEffect(() => {
    let prevLength = useAppStore.getState().history.undoStack.length;
    const unsubscribe = useAppStore.subscribe((state) => {
      const length = state.history.undoStack.length;
      if (length > prevLength) {
        console.log(`📝 NEW UNDO STATE SAVED. Stack: ${prevLength} -> ${length}`);
        const lastItem = state.history.undoStack[length - 1];
        console.log('Last saved item:', lastItem?.description);
      }
      prevLength = length;
    });
    return unsubscribe;
  }, []);

  // Comprehensive keyboard handling (for other keys)
  const keyboard = useComprehensiveKeyboard({
    onSpacePressed: () => {
      // Handled by direct DOM listener above
    },
    onSpaceReleased: () => {
      // Handled by direct DOM listener above
    },
    onCustomTool: () => {
      setCurrentTool('custom');
    },
    onEraserPressed: () => {
      // Eraser key pressed - tool switch handled in hook
    },
    onEraserReleased: () => {
      // Eraser key released - tool restoration handled in hook
    },
    onUndo: () => {
      console.log('=== UNDO TRIGGERED ===');
      const currentStack = useAppStore.getState().history.undoStack;
      console.log('Undo stack length:', currentStack.length);
      console.log('Top item description:', currentStack[currentStack.length - 1]?.description);
      
      const snapshot = undo();
      console.log('Snapshot retrieved:', {
        hasSnapshot: !!snapshot,
        hasColorCycleState: !!snapshot?.colorCycleState,
        hasLayers: !!snapshot?.layers,
        hasImageData: !!snapshot?.imageData
      });
      if (snapshot) {
        // Restore color cycle state if present
        if (snapshot.colorCycleState) {
          const { layerId } = snapshot.colorCycleState;
          const activeLayer = layers.find(l => l.id === layerId);
          
          if (activeLayer?.colorCycleData?.colorCycleBrush) {
            // Restore Canvas2D state from snapshot
            activeLayer.colorCycleData.colorCycleBrush.restoreFullState({
              gradients: snapshot.colorCycleState.gradients.map(g => ({
                gradientStops: g.gradientStops
              })),
              animationState: snapshot.colorCycleState.animationState,
              layerSnapshots: snapshot.colorCycleState.layerStrokes
            });
            // Do NOT force a render here. The layer's canvas pixels will be restored
            // from the snapshot below to avoid wiping undo-restored content.

            // DEBUG: Verify internal stroke buffer after restore
            try {
              const snap = (activeLayer.colorCycleData.colorCycleBrush as any).getLayerSnapshot?.(layerId);
              debugLog('cc-undo', {
                phase: 'after-restore',
                layerId: layerId?.substring(0, 20),
                hasSnapshot: !!snap,
                hasContent: snap?.hasContent,
                paintBufferBytes: snap?.paintBuffer?.byteLength || 0,
                strokeCounter: snap?.strokeCounter
              });
            } catch {}
          }
        }
        
        if (snapshot.layers && snapshot.activeLayerId) {
          // Reconstruct layers with proper type preservation
          const restoredLayers = snapshot.layers.map((layer: any) => {
            // Find the existing layer in the current state
            const existingLayer = layers.find(l => l.id === layer.id);
            
            // Determine the correct layer type based on colorCycleData presence
            const shouldBeColorCycle = !!layer.colorCycleData;
            const correctLayerType: 'color-cycle' | 'normal' = shouldBeColorCycle ? 'color-cycle' : 'normal';
            
            // Create base layer object with correct type
            const baseLayer = {
              id: layer.id,
              name: layer.name,
              visible: layer.visible,
              opacity: layer.opacity,
              blendMode: layer.blendMode,
              locked: layer.locked,
              order: layer.order,
              imageData: layer.imageData,
              framebuffer: layer.framebuffer,
              layerType: correctLayerType // Set correct type from the start
            };
            
            // Handle color-cycle specific data
            if (shouldBeColorCycle && layer.colorCycleData.canvasImageData) {
              // Check if we have an existing canvas to update
              let canvas = existingLayer?.colorCycleData?.canvas;
              
              if (!canvas) {
                // Create new canvas only if it doesn't exist
                canvas = document.createElement('canvas');
                canvas.width = layer.colorCycleData.canvasWidth || 1920;
                canvas.height = layer.colorCycleData.canvasHeight || 1080;
              }
              
              // Restore the canvas content
              const ctx = canvas.getContext('2d');
              if (ctx && layer.colorCycleData.canvasImageData) {
                // Clear and restore the canvas content
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.putImageData(layer.colorCycleData.canvasImageData, 0, 0);
              }
              
              // Add colorCycleData to the layer
              return {
                ...baseLayer,
                colorCycleData: {
                  gradient: layer.colorCycleData.gradient,
                  isAnimating: layer.colorCycleData.isAnimating,
                  canvas,
                  colorCycleBrush: existingLayer?.colorCycleData?.colorCycleBrush // Preserve existing brush
                }
              };
            }
            
            // Return normal layer (no colorCycleData)
            return baseLayer;
          });
          
          setLayers(restoredLayers);
          setActiveLayer(snapshot.activeLayerId);
          
          // Reinitialize color cycle brushes for restored layers
          restoredLayers.forEach((layer: any) => {
            if (layer.layerType === 'color-cycle' && layer.colorCycleData && !layer.colorCycleData.colorCycleBrush) {
              // Call initColorCycleForLayer to recreate the brush
              const { initColorCycleForLayer } = useAppStore.getState();
              if (layer.colorCycleData.canvas) {
                initColorCycleForLayer(layer.id, layer.colorCycleData.canvas.width, layer.colorCycleData.canvas.height);
              }
            }
          });
          
          // Mark composite as dirty for next redraw
          compositeCanvasDirtyRef.current = true;
          
          // Immediately regenerate composite canvas
          if (compositeCanvasRef.current && project) {
            compositeLayersToCanvas(compositeCanvasRef.current);
            setCurrentOffscreenCanvas(compositeCanvasRef.current);
          }
          
          // Force a redraw
          setNeedsRedraw(prev => prev + 1);
          
          // Also trigger immediate redraw
          requestAnimationFrame(() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              draw(ctx, viewTransformRef.current);
            }
          });
        } else {
          const activeLayer = layers.find(l => l.id === activeLayerId);
          if (activeLayer && snapshot.imageData) {
            // Mark composite as dirty BEFORE updating layer
            compositeCanvasDirtyRef.current = true;
            
            updateLayer(activeLayer.id, { imageData: snapshot.imageData });
            
            // Immediately regenerate composite canvas
            if (compositeCanvasRef.current && project) {
              compositeLayersToCanvas(compositeCanvasRef.current);
              setCurrentOffscreenCanvas(compositeCanvasRef.current);
            }
            
            // Force a redraw by incrementing the redraw counter
            setNeedsRedraw(prev => prev + 1);
            
            // Also trigger immediate redraw
            requestAnimationFrame(() => {
              const canvas = canvasRef.current;
              const ctx = canvas?.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                draw(ctx, viewTransformRef.current);
              }
            });
          }
        }
      }
    },
    onRedo: () => {
      const snapshot = redo();
      if (snapshot) {
        // Restore color cycle state if present
        if (snapshot.colorCycleState) {
          const { layerId } = snapshot.colorCycleState;
          const activeLayer = layers.find(l => l.id === layerId);
          
          if (activeLayer?.colorCycleData?.colorCycleBrush) {
            // Restore Canvas2D state from snapshot
            activeLayer.colorCycleData.colorCycleBrush.restoreFullState({
              gradients: snapshot.colorCycleState.gradients.map(g => ({
                gradientStops: g.gradientStops
              })),
              animationState: snapshot.colorCycleState.animationState,
              layerSnapshots: snapshot.colorCycleState.layerStrokes
            });
            // Do NOT force a render here. The layer's canvas pixels will be restored
            // from the snapshot below to avoid wiping redo-restored content.

            // DEBUG: Verify internal stroke buffer after restore
            try {
              const snap = (activeLayer.colorCycleData.colorCycleBrush as any).getLayerSnapshot?.(layerId);
              debugLog('cc-undo', {
                phase: 'redo-after-restore',
                layerId: layerId?.substring(0, 20),
                hasSnapshot: !!snap,
                hasContent: snap?.hasContent,
                paintBufferBytes: snap?.paintBuffer?.byteLength || 0,
                strokeCounter: snap?.strokeCounter
              });
            } catch {}
          }
        }
        
        if (snapshot.layers && snapshot.activeLayerId) {
          // Reconstruct layers with proper type preservation
          const restoredLayers = snapshot.layers.map((layer: any) => {
            // Find the existing layer in the current state
            const existingLayer = layers.find(l => l.id === layer.id);
            
            // Determine the correct layer type based on colorCycleData presence
            const shouldBeColorCycle = !!layer.colorCycleData;
            const correctLayerType: 'color-cycle' | 'normal' = shouldBeColorCycle ? 'color-cycle' : 'normal';
            
            // Create base layer object with correct type
            const baseLayer = {
              id: layer.id,
              name: layer.name,
              visible: layer.visible,
              opacity: layer.opacity,
              blendMode: layer.blendMode,
              locked: layer.locked,
              order: layer.order,
              imageData: layer.imageData,
              framebuffer: layer.framebuffer,
              layerType: correctLayerType // Set correct type from the start
            };
            
            // Handle color-cycle specific data
            if (shouldBeColorCycle && layer.colorCycleData.canvasImageData) {
              // Check if we have an existing canvas to update
              let canvas = existingLayer?.colorCycleData?.canvas;
              
              if (!canvas) {
                // Create new canvas only if it doesn't exist
                canvas = document.createElement('canvas');
                canvas.width = layer.colorCycleData.canvasWidth || 1920;
                canvas.height = layer.colorCycleData.canvasHeight || 1080;
              }
              
              // Restore the canvas content
              const ctx = canvas.getContext('2d');
              if (ctx && layer.colorCycleData.canvasImageData) {
                // Clear and restore the canvas content
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.putImageData(layer.colorCycleData.canvasImageData, 0, 0);
              }
              
              // Add colorCycleData to the layer
              return {
                ...baseLayer,
                colorCycleData: {
                  gradient: layer.colorCycleData.gradient,
                  isAnimating: layer.colorCycleData.isAnimating,
                  canvas,
                  colorCycleBrush: existingLayer?.colorCycleData?.colorCycleBrush // Preserve existing brush
                }
              };
            }
            
            // Return normal layer (no colorCycleData)
            return baseLayer;
          });
          
          setLayers(restoredLayers);
          setActiveLayer(snapshot.activeLayerId);
          
          // Reinitialize color cycle brushes for restored layers
          restoredLayers.forEach((layer: any) => {
            if (layer.layerType === 'color-cycle' && layer.colorCycleData && !layer.colorCycleData.colorCycleBrush) {
              // Call initColorCycleForLayer to recreate the brush
              const { initColorCycleForLayer } = useAppStore.getState();
              if (layer.colorCycleData.canvas) {
                initColorCycleForLayer(layer.id, layer.colorCycleData.canvas.width, layer.colorCycleData.canvas.height);
              }
            }
          });
          
          // Mark composite as dirty for next redraw
          compositeCanvasDirtyRef.current = true;
          
          // Immediately regenerate composite canvas
          if (compositeCanvasRef.current && project) {
            compositeLayersToCanvas(compositeCanvasRef.current);
            setCurrentOffscreenCanvas(compositeCanvasRef.current);
          }
          
          // Force a redraw
          setNeedsRedraw(prev => prev + 1);
          
          // Also trigger immediate redraw
          requestAnimationFrame(() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              draw(ctx, viewTransformRef.current);
            }
          });
        } else {
          const activeLayer = layers.find(l => l.id === activeLayerId);
          if (activeLayer && snapshot.imageData) {
            updateLayer(activeLayer.id, { imageData: snapshot.imageData });
            
            // Mark composite as dirty for imageData updates too
            compositeCanvasDirtyRef.current = true;
            
            // Immediately regenerate composite canvas
            if (compositeCanvasRef.current && project) {
              compositeLayersToCanvas(compositeCanvasRef.current);
              setCurrentOffscreenCanvas(compositeCanvasRef.current);
            }
            
            // Force a redraw
            setNeedsRedraw(prev => prev + 1);
            
            // Also trigger immediate redraw
            requestAnimationFrame(() => {
              const canvas = canvasRef.current;
              const ctx = canvas?.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                draw(ctx, viewTransformRef.current);
              }
            });
          }
        }
      }
    },
    onPolygonComplete: () => {
      if (toolStateMachine.completePolygonGradient()) {
        // Draw polygon
        drawingHandlers.initDrawingCanvas();
        const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
        
        if (drawCtx && brushEngine) {
          // Check if we're on a color cycle layer in shape mode
          const activeLayer = layers.find(l => l.id === activeLayerId);
          const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
          
          if (isColorCycleLayer && tools.shapeMode) {
            console.log('=== COLOR CYCLE SHAPE DRAW ===');
            console.log('1. Before save - Canvas data exists?', !!activeLayer.colorCycleData?.canvas);
            
            if (activeLayer.colorCycleData?.canvas) {
              // Log what we're saving
              const ctx = activeLayer.colorCycleData.canvas.getContext('2d');
              const imageData = ctx?.getImageData(0, 0, 100, 100); // Sample corner
              console.log('2. Sample pixel data before save:', imageData?.data.slice(0, 20));
            }
            
            // Don't save here - it will be saved in finalizeDrawing
            // This prevents duplicate undo entries for color cycle shapes
            console.log('3. NOT saving here - will save in finalizeDrawing');
            
            console.log('4. Before resetColorCycle');
            brushEngine.resetColorCycle();
            console.log('5. After resetColorCycle');
            
            // Fill shape with color cycle gradient from edges to center
            const points = toolStateMachine.polygonGradientState.points.map(p => ({ x: p.x, y: p.y }));
            console.log('6. Drawing shape with points:', points.length);
            brushEngine.fillColorCycleShape(points);
            
            // Clear the drawing canvas before rendering
            drawCtx.clearRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);
            
            // Render the color cycle immediately at full opacity
            brushEngine.renderColorCycle(drawCtx, false);
            console.log('7. Shape rendered to drawing canvas');
          } else if (toolStateMachine.isContourPolygon) {
            // Check if it's a contour polygon
            brushEngine.drawContourPolygon(
              drawCtx,
              {
                vertices: toolStateMachine.polygonGradientState.points.map(p => ({ x: p.x, y: p.y }))
              },
              false
            );
          } else if (toolStateMachine.polygonGradientState.points.length >= 3) {
            // Standard polygon gradient - only if we have valid points
            brushEngine.drawPolygonGradient(
              drawCtx,
              {
                vertices: toolStateMachine.polygonGradientState.points.map(p => ({ x: p.x, y: p.y })),
                colors: toolStateMachine.polygonGradientState.points.map(p => p.color)
              },
              false
            );
          }
          drawingHandlers.drawingCanvasHasContent.current = true;
          // Mark composite as dirty BEFORE finalization
          compositeCanvasDirtyRef.current = true;
          console.log('8. Before finalizeDrawing call');
          drawingHandlers.finalizeDrawing().then(() => {
            console.log('=== FINALIZE COMPLETE ===');
            console.log('Composite dirty?', compositeCanvasDirtyRef.current);
            
            // Check if another save happened during finalization
            const stackLength = useAppStore.getState().history.undoStack.length;
            console.log('Current undo stack length:', stackLength);
            
            // Signal that finalization is complete
            stateMachine.finalizationComplete();
            
            // Force immediate composite regeneration after layer update
            if (compositeCanvasRef.current && project) {
              compositeLayersToCanvas(compositeCanvasRef.current);
              setCurrentOffscreenCanvas(compositeCanvasRef.current);
              compositeCanvasDirtyRef.current = false;
            }
            
            // Trigger redraw after finalization
            setNeedsRedraw(prev => prev + 1);
            
            // Restart color cycle animation if it should be playing
            if (tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE && getColorCycleAnimationState()) {
              wrappedStartAnimation();
            }
          });
        }
        toolStateMachine.resetPolygonGradient();
      }
    },
    onPolygonCancel: () => {
      toolStateMachine.resetPolygonGradient();
      interaction.dispatch({ type: 'DRAWING_END' });
    },
    onEnterPressed: async () => {
      // Commit floating paste when Enter is pressed
      if (floatingPaste) {
        await commitFloatingPaste();
        // Trigger redraw
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          draw(ctx, viewTransformRef.current);
        }
      }
    },
    onEscapePressed: () => {
      // Cancel floating paste when Escape is pressed
      if (floatingPaste) {
        cancelFloatingPaste();
        // Trigger redraw
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          draw(ctx, viewTransformRef.current);
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
  
  // Use modular event handlers
  const eventHandlers = useCanvasEventHandlers({
    // Canvas refs
    canvasRef: canvasRef as React.RefObject<HTMLCanvasElement>,
    wrapperRef: wrapperRef as React.RefObject<HTMLDivElement>,
    overlayCanvasRef: overlayCanvasRef as React.RefObject<HTMLCanvasElement>,
    compositeCanvasRef,
    
    // State refs
    isBusyRef,
    isMouseDownRef,
    isSpacePressedRef,
    drawAnimationFrameRef,
    pointerMoveThrottled,
    
    // Store state
    project,
    canvas: canvas ? { width: project?.width || 1920, height: project?.height || 1080, scale: canvas.zoom, zoom: canvas.zoom } : null,
    tools: {
      currentTool: tools.currentTool,
      brushSettings: tools.brushSettings,
      fillSettings: tools.fillSettings,
      eraserSettings: tools.eraserSettings,
      shapeMode: tools.shapeMode
    },
    layers,
    activeLayerId,
    selectionStart,
    selectionEnd,
    floatingPaste: floatingPaste as any,
    
    // Store actions
    setSelectionBounds,
    clearSelection,
    setCurrentTool: setCurrentTool as any,
    setCurrentOffscreenCanvas,
    compositeLayersToCanvas,
    saveCanvasState: saveCanvasState as any,
    updateLayer,
    
    // Floating paste
    setFloatingPaste: setFloatingPaste as any,
    updateFloatingPastePosition: (x: number, y: number) => updateFloatingPastePosition({ x, y }),
    commitFloatingPaste,
    cancelFloatingPaste,
    
    // Drawing state
    isDraggingFloatingPaste,
    setIsDraggingFloatingPaste,
    floatingPasteDragStart,
    floatingPasteOriginalPos,
    
    // Cursor state
    setCursorStyle,
    setShowBrushCursor,
    setMousePosition,
    
    // Hooks
    interaction,
    stateMachine,
    pan,
    toolStateMachine,
    drawingHandlers,
    brushEngine,
    
    // Helper functions
    sampleColorAtPosition,
    sampleColorsAlongLine,
    getMousePos: getMousePos as any,
    
    // Drawing state management
    compositeCanvasDirtyRef,
    setNeedsRedraw,
    
    // View transform and drawing
    viewTransformRef,
    draw,
    drawingAnimationFrameRef,
    previewAnimationFrameRef,
    
    // Optional
    defaultCursorStyle: cursorStyle,
    restartColorCycleAnimation: () => {
      if (tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE && getColorCycleAnimationState()) {
        wrappedStartAnimation();
      }
    }
  });
  
  // Extract handlers from modular system
  const {
    handlePointerDown,
    handlePointerMove, 
    handlePointerUp,
    handlePointerEnter,
    handlePointerLeave,
    handlePointerCancel
  } = eventHandlers;
  
  // Effects
  
  // Update cursor style when brush shape changes
  useEffect(() => {
    // Only update if we're not in a special mode (dragging, etc.)
    if (stateMachine.state.mode !== 'AWAITING_PAN' && stateMachine.state.mode !== 'PANNING' && !isDraggingFloatingPaste) {
      setCursorStyle(defaultCursorStyle);
    }
  }, [defaultCursorStyle, isDraggingFloatingPaste, setCursorStyle]);
  
  // Regenerate composite canvas when layers change
  useEffect(() => {
    if (!project || !compositeLayersToCanvas) return;
    
    // Check if we actually need to update the composite
    if (layersHash === lastCompositeHashRef.current && !compositeCanvasDirtyRef.current && !layersNeedRecomposition) {
      return; // Skip if nothing changed
    }
    
    if (!compositeCanvasRef.current) {
      compositeCanvasRef.current = document.createElement('canvas');
    }
    if (compositeCanvasRef.current.width !== project.width || 
        compositeCanvasRef.current.height !== project.height) {
      compositeCanvasRef.current.width = project.width;
      compositeCanvasRef.current.height = project.height;
    }
    
    const compCtx = compositeCanvasRef.current.getContext('2d', { willReadFrequently: true });
    if (compCtx) {
      compCtx.imageSmoothingEnabled = false;
    }
    
    compositeLayersToCanvas(compositeCanvasRef.current);
    setCurrentOffscreenCanvas(compositeCanvasRef.current);
    
    // Update tracking
    lastCompositeHashRef.current = layersHash;
    compositeCanvasDirtyRef.current = false;
    
    // Reset the recomposition flag if it was set
    if (layersNeedRecomposition) {
      setLayersNeedRecomposition(false);
    }
    
    setNeedsRedraw(prev => prev + 1);
    
    // Also trigger immediate redraw
    const canvas = canvasRef.current;
    if (canvas && drawRef.current && viewTransformRef.current) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        drawRef.current(ctx, viewTransformRef.current);
      }
    }
  }, [layersHash, project, compositeLayersToCanvas, setCurrentOffscreenCanvas, layersNeedRecomposition, setLayersNeedRecomposition]);
  
  // Animate marching ants
  useEffect(() => {
    let animationId: number | null = null;
    let frameCount = 0;
    let isActive = true;
    
    if ((selectionStart && selectionEnd) || floatingPaste) {
      const animate = () => {
        // Check if effect is still active before continuing animation
        if (!isActive) return;
        
        frameCount++;
        if (frameCount % 3 === 0) {
          setMarchingAntsOffset(prev => (prev + 1) % 10);
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            // We need to call draw here, but we don't include it in dependencies
            // to avoid circular dependency that causes infinite loop
            draw(ctx, viewTransformRef.current);
          }
        }
        animationId = requestAnimationFrame(animate);
      };
      animationId = requestAnimationFrame(animate);
    }
    
    return () => {
      isActive = false;
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    };
  // FIX: Removed `draw` from dependencies to break circular dependency
  // The animation only needs to know when to start/stop, not when draw changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionStart, selectionEnd, floatingPaste, viewTransformRef]);
  
  // Handle wheel events for zooming and panning
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      // Always read from the ref to get the most up-to-date values
      // without needing to re-create this handler on every render.
      const { scale: currentScale, offsetX: currentOffsetX, offsetY: currentOffsetY } = viewTransformRef.current;

      // Always zoom with vertical scroll
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        // --- Zoom Logic (vertical scroll) ---
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const scrollSensitivity = 0.001;
        const zoomFactor = 1 - e.deltaY * scrollSensitivity;
        
        // Limit max zoom to 10 (1000%) to prevent precision issues
        const maxZoom = 10;
        const newScale = Math.max(0.1, Math.min(currentScale * zoomFactor, maxZoom));
        
        // Only update if there's an actual change to prevent precision errors
        if (Math.abs(newScale - currentScale) < 0.0001) return;
        
        const worldX = (mouseX - currentOffsetX) / currentScale;
        const worldY = (mouseY - currentOffsetY) / currentScale;
        
        const newOffsetX = mouseX - worldX * newScale;
        const newOffsetY = mouseY - worldY * newScale;
        
        // Set state and let React handle the redraw
        setZoom(newScale);
        // Update pan to keep zoom centered on cursor
        pan.setPan(newOffsetX, newOffsetY);

      } else if (e.deltaX !== 0) {
        // Horizontal scroll - no action
      }
    };
    
    const canvasElement = canvasRef.current;
    if (canvasElement) {
      canvasElement.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (canvasElement) {
        canvasElement.removeEventListener('wheel', handleWheel);
      }
    };
    // The ref handles stale data, so dependencies can be minimal and stable.
  }, [setZoom, viewTransformRef, pan]);
  
  // Consolidated safety net for resetting interaction state
  useEffect(() => {
    const handleInteractionReset = () => {
      // Safety reset handler
      
      
      // Check if the space key state is stuck
      if (stateMachine.state.isSpacePressed) {
        
        // Space handling now in state machine
        
        // Always restore the default cursor and show the brush
        setCursorStyle(defaultCursorStyle);
        setShowBrushCursor(true);
      } else {
      }
    };

    const handleVisibilityChange = () => {
      // Reset state if the tab is hidden
      if (document.hidden) {
        handleInteractionReset();
      }
    };

    // Listen for the window losing focus (e.g., Alt-Tab)
    window.addEventListener('blur', handleInteractionReset);
    
    // Listen for the tab being switched away
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup: remove listeners when the component unmounts
    return () => {
      window.removeEventListener('blur', handleInteractionReset);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    
    // Dependencies ensure the handler has the correct functions/values if they ever change.
  }, [defaultCursorStyle, setCursorStyle, setShowBrushCursor]);
  
  // Center canvas on mount and focus
  useEffect(() => {
    // centerCanvas removed();
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
          const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
          if (tempCtx && activeLayer.imageData) {
            tempCtx.putImageData(activeLayer.imageData, 0, 0);
            saveCanvasState(tempCanvas, 'brush', 'Initial state');
          }
        }
      }
    }
  }, [project, layers, activeLayerId, saveCanvasState]);
  
  // Redraw whenever the view transform state or composite canvas changes
  useEffect(() => {
    // Skip automatic redraws during active panning (handled by mousemove)
    if (stateMachine.state.mode === 'PANNING') return;
    
    const canvasElement = canvasRef.current;
    const ctx = canvasElement?.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    // Use the viewTransformRef which is the single source of truth
    draw(ctx, viewTransformRef.current);

  // This now correctly depends on the sources of truth for a redraw
  }, [canvas?.zoom, pan.panState.offsetX, pan.panState.offsetY, draw, needsRedraw, stateMachine.state.mode]);
  
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
              const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
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
                const ctx = canvas?.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  draw(ctx, viewTransformRef.current);
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
  }, [project, layers, activeLayerId, saveCanvasState, draw]);

  // Handle canvas resizing - run only once on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    
    let lastWidth = 0;
    let lastHeight = 0;
    
    const handleResize = () => {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      
      const { width, height } = wrapper.getBoundingClientRect();
      
      // Only update if dimensions actually changed
      if (width !== lastWidth || height !== lastHeight) {
        lastWidth = width;
        lastHeight = height;
        canvas.width = width;
        canvas.height = height;
        
        // Also resize overlay canvas
        const overlayCanvas = overlayCanvasRef.current;
        if (overlayCanvas) {
          overlayCanvas.width = width;
          overlayCanvas.height = height;
        }
        
        setCanvasDimensions(width, height);
        
        // Get the latest draw function and viewTransform
        const drawFunc = drawRef.current;
        const viewTransform = viewTransformRef.current;
        if (drawFunc) {
          drawFunc(ctx, viewTransform);
        }
      }
    };
    
    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(handleResize);
    });
    
    resizeObserver.observe(wrapper);
    
    // Initial sizing
    handleResize();
    
    return () => resizeObserver.disconnect();
  }, []); // Empty dependency array - run only once
  
  // Color cycle animation frames are now handled by SimplifiedColorCycleManager
  // No need for separate event listeners
  
  
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
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        tabIndex={-1}
        style={{ 
          display: 'block', 
          width: '100%', 
          height: '100%',
          // Force nearest-neighbor for pixel brushes with rotation
          ...(((canvas?.zoom || 1) > 3 || 
            (tools.brushSettings.rotationEnabled && 
             (tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND || 
              (!tools.brushSettings.antialiasing && tools.brushSettings.brushShape === BrushShape.SQUARE)))) 
            ? {
                imageRendering: 'pixelated',
                // Fallbacks for different browsers
                WebkitImageRendering: 'pixelated',
                MozImageRendering: 'crisp-edges',
                msImageRendering: 'pixelated',
              } as any
            : { imageRendering: 'auto' }),
          touchAction: 'none', // Prevent scrolling/zooming on touch devices
          userSelect: 'none', // Prevent text selection
          cursor: cursorStyle,
        }}
      />
      
      {/* Overlay canvas for previews - no interaction events */}
      <canvas
        ref={overlayCanvasRef}
        style={{ 
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%', 
          height: '100%',
          pointerEvents: 'none',
          imageRendering: (canvas?.zoom || 1) > 3 ? 'pixelated' : 'auto',
          touchAction: 'none', // Prevent scrolling/zooming on touch devices
          userSelect: 'none', // Prevent text selection
          cursor: cursorStyle,
        }}
      />
      
      {/* Zoom indicator */}
      <div className="absolute bottom-4 right-4 bg-black/50 text-white px-2 py-1 rounded text-sm">
        {Math.round((canvas?.zoom || 1) * 100)}%
      </div>
      
      {/* Brush cursor preview */}
      <BrushCursor
        screenX={mousePosition.x}
        screenY={mousePosition.y}
        size={tools.brushSettings.size}
        brushShape={tools.brushSettings.brushShape || BrushShape.ROUND}
        zoom={canvas?.zoom || 1}
        color={tools.brushSettings.color}
        customBrush={tools.brushSettings.currentBrushTip ? {
          imageData: tools.brushSettings.currentBrushTip.imageData,
          width: tools.brushSettings.currentBrushTip.width || 32,
          height: tools.brushSettings.currentBrushTip.height || 32
        } : null}
        visible={showBrushCursor && !pan.panState.isPanning && !isSpacePressedRef.current && cursorStyle === 'none'}
      />
    </div>
  );
};

export default React.memo(DrawingCanvas);
