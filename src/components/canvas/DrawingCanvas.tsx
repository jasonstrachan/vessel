import React, { useRef, useEffect, useCallback, useState, useMemo, useLayoutEffect } from 'react';
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
import { RecolorManager } from '../../lib/colorCycle/RecolorManager';

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
    setCanvasOffset,
    setCanvasViewport,
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

  const isPointerInsideCanvas = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const { x, y } = mousePosition;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }, [mousePosition]);
  
  // Determine cursor style based on tool and brush shape
  const defaultCursorStyle = useMemo(() => {
    // Fill tool uses crosshair cursor
    if (tools.currentTool === 'fill') {
      return 'crosshair';
    }
    // Recolor tool uses crosshair cursor (sampling only, no painting)
    if (tools.currentTool === 'recolor') {
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
    // quiet
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

  // Cached floating paste canvas (avoid creating per frame)
  const pasteCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastPasteInfoRef = useRef<{ imageData: ImageData | null; width: number; height: number }>(
    { imageData: null, width: 0, height: 0 }
  );
  
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
  
  // Small cache to avoid redundant getImageData calls when pointer stays in same pixel
  const lastSampleRef = useRef<{ x: number; y: number; color: string }>({ x: -1, y: -1, color: 'rgb(0, 0, 0)' });
  // Helper function to sample color at position (cached per pixel)
  const sampleColorAtPosition = useCallback((x: number, y: number): string => {
    const comp = compositeCanvasRef.current;
    if (!comp) return 'rgb(0, 0, 0)';

    const ctx = comp.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'rgb(0, 0, 0)';

    const clampedX = Math.max(0, Math.min(comp.width - 1, Math.floor(x)));
    const clampedY = Math.max(0, Math.min(comp.height - 1, Math.floor(y)));

    // Return cached color if sampling the same pixel as last time
    const last = lastSampleRef.current;
    if (last.x === clampedX && last.y === clampedY) {
      return last.color;
    }

    const imageData = ctx.getImageData(clampedX, clampedY, 1, 1);
    let [r, g, b] = imageData.data;
    const a = imageData.data[3];

    let color: string;
    if (a < 10) {
      color = 'rgb(255, 255, 255)';
    } else {
      if (r <= 30 && g <= 30 && b <= 30) {
        r = 0; g = 0; b = 0;
      } else if (r >= 225 && g >= 225 && b >= 225) {
        r = 255; g = 255; b = 255;
      }
      color = `rgb(${r}, ${g}, ${b})`;
    }

    // Update cache
    lastSampleRef.current = { x: clampedX, y: clampedY, color };
    return color;
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
      if (!skipDrawingCanvas && drawingCanvasRef && (isDrawing || drawingCanvasHasContent)) {
        // Strictly avoid overlaying CC animation frames above the stack.
        // Skip drawing the overlay when ANY brush-based Color Cycle layer is animating
        // or when the animation manager is playing.
        const anyCCAnimating = layers.some(l => (
          l.visible && l.layerType === 'color-cycle' && (l as any).colorCycleData?.mode !== 'recolor' && !!(l as any).colorCycleData?.isAnimating
        ));
        const isManagerPlaying = colorCycleManagerRef.current?.isPlaying() || false;

        if (!anyCCAnimating && !isManagerPlaying) {
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
        
        // Ensure we have a reusable paste canvas
        if (!pasteCanvasRef.current) {
          pasteCanvasRef.current = document.createElement('canvas');
        }
        const pasteCanvas = pasteCanvasRef.current;

        // Resize only when dimensions change
        let needsUpdate = false;
        if (pasteCanvas.width !== floatingPaste.width || pasteCanvas.height !== floatingPaste.height) {
          pasteCanvas.width = floatingPaste.width;
          pasteCanvas.height = floatingPaste.height;
          needsUpdate = true;
        }

        // Update image data only when it changes or canvas resized
        if (lastPasteInfoRef.current.imageData !== floatingPaste.imageData || needsUpdate) {
          const pasteCtx = pasteCanvas.getContext('2d', { willReadFrequently: true });
          if (pasteCtx) {
            pasteCtx.putImageData(floatingPaste.imageData, 0, 0);
            lastPasteInfoRef.current = {
              imageData: floatingPaste.imageData,
              width: pasteCanvas.width,
              height: pasteCanvas.height,
            };
          }
        }

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
  const panOffsetX = pan.panState.offsetX;
  const panOffsetY = pan.panState.offsetY;

  useEffect(() => {
    setCanvasOffset(panOffsetX, panOffsetY);
  }, [panOffsetX, panOffsetY, setCanvasOffset]);
  
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
  // Run initial centering once after sizing
  const hasCenteredRef = useRef(false);
  
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
  // Guard to avoid repeatedly stopping animations when already stopped
  const hasStoppedAnimationRef = useRef(false);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateViewport = () => {
      const wrapper = wrapperRef.current;
      if (!wrapper) {
        return;
      }
      const rect = wrapper.getBoundingClientRect();
      setCanvasViewport({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      });
    };

    updateViewport();

    const wrapper = wrapperRef.current;
    let resizeObserver: ResizeObserver | null = null;
    if (wrapper && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateViewport();
      });
      resizeObserver.observe(wrapper);
    }

    window.addEventListener('resize', updateViewport);
    window.addEventListener('scroll', updateViewport, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('scroll', updateViewport, true);
    };
  }, [setCanvasViewport]);

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

  // Stop all color-cycle playback when switching to a non-CC layer
  useEffect(() => {
    const activeLayer = layers.find(l => l.id === activeLayerId);
    const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
    if (isColorCycleLayer) {
      // Reset guard so a future switch away from CC can stop again
      hasStoppedAnimationRef.current = false;
      return;
    }

    // If we've already stopped while on non-CC, avoid redundant work
    if (hasStoppedAnimationRef.current) return;

    try {
      // Pause recolor animations (global controller)
      const rm = RecolorManager.getInstance();
      if (rm.isAnimating()) rm.pause();
    } catch {}

    try {
      // Stop brush-based continuous animation loop and redraw
      wrappedStopAnimation();
    } catch {}

    try {
      // Clear isAnimating flags on all brush-based CC layers so render loop doesn't advance them
      const st = useAppStore.getState();
      st.layers
        .filter(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode !== 'recolor' && l.colorCycleData?.isAnimating)
        .forEach(l => {
          st.updateLayer(l.id, {
            colorCycleData: {
              ...l.colorCycleData,
              isAnimating: false
            }
          } as any);
        });
    } catch {}
    // Mark as stopped so this effect doesn't run repeatedly from its own updates
    hasStoppedAnimationRef.current = true;
  }, [activeLayerId, layers, wrappedStopAnimation]);
  
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
      // debug log removed
      
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
      
      // debug log removed
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
      setShowBrushCursor(isPointerInsideCanvas());
    }
  }, [defaultCursorStyle, isPointerInsideCanvas, setCursorStyle]);


  // Direct DOM keyboard handling for instant panning response
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in inputs or editable areas
      const target = e.target as HTMLElement | null;
      if (target && (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      )) {
        // Space must take precedence even if focus is in inputs (e.g., toggles)
        if (e.code !== 'Space') return;
      }

      // Read current scope (but allow Space regardless of most scopes)
      const currentScope = useAppStore.getState().ui.keyboardScope;

      // Space should take precedence over most actions (except modals)
      if (e.code === 'Space' && !isSpacePressedRef.current) {
        e.preventDefault();
        e.stopPropagation();

        // quiet

        // Do not start panning if a modal has focus
        if (currentScope === 'modal') return;

        isSpacePressedRef.current = true;
        setShowBrushCursorRef.current(false);
        setCursorStyleRef.current('grab');
        
        // Start panning immediately if mouse is down
        if (isMouseDownRef.current && mousePosition.x !== undefined && mousePosition.y !== undefined) {
          panRef.current.startPan(mousePosition.x, mousePosition.y);
          setCursorStyleRef.current('grabbing');
          // quiet
        }
        return;
      }

      // Non-space keys respect keyboard scope
      if (currentScope !== 'canvas') return;
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      )) {
        // Allow Space release to flow even if an input is focused
        if (e.code !== 'Space') return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        isSpacePressedRef.current = false;

        const wasPanning = panRef.current.panState.isPanning;
        if (wasPanning) {
          panRef.current.endPan();
        }
        setCursorStyleRef.current(defaultCursorStyle);
        setShowBrushCursorRef.current(true);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true } as any);
      window.removeEventListener('keyup', handleKeyUp, { capture: true } as any);
    };
  }, [defaultCursorStyle]); // Only defaultCursorStyle as it's a string constant

  // Monitor undo stack changes (quiet)
  useEffect(() => {
    let prevLength = useAppStore.getState().history.undoStack.length;
    const unsubscribe = useAppStore.subscribe((state) => {
      const length = state.history.undoStack.length;
      if (length > prevLength) {
        // quiet
      }
      prevLength = length;
    });
    return unsubscribe;
  }, []);

  // Comprehensive keyboard handling (for other keys)
  const keyboard = useComprehensiveKeyboard({
    onSpacePressed: () => {
      // Fallback: ensure space press is honored even if our direct handler missed it
      if (!isSpacePressedRef.current) {
        isSpacePressedRef.current = true;
        setShowBrushCursorRef.current(false);
        setCursorStyleRef.current('grab');
        if (isMouseDownRef.current && mousePosition.x !== undefined && mousePosition.y !== undefined) {
          panRef.current.startPan(mousePosition.x, mousePosition.y);
          setCursorStyleRef.current('grabbing');
          // quiet
        }
      }
    },
    onSpaceReleased: () => {
      if (isSpacePressedRef.current) {
        isSpacePressedRef.current = false;
        if (panRef.current.panState.isPanning) {
          panRef.current.endPan();
        }
        setCursorStyleRef.current(defaultCursorStyle);
        setShowBrushCursorRef.current(true);
        // quiet
      }
    },
    onSave: () => {
      useAppStore.getState().saveProject().catch(() => {});
    },
    onOpen: () => {
      useAppStore.getState().loadProject().catch(() => {});
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
      const storeState = useAppStore.getState();
      const currentStack = storeState.history.undoStack;
      if (currentStack.length <= 1) {
        return;
      }

      // Pop exactly one entry via store.undo() (single-step undo)
      const snapshot = undo();
      if (snapshot) {
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
            if (shouldBeColorCycle) {
              const isRecolor = layer.colorCycleData?.mode === 'recolor';
              if (isRecolor) {
                // Preserve recolor settings and do not force-create a CC brush canvas
                return {
                  ...baseLayer,
                  layerType: 'color-cycle' as const,
                  colorCycleData: {
                    ...layer.colorCycleData, // includes mode:'recolor' and recolorSettings
                    // Ensure animation state is paused upon restore
                    isAnimating: false,
                    // Do not attach canvas/brush for recolor mode here
                  }
                };
              }
              // Prefer existing canvas if present, otherwise create one
              let canvas = existingLayer?.colorCycleData?.canvas;
              if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.width = layer.colorCycleData?.canvasWidth || (layer.imageData?.width ?? 1920);
                canvas.height = layer.colorCycleData?.canvasHeight || (layer.imageData?.height ?? 1080);
              }

              // Restore the canvas content from saved canvasImageData when available,
              // otherwise fall back to the layer's imageData stored in the snapshot.
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (layer.colorCycleData?.canvasImageData) {
                  ctx.putImageData(layer.colorCycleData.canvasImageData, 0, 0);
                } else if (layer.imageData) {
                  ctx.putImageData(layer.imageData, 0, 0);
                }
              }

              // Add colorCycleData to the layer
              return {
                ...baseLayer,
                colorCycleData: {
                  gradient: layer.colorCycleData?.gradient,
                  // Pause animation after undo restore to avoid wiping pixels before canvas restore
                  isAnimating: false,
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

          // Restore color cycle internal state after layers are in place
          if (snapshot.colorCycleState) {
            const { layerId } = snapshot.colorCycleState;
            const restoredActive = restoredLayers.find((l: any) => l.id === layerId);
            if (restoredActive?.colorCycleData?.colorCycleBrush) {
              restoredActive.colorCycleData.colorCycleBrush.restoreFullState({
                gradients: snapshot.colorCycleState.gradients.map(g => ({
                  gradientStops: g.gradientStops
                })),
                animationState: snapshot.colorCycleState.animationState,
                layerSnapshots: snapshot.colorCycleState.layerStrokes
              });

              // quiet
            }
          }
          
          // If the active layer is a CC layer, ensure its canvas content is captured
          // into imageData so exports and non-CC paths stay consistent.
          try {
            const activeRestored = restoredLayers.find((l: any) => l.id === snapshot.activeLayerId);
            if (activeRestored?.layerType === 'color-cycle' && activeRestored.colorCycleData?.canvas) {
              const { captureCanvasToActiveLayer } = useAppStore.getState();
              // Fire and forget; keep UI responsive
              captureCanvasToActiveLayer(activeRestored.colorCycleData.canvas).catch(() => {});
            }
          } catch {}
          
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
            if (shouldBeColorCycle) {
              const isRecolor = layer.colorCycleData?.mode === 'recolor';
              if (isRecolor) {
                // Preserve recolor settings and do not force-create a CC brush canvas
                return {
                  ...baseLayer,
                  layerType: 'color-cycle' as const,
                  colorCycleData: {
                    ...layer.colorCycleData, // includes mode:'recolor' and recolorSettings
                    isAnimating: false,
                  }
                };
              }
              // Prefer existing canvas if present, otherwise create one
              let canvas = existingLayer?.colorCycleData?.canvas;
              if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.width = layer.colorCycleData?.canvasWidth || (layer.imageData?.width ?? 1920);
                canvas.height = layer.colorCycleData?.canvasHeight || (layer.imageData?.height ?? 1080);
              }

              // Restore the canvas content from saved canvasImageData when available,
              // otherwise fall back to the layer's imageData stored in the snapshot.
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (layer.colorCycleData?.canvasImageData) {
                  ctx.putImageData(layer.colorCycleData.canvasImageData, 0, 0);
                } else if (layer.imageData) {
                  ctx.putImageData(layer.imageData, 0, 0);
                }
              }

              // Add colorCycleData to the layer
              return {
                ...baseLayer,
                colorCycleData: {
                  gradient: layer.colorCycleData?.gradient,
                  // Pause animation after redo restore to avoid wiping pixels before canvas restore
                  isAnimating: false,
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

          // Restore color cycle internal state after layers are in place
          if (snapshot.colorCycleState) {
            const { layerId } = snapshot.colorCycleState;
            const restoredActive = restoredLayers.find((l: any) => l.id === layerId);
            if (restoredActive?.colorCycleData?.colorCycleBrush) {
              restoredActive.colorCycleData.colorCycleBrush.restoreFullState({
                gradients: snapshot.colorCycleState.gradients.map(g => ({
                  gradientStops: g.gradientStops
                })),
                animationState: snapshot.colorCycleState.animationState,
                layerSnapshots: snapshot.colorCycleState.layerStrokes
              });

              // quiet
            }
          }
          
          // Keep imageData in sync for active CC layer
          try {
            const activeRestored = restoredLayers.find((l: any) => l.id === snapshot.activeLayerId);
            if (activeRestored?.layerType === 'color-cycle' && activeRestored.colorCycleData?.canvas) {
              const { captureCanvasToActiveLayer } = useAppStore.getState();
              // Fire and forget; keep UI responsive
              captureCanvasToActiveLayer(activeRestored.colorCycleData.canvas).catch(() => {});
            }
          } catch {}
          
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
            
            if (activeLayer.colorCycleData?.canvas) {
              // Log what we're saving
              const ctx = activeLayer.colorCycleData.canvas.getContext('2d', { willReadFrequently: true });
              const imageData = ctx?.getImageData(0, 0, 100, 100); // Sample corner
            }
            
            // Don't save here - it will be saved in finalizeDrawing
            // This prevents duplicate undo entries for color cycle shapes
            
            
            // Start a fresh CC stroke buffer for each new shape to avoid accumulation
            brushEngine.resetColorCycle(true);
            
            
            // Fill shape with color cycle gradient from edges to center
            const points = toolStateMachine.polygonGradientState.points.map(p => ({ x: p.x, y: p.y }));
            brushEngine.fillColorCycleShape(points);
            
            // Clear the drawing canvas before rendering
            drawCtx.clearRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);
            
            // Render the color cycle immediately at full opacity
            brushEngine.renderColorCycle(drawCtx, false);
            
          } else if (toolStateMachine.isContourPolygon) {
            // Check if it's a contour polygon
            brushEngine.drawContourPolygon(
              drawCtx,
              {
                vertices: toolStateMachine.polygonGradientState.points.map(p => ({ x: p.x, y: p.y })),
                fillColor: toolStateMachine.polygonGradientState.points[0]?.color
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
          
          drawingHandlers.finalizeDrawing().then(() => {
            
            
            // Check if another save happened during finalization
            const stackLength = useAppStore.getState().history.undoStack.length;
            
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
    },
    // Surface errors consistently in pointer handlers too
    feedback: showFeedback
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
    // Reset last sampled pixel cache after recomposition
    lastSampleRef.current = { x: -1, y: -1, color: 'rgb(0, 0, 0)' };
    
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
        
        // Always restore the default cursor and only show the brush when pointer is over canvas
        setCursorStyle(defaultCursorStyle);
        setShowBrushCursor(isPointerInsideCanvas());
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
  }, [defaultCursorStyle, isPointerInsideCanvas, setCursorStyle, setShowBrushCursor]);
  
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

        // Center the project within the viewport once after initial sizing
        if (!hasCenteredRef.current && project) {
          const scale = (viewTransform.scale || 1);
          const contentWidth = project.width * scale;
          const contentHeight = project.height * scale;
          const offsetX = Math.floor((width - contentWidth) / 2);
          const offsetY = Math.floor((height - contentHeight) / 2);

          // Apply pan and update transform immediately to avoid visual lag
          pan.setPan(offsetX, offsetY);
          viewTransformRef.current.offsetX = offsetX;
          viewTransformRef.current.offsetY = offsetY;

          if (drawFunc) {
            drawFunc(ctx, viewTransformRef.current);
          }

          hasCenteredRef.current = true;
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
  
  // Center when project becomes available (e.g., created after mount)
  useEffect(() => {
    if (!project) return;
    const canvasEl = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvasEl || !wrapper) return;
    if (hasCenteredRef.current) return;

    const { width, height } = wrapper.getBoundingClientRect();
    const scale = (viewTransformRef.current?.scale || 1);
    const contentWidth = project.width * scale;
    const contentHeight = project.height * scale;
    const offsetX = Math.floor((width - contentWidth) / 2);
    const offsetY = Math.floor((height - contentHeight) / 2);

    pan.setPan(offsetX, offsetY);
    viewTransformRef.current.offsetX = offsetX;
    viewTransformRef.current.offsetY = offsetY;

    const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    if (ctx && drawRef.current) {
      drawRef.current(ctx, viewTransformRef.current);
    }

    hasCenteredRef.current = true;
  }, [project, pan.setPan]);

  
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
      {(() => {
        const active = tools.currentTool === 'eraser' ? tools.eraserSettings : tools.brushSettings;
        return (
          <BrushCursor
            screenX={mousePosition.x}
            screenY={mousePosition.y}
            size={active.size}
            brushShape={active.brushShape || BrushShape.ROUND}
            zoom={canvas?.zoom || 1}
            color={active.color}
            customBrush={active.currentBrushTip ? {
              imageData: active.currentBrushTip.imageData,
              width: active.currentBrushTip.width || 32,
              height: active.currentBrushTip.height || 32
            } : null}
            visible={showBrushCursor && !pan.panState.isPanning && !isSpacePressedRef.current && cursorStyle === 'none'}
          />
        );
      })()}
    </div>
  );
};

export default React.memo(DrawingCanvas);
