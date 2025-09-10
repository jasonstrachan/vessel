import React from 'react';
import { useAppStore } from '../../../stores/useAppStore';
import { RecolorManager } from '../../../lib/colorCycle/RecolorManager';
import type { EventHandlerDependencies, PointerHandlers } from '../utils/types';
import { BrushShape } from '../../../types';
import { floodFill } from '../../../utils/floodFill';
import { detectWacomIssues, testWacomPressure } from '../../../utils/detectWacom';
import { getPresetStops } from '../../../utils/gradientPresets';

export const createPointerHandlers = (deps: EventHandlerDependencies): PointerHandlers => {
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
      console.warn('[WACOM ISSUE]', wacomTest.details);
      const issues = detectWacomIssues();
      if (issues.solutions.length > 0) {
        console.log('[WACOM SOLUTIONS]:', issues.solutions.join('\n'));
      }
    }
    
    // SIMPLIFIED PANNING: Just check if space is pressed
    if (isSpacePressedRef.current) {
      pan.startPan(pointerPos.x, pointerPos.y);
      setCursorStyle('grabbing');
      setShowBrushCursor(false);
      return; // Skip everything else - we're panning
    }
    
    // Middle or right click - skip
    if (event.button === 1 || event.button === 2) {
      return;
    }
    
    const scale = canvas?.zoom || 1;
    const worldPos = pan.screenToWorld(pointerPos.x, pointerPos.y, scale);

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
    
    // For simple drawing mode, use the existing drawing handlers
    // Use the currentMode captured BEFORE dispatch!
    if (currentMode === 'IDLE' && 
        (tools.currentTool === 'brush' || tools.currentTool === 'eraser') &&
        !tools.shapeMode &&
        tools.brushSettings.brushShape !== BrushShape.RECTANGLE_GRADIENT &&
        tools.brushSettings.brushShape !== BrushShape.POLYGON_GRADIENT &&
        tools.brushSettings.brushShape !== BrushShape.CONTOUR_POLYGON &&
        tools.brushSettings.brushShape !== BrushShape.COLOR_CYCLE_SHAPE) {
      
      // Use the existing drawing system with brush engine
      interaction.dispatch({ type: 'DRAWING_START', pressure });
      drawingHandlers.startDrawing(worldPos, pressure);
      return;
    }
    
    // Handle left click
    if (event.button === 0) {
      // Check if clicking on floating paste to drag it
      if (floatingPaste) {
        const pasteX = floatingPaste.position.x;
        const pasteY = floatingPaste.position.y;
        const pasteWidth = floatingPaste.width;
        const pasteHeight = floatingPaste.height;
        
        // Check if click is within floating paste bounds
        if (worldPos.x >= pasteX && worldPos.x <= pasteX + pasteWidth &&
            worldPos.y >= pasteY && worldPos.y <= pasteY + pasteHeight) {
          setIsDraggingFloatingPaste(true);
          floatingPasteDragStart.current = worldPos;
          floatingPasteOriginalPos.current = { ...floatingPaste.position };
          setCursorStyle('move');
          return;
        }
      }
      
      // Handle fill tool
      if (tools.currentTool === 'fill') {
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
      if (tools.currentTool === 'selection' || tools.currentTool === 'custom') {
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
        console.log('[PointerDown] Direction selection click detected at', worldPos);
        console.log('[PointerDown] Passing position to startShapeDrawing...');
        // Pass the click position to finalize the direction
        drawingHandlers.startShapeDrawing(worldPos, pressure);
        console.log('[PointerDown] Calling finalizeShapeDrawing to complete with direction...');
        // Now finalize with the direction set
        drawingHandlers.finalizeShapeDrawing();
        console.log('[PointerDown] Direction selection complete');
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

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Throttle to 120fps max
    const now = performance.now();
    if (now - pointerMoveThrottled.current < 8) return;
    pointerMoveThrottled.current = now;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    const currentPointerPos = rect ? {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    } : { x: 0, y: 0 };
    const scale = canvas?.zoom || 1;
    const worldPos = pan.screenToWorld(currentPointerPos.x, currentPointerPos.y, scale);

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
          const coalescedWorldPos = pan.screenToWorld(coalescedPos.x, coalescedPos.y, scale);
          const coalescedPressure = coalescedEvent.pressure || 0.5;
          
          // Draw with the intermediate position and pressure
          if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
            drawingHandlers.continueShapeDrawing(coalescedWorldPos);
          } else {
            drawingHandlers.continueDrawing(coalescedWorldPos, coalescedPressure);
          }
        }
      }
    }
    
    // Always update cursor position immediately for responsive feel
    setMousePosition({ x: event.clientX, y: event.clientY });
    
    // Only dispatch to state machine if not panning (to avoid unnecessary updates)
    if (!pan.panState.isPanning) {
      stateMachine.dispatch({ 
        type: 'MOUSE_MOVE',
        position: currentPointerPos,
        pressure
      });
    }
    
    // SIMPLIFIED PANNING: Check if we're actively panning
    if (pan.panState.isPanning) {
      // Update pan position
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
      
      return; // Skip other mouse move logic while panning
    }
    
    // Show brush cursor logic:
    // Hide cursor when: panning, custom tool, dragging paste, or actively erasing
    const shouldHideCursor = stateMachine.isAwaitingPan || 
                            stateMachine.isPanning || 
                            tools.currentTool === 'custom' || 
                            deps.isDraggingFloatingPaste ||
                            (tools.currentTool === 'eraser' && interaction.state.isDrawing);
    
    setShowBrushCursor(!shouldHideCursor);
    
    // Handle dragging floating paste
    if (deps.isDraggingFloatingPaste && floatingPasteDragStart.current && floatingPasteOriginalPos.current) {
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
      // Continue shape drawing to show direction arrow preview
      drawingHandlers.continueShapeDrawing(worldPos);
      
      // Trigger redraw to show the preview
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        deps.draw(ctx, deps.viewTransformRef.current);
      }
      return;
    }
    
    // Check for rectangle gradient width preview mode (special case - works without mouse down)
    if (toolStateMachine.isRectangleGradient && 
        toolStateMachine.rectangleBrushState.drawingState === 'definingWidth' &&
        !interaction.state.isDrawing && deps.previewAnimationFrameRef) {
      
      // Throttle rectangle gradient width preview with RAF
      if (!deps.previewAnimationFrameRef.current) {
        deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
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
        const previewType = toolStateMachine.handleRectangleGradientMouseMove(worldPos);
        if (previewType && deps.previewAnimationFrameRef) {
          // Throttle rectangle gradient preview with RAF
          if (!deps.previewAnimationFrameRef.current) {
            deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
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
        const shouldShowPreview = (toolStateMachine.isPolygonGradient || toolStateMachine.isColorCycleShape || toolStateMachine.isContourPolygon) 
          ? toolStateMachine.handlePolygonGradientMouseMove(worldPos)
          : (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current);
        
        if (shouldShowPreview && deps.previewAnimationFrameRef) {
          // Throttle polygon gradient preview with RAF
          if (!deps.previewAnimationFrameRef.current) {
            deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
              const overlayCanvas = overlayCanvasRef.current;
              const overlayCtx = overlayCanvas?.getContext('2d');
              
              // Get points from either polygon state or shape drawing state
              const points = (toolStateMachine.isPolygonGradient || toolStateMachine.isColorCycleShape || toolStateMachine.isContourPolygon)
                ? toolStateMachine.polygonGradientState.points
                : drawingHandlers.shapePointsRef.current;
              
              if (overlayCtx && overlayCanvas && points && points.length > 0) {
                // Clear only the overlay canvas
                overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                
                overlayCtx.save();
                overlayCtx.imageSmoothingEnabled = false;
                overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
                overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
                
                // Build preview vertices including current mouse position
                const previewVertices = [
                  ...points.map((p: any) => ({ x: p.x || p, y: p.y || p })),
                  { x: worldPos.x, y: worldPos.y }
                ];
                
                if (previewVertices.length >= 3) {
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
                    const minX = Math.min(...previewVertices.map((v: any) => v.x));
                    const minY = Math.min(...previewVertices.map((v: any) => v.y));
                    const maxX = Math.max(...previewVertices.map((v: any) => v.x));
                    const maxY = Math.max(...previewVertices.map((v: any) => v.y));
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
                      deps.sampleColorAtPosition(worldPos.x, worldPos.y)
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
                  
                  // Draw polygon preview - stroke for color cycle, fill for others
                  overlayCtx.beginPath();
                  overlayCtx.moveTo(previewVertices[0].x, previewVertices[0].y);
                  for (let i = 1; i < previewVertices.length; i++) {
                    overlayCtx.lineTo(previewVertices[i].x, previewVertices[i].y);
                  }
                  overlayCtx.closePath();
                  
                  if (toolStateMachine.isContourPolygon) {
                    overlayCtx.stroke(); // Just outline for contour
                  } else {
                    overlayCtx.fill(); // Fill for color cycle shape, regular polygon gradient and shape mode
                  }
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
        drawingHandlers.continueShapeDrawing(worldPos);
      } else {
        // Continue drawing immediately for responsive feel
        drawingHandlers.continueDrawing(worldPos, pressure);
        
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
    
    // Release pointer capture
    (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);
    
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
      pan.endPan();
      // Restore cursor based on space state
      if (isSpacePressedRef.current) {
        setCursorStyle('grab');
      } else {
        setCursorStyle(deps.defaultCursorStyle || 'none');
        setShowBrushCursor(true);
      }
      return;
    }
    
    // Dispatch to state machine (only once) for normal interactions
    stateMachine.dispatch({ 
      type: 'MOUSE_UP',
      position: mousePos 
    });
    
    // Handle floating paste drag end
    if (deps.isDraggingFloatingPaste) {
      setIsDraggingFloatingPaste(false);
      floatingPasteDragStart.current = null;
      floatingPasteOriginalPos.current = null;
      setCursorStyle(deps.defaultCursorStyle || 'none');
      setShowBrushCursor(true);
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
          setShowBrushCursor(true); // Show brush cursor again after custom brush selection
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
      
      // Polygon gradient, color cycle shape, or contour polygon
      if (toolStateMachine.isPolygonGradient || toolStateMachine.isColorCycleShape || toolStateMachine.isContourPolygon) {
        if (toolStateMachine.handlePolygonGradientMouseUp()) {
          // Finalize polygon - we have at least 3 points
          const currentPolygonState = toolStateMachine.polygonGradientState;
          
          if (currentPolygonState.points.length >= 3) {
            drawingHandlers.initDrawingCanvas();
            const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
            
            if (drawCtx && brushEngine) {
              // Handle different polygon types
              if (toolStateMachine.isColorCycleShape) {
                // Do NOT save before drawing. We save AFTER rendering the shape
                // in useDrawingHandlers.finalizeShapeDrawing to ensure correct undo granularity.
                // This avoids removing multiple shapes on a single undo.
                const activeLayer = layers.find(l => l.id === activeLayerId);
                
                // Use color cycle fill for COLOR_CYCLE_SHAPE
                // Pass false to keep existing shapes (accumulate)
                brushEngine.resetColorCycle(false);
                
                // Check fill mode and use appropriate fill method
                const fillMode = tools.brushSettings.colorCycleFillMode || 'concentric';
                console.log('[Polygon CC Shape] Fill mode:', fillMode);
                
                if (fillMode === 'linear') {
                  // For linear mode, we need to enter direction selection mode
                  console.log('[Polygon CC Shape] Linear mode - entering direction selection');
                  // Store the polygon points in drawing handlers for direction selection
                  drawingHandlers.shapePointsRef.current = currentPolygonState.points.map((p: any) => ({ x: p.x, y: p.y }));
                  
                  // Mark that we're selecting direction
                  drawingHandlers.isSelectingDirectionRef.current = true;
                  console.log('[Polygon CC Shape] Set isSelectingDirectionRef to true');
                  
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
                  console.log('[Polygon CC Shape] Ready for direction selection - move mouse and click');
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
                    vertices: currentPolygonState.points.map((p: any) => ({ x: p.x, y: p.y }))
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
        // Check if we need to enter direction selection mode for linear gradient
        const isColorCycleShape = tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
        const isLinearFill = tools.brushSettings.colorCycleFillMode === 'linear';
        
        if (isColorCycleShape && isLinearFill && !drawingHandlers.isSelectingDirectionRef?.current) {
          // Don't finalize yet - enter direction selection mode
          console.log('[Pointer] Should enter direction selection mode for linear gradient');
          // Call finalizeShapeDrawing which will set up direction selection mode
          drawingHandlers.finalizeShapeDrawing();
          // CRITICAL FIX: Check if we actually entered direction selection mode AFTER the call
          if (drawingHandlers.isSelectingDirectionRef?.current) {
            console.log('[Pointer] Successfully entered direction selection mode');
            // Don't complete finalization yet - we're still in direction selection
            return;
          }
          console.log('[Pointer] Failed to enter direction selection mode, continuing with normal finalization');
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
          console.log('[PointerUp] In direction selection mode - skipping finalization');
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
  };

  const handlePointerEnter = () => {
    // Show brush cursor when entering canvas
    if (tools.currentTool === 'brush' || tools.currentTool === 'eraser') {
      setShowBrushCursor(true);
    }
  };

  const handlePointerLeave = () => {
    setShowBrushCursor(false);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Handle pointer cancel (e.g., stylus moving out of range)
    isMouseDownRef.current = false;
    (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);
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
