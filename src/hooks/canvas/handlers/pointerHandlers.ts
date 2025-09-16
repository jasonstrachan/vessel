import React from 'react';
import { useAppStore } from '../../../stores/useAppStore';
import { RecolorManager } from '../../../lib/colorCycle/RecolorManager';
import type { EventHandlerDependencies, PointerHandlers } from '../utils/types';
import { BrushShape } from '../../../types';
import { buildPreviewVertices } from '../../../utils/shapeMaker';
import { debugLog, debugWarn } from '../../../utils/debug';
import { snapPointToAngle } from '../../../utils/angleSnap';
import { floodFill } from '../../../utils/floodFill';
import { detectWacomIssues, testWacomPressure } from '../../../utils/detectWacom';
import { getPresetStops } from '../../../utils/gradientPresets';

export const createPointerHandlers = (deps: EventHandlerDependencies): PointerHandlers => {
  // Cap overlay previews to 30 FPS to reduce main-thread load during drag
  const OVERLAY_PREVIEW_FRAME_MS = 1000 / 30;
  let lastOverlayPreviewTs = 0;
  const {
    canvasRef,
    overlayCanvasRef,
    compositeCanvasRef,
    isBusyRef,
    isMouseDownRef,
    isSpacePressedRef,
    drawAnimationFrameRef,
    pointerMoveThrottled,
    project,
    canvas,
    tools,
    layers,
    activeLayerId,
    selectionStart,
    selectionEnd,
    floatingPaste,
    setSelectionBounds,
    clearSelection,
    setCurrentOffscreenCanvas,
    compositeLayersToCanvas,
    saveCanvasState,
    updateLayer,
    setIsDraggingFloatingPaste,
    floatingPasteDragStart,
    floatingPasteOriginalPos,
    setCursorStyle,
    setShowBrushCursor,
    setMousePosition,
    updateFloatingPastePosition,
    interaction,
    stateMachine,
    pan,
    toolStateMachine,
    drawingHandlers,
    brushEngine,
    sampleColorsAlongLine,
    getMousePos,
    compositeCanvasDirtyRef,
    setNeedsRedraw
  } = deps;

  // Track stroke start to support Shift-based angle snapping for freehand drawing (persist via refs)
  const strokeStartWorldPosRef = (deps.snapStrokeStartRef ?? ({ current: null } as any));
  const shiftAnchorWorldPosRef = (deps.snapShiftAnchorRef ?? ({ current: null } as any));
  const lastBrushSampleWorldPosRef = (deps.snapLastBrushSampleRef ?? ({ current: null } as any)); // last point sent to continueDrawing

  // Track whether the pointer is currently within the canvas bounds. This stays accurate
  // even when pointer capture is active so we can hide the brush cursor once the pointer
  // drifts over the UI column.
  let pointerInsideCanvas = false;

  const isPointerWithinCanvas = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return false;
    return clientX >= rect.left && clientX <= rect.right &&
           clientY >= rect.top && clientY <= rect.bottom;
  };

  const updateBrushCursorVisibility = (overridePointerInside?: boolean) => {
    const pointerInside = overridePointerInside ?? pointerInsideCanvas;
    const shouldHideCursor = stateMachine.isAwaitingPan ||
                             stateMachine.isPanning ||
                             tools.currentTool === 'custom' ||
                             deps.isDraggingFloatingPaste ||
                             (!!floatingPasteDragStart.current) ||
                             !pointerInside;
    const nextVisible = !shouldHideCursor;
    console.log('[BrushCursor] pointerInsideCanvas', pointerInside, 'shouldHide', shouldHideCursor, 'showBrushCursor', nextVisible);

    setShowBrushCursor(nextVisible);
  };

  // Helper: Determine if current brush and active layer are compatible
  const checkLayerBrushCompatibility = () => {
    const activeLayer = layers.find(l => l.id === activeLayerId);
    const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
    const brushShape = tools.brushSettings.brushShape;
    const isCCBrush = brushShape === BrushShape.COLOR_CYCLE || brushShape === BrushShape.COLOR_CYCLE_SHAPE;

    // Mismatch if CC brush on normal layer OR regular brush/tool on CC layer
    const mismatch = (isColorCycleLayer && !isCCBrush) || (!isColorCycleLayer && isCCBrush);
    if (!mismatch) return { ok: true } as const;

    // Compose a clear message
    const message = isColorCycleLayer
      ? "Can't use regular brushes on a Color Cycle layer. Switch layers or select a Color Cycle brush."
      : "Can't use Color Cycle brushes on a normal layer. Create/select a Color Cycle layer.";
    return { ok: false, message } as const;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Track that pointer is down
    isMouseDownRef.current = true;
    
    // If the app is busy, ignore this pointer event completely
    if (isBusyRef.current) {
      isMouseDownRef.current = false; // Clear ref in case pointerup is missed
      return;
    }
    
    // Always prevent default to avoid browser drag behavior
    event.preventDefault();
    
    // Capture pointer for consistent events even when pointer moves outside canvas
    (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);

    pointerInsideCanvas = true;
    setMousePosition({ x: event.clientX, y: event.clientY });
    
    const rect = canvasRef.current?.getBoundingClientRect();
    const pointerPos = rect ? {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    } : { x: 0, y: 0 };
    
    // Store pressure value (0-1, with 0.5 as default for mice)
    // For testing: Simulate pressure with mouse using Shift (low) and Ctrl (high)
    let pressure = event.pressure || 0.5;
    if (event.pointerType === 'mouse' && tools.brushSettings.pressureEnabled) {
      if (event.shiftKey) {
        pressure = 0.1; // Simulate low pressure with Shift
      } else if (event.ctrlKey) {
        pressure = 0.9; // Simulate high pressure with Ctrl
      }
    }
    
    // Test Wacom functionality
    const wacomTest = testWacomPressure(event);
    if (!wacomTest.isWorking && tools.brushSettings.pressureEnabled) {
      const issues = detectWacomIssues();
      // Intentionally silent to avoid console noise
    }
    
    // SIMPLIFIED PANNING: Just check if space is pressed
    if (isSpacePressedRef.current) {
      pan.startPan(pointerPos.x, pointerPos.y);
      setCursorStyle('grabbing');
      setShowBrushCursor(false);
      // Intentionally quiet: avoid console noise for common panning
      return; // Skip everything else - we're panning
    }
    
    // Middle or right click - skip
    if (event.button === 1 || event.button === 2) {
      return;
    }
    
    const scale = canvas?.zoom || 1;
    const worldPos = pan.screenToWorld(pointerPos.x, pointerPos.y, scale);
    // Intentionally quiet

    // Recolor/Brush sampling finalize (on second click as a fallback)
    const rsUp = useAppStore.getState().recolorSampling;
    if (rsUp.active && rsUp.start) {
      const start = rsUp.start;
      const end = { x: worldPos.x, y: worldPos.y };
      const samples = Math.max(2, Math.min(32, rsUp.samples || 12));
      const colors = sampleColorsAlongLine(start.x, start.y, end.x, end.y, samples);
      const stops = colors.map((c, i) => ({ position: samples === 1 ? 0 : i / (samples - 1), color: cssColorToHex(c) }));
      // Determine target (recolor layer vs brush settings)
      const target = rsUp.target || 'recolor';

      if (target === 'recolor') {
        const layer = layers.find(l => l.id === activeLayerId);
        if (layer) {
          const manager = RecolorManager.getInstance();
          (async () => {
            try {
              if (!layer.colorCycleData?.recolorSettings) {
                const ok = await manager.processLayer(layer, {
                  quantizationMode: 'rgb332',
                  ditherMode: 'off',
                  cycleColors: 16,
                  gradientPreset: 'custom',
                  customGradient: stops
                });
                if (!ok) throw new Error('processLayer failed');
              } else {
                manager.updateGradient(layer, stops);
              }
              // Remap palette index sequence to flow along sampled direction without changing pixel structure
              const dx = end.x - start.x;
              const dy = end.y - start.y;
              const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
              try { manager.setPaletteDirectionalOrder(layer.id, angle); } catch {}
              try { manager.autoSetAnimationDirection(layer.id, angle); } catch {}
              } catch (e) {
                console.warn('Failed to apply sampled gradient', e);
              }
          })();
        }
      } else {
        // target === 'brush' -> update brush gradient settings directly
        try {
          useAppStore.getState().setBrushSettings({ colorCycleGradient: stops });
        } catch {}
      }

      const overlayCanvas = overlayCanvasRef.current;
      if (overlayCanvas) {
        const overlayCtx = overlayCanvas.getContext('2d');
        overlayCtx?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
      useAppStore.getState().stopRecolorSampling();
      return;
    }

    // Recolor sampling: start point
    const rs1 = useAppStore.getState().recolorSampling;
    if (rs1.active) {
      useAppStore.getState().updateRecolorSampling({ start: { x: worldPos.x, y: worldPos.y }, end: null });
      // Clear overlay
      const overlayCanvas = overlayCanvasRef.current;
      if (overlayCanvas) {
        const overlayCtx = overlayCanvas.getContext('2d');
        overlayCtx?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
      return;
    }
    
    // PRIORITY: If a floating paste exists and the click is within its bounds,
    // start dragging it BEFORE any other interactions (drawing, selection, etc.).
    if (event.button === 0 && floatingPaste) {
      const pasteX = floatingPaste.position.x;
      const pasteY = floatingPaste.position.y;
      const pasteWidth = floatingPaste.width;
      const pasteHeight = floatingPaste.height;

      if (worldPos.x >= pasteX && worldPos.x <= pasteX + pasteWidth &&
          worldPos.y >= pasteY && worldPos.y <= pasteY + pasteHeight) {
        setIsDraggingFloatingPaste(true);
        floatingPasteDragStart.current = worldPos;
        floatingPasteOriginalPos.current = { ...floatingPaste.position };
        setCursorStyle('move');
        return; // Do not start drawing/selection when dragging paste
      }
    }

    // Check the state BEFORE dispatching - this is critical!
    const currentMode = stateMachine.state.mode;

    // Dispatch to state machine with SCREEN position for normal interactions
    stateMachine.dispatch({ 
      type: 'MOUSE_DOWN', 
      button: event.button,
      position: pointerPos,  // Use screen coordinates, not world
      tool: tools.currentTool,
      pressure
    });
    
    // --- PROPER FIX: Block clicks outside canvas bounds ---
    if (project) {
      if (worldPos.x < 0 || worldPos.x > project.width || 
          worldPos.y < 0 || worldPos.y > project.height) {
        return; // Don't start any action if click is out of bounds
      }
    }

    // Shape mode should take precedence for normal brushes
    // Start shape drawing immediately to avoid interference from other branches
    if (
      event.button === 0 &&
      (tools.currentTool === 'brush' || tools.currentTool === 'eraser') &&
      tools.shapeMode &&
      tools.brushSettings.brushShape !== BrushShape.RECTANGLE_GRADIENT &&
      tools.brushSettings.brushShape !== BrushShape.POLYGON_GRADIENT &&
      tools.brushSettings.brushShape !== BrushShape.CONTOUR_POLYGON &&
      tools.brushSettings.brushShape !== BrushShape.COLOR_CYCLE_SHAPE
    ) {
      // quiet
      // Strictly block incompatible brush/layer combinations (but allow eraser on any layer)
      if (tools.currentTool !== 'eraser') {
        const compat = checkLayerBrushCompatibility();
        if (!compat.ok) {
          deps.feedback?.(compat.message);
          return;
        }
      }

      // Initialize snapping anchors for this stroke
      strokeStartWorldPosRef.current = worldPos;
      lastBrushSampleWorldPosRef.current = worldPos;
      shiftAnchorWorldPosRef.current = event.shiftKey ? worldPos : null;
      // quiet

      interaction.dispatch({ type: 'DRAWING_START', pressure });
      drawingHandlers.startShapeDrawing(worldPos, pressure);
      return;
    }
    
    // For simple drawing mode, use the existing drawing handlers
    // Use the currentMode captured BEFORE dispatch!
    if (currentMode === 'IDLE' && 
        (tools.currentTool === 'brush' || tools.currentTool === 'eraser') &&
        !tools.shapeMode &&
        tools.brushSettings.brushShape !== BrushShape.RECTANGLE_GRADIENT &&
        tools.brushSettings.brushShape !== BrushShape.POLYGON_GRADIENT &&
        tools.brushSettings.brushShape !== BrushShape.CONTOUR_POLYGON &&
        tools.brushSettings.brushShape !== BrushShape.COLOR_CYCLE_SHAPE) {
      // Strictly block incompatible brush/layer combinations (but allow eraser on any layer)
      if (tools.currentTool !== 'eraser') {
        const compat = checkLayerBrushCompatibility();
        if (!compat.ok) {
          deps.feedback?.(compat.message);
          return;
        }
      }
      
      // Initialize snapping anchors for this stroke
      strokeStartWorldPosRef.current = worldPos;
      lastBrushSampleWorldPosRef.current = worldPos;
      shiftAnchorWorldPosRef.current = event.shiftKey ? worldPos : null;
      // quiet

      // Use the existing drawing system with brush engine
      interaction.dispatch({ type: 'DRAWING_START', pressure });
      drawingHandlers.startDrawing(worldPos, pressure);
      return;
    }
    
    // Handle left click
    if (event.button === 0) {
      // Handle fill tool
      if (tools.currentTool === 'fill') {
        // Block fill on CC layers
        const compat = checkLayerBrushCompatibility();
        if (!compat.ok) {
          deps.feedback?.(compat.message);
          return;
        }
        // Get the active layer
        const activeLayer = layers.find(l => l.id === activeLayerId);
        if (!activeLayer || !activeLayer.imageData) return;
        
        // Parse fill color - handle both hex and rgb formats
        const fillColor = tools.brushSettings.color;
        let r = 0, g = 0, b = 0;
        
        if (fillColor.startsWith('#')) {
          // Handle hex color
          const hex = fillColor.slice(1);
          r = parseInt(hex.substring(0, 2), 16);
          g = parseInt(hex.substring(2, 4), 16);
          b = parseInt(hex.substring(4, 6), 16);
        } else if (fillColor.startsWith('rgb')) {
          // Handle rgb/rgba color
          const matches = fillColor.match(/\d+/g);
          if (matches) {
            [r, g, b] = matches.map(Number);
          }
        }
        
        // Perform flood fill on the active layer's image data
        const filledImageData = floodFill(
          activeLayer.imageData,
          Math.floor(worldPos.x),
          Math.floor(worldPos.y),
          { r, g, b, a: 255 },
          {
            threshold: tools.fillSettings.threshold,
            contiguous: tools.fillSettings.contiguous
          }
        );
        
        // Update the layer with the filled image data
        if (activeLayerId) {
          updateLayer(activeLayerId, { imageData: filledImageData });
        }
        
        // Save state for undo
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = project?.width || 1920;
        tempCanvas.height = project?.height || 1080;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        if (tempCtx) {
          tempCtx.putImageData(filledImageData, 0, 0);
          saveCanvasState(tempCanvas, 'fill', 'Flood fill');
        }
        
        return;
      }
      
      // Handle selection tool
      // If using custom tool BUT shape mode is ON, treat as shape drawing with current brush
      if (tools.currentTool === 'custom' && tools.shapeMode) {
        // quiet
        // Start shape drawing with the selected custom brush
        interaction.dispatch({ type: 'DRAWING_START', pressure });
        drawingHandlers.startShapeDrawing(worldPos, pressure);
        return;
      }

      if (tools.currentTool === 'selection' || (tools.currentTool === 'custom' && !tools.shapeMode)) {
        interaction.dispatch({ type: 'SELECTION_START' });
        interaction.refs.selectionStart.current = worldPos;
        setSelectionBounds(worldPos, worldPos);
        if (tools.currentTool === 'custom') {
          setShowBrushCursor(false); // Hide brush cursor when making custom brush selection
        }
        return;
      }
      
      // Handle direction selection click for linear gradient fill
      if (drawingHandlers.isSelectingDirectionRef?.current) {
        // quiet
        // Pass the click position to finalize the direction
        drawingHandlers.startShapeDrawing(worldPos, pressure);
        // quiet
        // Now finalize with the direction set
        drawingHandlers.finalizeShapeDrawing();
        // quiet
        return;
      }
      
      // Clear selection when clicking outside of selected area (for any other tool)
      if (selectionStart && selectionEnd) {
        const minX = Math.min(selectionStart.x, selectionEnd.x);
        const maxX = Math.max(selectionStart.x, selectionEnd.x);
        const minY = Math.min(selectionStart.y, selectionEnd.y);
        const maxY = Math.max(selectionStart.y, selectionEnd.y);
        
        // Check if click is outside selection bounds
        if (worldPos.x < minX || worldPos.x > maxX || worldPos.y < minY || worldPos.y > maxY) {
          clearSelection();
        }
      }
      
      // Handle rectangle gradient
      if (toolStateMachine.isRectangleGradient) {
        // Block rectangle gradient on CC layers
        const compat = checkLayerBrushCompatibility();
        if (!compat.ok) {
          deps.feedback?.(compat.message);
          return;
        }
        const result = toolStateMachine.handleRectangleGradientMouseDown(worldPos);
        if (result === 'finalize') {
          // This click finalizes the width - draw the rectangle
          const currentRectState = toolStateMachine.rectangleBrushState;
          
          drawingHandlers.initDrawingCanvas();
          const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
          
          if (drawCtx && brushEngine) {
            const dx = currentRectState.endPos.x - currentRectState.startPos.x;
            const dy = currentRectState.endPos.y - currentRectState.startPos.y;
            const length = Math.hypot(dx, dy);
            
            if (length > 0) {
              // Calculate perpendicular distance from mouse to line
              const lineVecX = dx / length;
              const lineVecY = dy / length;
              const toMouseX = worldPos.x - currentRectState.startPos.x;
              const toMouseY = worldPos.y - currentRectState.startPos.y;
              const perpDist = Math.abs(-lineVecY * toMouseX + lineVecX * toMouseY);
              const width = perpDist * 2;
              
              // Determine colors: preset (resampled) or sampled from canvas
              const numColors = Math.max(2, Math.min(64, tools.brushSettings.colors || 2));
              let colorsForGradient: string[] = [];
              const presetId = tools.brushSettings.rectGradientPresetId || 'none';
              if (presetId !== 'none') {
                const stops = getPresetStops(presetId) || [];
                colorsForGradient = resampleStopsToColors(stops, numColors);
              } else {
                colorsForGradient = sampleColorsAlongLine(
                  currentRectState.startPos.x,
                  currentRectState.startPos.y,
                  currentRectState.endPos.x,
                  currentRectState.endPos.y,
                  numColors
                );
              }
              
              // Draw the rectangle gradient (this is final, not preview)
              brushEngine.drawRectangleGradient(
                drawCtx,
                currentRectState.startPos.x,
                currentRectState.startPos.y,
                currentRectState.endPos.x,
                currentRectState.endPos.y,
                width,  // Use the calculated width, not currentRectState.width
                colorsForGradient.length > 0 ? colorsForGradient : [tools.brushSettings.color],
                false  // false = not preview, this is the final draw
              );
              
              drawingHandlers.drawingCanvasHasContent.current = true;
              
              // Mark composite as dirty BEFORE finalization
              compositeCanvasDirtyRef.current = true;
              
              // Finalize the drawing (rectangles are not CC shapes, so don't skip save)
              drawingHandlers.finalizeDrawing(false).then(() => {
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
              });
            }
          }
          
          // Clear the overlay canvas
          const overlayCanvas = overlayCanvasRef.current;
          if (overlayCanvas) {
            const overlayCtx = overlayCanvas.getContext('2d');
            if (overlayCtx) {
              overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            }
          }
          
          toolStateMachine.resetRectangleGradient();
          interaction.dispatch({ type: 'DRAWING_END' });
        } else if (result === true) {
          interaction.dispatch({ type: 'DRAWING_START', mode: 'definingLength' });
        }
        return;
      }
      
      // Handle polygon gradient, color cycle shape, or contour polygon
      if (toolStateMachine.isPolygonGradient || toolStateMachine.isColorCycleShape || toolStateMachine.isContourPolygon) {
        
        // Allow only CC shape on CC layers; block others accordingly
        const activeLayer = layers.find(l => l.id === activeLayerId);
        const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
        const isCCShape = toolStateMachine.isColorCycleShape;
        if ((isColorCycleLayer && !isCCShape) || (!isColorCycleLayer && isCCShape)) {
          const msg = isColorCycleLayer
            ? "Can't use regular polygon/contour on a Color Cycle layer. Select a Color Cycle shape, or switch layers."
            : "Can't use Color Cycle shape on a normal layer. Create/select a Color Cycle layer.";
          deps.feedback?.(msg);
          return;
        }
        // Drive COLOR_CYCLE_SHAPE with local shape refs to avoid heavy store updates
        if (isCCShape) {
          // Proactively pause animations at the first vertex for CC shape previews
          drawingHandlers.stopContinuousColorCycleAnimation?.();
          interaction.dispatch({ type: 'DRAWING_START' });
          drawingHandlers.startShapeDrawing(worldPos, pressure);
          return;
        }

        // Polygon gradient / contour polygon via tool state machine
        if (toolStateMachine.handlePolygonGradientMouseDown(worldPos)) {
          interaction.dispatch({ type: 'DRAWING_START' });
        }
        return;
      }
      
      // Normal brush or shape mode
      // BUT ONLY if we're not in pan mode, NOT using gradient/contour tools,
      // AND the active tool actually supports painting (brush/eraser).
      // This prevents painting while the 'recolor' tool is selected.
      if (
        currentMode === 'IDLE' &&
        (tools.currentTool === 'brush' || tools.currentTool === 'eraser') &&
        !toolStateMachine.isRectangleGradient &&
        !toolStateMachine.isPolygonGradient &&
        !toolStateMachine.isColorCycleShape &&
        !toolStateMachine.isContourPolygon
      ) {
        interaction.dispatch({ type: 'DRAWING_START', pressure });
        if (tools.shapeMode) {
          drawingHandlers.startShapeDrawing(worldPos, pressure);
        } else {
          drawingHandlers.startDrawing(worldPos, pressure);
        }
      }
    }
};

// --- Helper functions for preset gradient resampling ---
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (x: number) => x.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

type Stop = { position: number; color: string };

function interpolateStopColorAt(pos: number, stops: Stop[]): string {
  if (!stops.length) return '#ffffff';
  if (stops.length === 1) return stops[0].color;
  let before = stops[0];
  let after = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (pos >= stops[i].position && pos <= stops[i + 1].position) {
      before = stops[i];
      after = stops[i + 1];
      break;
    }
  }
  const range = after.position - before.position;
  const t = range > 0 ? (pos - before.position) / range : 0;
  const a = hexToRgb(before.color);
  const b = hexToRgb(after.color);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return rgbToHex(r, g, bl);
}

function resampleStopsToColors(stops: Stop[], count: number): string[] {
  const n = Math.max(2, count | 0);
  const arr: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    arr.push(interpolateStopColorAt(t, stops));
  }
  return arr;
}

// Convert rgb(...) to #rrggbb
function cssColorToHex(color: string): string {
  if (color.startsWith('#')) return color;
  const m = /rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(color);
  if (!m) return '#ffffff';
  const r = Number(m[1]).toString(16).padStart(2, '0');
  const g = Number(m[2]).toString(16).padStart(2, '0');
  const b = Number(m[3]).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

  // RAF aggregator for pointermove to ensure at most one heavy processing per frame
  let scheduledMoveRAF: number | null = null;
  let lastMoveEvent: React.PointerEvent<HTMLCanvasElement> | null = null;

  const processPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const currentPointerPos = rect ? {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    } : { x: 0, y: 0 };
    const scale = canvas?.zoom || 1;

    pointerInsideCanvas = isPointerWithinCanvas(event.clientX, event.clientY);
    const worldPos = pan.screenToWorld(currentPointerPos.x, currentPointerPos.y, scale);

    // Always update cursor position immediately for responsive feel
    setMousePosition({ x: event.clientX, y: event.clientY });

    // If space is held and mouse is down, but pan hasn't started yet, start it now and exit early.
    if (isSpacePressedRef.current && isMouseDownRef.current && !pan.panState.isPanning) {
      debugLog('pan', 'MOVE fallback startPan', { pos: currentPointerPos });
      pan.startPan(currentPointerPos.x, currentPointerPos.y);
      setCursorStyle('grabbing');
      setShowBrushCursor(false);
      return; // Important: skip shape/brush updates on the same frame
    }

    // PANNING TAKES PRECEDENCE: if actively panning, update pan and skip other handling
    if (pan.panState.isPanning) {
      pan.updatePan(currentPointerPos.x, currentPointerPos.y);

      // Update view transform for immediate feedback
      deps.viewTransformRef.current.offsetX = pan.panState.offsetX;
      deps.viewTransformRef.current.offsetY = pan.panState.offsetY;

      // Throttle redraws with RAF
      if (!drawAnimationFrameRef.current) {
        drawAnimationFrameRef.current = requestAnimationFrame(() => {
          const ctx = canvasRef.current?.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            deps.draw(ctx, deps.viewTransformRef.current);
          }
          drawAnimationFrameRef.current = null;
        });
      }

      return; // Skip all other pointer move logic while panning
    }

    // Quick visibility: show when Shift is held during drawing
    if (interaction.state.isDrawing && event.shiftKey) {
      // quiet
    }

    // Unified coalesced handling below covers both brush and shape drawing (with snapping)

    // Recolor sampling preview line
    const rsMove = useAppStore.getState().recolorSampling;
    if (rsMove.active && isMouseDownRef.current && rsMove.start) {
      const overlayCanvas = overlayCanvasRef.current;
      const overlayCtx = overlayCanvas?.getContext('2d');
      if (overlayCtx && overlayCanvas) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        overlayCtx.save();
        overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
        overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
        overlayCtx.strokeStyle = '#00d1b2';
        overlayCtx.lineWidth = 2 / deps.viewTransformRef.current.scale;
        overlayCtx.beginPath();
        overlayCtx.moveTo(rsMove.start.x, rsMove.start.y);
        overlayCtx.lineTo(worldPos.x, worldPos.y);
        overlayCtx.stroke();
        overlayCtx.restore();
      }
      return;
    }
    
    // Store pressure value (0-1, with 0.5 as default for mice)
    // For testing: Simulate pressure with mouse using Shift (low) and Ctrl (high)
    let pressure = event.pressure || 0.5;
    if (event.pointerType === 'mouse' && tools.brushSettings.pressureEnabled) {
      if (event.shiftKey) {
        pressure = 0.1; // Simulate low pressure with Shift
      } else if (event.ctrlKey) {
        pressure = 0.9; // Simulate high pressure with Ctrl
      }
    }
    
    // If Shift is currently not held, allow re-anchoring the next time it's pressed during this stroke
    if (!event.shiftKey && interaction.state.isDrawing) {
      shiftAnchorWorldPosRef.current = null;
    }

    // Process coalesced events for smoother drawing (if available)
    // This gives us all the intermediate pointer positions between events
    // Skip for gradient/contour tools as they don't need continuous drawing
    if (interaction.state.isDrawing && event.nativeEvent.getCoalescedEvents && 
        !toolStateMachine.isRectangleGradient && !toolStateMachine.isPolygonGradient && !toolStateMachine.isColorCycleShape && !toolStateMachine.isContourPolygon) {
      const coalescedEvents = event.nativeEvent.getCoalescedEvents();
      if (coalescedEvents.length > 1) {
        // Process intermediate events (skip the last one as it's the current event)
        for (let i = 0; i < coalescedEvents.length - 1; i++) {
          const coalescedEvent = coalescedEvents[i];
          const coalescedPos = rect ? {
            x: coalescedEvent.clientX - rect.left,
            y: coalescedEvent.clientY - rect.top,
          } : { x: 0, y: 0 };
          let coalescedWorldPos = pan.screenToWorld(coalescedPos.x, coalescedPos.y, scale);
          // Apply Shift-based angle snapping for coalesced events
          if (coalescedEvent.shiftKey) {
            // If Shift was pressed mid-stroke, anchor to the last sampled point
            if (!shiftAnchorWorldPosRef.current) {
              shiftAnchorWorldPosRef.current = lastBrushSampleWorldPosRef.current || coalescedWorldPos;
            }
            if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
              const pts = drawingHandlers.shapePointsRef?.current || [];
              if (pts.length >= 1) {
                const anchor = pts[pts.length - 1];
                const before = coalescedWorldPos;
                coalescedWorldPos = snapPointToAngle(anchor, coalescedWorldPos, 45);
                // quiet
              }
            } else if (!tools.shapeMode) {
              const anchor = shiftAnchorWorldPosRef.current || strokeStartWorldPosRef.current;
              if (anchor) {
                const before = coalescedWorldPos;
                coalescedWorldPos = snapPointToAngle(anchor, coalescedWorldPos, 45);
                // quiet
              }
            }
          }
          const coalescedPressure = coalescedEvent.pressure || 0.5;
          
          // Draw with the intermediate position and pressure
          if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
            drawingHandlers.continueShapeDrawing(coalescedWorldPos);
          } else {
            drawingHandlers.continueDrawing(coalescedWorldPos, coalescedPressure);
            // Track last sampled point for mid-stroke Shift anchoring
            lastBrushSampleWorldPosRef.current = coalescedWorldPos;
          }
        }
      }
    }
    
    // Only dispatch to state machine if not panning (to avoid unnecessary updates)
    if (!pan.panState.isPanning) {
      stateMachine.dispatch({ 
        type: 'MOUSE_MOVE',
        position: currentPointerPos,
        pressure
      });
    }
    
    
    // Show brush cursor logic:
    // Hide cursor when: panning, custom tool, dragging paste, or pointer outside canvas bounds
    // NOTE: Keep cursor visible while erasing so users can see eraser size
    updateBrushCursorVisibility();
    
    // Handle dragging floating paste
    // Use refs to avoid render timing issues; begin drag sets these synchronously
    if (floatingPasteDragStart.current && floatingPasteOriginalPos.current) {
      const deltaX = worldPos.x - floatingPasteDragStart.current.x;
      const deltaY = worldPos.y - floatingPasteDragStart.current.y;

      const newX = floatingPasteOriginalPos.current.x + deltaX;
      const newY = floatingPasteOriginalPos.current.y + deltaY;

      updateFloatingPastePosition(newX, newY);

      // Redraw
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        deps.draw(ctx, deps.viewTransformRef.current);
      }
      return;
    }
    
    // Handle selection
    if (interaction.state.isSelecting) {
      if (interaction.refs.selectionStart.current) {
        setSelectionBounds(interaction.refs.selectionStart.current, worldPos);
      }
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        deps.draw(ctx, deps.viewTransformRef.current);
      }
      return;
    }
    
    // Handle direction selection for linear gradient fill (after shape completion)
    if (drawingHandlers.isSelectingDirectionRef?.current && !interaction.state.isDrawing) {
      // Continue shape drawing to show direction arrow preview (throttled)
      // If Shift is pressed, snap preview direction to 45° increments relative to shape center
      let dirWorld = worldPos;
      if (event.shiftKey) {
        const pts = drawingHandlers.shapePointsRef?.current || [];
        if (pts.length >= 3) {
          const center = pts.reduce((acc: any, p: any) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
          center.x /= pts.length;
          center.y /= pts.length;
          dirWorld = snapPointToAngle(center, dirWorld, 45);
        }
      }

      if (deps.previewAnimationFrameRef && !deps.previewAnimationFrameRef.current) {
        const nowTs = performance.now();
        // Reuse overlay FPS cap for direction preview too
        if (nowTs - lastOverlayPreviewTs < OVERLAY_PREVIEW_FRAME_MS) {
          return;
        }
        deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
          lastOverlayPreviewTs = performance.now();
          drawingHandlers.continueShapeDrawing(dirWorld);
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            deps.draw(ctx, deps.viewTransformRef.current);
          }
          if (deps.previewAnimationFrameRef) deps.previewAnimationFrameRef.current = null;
        });
      }
      return;
    }
    
    // Check for rectangle gradient width preview mode (special case - works without mouse down)
    if (toolStateMachine.isRectangleGradient && 
        toolStateMachine.rectangleBrushState.drawingState === 'definingWidth' &&
        !interaction.state.isDrawing && deps.previewAnimationFrameRef) {
      
      // Throttle rectangle gradient width preview with RAF + FPS cap
      if (!deps.previewAnimationFrameRef.current) {
        const nowTs = performance.now();
        if (nowTs - lastOverlayPreviewTs < OVERLAY_PREVIEW_FRAME_MS) {
          return;
        }
        deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
          lastOverlayPreviewTs = performance.now();
          const overlayCanvas = overlayCanvasRef.current;
          const overlayCtx = overlayCanvas?.getContext('2d');
          if (overlayCtx && overlayCanvas) {
            // Clear only the overlay canvas
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            
            // Width definition preview - show full rectangle with gradient
            const currentRectState = toolStateMachine.rectangleBrushState;
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
              
              overlayCtx.save();
              overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
              overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
              
              overlayCtx.globalAlpha = tools.currentTool === 'eraser' 
                ? (tools.eraserSettings?.opacity || 1)
                : (tools.brushSettings.opacity || 1);
              overlayCtx.globalCompositeOperation = tools.currentTool === 'eraser' ? 'destination-out' : (tools.brushSettings.blendMode || 'source-over');
              
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
              const gradient = overlayCtx.createLinearGradient(startPos.x, startPos.y, endPos.x, endPos.y);
              
              if (sampledColors.length > 0) {
                sampledColors.forEach((color, index) => {
                  const position = sampledColors.length === 1 ? 0 : index / (sampledColors.length - 1);
                  gradient.addColorStop(position, color);
                });
              } else {
                gradient.addColorStop(0, tools.brushSettings.color);
                gradient.addColorStop(1, tools.brushSettings.color);
              }
              
              overlayCtx.fillStyle = gradient;
              overlayCtx.beginPath();
              overlayCtx.moveTo(corners[0].x, corners[0].y);
              overlayCtx.lineTo(corners[1].x, corners[1].y);
              overlayCtx.lineTo(corners[2].x, corners[2].y);
              overlayCtx.lineTo(corners[3].x, corners[3].y);
              overlayCtx.closePath();
              overlayCtx.fill();
              
              overlayCtx.restore();
            }
          }
          if (deps.previewAnimationFrameRef) {
            deps.previewAnimationFrameRef.current = null;
          }
        });
      }
      return;
    }
    
    if (interaction.state.isDrawing) {
      // Rectangle gradient preview
      if (toolStateMachine.isRectangleGradient) {
        // If defining length and Shift is pressed, snap to 45° relative to start
        let rgWorld = worldPos;
        if (event.shiftKey && toolStateMachine.rectangleBrushState.drawingState === 'definingLength') {
          const start = toolStateMachine.rectangleBrushState.startPos;
          if (start) {
            const before = rgWorld;
            rgWorld = snapPointToAngle(start, worldPos, 45);
          }
        }
        const previewType = toolStateMachine.handleRectangleGradientMouseMove(rgWorld);
        if (previewType && deps.previewAnimationFrameRef) {
        // Throttle rectangle gradient preview with RAF + FPS cap
        if (!deps.previewAnimationFrameRef.current) {
          const nowTs = performance.now();
          if (nowTs - lastOverlayPreviewTs < OVERLAY_PREVIEW_FRAME_MS) {
            return;
          }
          deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
            lastOverlayPreviewTs = performance.now();
            const overlayCanvas = overlayCanvasRef.current;
            const overlayCtx = overlayCanvas?.getContext('2d');
              if (overlayCtx && overlayCanvas) {
                // Clear only the overlay canvas
                overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                
                // Get current rectangle state
                const currentRectState = toolStateMachine.rectangleBrushState;
                
                if (previewType === 'length') {
                  // Length definition preview - show line with sampled colors
                  overlayCtx.save();
                  overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
                  overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
                  
                  // Determine colors for length preview
                  const numColorsLen = Math.max(2, Math.min(64, tools.brushSettings.colors || 2));
                  let sampledColors: string[] = [];
                  const presetIdLen = tools.brushSettings.rectGradientPresetId || 'none';
                  if (presetIdLen !== 'none') {
                    const stops = getPresetStops(presetIdLen) || [];
                    sampledColors = resampleStopsToColors(stops, numColorsLen);
                  } else {
                    sampledColors = sampleColorsAlongLine(
                      currentRectState.startPos.x,
                      currentRectState.startPos.y,
                      worldPos.x,
                      worldPos.y,
                      numColorsLen
                    );
                  }
                  
                  // Create gradient with sampled colors
                  const gradient = overlayCtx.createLinearGradient(
                    currentRectState.startPos.x,
                    currentRectState.startPos.y,
                    worldPos.x,
                    worldPos.y
                  );
                  
                  if (sampledColors.length === 1) {
                    gradient.addColorStop(0, sampledColors[0]);
                    gradient.addColorStop(1, sampledColors[0]);
                  } else {
                    sampledColors.forEach((color, i) => {
                      gradient.addColorStop(i / (sampledColors.length - 1), color);
                    });
                  }
                  
                  overlayCtx.strokeStyle = gradient;
                  overlayCtx.lineWidth = 2 / deps.viewTransformRef.current.scale;
                  overlayCtx.beginPath();
                  overlayCtx.moveTo(currentRectState.startPos.x, currentRectState.startPos.y);
                  overlayCtx.lineTo(worldPos.x, worldPos.y);
                  overlayCtx.stroke();
                  
                  overlayCtx.restore();
                } else if (previewType === 'width') {
                  // Width definition preview - show full rectangle with gradient
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
                    
                    overlayCtx.save();
                    overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
                    overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
                    
                    overlayCtx.globalAlpha = tools.currentTool === 'eraser' 
                      ? (tools.eraserSettings?.opacity || 1)
                      : (tools.brushSettings.opacity || 1);
                    overlayCtx.globalCompositeOperation = tools.currentTool === 'eraser' ? 
                      'destination-out' : (tools.brushSettings.blendMode || 'source-over');
                    
                    // Determine colors for width preview
                    const numColorsWid = Math.max(2, Math.min(64, tools.brushSettings.colors || 2));
                    let sampledColors: string[] = [];
                    const presetIdWid = tools.brushSettings.rectGradientPresetId || 'none';
                    if (presetIdWid !== 'none') {
                      const stops = getPresetStops(presetIdWid) || [];
                      sampledColors = resampleStopsToColors(stops, numColorsWid);
                    } else {
                      sampledColors = sampleColorsAlongLine(
                        startPos.x,
                        startPos.y,
                        endPos.x,
                        endPos.y,
                        numColorsWid
                      );
                    }
                    
                    // Create gradient for preview
                    const gradient = overlayCtx.createLinearGradient(startPos.x, startPos.y, endPos.x, endPos.y);
                    
                    if (sampledColors.length > 0) {
                      sampledColors.forEach((color, index) => {
                        const position = sampledColors.length === 1 ? 0 : index / (sampledColors.length - 1);
                        gradient.addColorStop(position, color);
                      });
                    } else {
                      gradient.addColorStop(0, tools.brushSettings.color);
                      gradient.addColorStop(1, tools.brushSettings.color);
                    }
                    
                    overlayCtx.fillStyle = gradient;
                    overlayCtx.beginPath();
                    overlayCtx.moveTo(corners[0].x, corners[0].y);
                    overlayCtx.lineTo(corners[1].x, corners[1].y);
                    overlayCtx.lineTo(corners[2].x, corners[2].y);
                    overlayCtx.lineTo(corners[3].x, corners[3].y);
                    overlayCtx.closePath();
                    overlayCtx.fill();
                    
                    overlayCtx.restore();
                  }
                }
              }
              if (deps.previewAnimationFrameRef) {
            deps.previewAnimationFrameRef.current = null;
          }
            });
          }
        }
        return;
      }
      
      // Polygon gradient, color cycle shape, contour polygon, or shape mode preview
      if (toolStateMachine.isPolygonGradient || toolStateMachine.isColorCycleShape || toolStateMachine.isContourPolygon || 
          (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current && drawingHandlers.shapePointsRef.current.length > 0)) {
        // For gradient/special brushes, use their state machine. For shape mode, always show preview
        // Compute a possibly snapped mouse world position for preview (relative to last point)
        let previewWorld = worldPos;
        if (event.shiftKey) {
          const points = (toolStateMachine.isPolygonGradient || toolStateMachine.isContourPolygon)
            ? toolStateMachine.polygonGradientState.points
            : drawingHandlers.shapePointsRef.current;
          if (points && points.length >= 1) {
            const anchor = points[points.length - 1];
            const before = previewWorld;
            previewWorld = snapPointToAngle(anchor, previewWorld, 45);
          }
        }
        // Determine preview mode without driving store updates for CC shape
        let shouldShowPreview: boolean;
        if (toolStateMachine.isColorCycleShape) {
          // Update local shape points and always preview while drawing
          drawingHandlers.continueShapeDrawing(previewWorld);
          shouldShowPreview = tools.shapeMode && drawingHandlers.isDrawingShapeRef.current;
        } else if (toolStateMachine.isPolygonGradient || toolStateMachine.isContourPolygon) {
          shouldShowPreview = !!toolStateMachine.handlePolygonGradientMouseMove(previewWorld);
        } else {
          shouldShowPreview = tools.shapeMode && drawingHandlers.isDrawingShapeRef.current;
        }
        
        
        if (shouldShowPreview && deps.previewAnimationFrameRef) {
          // If previewing a Color Cycle Shape, ensure all CC animations are paused during preview
          if (toolStateMachine.isColorCycleShape) {
            drawingHandlers.stopContinuousColorCycleAnimation?.();
          }
        // Throttle polygon/shape preview with RAF + FPS cap
        if (!deps.previewAnimationFrameRef.current) {
          const nowTs = performance.now();
          if (nowTs - lastOverlayPreviewTs < OVERLAY_PREVIEW_FRAME_MS) {
            return;
          }
          deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
            lastOverlayPreviewTs = performance.now();
            const overlayCanvas = overlayCanvasRef.current;
            const overlayCtx = overlayCanvas?.getContext('2d');
              
              // Get points from polygon state (polygon/contour) or local refs (shape/CC shape)
              const points = (toolStateMachine.isPolygonGradient || toolStateMachine.isContourPolygon)
                ? toolStateMachine.polygonGradientState.points
                : drawingHandlers.shapePointsRef.current;
              
              if (overlayCtx && overlayCanvas && points && points.length > 0) {
                // Clear only the overlay canvas
                overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                
                overlayCtx.save();
                overlayCtx.imageSmoothingEnabled = false;
                overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
                overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
                
                const pts = points as any as { x: number; y: number }[];
                const vertexCount = pts.length + 1; // include preview point
                
                if (vertexCount >= 3) {
                  // For all shape types, show appropriate preview
                  if (toolStateMachine.isContourPolygon) {
                    // Use solid color for contour polygon preview
                    overlayCtx.strokeStyle = tools.brushSettings.color;
                    overlayCtx.lineWidth = 2 / deps.viewTransformRef.current.scale;
                    overlayCtx.globalAlpha = 0.8;
                  } else if (tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE) {
                    // For COLOR_CYCLE_SHAPE, show transparent black fill
                    overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.3)'; // Transparent black fill
                    overlayCtx.globalAlpha = 1.0;
                  } else if (tools.shapeMode && !toolStateMachine.isPolygonGradient) {
                    // For regular brushes in shape mode, show filled preview with current color
                    overlayCtx.fillStyle = tools.brushSettings.color;
                    overlayCtx.globalAlpha = 0.4; // Semi-transparent preview
                  } else {
                    // For regular polygon gradient, show gradient preview
                    // Compute bounding box without allocating arrays
                    let minX = pts[0].x;
                    let minY = pts[0].y;
                    let maxX = pts[0].x;
                    let maxY = pts[0].y;
                    for (let i = 1; i < pts.length; i++) {
                      const p = pts[i];
                      if (p.x < minX) minX = p.x;
                      if (p.y < minY) minY = p.y;
                      if (p.x > maxX) maxX = p.x;
                      if (p.y > maxY) maxY = p.y;
                    }
                    // Include current preview point
                    if (previewWorld.x < minX) minX = previewWorld.x;
                    if (previewWorld.y < minY) minY = previewWorld.y;
                    if (previewWorld.x > maxX) maxX = previewWorld.x;
                    if (previewWorld.y > maxY) maxY = previewWorld.y;
                    const width = maxX - minX;
                    const height = maxY - minY;
                    
                    // Choose gradient direction based on polygon shape
                    let gradient;
                    if (width > height) {
                      gradient = overlayCtx.createLinearGradient(minX, (minY + maxY) / 2, maxX, (minY + maxY) / 2);
                    } else {
                      gradient = overlayCtx.createLinearGradient((minX + maxX) / 2, minY, (minX + maxX) / 2, maxY);
                    }
                    
                    // Sample colors from canvas for regular polygon gradient
                    const previewColors = toolStateMachine.polygonGradientState.points.length > 0 ? [
                      ...toolStateMachine.polygonGradientState.points.map((p: any) => p.color),
                      deps.sampleColorAtPosition(previewWorld.x, previewWorld.y)
                    ] : [tools.brushSettings.color];
                    
                    // Create gradient stops
                    if (previewColors.length >= 3) {
                      gradient.addColorStop(0, previewColors[0]);
                      gradient.addColorStop(0.5, previewColors[Math.floor(previewColors.length / 2)]);
                      gradient.addColorStop(1, previewColors[previewColors.length - 1]);
                    } else if (previewColors.length === 2) {
                      gradient.addColorStop(0, previewColors[0]);
                      gradient.addColorStop(1, previewColors[1]);
                    } else if (previewColors.length === 1) {
                      gradient.addColorStop(0, previewColors[0]);
                      gradient.addColorStop(1, previewColors[0]);
                    }
                    
                    overlayCtx.fillStyle = gradient;
                  }
                  
                  // Ensure normal compositing for preview drawing
                  // (avoid lingering destination-out from eraser, etc.)
                  overlayCtx.globalCompositeOperation = 'source-over';

                  // Draw polygon preview - stroke for color cycle, fill for others
                  overlayCtx.beginPath();
                  overlayCtx.moveTo(pts[0].x, pts[0].y);
                  for (let i = 1; i < pts.length; i++) {
                    overlayCtx.lineTo(pts[i].x, pts[i].y);
                  }
                  // Append current pointer position as the last vertex for preview closure
                  overlayCtx.lineTo(previewWorld.x, previewWorld.y);
                  overlayCtx.closePath();
                  
                  if (toolStateMachine.isContourPolygon) {
                    overlayCtx.stroke(); // Just outline for contour
                  } else {
                    overlayCtx.fill(); // Fill for color cycle shape, regular polygon gradient and shape mode
                  }
                } else if (pts.length === 1 && tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
                  // Early feedback for first segment: draw a simple guide line to current pointer
                  overlayCtx.beginPath();
                  overlayCtx.strokeStyle = tools.brushSettings.color;
                  overlayCtx.lineWidth = 1 / deps.viewTransformRef.current.scale;
                  overlayCtx.moveTo(pts[0].x, pts[0].y);
                  overlayCtx.lineTo(previewWorld.x, previewWorld.y);
                  overlayCtx.stroke();
                } else if (pts.length === 0 && tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
                  // Single point: draw a small marker dot
                  overlayCtx.beginPath();
                  overlayCtx.fillStyle = tools.brushSettings.color;
                  const r = 2 / deps.viewTransformRef.current.scale;
                  overlayCtx.arc(previewWorld.x, previewWorld.y, r, 0, Math.PI * 2);
                  overlayCtx.fill();
                }
                
                overlayCtx.restore();
              }
              if (deps.previewAnimationFrameRef) {
            deps.previewAnimationFrameRef.current = null;
          }
            });
          }
        }
        return;
      }
      
      // Normal brush or shape mode
      if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
        let shapeWorld = worldPos;
        if (event.shiftKey) {
          const pts = drawingHandlers.shapePointsRef?.current || [];
          if (pts.length >= 1) {
            const anchor = pts[pts.length - 1];
            const before = shapeWorld;
            shapeWorld = snapPointToAngle(anchor, shapeWorld, 45);
          }
        }
        drawingHandlers.continueShapeDrawing(shapeWorld);
      } else {
        // Continue drawing immediately for responsive feel
        let brushWorld = worldPos;
        if (event.shiftKey) {
          // If Shift was pressed mid-stroke, and we don't yet have an anchor, use the last sampled point
          if (!shiftAnchorWorldPosRef.current) {
            shiftAnchorWorldPosRef.current = lastBrushSampleWorldPosRef.current || brushWorld;
          }
          const anchor = shiftAnchorWorldPosRef.current || strokeStartWorldPosRef.current;
          if (anchor) {
            const before = brushWorld;
            brushWorld = snapPointToAngle(anchor, brushWorld, 45);
          }
        }
        drawingHandlers.continueDrawing(brushWorld, pressure);
        // Update last sampled point after drawing
        lastBrushSampleWorldPosRef.current = brushWorld;

        // Throttle the expensive redraw with RAF
        if (!deps.drawingAnimationFrameRef.current) {
          deps.drawingAnimationFrameRef.current = requestAnimationFrame(() => {
            const canvas = canvasRef.current;
            if (canvas) {
              // Use the same context options as the main canvas for consistency
              const ctx = canvas.getContext('2d', { 
                willReadFrequently: true,
                alpha: true,
                desynchronized: true 
              });
              if (ctx) {
                deps.draw(ctx, deps.viewTransformRef.current);
              }
            }
            deps.drawingAnimationFrameRef.current = null;
          });
        }
      }
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Clear pointer down state
    isMouseDownRef.current = false;
    // Reset snapping anchors at end of action
    strokeStartWorldPosRef.current = null;
    shiftAnchorWorldPosRef.current = null;
    lastBrushSampleWorldPosRef.current = null;
    // quiet
    
    // Release pointer capture
    (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);

    pointerInsideCanvas = isPointerWithinCanvas(event.clientX, event.clientY);
    
    // Cancel any pending drawing animation frame
    if (deps.drawingAnimationFrameRef.current) {
      cancelAnimationFrame(deps.drawingAnimationFrameRef.current);
      deps.drawingAnimationFrameRef.current = null;
    }
    
    // Cancel any pending preview animation frame
    if (deps.previewAnimationFrameRef && deps.previewAnimationFrameRef.current) {
      cancelAnimationFrame(deps.previewAnimationFrameRef.current);
      deps.previewAnimationFrameRef.current = null;
    }

    // Cancel any pending move RAF batch
    if (scheduledMoveRAF != null) {
      cancelAnimationFrame(scheduledMoveRAF);
      scheduledMoveRAF = null;
      lastMoveEvent = null;
    }
    
    // Clear overlay canvas
    const overlayCanvas = overlayCanvasRef.current;
    if (overlayCanvas) {
      const overlayCtx = overlayCanvas.getContext('2d');
      if (overlayCtx) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
    }
    
    const mousePos = getMousePos(event);

    // Recolor/Brush sampling finalize on drag-release
    const rsFinalize = useAppStore.getState().recolorSampling;
    if (rsFinalize.active && rsFinalize.start) {
      const scaleFinalize = canvas?.zoom || 1;
      const worldPosFinalize = pan.screenToWorld(mousePos.x, mousePos.y, scaleFinalize);
      const startFinalize = rsFinalize.start;
      const endFinalize = { x: worldPosFinalize.x, y: worldPosFinalize.y };
      const samplesFinalize = Math.max(2, Math.min(32, rsFinalize.samples || 12));
      const colorsFinalize = sampleColorsAlongLine(startFinalize.x, startFinalize.y, endFinalize.x, endFinalize.y, samplesFinalize);
      const stopsFinalize = colorsFinalize.map((c, i) => ({ position: samplesFinalize === 1 ? 0 : i / (samplesFinalize - 1), color: cssColorToHex(c) }));
      // Configure directional mapping so the gradient flows along the sampled path
      const targetFinalize = rsFinalize.target || 'recolor';

      if (targetFinalize === 'recolor') {
        const layerFinalize = layers.find(l => l.id === activeLayerId);
        if (layerFinalize) {
          const managerFinalize = RecolorManager.getInstance();
          (async () => {
            try {
              if (!layerFinalize.colorCycleData?.recolorSettings) {
                const ok = await managerFinalize.processLayer(layerFinalize, {
                  quantizationMode: 'rgb332',
                  ditherMode: 'off',
                  cycleColors: 16,
                  gradientPreset: 'custom',
                  customGradient: stopsFinalize
                });
                if (!ok) throw new Error('processLayer failed');
              } else {
                managerFinalize.updateGradient(layerFinalize, stopsFinalize);
              }
              // Auto-play the recolor animation for this layer after applying gradient
              try {
                managerFinalize.playSingle(layerFinalize.id);
              } catch (e) {
                console.warn('Failed to auto-play recolor animation:', e);
              }
              // Remap palette index sequence to flow along sampled direction without changing pixel structure
              const dxFinalize = endFinalize.x - startFinalize.x;
              const dyFinalize = endFinalize.y - startFinalize.y;
              const angleFinalize = (Math.atan2(dyFinalize, dxFinalize) * 180) / Math.PI;
              try { managerFinalize.setPaletteDirectionalOrder(layerFinalize.id, angleFinalize); } catch {}
              try { managerFinalize.autoSetAnimationDirection(layerFinalize.id, angleFinalize); } catch {}
            } catch (e) {
              console.warn('Failed to apply sampled gradient', e);
            }
          })();
        }
      } else {
        try {
          useAppStore.getState().setBrushSettings({ colorCycleGradient: stopsFinalize });
        } catch {}
      }

      useAppStore.getState().stopRecolorSampling();
      return;
    }

    // SIMPLIFIED PANNING: End pan if we were panning
    if (pan.panState.isPanning) {
      debugLog('pan', 'PTR_UP endPan', { spaceStillHeld: isSpacePressedRef.current });
      pan.endPan();
      // Restore cursor based on space state
      if (isSpacePressedRef.current) {
        setCursorStyle('grab');
      } else {
        setCursorStyle(deps.defaultCursorStyle || 'none');
        updateBrushCursorVisibility();
      }
      return;
    }
    
    // Dispatch to state machine (only once) for normal interactions
    stateMachine.dispatch({ 
      type: 'MOUSE_UP',
      position: mousePos 
    });
    
    // Handle floating paste drag end
    if (deps.isDraggingFloatingPaste || floatingPasteDragStart.current) {
      setIsDraggingFloatingPaste(false);
      floatingPasteDragStart.current = null;
      floatingPasteOriginalPos.current = null;
      setCursorStyle(deps.defaultCursorStyle || 'none');
      updateBrushCursorVisibility();
      return;
    }
    
    // Handle selection
    if (interaction.state.isSelecting) {
      interaction.dispatch({ type: 'SELECTION_END' });
      const scale = canvas?.zoom || 1;
      let worldPos = pan.screenToWorld(mousePos.x, mousePos.y, scale);
      
      // Clamp world position to canvas bounds
      if (project) {
        worldPos = {
          x: Math.max(0, Math.min(project.width - 1, worldPos.x)),
          y: Math.max(0, Math.min(project.height - 1, worldPos.y))
        };
      }
      if (interaction.refs.selectionStart.current) {
        setSelectionBounds(interaction.refs.selectionStart.current, worldPos);
        if (tools.currentTool === 'custom') {
          deps.setCurrentTool('brush');
          clearSelection();
          updateBrushCursorVisibility(); // Show brush cursor again after custom brush selection
        }
      }
      interaction.refs.selectionStart.current = null;
      return;
    }
    
    // Handle drawing
    if (interaction.state.isDrawing) {
      // Rectangle gradient
      if (toolStateMachine.isRectangleGradient) {
        // Handle the state transition
        const shouldFinalize = toolStateMachine.handleRectangleGradientMouseUp();
        
        if (shouldFinalize) {
          // Clear the overlay canvas since we're finalizing
          const overlayCanvas = overlayCanvasRef.current;
          if (overlayCanvas) {
            const overlayCtx = overlayCanvas.getContext('2d');
            if (overlayCtx) {
              overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            }
          }
          
          // Reset the tool state and end drawing
          toolStateMachine.resetRectangleGradient();
          interaction.dispatch({ type: 'DRAWING_END' });
        }
        // Don't end drawing state if we're still defining width
        return;
      }
      
      // Polygon gradient or contour polygon (COLOR_CYCLE_SHAPE handled by shape-mode finalize below)
      if (toolStateMachine.isPolygonGradient || toolStateMachine.isContourPolygon) {
        if (toolStateMachine.handlePolygonGradientMouseUp()) {
          // Finalize polygon - we have at least 3 points
          const currentPolygonState = toolStateMachine.polygonGradientState;
          
          if (currentPolygonState.points.length >= 3) {
            drawingHandlers.initDrawingCanvas();
            const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
            
            if (drawCtx && brushEngine) {
              // Handle different polygon types
              if (false) {
                
                // Do NOT save before drawing. We save AFTER rendering the shape
                // in useDrawingHandlers.finalizeShapeDrawing to ensure correct undo granularity.
                // This avoids removing multiple shapes on a single undo.
                const activeLayer = layers.find(l => l.id === activeLayerId);
                
                // Use color cycle fill for COLOR_CYCLE_SHAPE
                // Pass false to keep existing shapes (accumulate)
                brushEngine.resetColorCycle(false);
                
                // Check fill mode and use appropriate fill method
                const fillMode = tools.brushSettings.colorCycleFillMode || 'concentric';
                
                if (fillMode === 'linear') {
                  
                  // For linear mode, we need to enter direction selection mode
                  // Store the polygon points in drawing handlers for direction selection
                  drawingHandlers.shapePointsRef.current = currentPolygonState.points.map((p: any) => ({ x: p.x, y: p.y }));
                  
                  // Mark that we're selecting direction
                  drawingHandlers.isSelectingDirectionRef.current = true;
                  
                  // Stop any color cycle animation to prevent flickering during direction selection
                  drawingHandlers.stopContinuousColorCycleAnimation?.();
                  
                  // Clear and draw preview outline on drawing canvas
                  drawCtx.clearRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);
                  drawCtx.save();
                  drawCtx.globalCompositeOperation = 'difference';
                  drawCtx.strokeStyle = '#000000';  // Black with difference mode
                  drawCtx.lineWidth = 2;
                  drawCtx.beginPath();
                  const points = currentPolygonState.points;
                  drawCtx.moveTo(points[0].x, points[0].y);
                  for (let i = 1; i < points.length; i++) {
                    drawCtx.lineTo(points[i].x, points[i].y);
                  }
                  drawCtx.closePath();
                  drawCtx.stroke();
                  drawCtx.restore();
                  
                  // Don't render color cycle yet - wait for direction
                  // Skip the normal finalization - we'll finalize after direction is selected
                  drawingHandlers.drawingCanvasHasContent.current = true;
                  toolStateMachine.resetPolygonGradient();
                  interaction.dispatch({ type: 'DRAWING_END' });
                  return; // Early return to prevent finalization
                } else {
                  // Concentric fill - immediate
                  brushEngine.fillColorCycleShape(currentPolygonState.points.map((p: any) => ({ x: p.x, y: p.y })));
                  // Clear the drawing canvas before rendering
                  drawCtx.clearRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);
                  // Render the color cycle immediately
                  brushEngine.renderColorCycle(drawCtx, false);
                }
              } else if (toolStateMachine.isContourPolygon) {
                // Draw contour polygon
                brushEngine.drawContourPolygon(
                  drawCtx,
                  {
                    vertices: currentPolygonState.points.map((p: any) => ({ x: p.x, y: p.y })),
                    fillColor: currentPolygonState.points[0]?.color
                  },
                  false // not preview
                );
              } else {
                // Standard polygon gradient
                brushEngine.drawPolygonGradient(
                  drawCtx,
                  {
                    vertices: currentPolygonState.points.map((p: any) => ({ x: p.x, y: p.y })),
                    colors: currentPolygonState.points.map((p: any) => p.color)
                  },
                  false // not preview
                );
              }
              
              drawingHandlers.drawingCanvasHasContent.current = true;
            }
          }
          
          // Mark composite as dirty BEFORE finalization
          compositeCanvasDirtyRef.current = true;
          // Seed shape refs so finalizeShapeDrawing can operate with the same points
          if (toolStateMachine.isColorCycleShape) {
            drawingHandlers.shapePointsRef.current = currentPolygonState.points.map((p: any) => ({ x: p.x, y: p.y }));
            drawingHandlers.isDrawingShapeRef.current = true;
          }

          // Finalize via shape path to ensure CC shapes render to the layer canvas
          // and are saved once with correct state for undo/redo.
          drawingHandlers.finalizeShapeDrawing().then(() => {
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

            // Restart color cycle animation if needed
            if (deps.restartColorCycleAnimation) {
              deps.restartColorCycleAnimation();
            }
          });
          toolStateMachine.resetPolygonGradient();
        }
        interaction.dispatch({ type: 'DRAWING_END' });
        return;
      }
      
      // Normal brush or shape mode
      interaction.dispatch({ type: 'DRAWING_END' });
      
      // Mark composite as dirty BEFORE finalization to ensure it updates
      compositeCanvasDirtyRef.current = true;
      
      if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
        // Guard: require at least 3 points to finalize a polygon
        const ptsLen = (drawingHandlers as any).shapePointsRef?.current?.length || 0;
        if (ptsLen < 3) {
          // Keep collecting vertices with subsequent clicks
          return;
        }
        // Check if we need to enter direction selection mode for linear gradient
        const isColorCycleShape = tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
        const isLinearFill = tools.brushSettings.colorCycleFillMode === 'linear';
        
        if (isColorCycleShape && isLinearFill && !drawingHandlers.isSelectingDirectionRef?.current) {
          // Don't finalize yet - enter direction selection mode
          
          // Call finalizeShapeDrawing which will set up direction selection mode
          drawingHandlers.finalizeShapeDrawing();
          // CRITICAL FIX: Check if we actually entered direction selection mode AFTER the call
          if (drawingHandlers.isSelectingDirectionRef?.current) {
            
            // Don't complete finalization yet - we're still in direction selection
            return;
          }
          
        }
        
        // Only proceed with finalization if NOT in direction selection mode
        if (!drawingHandlers.isSelectingDirectionRef?.current) {
          drawingHandlers.finalizeShapeDrawing();
          // Signal that finalization is complete
          stateMachine.finalizationComplete();
          
          // Force immediate composite regeneration after layer update
          if (compositeCanvasRef.current && project) {
            compositeLayersToCanvas(compositeCanvasRef.current);
            setCurrentOffscreenCanvas(compositeCanvasRef.current);
            compositeCanvasDirtyRef.current = false;
          }
          
          setNeedsRedraw(prev => prev + 1);
          
          // Restart color cycle animation if needed
          if (deps.restartColorCycleAnimation) {
            deps.restartColorCycleAnimation();
          }
        } else {
          
        }
      } else {
        // For regular drawing (non-shape mode), never skip save
        drawingHandlers.finalizeDrawing(false).then(() => {
          // Signal that finalization is complete
          stateMachine.finalizationComplete();
          
          // Use requestAnimationFrame to ensure the layer update has propagated
          requestAnimationFrame(() => {
            // Force immediate composite regeneration after layer update
            if (compositeCanvasRef.current && project) {
              compositeLayersToCanvas(compositeCanvasRef.current);
              setCurrentOffscreenCanvas(compositeCanvasRef.current);
              compositeCanvasDirtyRef.current = false;
              
              // Force immediate redraw
              const canvas = canvasRef.current;
              const ctx = canvas?.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                deps.draw(ctx, deps.viewTransformRef.current);
              }
            }
          });
          
          // Restart color cycle animation if needed
          if (deps.restartColorCycleAnimation) {
            deps.restartColorCycleAnimation();
          }
        });
      }
    }

    updateBrushCursorVisibility();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Keep handler minimal; batch work to next animation frame
    // Never drop updates while drawing shapes; RAF will still run at display rate
    // Persist the synthetic event just in case (React 17+ no-ops)
    (event as any).persist?.();
    lastMoveEvent = event;
    if (scheduledMoveRAF == null) {
      scheduledMoveRAF = requestAnimationFrame(() => {
        const e = lastMoveEvent;
        scheduledMoveRAF = null;
        if (e) {
          processPointerMove(e);
        }
      });
    }
  };

  const handlePointerEnter = () => {
    pointerInsideCanvas = true;
    updateBrushCursorVisibility(true);
  };

  const handlePointerLeave = () => {
    pointerInsideCanvas = false;
    updateBrushCursorVisibility(false);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Handle pointer cancel (e.g., stylus moving out of range)
    isMouseDownRef.current = false;
    (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);

    pointerInsideCanvas = isPointerWithinCanvas(event.clientX, event.clientY);
    updateBrushCursorVisibility();

    // Cancel any pending move RAF batch on cancel
    if (scheduledMoveRAF != null) {
      cancelAnimationFrame(scheduledMoveRAF);
      scheduledMoveRAF = null;
      lastMoveEvent = null;
    }
  };

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerEnter,
    handlePointerLeave,
    handlePointerCancel
  };
};
